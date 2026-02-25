# Phase ADV — Advanced Code Intelligence & AI Guardrails: Deep Dive & Implementation Tracker

> **Phase Feature Statement:** _"unerr catches the mistakes AI agents make that humans can't see — blast radius before merging, architectural drift, security taint paths, and production-killing anti-patterns. My dashboard is a predictive control room, not a post-mortem."_
>
> **Source:** Internal product vision — cross-cutting phase that extends [Phase 4](./PHASE_4_BUSINESS_JUSTIFICATION_AND_TAXONOMY.md) (justification), [Phase 6](./PHASE_6_PATTERN_ENFORCEMENT_AND_RULES_ENGINE.md) (rules engine), and [Phase 7](./PHASE_7_PR_REVIEW_INTEGRATION.md) (PR review)
>
> **Prerequisites:** [Phase 1](./PHASE_1_GITHUB_CONNECT_AND_INDEXING.md) (entities + call graph in ArangoDB), [Phase 4](./PHASE_4_BUSINESS_JUSTIFICATION_AND_TAXONOMY.md) (justifications, taxonomy, feature areas), [Phase 5](./PHASE_5_INCREMENTAL_INDEXING_AND_GITHUB_WEBHOOKS.md) (incremental indexing, AST diffing, drift alerts), [Phase 6](./PHASE_6_PATTERN_ENFORCEMENT_AND_RULES_ENGINE.md) (ast-grep rules engine, pattern enforcement)
>
> **Database convention:** All unerr Supabase tables use PostgreSQL schema `unerr`. ArangoDB collections are org-scoped (`org_{orgId}/`). See [VERTICAL_SLICING_PLAN.md § Storage & Infrastructure Split](./VERTICAL_SLICING_PLAN.md#storage--infrastructure-split).

---

## Table of Contents

- [Part 1: Architectural Deep Dive](#part-1-architectural-deep-dive)
  - [1.1 Vision & Product Positioning](#11-vision--product-positioning)
  - [1.2 Feature Inventory & Phase Mapping](#12-feature-inventory--phase-mapping)
  - [1.3 Launch Tier — Ship-Critical Features](#13-launch-tier--ship-critical-features)
  - [1.4 Growth Tier — Adoption & Retention Features](#14-growth-tier--adoption--retention-features)
  - [1.5 Scale Tier — Enterprise Governance Features](#15-scale-tier--enterprise-governance-features)
  - [1.6 Reliability & Resilience](#16-reliability--resilience)
  - [1.7 Performance Considerations](#17-performance-considerations)
- [Part 2: Implementation & Tracing Tracker](#part-2-implementation--tracing-tracker)
  - [2.1 Launch Tier Tracker](#21-launch-tier-tracker)
  - [2.2 Growth Tier Tracker](#22-growth-tier-tracker)
  - [2.3 Scale Tier Tracker](#23-scale-tier-tracker)

---

## Canonical Terminology

> **CRITICAL:** Use these canonical names across code, schemas, UI, and documentation. See [Phase 4 § Canonical Terminology](./PHASE_4_BUSINESS_JUSTIFICATION_AND_TAXONOMY.md#canonical-terminology) for justification terms, [Phase 5 § Canonical Terminology](./PHASE_5_INCREMENTAL_INDEXING_AND_GITHUB_WEBHOOKS.md#canonical-terminology) for incremental indexing terms.

| Canonical Term | Definition | Related Phase |
|---|---|---|
| **Blast Radius** | N-hop graph traversal from a changed entity to API/UI boundary nodes, quantifying downstream impact. | Phase 7 |
| **Architectural Drift** | Divergence between an entity's original canonical justification and its current detected behavior (measured by cosine distance between old/new justification embeddings). | Phase 5 |
| **Trust Boundary** | A graph path from a user-input Source to a database/API Sink, validated to pass through auth/validation Nodes. | Phase 6 |
| **Resilience Score** | A per-entity metric measuring whether external calls include retry/timeout/circuit-breaker patterns. | Phase 6 |
| **Agent Alignment Score** | Composite metric measuring how well AI-generated code adheres to the repository's own mined patterns. | Phase 6 |
| **Cognitive Debt** | A metric computed from the rewind-to-commit ratio in a feature area, indicating human-AI alignment difficulty. | Phase 5.5 |
| **Semantic Test Coverage** | The ratio of truly tested logic branches vs mocked-out branches in a test file. Measures real integration confidence vs "mock theater." | Phase 6 |
| **Contract Breach** | An event triggered when a change to an internal entity bubbles up to alter the shape of a public API, GraphQL schema, or exported interface. | Phase 7 |
| **Idempotency Risk** | A flag on webhook/trigger handlers that mutate state without a detected idempotency key check or distributed lock. | Phase 6 |

---

# Part 1: Architectural Deep Dive

## 1.1 Vision & Product Positioning

This phase defines a collection of **advanced code intelligence features** that surface the proprietary graph and temporal data already captured by Phases 1–7. The goal is to shift the unerr dashboard from a _post-mortem analytics tool_ into a _predictive control room_ for AI-generated code.

**Strategic narrative:** Code generation is becoming a commodity (Cursor, Copilot, Devin). The true bottleneck is **governing the consequences of the code**. unerr is the immune system for AI-generated code — it proves that AI output is not just functional, but structurally sound, architecturally aligned, and production-safe.

**Target users:**

| Persona | Pain Point | What They Buy |
|---|---|---|
| **Indie vibe coder** | "My AI wrote code that works locally but breaks in production. I don't have a senior architect to catch this." | Safety net — senior architect oversight automated. |
| **Enterprise CTO** | "50 developers are merging AI code into our monorepo. How do I know it's not rotting the architecture?" | Control mechanisms — verifiable governance over AI agents. |

**Cross-cutting nature:** This is NOT a standalone phase. Every feature here is an _extension_ of an existing phase, leveraging infrastructure already built. The table in §1.2 maps each feature to its parent phase and its implementation status.

---

## 1.2 Feature Inventory & Phase Mapping

This section catalogs all 38 proposed features from the original brainstorm, maps them to existing phases, validates what already exists, and assigns them to a shipping tier.

### Validation Key

| Status | Meaning |
|---|---|
| **SHIPPED** | Feature is implemented and working in the current codebase. |
| **PARTIAL** | Infrastructure exists (e.g., graph data, schema) but the feature isn't surfaced or fully wired. |
| **PLANNED** | Covered by an existing phase doc but not yet implemented. |
| **NEW** | Not covered by any existing phase — requires new work. |

### Full Feature Map

> **Last verified:** 2026-02-23 against actual codebase. See improvement notes column for specific gaps.

| # | Feature | Parent Phase | Verified Status | Tier | Implementation Evidence | Improvement Needed |
|---|---------|-------------|----------------|------|------------------------|-------------------|
| 1 | **Blast Radius Visualization** | Phase 7 | **SHIPPED** (85%) | Launch | `blast-radius.ts` (92 lines), API route `app/api/repos/[repoId]/impact/route.ts`, MCP tool `analyze_impact`, frontend `components/intelligence/impact-view.tsx` (221 lines), PR check-run integration | `get_function` missing `callerCount` field. Frontend shows list view only — needs interactive graph/tree visualization. No caching for blast radius (recomputed per request). |
| 2 | **Architectural Drift Detection** | Phase 5 | **SHIPPED** (70%) | Launch | `staleness-checker.ts` (108 lines), `drift-detector.ts` (71 lines), `drift-alert.ts` activity (113 lines), API route `/api/repos/[repoId]/drift/route.ts`, frontend `drift-timeline-view.tsx` (197 lines), ArangoDB `drift_scores` collection | Cosine distance not auto-computed during re-justification. No `drift_alerts` collection (only `drift_scores`). Timeline UI missing "Accept New Intent"/"Flag Violation" action buttons. No old-vs-new justification side-by-side comparison. |
| 3 | **Auto-Generated ADRs & Ontology Display** | Phase 4 | **SHIPPED** (90%) | Launch | `ontology.ts` activities, `discover-ontology.ts` workflow, `adr-schema.ts` (59 lines), API route `/api/repos/[repoId]/adrs/route.ts`, frontend `adr-view.tsx` (117 lines), MCP `get_blueprint` includes ADR summaries | ADR auto-generation on PR merge not wired (`generateAdrWorkflow` not implemented). No ADR detail page. No "Brain Trust" aggregated view combining ADRs + ontology + domain glossary. |
| 4 | **Dead Code & Pattern Alignment** | Phase 4 + 6 | **SHIPPED** (95%) | Launch | `dead-code-detector.ts` (89 lines), `pattern-detection.ts` (186 lines), `pattern-mining.ts` (122 lines), API `/api/repos/[repoId]/intelligence/route.ts`, frontend `intelligence-view.tsx` (285 lines) with Cruft + Alignment panels, health report integration, entity detail dead-code warning banner | Pattern deviation detection not fully implemented (only adherence rate). No "Create Rule" deep-links from deviations. Bounded context bleed detection returns empty array. |
| 5 | **Cognitive Debt (Rewind-to-Commit Ratio)** | Phase 5.5 | **NOT STARTED** | Growth | No implementation found. | Requires Phase 5.5 prompt ledger + rewind tracking. Blocked dependency. |
| 6 | **Trust Boundary / Taint Analysis** | Phase 1 + 7 | **SHIPPED** (75%) | Growth | `lib/review/checks/trust-boundary-check.ts` (98 lines), integrated into PR review workflow, uses callers/callees traversal + name-pattern matching for validators | Uses simplified 2-hop analysis instead of full AQL path enumeration. Relies on name-based pattern matching (`auth`, `validate`, `middleware`) rather than explicit entity tagging with `trust_role`. No standalone taint analysis outside PR review. |
| 7 | **Resilience Scoring (NFR Drift)** | Phase 6 | **PARTIAL** (40%) | Growth | ast-grep rules exist: `resilience-missing-fetch`, `resilience-missing-axios` in `anti-patterns.yaml`. Pattern engine `semgrep-pattern-engine.ts` executes them. | Rules only detect absence of error handling, not presence of retry/timeout/circuit-breaker wrappers. No resilience scoring metric (`resilient_calls / total_external_calls`). Needs additional rules for timeout detection, retry wrapper detection. |
| 8 | **API Contract Breakage** | Phase 7 | **SHIPPED** (70%) | Growth | `lib/review/checks/contract-check.ts` (63 lines), uses blast radius to find affected API boundaries, integrated into PR review, severity scales with caller count | Detects that API routes are _affected_ but doesn't perform field-level schema diffing (no detection of field removal/type change in return types). Needs structural comparison of API response shapes. |
| 9 | **Infra-to-Code Disconnect** | Phase 5 + 7 | **SHIPPED** (85%) | Growth | `lib/review/checks/env-check.ts` (79 lines), scans diff hunks for `process.env.*`, reads `.env.example` for known vars, flags unknowns, integrated into PR review | Only checks `process.env.*` — doesn't detect new Prisma models, new Docker env requirements, or IaC resource additions. Limited to Node.js env var pattern. |
| 10 | **Mock Theater Detection** | Phase 6 | **PARTIAL** (30%) | Growth | Basic ast-grep rule `mock-theater` in `anti-patterns.yaml`: detects `vi.mock($$$ARGS)` | Only counts mock calls. No semantic coverage score (`unmocked_branches / total_branches`). No cross-reference with call graph complexity of target function. |
| 11 | **State Lifecycle Asymmetry** | Phase 6 | **SHIPPED** (80%) | Growth | ast-grep rules `lifecycle-interval` and `lifecycle-listener` in `anti-patterns.yaml`. Detects `setInterval` and `addEventListener` without cleanup. | Rules detect setup without cleanup in the same file, but don't verify cleanup in same scope (class, component). Could miss cases where cleanup is in a different method of the same class. |
| 12 | **Idempotency Risk Detection** | Phase 7 | **SHIPPED** (80%) | Growth | `lib/review/checks/idempotency-check.ts` (76 lines), graph traversal checks webhook/trigger handlers for idempotency patterns, integrated into PR review | Uses name-based regex matching (`idempoten|dedup|upsert|lock|mutex`) rather than graph traversal to idempotency-check nodes. May miss custom idempotency implementations with non-standard names. |
| 13 | **Concurrency Blindspots** | Phase 6 | **NOT STARTED** | Scale | Redis distributed locks exist for workspace sync, but no general concurrency blindspot detection for user code. | Requires new graph traversal: concurrent trigger → shared state mutation without transaction/lock. |
| 14 | **N+1 Query Detection** | Phase 6 | **SHIPPED** (90%) | Growth | ast-grep rules `n-plus-one-prisma` and `n-plus-one-supabase` in `anti-patterns.yaml`. Detect Prisma `findMany()` and Supabase `.select()` inside `for` loops. | Only detects `for` loops — misses `map`, `forEach`, `while`. Only covers Prisma and Supabase — misses raw SQL, Mongoose, TypeORM. |
| 15 | **Destructive Schema Drift** | Phase 6 | **SHIPPED** (70%) | Scale | ast-grep rules in `scale-patterns.yaml`: `destructive-column-drop` (SQL `DROP COLUMN`), `destructive-column-rename` (SQL `RENAME COLUMN`). | Only covers raw SQL. Doesn't detect Prisma schema changes (field removal, type coercion). Doesn't verify presence of corresponding safe migration script. |
| 16 | **PII Exfiltration / Telemetry Trap** | Phase 4 + 6 | **NOT STARTED** | Scale | Compliance tags mentioned in prompt builder but no taint analysis implementation. | Requires entity tagging (`Sensitive/PII`), sink tagging (`Untrusted`), and new graph traversal for unsanitized paths. |
| 17 | **Business Logic Invariants** | Phase 4 + 6 | **NOT STARTED** | Scale | No implementation found. | Requires taxonomy-driven rule triggering + invariant check pattern detection. |
| 18 | **Rate Limit Blindness** | Phase 6 | **SHIPPED** (70%) | Scale | ast-grep rule `rate-limit-loop-fetch` in `scale-patterns.yaml`: detects `fetch()` in `while` loop without backoff. | Only detects `fetch` in `while` loops. Misses `axios`, `got`, and other HTTP clients. Misses `for`/`map`/`forEach` loop patterns. |
| 19 | **Connection Pool Exhaustion** | Phase 6 | **SHIPPED** (90%) | Growth | ast-grep rules `connection-pool-prisma` and `connection-pool-redis` in `anti-patterns.yaml`. Detect `new PrismaClient()` and `new Redis()` inside functions. | Covers Prisma and Redis. Misses: `amqp.connect()`, `new MongoClient()`, `createPool()`. |
| 20 | **Dark Launch Violations** | Phase 6 | **SHIPPED** (60%) | Scale | ast-grep rule `dark-launch-route` in `scale-patterns.yaml`: detects route handlers without feature flag wrapper. | Rule logic not verified for correctness. May produce false positives on non-trunk-based repos. No org-level config to enable/disable. |
| 21 | **Toxic Supply Chain** | Phase 5 + 6 | **NOT STARTED** | Scale | `renovate.json` has `osvVulnerabilityAlerts: true` but no unerr-native supply chain analysis. | Requires new import diff analysis + OSV advisory DB integration. |
| 22 | **Silent Error Swallowing** | Phase 6 | **SHIPPED** (90%) | Growth | ast-grep rules `error-swallowing-empty` and `error-swallowing-null` in `anti-patterns.yaml`. Detect empty catch blocks and catch blocks returning null. | Doesn't detect `catch (e) { console.log("error") }` (logs string without error object). Should also check for catch blocks that only log but don't re-throw or report to structured logging. |
| 23 | **Zero-Downtime Migration Violations** | Phase 6 | **SHIPPED** (60%) | Scale | ast-grep rule `zero-downtime-alter` in `scale-patterns.yaml`: detects `ALTER TABLE ADD COLUMN DEFAULT`. | Only catches one pattern. Misses: `CREATE INDEX` without `CONCURRENTLY`, `ALTER COLUMN TYPE`, table renames. |
| 24 | **Cloud IAM Privilege Escalation** | Phase 6 | **NOT STARTED** | Scale | No implementation found. | Requires IaC file detection + wildcard policy ast-grep rules. |
| 25 | **API Backward Compatibility** | Phase 7 | **PARTIAL** (40%) | Scale | Contract check exists but only detects affected routes, not field-level schema changes. | Needs return type structural comparison (field removal, type change detection). |
| 26 | **Distributed Cache Desync** | Phase 6 | **NOT STARTED** | Scale | No implementation found. | Requires `CachedResource` entity tagging + graph traversal for missing invalidation. |
| 27 | **State Machine Orphaning** | Phase 5 + 1 | **PARTIAL** (30%) | Scale | `ts-exhaustive-switch` rule exists in `typescript-patterns.yaml` (default case detection). | Rule detects missing default case but doesn't detect new enum values without corresponding case additions. Needs reverse-dep traversal from enum/type changes. |
| 28 | **Data Residency Violations** | Phase 4 + 6 | **NOT STARTED** | Scale | No implementation found. | Enterprise-only. Requires entity/data tagging + cross-border flow detection. |
| 29 | **Ghost Migration Drift** | Phase 5.5 | **NOT STARTED** | Scale | No implementation found. | Requires Phase 5.5 prompt ledger + migration file tracking. |
| 30 | **Bounded Context Bleed** | Phase 4 + 6 | **PARTIAL** (50%) | Scale | `findCrossFeatureMutations()` method exists in `arango-graph-store.ts`. UI shows bounded context bleed section in `intelligence-view.tsx`. API route returns data. | Detection logic may return empty results (needs verification). No enforcement mechanism (only detection + display). No blocking in PR review pipeline. |
| 31 | **Event-Driven Blackholes** | Phase 6 + 1 | **NOT STARTED** | Scale | No implementation found. | Requires publish/subscribe topic matching + DLQ detection in subscriber catch blocks. |
| 32 | **Flaky Test Detection** | Phase 6 | **SHIPPED** (70%) | Scale | ast-grep rules `flaky-date-now` and `flaky-math-random` in `scale-patterns.yaml`. | Only detects `Date.now()` and `Math.random()`. Misses: `new Date()`, shared mutable state between tests, missing `afterEach` cleanup. |
| 33 | **Multi-Repo Contract Fracturing** | Phase 12 | **NOT STARTED** | Scale | No implementation found. | Requires Phase 12 multi-repo infrastructure. Blocked dependency. |
| 34 | **Zombie Infrastructure** | Phase 6 + 1 | **NOT STARTED** | Scale | No implementation found. | Requires IaC file indexing + zero-reference graph check. |
| 35 | **Agent-on-Agent Collision** | Phase 12 | **NOT STARTED** | Scale | No implementation found. | Requires Phase 12 multiplayer infrastructure. Blocked dependency. |
| 36 | **Runaway Context Bankruptcy** | Phase 8 | **PARTIAL** (30%) | Scale | `lib/mcp/security/circuit-breaker.ts` exists for ledger entries. Phase 8 tracks LLM costs. | Circuit breaker exists but doom-loop detection (cost velocity anomaly) not implemented. No automatic agent pause on runaway cost. |
| 37 | **Idiomatic Drift** | Phase 9 | **PARTIAL** (20%) | Scale | Exemplar keys exist in pattern storage. Phase 9 snippet library planned. | Structural similarity comparison not implemented. Requires ast-grep similarity check against pinned exemplars. Blocked on Phase 9. |
| 38 | **Trade Secret Exfiltration** | Phase 10b | **NOT STARTED** | Scale | No implementation found. | Requires Phase 10b local proxy + IP-restricted zone tagging. Blocked dependency. |

### Verified Status Summary

| Status | Count | % | Details |
|---|---|---|---|
| **SHIPPED** (≥60% complete) | 18 | 47% | Core logic works, may need enhancement |
| **PARTIAL** (20-59% complete) | 9 | 24% | Infrastructure exists, key logic gaps |
| **NOT STARTED** (0%) | 11 | 29% | No implementation found |

### ast-grep Rules Inventory (23 rules shipped)

| Category | Rule File | Rules | Status |
|---|---|---|---|
| TypeScript patterns | `typescript-patterns.yaml` | 7 rules: no-any, no-console-log, async-no-floating, error-catch-unknown, no-enum, import-type, exhaustive-switch | SHIPPED |
| Anti-patterns | `anti-patterns.yaml` | 10 rules: resilience-fetch, resilience-axios, error-swallowing-empty, error-swallowing-null, n-plus-one-prisma, n-plus-one-supabase, connection-pool-prisma, connection-pool-redis, mock-theater, lifecycle-interval, lifecycle-listener | SHIPPED |
| Scale patterns | `scale-patterns.yaml` | 6 rules: destructive-column-drop, destructive-column-rename, rate-limit-loop-fetch, dark-launch-route, zero-downtime-alter, flaky-date-now, flaky-math-random | SHIPPED |

### Health Report Analyses (13 risk types shipped)

Low confidence justifications, untested VERTICAL entities, single-entity features, high UTILITY ratio, dead code, architectural violations (mixed pattern), low quality justifications, high fan-in, high fan-out, circular dependencies, taxonomy anomalies, confidence gap, missing justifications.

---

## 1.3 Launch Tier — Ship-Critical Features

These features differentiate unerr at launch. The core backend logic is **already shipped** — the remaining work is primarily **UI polish, wiring gaps, and enhancement**.

### Feature L1: Blast Radius Visualization

**What exists:** `lib/review/blast-radius.ts` implements N-hop ArangoDB traversal from changed entities to API/UI boundary nodes. `analyze_impact` MCP tool exists. PR review integration (Phase 7) uses it.

**What's missing:** A dashboard visualization showing the interactive dependency tree before an agent commits a change.

**User story:** _"Before I merge this AI-generated PR, unerr shows me that 14 functions across 3 feature areas will be affected."_

**Implementation:**
- **Backend:** Expose `buildBlastRadiusSummary()` via a new API route `/api/repos/[repoId]/impact?entityId=...`
- **Frontend:** Interactive dependency tree component (D3 force graph or Dagre layout) on the entity detail page and PR review page
- **MCP enrichment:** Include blast radius count in `get_function` tool response: `"impactRadius": 14`

**Existing code references:**

| File | Status | What It Does |
|---|---|---|
| `lib/review/blast-radius.ts` | SHIPPED | N-hop traversal, boundary detection |
| `lib/mcp/tools/index.ts` (`analyze_impact`) | SHIPPED | MCP tool for agents |
| Dashboard UI | NOT BUILT | Needs visualization component |

---

### Feature L2: Architectural Drift Detection & Justification Timeline

**What exists:** `lib/justification/staleness-checker.ts` computes body hashes and detects when entity content changes. Bi-temporal justification model (`valid_from`/`valid_to`) tracks history. Phase 5 drift alerts are designed but not fully wired.

**What's missing:** Cosine distance comparison between old and new justification embeddings to detect _semantic_ drift (not just code change). Timeline UI showing justification history.

**User story:** _"unerr flags that my `calculateInvoice()` function has drifted from 'Computes line item totals' to 'Computes totals AND sends email notifications' — a mixed-responsibility code smell introduced by the AI agent."_

**Implementation:**
- **Backend:** After cascade re-justification, compute cosine distance between old and new justification embeddings. If distance > 0.3, create a `DriftAlert` document in ArangoDB
- **Frontend:** "Architectural Drift" panel on the Blueprint dashboard. Timeline comparing original vs current justification. "Accept New Intent" / "Flag Violation" buttons
- **Data model:** `drift_alerts` ArangoDB collection: `{ entity_id, old_purpose, new_purpose, cosine_distance, detected_at, status: "pending" | "accepted" | "flagged" }`

**Existing code references:**

| File | Status | What It Does |
|---|---|---|
| `lib/justification/staleness-checker.ts` | SHIPPED | Content-hash change detection |
| `lib/justification/context-propagator.ts` | SHIPPED | 3-pass bi-directional propagation |
| Phase 5 drift alert design | DESIGNED | Cosine distance threshold (0.3), git blame for caller authors |
| Drift UI | NOT BUILT | Needs timeline component |

---

### Feature L3: Auto-Generated ADRs & Domain Ontology Display

**What exists:** `lib/temporal/activities/ontology.ts` extracts and refines domain terms with LLM. ADR synthesizer generates Architecture Decision Records per feature. Domain vocabulary stored in ArangoDB.

**What's missing:** An interactive "Brain Trust" view that surfaces this knowledge as a navigable knowledge base, not a flat list.

**User story:** _"When I click 'Authentication' in my Blueprint, I see the auto-generated ADRs, the ubiquitous language terms, and the core design patterns — and I can see that my AI agent has this context injected into its prompts."_

**Implementation:**
- **Frontend:** Extend Blueprint dashboard with "Knowledge Base" panel per feature area. Show: ADRs, domain terms, enforced patterns, agent context injection indicator
- **Backend:** API route to fetch ADRs + ontology + patterns per `feature_area`

---

### Feature L4: Dead Code & Pattern Alignment Report

**What exists:** `lib/justification/dead-code-detector.ts` identifies zero-inbound-reference entities. `detect-patterns` workflow mines structural patterns via community detection. Health report generated.

**What's missing:** A dedicated "Cruft & Alignment" view replacing generic health metrics.

**User story:** _"unerr shows me all functions with 0 inbound calls touched in the last 30 days, with a 1-click 'Ask Agent to Clean Up' button. It also shows where my code diverges from its own mined patterns."_

**Implementation:**
- **Frontend:** Replace generic "Health Score" widget with:
  - **Cruft View:** Dead code list filtered by recent git activity
  - **Alignment View:** Pattern deviations (e.g., "This endpoint handles errors differently than the other 45 endpoints")
- **Backend:** Combine `detectDeadCode()` output with `index_events` timestamps for recency filtering

**Existing code references:**

| File | Status | What It Does |
|---|---|---|
| `lib/justification/dead-code-detector.ts` | SHIPPED | Graph-based dead code detection |
| `lib/temporal/activities/pattern-detection.ts` | SHIPPED | ast-grep scan + community detection |
| `lib/temporal/activities/pattern-mining.ts` | SHIPPED | Louvain community detection |
| "Cruft & Alignment" UI | NOT BUILT | Needs dashboard component |

---

## 1.4 Growth Tier — Adoption & Retention Features

These features drive adoption after launch. They build on the rules engine (Phase 6) and primarily require **authoring specific ast-grep rules** and **wiring graph traversals** into the PR review pipeline.

### Feature G1: Trust Boundary / Taint Analysis

**Problem:** AI agents bypass authorization middleware by routing data directly from API endpoints to database writes.

**Capture mechanism:**
- Tag entities via Phase 4 taxonomy: `Source` (API route, UI input), `Sink` (DB write, file write), `Validator` (auth middleware, input sanitizer)
- AQL traversal: find paths from Source → Sink that bypass all Validator nodes
- Integrate into Phase 7 PR review as a blocking check

**New infrastructure required:**
- Entity tagging schema extension: `trust_role: "source" | "sink" | "validator" | null`
- AQL parameterized query for path analysis
- Phase 6 rule: `trust-boundary-violation`

**Status:** NEW — requires entity tagging + graph traversal query

---

### Feature G2: Resilience Scoring

**Problem:** AI agents write HTTP calls to third-party APIs without retry, timeout, or circuit-breaker wrappers.

**Capture mechanism:**
- Phase 4 taxonomy classifies entities as `External Integration` or `Data Fetcher`
- Phase 6 ast-grep rule checks for presence of resilience wrappers (`withRetry`, `Timeout`, `try/catch`) around external calls
- Score: `resilient_calls / total_external_calls`

**New infrastructure required:** ast-grep rule catalog entries only — rules engine already exists.

**Status:** PLANNED — rules need authoring

---

### Feature G3: Silent Error Swallowing

**Problem:** AI agents write `catch (e) { return null }` to suppress linter warnings, blinding production observability.

**Capture mechanism:**
- Phase 6 ast-grep rule: detect `CatchClause` blocks that neither re-throw, pass raw error to a logging sink, nor increment a failure metric
- Surface in PR review and IDE panel

**New infrastructure required:** ast-grep rule only.

**Status:** PLANNED — rule needs authoring

---

### Feature G4: N+1 Query Detection

**Problem:** AI agents write database calls inside loop bodies, causing performance disasters at scale.

**Capture mechanism:**
- Phase 6 ast-grep rule: detect iteration constructs (`for`, `map`, `forEach`, `while`) containing SCIP-resolved calls to database client nodes
- Surface as "N+1 Performance Anti-Pattern" in PR review

**New infrastructure required:** ast-grep rule + SCIP cross-reference.

**Status:** PLANNED — rule needs authoring

---

### Feature G5: Connection Pool Exhaustion

**Problem:** AI agents instantiate heavyweight infrastructure clients inside request handlers instead of module scope.

**Capture mechanism:**
- Phase 6 ast-grep rule: detect `new PrismaClient()`, `amqp.connect()`, `new Redis()` inside exported function or route handler scope (not module-level)

**New infrastructure required:** ast-grep rule only.

**Status:** PLANNED — rule needs authoring

---

### Feature G6: Mock Theater Detection

**Problem:** AI-generated tests achieve 100% coverage by mocking everything, testing nothing.

**Capture mechanism:**
- Phase 6 ast-grep rule: count `jest.mock()`/`vi.mock()` calls in test files
- Cross-reference with call graph complexity of the target function
- Compute "Semantic Coverage" score: `(unmocked_branches / total_branches)`

**New infrastructure required:** ast-grep rule + graph cross-reference query.

**Status:** PLANNED — rule needs authoring

---

### Feature G7: State Lifecycle Asymmetry

**Problem:** AI agents write `subscribe`/`addListener` without matching cleanup, causing memory leaks.

**Capture mechanism:**
- Phase 6 ast-grep rule: detect lifecycle setup calls (`addListener`, `subscribe`, `setInterval`) within a scope boundary (class, component, function). Check for matching teardown in same scope (`removeListener`, `unsubscribe`, `clearInterval`)

**New infrastructure required:** ast-grep rule only.

**Status:** PLANNED — rule needs authoring

---

### Feature G8: Idempotency Risk Detection

**Problem:** Webhook handlers mutate state without checking for duplicate deliveries.

**Capture mechanism:**
- Phase 4 taxonomy identifies `Webhook Handler` / `External Trigger` entities
- AQL traversal from trigger → mutation. Check if path contains an idempotency check node (Redis lock, DB read-before-write, idempotency key header extraction)
- Surface as "Idempotency Risk" in PR review

**New infrastructure required:** Taxonomy-driven traversal query.

**Status:** PLANNED — traversal query needed

---

### Feature G9: Infra-to-Code Disconnect

**Problem:** AI adds `process.env.NEW_KEY` without updating `.env.example` or deployment manifests.

**Capture mechanism:**
- Phase 5 incremental indexing detects new `ExternalDependency` nodes (environment variable reads)
- Diff reconciliation: check if corresponding update exists in `.env`, `schema.prisma`, `.github/workflows`
- Surface as "Deployment Blocker" gate

**New infrastructure required:** New diff reconciliation logic in incremental indexing activity.

**Status:** NEW — requires new reconciliation query

---

### Feature G10: API Contract Breakage Detection

**Problem:** Internal struct changes silently alter public API response shapes, breaking mobile clients.

**Capture mechanism:**
- Phase 7 blast radius already traverses to API boundaries
- Extension: field-level diffing on entities classified as `Public API Endpoint` or `GraphQL Resolver`
- If return type schema changes (field removed, type changed), flag as "Contract Breach"

**New infrastructure required:** Schema shape comparison for API return types.

**Status:** PARTIAL — blast radius exists, field-level diffing needed

---

## 1.5 Scale Tier — Enterprise Governance Features

These features serve enterprise customers and large-scale deployments. They require the most new infrastructure and often depend on features from other phases not yet shipped.

### Grouped by Domain

#### Security & Compliance

| # | Feature | Dependency | Notes |
|---|---------|-----------|-------|
| 16 | **PII Exfiltration (Telemetry Trap)** | Phase 4 (entity tagging) + Phase 6 (taint traversal) | Tag data models as `Sensitive/PII`, logging sinks as `Untrusted`. Graph traversal for unsanitized paths. |
| 24 | **Cloud IAM Privilege Escalation** | Phase 6 (IaC rules) | ast-grep for wildcard IAM policies. Cross-ref with actual API calls. |
| 28 | **Data Residency / Geofencing** | Phase 4 (entity tagging) + Phase 6 | Tag data as `Regulated-EU`. Detect cross-border flows to unwhitelisted external deps. Enterprise-only. |
| 21 | **Toxic Supply Chain** | Phase 5 (incremental diff) | New imports cross-referenced with `package.json` delta + OSV advisory DB. |
| 38 | **Trade Secret Exfiltration** | Phase 10b (local proxy) | Phase 10b proxy intercepts reads on IP-restricted zones. Requires zone tagging. |

#### Data & State Safety

| # | Feature | Dependency | Notes |
|---|---------|-----------|-------|
| 15 | **Destructive Schema Drift** | Phase 6 (migration rules) | ast-grep rules for column drops, type coercions, missing safe migration scripts. |
| 26 | **Distributed Cache Desync** | Phase 6 + Phase 4 (taxonomy) | Detect DB writes on `CachedResource` entities without cache invalidation. |
| 27 | **State Machine Orphaning** | Phase 1 (graph) + Phase 5 (diff) | Detect enum additions without updating downstream exhaustive switch/match consumers. |
| 29 | **Ghost Migration Drift** | Phase 5.5 (prompt ledger) | Detect modified/deleted migration files after local execution. |

#### Production Reliability

| # | Feature | Dependency | Notes |
|---|---------|-----------|-------|
| 13 | **Concurrency Blindspots** | Phase 6 + Phase 4 | Shared-state mutations in concurrent paths without transaction/lock wrappers. |
| 18 | **Rate Limit Blindness** | Phase 6 | External API call inside unbounded loop without backoff strategy. |
| 20 | **Dark Launch Violations** | Phase 6 | New public routes without feature flag wrapper. Trunk-based development enforcement. |
| 23 | **Zero-Downtime Migration Violations** | Phase 6 | Blocking `ALTER TABLE` patterns (column+default, index without `CONCURRENTLY`). |
| 32 | **Flaky Test Detection** | Phase 6 | `Date.now()`/`Math.random()` in tests without mocked timers. |

#### Architecture Governance

| # | Feature | Dependency | Notes |
|---|---------|-----------|-------|
| 17 | **Business Logic Invariants** | Phase 4 + Phase 6 | Enforce validation boundaries before financial/inventory mutations. |
| 30 | **Bounded Context Bleed** | Phase 4 (taxonomy) + Phase 6 | Direct DB mutations across feature-area boundaries. |
| 31 | **Event-Driven Blackholes** | Phase 6 + Phase 1 | Published event topics without matching subscribers or without DLQ. |
| 34 | **Zombie Infrastructure** | Phase 6 + Phase 1 | IaC CloudResource nodes with zero application code references. |

#### Multi-Agent & Multi-Repo

| # | Feature | Dependency | Notes |
|---|---------|-----------|-------|
| 33 | **Multi-Repo Contract Fracturing** | Phase 12 | Cross-org-graph traversal when public API schema changes. |
| 35 | **Agent-on-Agent Collision** | Phase 12 | Ephemeral entity activity records with TTL. Real-time conflict prevention. |
| 36 | **Context Bankruptcy (Doom Loop)** | Phase 8 | Circuit breaker on LLM cost velocity when agent enters fix-fail loop. |
| 37 | **Idiomatic Drift** | Phase 9 | Code snippet library comparison via ast-grep structural similarity. |

#### Developer Experience

| # | Feature | Dependency | Notes |
|---|---------|-----------|-------|
| 5 | **Cognitive Debt Metrics** | Phase 5.5 | Rewind-to-commit ratio per feature area from prompt ledger. |
| 25 | **API Backward Compatibility** | Phase 7 | Extends blast radius with field-level schema diffing for public boundaries. |

---

## 1.6 Reliability & Resilience

### Graceful Degradation

Every advanced intelligence check follows the pattern established in Phase 6 and Phase 7:

1. **Non-blocking by default:** Intelligence checks run asynchronously. If a check times out or errors, the pipeline continues — the check result is simply absent from the report.
2. **Independent timeouts:** Each graph traversal and ast-grep scan has its own timeout (default: 5s for traversals, 10s for ast-grep scans).
3. **Severity levels:** Each check produces a severity (`info`, `warning`, `error`, `critical`). Only `critical` checks block PR merges (configurable per org).

### Error Budget

Advanced intelligence checks operate under a cost ceiling to prevent runaway LLM costs:

| Check Type | Cost Model | Budget |
|---|---|---|
| Graph traversal (AQL) | CPU only | No cost — bounded by `maxHops` |
| ast-grep scan | CPU only | No cost — bounded by `maxFiles` |
| LLM synthesis (e.g., ADR generation) | Token-based | Governed by Phase 8 billing limits |

---

## 1.7 Performance Considerations

### Incremental Check Execution

Not all 38 checks need to run on every push. The system uses the **incremental indexing diff** (Phase 5) to determine which checks are relevant:

| Trigger | Relevant Checks |
|---|---|
| New/modified function | Blast radius, lifecycle asymmetry, N+1, idempotency, trust boundary |
| New/modified test file | Mock theater, flaky test, semantic coverage |
| New/modified migration file | Destructive schema drift, zero-downtime migration, ghost migration |
| New/modified IaC file | IAM privilege, zombie infrastructure |
| New package dependency | Toxic supply chain |
| Schema/type change | State machine orphaning, API contract breakage, cache desync |

### Caching Strategy

- **Graph traversal results:** Cache blast radius results per `(entity_id, graph_version)` in Redis with 15-minute TTL
- **ast-grep results:** Cache per `(file_hash, rule_id)` — invalidated only when file content changes
- **Pattern alignment scores:** Computed during `detect-patterns` workflow, stored in ArangoDB `patterns` collection — no re-computation needed per check

---

# Part 2: Implementation & Tracing Tracker

## 2.1 Launch Tier Tracker

### L1: Blast Radius / Impact Page

- [x] **ADV-L1a: Blast radius API route** — S
  - `GET /api/repos/[repoId]/impact?entityId=X` → single entity blast radius via `buildBlastRadiusSummary()`
  - `GET /api/repos/[repoId]/impact` (no param) → top 20 most-called entities by caller count
  - Uses `withAuth`, `getActiveOrgId`, `getContainer()` patterns
  - **Files:** `app/api/repos/[repoId]/impact/route.ts`

- [x] **ADV-L1b: Blast radius dashboard page** — S
  - Server component with auth check, Suspense wrapper, delegates to `<ImpactView>`
  - **Files:** `app/(dashboard)/repos/[repoId]/impact/page.tsx`

- [x] **ADV-L1c: Blast radius visualization component** — M
  - Two-panel layout: left = top entities table (name, kind, file, callerCount), right = blast radius tree on selection
  - Boundary nodes color-coded by kind: api_route (cyan), component (purple), webhook_handler (amber), cron_job (red)
  - Empty state when no entity selected
  - **Files:** `components/intelligence/impact-view.tsx`

- [ ] **ADV-L1d: Blast radius count in `get_function` MCP tool** — S
  - Enrich `get_function` response with `impactRadius` count
  - **Files:** `lib/mcp/tools/structural.ts`

### L2: Architectural Drift Timeline

- [x] **ADV-L2a: Drift scores API route** — S
  - `GET /api/repos/[repoId]/drift?category=intent_drift&limit=50` → drift scores enriched with entity name/kind/filePath
  - Summary: counts per category (stable, cosmetic, refactor, intent_drift)
  - **Files:** `app/api/repos/[repoId]/drift/route.ts`

- [x] **ADV-L2b: Drift timeline dashboard page** — S
  - Server component with auth check, Suspense wrapper, delegates to `<DriftTimelineView>`
  - **Files:** `app/(dashboard)/repos/[repoId]/drift/page.tsx`

- [x] **ADV-L2c: Drift timeline UI component** — M
  - Top: 4 summary stat cards (one per category with count, clickable filter)
  - Timeline list: entity name + kind badge, file path, category badge (emerald/blue/amber/red), embedding similarity progress bar, detected_at
  - Empty state when no drift events
  - **Files:** `components/intelligence/drift-timeline-view.tsx`

### L3: ADRs & Ontology Display

> **ALREADY COMPLETE** from the Post-Onboarding Wow Experience implementation. ADR browser page, Glossary page, and their APIs already exist. Skipped.

### L4: Code Intelligence / Cruft & Alignment

- [x] **ADV-L4a: Intelligence API route** — M
  - `GET /api/repos/[repoId]/intelligence` → aggregates cruft (dead_code risks from health report), alignment (patterns with adherence rates), and bounded context bleed
  - **Files:** `app/api/repos/[repoId]/intelligence/route.ts`

- [x] **ADV-L4b: Intelligence dashboard page** — S
  - Server component with auth check, Suspense wrapper, delegates to `<IntelligenceView>`
  - **Files:** `app/(dashboard)/repos/[repoId]/intelligence/page.tsx`

- [x] **ADV-L4c: Intelligence visualization component** — M
  - Two-panel grid: Cruft panel (dead code grouped by risk, severity badge, entity list) + Alignment panel (pattern adherence table, sorted by lowest adherence, progress bars)
  - Bounded context bleed section when data available
  - **Files:** `components/intelligence/intelligence-view.tsx`

### Navigation

- [x] **ADV-NAV-01: Update repo-tabs with new tabs** — S
  - Added Impact (Zap icon), Drift (TrendingDown icon), Intelligence (Brain icon) tabs after Health tab
  - **Files:** `components/repo/repo-tabs.tsx`

---

## 2.2 Growth Tier Tracker

### ast-grep Rules (Phase 6 Extensions)

- [x] **ADV-G2a: `resilience-missing-fetch`** — S
  - `fetch()` without try-catch error handling
  - **Files:** `lib/patterns/catalog/anti-patterns.yaml`

- [x] **ADV-G2b: `resilience-missing-axios`** — S
  - `axios.get/post()` without try-catch error handling
  - **Files:** `lib/patterns/catalog/anti-patterns.yaml`

- [x] **ADV-G3a: `error-swallowing-empty`** — S
  - `catch (e) {}` empty body
  - **Files:** `lib/patterns/catalog/anti-patterns.yaml`

- [x] **ADV-G3b: `error-swallowing-null`** — S
  - `catch (e) { return null }`
  - **Files:** `lib/patterns/catalog/anti-patterns.yaml`

- [x] **ADV-G4a: `n-plus-one-prisma`** — S
  - `prisma.findMany()` inside for/forEach/map loop
  - **Files:** `lib/patterns/catalog/anti-patterns.yaml`

- [x] **ADV-G4b: `n-plus-one-supabase`** — S
  - `supabase.from().select()` inside loop
  - **Files:** `lib/patterns/catalog/anti-patterns.yaml`

- [x] **ADV-G5a: `connection-pool-prisma`** — S
  - `new PrismaClient()` not at module scope
  - **Files:** `lib/patterns/catalog/anti-patterns.yaml`

- [x] **ADV-G5b: `connection-pool-redis`** — S
  - `new Redis()` not at module scope
  - **Files:** `lib/patterns/catalog/anti-patterns.yaml`

- [x] **ADV-G6: `mock-theater`** — S
  - `vi.mock()` / `jest.mock()` calls (flag >3 per file)
  - **Files:** `lib/patterns/catalog/anti-patterns.yaml`

- [x] **ADV-G7a: `lifecycle-interval`** — S
  - `setInterval()` without matching `clearInterval`
  - **Files:** `lib/patterns/catalog/anti-patterns.yaml`

- [x] **ADV-G7b: `lifecycle-listener`** — S
  - `addEventListener()` without matching `removeEventListener`
  - **Files:** `lib/patterns/catalog/anti-patterns.yaml`

### PR Review Checks (Graph Traversal + New Logic)

- [x] **ADV-G1: Trust boundary check** — M
  - Detects source→sink paths bypassing validation/auth middleware
  - Uses `getCallersOf`/`getCalleesOf` traversal, checks for auth patterns on path, validates justification feature_tag
  - Integrated into PR review pipeline as blocking (`error` severity)
  - **Files:** `lib/review/checks/trust-boundary-check.ts`

- [x] **ADV-G8: Idempotency risk check** — M
  - Detects webhook/trigger handlers that mutate state without idempotency guards
  - Matches trigger handlers by name/file patterns, traverses callees for mutations, checks for dedup/upsert/lock patterns
  - Integrated into PR review pipeline as warning
  - **Files:** `lib/review/checks/idempotency-check.ts`

- [x] **ADV-G9: Env var disconnect check** — S
  - Scans diff hunks for new `process.env.SOMETHING` references not in `.env.example`
  - Pure file scanning, no graph queries needed
  - Integrated into PR review pipeline as warning
  - **Files:** `lib/review/checks/env-check.ts`

- [x] **ADV-G10: API contract breakage check** — M
  - Uses existing blast radius to detect API boundary impact
  - Flags when blast radius boundaries include `api_route` or `webhook_handler` kinds
  - Severity scales with caller count
  - Integrated into PR review pipeline as warning
  - **Files:** `lib/review/checks/contract-check.ts`

### PR Review Pipeline Wiring

- [x] **ADV-PIPE-01: New finding types in `ports/types.ts`** — S
  - Added: `TrustBoundaryFinding`, `EnvFinding`, `ContractFinding`, `IdempotencyFinding`, `BoundedContextFinding`
  - Extended `ReviewConfig.checksEnabled` with: `trustBoundary`, `idempotency`, `env`, `contract`
  - Extended `PrReviewCommentRecord.checkType` union with new check types
  - **Files:** `lib/ports/types.ts`

- [x] **ADV-PIPE-02: Wire 4 new checks into `runChecks()` activity** — M
  - Added imports for all 4 new check functions
  - Added to `Promise.all` with `.catch(() => [])` wrappers for graceful degradation
  - Extended return type with `trustBoundary`, `env`, `contract`, `idempotency`
  - Passes `blastRadius` to checks for contract check. Note: `fetchDiff` and `runChecks` have since been combined into `fetchDiffAndRunChecks` to avoid serializing entity/diff arrays through Temporal.
  - **Files:** `lib/temporal/activities/review.ts`

- [x] **ADV-PIPE-03: Format new finding types in comment builder** — S
  - Added `formatTrustBoundaryComment()`, `formatEnvComment()`, `formatContractComment()`, `formatIdempotencyComment()`
  - Extended `buildReviewResult()` signature with 4 new finding array params (defaulting to `[]`)
  - Extended `ReviewComment.checkType` union
  - **Files:** `lib/review/comment-builder.ts`

- [x] **ADV-PIPE-04: Annotate new finding types in check run builder** — S
  - Added annotation mapping for each new finding type with appropriate severity levels
  - Added markdown table sections to `buildSummaryMarkdown()` for each new finding category
  - Extended `buildCheckRunOutput()` signature with 4 new finding array params
  - **Files:** `lib/review/check-run-builder.ts`

- [x] **ADV-PIPE-05: Update workflow to pass new findings** — S
  - Updated empty findings object in short-circuit path to include new finding arrays
  - Passes `blastRadius` to `runChecks` activity for contract check usage
  - **Files:** `lib/temporal/workflows/review-pr.ts`

---

## 2.3 Scale Tier Tracker

### ast-grep Rules

- [x] **ADV-S15: `destructive-column-drop`** — S
  - `DROP COLUMN` in SQL migrations
  - **Files:** `lib/patterns/catalog/scale-patterns.yaml`

- [x] **ADV-S15b: `destructive-column-rename`** — S
  - `RENAME COLUMN` in SQL migrations
  - **Files:** `lib/patterns/catalog/scale-patterns.yaml`

- [x] **ADV-S18: `rate-limit-loop-fetch`** — S
  - `fetch()` inside while loop without backoff
  - **Files:** `lib/patterns/catalog/scale-patterns.yaml`

- [x] **ADV-S20: `dark-launch-route`** — S
  - Exported route handler without feature flag
  - **Files:** `lib/patterns/catalog/scale-patterns.yaml`

- [x] **ADV-S23: `zero-downtime-alter`** — S
  - `ALTER TABLE ADD COLUMN DEFAULT` without `CONCURRENTLY`
  - **Files:** `lib/patterns/catalog/scale-patterns.yaml`

- [x] **ADV-S32a: `flaky-date-now`** — S
  - `Date.now()` in test files without fake timers
  - **Files:** `lib/patterns/catalog/scale-patterns.yaml`

- [x] **ADV-S32b: `flaky-math-random`** — S
  - `Math.random()` in test files
  - **Files:** `lib/patterns/catalog/scale-patterns.yaml`

### Graph Intelligence

- [x] **ADV-S30: Bounded context bleed detection** — M
  - `findCrossFeatureMutations()` added to `IGraphStore` interface
  - AQL implementation: joins justifications by feature_tag, finds cross-feature DB mutation calls
  - In-memory fake returns `[]`
  - Exposed via intelligence API route
  - **Files:** `lib/ports/graph-store.ts`, `lib/adapters/arango-graph-store.ts`, `lib/di/fakes.ts`

### Not Yet Implemented

| Domain | Features | Dependency Phase | Status |
|--------|----------|-----------------|--------|
| Security | PII exfiltration (#16), IAM drift (#24), data residency (#28), supply chain (#21), trade secret (#38) | Phase 6 + 10b | ☐ All TODO |
| Data Safety | Cache desync (#26), state machine orphaning (#27), ghost migration (#29) | Phase 6 + 5.5 | ☐ All TODO |
| Production | Concurrency (#13) | Phase 6 + 4 | ☐ TODO |
| Architecture | Business logic invariants (#17), event blackholes (#31), zombie infra (#34) | Phase 4 + 6 | ☐ All TODO |
| Multi-Agent | Multi-repo contracts (#33), agent collision (#35), context bankruptcy (#36), idiomatic drift (#37) | Phase 8 + 9 + 12 | ☐ All TODO |
| DevEx | Cognitive debt (#5), API backward compatibility (#25) | Phase 5.5 + 7 | ☐ All TODO |

---

## Appendix: Feature-to-Phase Dependency Matrix

```
Feature              Ph.1  Ph.2  Ph.3  Ph.4  Ph.5  Ph.5.5  Ph.6  Ph.7  Ph.8  Ph.9  Ph.10  Ph.12
─────────────────    ────  ────  ────  ────  ────  ──────  ────  ────  ────  ────  ─────  ─────
Blast Radius          ●                             ●               ●
Arch. Drift                             ●     ●
ADRs & Ontology                         ●
Dead Code + Patterns  ●                 ●                   ●
Trust Boundary        ●                 ●                   ●
Resilience                              ●                   ●
Error Swallowing                                            ●
N+1 Query                                                   ●
Connection Pool                                             ●
Mock Theater                                                ●
Lifecycle Asymmetry                                         ●
Idempotency           ●                 ●                   ●
Infra Disconnect                              ●             ●
Contract Breach       ●                                     ●     ●
PII Exfiltration      ●                 ●                   ●
Schema Drift                                  ●             ●
Cache Desync                            ●                   ●
Concurrency           ●                 ●                   ●
Supply Chain                                  ●             ●
Agent Collision                                                                          ●
Context Bankruptcy                                                      ●
Cognitive Debt                                       ●
Idiomatic Drift                                                               ●
Trade Secret                                                                     ●

● = depends on this phase
```
