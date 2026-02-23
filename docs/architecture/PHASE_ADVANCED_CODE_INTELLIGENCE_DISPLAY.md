# Phase ADV — Advanced Code Intelligence & AI Guardrails: Deep Dive & Implementation Tracker

> **Phase Feature Statement:** _"kap10 catches the mistakes AI agents make that humans can't see — blast radius before merging, architectural drift, security taint paths, and production-killing anti-patterns. My dashboard is a predictive control room, not a post-mortem."_
>
> **Source:** Internal product vision — cross-cutting phase that extends [Phase 4](./PHASE_4_BUSINESS_JUSTIFICATION_AND_TAXONOMY.md) (justification), [Phase 6](./PHASE_6_PATTERN_ENFORCEMENT_AND_RULES_ENGINE.md) (rules engine), and [Phase 7](./PHASE_7_PR_REVIEW_INTEGRATION.md) (PR review)
>
> **Prerequisites:** [Phase 1](./PHASE_1_GITHUB_CONNECT_AND_INDEXING.md) (entities + call graph in ArangoDB), [Phase 4](./PHASE_4_BUSINESS_JUSTIFICATION_AND_TAXONOMY.md) (justifications, taxonomy, feature areas), [Phase 5](./PHASE_5_INCREMENTAL_INDEXING_AND_GITHUB_WEBHOOKS.md) (incremental indexing, AST diffing, drift alerts), [Phase 6](./PHASE_6_PATTERN_ENFORCEMENT_AND_RULES_ENGINE.md) (ast-grep rules engine, pattern enforcement)
>
> **Database convention:** All kap10 Supabase tables use PostgreSQL schema `kap10`. ArangoDB collections are org-scoped (`org_{orgId}/`). See [VERTICAL_SLICING_PLAN.md § Storage & Infrastructure Split](./VERTICAL_SLICING_PLAN.md#storage--infrastructure-split).

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

This phase defines a collection of **advanced code intelligence features** that surface the proprietary graph and temporal data already captured by Phases 1–7. The goal is to shift the kap10 dashboard from a _post-mortem analytics tool_ into a _predictive control room_ for AI-generated code.

**Strategic narrative:** Code generation is becoming a commodity (Cursor, Copilot, Devin). The true bottleneck is **governing the consequences of the code**. kap10 is the immune system for AI-generated code — it proves that AI output is not just functional, but structurally sound, architecturally aligned, and production-safe.

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

| # | Feature | Parent Phase | Status | Tier | Notes |
|---|---------|-------------|--------|------|-------|
| 1 | **Blast Radius Visualization** | Phase 7 | **SHIPPED** | Launch | `blast-radius.ts` — N-hop traversal to API/UI boundaries. `analyze_impact` MCP tool exists. Needs dashboard visualization. |
| 2 | **Architectural Drift Detection** | Phase 5 | **PARTIAL** | Launch | Drift alerts designed in Phase 5 docs. `staleness-checker.ts` detects body-hash changes. Cosine distance comparison between old/new justification embeddings not yet wired. |
| 3 | **Auto-Generated ADRs & Ontology Display** | Phase 4 | **SHIPPED** | Launch | `adr-synthesizer.ts` generates ADRs. `discover-ontology.ts` extracts domain vocabulary. Needs "Brain Trust" UI view. |
| 4 | **Dead Code & Pattern Alignment** | Phase 4 + 6 | **SHIPPED** | Launch | `dead-code-detector.ts` with graph analysis. `detect-patterns` workflow runs ast-grep. Health report exists. Needs "Cruft & Alignment" UI view. |
| 5 | **Cognitive Debt (Rewind-to-Commit Ratio)** | Phase 5.5 | **PLANNED** | Growth | Requires prompt ledger + rewind tracking from Phase 5.5. |
| 6 | **Trust Boundary / Taint Analysis** | Phase 1 + 6 | **NEW** | Growth | Graph traversal from Source→Sink checking for auth/validator nodes. Requires new AQL traversal queries + entity tagging (`Source`, `Sink`, `Validator`). |
| 7 | **Resilience Scoring (NFR Drift)** | Phase 6 | **PLANNED** | Growth | ast-grep rules for retry/timeout/circuit-breaker wrappers on external calls. Rules engine exists; specific resilience rules need authoring. |
| 8 | **API Contract Breakage** | Phase 7 | **PARTIAL** | Growth | Blast radius traversal exists. Missing: schema shape comparison (detecting field removal/type change on public API return types). |
| 9 | **Infra-to-Code Disconnect** | Phase 5 + 6 | **NEW** | Growth | Detect new `process.env.*` reads without corresponding `.env.example` update. Requires new diff reconciliation logic. |
| 10 | **Mock Theater Detection** | Phase 6 | **PLANNED** | Growth | ast-grep rule for `jest.mock()`/`vi.mock()` cross-referenced with call graph complexity. Rules engine exists; rule needs authoring. |
| 11 | **State Lifecycle Asymmetry** | Phase 6 | **PLANNED** | Growth | ast-grep rule for `subscribe`/`addListener` without matching `unsubscribe`/`removeListener`. Rules engine exists; rule needs authoring. |
| 12 | **Idempotency Risk Detection** | Phase 4 + 6 | **PLANNED** | Growth | Taxonomy tags trigger handlers. Graph traversal checks for idempotency-key/lock node before mutation. Rules engine exists; traversal query needed. |
| 13 | **Concurrency Blindspots** | Phase 6 | **NEW** | Scale | Detect shared-state mutations in concurrent trigger paths without transaction/lock wrappers. Requires new graph traversal + taxonomy cross-reference. |
| 14 | **N+1 Query Detection** | Phase 6 | **PLANNED** | Growth | ast-grep rule: DB call inside loop body. Rules engine exists; rule needs authoring. |
| 15 | **Destructive Schema Drift** | Phase 5 + 6 | **NEW** | Scale | Detect column drops/renames in migration files without safe migration scripts. Requires new ast-grep rules for SQL/Prisma schema files. |
| 16 | **PII Exfiltration / Telemetry Trap** | Phase 4 + 6 | **NEW** | Scale | Taint analysis from PII-tagged entities to untrusted logging sinks. Requires entity tagging + new graph traversal. |
| 17 | **Business Logic Invariants** | Phase 4 + 6 | **NEW** | Scale | Enforce validation boundaries before financial/inventory mutations. Requires taxonomy-driven rule triggering + invariant check detection. |
| 18 | **Rate Limit Blindness** | Phase 6 | **PLANNED** | Scale | ast-grep rule: external API call inside unbounded loop without backoff. Similar to N+1; rule needs authoring. |
| 19 | **Connection Pool Exhaustion** | Phase 6 | **PLANNED** | Growth | ast-grep rule: `new PrismaClient()`/`new Redis()` inside request handler scope. Rule needs authoring. |
| 20 | **Dark Launch Violations** | Phase 6 | **PLANNED** | Scale | Detect new public routes without feature flag wrapper. Rule needs authoring. |
| 21 | **Toxic Supply Chain** | Phase 5 + 6 | **NEW** | Scale | Cross-reference new `import`/`require` nodes with `package.json` delta. Check against OSV advisory database. |
| 22 | **Silent Error Swallowing** | Phase 6 | **PLANNED** | Growth | ast-grep rule: `catch` blocks without re-throw or structured logging. Rule needs authoring. |
| 23 | **Zero-Downtime Migration Violations** | Phase 6 | **PLANNED** | Scale | ast-grep rules for `ALTER TABLE ... ADD COLUMN ... DEFAULT` without `CONCURRENTLY` or multi-step migration pattern. |
| 24 | **Cloud IAM Privilege Escalation** | Phase 6 | **NEW** | Scale | Detect wildcard IAM policies in IaC files. Cross-reference with actual API calls used. |
| 25 | **API Backward Compatibility** | Phase 7 | **PARTIAL** | Scale | Extends blast radius to detect public schema shape changes. Requires field-level diffing on API return types. |
| 26 | **Distributed Cache Desync** | Phase 6 | **PLANNED** | Scale | Detect DB writes on cached resources without corresponding cache invalidation. Rule + graph traversal. |
| 27 | **State Machine Orphaning** | Phase 5 + 1 | **NEW** | Scale | Detect enum/type additions without updating downstream exhaustive consumers (switch/match). Reverse-dep traversal. |
| 28 | **Data Residency Violations** | Phase 4 + 6 | **NEW** | Scale | Taint analysis from EU-tagged data to cross-border external dependencies. Enterprise-only. |
| 29 | **Ghost Migration Drift** | Phase 5.5 | **PLANNED** | Scale | Detect modified/deleted migration files after local execution. Requires migration file tracking in prompt ledger. |
| 30 | **Bounded Context Bleed** | Phase 4 + 6 | **PARTIAL** | Scale | Cross-feature-area direct DB mutations detectable via taxonomy + imports graph. Drift detection exists in docs. Enforcement logic not yet built. |
| 31 | **Event-Driven Blackholes** | Phase 6 + 1 | **NEW** | Scale | Match `publish` topics to `subscribe` handlers. Detect missing DLQ/retry in subscriber catch blocks. |
| 32 | **Flaky Test Detection** | Phase 6 | **PLANNED** | Scale | ast-grep rules for `Date.now()`/`Math.random()` in test files without mocked timers. |
| 33 | **Multi-Repo Contract Fracturing** | Phase 12 | **NEW** | Scale | Cross-org-graph traversal when public API schema changes. Requires Phase 12 multi-repo infrastructure. |
| 34 | **Zombie Infrastructure** | Phase 6 + 1 | **NEW** | Scale | Graph check: IaC `CloudResource` nodes with zero inbound application code edges. Requires IaC file indexing. |
| 35 | **Agent-on-Agent Collision** | Phase 12 | **PLANNED** | Scale | Ephemeral entity activity records with TTL. Phase 12 collision detection covers this. |
| 36 | **Runaway Context Bankruptcy** | Phase 8 | **PARTIAL** | Scale | Phase 8 tracks LLM costs via Langfuse. Circuit breaker logic for doom-loop detection not yet built. |
| 37 | **Idiomatic Drift** | Phase 9 | **PLANNED** | Scale | Phase 9 code snippet library for exemplar comparison. ast-grep structural similarity check needed. |
| 38 | **Trade Secret Exfiltration** | Phase 10b | **PLANNED** | Scale | Phase 10b local proxy intercepts reads on IP-restricted zones. Tagging and enforcement not yet built. |

### Status Summary

| Status | Count | % |
|---|---|---|
| SHIPPED | 4 | 10% |
| PARTIAL | 5 | 13% |
| PLANNED (infrastructure exists, rule/logic needed) | 16 | 42% |
| NEW (requires new infrastructure) | 13 | 34% |

---

## 1.3 Launch Tier — Ship-Critical Features

These features differentiate kap10 at launch. They require minimal new infrastructure because the data already exists — they primarily need **UI surfaces** and **minor wiring**.

### Feature L1: Blast Radius Visualization

**What exists:** `lib/review/blast-radius.ts` implements N-hop ArangoDB traversal from changed entities to API/UI boundary nodes. `analyze_impact` MCP tool exists. PR review integration (Phase 7) uses it.

**What's missing:** A dashboard visualization showing the interactive dependency tree before an agent commits a change.

**User story:** _"Before I merge this AI-generated PR, kap10 shows me that 14 functions across 3 feature areas will be affected."_

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

**User story:** _"kap10 flags that my `calculateInvoice()` function has drifted from 'Computes line item totals' to 'Computes totals AND sends email notifications' — a mixed-responsibility code smell introduced by the AI agent."_

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

**User story:** _"kap10 shows me all functions with 0 inbound calls touched in the last 30 days, with a 1-click 'Ask Agent to Clean Up' button. It also shows where my code diverges from its own mined patterns."_

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

| # | Feature | Layer | Status | File / Component |
|---|---------|-------|--------|-----------------|
| L1a | Blast radius API route | Backend | ☐ TODO | `app/api/repos/[repoId]/impact/route.ts` |
| L1b | Blast radius dependency tree visualization | Frontend | ☐ TODO | `app/(dashboard)/repos/[repoId]/impact/` |
| L1c | Blast radius count in `get_function` MCP tool | Backend | ☐ TODO | `lib/mcp/tools/structural.ts` |
| L2a | Cosine distance comparison after cascade re-justification | Backend | ☐ TODO | `lib/justification/drift-detector.ts` |
| L2b | `drift_alerts` ArangoDB collection + schema | Database | ☐ TODO | `lib/adapters/arango-graph-store.ts` |
| L2c | Drift timeline UI component | Frontend | ☐ TODO | `app/(dashboard)/repos/[repoId]/drift/` |
| L3a | Brain Trust knowledge base UI per feature area | Frontend | ☐ TODO | `app/(dashboard)/repos/[repoId]/knowledge/` |
| L3b | API route: ADRs + ontology + patterns per feature | Backend | ☐ TODO | `app/api/repos/[repoId]/knowledge/route.ts` |
| L4a | Cruft view: dead code + recency filter | Frontend | ☐ TODO | Health dashboard widget |
| L4b | Alignment view: pattern deviation report | Frontend | ☐ TODO | Health dashboard widget |

---

## 2.2 Growth Tier Tracker

### ast-grep Rules (Phase 6 Extensions)

| # | Rule ID | Description | Status |
|---|---------|------------|--------|
| G2 | `resilience-missing-retry` | External call without retry/timeout wrapper | ☐ TODO |
| G3 | `error-swallowing` | Catch block without re-throw or structured logging | ☐ TODO |
| G4 | `n-plus-one-query` | DB call inside loop body | ☐ TODO |
| G5 | `connection-pool-inside-handler` | Infrastructure client instantiation in request scope | ☐ TODO |
| G6 | `mock-theater` | High mock-to-assertion ratio in test files | ☐ TODO |
| G7 | `lifecycle-asymmetry` | Subscribe/listen without matching unsubscribe/cleanup | ☐ TODO |

### Graph Traversal Queries

| # | Query ID | Description | Status |
|---|----------|------------|--------|
| G1 | `trust-boundary-violation` | Source→Sink path bypassing Validator nodes | ☐ TODO |
| G8 | `idempotency-risk` | Trigger→Mutation path without lock/check node | ☐ TODO |
| G10 | `contract-breach` | Public API return type field-level diff | ☐ TODO |

### New Logic

| # | Feature | Description | Status |
|---|---------|------------|--------|
| G9 | Infra-to-code disconnect | Diff reconciliation for new env vars vs `.env.example` | ☐ TODO |

---

## 2.3 Scale Tier Tracker

| Domain | Features | Dependency Phase | Status |
|--------|----------|-----------------|--------|
| Security | PII exfiltration, IAM drift, data residency, supply chain, trade secret | Phase 6 + 10b | ☐ All TODO |
| Data Safety | Schema drift, cache desync, state machine orphaning, ghost migration | Phase 6 + 5.5 | ☐ All TODO |
| Production | Concurrency, rate limits, dark launch, zero-downtime migration, flaky tests | Phase 6 | ☐ All TODO |
| Architecture | Invariants, bounded context, event blackholes, zombie infra | Phase 4 + 6 | ☐ All TODO |
| Multi-Agent | Multi-repo contracts, agent collision, context bankruptcy, idiomatic drift | Phase 8 + 9 + 12 | ☐ All TODO |
| DevEx | Cognitive debt, API backward compatibility | Phase 5.5 + 7 | ☐ All TODO |

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
