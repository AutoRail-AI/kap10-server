# Phase 6 — Pattern Enforcement & Rules Engine (ast-grep + Semgrep): Deep Dive & Implementation Tracker

> **Phase Feature Statement:** _"unerr learns my codebase patterns AND enforces my team's explicit architectural rules. Agents always know the conventions — even when .cursorrules falls out of context. I can see a pattern library with confidence scores, and the AI agent asks 'does this code follow conventions?' before writing."_
>
> **Source:** [`VERTICAL_SLICING_PLAN.md`](./VERTICAL_SLICING_PLAN.md) — Phase 6
>
> **Prerequisites:** [Phase 1 — GitHub Connect & Repo Indexing](./PHASE_1_GITHUB_CONNECT_AND_INDEXING.md) (entities + call graph in ArangoDB, `patterns` and `rules` collections bootstrapped), [Phase 2 — Hosted MCP Server](./PHASE_2_HOSTED_MCP_SERVER.md) (MCP tool registration, OTel spans, Bootstrap Rule), [Phase 3 — Semantic Search](./PHASE_3_SEMANTIC_SEARCH.md) (entity embeddings, hybrid search), [Phase 4 — Business Justification & Taxonomy](./PHASE_4_BUSINESS_JUSTIFICATION_AND_TAXONOMY.md) (unified justifications, feature areas, design patterns), [Phase 5 — Incremental Indexing & GitHub Webhooks](./PHASE_5_INCREMENTAL_INDEXING_AND_GITHUB_WEBHOOKS.md) (push-based re-indexing), [Phase 5.5 — Prompt Ledger, Rewind & Local Ingestion](./PHASE_5.5_PROMPT_LEDGER_REWIND_AND_LOCAL_INGESTION.md) (anti-pattern rules from rewinds, `rules` collection populated reactively)
>
> **Database convention:** All unerr Supabase tables use PostgreSQL schema `unerr`. ArangoDB collections are org-scoped (`org_{orgId}/`). See [VERTICAL_SLICING_PLAN.md § Storage & Infrastructure Split](./VERTICAL_SLICING_PLAN.md#storage--infrastructure-split).

---

## Table of Contents

- [Part 1: Architectural Deep Dive](#part-1-architectural-deep-dive)
  - [1.1 Core User Flows](#11-core-user-flows)
  - [1.2 System Logic & State Management](#12-system-logic--state-management)
  - [1.3 Reliability & Resilience](#13-reliability--resilience)
  - [1.4 Performance Considerations](#14-performance-considerations)
  - [1.4a Hybrid Rule Evaluation](#14a-hybrid-rule-evaluation--semantic--syntactic-two-pass-engine)
  - [1.4b Context-Aware Rule RAG](#14b-context-aware-rule-rag--jit-rule-injection)
  - [1.4c Automated Subgraph Pattern Mining](#14c-automated-subgraph-pattern-mining)
  - [1.4d Auto-Remediation Generation](#14d-auto-remediation-generation--shift-left-fixing)
  - [1.4e Rule Decay & Telemetry Tracking](#14e-rule-decay--telemetry-tracking)
  - [1.4f Blast Radius Simulation](#14f-blast-radius-simulation--dry-run-rollout)
  - [1.4g Time-Bound Exception Ledger](#14g-time-bound-exception-ledger)
  - [1.4h LLM-Assisted Rule Compilation](#14h-llm-assisted-rule-compilation)
  - [1.4i Polyglot Semantic Mapping](#14i-polyglot-semantic-mapping)
  - [1.4j Recommended Package Integrations](#14j-recommended-package-integrations)
  - [1.5 Phase Bridge → Phase 7](#15-phase-bridge--phase-7)
- [Part 2: Implementation & Tracing Tracker](#part-2-implementation--tracing-tracker)
  - [2.1 Infrastructure Layer](#21-infrastructure-layer)
  - [2.2 Database & Schema Layer](#22-database--schema-layer)
  - [2.3 Ports & Adapters Layer](#23-ports--adapters-layer)
  - [2.4 Backend / API Layer](#24-backend--api-layer)
  - [2.5 Frontend / UI Layer](#25-frontend--ui-layer)
  - [2.6 Testing & Verification](#26-testing--verification)

---

## Canonical Terminology

> **CRITICAL:** Use these canonical names. See [Phase 4 § Canonical Terminology](./PHASE_4_BUSINESS_JUSTIFICATION_AND_TAXONOMY.md#canonical-terminology) for justification-related terms. See [Phase 5 § Canonical Terminology](./PHASE_5_INCREMENTAL_INDEXING_AND_GITHUB_WEBHOOKS.md#canonical-terminology) for incremental indexing terms. See [Phase 5.5 § Canonical Terminology](./PHASE_5.5_PROMPT_LEDGER_REWIND_AND_LOCAL_INGESTION.md#canonical-terminology) for ledger/rewind terms.

| Canonical Term | DB Field (snake_case) | TS Field (camelCase) | Definition | NOT called |
|---|---|---|---|---|
| **Pattern** | `patterns` (ArangoDB collection) | `PatternDoc` (type) | An auto-detected recurring codebase convention with adherence rate, evidence, and optional Semgrep rule. Discovered by ast-grep scan + LLM synthesis. | ~~convention~~, ~~habit~~, ~~detected rule~~ |
| **Rule** | `rules` (ArangoDB collection) | `RuleDoc` (type) | An explicit architectural or syntactic directive, either human-defined or auto-promoted from a high-confidence Pattern. Enforced at `suggest`, `warn`, or `block` level. Organized in a hierarchy: org → repo → path → branch → workspace. | ~~policy~~, ~~guideline~~, ~~constraint~~ |
| **Adherence Rate** | `adherence_rate` | `adherenceRate` | The fraction of matching code instances that follow a detected Pattern (e.g., 12/14 = 0.857). Patterns with adherence rate ≥ 0.8 are considered high-confidence. | ~~compliance rate~~, ~~conformity~~ |
| **Pattern Evidence** | `evidence` | `evidence` | An array of `file:line` references where a Pattern was observed. Used by LLM to generate Semgrep rules and by the dashboard to show examples. | ~~matches~~, ~~occurrences~~, ~~instances~~ |
| **Semgrep Rule YAML** | `semgrep_rule` | `semgrepRule` | A Semgrep-format YAML string that deterministically checks for Pattern violations. Auto-generated by LLM from ast-grep detection results. Executed without LLM at check time. | ~~semgrep config~~, ~~rule definition~~ |
| **ast-grep Query** | `ast_grep_query` | `astGrepQuery` | A structural code search query in ast-grep YAML format. Used during detection to find pattern instances across the codebase. Tree-sitter-based, language-aware. | ~~structural query~~, ~~AST pattern~~ |
| **Rule Scope** | `scope` | `scope` | The hierarchy level at which a Rule applies: `org` (all repos), `repo` (single repo), `path` (glob-matched files), `branch` (specific branch), `workspace` (personal preference). More specific scopes override broader ones. | ~~level~~, ~~context~~ |
| **Rule Enforcement** | `enforcement` | `enforcement` | How strictly a Rule is applied: `suggest` (informational), `warn` (highlighted but non-blocking), `block` (agent must comply, MCP returns violation). | ~~severity~~, ~~strictness~~ |
| **Rule Resolution** | — | `resolveRules()` | The process of selecting applicable Rules for a given context (orgId, repoId, branch, filePath, entityKind). Most specific scope wins on title conflict. Rules sorted by specificity then priority. | ~~rule matching~~, ~~rule lookup~~ |
| **Pattern Detection Pipeline** | — | `detectPatternsWorkflow` | The three-activity Temporal workflow: ast-grep scan (heavy) → LLM synthesize Semgrep rules (light) → store patterns (light). Triggered post-indexing or manually. | ~~pattern scan~~, ~~convention detector~~ |
| **Pattern Promotion** | — | `promoteToRule()` | The act of converting a high-confidence Pattern (adherence ≥ 0.9, pinned by user) into an explicit Rule. Creates a Rule with `createdBy: "auto-promoted"` linked to the source Pattern. | ~~rule creation from pattern~~, ~~auto-rule~~ |
| **Hybrid Rule Evaluation** | — | `evaluateHybrid()` | Two-pass rule engine: Pass 1 (syntactic) runs ast-grep/Semgrep for structural matches; Pass 2 (semantic) enriches findings with Phase 4 `feature_area`/`business_value` from ArangoDB. Reduces false positives by verifying structural hits against business context. | ~~dual-pass~~, ~~combined check~~ |
| **JIT Rule Injection** | — | `getRelevantRules()` | Context-Aware Rule RAG: instead of injecting all rules into the agent context, queries the sub-graph surrounding the target entities to select only contextually relevant rules. Reduces token waste by up to 90%. | ~~full rule dump~~, ~~eager injection~~ |
| **Subgraph Pattern Mining** | `mined_patterns` (ArangoDB collection) | `MinedPatternDoc` (type) | Implicit rule discovery via graph isomorphism / Louvain community detection. Identifies recurring topological structures (e.g., "every service has a companion factory") that are unwritten conventions. | ~~graph analysis~~, ~~topology scan~~ |
| **Auto-Remediation** | `fix` (ast-grep directive) | `autoFix` | AST-based auto-fix patches generated from ast-grep `fix:` YAML directives. Produces exact structural code diffs that eliminate agent guesswork for `block`-level violations. | ~~auto-fix~~, ~~suggested fix~~ |
| **Rule Health Ledger** | `rule_health` (ArangoDB collection) | `RuleHealthDoc` (type) | Per-rule telemetry tracking evaluations, violations, overrides, and false-positive reports. Drives rule decay detection and deprecation workflows. | ~~rule metrics~~, ~~rule stats~~ |
| **Blast Radius Simulation** | `status: "staged"` (on `rules`) | `simulateRule()` | Dry-run rollout for new rules: a `STAGED` rule is evaluated against the entire codebase in background, producing an Impact Report (violation count, affected files, affected teams) before enforcement. | ~~dry run~~, ~~test rule~~ |
| **Rule Exception** | `rule_exceptions` (ArangoDB edge collection) | `RuleExceptionEdge` (type) | Time-bound override edge from an entity to a rule, granting a TTL-limited exemption. Expires automatically; MCP flags upcoming expirations. | ~~waiver~~, ~~exclusion~~ |
| **Rule Compiler** | — | `draftArchitectureRule()` | LLM-Assisted Rule Compilation: natural language description → `generateObject()` with ast-grep YAML schema → validated YAML rule. Exposed as `draft_architecture_rule` MCP tool. | ~~rule generator~~, ~~AI rule writer~~ |
| **Polyglot Semantic Mapping** | `language_implementations` (ArangoDB edge collection) | `LanguageImplementationEdge` (type) | Cross-language rule enforcement: a single Business Intent node links to multiple `LanguageImplementation` edges, each carrying language-specific syntax payloads. One rule, many languages. | ~~multi-language rule~~, ~~cross-lang~~ |

---

# Part 1: Architectural Deep Dive

## Why ast-grep + Semgrep (Not Custom AST Traversal)

Phase 6 uses two complementary tools instead of hand-written AST visitors:

**ast-grep** (detection): Structural code search using Tree-sitter. Write 3–5 line YAML queries instead of 50+ lines of AST visitor code per pattern. Handles all syntax variants per language.

**Semgrep** (enforcement): Deterministic rule execution. Once a pattern is detected, the LLM auto-generates a Semgrep YAML rule. At check time, Semgrep runs the rule against code — no LLM needed. This means:
- **Fast** — Semgrep scans thousands of files in seconds
- **Accurate** — No hallucinations, exact structural matches
- **Explainable** — Every finding links to the rule + evidence
- **Cheap** — Zero LLM cost at enforcement time

The LLM is only involved once (during rule synthesis), not on every check. This is the key architectural insight.

---

## 1.1 Core User Flows

### Flow 1: Post-Indexing Pattern Detection (Automated)

**Actor:** System (automated, triggered after `indexRepoWorkflow` or `incrementalIndexWorkflow` completes)
**Precondition:** Repo is in `ready` status. Entities and call graph exist in ArangoDB. Persistent workspace has the source code.
**Outcome:** Patterns detected, Semgrep rules generated, stored in ArangoDB. Dashboard shows pattern library.

```
Step  Actor                           System Action                                              Outcome
────  ──────────────────────────────  ───────────────────────────────────────────────────────    ─────────────────────────
1     indexRepoWorkflow completes     Chain: start detectPatternsWorkflow (Temporal)              —
      (or incrementalIndexWorkflow)   workflowId: detect-patterns-{orgId}-{repoId}
                                      Queue: heavy-compute-queue (first activity)

2                                     Activity: astGrepScan (heavy-compute-queue)                 Raw detection results
                                       a) Load workspace source at /data/workspaces/{orgId}/{repoId}
                                       b) Run built-in detection catalog (see § 1.2.3):
                                          - Structural patterns (zod validation, error handling,
                                            rate limiting, logging)
                                          - Naming patterns (hook prefixes, component naming,
                                            file naming conventions)
                                          - Architectural patterns (import boundaries, data
                                            access layers)
                                       c) For each query: count total instances vs matching
                                          instances → compute adherence rate
                                       d) Filter: only patterns with adherence ≥ 0.5 AND
                                          total instances ≥ 3 (eliminates noise)
                                       e) Heartbeat progress: "{N}/{total} queries completed"

3                                     Activity: llmSynthesizeRules (light-llm-queue)              Semgrep YAML per pattern
                                       a) For each detected pattern with adherence ≥ 0.8:
                                          - Build LLM prompt with: pattern description,
                                            adherence rate, 3 matching examples (code),
                                            1 non-matching counter-example (if available)
                                          - Call LLM via generateObject() with SemgrepRuleSchema
                                          - Validate output: parse YAML, verify syntax
                                       b) Patterns with adherence < 0.8: store WITHOUT
                                          Semgrep rule (informational only)
                                       c) Batch: max 20 patterns per LLM call batch
                                       d) Token budget: 3K input + 600 output per pattern

4                                     Activity: storePatterns (light-llm-queue)                    Patterns persisted
                                       a) Upsert patterns into ArangoDB `patterns` collection
                                       b) Key: pattern_{hash} where hash = SHA-256 of
                                          (orgId + repoId + astGrepQuery)
                                       c) If pattern already exists: update adherence_rate,
                                          evidence, evidence_count, semgrep_rule
                                       d) Preserve user actions: pinned/dismissed status
                                          is NOT overwritten on re-detection

5                                     Repo status stays "ready" (pattern detection               Patterns available
                                       is non-blocking — repo is already usable)
```

**Key design decision:** Pattern detection is chained after indexing but does NOT block the repo's `ready` status. The repo remains queryable via MCP while patterns are being detected. This avoids adding latency to the critical path (index → embed → ready).

### Flow 2: Agent Pre-Flight — Rules Injected Before Code Generation

**Actor:** AI coding agent (Cursor, Claude Code, Windsurf) via MCP
**Precondition:** Bootstrap Rule instructs the agent to call `get_rules` before modifying any file. At least one Rule or Pattern exists.
**Outcome:** Agent receives context-appropriate rules and writes code that follows conventions.

```
Step  Actor                           System Action                                              Outcome
────  ──────────────────────────────  ───────────────────────────────────────────────────────    ─────────────────────────
1     User prompts agent:             Agent reads Bootstrap Rule:                                  —
      "Add a new API route for        "Before ANY code generation task:
       invoice export"                  1. Call sync_local_diff with current git diff
                                        2. Call get_rules for the file you're about to modify
                                        3. Follow ALL returned rules"

2     Agent calls get_rules:           MCP tool resolves applicable rules:                         —
      { filePath: "app/api/            a) Query ArangoDB: all active rules where
        invoices/export/route.ts" }       org_id matches AND (repo_id matches OR null)
                                          AND (branch matches OR null)
                                          AND (workspace_user_id matches OR null)
                                       b) Filter by path glob: "app/api/**/*.ts" matches
                                       c) Filter by entity kind (if provided)
                                       d) Sort: workspace > branch > path > repo > org,
                                          then by priority (descending)
                                       e) Deduplicate: most specific title wins

3                                     Return compact rule summary:                                Rules delivered
                                       [
                                         { title: "API routes must use zod validation",
                                           enforcement: "block",
                                           description: "All request bodies validated...",
                                           example: "const body = Schema.parse(...);" },
                                         { title: "Rate limiting on all public endpoints",
                                           enforcement: "warn",
                                           description: "Wrap handler with rateLimit()...",
                                           example: "const limit = await rateLimit(req);..." },
                                         { title: "No raw SQL in route handlers",
                                           enforcement: "warn",
                                           description: "Use Prisma client, never raw queries." }
                                       ]
                                       meta: { totalRules: 3, scope: "repo + org" }

4     Agent writes code following     Agent generates route.ts with zod validation,               Code follows conventions
      returned rules                   rate limiting, and Prisma queries

5     Agent calls check_rules         MCP tool validates code against rules (see Flow 3)          Violations returned (if any)
      with the generated code
```

**Why this replaces .cursorrules:** Cursor rules (`.cursorrules`, `.cursor/rules/*.mdc`) are static files loaded into the context window. They suffer from context rot (pushed out as conversation grows), one-size-fits-all loading (irrelevant rules waste tokens), no team coordination, and no hierarchy. unerr's Rules Engine fetches rules fresh on every tool call, scoped to the exact file/context, shared across the team, and hierarchically resolved.

### Flow 3: Agent Post-Flight — Code Validation via check_rules

**Actor:** AI coding agent via MCP (post-flight)
**Precondition:** Agent has generated code. Bootstrap Rule instructs post-flight validation.
**Outcome:** Violations reported with explanations and examples. Agent fixes violations before presenting to user.

```
Step  Actor                           System Action                                              Outcome
────  ──────────────────────────────  ───────────────────────────────────────────────────────    ─────────────────────────
1     Agent calls check_rules:        Receive code + context:                                     —
      { code: "export async fn...",    a) Extract file path from context
        filePath: "app/api/..." }      b) Resolve applicable rules (same as get_rules)
                                       c) Filter to rules with semgrepRule defined

2                                     Run Semgrep against code:                                   —
                                       a) Write code to temp file
                                       b) Write applicable Semgrep YAML rules to temp config
                                       c) Execute: semgrep --config {config} {tempFile} --json
                                       d) Parse JSON output: extract findings

3                                     Run rules without Semgrep:                                  —
                                       For rules without semgrepRule (architectural rules
                                       that can't be expressed structurally):
                                       a) Check against ArangoDB import graph if rule
                                          concerns import boundaries
                                       b) Check against file naming conventions
                                       c) Skip rules that require full codebase context
                                          (these are checked by detectPatternsWorkflow)

4                                     Return violations sorted by enforcement:                    Violations delivered
                                       { violations: [
                                           { rule: "Rate limiting on all endpoints",
                                             enforcement: "warn",
                                             message: "API route handler missing rateLimit()",
                                             line: 5,
                                             suggestion: "Add: const limit = await rateLimit(req);",
                                             example: "..." },
                                         ],
                                         passed: ["API routes must use zod validation"],
                                         meta: { totalChecked: 3, violations: 1, passed: 2 } }

5     Agent fixes violations          Agent modifies code to add rate limiting                    Code now compliant
      (if enforcement == "block",
       agent MUST fix before
       presenting to user)
```

**Enforcement semantics:**
- `suggest`: Violation returned as informational. Agent may or may not follow.
- `warn`: Violation highlighted. Agent should follow but can skip with justification.
- `block`: Violation is mandatory. Agent must fix before presenting code to user. Bootstrap Rule reinforces: "If check_rules returns a `block` violation, fix it before responding."

### Flow 4: Human Creates or Edits a Rule (Dashboard)

**Actor:** Tech lead / architect via dashboard
**Precondition:** User has repo access. Dashboard rules page loaded.
**Outcome:** Rule created in ArangoDB, immediately available to all agents via MCP.

```
Step  Actor                           System Action                                              Outcome
────  ──────────────────────────────  ───────────────────────────────────────────────────────    ─────────────────────────
1     User navigates to               Page loads rules from API:                                   Rules listed
      /repos/{repoId}/rules           GET /api/repos/{repoId}/rules
                                       Grouped by type, sorted by priority

2     User clicks "Create Rule"       Rule creation form:                                         —
                                       - Title (required)
                                       - Description with rationale (required)
                                       - Type: architectural | syntactic | convention |
                                               styling | team_standard
                                       - Scope: org | repo | path | branch | workspace
                                       - Path glob (if scope == path)
                                       - File types filter (optional)
                                       - Entity kinds filter (optional)
                                       - Enforcement: suggest | warn | block
                                       - Example code (optional, recommended)
                                       - Counter-example code (optional)

3     User submits rule               POST /api/repos/{repoId}/rules:                             Rule created
                                       a) Validate via RuleSchema (Zod)
                                       b) If example + counter-example provided:
                                          Queue LLM to generate Semgrep YAML (async)
                                       c) Store in ArangoDB `rules` collection
                                       d) Return rule with ID

4     (Async) LLM generates           Activity: llmSynthesizeSemgrepRule                         Semgrep rule attached
      Semgrep rule from examples       a) Build prompt with title, description, example,
                                          counter-example
                                       b) generateObject() with SemgrepRuleSchema
                                       c) Validate YAML syntax
                                       d) Update rule: set semgrep_rule field

5     Rule is immediately active      Next get_rules call includes the new rule                   Agents see new rule
```

### Flow 5: Pattern Library — Pin, Dismiss, Promote

**Actor:** Developer or tech lead via dashboard
**Precondition:** Pattern detection has run. Patterns exist in ArangoDB.
**Outcome:** Patterns curated — high-value patterns pinned, noise dismissed, best patterns promoted to explicit rules.

```
Step  Actor                           System Action                                              Outcome
────  ──────────────────────────────  ───────────────────────────────────────────────────────    ─────────────────────────
1     User navigates to               Load patterns from API:                                     Patterns displayed
      /repos/{repoId}/patterns        GET /api/repos/{repoId}/patterns
                                       Each pattern shows: title, adherence rate,
                                       evidence count, confidence, status, Semgrep rule

2a    User pins a pattern             PATCH /api/repos/{repoId}/patterns/{id}                     Pattern pinned
                                       { status: "pinned" }
                                       Pinned patterns survive re-detection
                                       (never overwritten or removed)

2b    User dismisses a pattern        PATCH /api/repos/{repoId}/patterns/{id}                     Pattern hidden
                                       { status: "dismissed" }
                                       Dismissed patterns excluded from get_conventions
                                       and check_patterns. Not deleted (can be un-dismissed).

2c    User promotes pattern to rule   POST /api/repos/{repoId}/rules/from-pattern                 Rule created from pattern
                                       { patternId, enforcement: "warn", scope: "repo" }
                                       a) Copy pattern data into new Rule
                                       b) Set createdBy: "auto-promoted:{patternId}"
                                       c) Copy semgrepRule from pattern (if exists)
                                       d) Pattern status set to "promoted"
                                       e) Rule immediately active via MCP
```

### Flow 6: Agent Asks "What Are the Conventions?" (get_conventions)

**Actor:** AI agent via MCP
**Precondition:** Patterns and/or rules exist.
**Outcome:** Agent receives a summary of codebase conventions — active patterns with examples.

```
Step  Actor                           System Action                                              Outcome
────  ──────────────────────────────  ───────────────────────────────────────────────────────    ─────────────────────────
1     Agent calls get_conventions:     Query ArangoDB:                                             —
      { category?: "naming" }          a) Patterns where status IN ("active", "pinned")
                                          AND adherence_rate >= 0.7
                                       b) Optionally filter by pattern type
                                       c) Sort by adherence_rate DESC, confidence DESC

2                                     Return conventions summary:                                 Conventions delivered
                                       [
                                         { title: "All API routes use zod validation",
                                           adherenceRate: 0.92,
                                           evidenceCount: 23,
                                           example: "const body = Schema.parse(...);",
                                           counterExample: "const body = req.body;" },
                                         { title: "React hooks prefixed with 'use'",
                                           adherenceRate: 1.0,
                                           evidenceCount: 47,
                                           example: "function useAuth() { ... }" },
                                         ...
                                       ]
                                       meta: { totalConventions: 12 }
```

### Flow 7: Agent Asks "How Should I Implement This?" (suggest_approach)

**Actor:** AI agent via MCP
**Precondition:** Patterns, rules, and entities exist. Agent is about to implement something and wants to follow existing patterns.
**Outcome:** Agent receives a template/approach based on existing patterns in the codebase.

```
Step  Actor                           System Action                                              Outcome
────  ──────────────────────────────  ───────────────────────────────────────────────────────    ─────────────────────────
1     Agent calls suggest_approach:    Resolve context:                                            —
      { task: "Add a new API route     a) Identify relevant patterns (API route patterns,
        for invoice export",              zod validation, rate limiting, etc.)
        filePath: "app/api/..." }       b) Find similar existing implementations via
                                           semantic search (Phase 3)
                                        c) Fetch applicable rules (same as get_rules)

2                                     Build suggestion:                                           —
                                       a) Find most similar existing file (by path pattern
                                          and semantic similarity)
                                       b) Extract its structural patterns (imports, exports,
                                          error handling, middleware usage)
                                       c) Combine with applicable rules

3                                     Return approach:                                            Suggestion delivered
                                       { template: "Based on 14 existing API routes...",
                                         similarFile: "app/api/billing/route.ts",
                                         patterns: ["zod validation", "rate limiting",
                                                    "error envelope pattern"],
                                         rules: [{title, enforcement, example}...],
                                         suggestion: "Follow the pattern in billing/route.ts:
                                           1. Import zod schema
                                           2. Add rate limiter
                                           3. Parse body with schema
                                           4. Use Prisma for data access
                                           5. Return { data, error, meta } envelope" }
```

---

## 1.2 System Logic & State Management

### 1.2.1 Pattern Types & Detection Catalog

Phase 6 ships with a built-in catalog of ast-grep queries organized by pattern type:

| Pattern Type | Detection Tool | Enforcement Tool | Examples |
|---|---|---|---|
| **Structural** | ast-grep: find code structures, check for required patterns | Semgrep: auto-generated rule | "All API routes use zod validation", "All async handlers wrap in try/catch", "All route handlers use rate limiting" |
| **Naming** | ast-grep: function/variable naming patterns | Semgrep: naming convention rule | "React hooks prefixed `use`", "Constants are UPPER_SNAKE_CASE", "Component files are PascalCase" |
| **Architectural** | ArangoDB import graph analysis | Semgrep: forbidden import pattern | "Data access goes through `lib/db/`", "No direct DB access from route handlers", "Components don't import from `lib/adapters/`" |
| **Error Handling** | ast-grep: try/catch, error type checking | Semgrep: missing error handling rule | "All async handlers use try/catch", "Catch blocks always type-check error", "API responses include error field" |
| **Testing** | File tree analysis (fast-glob) | Dashboard warning (no Semgrep) | "Every `lib/` module has `__tests__/` companion", "Test files are colocated with source" |

### 1.2.2 ArangoDB Schema — Patterns Collection

The `patterns` collection is already bootstrapped in `DOC_COLLECTIONS` but needs real field definitions:

```json
{
  "_key": "pattern_{hash}",
  "org_id": "org_abc",
  "repo_id": "repo_xyz",
  "type": "structural",
  "title": "All API routes use zod request validation",
  "ast_grep_query": "rule:\n  pattern: const $SCHEMA = z.object({ $$$ })\n  ...",
  "evidence": [
    "app/api/auth/route.ts:15",
    "app/api/billing/route.ts:8",
    "app/api/repos/route.ts:12"
  ],
  "evidence_count": 12,
  "total_instances": 14,
  "adherence_rate": 0.857,
  "confidence": 0.91,
  "status": "active",
  "source": "auto-detected",
  "semgrep_rule": "rules:\n  - id: unerr.missing-zod-validation\n    pattern: ...",
  "example_code": "const body = RequestSchema.parse(await req.json());",
  "counter_example_code": "const body = await req.json();",
  "language": "typescript",
  "created_at": "2026-02-21T...",
  "updated_at": "2026-02-21T..."
}
```

**Indexes on `patterns`:**
- `{ org_id, repo_id, status }` — active patterns query
- `{ org_id, repo_id, type, adherence_rate }` — pattern library filter + sort
- `{ _key }` (default) — pattern lookup by hash

**Status values:** `active` (default on detection), `pinned` (user-endorsed, survives re-detection), `dismissed` (user-hidden, excluded from MCP), `promoted` (converted to an explicit Rule).

### 1.2.3 ArangoDB Schema — Rules Collection

The `rules` collection is already bootstrapped. Phase 6 fills in the complete field set:

```json
{
  "_key": "rule_{uuid}",
  "org_id": "org_abc",
  "repo_id": "repo_xyz",
  "title": "API routes must use zod validation",
  "description": "All request bodies validated with z.object() before processing. This ensures type safety at the API boundary.",
  "type": "architectural",
  "scope": "repo",
  "path_glob": "app/api/**/*.ts",
  "file_types": ["ts", "tsx"],
  "entity_kinds": null,
  "branch": null,
  "workspace_user_id": null,
  "enforcement": "block",
  "semgrep_rule": "rules:\n  - id: unerr.missing-zod\n    ...",
  "example": "const body = RequestSchema.parse(await req.json());",
  "counter_example": "const body = await req.json();",
  "priority": 10,
  "status": "active",
  "created_by": "user_123",
  "source_pattern_id": null,
  "created_at": "2026-02-21T...",
  "updated_at": "2026-02-21T..."
}
```

**Indexes on `rules`:**
- `{ org_id, repo_id, status }` — active rules query
- `{ org_id, status, scope }` — org-wide rule resolution
- `{ org_id, repo_id, branch, workspace_user_id, status }` — full resolution query

**Rule types (enum):** `architectural`, `syntactic`, `convention`, `styling`, `team_standard`
**Rule scopes (enum):** `org`, `repo`, `path`, `branch`, `workspace`
**Rule enforcement (enum):** `suggest`, `warn`, `block`
**Rule status (enum):** `active`, `draft`, `archived`

**Relationship to Phase 5.5 Anti-Pattern Rules:** Anti-pattern rules created by Phase 5.5's rewind process are stored in this same `rules` collection with `created_by: "system:rewind"`, `type: "architectural"`, `scope: "repo"`, and `priority: 10`. Phase 6 treats them identically to human-created rules — they appear in `get_rules` results and are checked by `check_rules`.

### 1.2.4 Domain Types — RuleDoc & PatternDoc (Expanded)

The existing `RuleDoc` and `PatternDoc` types in `lib/ports/types.ts` are intentionally minimal (`{ id, org_id, name, [key: string]: unknown }`). Phase 6 replaces them with complete typed interfaces:

**RuleDoc:**
```
{
  id: string
  orgId: string
  repoId?: string                    // null = org-wide
  title: string
  description: string
  type: "architectural" | "syntactic" | "convention" | "styling" | "team_standard"
  scope: "org" | "repo" | "path" | "branch" | "workspace"
  pathGlob?: string
  fileTypes?: string[]
  entityKinds?: string[]
  branch?: string
  workspaceUserId?: string
  enforcement: "suggest" | "warn" | "block"
  semgrepRule?: string
  example?: string
  counterExample?: string
  priority: number
  status: "active" | "draft" | "archived"
  createdBy: string
  sourcePatternId?: string           // set if auto-promoted from a Pattern
  createdAt: Date
  updatedAt: Date
}
```

**PatternDoc:**
```
{
  id: string
  orgId: string
  repoId: string
  type: "structural" | "naming" | "architectural" | "error_handling" | "testing"
  title: string
  astGrepQuery: string
  evidence: string[]                  // file:line references
  evidenceCount: number
  totalInstances: number
  adherenceRate: number               // 0.0 – 1.0
  confidence: number                  // 0.0 – 1.0
  status: "active" | "pinned" | "dismissed" | "promoted"
  source: "auto-detected" | "user-defined"
  semgrepRule?: string
  exampleCode?: string
  counterExampleCode?: string
  language: string
  createdAt: Date
  updatedAt: Date
}
```

**RuleFilter (expanded):**
```
{
  orgId: string
  repoId?: string
  branch?: string
  userId?: string
  filePath?: string
  entityKind?: string
  status?: "active" | "draft" | "archived"
  type?: string
  scope?: string
}
```

**PatternFilter (expanded):**
```
{
  orgId: string
  repoId: string
  status?: "active" | "pinned" | "dismissed" | "promoted"
  type?: string
  minAdherenceRate?: number
  language?: string
}
```

### 1.2.5 Rule Resolution Algorithm

When an agent calls `get_rules` or `check_rules`, the system resolves which rules apply:

```
resolveRules(orgId, repoId, branch, userId, filePath?, entityKind?):

  1. QUERY: All active rules where:
     org_id == orgId
     AND status == "active"
     AND (repo_id == repoId OR repo_id IS NULL)         // repo-specific + org-wide
     AND (branch == ctx.branch OR branch IS NULL)         // branch-specific + all-branch
     AND (workspace_user_id == userId OR workspace_user_id IS NULL)

  2. FILTER by path_glob (if filePath provided):
     Keep rules where path_glob IS NULL OR minimatch(filePath, pathGlob)

  3. FILTER by file_types (if filePath provided):
     Keep rules where file_types IS NULL OR fileExtension IN fileTypes

  4. FILTER by entity_kinds (if entityKind provided):
     Keep rules where entity_kinds IS NULL OR entityKind IN entityKinds

  5. SORT by specificity (most specific first):
     scope_order = { workspace: 5, branch: 4, path: 3, repo: 2, org: 1 }
     Primary: scope_order[scope] DESC
     Secondary: priority DESC

  6. DEDUPLICATE by title (most specific wins):
     For rules with the same title, keep only the highest-specificity one.
     This allows a repo-level rule to override an org-level rule with
     the same title.

  RETURN: sorted, deduplicated rules
```

**Example conflict resolution:**
- Org rule: "Use ESM imports" (enforcement: warn)
- Repo rule: "Use ESM imports" (enforcement: block)
- Result: Repo rule wins (more specific scope). Agent sees `block` enforcement.

### 1.2.6 IPatternEngine Port Extension

The existing `IPatternEngine` port has two methods (`scanPatterns`, `matchRule`). Phase 6 extends it:

```
IPatternEngine {
  // Existing (Phase 1 stubs → Phase 6 real implementation)
  scanPatterns(workspacePath, rulesPath): Promise<PatternMatch[]>
  matchRule(code, ruleYaml): Promise<PatternMatch[]>

  // New — Phase 6 additions
  scanWithAstGrep(workspacePath, queries: AstGrepQuery[]): Promise<AstGrepResult[]>
  validateSemgrepYaml(yamlString): Promise<{ valid: boolean, errors?: string[] }>
}
```

The `SemgrepPatternEngine` adapter (currently throwing `NotImplementedError`) gets a real implementation wrapping Semgrep CLI and `@ast-grep/napi`.

### 1.2.7 Built-In Detection Catalog

Phase 6 ships with a curated set of ast-grep queries. These are stored as YAML files in `lib/patterns/catalog/` and loaded by the `astGrepScan` activity:

**Structural patterns (TypeScript/JavaScript):**
- Zod validation in API route handlers
- Rate limiting middleware usage
- Try/catch in async handlers
- Error type checking in catch blocks
- Logging in error handlers
- Response envelope pattern (`{ data, error, meta }`)

**Naming patterns:**
- React hooks prefixed with `use`
- Constants in UPPER_SNAKE_CASE
- Component files in PascalCase
- Test files in `*.test.ts` or `*.spec.ts`
- Types/interfaces with `I` or `T` prefix (or not — detects the repo's convention)

**Architectural patterns:**
- Import boundaries (which directories import from which)
- Single-file exports vs barrel exports
- Middleware chain patterns
- Repository/service layer patterns

The catalog is extensible — custom queries can be added per-repo. The built-in catalog covers the most common conventions in TypeScript/React/Next.js codebases. Language-specific catalogs for Python, Go, and other languages are added incrementally.

### 1.2.8 Bootstrap Rule Extension

The Bootstrap Rule (`lib/onboarding/bootstrap-rule.ts`) is updated to include pre-flight and post-flight pattern checks:

**Before (Phases 1–5.5):**
```
Pre-flight:
  1. Call sync_local_diff with current git diff
Post-flight:
  (none)
```

**After (Phase 6):**
```
Pre-flight:
  1. Call sync_local_diff with current git diff
  2. Call get_rules for the file you're about to modify
  3. Follow ALL returned rules — they override any conflicting .cursorrules
Post-flight:
  4. Call check_rules with the code you generated
  5. If any "block" violations: fix them before responding to the user
  6. If any "warn" violations: mention them to the user
```

This is an additive, non-breaking change. Agents that don't have the updated Bootstrap Rule still work — they just don't get rule injection or validation.

---

## 1.3 Reliability & Resilience

### 1.3.1 Failure Scenarios

| # | Failure | Detection | Recovery | Data Risk |
|---|---------|-----------|----------|-----------|
| 1 | **ast-grep crashes on malformed source file** | Process exit code ≠ 0 | Skip the problematic file. Log file path + error. Continue with remaining files. Report partial scan in results. | None — partial scan better than no scan |
| 2 | **ast-grep scan times out** (large monorepo >100K files) | Temporal activity timeout (5 min) | Activity retries with `--max-file-count` halved. If still times out, fall back to sampling: scan only `app/`, `lib/`, `src/` directories. | Low — sampled scan covers primary code |
| 3 | **LLM fails to generate valid Semgrep YAML** | Zod validation rejects output OR Semgrep YAML syntax check fails | Retry once with adjusted prompt including the validation error. If still fails, store pattern WITHOUT semgrep_rule (informational only, not enforceable). | None — pattern exists, rule deferred |
| 4 | **LLM timeout during rule synthesis** | Temporal activity timeout (30s per pattern) | Retry via Temporal retry policy (3 attempts, exponential backoff). If all fail, pattern stored without semgrep_rule. | None — pattern available, rule pending |
| 5 | **Semgrep CLI not installed on worker** | `which semgrep` returns empty | `check_rules` falls back to rule-text-only mode: return rules without running Semgrep enforcement. Log error. Dashboard shows "Semgrep not available — enforcement degraded." | Low — rules still informational |
| 6 | **Semgrep execution timeout on check_rules** | Process timeout (10s) | Kill Semgrep process. Return rules without violation data. Log timeout with code size. | None — rules returned, violations unknown |
| 7 | **ArangoDB down during pattern store** | Write throws `ArangoError` | Retry 3× (200ms, 400ms, 800ms). If all fail, log error and continue. Patterns will be re-detected on next indexing cycle. | Low — patterns are re-derivable |
| 8 | **Concurrent pattern detection for same repo** | Temporal workflow ID dedup (`detect-patterns-{orgId}-{repoId}`) | Second workflow request is rejected by Temporal (existing workflow running). Caller receives "already in progress" response. | None — dedup by design |
| 9 | **User creates rule with invalid Semgrep YAML** | `validateSemgrepYaml()` check on save | Return validation error to user. Rule saved as `draft` (not `active`) until YAML is fixed. | None — draft rules not enforced |
| 10 | **Rule resolution returns too many rules (>50)** | Count check in `resolveRules()` | Cap at 50 most specific/highest-priority rules. Log warning with full count. Return `meta.truncated: true`. | Low — most relevant rules returned |
| 11 | **Louvain community detection OOM on large graph** | Memory monitoring in `extractTopology` activity | Cap graph at 50K entities. For larger repos, sample by top-level directories. If OOM, retry with smaller sample. Pattern mining is non-critical — repo stays usable. | None — mined patterns are supplementary |
| 12 | **Rule exception edge orphaned (entity deleted during refactor)** | Periodic cleanup query: edges where `_from` entity no longer exists | Auto-revoke orphaned exceptions on next detection cycle. Log warning. Dashboard shows "Exception target removed." | None — exception no longer needed |

### 1.3.2 Deterministic Enforcement Guarantee

**Critical invariant:** At check time (`check_rules`, `check_patterns`), NO LLM calls are made. Semgrep rules are pre-generated YAML executed deterministically. This means:
- **No hallucinations** — findings are exact structural matches
- **No latency variance** — Semgrep execution time is predictable
- **No cost per check** — zero LLM tokens consumed
- **Reproducible** — same code + same rules = same findings, always

The LLM is involved only during:
1. Pattern detection → rule synthesis (background, async)
2. Rule creation from examples (human-triggered, async)
3. `suggest_approach` tool (on-demand, explicit LLM usage)

### 1.3.3 Pattern Stability Across Re-Detection

When `detectPatternsWorkflow` runs after incremental indexing, patterns may change. Stability rules:

- **Pinned patterns** are never overwritten or removed. Adherence rate and evidence are updated, but status stays `pinned`.
- **Dismissed patterns** are never resurrected. If re-detected, they stay `dismissed`.
- **Promoted patterns** (converted to rules) stay `promoted`. The derived rule is independent.
- **Active patterns** may have their adherence rate updated. If adherence drops below 0.5, status changes to `dismissed` (auto-cleanup).
- **New patterns** are only created if a new structural convention is detected (new ast-grep query match). Hash-based dedup prevents duplicates.

---

## 1.4 Performance Considerations

### 1.4.1 Latency Budgets

| Operation | Target Latency | Bottleneck | Mitigation |
|---|---|---|---|
| **get_rules** | <100ms | ArangoDB query + path glob matching | Composite index on `{org_id, repo_id, status}`. Glob matching is in-memory (minimatch on ~50 rules max). Cache resolved rules in Redis (TTL 60s, keyed by `org:repo:branch:user:path`). |
| **check_rules (with Semgrep)** | <2s | Semgrep CLI startup + rule execution | Semgrep CLI is pre-warmed on worker startup. Temp files for code + rules are in `/tmp` (RAM disk). Cap code snippet at 10KB. Cap rules at 30 per check. |
| **check_rules (without Semgrep)** | <100ms | Rule resolution only | Same as get_rules — no Semgrep overhead. |
| **get_conventions** | <150ms | ArangoDB query + sort | Index on `{org_id, repo_id, status, adherence_rate}`. Limit to top 30 patterns. |
| **suggest_approach** | <3s | Semantic search + rule resolution + LLM (if needed) | Semantic search (Phase 3) is <500ms. Rule resolution <100ms. LLM call for template synthesis <2s (gpt-4o-mini). |
| **astGrepScan (full repo)** | <60s per 10K files | ast-grep parsing + pattern matching | ast-grep uses Tree-sitter (native speed). Parallelize across CPU cores via worker threads. Skip binary/vendor files. |
| **llmSynthesizeRules (batch)** | <30s for 20 patterns | LLM round-trips | Batch patterns into groups of 5. Parallelize 4 concurrent LLM calls. Token budget: 3K input + 600 output per pattern. |
| **detectPatternsWorkflow (complete)** | <5 min for 50K file repo | ast-grep scan + LLM synthesis | Scan is CPU-bound (heavy queue). Synthesis is IO-bound (light queue). Store is fast. Total: scan (60s) + synthesize (30s) + store (5s). |

### 1.4.2 Caching Strategy

**Rule resolution cache (Redis):**
- Key: `unerr:rules:{orgId}:{repoId}:{branch}:{userId}:{pathHash}`
- Value: JSON array of resolved rules
- TTL: 60 seconds
- Invalidation: On rule create/update/delete, clear all keys matching `unerr:rules:{orgId}:*`

**Pattern cache (Redis):**
- Key: `unerr:patterns:{orgId}:{repoId}:{status}`
- Value: JSON array of patterns
- TTL: 300 seconds (5 min — patterns change less frequently than rules)
- Invalidation: On pattern upsert, clear matching key

**Why 60s TTL for rules:** Rules can be created via dashboard at any time. A 60s stale window is acceptable — the agent will see the new rule within a minute. Shorter TTLs would increase Redis load without meaningful benefit.

### 1.4.3 ast-grep Worker Concurrency

The `astGrepScan` activity runs on `heavy-compute-queue` (same as SCIP indexing). To avoid starving indexing activities:

- Max concurrent pattern scans: 2 per worker (Temporal activity concurrency limit)
- Pattern scan priority: lower than indexing (indexing is the critical path)
- If worker is busy with SCIP, pattern scan queues until a slot opens

---

## 1.4a Hybrid Rule Evaluation — Semantic + Syntactic Two-Pass Engine

Standard ast-grep/Semgrep scans are purely syntactic — they find structural matches but have no concept of *why* the code exists. A "missing rate limiter" violation in an internal health-check route is noise. The Hybrid Rule Evaluation engine adds a semantic second pass using Phase 4's `feature_area` and `business_value` annotations from ArangoDB.

### Two-Pass Algorithm

```
evaluateHybrid(code, filePath, rules, orgContext):

  // ─── Pass 1: Syntactic (fast, deterministic) ───
  syntacticHits = []
  FOR EACH rule IN rules WHERE rule.semgrepRule IS NOT NULL:
    findings = semgrep.matchRule(code, rule.semgrepRule)
    syntacticHits.push(...findings.map(f => ({ rule, finding: f })))

  // ─── Pass 2: Semantic Enrichment (ArangoDB lookup) ───
  enrichedViolations = []
  FOR EACH hit IN syntacticHits:
    // Lookup the entity in ArangoDB by file + line
    entity = graphStore.findEntityByFileLine(orgContext, filePath, hit.finding.line)

    IF entity IS NULL:
      // No entity mapping — trust syntactic result as-is
      enrichedViolations.push({ ...hit, semanticContext: null, confidence: 0.7 })
      CONTINUE

    // Fetch Phase 4 justification data
    justification = graphStore.getJustification(orgContext, entity._key)
    featureArea = justification?.feature_area
    businessValue = justification?.business_value

    // Apply semantic filters
    IF hit.rule.semanticFilter:
      match = evaluateSemanticFilter(hit.rule.semanticFilter, {
        featureArea, businessValue, entity.kind, entity.name
      })
      IF NOT match:
        // Semantic context says this rule doesn't apply here
        SKIP (do not include in violations)
        CONTINUE

    enrichedViolations.push({
      ...hit,
      semanticContext: { featureArea, businessValue, entityKind: entity.kind },
      confidence: calculateConfidence(hit, justification)
    })

  RETURN {
    violations: enrichedViolations,
    syntacticTotal: syntacticHits.length,
    semanticFiltered: syntacticHits.length - enrichedViolations.length,
    meta: { twoPassEnabled: true }
  }
```

### Semantic Filter Syntax (on RuleDoc)

Rules gain an optional `semanticFilter` field:

```json
{
  "title": "Rate limiting on all public endpoints",
  "enforcement": "block",
  "semgrepRule": "...",
  "semanticFilter": {
    "feature_area": { "$in": ["api", "webhook", "public"] },
    "business_value": { "$gte": "medium" },
    "entity_kind": { "$nin": ["test", "fixture"] }
  }
}
```

This tells the engine: only enforce this rule on entities in public-facing feature areas with medium+ business value, excluding test fixtures. The filter uses MongoDB-like query syntax evaluated in-memory against the Phase 4 justification data.

### Confidence Scoring

```
calculateConfidence(syntacticHit, justification):
  base = 0.6                            // syntactic match alone
  IF justification EXISTS:
    base += 0.15                         // entity has Phase 4 context
    IF justification.business_value IN ["high", "critical"]:
      base += 0.15                       // high-value code = higher confidence
    IF justification.feature_area matches rule.semanticFilter:
      base += 0.10                       // semantic alignment
  RETURN min(base, 1.0)
```

---

## 1.4b Context-Aware Rule RAG — JIT Rule Injection

The naive approach to `get_rules` dumps all matching rules into the agent's context window. For large codebases with 200+ rules, this wastes tokens and dilutes attention. JIT Rule Injection queries the knowledge graph to select only rules relevant to the entities the agent is about to touch.

### `get_relevant_rules` MCP Tool

```
get_relevant_rules({ entity_keys: string[], filePath?: string }):

  // Step 1: Resolve the sub-graph around target entities
  subGraph = graphStore.traverseNeighbors(orgContext, entity_keys, {
    depth: 2,                            // 2-hop neighborhood
    edgeTypes: ["calls", "imports", "belongs_to", "depends_on"]
  })

  // Step 2: Extract context signals from the sub-graph
  signals = {
    featureAreas: unique(subGraph.entities.map(e => e.feature_area)),
    designPatterns: unique(subGraph.entities.map(e => e.design_pattern)),
    entityKinds: unique(subGraph.entities.map(e => e.kind)),
    importBoundaries: extractImportBoundaries(subGraph.edges),
    layerViolations: detectLayerViolations(subGraph)
  }

  // Step 3: Score each candidate rule by relevance
  allRules = resolveRules(orgContext)     // full resolution
  scoredRules = allRules.map(rule => ({
    rule,
    relevance: scoreRelevance(rule, signals)
  }))

  // Step 4: Return top-K most relevant (default K=10)
  topRules = scoredRules
    .filter(r => r.relevance > 0.3)       // minimum relevance threshold
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 10)

  RETURN {
    rules: topRules.map(r => formatRuleForAgent(r.rule)),
    context: {
      featureAreas: signals.featureAreas,
      entitiesAnalyzed: entity_keys.length,
      rulesConsidered: allRules.length,
      rulesReturned: topRules.length
    }
  }
```

### Relevance Scoring

```
scoreRelevance(rule, signals):
  score = 0.0

  // Path match (strongest signal)
  IF rule.pathGlob AND filePath matches rule.pathGlob:
    score += 0.4

  // Feature area overlap
  IF rule.semanticFilter?.feature_area:
    overlap = intersect(rule.semanticFilter.feature_area.$in, signals.featureAreas)
    score += 0.25 * (overlap.length / rule.semanticFilter.feature_area.$in.length)

  // Entity kind match
  IF rule.entityKinds:
    IF any(signals.entityKinds IN rule.entityKinds):
      score += 0.2

  // Import boundary relevance
  IF rule.type == "architectural":
    IF any(signals.importBoundaries overlaps rule.description):
      score += 0.15

  RETURN min(score, 1.0)
```

### Token Savings

| Scenario | Naive `get_rules` | JIT `get_relevant_rules` | Savings |
|---|---|---|---|
| 200 org rules, editing a utility function | ~12K tokens | ~1.5K tokens (8 rules) | **87%** |
| 50 repo rules, editing an API route | ~3K tokens | ~1K tokens (5 rules) | **67%** |
| 300 rules, editing a test file | ~18K tokens | ~600 tokens (3 rules) | **97%** |

---

## 1.4c Automated Subgraph Pattern Mining

Not all codebase conventions are written as explicit rules. Many are emergent — recurring topological structures in the knowledge graph that represent unwritten agreements. Subgraph Pattern Mining discovers these implicit rules automatically.

### Pattern Mining Pipeline

```
patternMiningWorkflow(orgId, repoId):
  // Activity 1: Extract topology (heavy-compute-queue)
  topology = extractTopology(orgId, repoId)
    // a) Query ArangoDB for all entities + edges in the repo
    // b) Build a graphology graph in memory
    // c) Run Louvain community detection → identify clusters
    // d) Within each cluster, extract motifs (recurring subgraph shapes):
    //    - "every service class has a companion factory"
    //    - "every API route imports from a shared middleware set"
    //    - "every React component has a colocated test file"

  // Activity 2: Validate motifs via frequency (light-llm-queue)
  validMotifs = []
  FOR EACH motif IN topology.motifs:
    IF motif.frequency >= 3 AND motif.adherence >= 0.7:
      // LLM synthesizes a human-readable description
      description = await llm.generateObject({
        schema: MinedPatternDescriptionSchema,
        prompt: `Describe this recurring code structure:
          Motif shape: ${motif.shape}
          Examples: ${motif.instances.slice(0, 5).map(formatInstance)}
          Non-examples: ${motif.nonInstances.slice(0, 2).map(formatInstance)}`
      })
      validMotifs.push({ ...motif, description })

  // Activity 3: Store mined patterns (light-llm-queue)
  FOR EACH motif IN validMotifs:
    graphStore.upsertMinedPattern(orgId, {
      _key: `mined_${hash(motif.shape + repoId)}`,
      shape: motif.shape,                 // serialized subgraph template
      frequency: motif.frequency,
      adherence: motif.adherence,
      instances: motif.instances,
      description: description.text,
      suggestedRuleTitle: description.ruleTitle,
      status: "discovered"                // discovered → reviewed → promoted | dismissed
    })

  RETURN { minedPatterns: validMotifs.length }
```

### Motif Detection Algorithm

```
extractMotifs(graph):
  motifs = {}

  // For each entity kind (class, function, file):
  FOR EACH kind IN ["class", "function", "file"]:
    entities = graph.filterNodes(n => n.kind == kind)

    FOR EACH entity IN entities:
      // Extract 1-hop ego graph (entity + direct neighbors + connecting edges)
      egoGraph = graph.egoGraph(entity, { radius: 1 })

      // Normalize: replace specific names with placeholders
      //   "UserService → UserFactory" becomes "Service → Factory"
      normalized = normalizeEgoGraph(egoGraph)

      // Hash the normalized shape
      shapeHash = SHA256(serialize(normalized))

      IF shapeHash NOT IN motifs:
        motifs[shapeHash] = { shape: normalized, instances: [], nonInstances: [] }
      motifs[shapeHash].instances.push(entity)

    // Find non-instances: entities of the same kind that DON'T have this shape
    FOR EACH (shapeHash, motif) IN motifs:
      FOR EACH entity IN entities:
        IF entity NOT IN motif.instances:
          motif.nonInstances.push(entity)

      motif.frequency = motif.instances.length
      motif.adherence = motif.instances.length / entities.length

  RETURN Object.values(motifs)
```

### Dashboard Integration

Mined patterns appear in a separate "Discovered" tab on the Pattern Library page:
- **Motif visualization**: Miniature sub-graph diagram showing the topological shape
- **Instances**: List of entities following the pattern
- **Non-instances**: Entities that deviate (potential rule violations once promoted)
- **Actions**: Review → Promote to Rule, Dismiss, Request More Evidence

---

## 1.4d Auto-Remediation Generation — Shift-Left Fixing

When `check_rules` finds a `block`-level violation, the agent must fix it before presenting code to the user. Today, the agent guesses the fix based on the rule description and example. Auto-Remediation provides exact AST-based patches using ast-grep's `fix:` directive.

### ast-grep Fix Directive

```yaml
# Example: Force catch(error: unknown) instead of catch(error)
id: unerr.catch-unknown-error
language: typescript
rule:
  pattern: catch ($ERR) { $$$ }
  not:
    pattern: catch ($ERR: unknown) { $$$ }
fix: "catch ($ERR: unknown) { $$$ }"
```

The `fix:` field defines the structural replacement. ast-grep applies it via AST transformation — not string replacement — so it handles whitespace, comments, and formatting correctly.

### Auto-Remediation Pipeline

```
autoRemediate(code, filePath, violations):
  patches = []

  FOR EACH violation IN violations:
    rule = violation.rule

    // Only auto-fix if rule has a fix directive
    IF rule.astGrepFix IS NULL:
      patches.push({
        rule: rule.title,
        type: "manual",
        suggestion: rule.example        // fallback: show example
      })
      CONTINUE

    // Apply ast-grep fix
    fixedCode = astGrep.rewrite(code, {
      rule: rule.astGrepQuery,
      fix: rule.astGrepFix,
      language: inferLanguage(filePath)
    })

    // Compute diff
    diff = computeStructuralDiff(code, fixedCode)

    patches.push({
      rule: rule.title,
      type: "auto",
      diff: diff,                        // unified diff format
      fixedCode: fixedCode,
      confidence: 0.95                   // AST-based = high confidence
    })

  RETURN {
    patches,
    autoFixable: patches.filter(p => p.type == "auto").length,
    manualOnly: patches.filter(p => p.type == "manual").length
  }
```

### RuleDoc Extension

```json
{
  "title": "API routes must use zod validation",
  "semgrepRule": "...",
  "astGrepFix": {
    "rule": "pattern: export async function $HANDLER($REQ, $RES) { $$BODY }",
    "fix": "export async function $HANDLER($REQ, $RES) {\n  const body = Schema.parse(await $REQ.json());\n  $$BODY\n}"
  }
}
```

### MCP Response Enhancement

`check_rules` response gains an `autoFixes` field:

```json
{
  "violations": [...],
  "autoFixes": [
    {
      "rule": "API routes must use zod validation",
      "diff": "--- original\n+++ fixed\n@@ -1,3 +1,4 @@\n export async function handler(req) {\n+  const body = Schema.parse(await req.json());\n   // ...\n }",
      "confidence": 0.95
    }
  ],
  "meta": { "autoFixable": 1, "manualOnly": 2, "totalViolations": 3 }
}
```

The Bootstrap Rule is updated: "If check_rules returns autoFixes, apply them directly. For manual-only violations, follow the rule's example."

---

## 1.4e Rule Decay & Telemetry Tracking

Rules have a lifespan. A rule created 6 months ago may no longer reflect current practice — the team may have moved on, or the rule may generate so many false positives that engineers routinely override it. The Rule Health Ledger tracks per-rule telemetry to detect decay.

### Rule Health Ledger Schema (ArangoDB)

```json
{
  "_key": "health_{ruleId}",
  "org_id": "org_abc",
  "rule_id": "rule_xyz",
  "evaluations": 1284,              // total times rule was evaluated
  "violations_found": 342,          // total violations detected
  "violations_fixed": 298,          // violations that were fixed after detection
  "overrides": 44,                  // times the violation was overridden (not fixed)
  "override_authors": ["user_a", "user_b", "user_c"],
  "false_positive_reports": 12,     // explicit "not a real violation" reports
  "last_violation_at": "2026-02-19T...",
  "last_override_at": "2026-02-20T...",
  "decay_score": 0.35,              // 0.0 (healthy) → 1.0 (decayed)
  "updated_at": "2026-02-21T..."
}
```

### Decay Score Algorithm

```
calculateDecayScore(health):
  overrideRate = health.overrides / max(health.violations_found, 1)
  falsePositiveRate = health.false_positive_reports / max(health.evaluations, 1)
  recency = daysSince(health.last_violation_at)

  // Weighted decay formula
  decay = (
    0.40 * overrideRate +             // high override rate = stale rule
    0.30 * falsePositiveRate +        // high FP rate = bad rule
    0.20 * sigmoid(recency - 90) +    // no violations in 90+ days = unused
    0.10 * (1 - health.violations_fixed / max(health.violations_found, 1))
  )

  RETURN clamp(decay, 0.0, 1.0)
```

### Deprecation Workflow

```
ruleDeprecationWorkflow(orgId, ruleId):
  health = graphStore.getRuleHealth(orgId, ruleId)

  IF health.decay_score < 0.6:
    RETURN { action: "none", reason: "Rule is healthy" }

  // Check if 3+ consecutive overrides by senior engineers
  recentOverrides = graphStore.getRecentOverrides(orgId, ruleId, limit: 5)
  seniorOverrides = recentOverrides.filter(o => o.userRole IN ["admin", "owner"])

  IF seniorOverrides.length >= 3:
    // Auto-downgrade enforcement
    rule = graphStore.getRule(orgId, ruleId)
    IF rule.enforcement == "block":
      graphStore.updateRule(orgId, ruleId, { enforcement: "warn" })
      notify(orgId, {
        type: "rule_downgraded",
        message: `Rule "${rule.title}" downgraded from block → warn (override rate: ${overrideRate}%)`
      })
    ELSE IF rule.enforcement == "warn":
      graphStore.updateRule(orgId, ruleId, { enforcement: "suggest" })
      notify(orgId, { type: "rule_downgraded", ... })
    ELSE:
      // Already at suggest level — flag for review
      graphStore.updateRule(orgId, ruleId, { status: "review_needed" })
      notify(orgId, {
        type: "rule_review_needed",
        message: `Rule "${rule.title}" has high decay score (${health.decay_score}). Consider archiving.`
      })
```

### Dashboard Health Indicators

Each rule in the Rules Management page gains a health indicator:
- **Green** (decay < 0.3): Healthy — rule is actively enforced and rarely overridden
- **Yellow** (0.3 ≤ decay < 0.6): Aging — override rate increasing, may need review
- **Red** (decay ≥ 0.6): Decayed — rule is frequently overridden, consider deprecation
- **Gray** (no evaluations): Dormant — rule has never been evaluated

---

## 1.4f Blast Radius Simulation — Dry Run Rollout

Before enforcing a new `block`-level rule across the codebase, teams need to understand the impact. Blast Radius Simulation runs a new rule as `STAGED` against the entire codebase, producing an Impact Report without actually blocking any agents.

### STAGED Rule Lifecycle

```
                    ┌──────────┐
                    │  STAGED  │ ← New rule created with status "staged"
                    └────┬─────┘
                         │
                    ┌────▼─────┐
                    │ SIMULATE │ ← Background workflow scans entire codebase
                    └────┬─────┘
                         │
                    ┌────▼──────────────┐
                    │  IMPACT REPORT    │ ← Dashboard shows: N violations,
                    │  (ready for       │   M files affected, K teams impacted
                    │   review)         │
                    └────┬──────────────┘
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
         ┌────────┐ ┌────────┐ ┌─────────┐
         │ ACTIVE │ │ MODIFY │ │ DISCARD │
         └────────┘ └────────┘ └─────────┘
```

### Simulation Workflow

```
simulateRuleWorkflow(orgId, repoId, ruleId):
  rule = graphStore.getRule(orgId, ruleId)
  ASSERT rule.status == "staged"

  // Activity 1: Scan workspace with rule (heavy-compute-queue)
  workspacePath = getWorkspacePath(orgId, repoId)
  IF rule.semgrepRule:
    findings = patternEngine.scanPatterns(workspacePath, rule.semgrepRule)
  ELSE IF rule.astGrepQuery:
    findings = patternEngine.scanWithAstGrep(workspacePath, [rule.astGrepQuery])
  ELSE:
    findings = []   // non-structural rule — manual review only

  // Activity 2: Enrich findings with ownership (light-llm-queue)
  enrichedFindings = []
  FOR EACH finding IN findings:
    entity = graphStore.findEntityByFileLine(orgContext, finding.file, finding.line)
    IF entity:
      justification = graphStore.getJustification(orgContext, entity._key)
      enrichedFindings.push({
        ...finding,
        featureArea: justification?.feature_area,
        businessValue: justification?.business_value,
        lastModifiedBy: entity.last_modified_by
      })

  // Activity 3: Generate Impact Report (light-llm-queue)
  impactReport = {
    ruleId: ruleId,
    ruleTitle: rule.title,
    totalViolations: enrichedFindings.length,
    affectedFiles: unique(enrichedFindings.map(f => f.file)).length,
    affectedFeatureAreas: groupBy(enrichedFindings, 'featureArea'),
    affectedAuthors: unique(enrichedFindings.map(f => f.lastModifiedBy)),
    violationsByBusinessValue: groupBy(enrichedFindings, 'businessValue'),
    sampleViolations: enrichedFindings.slice(0, 10),
    estimatedFixEffort: estimateFixEffort(enrichedFindings, rule),
    generatedAt: new Date()
  }

  // Store report
  graphStore.upsertImpactReport(orgId, impactReport)

  RETURN impactReport
```

### Impact Report Dashboard Card

The impact report is shown on the rule detail page with:
- **Violation count**: Total findings across the codebase
- **File heatmap**: Files with most violations highlighted
- **Team impact**: Which feature areas / authors are affected
- **Business value breakdown**: Violations in high-value vs low-value code
- **Sample violations**: First 10 findings with code snippets
- **Estimated fix effort**: Based on auto-remediable count vs manual-only
- **Action buttons**: Activate Rule, Modify Rule, Discard Rule

---

## 1.4g Time-Bound Exception Ledger

Sometimes code legitimately violates a rule — a legacy module awaiting refactor, a vendor integration with unavoidable patterns, a temporary workaround with a fix scheduled. The Exception Ledger provides time-bound rule exemptions instead of permanently dismissing violations.

### RuleException Edge (ArangoDB)

```json
{
  "_from": "entities/entity_abc123",     // the entity with the exception
  "_to": "rules/rule_xyz",              // the rule being excepted
  "type": "RuleException",
  "reason": "Legacy billing integration — refactor planned for Q2 2026",
  "granted_by": "user_789",
  "granted_at": "2026-02-21T10:00:00Z",
  "expires_at": "2026-03-23T10:00:00Z", // 30-day default TTL
  "status": "active",                    // active | expired | revoked
  "jira_ticket": "KAP-1234"            // optional: linked tracking ticket
}
```

### Exception Resolution in Rule Evaluation

```
resolveExceptions(violations, orgContext):
  FOR EACH violation IN violations:
    // Check for active exception
    exception = graphStore.queryEdges(orgContext, {
      _from: violation.entityKey,
      _to: violation.ruleId,
      type: "RuleException",
      status: "active"
    })

    IF exception AND exception.expires_at > now():
      violation.excepted = true
      violation.exceptionReason = exception.reason
      violation.exceptionExpires = exception.expires_at
      // Downgrade enforcement to "suggest" for excepted violations
      violation.effectiveEnforcement = "suggest"
    ELSE IF exception AND exception.expires_at <= now():
      // Exception expired — mark it
      graphStore.updateEdge(orgContext, exception._key, { status: "expired" })
      violation.excepted = false
      violation.exceptionExpired = true
      violation.exceptionExpiredAt = exception.expires_at

  RETURN violations
```

### MCP Behavior

When an exception is nearing expiry (within 7 days), `get_rules` includes a proactive flag:

```json
{
  "rules": [...],
  "expiringExceptions": [
    {
      "entity": "lib/billing/legacy-adapter.ts:PaymentProcessor",
      "rule": "No direct database access from service layer",
      "expiresIn": "5 days",
      "reason": "Legacy billing integration",
      "jiraTicket": "KAP-1234"
    }
  ]
}
```

### Dashboard Integration

- **Exception creation**: On any violation, "Grant Exception" button with reason field, TTL picker (7/14/30/60/90 days), optional JIRA ticket link
- **Exception overview**: List of all active exceptions sorted by expiry date
- **Expiry alerts**: Banner for exceptions expiring within 7 days
- **Audit trail**: Full history of grants, revocations, and expirations

---

## 1.4h LLM-Assisted Rule Compilation

Writing ast-grep YAML rules requires structural pattern expertise. Most engineers think in natural language: "API routes should validate request bodies with zod." The Rule Compiler translates natural language descriptions into validated ast-grep YAML rules via LLM.

### `draft_architecture_rule` MCP Tool

```
draft_architecture_rule({ description: string, examples?: string[], language?: string }):

  // Step 1: Generate ast-grep YAML via LLM
  result = await llm.generateObject({
    schema: AstGrepRuleSchema,           // Zod schema for ast-grep YAML
    prompt: `Generate an ast-grep YAML rule for the following requirement:

      Requirement: ${description}
      Language: ${language || "typescript"}
      ${examples ? `Examples of correct code:\n${examples.join('\n')}` : ''}

      The rule should:
      1. Use ast-grep pattern syntax (Tree-sitter based)
      2. Include a descriptive 'id' field
      3. Include 'rule.pattern' and optionally 'rule.not.pattern'
      4. Include a 'fix' directive if possible
      5. Be specific enough to avoid false positives

      Return the YAML rule as a structured object.`
  })

  // Step 2: Validate the generated YAML
  yamlString = yaml.stringify(result)
  validation = patternEngine.validateSemgrepYaml(yamlString)

  IF NOT validation.valid:
    // Retry with error context
    result = await llm.generateObject({
      schema: AstGrepRuleSchema,
      prompt: `The previous rule had validation errors: ${validation.errors.join(', ')}.
               Fix the rule and try again. Original requirement: ${description}`
    })
    yamlString = yaml.stringify(result)
    validation = patternEngine.validateSemgrepYaml(yamlString)

  // Step 3: Return draft for human review
  RETURN {
    draft: {
      title: result.id.replace('unerr.', '').replace(/-/g, ' '),
      astGrepQuery: yamlString,
      semgrepRule: convertToSemgrep(result),    // if applicable
      astGrepFix: result.fix || null,
      language: language || "typescript",
      type: inferRuleType(description),
      enforcement: "suggest"                     // always start as suggest
    },
    validation: validation,
    status: validation.valid ? "ready_for_review" : "needs_manual_edit"
  }
```

### AstGrepRuleSchema (Zod)

```typescript
const AstGrepRuleSchema = z.object({
  id: z.string().regex(/^unerr\./),
  language: z.enum(["typescript", "javascript", "python", "go", "rust"]),
  rule: z.object({
    pattern: z.string(),
    not: z.object({ pattern: z.string() }).optional(),
    inside: z.object({ pattern: z.string() }).optional(),
    has: z.object({ pattern: z.string() }).optional(),
  }),
  fix: z.string().optional(),
  message: z.string(),
  severity: z.enum(["error", "warning", "info"]).default("warning"),
})
```

### Workflow Integration

The `draft_architecture_rule` tool returns a draft — it does NOT automatically create a rule. The human must review and confirm:

1. Agent calls `draft_architecture_rule` with natural language description
2. unerr returns draft YAML + validation status
3. Agent presents draft to user: "I've drafted a rule for your requirement. Here's the ast-grep YAML..."
4. User reviews and approves via dashboard or CLI
5. Rule created with `status: "staged"` (triggers Blast Radius Simulation)

---

## 1.4i Polyglot Semantic Mapping

Enterprise codebases are polyglot — a single business concept like "validate API requests" may be implemented differently in TypeScript (zod), Python (pydantic), and Go (struct tags). Polyglot Semantic Mapping enforces business-intent-level rules across languages with language-specific syntax payloads.

### Data Model

```
Business Intent Node (in `rules` collection):
{
  "_key": "rule_validate_api_requests",
  "title": "All API routes must validate request bodies",
  "type": "architectural",
  "scope": "org",
  "enforcement": "block",
  "polyglot": true,                        // flag: this rule has language variants
  "languages": ["typescript", "python", "go"]
}

LanguageImplementation Edges (in `language_implementations` edge collection):
{
  "_from": "rules/rule_validate_api_requests",
  "_to": "rules/rule_validate_api_requests",     // self-referencing (payload on edge)
  "language": "typescript",
  "semgrepRule": "rules:\n  - id: unerr.ts-zod-validation\n    pattern: ...",
  "astGrepQuery": "rule:\n  pattern: const $S = z.object({ $$$ })\n  ...",
  "astGrepFix": "...",
  "example": "const body = RequestSchema.parse(await req.json());",
  "counterExample": "const body = await req.json();"
}

{
  "_from": "rules/rule_validate_api_requests",
  "_to": "rules/rule_validate_api_requests",
  "language": "python",
  "semgrepRule": "rules:\n  - id: unerr.py-pydantic-validation\n    pattern: ...",
  "astGrepQuery": "rule:\n  pattern: class $Model(BaseModel): ...",
  "example": "body = RequestModel(**await request.json())",
  "counterExample": "body = await request.json()"
}

{
  "_from": "rules/rule_validate_api_requests",
  "_to": "rules/rule_validate_api_requests",
  "language": "go",
  "semgrepRule": "rules:\n  - id: unerr.go-struct-validation\n    pattern: ...",
  "astGrepQuery": "rule:\n  pattern: type $Name struct { $$$ `validate:\"$$$\"` }",
  "example": "type Request struct { Name string `validate:\"required\"`  }",
  "counterExample": "type Request struct { Name string }"
}
```

### Query Resolution with Language Selection

```
resolvePolyglotRules(orgContext, filePath):
  language = inferLanguage(filePath)     // "typescript", "python", "go", etc.
  rules = resolveRules(orgContext)

  FOR EACH rule IN rules:
    IF rule.polyglot:
      // Fetch language-specific implementation
      langImpl = graphStore.queryEdges(orgContext, {
        _from: `rules/${rule._key}`,
        type: "LanguageImplementation",
        language: language
      })

      IF langImpl:
        // Replace generic rule with language-specific payload
        rule.semgrepRule = langImpl.semgrepRule
        rule.astGrepQuery = langImpl.astGrepQuery
        rule.astGrepFix = langImpl.astGrepFix
        rule.example = langImpl.example
        rule.counterExample = langImpl.counterExample
      ELSE:
        // No implementation for this language — skip or return as informational
        rule.enforcement = "suggest"
        rule.noLanguageImpl = true

  RETURN rules
```

### Dashboard Support

The rule creation form gains a "Polyglot" toggle. When enabled:
- Language tabs appear (TypeScript, Python, Go, Rust, etc.)
- Each tab has its own: Semgrep rule, ast-grep query, fix directive, example/counter-example
- The rule title and description are shared across languages
- A "Generate for Language" button uses the Rule Compiler to auto-draft implementations for additional languages

---

## 1.4j Recommended Package Integrations

| Package | Purpose | Phase 6 Usage |
|---|---|---|
| **`@ast-grep/napi`** | Tree-sitter-based structural code search (native Node.js bindings) | Core detection engine: pattern scanning, fix generation, structural matching. Already specified in P6-INFRA-01. |
| **`zod` + `yaml`** | Schema validation + YAML serialization | LLM rule compilation: `generateObject()` with `AstGrepRuleSchema` → validated ast-grep YAML. Draft rules round-trip through Zod → YAML → validate → store. |
| **`execa`** | Safe subprocess execution (replaces `child_process`) | Semgrep CLI invocation: `execa('semgrep', ['--config', ...])` with timeout, stdio capture, and clean error handling. Avoids shell injection risks of `exec()`. |
| **`graphology-communities`** | Louvain community detection for graphs | Subgraph Pattern Mining: cluster entities into communities, extract recurring motifs within and across communities. Part of the `graphology` ecosystem (already lightweight). |

---

## 1.5 Phase Bridge → Phase 7

Phase 6 establishes the enforcement infrastructure that Phase 7 (PR Review) directly consumes:

### What Phase 7 Inherits

| Phase 6 Artifact | Phase 7 Consumption |
|---|---|
| `rules` collection with Semgrep YAML | Phase 7's `runSemgrep` activity executes these rules against PR diffs. Same rules, same Semgrep CLI, applied to git diff instead of agent code snippets. |
| `patterns` collection with adherence rates | Phase 7's review comments reference pattern adherence: "This API route is missing rate limiting. 12/14 routes in this codebase use it (86% adherence)." |
| `IPatternEngine.scanPatterns()` | Phase 7 reuses for PR diff analysis. `scanPatterns(diffPath, rulesPath)` works on PR files. |
| `resolveRules()` | Phase 7 uses the same resolution logic to determine which rules apply to changed files in the PR. |
| `check_rules` MCP tool | Phase 7's `reviewPrWorkflow` internally calls the same check logic (not via MCP — direct function call for efficiency). |
| Bootstrap Rule with pre/post-flight | Phase 7 does not modify the Bootstrap Rule. PR review is a separate automation path. |

### What Phase 6 Must NOT Do (Respecting Phase 7 Boundaries)

1. **Must NOT implement PR webhook handling.** Phase 6 handles pattern detection and rule enforcement within MCP tool calls only. PR-triggered checks are Phase 7.
2. **Must NOT implement GitHub review comment posting.** Phase 6 returns violations to the agent or dashboard. Posting to GitHub is Phase 7.
3. **Must NOT implement impact radius analysis.** Phase 6 checks code against rules. Graph-based impact analysis of changed functions is Phase 7.
4. **Must NOT create PR-specific UI pages.** Phase 6 creates the pattern library and rules management pages. PR review history and review detail pages are Phase 7.

### Schema Forward-Compatibility

- The `PatternMatch` return type from `IPatternEngine` includes `[key: string]: unknown` — Phase 7 can add PR-specific fields (like `prNumber`, `diffLineNumber`) without breaking the interface.
- Semgrep rules in `rules` collection include `languages` field — Phase 7 uses this to filter rules by the languages present in a PR diff.
- The `semgrep_rule` field on both `patterns` and `rules` stores standard Semgrep YAML — Phase 7 can concatenate all applicable rules into a single Semgrep config file and run one scan.

---

# Part 2: Implementation & Tracing Tracker

> **Dependency graph:** Infrastructure (P6-INFRA) → Database (P6-DB) → Ports & Adapters (P6-ADAPT) → Backend (P6-API) → Frontend (P6-UI). Testing (P6-TEST) runs in parallel with each layer.
>
> **Recommended implementation order:** P6-INFRA-01 → P6-INFRA-02 → P6-DB-01 → P6-DB-02 → P6-ADAPT-01 → P6-ADAPT-02 → P6-ADAPT-03 → P6-API-01 → P6-API-02 → P6-API-03 → P6-API-04 → P6-API-05 → P6-API-06 → P6-API-07 → P6-API-08 → P6-API-09 → P6-API-10 → P6-API-11 → P6-API-12 → P6-API-13 → P6-API-15 → P6-API-16 → P6-API-17 → P6-API-18 → P6-API-19 → P6-API-20 → P6-API-14 → P6-UI-01 → P6-UI-02 → P6-UI-03 → P6-UI-04
>
> **Note:** P6-API-14 (Pattern Mining) is placed last among API items due to XL size and dependency on graphology ecosystem. P6-API-19 (Rule Compiler) must precede P6-API-20 (Polyglot Mapping) since "Generate for Language" depends on the compiler.

---

## 2.1 Infrastructure Layer

### P6-INFRA-01: ast-grep Installation & Worker Configuration

- [x] **Status:** Complete
- **Description:** Add `@ast-grep/napi` as a dependency. This is the Node.js native binding for ast-grep, providing Tree-sitter-based structural search without spawning a separate process. Configure heavy-compute worker Docker image to include ast-grep native binaries.
- **Files:**
  - `package.json` (modify — add `@ast-grep/napi`)
  - `Dockerfile.heavy-worker` or equivalent (modify — ensure native deps build)
- **Testing:** `import { lang, parse } from '@ast-grep/napi'` works. Can parse TypeScript source and find patterns.
- **Env vars (add to `env.mjs`):**
  - `HYBRID_EVALUATION_ENABLED` — Enable two-pass semantic+syntactic evaluation (default: `true`)
  - `JIT_INJECTION_ENABLED` — Enable context-aware rule RAG (default: `true`)
  - `JIT_INJECTION_DEPTH` — Sub-graph traversal depth for JIT injection (default: `2`)
  - `JIT_INJECTION_TOP_K` — Max rules returned by `get_relevant_rules` (default: `10`)
  - `PATTERN_MINING_ENABLED` — Enable automated subgraph pattern mining (default: `false`)
  - `PATTERN_MINING_MAX_ENTITIES` — Max entities for Louvain (default: `50000`)
  - `RULE_DECAY_ENABLED` — Enable rule health tracking and auto-deprecation (default: `true`)
  - `RULE_DECAY_THRESHOLD` — Decay score threshold for deprecation workflow (default: `0.6`)
  - `RULE_EXCEPTION_DEFAULT_TTL_DAYS` — Default TTL for rule exceptions (default: `30`)
  - `BLAST_RADIUS_ENABLED` — Enable blast radius simulation for STAGED rules (default: `true`)
- **Notes:** `@ast-grep/napi` requires Node.js >=16 and a compatible native binary. The npm package includes pre-built binaries for major platforms (linux-x64, darwin-arm64). Docker worker uses linux-x64.

### P6-INFRA-02: Semgrep CLI Installation & Worker Configuration

- [x] **Status:** Complete
- **Description:** Ensure Semgrep CLI is available on heavy-compute workers. Semgrep is a Python-based tool distributed as a standalone binary via `pip install semgrep` or as a Docker image. The worker needs `semgrep` on `$PATH`.
- **Options:**
  - **Option A (recommended):** Install `semgrep` via pip in the Docker build stage
  - **Option B:** Use the `semgrep/semgrep` Docker image as a base for the heavy worker
  - **Option C:** Download the Semgrep static binary at build time
- **Files:**
  - `Dockerfile.heavy-worker` or equivalent (modify — add Semgrep installation)
- **Testing:** `semgrep --version` returns a valid version. `semgrep --config /dev/null --lang ts /dev/null` doesn't crash.
- **Notes:** Semgrep is already referenced in the `SemgrepPatternEngine` stub adapter. The existing `IPatternEngine` port expects Semgrep to be available. The `@semgrep/semgrep-node` npm wrapper is NOT recommended — use the CLI directly for reliability.

---

## 2.2 Database & Schema Layer

### P6-DB-01: ArangoDB Indexes for Patterns & Rules

- [x] **Status:** Complete
- **Description:** Add composite indexes to the already-bootstrapped `patterns` and `rules` collections for efficient querying. These collections exist but only have the default `org_id`/`repo_id` tenant indexes from Phase 1.
- **Indexes to add:**
  - `patterns`: `{ org_id, repo_id, status }`, `{ org_id, repo_id, type, adherence_rate }`
  - `rules`: `{ org_id, repo_id, status }`, `{ org_id, status, scope }`, `{ org_id, repo_id, branch, workspace_user_id, status }`
- **Files:**
  - `lib/adapters/arango-graph-store.ts` (modify — add indexes in `bootstrapGraphSchema()`)
- **Testing:** Indexes created on bootstrap. AQL explain shows index scans for rule/pattern queries.
- **Notes:** Follow existing pattern: `await collection.ensureIndex({ type: "persistent", fields: [...] })`.

### P6-DB-02: Domain Types — RuleDoc & PatternDoc Expansion

- [x] **Status:** Complete
- **Description:** Replace the minimal `RuleDoc`, `PatternDoc`, `RuleFilter`, `PatternFilter` types in `lib/ports/types.ts` with complete typed interfaces as defined in § 1.2.4. Add Zod schemas for validation.
- **Files:**
  - `lib/ports/types.ts` (modify — expand interfaces)
  - `lib/rules/schema.ts` (new — Zod RuleSchema with enum constraints)
  - `lib/patterns/schema.ts` (new — Zod PatternSchema with enum constraints)
- **Testing:** Types compile. Zod schemas validate sample data. Invalid data rejected (wrong enum values, missing required fields).
- **Notes:** Follow Phase 4's pattern: Zod enums for `type`, `scope`, `enforcement`, `status` fields. This prevents free-text drift.

---

## 2.3 Ports & Adapters Layer

### P6-ADAPT-01: IGraphStore — Rules & Patterns Real Implementation

- [x] **Status:** Complete
- **Description:** Replace the stub implementations of `upsertRule`, `queryRules`, `upsertPattern`, `queryPatterns` in `ArangoGraphStore` with real AQL queries. Add new methods needed for rule resolution and pattern management.
- **Methods to implement (existing stubs):**
  - `upsertRule(orgId, rule)` — Insert or update rule by `_key`. Validate via RuleSchema.
  - `queryRules(orgId, filter)` — AQL query with filters. Support all RuleFilter fields.
  - `upsertPattern(orgId, pattern)` — Insert or update by hash key. Preserve pinned/dismissed status.
  - `queryPatterns(orgId, filter)` — AQL query with filters. Support all PatternFilter fields.
- **Methods to add (new):**
  - `deleteRule(orgId, ruleId)` — Remove rule by key.
  - `archiveRule(orgId, ruleId)` — Set status to `archived`.
  - `updatePatternStatus(orgId, patternId, status)` — Pin, dismiss, or promote.
  - `getPatternByHash(orgId, hash)` — Lookup by pattern hash (for upsert dedup).
- **Files:**
  - `lib/ports/graph-store.ts` (modify — add new method signatures)
  - `lib/adapters/arango-graph-store.ts` (modify — implement all methods)
- **Testing:** CRUD operations work. Filters produce correct results. Pinned patterns survive re-upsert. Rule validation rejects invalid data.
- **Blocked by:** P6-DB-01, P6-DB-02

### P6-ADAPT-02: SemgrepPatternEngine — Real Implementation

- [x] **Status:** Complete
- **Description:** Replace the `NotImplementedError` stubs in `SemgrepPatternEngine` with real implementations that invoke Semgrep CLI and ast-grep.
- **Implementation:**
  - `scanPatterns(workspacePath, rulesPath)`:
    a) Execute `semgrep --config {rulesPath} {workspacePath} --json --timeout 60`
    b) Parse JSON output into `PatternMatch[]`
    c) Handle Semgrep exit codes (0 = no findings, 1 = findings, other = error)
  - `matchRule(code, ruleYaml)`:
    a) Write code to temp file, write rule YAML to temp config
    b) Execute `semgrep --config {tempConfig} {tempFile} --json`
    c) Parse and return matches
    d) Clean up temp files
  - `scanWithAstGrep(workspacePath, queries)` (new):
    a) Use `@ast-grep/napi` to parse source files
    b) Run each query against parsed ASTs
    c) Collect matches with file:line evidence
    d) Calculate adherence rates
  - `validateSemgrepYaml(yamlString)` (new):
    a) Write YAML to temp file
    b) Execute `semgrep --validate --config {tempFile}`
    c) Return validation result
- **Files:**
  - `lib/adapters/semgrep-pattern-engine.ts` (modify — implement all methods)
  - `lib/ports/pattern-engine.ts` (modify — add new method signatures)
- **Testing:** Semgrep finds violations in sample code. ast-grep detects structural patterns. Valid YAML passes validation. Invalid YAML fails with error message.
- **Blocked by:** P6-INFRA-01, P6-INFRA-02

### P6-ADAPT-03: InMemoryGraphStore + FakePatternEngine — Test Fakes

- [x] **Status:** Complete
- **Description:** Update test fakes to implement the new methods.
- **Changes:**
  - `InMemoryGraphStore`: Implement real `upsertRule`, `queryRules`, `upsertPattern`, `queryPatterns` using in-memory arrays with proper filtering, sorting, and deduplication. Implement new methods (`deleteRule`, `archiveRule`, `updatePatternStatus`, `getPatternByHash`).
  - `FakePatternEngine`: Add `scanWithAstGrep` (returns configurable mock results) and `validateSemgrepYaml` (returns `{ valid: true }`).
- **Files:**
  - `lib/di/fakes.ts` (modify)
- **Testing:** All unit tests pass with fakes. Fake behavior matches production adapter behavior for core operations (filtering, sorting, status preservation).
- **Blocked by:** P6-ADAPT-01

---

## 2.4 Backend / API Layer

### P6-API-01: Detection Catalog — ast-grep Query Library

- [x] **Status:** Complete
- **Description:** Create the built-in catalog of ast-grep queries organized by pattern type. These YAML files define the structural queries that the `astGrepScan` activity runs against the codebase.
- **Initial catalog (TypeScript/JavaScript):**
  - `structural/zod-validation.yaml` — API route handlers using zod
  - `structural/rate-limiting.yaml` — Rate limiter middleware usage
  - `structural/try-catch-async.yaml` — Try/catch in async handlers
  - `structural/error-type-check.yaml` — Error type checking in catch blocks
  - `structural/response-envelope.yaml` — `{ data, error, meta }` response pattern
  - `naming/hook-prefix.yaml` — React hooks prefixed with `use`
  - `naming/constant-case.yaml` — UPPER_SNAKE_CASE for constants
  - `error-handling/catch-unknown.yaml` — `catch (error: unknown)` pattern
- **Files:**
  - `lib/patterns/catalog/` (new directory)
  - `lib/patterns/catalog/structural/` (new — YAML files)
  - `lib/patterns/catalog/naming/` (new — YAML files)
  - `lib/patterns/catalog/error-handling/` (new — YAML files)
  - `lib/patterns/catalog-loader.ts` (new — loads YAML files, validates format)
- **Testing:** All queries parse without error. Each query finds expected matches in sample code files. Catalog loader discovers all YAML files.
- **Notes:** Queries are language-scoped. TypeScript queries in `typescript/` subdirectory, Python in `python/`, etc. Start with TypeScript — expand later.

### P6-API-02: Rule Resolution Logic

- [x] **Status:** Complete
- **Description:** Implement the hierarchical rule resolution algorithm as defined in § 1.2.5. This is the core logic used by `get_rules`, `check_rules`, and internally by Phase 7.
- **Implementation:**
  - `resolveRules(ctx: RuleResolutionContext): Promise<RuleDoc[]>`
  - Path glob matching via `minimatch` (already a project dependency via Next.js)
  - Scope ordering: workspace(5) > branch(4) > path(3) > repo(2) > org(1)
  - Deduplication by title (most specific wins)
  - Cap at 50 rules (log warning if exceeded)
  - Redis cache: `unerr:rules:{orgId}:{repoId}:{branch}:{userId}:{pathHash}` (TTL 60s)
  - Cache invalidation: clear `unerr:rules:{orgId}:*` on any rule mutation
- **Files:**
  - `lib/rules/resolver.ts` (new)
- **Testing:** Org-wide rules returned when no repo-specific rules exist. Repo rules override org rules with same title. Path-scoped rules filtered correctly. Workspace rules visible only to owning user. Priority ordering works within same scope. Dedup works.
- **Blocked by:** P6-ADAPT-01

### P6-API-03: get_rules MCP Tool

- [x] **Status:** Complete
- **Description:** New MCP tool that returns applicable rules for a given file/context. Primary integration point for the Bootstrap Rule pre-flight.
- **Input schema:**
  - `filePath?: string` — File the agent is about to modify
  - `entityKind?: string` — Entity type (`function`, `class`, etc.)
- **Handler:** Call `resolveRules()` with MCP session context (orgId, repoId, branch, userId) + input fields. Return compact rule summaries (title, enforcement, description, example — no internal IDs or metadata).
- **Scope:** `mcp:read`
- **Files:**
  - `lib/mcp/tools/rules.ts` (new)
  - `lib/mcp/tools/index.ts` (modify — register tool)
- **Testing:** Returns rules scoped to file path. Empty path returns all repo + org rules. Enforcement levels correct. Redis cache hit on second call.
- **Blocked by:** P6-API-02

### P6-API-04: check_rules MCP Tool

- [x] **Status:** Complete
- **Description:** New MCP tool that validates proposed code against applicable rules. Runs Semgrep for rules with `semgrepRule` defined, returns violations.
- **Input schema:**
  - `code: string` — The code to check (max 10KB)
  - `filePath: string` — File path for rule resolution context
  - `language?: string` — Language for Semgrep (default: infer from file extension)
- **Handler:**
  1. Resolve rules via `resolveRules()`
  2. Filter to rules with `semgrepRule` defined
  3. Write code + rules to temp files
  4. Execute Semgrep via `IPatternEngine.matchRule()` or batch via `scanPatterns()`
  5. Map Semgrep findings back to rule titles
  6. Return `{ violations: [...], passed: [...], meta: { totalChecked, violations, passed } }`
- **Scope:** `mcp:read`
- **Files:**
  - `lib/mcp/tools/rules.ts` (same file as get_rules)
  - `lib/mcp/tools/index.ts` (modify — register tool)
- **Testing:** Code with violations returns findings. Clean code returns empty violations. Code exceeding 10KB truncated with warning. Semgrep unavailable → graceful degradation (rules returned without enforcement). Block-level violations flagged prominently.
- **Blocked by:** P6-ADAPT-02, P6-API-02

### P6-API-05: check_patterns MCP Tool

- [x] **Status:** Complete
- **Description:** Agent sends proposed code → unerr runs Semgrep rules from auto-detected patterns → returns violations with evidence and examples.
- **Input schema:**
  - `code: string` — Code to check
  - `filePath: string` — For context and pattern filtering
- **Handler:**
  1. Query active/pinned patterns with `semgrepRule` defined
  2. Execute Semgrep against code using pattern rules
  3. Return violations with pattern evidence (adherence rate, example/counter-example)
- **Scope:** `mcp:read`
- **Files:**
  - `lib/mcp/tools/patterns.ts` (new)
  - `lib/mcp/tools/index.ts` (modify — register tool)
- **Testing:** Violations include adherence rate and evidence count. Dismissed patterns excluded. Patterns without Semgrep rule skipped.
- **Blocked by:** P6-ADAPT-01, P6-ADAPT-02

### P6-API-06: get_conventions MCP Tool

- [x] **Status:** Complete
- **Description:** Returns a summary of detected codebase conventions — active/pinned patterns with examples.
- **Input schema:**
  - `category?: string` — Filter by pattern type (structural, naming, architectural, etc.)
  - `minAdherence?: number` — Minimum adherence rate (default: 0.7)
  - `limit?: number` — Max patterns to return (default: 20, max: 50)
- **Scope:** `mcp:read`
- **Files:**
  - `lib/mcp/tools/patterns.ts` (same file as check_patterns)
  - `lib/mcp/tools/index.ts` (modify — register tool)
- **Testing:** Returns patterns sorted by adherence rate. Category filter works. Dismissed patterns excluded. Min adherence filter works.
- **Blocked by:** P6-ADAPT-01

### P6-API-07: suggest_approach MCP Tool

- [x] **Status:** Complete
- **Description:** Agent asks "how should I implement this?" and receives a template based on existing patterns and similar code.
- **Input schema:**
  - `task: string` — What the agent is about to implement
  - `filePath?: string` — Target file path for context
- **Handler:**
  1. Resolve applicable rules for the file path
  2. Find similar existing implementations via semantic search (Phase 3 `IVectorSearch`)
  3. Extract patterns from similar files
  4. Build suggestion: similar file reference + applicable patterns + rules
  5. Optional: LLM synthesis of template (gpt-4o-mini, 2K input + 400 output)
- **Scope:** `mcp:read`
- **Files:**
  - `lib/mcp/tools/patterns.ts` (same file as check_patterns, get_conventions)
  - `lib/mcp/tools/index.ts` (modify — register tool)
- **Testing:** Returns a similar file reference. Includes applicable patterns and rules. LLM fallback works when no similar file found. Timeout handled gracefully.
- **Blocked by:** P6-API-02, P6-ADAPT-01

### P6-API-08: detectPatternsWorkflow — Temporal Workflow

- [x] **Status:** Complete
- **Description:** Pattern detection workflow. Originally three activities, now combined into one to avoid serializing pattern evidence arrays through Temporal's data converter.
- **Workflow definition:**
  - Input: `{ orgId, repoId, workspacePath, languages }`
  - Activity: `scanSynthesizeAndStore` (heavy-compute-queue, timeout: 15 min) — scan + synthesize + store all in one step; pattern evidence arrays stay inside the worker, only `{ patternsDetected, rulesGenerated }` counts cross Temporal.
  - Chained after indexing but non-blocking for repo status
- **Activities (combined inside `scanSynthesizeAndStore`):**
  - Scan: Load catalog queries, run ast-grep on workspace, compute adherence rates, filter noise
  - Synthesize: For high-adherence patterns (≥3 matches), generate rule suggestions. Validate output.
  - Store: Upsert patterns + rules to ArangoDB. Preserve pinned/dismissed status.
- **Legacy activities** (still exported for backward compatibility): `astGrepScan`, `llmSynthesizeRules`, `storePatterns`
- **Files:**
  - `lib/temporal/workflows/detect-patterns.ts` (new)
  - `lib/temporal/activities/pattern-detection.ts` (new)
  - `lib/temporal/workflows/index.ts` (modify — export)
  - `lib/temporal/activities/index.ts` (modify — export)
- **Testing:** Full pipeline: scan → synthesize → store. Partial failure: LLM timeout → pattern stored without rule. Re-detection: pinned patterns preserved. Concurrent detection: deduped by workflow ID.
- **Blocked by:** P6-API-01, P6-ADAPT-01, P6-ADAPT-02

### P6-API-09: Chaining detectPatterns After Indexing

- [x] **Status:** Complete
- **Description:** Modify `indexRepoWorkflow` and `incrementalIndexWorkflow` to chain `detectPatternsWorkflow` after successful completion. The chaining is non-blocking — the repo stays `ready` while pattern detection runs.
- **Implementation:**
  - After the last activity in indexing workflow, start `detectPatternsWorkflow` as a child workflow (or `continueAsNew` with signal)
  - If `detectPatternsWorkflow` fails, it does NOT affect the parent workflow status
  - Rate limit: don't re-detect if last detection was <1 hour ago (check `patterns` collection `updated_at`)
- **Files:**
  - `lib/temporal/workflows/index-repo.ts` (modify — add chain)
  - `lib/temporal/workflows/embed-repo.ts` (modify — or chain from here if patterns depend on embeddings)
- **Testing:** After indexing, pattern detection starts. Indexing failure → no pattern detection. Recent detection → skip. Pattern detection failure → repo stays ready.
- **Blocked by:** P6-API-08

### P6-API-10: REST API Routes for Rules & Patterns

- [x] **Status:** Complete
- **Description:** Dashboard API routes for managing rules and patterns.
- **Routes:**
  - `GET /api/repos/{repoId}/rules` — List rules (filtered by type, scope, status)
  - `POST /api/repos/{repoId}/rules` — Create rule (validates via RuleSchema)
  - `PATCH /api/repos/{repoId}/rules/{ruleId}` — Update rule fields
  - `DELETE /api/repos/{repoId}/rules/{ruleId}` — Archive rule (soft delete)
  - `GET /api/repos/{repoId}/patterns` — List patterns (filtered by type, status, adherence)
  - `PATCH /api/repos/{repoId}/patterns/{patternId}` — Pin/dismiss/un-dismiss
  - `POST /api/repos/{repoId}/rules/from-pattern` — Promote pattern to rule
  - `GET /api/settings/rules` — Org-level rules
  - `POST /api/settings/rules` — Create org-level rule
- **Auth:** Session-based (existing auth middleware). Org membership required. Rules CRUD requires admin/owner role.
- **Files:**
  - `app/api/repos/[repoId]/patterns/route.ts` (new)
  - `app/api/repos/[repoId]/patterns/[patternId]/route.ts` (new)
  - `app/api/repos/[repoId]/rules/route.ts` (new)
  - `app/api/repos/[repoId]/rules/[ruleId]/route.ts` (new)
  - `app/api/repos/[repoId]/rules/from-pattern/route.ts` (new)
  - `app/api/settings/rules/route.ts` (new)
- **Testing:** CRUD operations work. Auth enforced. Invalid data rejected. Pattern promotion creates correct rule. Redis cache invalidated on mutation.
- **Blocked by:** P6-ADAPT-01

### P6-API-11: Bootstrap Rule Extension

- [x] **Status:** Complete
- **Description:** Update the Bootstrap Rule template in `lib/onboarding/bootstrap-rule.ts` to include pre-flight `get_rules` call and post-flight `check_rules` call.
- **Changes:**
  - Pre-flight section: Add step "Call get_rules for the file you're about to modify. Follow ALL returned rules."
  - Post-flight section: Add steps "Call check_rules with your generated code. Fix any 'block' violations. Report any 'warn' violations to the user."
- **Files:**
  - `lib/onboarding/bootstrap-rule.ts` (modify)
- **Testing:** Generated Bootstrap Rule includes new pre-flight and post-flight steps. Existing steps unchanged.
- **Notes:** This is an additive change. Agents with older Bootstrap Rules still work but don't get rule injection.
- **Blocked by:** P6-API-03, P6-API-04

### P6-API-12: Hybrid Rule Evaluation Engine

- [x] **Status:** Complete
- **Size:** L
- **Description:** Implement the two-pass evaluation engine (§ 1.4a). Pass 1 runs syntactic matching via ast-grep/Semgrep. Pass 2 enriches findings with Phase 4 `feature_area`/`business_value` from ArangoDB, applies semantic filters, and computes confidence scores. Reduces false positives on internal/test code.
- **Implementation:**
  - `evaluateHybrid(code, filePath, rules, orgContext)` function
  - Semantic filter evaluation using MongoDB-like query syntax
  - Confidence scoring based on justification data
  - Fallback: if Phase 4 justifications are unavailable, trust syntactic results at 0.7 confidence
- **Files:**
  - `lib/rules/hybrid-evaluator.ts` (new)
  - `lib/rules/semantic-filter.ts` (new)
  - `lib/mcp/tools/rules.ts` (modify — integrate hybrid evaluation into `check_rules`)
- **Testing:** Semantic filter correctly suppresses violations in test fixtures. Confidence scores increase with justification data. Rules without semantic filters pass through unchanged. Phase 4 data unavailable → graceful fallback.
- **Blocked by:** P6-API-02, P6-API-04

### P6-API-13: Context-Aware Rule RAG — `get_relevant_rules` MCP Tool

- [x] **Status:** Complete
- **Size:** L
- **Description:** Implement the JIT Rule Injection tool (§ 1.4b). Instead of returning all matching rules, queries the 2-hop sub-graph around target entities to select only contextually relevant rules. Returns top-K rules scored by relevance.
- **Input schema:**
  - `entity_keys: string[]` — Entity keys the agent is about to modify
  - `filePath?: string` — File path for path-glob matching
  - `limit?: number` — Max rules to return (default: 10)
- **Implementation:**
  - Sub-graph traversal via `graphStore.traverseNeighbors()`
  - Signal extraction: feature areas, design patterns, import boundaries
  - Relevance scoring per rule (path match, feature area overlap, entity kind match)
  - Top-K selection with minimum relevance threshold (0.3)
- **Files:**
  - `lib/rules/jit-injection.ts` (new)
  - `lib/mcp/tools/rules.ts` (modify — register `get_relevant_rules` tool)
  - `lib/mcp/tools/index.ts` (modify — register tool)
- **Testing:** Returns fewer rules than `get_rules` for same context. Relevance scoring prioritizes path-matched rules. Entities with no graph neighbors → falls back to `get_rules`. Token savings ≥ 50% for repos with 100+ rules.
- **Blocked by:** P6-API-02, P6-ADAPT-01

### P6-API-14: Automated Subgraph Pattern Mining Workflow

- [x] **Status:** Complete
- **Size:** XL
- **Description:** Implement the `patternMiningWorkflow` (§ 1.4c). Three-activity Temporal workflow: extract topology (heavy) → validate motifs via LLM (light) → store mined patterns (light). Discovers implicit unwritten rules from recurring graph topologies.
- **Implementation:**
  - Activity 1: `extractTopology` — Build graphology graph from ArangoDB, run Louvain community detection, extract normalized ego-graph motifs
  - Activity 2: `validateMotifs` — Filter by frequency ≥ 3 and adherence ≥ 0.7, LLM generates human-readable descriptions
  - Activity 3: `storeMinedPatterns` — Upsert to `mined_patterns` ArangoDB collection
  - Workflow ID: `mine-patterns-{orgId}-{repoId}` (dedup)
- **Dependencies:** `graphology`, `graphology-communities` (Louvain)
- **Files:**
  - `lib/temporal/workflows/mine-patterns.ts` (new)
  - `lib/temporal/activities/pattern-mining.ts` (new)
- **Testing:** Detects "every service has a companion factory" motif in sample graph. Filters out low-frequency noise. LLM timeout → motif stored without description. Re-mining preserves reviewed/dismissed motifs.
- **Blocked by:** P6-ADAPT-01, P6-DB-01

### P6-API-15: Auto-Remediation Generation

- [x] **Status:** Complete
- **Size:** M
- **Description:** Implement the auto-remediation pipeline (§ 1.4d). When `check_rules` detects a `block`-level violation and the rule has an `astGrepFix` directive, generate an exact AST-based patch using ast-grep's `rewrite()` API.
- **Implementation:**
  - `autoRemediate(code, filePath, violations)` function
  - ast-grep `rewrite()` via `@ast-grep/napi`
  - Structural diff computation (unified diff format)
  - Integrate into `check_rules` MCP tool response as `autoFixes` field
  - RuleDoc extension: `astGrepFix` optional field
- **Files:**
  - `lib/rules/auto-remediation.ts` (new)
  - `lib/mcp/tools/rules.ts` (modify — add autoFixes to check_rules response)
  - `lib/ports/types.ts` (modify — add `astGrepFix` to RuleDoc)
- **Testing:** Fix directive produces valid code. Structural diff is correct. Rules without fix directive → fallback to example. Multiple violations → multiple patches. ast-grep rewrite failure → graceful degradation.
- **Blocked by:** P6-INFRA-01, P6-API-04

### P6-API-16: Rule Decay & Health Ledger

- [x] **Status:** Complete
- **Size:** L
- **Description:** Implement the Rule Health Ledger (§ 1.4e). Per-rule telemetry collection on every evaluation, violation, override, and false-positive report. Decay score computation. Deprecation workflow for decayed rules.
- **Implementation:**
  - `rule_health` ArangoDB collection with per-rule counters
  - Telemetry hooks in `check_rules` and `evaluateHybrid`: increment counters on each evaluation
  - `calculateDecayScore()` — weighted formula: override rate (40%), FP rate (30%), recency (20%), fix rate (10%)
  - `ruleDeprecationWorkflow` — Temporal workflow: auto-downgrade enforcement (block → warn → suggest) after 3 consecutive senior overrides
  - Dashboard health indicators: green/yellow/red/gray
- **Files:**
  - `lib/rules/health-ledger.ts` (new)
  - `lib/rules/decay-score.ts` (new)
  - `lib/temporal/workflows/rule-deprecation.ts` (new)
  - `lib/temporal/activities/rule-decay.ts` (new)
- **Testing:** Evaluation increments counter. Override increments override counter. Decay score ≥ 0.6 triggers deprecation. Auto-downgrade from block → warn. 3 senior overrides required. Decay score 0.0 for new rules.
- **Blocked by:** P6-ADAPT-01, P6-API-04

### P6-API-17: Blast Radius Simulation

- [x] **Status:** Complete
- **Size:** L
- **Description:** Implement the `simulateRuleWorkflow` (§ 1.4f). Runs a `STAGED` rule against the entire codebase in background, producing an Impact Report with violation counts, affected files, affected teams, and business value breakdown.
- **Implementation:**
  - `status: "staged"` added to Rule status enum
  - `simulateRuleWorkflow` — 3-activity Temporal workflow: scan workspace → enrich with ownership → generate impact report
  - Impact Report stored in ArangoDB (`impact_reports` collection)
  - Dashboard: Impact Report card on rule detail page with heatmap, team breakdown, sample violations
  - Action buttons: Activate / Modify / Discard
- **Files:**
  - `lib/temporal/workflows/simulate-rule.ts` (new)
  - `lib/temporal/activities/rule-simulation.ts` (new)
  - `lib/rules/impact-report.ts` (new — report generation logic)
- **Testing:** STAGED rule scanned against workspace. Impact report has correct violation count. Enrichment includes feature areas and authors. Report stored in ArangoDB. Activation changes status from staged → active.
- **Blocked by:** P6-ADAPT-02, P6-API-02

### P6-API-18: Time-Bound Exception Ledger

- [x] **Status:** Complete
- **Size:** M
- **Description:** Implement the Exception Ledger (§ 1.4g). `RuleException` edges in ArangoDB with TTL-limited exemptions. Exception resolution during rule evaluation. Proactive MCP flagging for expiring exceptions.
- **Implementation:**
  - `rule_exceptions` ArangoDB edge collection
  - `resolveExceptions()` — checks for active exceptions during violation evaluation, downgrades enforcement to `suggest` for excepted violations
  - Expired exception auto-marking (status: expired)
  - MCP `get_rules` enhancement: `expiringExceptions` field for exceptions within 7 days of expiry
  - REST API: `POST /api/repos/{repoId}/rules/{ruleId}/exceptions` (grant), `DELETE ...` (revoke)
  - Dashboard: Grant Exception button on violations, exception overview page, expiry alerts
- **Files:**
  - `lib/rules/exception-ledger.ts` (new)
  - `app/api/repos/[repoId]/rules/[ruleId]/exceptions/route.ts` (new)
  - `lib/mcp/tools/rules.ts` (modify — add expiringExceptions to get_rules)
- **Testing:** Active exception downgrades enforcement. Expired exception → normal enforcement resumes. Expiring exceptions flagged in MCP. Grant + revoke API works. TTL picker creates correct expires_at.
- **Blocked by:** P6-ADAPT-01, P6-DB-01

### P6-API-19: LLM-Assisted Rule Compilation — `draft_architecture_rule` MCP Tool

- [x] **Status:** Complete
- **Size:** M
- **Description:** Implement the Rule Compiler (§ 1.4h). New MCP tool that takes a natural language rule description and generates a validated ast-grep YAML rule via LLM `generateObject()`.
- **Input schema:**
  - `description: string` — Natural language rule requirement
  - `examples?: string[]` — Example code snippets showing correct usage
  - `language?: string` — Target language (default: "typescript")
- **Implementation:**
  - `AstGrepRuleSchema` Zod schema for structured LLM output
  - LLM call with `generateObject()` + retry on validation failure
  - YAML serialization via `yaml` package
  - Validation via `patternEngine.validateSemgrepYaml()`
  - Returns draft (not auto-created) for human review
  - Draft includes: title, ast-grep query, Semgrep rule, fix directive, validation status
- **Files:**
  - `lib/rules/compiler.ts` (new)
  - `lib/mcp/tools/rules.ts` (modify — register `draft_architecture_rule` tool)
  - `lib/mcp/tools/index.ts` (modify — register tool)
- **Testing:** Natural language → valid ast-grep YAML. Validation failure → retry succeeds. Invalid description → descriptive error. Generated rule catches expected violation in sample code. Token budget respected.
- **Blocked by:** P6-ADAPT-02

### P6-API-20: Polyglot Semantic Mapping

- [x] **Status:** Complete
- **Size:** XL
- **Description:** Implement polyglot rule enforcement (§ 1.4i). Business Intent nodes in `rules` collection with `polyglot: true` link to `LanguageImplementation` edges carrying language-specific syntax payloads. Rule resolution dynamically selects the correct language implementation.
- **Implementation:**
  - `language_implementations` ArangoDB edge collection
  - `polyglot` boolean field on RuleDoc
  - `resolvePolyglotRules()` — queries language-specific edge for the target file's language, replaces generic rule fields with language payload
  - Dashboard: Polyglot toggle on rule form, language tabs for per-language Semgrep/ast-grep/fix/examples
  - "Generate for Language" button using Rule Compiler (P6-API-19)
- **Files:**
  - `lib/rules/polyglot-mapping.ts` (new)
  - `lib/rules/resolver.ts` (modify — integrate polyglot resolution)
  - `lib/ports/types.ts` (modify — add `polyglot`, `languages` to RuleDoc)
  - `lib/adapters/arango-graph-store.ts` (modify — bootstrap `language_implementations` edge collection)
- **Testing:** TypeScript file → TypeScript rule payload. Python file → Python payload. Unknown language → fallback to suggest. Polyglot toggle creates language edges. Language tab saves correct payload.
- **Blocked by:** P6-ADAPT-01, P6-DB-01, P6-API-19

---

## 2.5 Frontend / UI Layer

### P6-UI-01: Pattern Library Page

- [x] **Status:** Complete
- **Description:** Dashboard page at `/repos/[repoId]/patterns` showing auto-detected patterns with adherence rates, evidence counts, and management actions.
- **Design:**
  - Pattern cards grouped by type (structural, naming, architectural, etc.)
  - Each card: title, adherence rate bar (visual), evidence count, confidence badge, status badge
  - Actions per card: Pin (star icon), Dismiss (X icon), Promote to Rule (shield icon), View Evidence (expand)
  - Evidence expansion: List of file:line references (clickable → navigate to file)
  - Semgrep rule preview: Collapsible code block showing generated YAML
  - Filter bar: Type, status, min adherence slider
  - Sort: Adherence rate, evidence count, recently detected
- **Files:**
  - `app/(dashboard)/repos/[repoId]/patterns/page.tsx` (new)
  - `components/repo/pattern-card.tsx` (new)
  - `components/repo/pattern-evidence.tsx` (new)
  - `components/repo/pattern-filters.tsx` (new)
- **Testing:** Patterns render with correct adherence rates. Pin/dismiss actions update status. Promote action navigates to rule creation. Evidence expansion shows file links.
- **Notes:** Follow design system: `glass-card`, `font-grotesk` for headings, `bg-background`, no arbitrary colors. Adherence rate bar uses design system green (≥0.8), yellow (0.5–0.8), red (<0.5).
- **Blocked by:** P6-API-10

### P6-UI-02: Rules Management Page

- [x] **Status:** Complete
- **Description:** Dashboard page at `/repos/[repoId]/rules` for creating, editing, and organizing rules.
- **Design:**
  - Rule list grouped by scope (org, repo, path, branch, workspace)
  - Each rule: title, type badge, scope badge, enforcement badge (color-coded: suggest=blue, warn=yellow, block=red), created by, date
  - Click rule → inline edit panel (title, description, enforcement, path glob, etc.)
  - "Create Rule" button → rule creation form (or wizard)
  - Search/filter: By type, scope, enforcement, keyword
  - Anti-pattern rules (from Phase 5.5 rewinds) shown with special "Auto-generated from rewind" badge
- **Files:**
  - `app/(dashboard)/repos/[repoId]/rules/page.tsx` (new)
  - `app/(dashboard)/repos/[repoId]/rules/new/page.tsx` (new)
  - `components/repo/rule-card.tsx` (new)
  - `components/repo/rule-form.tsx` (new)
  - `components/repo/rule-filters.tsx` (new)
- **Testing:** Rules render with correct badges. Create form validates input. Edit updates rule. Enforcement colors match design system.
- **Blocked by:** P6-API-10

### P6-UI-03: Org-Level Rules Page

- [x] **Status:** Complete
- **Description:** Settings page at `/settings/rules` for managing org-wide rules that apply across all repos.
- **Design:**
  - Same layout as repo rules but scoped to org
  - Clear label: "These rules apply to ALL repositories in your organization"
  - Org rules cannot set `path_glob` or `branch` (they apply globally)
  - Enforcement level has org-wide impact — warn about `block` enforcement
- **Files:**
  - `app/(dashboard)/settings/rules/page.tsx` (new)
  - `app/(dashboard)/settings/rules/new/page.tsx` (new)
- **Testing:** Org rules CRUD works. Rules appear in repo-level get_rules results. Cannot set path or branch scope.
- **Blocked by:** P6-API-10

### P6-UI-04: Dashboard Navigation Update

- [x] **Status:** Complete
- **Description:** Add "Patterns" and "Rules" to the repo sub-navigation in the dashboard.
- **Files:**
  - `components/dashboard/dashboard-nav.tsx` (modify — add nav items)
- **Testing:** Nav items appear. Links navigate to correct pages. Active state highlights correctly.
- **Blocked by:** P6-UI-01, P6-UI-02

---

## 2.6 Testing & Verification

### P6-TEST-01: ast-grep Detection Accuracy

- [x] **Status:** Complete
- **Description:** Unit tests verifying that built-in catalog queries produce correct results on sample codebases.
- **Test cases:**
  - Zod validation query: finds all route handlers, correctly identifies those with/without zod
  - Rate limiting query: detects rateLimit() usage in handlers
  - Hook naming query: finds all function declarations, identifies `use` prefix violations
  - Adherence rate calculation: 12 matching / 14 total = 0.857
  - Noise filtering: patterns with <3 instances excluded. Patterns with adherence <0.5 excluded.
  - Multi-file scan: correctly counts across multiple source files
- **Files:**
  - `lib/patterns/__tests__/ast-grep-scanner.test.ts` (new)
  - `lib/patterns/__tests__/fixtures/` (new — sample source files for testing)
- **Blocked by:** P6-API-01

### P6-TEST-02: Semgrep Rule Execution

- [x] **Status:** Complete
- **Description:** Unit tests verifying Semgrep CLI invocation and result parsing.
- **Test cases:**
  - Valid Semgrep rule catches violation in sample code
  - No violations → empty findings
  - Invalid YAML → validation returns error
  - Large code file (>10KB) → handled without timeout
  - Multiple rules in single config → all checked
  - Semgrep CLI unavailable → graceful fallback
- **Files:**
  - `lib/adapters/__tests__/semgrep-pattern-engine.test.ts` (new)
- **Blocked by:** P6-ADAPT-02

### P6-TEST-03: Rule Resolution Logic

- [x] **Status:** Complete
- **Description:** Unit tests for the hierarchical rule resolution algorithm.
- **Test cases:**
  - Org rule applies to all repos
  - Repo rule overrides org rule with same title
  - Path-scoped rule only matches files within glob
  - Workspace rule visible only to owning user
  - Priority ordering within same scope
  - Deduplication: most specific title wins
  - Cap at 50 rules
  - Redis cache: first call queries ArangoDB, second call hits cache
  - Cache invalidation: rule mutation clears cache
  - Empty result when no rules match
- **Files:**
  - `lib/rules/__tests__/resolver.test.ts` (new)
- **Blocked by:** P6-API-02

### P6-TEST-04: LLM Semgrep Rule Synthesis

- [x] **Status:** Complete
- **Description:** Unit tests for the LLM-powered Semgrep YAML generation from ast-grep detection results.
- **Test cases:**
  - Valid detection input → Zod-valid SemgrepRuleSchema output
  - Generated YAML passes Semgrep validation
  - Generated rule catches the expected violation
  - LLM timeout → pattern stored without rule (graceful degradation)
  - LLM returns invalid YAML → retry once with error context
  - Token budget respected (3K input + 600 output)
  - Batch of 20 patterns → all processed within timeout
- **Files:**
  - `lib/temporal/activities/__tests__/pattern-detection.test.ts` (new)
- **Blocked by:** P6-API-08

### P6-TEST-05: detectPatternsWorkflow End-to-End

- [x] **Status:** Complete
- **Description:** Integration test for the full three-activity workflow: scan → synthesize → store.
- **Test cases:**
  - Full pipeline on sample codebase → patterns stored with correct adherence rates
  - Re-detection: pinned patterns preserved, new patterns added
  - Re-detection: dismissed patterns stay dismissed
  - LLM failure in synthesis → pattern stored without semgrep_rule
  - ArangoDB failure in store → workflow fails, retries succeed
  - Concurrent detection for same repo → deduplicated by workflow ID
  - Post-indexing chaining: workflow starts after indexing completes
- **Files:**
  - `lib/temporal/workflows/__tests__/detect-patterns-workflow.test.ts` (new)
- **Blocked by:** P6-API-08, P6-API-09

### P6-TEST-06: MCP Tools — Rules & Patterns

- [x] **Status:** Complete
- **Description:** Unit tests for all five new MCP tools.
- **Test cases:**
  - `get_rules`: returns rules for file path, empty path returns all, enforcement levels correct
  - `check_rules`: code with violations returns findings, clean code passes, Semgrep fallback works
  - `check_patterns`: violations include adherence rate, dismissed patterns excluded
  - `get_conventions`: returns sorted by adherence, category filter works
  - `suggest_approach`: returns similar file + applicable patterns + rules, LLM timeout handled
- **Files:**
  - `lib/mcp/tools/__tests__/rules.test.ts` (new)
  - `lib/mcp/tools/__tests__/patterns.test.ts` (new)
- **Blocked by:** P6-API-03, P6-API-04, P6-API-05, P6-API-06, P6-API-07

### P6-TEST-07: Pattern Stability Across Re-Detection

- [x] **Status:** Complete
- **Description:** Tests verifying that pattern status is preserved across multiple detection cycles.
- **Test cases:**
  - Active pattern updated (adherence rate changes) but stays active
  - Pinned pattern: adherence rate updated, status stays pinned
  - Dismissed pattern: re-detected but stays dismissed
  - Promoted pattern: stays promoted, derived rule unaffected
  - Low-adherence pattern (<0.5): auto-dismissed
  - New pattern: created with status active
  - Hash-based dedup: same query + same repo = same pattern key
- **Files:**
  - `lib/patterns/__tests__/pattern-stability.test.ts` (new)
- **Blocked by:** P6-ADAPT-01

### P6-TEST-08: REST API CRUD Operations

- [x] **Status:** Complete
- **Description:** Integration tests for the dashboard API routes.
- **Test cases:**
  - Rules CRUD: create, read, update, archive, list with filters
  - Patterns: list with filters, pin, dismiss, un-dismiss, promote
  - Pattern promotion: creates Rule with correct fields and `createdBy: "auto-promoted"`
  - Auth: unauthenticated request returns 401. Non-member returns 403.
  - Validation: invalid rule data returns 400 with error details
  - Redis cache: mutation invalidates cache
  - Org-level rules: CRUD at settings level, appear in repo-level queries
- **Files:**
  - `app/api/repos/[repoId]/rules/__tests__/rules-api.test.ts` (new)
  - `app/api/repos/[repoId]/patterns/__tests__/patterns-api.test.ts` (new)
- **Blocked by:** P6-API-10

### P6-TEST-09: Bootstrap Rule Integration

- [x] **Status:** Complete
- **Description:** Verify that the updated Bootstrap Rule correctly instructs agents to use pre-flight and post-flight rule checks.
- **Test cases:**
  - Generated Bootstrap Rule includes `get_rules` in pre-flight steps
  - Generated Bootstrap Rule includes `check_rules` in post-flight steps
  - Bootstrap Rule includes `block` violation instruction
  - Existing steps (sync_local_diff, etc.) preserved
  - Bootstrap Rule renders as valid Markdown
- **Files:**
  - `lib/onboarding/__tests__/bootstrap-rule-phase6.test.ts` (new)
- **Blocked by:** P6-API-11

### P6-TEST-10: Port Compliance — IPatternEngine Extension

- [x] **Status:** Complete
- **Description:** Extend the port compliance test to cover the new `IPatternEngine` methods.
- **Test cases:**
  - `FakePatternEngine` implements `scanWithAstGrep` and `validateSemgrepYaml`
  - `SemgrepPatternEngine` implements all methods (integration test with real CLI)
  - DI container resolves `patternEngine` for both production and test containers
  - New methods are callable and return expected types
- **Files:**
  - `lib/di/__tests__/port-compliance.test.ts` (modify — extend `IPatternEngine` tests)
- **Blocked by:** P6-ADAPT-02, P6-ADAPT-03

### P6-TEST-11: Hybrid Rule Evaluation

- [x] **Status:** Complete
- **Description:** Tests for the two-pass evaluation engine.
- **Test cases:**
  - Syntactic pass produces raw findings
  - Semantic pass enriches findings with feature_area and business_value
  - Semantic filter suppresses violations in excluded feature areas (e.g., test fixtures)
  - Confidence score increases when justification data exists
  - Missing Phase 4 justification → fallback to syntactic confidence (0.7)
  - Rules without semantic filter → pass-through unchanged
  - Performance: semantic pass adds <50ms for 20 findings
- **Files:**
  - `lib/rules/__tests__/hybrid-evaluator.test.ts` (new)
- **Blocked by:** P6-API-12

### P6-TEST-12: JIT Rule Injection

- [x] **Status:** Complete
- **Description:** Tests for the context-aware rule selection.
- **Test cases:**
  - Returns fewer rules than full `get_rules` for same context
  - Relevance scoring prioritizes path-matched rules
  - Feature area overlap boosts relevance
  - Entity kind match boosts relevance
  - Minimum relevance threshold (0.3) filters irrelevant rules
  - Entities with no graph neighbors → fallback to `get_rules`
  - Token savings measurement: count returned rules × avg rule size
  - Empty entity_keys → returns empty (not full dump)
- **Files:**
  - `lib/rules/__tests__/jit-injection.test.ts` (new)
- **Blocked by:** P6-API-13

### P6-TEST-13: Subgraph Pattern Mining

- [x] **Status:** Complete
- **Description:** Tests for the pattern mining workflow.
- **Test cases:**
  - Louvain community detection produces clusters
  - Ego-graph extraction captures 1-hop neighborhoods
  - Normalized shape hash is stable across different entity names
  - Motif frequency ≥ 3 threshold filters noise
  - Motif adherence ≥ 0.7 threshold filters low-adherence motifs
  - LLM generates human-readable motif descriptions
  - Re-mining preserves reviewed/dismissed motifs
  - Workflow dedup by ID
- **Files:**
  - `lib/temporal/activities/__tests__/pattern-mining.test.ts` (new)
  - `lib/temporal/workflows/__tests__/mine-patterns-workflow.test.ts` (new)
- **Blocked by:** P6-API-14

### P6-TEST-14: Auto-Remediation

- [x] **Status:** Complete
- **Description:** Tests for AST-based auto-fix generation.
- **Test cases:**
  - ast-grep fix directive produces valid fixed code
  - Structural diff is correct (unified format)
  - Multiple violations → multiple independent patches
  - Rules without fix directive → fallback to manual suggestion
  - ast-grep rewrite failure → graceful degradation (returns manual type)
  - Fix preserves surrounding code (comments, whitespace outside fix zone)
  - `check_rules` response includes `autoFixes` field
  - Bootstrap Rule updated to reference autoFixes
- **Files:**
  - `lib/rules/__tests__/auto-remediation.test.ts` (new)
- **Blocked by:** P6-API-15

### P6-TEST-15: Rule Decay & Health Ledger

- [x] **Status:** Complete
- **Description:** Tests for the rule health telemetry and decay system.
- **Test cases:**
  - Evaluation increments evaluation counter
  - Violation increments violation counter
  - Override increments override counter and records author
  - False positive report increments FP counter
  - Decay score calculation: healthy rule (0.0–0.3), aging (0.3–0.6), decayed (0.6+)
  - Deprecation workflow: 3 senior overrides → auto-downgrade (block → warn)
  - Auto-downgrade: warn → suggest after further decay
  - Review needed: suggest-level rule with high decay → flagged
  - New rule: decay score = 0.0
  - Dashboard health indicator colors match thresholds
- **Files:**
  - `lib/rules/__tests__/health-ledger.test.ts` (new)
  - `lib/rules/__tests__/decay-score.test.ts` (new)
- **Blocked by:** P6-API-16

### P6-TEST-16: Blast Radius Simulation

- [x] **Status:** Complete
- **Description:** Tests for the simulation workflow and impact report.
- **Test cases:**
  - STAGED rule scanned against workspace → findings returned
  - Impact report: correct violation count, affected file count
  - Enrichment: findings include feature areas and last_modified_by
  - Business value breakdown: groups violations by value
  - Sample violations: first 10 findings included
  - Estimated fix effort based on auto-remediable count
  - Report stored in ArangoDB
  - Activation: status changes from staged → active
  - Modify: rule updated, re-simulation triggered
  - Discard: rule deleted
- **Files:**
  - `lib/temporal/workflows/__tests__/simulate-rule-workflow.test.ts` (new)
  - `lib/rules/__tests__/impact-report.test.ts` (new)
- **Blocked by:** P6-API-17

### P6-TEST-17: Exception Ledger

- [x] **Status:** Complete
- **Description:** Tests for time-bound rule exceptions.
- **Test cases:**
  - Active exception downgrades enforcement to `suggest`
  - Expired exception → normal enforcement resumes
  - Exception within 7 days of expiry → flagged in MCP `expiringExceptions`
  - Grant exception via API → RuleException edge created
  - Revoke exception → status set to `revoked`
  - Multiple exceptions on same entity → most recent wins
  - Exception with JIRA ticket → stored and returned
  - TTL picker: 7/14/30/60/90 days → correct expires_at
  - Exception audit trail: full history of grants/revocations
- **Files:**
  - `lib/rules/__tests__/exception-ledger.test.ts` (new)
- **Blocked by:** P6-API-18

### P6-TEST-18: LLM Rule Compilation

- [x] **Status:** Complete
- **Description:** Tests for the natural language → ast-grep YAML compiler.
- **Test cases:**
  - Natural language description → valid ast-grep YAML
  - Generated YAML passes validation
  - Generated rule catches expected violation in sample code
  - Validation failure → retry with error context → success
  - Invalid/vague description → descriptive error message
  - Fix directive generated when possible
  - Language parameter respected (TypeScript vs Python output)
  - Draft returned (not auto-created) — human review required
  - Token budget: input < 3K, output < 600
- **Files:**
  - `lib/rules/__tests__/compiler.test.ts` (new)
- **Blocked by:** P6-API-19

### P6-TEST-19: Polyglot Semantic Mapping

- [x] **Status:** Complete
- **Description:** Tests for cross-language rule enforcement.
- **Test cases:**
  - TypeScript file → TypeScript-specific Semgrep/ast-grep payloads
  - Python file → Python-specific payloads
  - Go file → Go-specific payloads
  - Unknown/unsupported language → enforcement downgraded to `suggest`
  - Polyglot rule without language edge for target language → informational only
  - Non-polyglot rule → standard resolution (unchanged)
  - Language edge creation via dashboard form
  - "Generate for Language" button invokes Rule Compiler
  - Rule resolution queries correct language edge
  - Edge collection bootstrapped on schema init
- **Files:**
  - `lib/rules/__tests__/polyglot-mapping.test.ts` (new)
- **Blocked by:** P6-API-20

---

## New Files Summary

```
lib/
  patterns/
    catalog/
      structural/
        zod-validation.yaml         ← ast-grep query for zod usage in API routes
        rate-limiting.yaml          ← ast-grep query for rateLimit() middleware
        try-catch-async.yaml        ← ast-grep query for try/catch in async handlers
        error-type-check.yaml       ← ast-grep query for error type checking
        response-envelope.yaml      ← ast-grep query for {data, error, meta} pattern
      naming/
        hook-prefix.yaml            ← ast-grep query for React hook naming
        constant-case.yaml          ← ast-grep query for UPPER_SNAKE_CASE constants
      error-handling/
        catch-unknown.yaml          ← ast-grep query for catch(error: unknown)
    catalog-loader.ts               ← Load + validate catalog YAML files
    schema.ts                       ← PatternSchema Zod definition with enums
    __tests__/
      ast-grep-scanner.test.ts      ← Detection accuracy tests
      pattern-stability.test.ts     ← Status preservation tests
      fixtures/                     ← Sample source files for testing
  rules/
    schema.ts                       ← RuleSchema Zod definition with enums
    resolver.ts                     ← Hierarchical rule resolution algorithm
    hybrid-evaluator.ts             ← Two-pass syntactic + semantic evaluation engine
    semantic-filter.ts              ← MongoDB-like semantic filter evaluator
    jit-injection.ts                ← Context-aware JIT rule selection (sub-graph traversal)
    auto-remediation.ts             ← AST-based auto-fix patch generation via ast-grep fix:
    health-ledger.ts                ← Per-rule telemetry tracking and counters
    decay-score.ts                  ← Weighted decay score computation
    impact-report.ts                ← Blast radius impact report generation
    exception-ledger.ts             ← Time-bound RuleException edge management
    compiler.ts                     ← LLM-assisted natural language → ast-grep YAML
    polyglot-mapping.ts             ← Cross-language rule resolution with LanguageImplementation edges
    __tests__/
      resolver.test.ts              ← Resolution logic tests
      hybrid-evaluator.test.ts      ← Two-pass evaluation tests
      jit-injection.test.ts         ← JIT rule injection tests
      auto-remediation.test.ts      ← Auto-fix generation tests
      health-ledger.test.ts         ← Rule health telemetry tests
      decay-score.test.ts           ← Decay score computation tests
      impact-report.test.ts         ← Impact report tests
      exception-ledger.test.ts      ← Exception TTL and resolution tests
      compiler.test.ts              ← LLM rule compilation tests
      polyglot-mapping.test.ts      ← Cross-language enforcement tests
  mcp/tools/
    rules.ts                        ← get_rules, check_rules, get_relevant_rules, draft_architecture_rule
    patterns.ts                     ← check_patterns, get_conventions, suggest_approach
    __tests__/
      rules.test.ts                 ← Rules MCP tool tests
      patterns.test.ts              ← Patterns MCP tool tests
  temporal/
    workflows/
      detect-patterns.ts            ← detectPatternsWorkflow definition
      mine-patterns.ts              ← patternMiningWorkflow (graph isomorphism + Louvain)
      simulate-rule.ts              ← simulateRuleWorkflow (blast radius dry run)
      rule-deprecation.ts           ← ruleDeprecationWorkflow (auto-downgrade decayed rules)
      __tests__/
        detect-patterns-workflow.test.ts
        mine-patterns-workflow.test.ts
        simulate-rule-workflow.test.ts
    activities/
      pattern-detection.ts          ← scanSynthesizeAndStore (combined — scan + synthesize + store in one activity; legacy: astGrepScan, llmSynthesizeRules, storePatterns)
      pattern-mining.ts             ← extractTopology, validateMotifs, storeMinedPatterns
      rule-simulation.ts            ← scanWorkspace, enrichFindings, generateImpactReport
      rule-decay.ts                 ← decayEvaluation, autoDowngrade activities
      __tests__/
        pattern-detection.test.ts   ← Activity tests
        pattern-mining.test.ts      ← Mining activity tests
  onboarding/
    __tests__/
      bootstrap-rule-phase6.test.ts ← Bootstrap Rule update tests
app/
  api/
    repos/[repoId]/
      patterns/
        route.ts                    ← GET/POST patterns
        [patternId]/route.ts        ← PATCH pattern (pin/dismiss)
      rules/
        route.ts                    ← GET/POST rules
        [ruleId]/route.ts           ← PATCH/DELETE rule
        [ruleId]/exceptions/route.ts ← POST/DELETE rule exceptions (grant/revoke)
        from-pattern/route.ts       ← POST promote pattern to rule
      rules/__tests__/
        rules-api.test.ts
      patterns/__tests__/
        patterns-api.test.ts
    settings/
      rules/route.ts                ← GET/POST org-level rules
  (dashboard)/
    repos/[repoId]/
      patterns/page.tsx             ← Pattern library UI (includes "Discovered" tab for mined patterns)
      rules/page.tsx                ← Rules management UI (includes health indicators)
      rules/new/page.tsx            ← Rule creation form (includes polyglot toggle + language tabs)
    settings/
      rules/page.tsx                ← Org-level rules management
components/repo/
  pattern-card.tsx                  ← Pattern display card
  pattern-evidence.tsx              ← Evidence file:line list
  pattern-filters.tsx               ← Filter bar for patterns
  rule-card.tsx                     ← Rule display card (includes health indicator badge)
  rule-form.tsx                     ← Rule create/edit form (includes polyglot tabs, fix directive)
  rule-filters.tsx                  ← Filter bar for rules
  rule-health-badge.tsx             ← Green/yellow/red/gray health indicator
  impact-report-card.tsx            ← Blast radius simulation results card
  exception-manager.tsx             ← Grant/revoke/view rule exceptions
  mined-pattern-card.tsx            ← Discovered motif card with mini sub-graph visualization
```

## Modified Files Summary

```
lib/ports/types.ts                          ← Expand RuleDoc, PatternDoc, RuleFilter, PatternFilter + add astGrepFix, polyglot, languages fields
lib/ports/graph-store.ts                    ← Add deleteRule, archiveRule, updatePatternStatus, getPatternByHash, getRuleHealth, upsertMinedPattern, upsertImpactReport
lib/ports/pattern-engine.ts                 ← Add scanWithAstGrep, validateSemgrepYaml
lib/adapters/arango-graph-store.ts          ← Implement all rule/pattern methods, add indexes, bootstrap rule_exceptions + language_implementations + mined_patterns + rule_health + impact_reports collections
lib/adapters/semgrep-pattern-engine.ts      ← Replace NotImplementedError stubs with real Semgrep + ast-grep
lib/di/fakes.ts                             ← Implement rule/pattern methods on InMemoryGraphStore, update FakePatternEngine
lib/di/__tests__/port-compliance.test.ts    ← Extend IPatternEngine tests
lib/mcp/tools/index.ts                      ← Register 8 new tools (get_rules, check_rules, check_patterns, get_conventions, suggest_approach, get_relevant_rules, draft_architecture_rule + mined patterns)
lib/mcp/tools/rules.ts                      ← Integrate hybrid evaluation, autoFixes, expiringExceptions, JIT injection, rule compiler
lib/temporal/workflows/index-repo.ts        ← Chain detectPatternsWorkflow
lib/temporal/workflows/index.ts             ← Export detectPatternsWorkflow, patternMiningWorkflow, simulateRuleWorkflow, ruleDeprecationWorkflow
lib/temporal/activities/index.ts            ← Export pattern detection, mining, simulation, decay activities
lib/onboarding/bootstrap-rule.ts            ← Add pre-flight get_rules + post-flight check_rules + autoFixes instruction
lib/rules/resolver.ts                       ← Integrate polyglot resolution in resolveRules()
components/dashboard/dashboard-nav.tsx       ← Add Patterns and Rules nav items
package.json                                ← Add @ast-grep/napi, execa, graphology-communities, yaml dependencies
```

---

## Revision Log

| Date | Author | Changes |
|---|---|---|
| 2026-02-21 | Phase 6 Design | Initial document. 7 user flows, 8 system logic sections, 10 failure scenarios, 8 latency budgets, phase bridge to Phase 7, 43 tracker items across 6 layers. |
| 2026-02-21 | Phase 6 Enhancement | Added 10 canonical terms (Hybrid Rule Evaluation, JIT Rule Injection, Subgraph Pattern Mining, Auto-Remediation, Rule Health Ledger, Blast Radius Simulation, Rule Exception, Rule Compiler, Polyglot Semantic Mapping). Added 10 architectural sections (§ 1.4a–1.4j) with algorithms, schemas, and MCP tool designs. Added 9 API tracker items (P6-API-12 through P6-API-20). Added 9 test tracker items (P6-TEST-11 through P6-TEST-19). Added package recommendations table. Updated new/modified files summaries. Total: **61 tracker items.** |
| 2026-02-23 | Claude | **Rule creation from health insights.** See [PHASE_POST_ONBOARDING_WOW_EXPERIENCE.md](./PHASE_POST_ONBOARDING_WOW_EXPERIENCE.md). (1) New API `POST /api/repos/{repoId}/rules/from-insight` — accepts `{ insightType }`, looks up pre-filled rule template from `lib/health/fix-guidance.ts`, creates draft rule via `graphStore.upsertRule()`. (2) Rule creation form (`rules/new/page.tsx`) now reads `useSearchParams()` for `title`, `description`, `type`, `enforcement`, `priority` — enables deep-linking from health InsightCards with pre-filled values. (3) `lib/health/fix-guidance.ts` defines 13 rule templates (one per health risk type) with title, description, type, enforcement, and priority. |
