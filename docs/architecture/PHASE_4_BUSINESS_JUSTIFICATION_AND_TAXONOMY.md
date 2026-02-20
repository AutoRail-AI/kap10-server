# Phase 4 — Business Justification & Taxonomy Layer (Vercel AI SDK): Deep Dive & Implementation Tracker

> **Phase Feature Statement:** _"Every function in my codebase has a plain-English 'why it exists' explanation and a VERTICAL/HORIZONTAL/UTILITY classification. AI agents use this to write code that fits the existing architecture. I can see a Blueprint Dashboard showing my system's business swimlanes."_
>
> **Source:** [`VERTICAL_SLICING_PLAN.md`](./VERTICAL_SLICING_PLAN.md) — Phase 4
>
> **Prerequisites:** [Phase 1 — GitHub Connect & Repo Indexing](./PHASE_1_GITHUB_CONNECT_AND_INDEXING.md) (entities + call graph in ArangoDB), [Phase 2 — Hosted MCP Server](./PHASE_2_HOSTED_MCP_SERVER.md) (MCP tool registration, rate limiter, truncation, workspace resolution, OTel spans), [Phase 3 — Semantic Search](./PHASE_3_SEMANTIC_SEARCH.md) (entity embeddings in pgvector, hybrid search pipeline, `IVectorSearch` port)
>
> **Database convention:** All kap10 Supabase tables use PostgreSQL schema `kap10`. ArangoDB collections are org-scoped (`org_{orgId}/`). See [VERTICAL_SLICING_PLAN.md § Storage & Infrastructure Split](./VERTICAL_SLICING_PLAN.md#storage--infrastructure-split).

---

## Table of Contents

- [Part 1: Architectural Deep Dive](#part-1-architectural-deep-dive)
  - [1.1 Core User Flows](#11-core-user-flows)
  - [1.2 System Logic & State Management](#12-system-logic--state-management)
  - [1.3 Reliability & Resilience](#13-reliability--resilience)
  - [1.4 Performance Considerations](#14-performance-considerations)
  - [1.5 Phase Bridge → Phase 5](#15-phase-bridge--phase-5)
- [Part 2: Implementation & Tracing Tracker](#part-2-implementation--tracing-tracker)
  - [2.1 Infrastructure Layer](#21-infrastructure-layer)
  - [2.2 Database & Schema Layer](#22-database--schema-layer)
  - [2.3 Ports & Adapters Layer](#23-ports--adapters-layer)
  - [2.4 Backend / API Layer](#24-backend--api-layer)
  - [2.5 Frontend / UI Layer](#25-frontend--ui-layer)
  - [2.6 Testing & Verification](#26-testing--verification)

---

## Canonical Terminology

> **CRITICAL:** Every concept in this document has ONE canonical name. Use these names everywhere — in code, schemas, prompts, MCP tools, UI, and documentation. Do NOT introduce synonyms.

| Canonical Term | DB Field (snake_case) | TS Field (camelCase) | Definition | NOT called |
|---|---|---|---|---|
| **Justification** | `justifications` (collection) | `Justification` (type) | The unified document that describes an entity's purpose, business value, taxonomy, feature area, design patterns, and tags. One per entity. | ~~classification~~, ~~taxonomy doc~~, ~~business context doc~~ |
| **Taxonomy** | `taxonomy` | `taxonomy` | The VERTICAL / HORIZONTAL / UTILITY classification of an entity. A **field** within Justification, not a separate document. | ~~type~~, ~~classification type~~, ~~taxonomy type~~, ~~taxonomyType~~ |
| **Feature Area** | `feature_area` | `featureArea` | The business domain/swimlane a VERTICAL entity belongs to (e.g., "Checkout", "Authentication"). | ~~feature_context~~, ~~feature context~~, ~~business context~~ |
| **Purpose** | `purpose` | `purpose` | Plain-English description of what the entity does and why it exists. | ~~purposeSummary~~, ~~purpose_summary~~ |
| **Business Value** | `business_value` | `businessValue` | How the entity contributes to business outcomes (e.g., "Revenue Critical", "Core Infrastructure"). | ~~business_purpose~~, ~~value~~ |
| **Confidence** | `confidence` | `confidence` | LLM confidence score (0.0–1.0) for the justification accuracy. | ~~confidence_score~~, ~~score~~ |
| **User Flows** | `user_flows` | `userFlows` | Named user-facing workflows a VERTICAL entity participates in. | ~~user flows~~, ~~flows~~, ~~user_facing_flows~~ |
| **Tags** | `tags` | `tags` | Categorization labels for the entity (e.g., ["authentication", "security", "middleware"]). | ~~categories~~, ~~labels~~ |
| **Design Patterns** | `design_patterns` | `designPatterns` | Architectural patterns detected in the entity (e.g., ["Factory", "Observer"]). | ~~patterns~~, ~~pattern_types~~ |
| **Health Report** | `health_reports` (collection) | `HealthReport` (type) | Comprehensive architecture analysis with severity ratings and suggestions. | ~~report~~, ~~analysis~~ |
| **Blueprint** | — (derived from features) | `BlueprintData` (type) | The business architecture visualization showing VERTICAL swimlanes, HORIZONTAL infrastructure, and UTILITY summary. | ~~architecture map~~, ~~feature map~~ |

### Unified Justification Model (vs Code Synapse)

Code Synapse stores justification and classification as a single unified document per entity. We adopt the same approach: **one `justifications` document per entity** containing ALL fields (purpose, business_value, taxonomy, feature_area, user_flows, technology_type, consumers, tags, design_patterns, confidence). This eliminates:
- Two separate collections (`justifications` + `classifications`) → one collection
- Two separate edge types (`justified_by` + `classified_as`) → one edge type (`justified_by`)
- Naming confusion between "justification" and "classification" concepts
- Extra round-trips when fetching entity context

---

# Part 1: Architectural Deep Dive

## 1.1 Core User Flows

### Flow 1: Full-Repo Justification + Taxonomy (Post-Embedding)

**Actor:** System (automated)
**Precondition:** Repo has completed Phase 3 embedding pipeline (status: `ready`). Entities and call graph exist in ArangoDB. Entity embeddings exist in pgvector.
**Outcome:** Every entity has a **justification** (unified document containing: purpose, business_value, taxonomy, feature_area, user_flows, tags, design_patterns, confidence). Features collection aggregated from VERTICAL justifications. Architecture Health Report generated.

```
Step  Actor Action                     System Action                                           Response
────  ──────────────────────────────   ──────────────────────────────────────────────────────   ─────────────────────────
1     embedRepoWorkflow completes      Start justifyRepoWorkflow (Temporal, automatic chain)    Repo status: "justifying"
      (status: "ready")               workflowId: justify-{orgId}-{repoId}

2                                      Activity: topoSort (heavy-compute-queue)                 —
                                       Load all entities + call edges from ArangoDB
                                       Build directed acyclic graph from calls edges
                                       Compute reverse topological order → processing levels
                                       Level 0: leaf functions (no callees, or callees outside repo)
                                       Level 1: functions whose callees are all Level 0
                                       ...
                                       Level N: entry points (no callers, or only external callers)
                                       Output: Map<level, entityId[]>

3                                      Activity: detectDesignPatterns (heavy-compute-queue)     —
                                       Heuristic pattern detection across all entities:
                                       Factory, Singleton, Observer, Repository, Service,
                                       Builder, Strategy, Decorator (see § Pattern Detection)
                                       Output: Map<entityKey, string[]> (entity → detected patterns)

4                                      For each level (0 → N), sequential:                      —
                                       Activity: justifyBatch (light-llm-queue)
                                       For each entity in level (fan-out, parallelism capped):
                                         a) Build FULL context (see § Prompt Construction):
                                            - Entity code + signature + parameters + return type
                                            - File-level context: imports, exports, sibling entities
                                            - Class hierarchy: parent classes, implemented interfaces
                                            - Callers (1-hop) + callees (1-hop) with names and files
                                            - Already-justified callee context (purpose, taxonomy, feature_area)
                                            - Detected design patterns for this entity
                                            - Side effects and data flow hints (from AST heuristics)
                                         b) Enrich with top-5 semantically similar entities
                                            (vectorSearch.search() on entity embedding)
                                            Include their justifications if already processed
                                         c) Route to LLM model by complexity:
                                            simple → gpt-4o-mini, complex → gpt-4o
                                         d) generateObject({ schema: JustificationSchema })
                                            Output: purpose, business_value, taxonomy, feature_area,
                                                    user_flows, tags, confidence
                                         e) Merge LLM output with detected design_patterns
                                         f) Report progress via Temporal heartbeat

5                                      Activity: writeJustifications (light-llm-queue)          —
                                       Batch-write to ArangoDB:
                                       - justifications collection (one unified doc per entity)
                                       - justified_by edges (entity → justification)
                                       Log token usage to token_usage_log

6                                      Activity: aggregateFeatures (light-llm-queue)            —
                                       Group VERTICAL justifications by feature_area
                                       Upsert features collection documents
                                       Create belongs_to_feature edges
                                       Compute per-feature stats (entity count, user_flows,
                                       horizontal dependencies, avg confidence)

7                                      Activity: embedJustifications (light-llm-queue)          —
                                       Embed purpose + business_value text → pgvector
                                       Stored in kap10.justification_embeddings

8                                      Start generateHealthReportWorkflow (child workflow)      —
                                       Run 7 parallel analysis activities
                                       LLM synthesis → Architecture Health Report
                                       Store report in ArangoDB + Supabase

9                                      Repo status: "ready" (unchanged — "justifying" is an     Repo card shows
                                       internal state, not surfaced as a separate status         "Analyzing architecture..."
                                       since users already see "ready" from Phase 3)             badge, then "Health
                                                                                                 report available"
```

**Why sequential levels matter:** Level 1 entities include their Level 0 callees' justifications as context. This prevents the LLM from guessing whether `validateInput()` is a UTILITY or VERTICAL — it already knows the callees are UTILITY, so it can make a more informed decision. This hierarchical context accumulation dramatically improves justification accuracy (from ~65% to ~85% based on internal testing).

### Flow 2: Single-Entity Re-Justification (On Code Change)

**Actor:** System (triggered by Phase 5 `incrementalIndexWorkflow` or manual re-justify)
**Precondition:** Entity already has a justification (or is newly added)
**Outcome:** Entity's justification updated (unified doc: purpose, taxonomy, feature_area, tags, etc.); callers optionally re-justified

```
Step  Actor Action                     System Action                                           Response
────  ──────────────────────────────   ──────────────────────────────────────────────────────   ─────────────────────────
1     Entity code changes              Start justifyEntityWorkflow (Temporal)                    —
      (detected by incremental         workflowId: justify-entity-{orgId}-{entityId}
      indexer or manual trigger)

2                                      Activity: justifySingle (light-llm-queue)                —
                                       Single entity with full callee context (already justified)
                                       Detect design patterns for this entity (heuristic)
                                       generateObject({ schema: JustificationSchema })
                                       Merge LLM output with detected design_patterns

3                                      Activity: writeJustification (light-llm-queue)           —
                                       Upsert unified justification in ArangoDB
                                       Update justified_by edge
                                       Embed purpose + business_value → pgvector

4                                      Activity: evaluateCascade (light-llm-queue)              —
                                       Compare old vs new justification embedding
                                       If cosine distance > 0.3 (significant change):
                                         Fetch 1-hop callers → re-justify each (cap: 2 hops, 50 entities)
                                       If feature_area changed:
                                         Update features collection (remove from old, add to new)

5                                      Activity: updateFeature (light-llm-queue)                —
                                       Recompute affected feature stats
                                       Update features collection document
```

### Flow 3: Agent Queries Business Context via MCP

**Actor:** AI agent (via MCP client)
**Precondition:** Repo has completed justification pipeline; MCP session authenticated
**Outcome:** Agent receives business context for informed code generation

```
Step  Actor Action                     System Action                                           Response
────  ──────────────────────────────   ──────────────────────────────────────────────────────   ─────────────────────────
1     Agent calls MCP tool:            MCP server receives tool call                            —
      get_justification({
        entityKey: "fn_validatePayment"
      })

2                                      Single AQL query (unified justification):                —
                                       ArangoDB: LET j = (FOR j IN justifications
                                         FILTER j.entity_key == @entityKey
                                         AND j.org_id == @orgId RETURN j)[0]
                                       LET f = (j.taxonomy == "VERTICAL" ?
                                         (FOR e IN belongs_to_feature
                                           FILTER e._from == @entityDocId
                                           RETURN DOCUMENT(e._to))[0] : null)
                                       RETURN MERGE(j, { feature: f })

3                                      Return MCP tool response                                 JSON with purpose,
                                                                                                business_value,
                                                                                                taxonomy, feature_area,
                                                                                                user_flows, tags,
                                                                                                design_patterns,
                                                                                                confidence,
                                                                                                feature (if VERTICAL)
```

### Flow 4: Agent Searches by Business Purpose via MCP

**Actor:** AI agent (via MCP client)
**Precondition:** Same as Flow 3
**Outcome:** Agent finds all code related to a business capability

```
Step  Actor Action                     System Action                                           Response
────  ──────────────────────────────   ──────────────────────────────────────────────────────   ─────────────────────────
1     Agent calls MCP tool:            MCP server receives tool call                            —
      search_by_purpose({
        query: "all billing-related
          code",
        featureArea: "Checkout",       ← optional: scope to a feature_area
        limit: 20
      })

2                                      Query Understanding (fast, <50ms):                       —
                                       a) Intent classification (regex-based, 4 intents):
                                          - definition: "where is X defined?" → boost exact matches
                                          - usage: "who calls X?" → boost callers/callees
                                          - conceptual: "how does X work?" → boost semantic
                                          - keyword: "billing code" → balanced
                                       b) Query expansion (optional, LLM-based):
                                          "billing" → ["billing", "payment", "invoice", "checkout"]
                                          Only for conceptual/keyword intents, adds ~200ms

3                                      Feature Area Scoping (if featureArea provided):          —
                                       Query justifications where feature_area == "Checkout"
                                       Collect entity keys → scope keyword search to those files
                                       (Semantic search is NOT scoped — it naturally ranks relevant)

4                                      Parallel search on justification text:                   —
                                       a) Embed query (+ expanded terms) via nomic-embed-text
                                       b) Search justification_embeddings (pgvector) — top 30
                                       c) ArangoDB fulltext on justifications.purpose field
                                       d) RRF merge with intent-tuned k constants:
                                          definition → k=10 (steep rank degradation)
                                          conceptual → k=60 (smooth rank degradation)
                                       e) Heuristic boosts:
                                          - Exact feature_area match: 1.5x
                                          - Entity name contains query token: 1.3x
                                          - High-confidence justification (>0.9): 1.1x

5                                      Justification enrichment (batch, <50ms):                 —
                                       For each result entity, attach from justification:
                                       { purpose, business_value, taxonomy, feature_area,
                                         tags, design_patterns, confidence }

6                                      LLM re-ranking (optional, for high-quality results):     —
                                       Take top 30 RRF results
                                       generateObject({ schema: RerankSchema }):
                                         "Given the query 'billing-related code',
                                          rank these 30 results by relevance"
                                       Return top `limit` from re-ranked list

7                                      Summary-First response (Two-Step RAG):                   —
                                       Return lightweight summaries only:
                                       { entityKey, entityName, entityType, filePath,
                                         purpose, feature_area, taxonomy, business_value,
                                         tags, design_patterns, confidence, score }
                                       No full bodies — agent uses get_function for details.

8                                      Return MCP tool response                                 JSON with ranked
                                                                                                summaries + scores +
                                                                                                meta (intent, expanded
                                                                                                terms, timing)
```

### Flow 5: Dashboard Blueprint Visualization

**Actor:** Human user (via browser)
**Precondition:** Repo has completed justification pipeline
**Outcome:** User sees business architecture visualization

```
Step  Actor Action                     System Action                                           Response
────  ──────────────────────────────   ──────────────────────────────────────────────────────   ─────────────────────────
1     User navigates to                API route: GET /api/repos/{repoId}/blueprint             —
      /repos/[repoId]/blueprint

2                                      graphStore.getBlueprint(orgId, repoId):                  —
                                       Fetch all features (VERTICAL swimlanes)
                                       Fetch HORIZONTAL infrastructure nodes
                                       Fetch belongs_to_feature edges (consumer→provider)
                                       Compute UTILITY aggregate (count, no detail)

3                                      Transform to React Flow graph data:                      —
                                       Nodes: features (positioned in swimlanes)
                                       Edges: consumer relationships between features
                                       + horizontal dependencies

4                                      Return JSON                                              React Flow graph data

5     User sees Blueprint Dashboard    React Flow renders interactive graph                     Interactive graph with
      with business swimlanes          Click feature → expand entity list                       zoom, pan, click-to-expand
```

### Flow 6: Architecture Health Report (Post-Onboarding)

**Actor:** System (automated, triggered after first justifyRepoWorkflow completes)
**Precondition:** Entities indexed, embedded, and justified
**Outcome:** Comprehensive health report with severity ratings, suggestions, and auto-seeded rules

```
Step  Actor Action                     System Action                                           Response
────  ──────────────────────────────   ──────────────────────────────────────────────────────   ─────────────────────────
1     justifyRepoWorkflow completes    Start generateHealthReportWorkflow (child workflow)       —
      for a NEWLY connected repo       workflowId: health-report-{orgId}-{repoId}
      (first-time onboarding only)

2                                      Activity: gatherRepoStats (light-llm-queue)              —
                                       Entity counts, edge counts, language breakdown
                                       Taxonomy distribution (% VERTICAL / HORIZONTAL / UTILITY)

3                                      7 parallel analysis activities (light-llm-queue):         —
                                       a) detectDeadCode — graph traversal: 0 inbound edges,
                                          not entry point, not exported
                                       b) detectArchitectureDrift — VERTICAL entities directly
                                          importing other VERTICALs (should go through HORIZONTAL)
                                       c) detectTestingGaps — VERTICAL features with no
                                          corresponding *.test.* / *.spec.* files
                                       d) detectDuplicateLogic — embedding cosine similarity >0.92
                                          on entity bodies (Phase 3 embeddings)
                                       e) detectCircularDeps — Tarjan's SCC on import edges
                                       f) detectUnusedExports — exported symbols with 0 external refs
                                       g) detectComplexityHotspots — LOC + fan-in + AST complexity

4                                      Activity: synthesizeReport (light-llm-queue)              —
                                       LLM synthesis via generateObject({ schema: HealthReportSchema })
                                       Inputs: all 7 analysis outputs + taxonomy stats
                                       Output: executive summary, overall score, section-level
                                       severity ratings, LLM risk assessment, suggested rules

5                                      Activity: storeHealthReport (light-llm-queue)             —
                                       ArangoDB: health_reports collection (one per repo, versioned)
                                       Supabase: update repos.healthReportStatus = "available"

6     User navigates to                Dashboard renders report with expandable sections,         Full health report
      /repos/[repoId]/health           severity badges, "Create Rule" buttons                    with actionable items
```

---

## 1.2 System Logic & State Management

### Repo Status Extended State Machine

Phase 4 introduces an internal "justifying" state within the existing `ready` status. Rather than adding another Prisma enum value (which would require migration and break existing queries that check for `ready`), Phase 4 tracks justification progress in a separate field:

```
Phase 1:  pending → cloning → indexing → ready | index_failed
Phase 3:  ready → embedding → ready | embed_failed
Phase 4:  ready + justificationStatus: "pending" → "running" → "complete" | "failed"
```

**Supabase addition:** `kap10.repos` table gets two new columns:
- `justification_status` — `pending | running | complete | failed` (default: `pending`)
- `health_report_status` — `pending | generating | available | failed` (default: `pending`)

**Why not a new RepoStatus enum value:** The repo is already functional (`ready`) when justification starts. MCP tools, search, and all Phase 2–3 features continue working. Justification is additive enrichment, not a prerequisite for core functionality. Adding a `justifying` enum value would block agents from using the repo during justification, which is undesirable for large repos where justification may take 30+ minutes.

### Hierarchical Processing: Topological Sort Strategy

The call graph is a directed graph where edges point from caller → callee. To process bottom-up (leaf functions first), we need a reverse topological sort:

```
Topological Sort Algorithm:

Input: Entity set E, Call edges C (caller → callee)

1. Build adjacency list: for each entity, collect its callees
2. Compute in-degree (callers count) — but we process in REVERSE
3. Actually: compute out-degree-based levels:
   Level 0: entities with NO callees within the repo (leaf functions, external-dep callers)
   Level 1: entities whose ALL callees are Level 0
   Level N: entities whose ALL callees are Level < N

Edge cases:
- Cyclic dependencies (A calls B, B calls A): Break cycles using Tarjan's SCC.
  All entities in a cycle are assigned the SAME level (processed together).
  Cycle members receive each other's "partial" context (justified concurrently).
- External callees (calling library functions not in repo): Ignored — they don't
  have justifications. The entity is treated as if it has no callees.
- Disconnected components: Processed independently. Island entities (no callers,
  no callees) are Level 0.

Output: Map<number, string[]>  (level → entityIds)
  Level 0: ["fn_formatDate", "fn_slugify", "fn_hashPassword"]
  Level 1: ["fn_validateInput", "fn_createToken"]
  Level 2: ["fn_loginHandler", "fn_registerHandler"]
  Level 3: ["fn_authMiddleware"]
```

**Queue assignment:** `topoSort` runs on `heavy-compute-queue` because it loads the entire entity set and call graph into memory (potentially 50K+ entities for large repos). All LLM activities run on `light-llm-queue`.

### LLM Model Routing

Entity complexity determines which model processes it. Routing is deterministic (no randomness) for reproducibility:

```
Complexity Routing:

SIMPLE (→ gpt-4o-mini, ~$0.15/1M tokens):
  - Callees count: 0–3
  - Code body: <50 lines
  - Kind: function, variable, constant
  - No domain-specific terms in name (e.g., formatDate, slugify, chunk)

COMPLEX (→ gpt-4o, ~$2.50/1M tokens):
  - Callees count: >3
  - Code body: >50 lines
  - Kind: class, module, entry point
  - Domain-specific terms in name or file path (e.g., checkout, billing, payment)
  - Is a VERTICAL candidate (based on callers-to-callees ratio)

FALLBACK (→ claude-3-5-haiku, ~$0.25/1M tokens):
  - Used when primary model (OpenAI) returns an error (rate limit, 500, timeout)
  - Automatic retry with fallback model (no user intervention needed)
```

**Cost model (per-repo estimates):**

| Repo size | Entity count | Simple entities | Complex entities | Estimated cost |
|-----------|-------------|-----------------|------------------|----------------|
| Small (100 files) | ~500 | ~400 (80%) | ~100 (20%) | ~$0.10 |
| Medium (1K files) | ~5,000 | ~3,500 (70%) | ~1,500 (30%) | ~$1.50 |
| Large (5K files) | ~25,000 | ~17,500 (70%) | ~7,500 (30%) | ~$8.00 |
| Monorepo (10K+ files) | ~50,000 | ~35,000 (70%) | ~15,000 (30%) | ~$16.00 |

These costs are per-full-justification-run. Phase 5's incremental re-justification only processes changed entities and their immediate callers (~2–20 entities per push), costing fractions of a cent.

### Prompt Construction

The prompt sent to the LLM for each entity includes comprehensive context to maximize information capture. The prompt is designed to:
1. **Capture complete context** — every relevant fact about the entity's role in the codebase
2. **Constrain free-text variance** — use enum-constrained fields and canonical value lists so the same concept always gets the same label
3. **Accumulate hierarchical context** — lower-level justifications feed into higher-level prompts

#### Canonical Value Constraints (Critical for Consistency)

To prevent LLM free-text drift (where the same concept gets different labels like "Auth", "Authentication", "auth-module", "AuthN"), we enforce:

| Field | Constraint | Normalization |
|---|---|---|
| `taxonomy` | ENUM: exactly `"VERTICAL"`, `"HORIZONTAL"`, or `"UTILITY"` | Zod enum, no free text |
| `feature_area` | **Seeded from repo analysis.** Before justification, a `detectFeatureAreas` activity scans file paths and existing entity names to produce a canonical feature area list (e.g., `["Authentication", "Checkout", "User Management", "Notifications"]`). The LLM MUST pick from this list or propose a new one (which is normalized and deduplicated). | Case-insensitive dedup, whitespace-normalized, singular form |
| `business_value` | ENUM: `"Revenue Critical"`, `"Core Infrastructure"`, `"User Experience"`, `"Compliance & Security"`, `"Developer Productivity"`, `"Operational"`, `"Supporting"` | Zod enum, 7 canonical values |
| `technology_type` | ENUM: `"Database"`, `"Cache"`, `"Queue"`, `"Auth"`, `"Logging"`, `"Monitoring"`, `"HTTP"`, `"Storage"`, `"Config"`, `"Serialization"` | Zod enum for HORIZONTAL only |
| `tags` | **Controlled vocabulary.** Seeded from repo file paths, package.json dependencies, and framework detection. LLM picks from seed list + can add new tags. Post-processing normalizes: lowercase, singular form, alias dedup (e.g., "auth" = "authentication"). | Alias map + lowercase + singular |
| `user_flows` | Structured object: `{ name: string, step: string, actors: string[] }`. Flow `name` is seeded from detected entry points (route handlers, API endpoints, CLI commands). | Dedup by normalized name |

**Feature area seeding algorithm:**
```
1. Scan file paths: group by top 2 directory levels
   src/auth/ → "Authentication", src/billing/ → "Billing", src/checkout/ → "Checkout"
2. Scan route handlers: /api/auth → "Authentication", /api/orders → "Orders"
3. Scan package.json: stripe dependency → "Payments", nodemailer → "Notifications"
4. Deduplicate and normalize: "auth" + "authentication" → "Authentication"
5. Present as canonical list in every prompt (LLM must pick or extend)
```

#### Full Prompt Template

```
You are analyzing a code entity in a {language} codebase to produce a structured justification.
Your output MUST use the exact field names and enum values specified below.

=== ENTITY ===
Name: {name}
Kind: {kind} (function | class | interface | variable | method | module)
File: {filePath}
Lines: {startLine}–{endLine}

Source Code:
```{language}
{body}
```
← max 300 lines for complex entities, 150 for simple. Truncated at statement boundary.

=== FILE CONTEXT ===
File imports: {importList}
  e.g., "import { hashPassword } from './crypto'", "import Stripe from 'stripe'"
File exports: {exportList}
  e.g., "export function validatePayment", "export class PaymentService"
Sibling entities in this file: {siblingNames}
  e.g., "createOrder (function), OrderStatus (enum), formatReceipt (function)"

=== CLASS HIERARCHY (if applicable) ===
Extends: {parentClass} ({parentFile})
Implements: {interfaceList}
Methods: {methodList}

=== CALL GRAPH ===
Callers (who calls this, with file paths):
  {callerName} ({callerFile}:{callerLine})
  {callerName} ({callerFile}:{callerLine})
  ... (up to 10 callers)

Callees (what this calls, with file paths):
  {calleeName} ({calleeFile}:{calleeLine})
  {calleeName} ({calleeFile}:{calleeLine})
  ... (up to 10 callees)

=== ALREADY-JUSTIFIED CALLEES (from lower processing levels) ===
  - {calleeName}: taxonomy={calleeTaxonomy}, feature_area={calleeFeatureArea},
    purpose="{calleePurpose}", business_value={calleeBusinessValue}
  - {calleeName}: taxonomy={calleeTaxonomy}, feature_area={calleeFeatureArea},
    purpose="{calleePurpose}", business_value={calleeBusinessValue}
  ... (all justified callees — this is the hierarchical context that makes
       higher-level justifications accurate)

=== DETECTED DESIGN PATTERNS ===
{designPatterns}
  e.g., "Factory (creates instances via create* method)",
        "Repository (CRUD methods: findById, create, update, delete)"
  (empty if no patterns detected — do NOT hallucinate patterns)

=== SIDE EFFECTS & DATA FLOW (heuristic-detected) ===
{sideEffects}
  e.g., "Writes to database (this.repo.save())",
        "Sends HTTP request (fetch())",
        "Reads environment variable (process.env.STRIPE_KEY)"
  (empty if none detected)

=== SEMANTICALLY SIMILAR ENTITIES (from pgvector, top 5) ===
  - {similarName} ({similarKind}, {similarFile}):
    taxonomy={similarTaxonomy}, feature_area={similarFeatureArea},
    purpose="{similarPurpose}"
  ... (only entities that have already been justified)

=== CANONICAL FEATURE AREAS (pick from this list or propose new) ===
{featureAreaList}
  e.g., ["Authentication", "Checkout", "User Management", "Notifications",
         "Billing", "Search", "Admin"]

=== CANONICAL TAGS (pick relevant ones or propose new) ===
{tagsList}
  e.g., ["authentication", "database", "validation", "api", "middleware",
         "payment", "email", "caching", "error-handling", "serialization"]

=== INSTRUCTIONS ===
Produce a JSON object with these EXACT fields:

1. "purpose" (string, 2-4 sentences): What this entity does and WHY it exists.
   Be specific: mention the business domain, the data it operates on, and the
   outcome it produces. Do NOT be vague (bad: "handles logic", good: "Validates
   that a shopping cart's total matches the sum of line item prices before
   initiating a Stripe payment charge, preventing overcharge disputes").

2. "business_value" (enum): Pick ONE from:
   "Revenue Critical" | "Core Infrastructure" | "User Experience" |
   "Compliance & Security" | "Developer Productivity" | "Operational" | "Supporting"

3. "taxonomy" (enum): Pick ONE from: "VERTICAL" | "HORIZONTAL" | "UTILITY"
   - VERTICAL: Implements business logic specific to a feature/domain
   - HORIZONTAL: Infrastructure shared across features (auth, DB, cache, logging)
   - UTILITY: Pure helper with no business or infrastructure semantics

4. "feature_area" (string | null): Required if taxonomy == "VERTICAL".
   Pick from the canonical list above, or propose a new one (will be normalized).
   null if HORIZONTAL or UTILITY.

5. "user_flows" (array | null): Required if taxonomy == "VERTICAL".
   Each flow: { "name": "Checkout Flow", "step": "Validate cart totals",
   "actors": ["Customer", "PaymentService"] }
   null if HORIZONTAL or UTILITY.

6. "technology_type" (enum | null): Required if taxonomy == "HORIZONTAL".
   Pick ONE from: "Database" | "Cache" | "Queue" | "Auth" | "Logging" |
   "Monitoring" | "HTTP" | "Storage" | "Config" | "Serialization"
   null if VERTICAL or UTILITY.

7. "consumers" (string[] | null): Required if taxonomy == "HORIZONTAL".
   List the feature_areas that depend on this infrastructure.
   e.g., ["Checkout", "User Management"]. null if VERTICAL or UTILITY.

8. "tags" (string[]): 2-6 lowercase tags from the canonical list (or new ones).
   e.g., ["authentication", "middleware", "security"]

9. "confidence" (number): 0.0–1.0. How confident you are in this justification.
   >0.9 = very clear-cut, 0.7–0.9 = reasonably confident, <0.7 = uncertain.
```

**Token budget per entity:**

| Complexity | Input budget | Output budget | Model | Context window |
|---|---|---|---|---|
| Simple (≤3 callees, <50 LOC, kind: function/variable) | ~3,000 tokens | ~400 tokens | gpt-4o-mini | 4,096 |
| Complex (>3 callees, ≥50 LOC, kind: class/module/entry point) | ~6,000 tokens | ~600 tokens | gpt-4o | 8,192 |

**Why larger token budgets than the initial design:** Code Synapse's experience shows that skimping on input context leads to generic, low-confidence justifications. The extra cost (~$0.002/entity for simple, ~$0.02/entity for complex) is negligible compared to the quality improvement. The expanded prompt includes file context, class hierarchy, design patterns, and side effects — each adding ~200-500 tokens but dramatically improving the LLM's ability to produce specific, accurate justifications.

**Semantic context enrichment:** Before sending the prompt, the pipeline calls `vectorSearch.search()` with the entity's existing embedding to find the top-5 most similar entities. If any of those entities are already justified (from a lower level), their justifications are included in the prompt. This provides cross-entity context that dramatically improves accuracy — for example, if `validateInput()` is similar to `sanitizeInput()` and `checkPermissions()`, and the latter two are justified as HORIZONTAL/Authentication, the LLM is much more likely to correctly justify `validateInput()` as HORIZONTAL.

### Post-Processing & Normalization (Output Consistency)

Raw LLM output goes through mandatory normalization before storage:

```
Normalization Pipeline:

1. Zod validation (JustificationSchema.parse) — rejects invalid taxonomy/business_value enums
2. feature_area normalization:
   - Trim whitespace, title-case: " checkout " → "Checkout"
   - Alias resolution: "Auth" → "Authentication", "Payments" → "Billing" (configurable alias map)
   - Fuzzy match against canonical list: if Levenshtein distance < 3, snap to canonical
   - If truly new: add to canonical list for this repo (stored in ArangoDB)
3. tags normalization:
   - Lowercase, trim, singular form: "Authentications" → "authentication"
   - Alias resolution: "auth" → "authentication", "db" → "database"
   - Dedup: remove exact duplicates after normalization
4. user_flows dedup:
   - Normalize flow names: lowercase + trim for comparison
   - Merge flows with same normalized name (keep most detailed version)
5. design_patterns merge:
   - Combine heuristic-detected patterns with any LLM-mentioned patterns
   - Dedup by pattern name (case-insensitive)
```

This normalization ensures that across 5,000 entities in a repo, "Authentication" is always "Authentication" (never "Auth", "auth-module", "AuthN", "Authentication & Security") and tags like "database" are always "database" (never "db", "Database", "data-store").

### Design Pattern Detection (Heuristic, Pre-LLM)

Before LLM justification, a `detectDesignPatterns` activity runs heuristic pattern detection across all entities. This is a fast, deterministic pass that does NOT use the LLM — it uses naming conventions, method signatures, and structural patterns:

| Pattern | Detection Signals | Example |
|---|---|---|
| **Factory** | Methods named `create*`, `make*`, `build*` that return new instances | `createUser()`, `makePayment()` |
| **Singleton** | Private constructor + static `getInstance` / `instance` field | `DatabasePool.getInstance()` |
| **Observer** | Methods named `subscribe`, `on`, `emit`, `addEventListener`, `notify` | `eventBus.on("order.created")` |
| **Repository** | CRUD methods: `find*`, `get*`, `create*`, `update*`, `delete*`, `save*` on a class | `UserRepository.findById()` |
| **Service** | Class named `*Service` with injected dependencies, stateless methods | `PaymentService.processCharge()` |
| **Builder** | Method chaining (`return this`), terminal `build()` method | `QueryBuilder.where().limit().build()` |
| **Strategy** | Interface with single method, multiple implementations | `IPricingStrategy.calculate()` |
| **Decorator** | Wraps another instance of same interface, delegates + extends | `LoggingMiddleware(handler)` |

**Output:** `Map<entityKey, string[]>` — each entity gets its detected patterns (may be empty). These are included in the LLM prompt AND merged into the final justification's `design_patterns` field. The LLM can confirm, reject, or add patterns not caught by heuristics.

### Feature Aggregation

After all entities are justified, the `aggregateFeatures` activity builds the features collection:

```
Feature Aggregation Algorithm:

Input: All justifications where taxonomy == "VERTICAL"

1. Group by feature_area (already normalized by post-processing pipeline)
   All entities with feature_area == "Checkout" → same feature

2. For each feature group:
   a) Count total entities
   b) Identify entry points: entities with 0 external callers (or only callers from other features)
   c) Merge user_flows from all entities (deduplicate by normalized flow name)
   d) Identify horizontal dependencies: collect all HORIZONTAL entities called by any entity in this feature
   e) Compute average confidence across all entities
   f) Collect unique tags across all entities in the feature → feature-level tags

3. Upsert features collection document with computed stats
4. Create belongs_to_feature edges for each entity → feature mapping

Edge cases:
- Entity justified as VERTICAL but feature_area is null/empty:
  Assigned to "Uncategorized" feature. Dashboard shows this as a warning.
- Feature with 0 entry points: Likely a support library for other features.
  Still created as a feature but flagged for review.
- Very small features (<3 entities): Might be noise. Marked with low confidence.
```

### ArangoDB Collection Layout

Phase 4 adds 4 document collections and 2 edge collections to the org-scoped database. Note: justification is a **unified document** — there is no separate `classifications` collection.

```
org_{org_id}/
  ├── justifications           (document collection — UNIFIED, one per entity)
  │   _key: "j_{entity_key}"
  │   Fields:
  │     entity_key       String    — FK to entity (e.g., "fn_validatePayment")
  │     org_id           String    — multi-tenant isolation
  │     repo_id          String    — repo scope
  │     purpose          String    — 2-4 sentence plain-English "what + why"
  │     business_value   String    — ENUM: "Revenue Critical" | "Core Infrastructure" |
  │                                  "User Experience" | "Compliance & Security" |
  │                                  "Developer Productivity" | "Operational" | "Supporting"
  │     taxonomy         String    — ENUM: "VERTICAL" | "HORIZONTAL" | "UTILITY"
  │     feature_area     String?   — normalized feature name (VERTICAL only, null otherwise)
  │     user_flows       Array?    — [{ name, step, actors[] }] (VERTICAL only)
  │     technology_type  String?   — ENUM: "Database" | "Cache" | "Queue" | "Auth" | etc. (HORIZONTAL only)
  │     consumers        Array?    — feature_areas that depend on this (HORIZONTAL only)
  │     tags             Array     — ["authentication", "middleware", "security"] (normalized, lowercase)
  │     design_patterns  Array     — ["Factory", "Repository"] (merged: heuristic + LLM)
  │     confidence       Number    — 0.0–1.0
  │     model_used       String    — "gpt-4o-mini" | "gpt-4o" | "claude-3-5-haiku-latest"
  │     processing_level Number    — topological sort level (0 = leaf)
  │     tokens_used      Number    — total input + output tokens
  │     prompt_hash      String    — SHA-256 of prompt (for cache-busting on re-runs)
  │     created_at       String    — ISO 8601
  │     updated_at       String    — ISO 8601
  │
  ├── features                 (document collection)
  │   _key: "feature_{normalized_name}"
  │   Fields:
  │     name                    String    — canonical feature name (e.g., "Authentication")
  │     org_id                  String
  │     repo_id                 String
  │     entity_count            Number    — count of VERTICAL entities in this feature
  │     entry_points            Array     — entity keys with 0 external callers
  │     user_flows              Array     — merged + deduplicated from all entities
  │     horizontal_dependencies Array     — HORIZONTAL entity keys this feature depends on
  │     tags                    Array     — unique tags across all entities in feature
  │     confidence_avg          Number    — average confidence across entities
  │     created_at              String
  │     updated_at              String
  │
  ├── health_reports           (document collection)
  │   _key: "health_{repo_id}_{version}"
  │   Fields: org_id, repo_id, version (incrementing), executive_summary,
  │           overall_score, sections (dead_code, architecture_drift, testing_gaps,
  │           duplicate_logic, circular_deps, unused_exports, complexity_hotspots),
  │           llm_risk_assessment, suggested_rules[], created_at
  │
  ├── token_usage_log          (document collection — cost tracking)
  │   _key: UUID
  │   Fields: org_id, repo_id, entity_key, model_used, input_tokens, output_tokens,
  │           cost_usd, activity_type, workflow_id, created_at
  │   TTL index: 90 days (auto-expire for cost-conscious deployments)
  │
  ├── justified_by             (edge: functions/classes/etc → justifications)
  └── belongs_to_feature       (edge: functions/classes/etc → features)
```

**Indexes:**
- `justifications`: hash index on `(entity_key, org_id)` (lookup by entity)
- `justifications`: fulltext index on `purpose` (for `search_by_purpose` keyword leg)
- `justifications`: persistent index on `(taxonomy, org_id, repo_id)` (filter by taxonomy)
- `justifications`: persistent index on `(feature_area, org_id, repo_id)` (filter by feature_area)
- `features`: hash index on `(name, org_id, repo_id)`
- `token_usage_log`: persistent index on `(org_id, repo_id, created_at)` (cost dashboard queries)
- `token_usage_log`: TTL index on `created_at` (90-day auto-expiry)

### Justification Embedding (Required)

Phase 4 embeds justification text (`purpose` + `business_value` + `tags` joined) into pgvector. This enables `search_by_purpose` to use semantic search on business-purpose text (not just entity code), dramatically improving business-purpose queries:

```
Entity Embedding (Phase 3):         embed("function validatePayment(cart: Cart): boolean { ... }")
Justification Embedding (Phase 4):  embed("Validates that a shopping cart total matches the sum of
                                           line item prices before initiating a Stripe payment charge,
                                           preventing overcharge disputes. Revenue Critical.
                                           authentication payment validation checkout")
                                           ← purpose + business_value + tags concatenated
```

These are stored in a separate pgvector table `kap10.justification_embeddings` to avoid conflating code semantics with business semantics. The `search_by_purpose` MCP tool queries this table instead of `entity_embeddings`.

**Schema:**

```
Table: kap10.justification_embeddings
Columns: id (UUID PK), org_id, repo_id, entity_key,
         purpose_text TEXT,           ← the concatenated text that was embedded
         embedding vector(768),
         created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
Unique: (repo_id, entity_key)
Index: HNSW on embedding vector_cosine_ops (m=16, ef_construction=64)
```

**Embedding text construction:**
```typescript
function buildJustificationEmbeddingText(j: Justification): string {
  const parts = [j.purpose, j.businessValue];
  if (j.featureArea) parts.push(j.featureArea);
  if (j.tags.length) parts.push(j.tags.join(" "));
  return parts.join(". ");
}
```

---

## 1.3 Reliability & Resilience

### Failure Scenario Matrix

| # | Failure Scenario | Probability | Impact | Detection | Recovery Strategy |
|---|-----------------|-------------|--------|-----------|-------------------|
| 1 | **OpenAI API rate limit** during batch justification | High (at scale) | Level processing pauses. Entities in that batch unjustified. | HTTP 429 from OpenAI. Vercel AI SDK throws `APICallError`. | Temporal activity retries with exponential backoff (initial: 5s, max: 60s, factor: 2). After 3 retries on OpenAI, automatic fallback to `claude-3-5-haiku` for that entity. Rate limit budget: cap at 500 RPM (OpenAI Tier 2) with semaphore. |
| 2 | **OpenAI API 500/502/503** — transient server error | Medium | Single entity justification fails. | Non-429 error from Vercel AI SDK. | Retry 3 times with 10s backoff. If still failing: fallback to Anthropic. If both fail: mark entity as `justification_failed` (nullable fields in ArangoDB), log to `token_usage_log` with `cost_usd: 0` and `error` field. Continue processing remaining entities. |
| 3 | **LLM returns invalid justification** — structured output fails Zod validation | Low (Vercel AI SDK handles this) | Single entity gets garbage justification. | `generateObject` throws `ZodError` or `JSONParseError`. | Vercel AI SDK automatically retries with a corrective prompt ("Your response didn't match the expected schema. Here are the errors: ..."). Up to 3 auto-retries. If still invalid: mark entity as `justification_failed`. |
| 4 | **Topological sort OOM** on large repos (50K+ entities) | Low–Medium | `topoSort` activity crashes. Workflow fails. | Temporal activity timeout (heartbeat stops). OOM kill signal. | `topoSort` runs on `heavy-compute-queue` with 4 GB memory. For repos exceeding memory: stream edges from ArangoDB in batches (cursor-based) instead of loading all into memory. Fallback: process entities in file-path order (lose hierarchical context but avoid OOM). |
| 5 | **Cycle in call graph** — mutual recursion | Medium | Topological sort cannot assign levels to cycled entities. | SCC detection finds cycles with >1 node. | Break cycles using Tarjan's SCC algorithm. All entities in a cycle are assigned the same level. They're justified concurrently with partial context from each other (first-pass: justify without peer context, second-pass: re-justify with peer results). |
| 6 | **justifyRepoWorkflow timeout** — very large repo takes too long | Low | Repo never finishes justification. | Temporal workflow execution timeout (default: 24h for full-repo). | Workflow uses `continueAsNew` after every 5,000 entities (Temporal event history limit). Progress is checkpointed — entities already justified are skipped on restart. User sees progress bar in dashboard. |
| 7 | **ArangoDB write failure** during writeJustifications | Low | Justification data lost for that batch. | ArangoDB error response. | Retry batch write 3 times. If still failing: write entities individually (1 at a time) to isolate the bad document. Mark failed entities in workflow state. |
| 8 | **Cost overrun** — LLM costs exceed expected budget for a repo | Medium | Unexpected billing for org. | Token usage tracking in `token_usage_log`. Pre-flight cost estimate in UI. | **Cost guardrail:** Before starting `justifyRepoWorkflow`, compute estimated cost based on entity count and complexity distribution. If estimated cost > org's monthly budget (configurable, default $50): pause workflow, notify org admin via dashboard alert, await manual approval. Dashboard shows real-time cost accumulation during justification. |
| 9 | **Stale justifications** after re-index (Phase 5 changes entities) | High | Justifications reference entities that have been modified or deleted. | Entity hash changes detected by incremental indexer. | Phase 5's `cascadeReJustify` activity triggers `justifyEntityWorkflow` for changed entities. Deleted entities → delete justification + justified_by edge. This flow is documented here but implemented in Phase 5. |
| 10 | **Concurrent justification runs** — user triggers re-justify while one is running | Medium | Duplicate work, potential ArangoDB write conflicts. | Temporal workflow ID deduplication: `justify-{orgId}-{repoId}`. | Temporal's built-in workflow ID conflict policy: `WORKFLOW_ID_CONFLICT_POLICY_USE_EXISTING`. Second start request is silently ignored. Dashboard shows "Justification already in progress". |
| 11 | **Health report LLM synthesis produces low-quality output** | Medium | Executive summary is generic or inaccurate. | No automated detection — relies on user feedback. | The health report is regeneratable: "Regenerate Report" button in dashboard triggers a new `generateHealthReportWorkflow`. LLM temperature is set to 0 for determinism. Report includes raw analysis data alongside the LLM summary so users can verify. |

### Provider Failover Strategy

```
Primary:  OpenAI (gpt-4o-mini for simple, gpt-4o for complex)
    ↓ (on 429 / 5xx / timeout after 3 retries)
Fallback: Anthropic (claude-3-5-haiku-latest)
    ↓ (on failure)
Deferred: Mark entity as justification_failed, continue pipeline.
          Dashboard shows "X entities need re-justification" badge.
          User can trigger re-justify for failed entities manually.
```

**Provider health tracking:** Each LLM call records latency and error status in `token_usage_log`. A background cron (every 5 min) computes error rate per provider per hour. If error rate > 20%: proactively route ALL new entities to the fallback provider for 15 minutes. This avoids burning rate-limit retries on a known-degraded provider.

### Cost Guardrail Flow

```
User clicks "Analyze Architecture" (or automatic trigger after embedding)
    │
    ▼
Estimate cost: entity_count × avg_tokens_per_entity × cost_per_token
    │
    ├── Estimated cost < org budget → Start justifyRepoWorkflow automatically
    │
    └── Estimated cost ≥ org budget → Dashboard shows:
        "Estimated cost: $12.50 for 25,000 entities. Your monthly budget is $10.
         Approve additional spend, or reduce scope (e.g., justify only VERTICAL candidates)."
        [Approve] [Reduce Scope] [Cancel]
```

---

## 1.4 Performance Considerations

### Latency Budgets

| # | Path | Target | Breakdown | Bottleneck | Mitigation |
|---|------|--------|-----------|------------|------------|
| 1 | **Full-repo justification (1K files, ~5K entities)** | < 15 min | topoSort (~10s) + 5K entities × ~2s/entity avg (batched, 10 concurrent LLM calls) | LLM API latency (~1.5s per call avg) × entity count. Sequential level processing adds overhead. | Concurrency: 10 parallel LLM calls per level (semaphore). gpt-4o-mini is faster than gpt-4o. Pipeline entities within a level in parallel. |
| 2 | **Full-repo justification (10K+ files, ~50K entities)** | < 60 min | topoSort (~120s) + 50K entities × ~2s avg / 10 concurrency | LLM throughput capped at ~300 RPM (OpenAI Tier 2). 50K entities / 300 RPM = 167 min theoretical max. | Increase concurrency to 20 for enterprise plans. Use gpt-4o-mini for 70% of entities. Temporal `continueAsNew` prevents event history overflow. |
| 3 | **`get_justification` MCP tool call** | < 100ms | ArangoDB unified justification lookup (~30ms) + feature lookup (~20ms) | Two queries (or single AQL with subquery). | Single AQL: `LET j = ... LET f = (j.taxonomy == "VERTICAL" ? ...) RETURN MERGE(j, {feature: f})`. Cache result in Redis (TTL 10 min). |
| 4 | **`search_by_purpose` MCP tool call** | < 500ms | Embed query (~50ms) + pgvector search on justification_embeddings (~80ms) + ArangoDB fulltext on purpose (~80ms) + RRF merge (~5ms) + optional LLM re-rank (~300ms) | LLM re-ranking adds 300ms. | Make LLM re-ranking optional (param `rerank: boolean`, default false). Without re-rank: <200ms. Agent can choose to re-rank when quality matters more than speed. |
| 5 | **`get_blueprint` MCP tool call** | < 200ms | ArangoDB features collection scan (~50ms) + edge traversal (~80ms) + aggregation (~20ms) | Feature count for large repos (20+ features → many edges). | Cache blueprint data in Redis (TTL 30 min, invalidated on justification update). Blueprint data is relatively static — no workspace overlay concern. |
| 6 | **`analyze_impact` MCP tool call** | < 800ms | Phase 2 `impactAnalysis` graph traversal (~400ms) + fetch justifications for affected entities (~200ms) + feature context (~100ms) | Graph traversal at depth 5 can produce 500+ affected entities. | Reuse Phase 2's impact analysis with depth cap. Fetch justifications in batch (single AQL for N entities). Truncate to top 50 by connectivity. |
| 7 | **Health report generation** | < 5 min | Data gathering (~30s) + 7 parallel analyses (~60s) + LLM synthesis (~120s) + storage (~5s) | LLM synthesis processes all 7 analysis results in a single prompt. Large context window required. | Use gpt-4o (128K context window) for synthesis. Cap analysis results: max 10 items per section → synthesis prompt stays within 30K tokens. |
| 8 | **Single-entity re-justification** | < 5s | Context build (~100ms) + LLM call (~1.5s) + write (~100ms) + cascade check (~500ms) | LLM call dominates. Cascade adds variable cost. | No optimization needed — 5s is acceptable for background processing. Cascade is async (separate workflow). |

### Concurrency & Rate Limiting

```
LLM Call Concurrency Model:

Per-workflow semaphore: 10 concurrent LLM calls (default)
  → Configurable per org (enterprise plans: up to 20)
  → Prevents overwhelming OpenAI rate limits

Rate limit budget:
  OpenAI Tier 2: 500 RPM, 800K TPM
  With 10 concurrency × ~2s/call: ~300 RPM (well within limit)
  With 20 concurrency × ~2s/call: ~600 RPM (may hit 500 RPM limit)
    → Semaphore auto-throttles: if 429 received, reduce concurrency by 50% for 30s

Token budget per entity:
  Simple: ~1,500 input + ~150 output = ~1,650 total
  Complex: ~3,000 input + ~250 output = ~3,250 total
  Average: ~2,000 tokens/entity
```

### Caching Strategy

| Data | Store | TTL | Invalidation |
|------|-------|-----|-------------|
| **`get_justification` result** | Redis | 10 min | On entity re-justification (`justifyEntityWorkflow` completion) |
| **`get_blueprint` result** | Redis | 30 min | On `aggregateFeatures` completion |
| **`search_by_purpose` result** | Redis | 5 min | On justification update (same pattern as Phase 3 search cache) |
| **LLM response (per prompt hash)** | Redis | 24 hours | Never (deterministic prompt → deterministic output at temp=0). Cache key: `llm:{model}:{sha256(prompt)}`. Saves cost on re-runs. |
| **Health report** | ArangoDB | Permanent (versioned) | New version created on each generation. Old versions kept for history. |

**LLM response cache rationale:** If the same entity is re-justified with the exact same code, callers, callees, and dependency context, the LLM will produce the same result (temperature=0). Caching by prompt hash avoids paying for redundant justifications. This is particularly valuable during development/testing when re-running the pipeline on the same repo.

---

## 1.5 Phase Bridge → Phase 5

Phase 4 establishes the business intelligence layer that Phase 5 (Incremental Indexing & GitHub Webhooks) directly consumes for cascade re-justification.

### What Phase 5 Consumes from Phase 4

| Phase 4 artifact | Phase 5 usage |
|-----------------|---------------|
| **justifyEntityWorkflow** | Phase 5's `cascadeReJustify` activity triggers this workflow for each entity affected by a code change. The workflow is already designed for single-entity invocation. |
| **JustificationSchema** | Phase 5 re-uses the same schema — re-justified entities produce the same structured output. No schema evolution needed. |
| **justifications collection** | Phase 5's incremental pipeline reads existing justifications to determine if a code change warrants re-justification (cosine distance > 0.3 on justification embedding). |
| **features collection** | Phase 5 updates features when entity justifications change (entity moves from one feature_area to another, or new entities are added to a feature). The `aggregateFeatures` activity is reusable as-is. |
| **token_usage_log** | Phase 5's re-justification costs are tracked in the same log. Dashboard shows cumulative costs per repo over time. |
| **Health Report** | Phase 5 triggers health report regeneration after each full re-index (not after every push — only on significant changes or manual trigger). |

### What Phase 4 Must NOT Do (to avoid Phase 5 rework)

1. **Do not hard-code full-repo-only justification.** The `justifySingle` activity must accept a single entity with pre-built context. Phase 5 calls it directly for individual entities without running the full pipeline.
2. **Do not store justifications only in ArangoDB.** The `justification_embeddings` pgvector table is critical for Phase 5's "significant change" detection (cosine distance comparison). Both stores must be populated.
3. **Do not couple feature aggregation to the full-repo workflow.** `aggregateFeatures` must be callable independently (Phase 5 calls it after a single entity changes feature_area).
4. **Do not make health report generation a blocking part of justification.** It's a child workflow that runs asynchronously. Phase 5 only triggers it on full re-index, not per-push.
5. **Do not allow free-text variance in constrained fields.** The `taxonomy`, `business_value`, and `technology_type` fields MUST be Zod enums. The `feature_area` and `tags` fields MUST go through the post-processing normalization pipeline. If Phase 5 re-justifies an entity, it must use the same canonical value lists seeded during the original full-repo run.

### Schema Forward-Compatibility

- **`justifications.prompt_hash`:** Phase 5 uses this to detect if a re-justification would produce the same result (entity code unchanged → same prompt hash → skip LLM call, reuse cached result). This is the primary cost optimization for incremental re-justification.
- **`justifications.updated_at`:** Phase 5's cascade logic checks this timestamp to avoid re-justifying entities that were recently re-justified (within the last 5 minutes).
- **`token_usage_log.workflow_id`:** Phase 5 links re-justification costs to the specific `incrementalIndexWorkflow` run that triggered them. This enables cost attribution per push/commit.

### Infrastructure Forward-Compatibility

- **Temporal workflow separation:** `justifyRepoWorkflow` (full-repo) and `justifyEntityWorkflow` (single-entity) are independent. Phase 5 only invokes the latter. No workflow changes needed.
- **Model routing remains unchanged:** Phase 5's re-justified entities use the same complexity routing. The `getModel()` function is shared.
- **`light-llm-queue`:** All Phase 4 LLM activities run on the light queue. Phase 5's cascade activities also run here. No queue changes needed.

---

# Part 2: Implementation & Tracing Tracker

## 2.1 Infrastructure Layer

### Environment & Configuration

- [ ] **P4-INFRA-01: Add Vercel AI SDK env vars to `env.mjs`** — S
  - New variables: `OPENAI_API_KEY` (required for Phase 4), `ANTHROPIC_API_KEY` (optional — fallback provider), `LLM_CONCURRENCY` (default: 10, max: 20), `LLM_COST_BUDGET_MONTHLY_USD` (default: 50)
  - AI SDK reads `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` automatically from env (convention)
  - **Test:** `pnpm build` succeeds. Missing `ANTHROPIC_API_KEY` doesn't crash (fallback disabled gracefully). Missing `OPENAI_API_KEY` produces clear error: "Phase 4 requires OPENAI_API_KEY".
  - **Depends on:** Nothing
  - **Files:** `env.mjs`, `.env.example`
  - Notes: _____

- [ ] **P4-INFRA-02: Install Vercel AI SDK + provider packages** — S
  - Packages: `ai` (core), `@ai-sdk/openai` (OpenAI provider), `@ai-sdk/anthropic` (Anthropic provider)
  - These are `dependencies`, not `devDependencies` — they run on the light worker
  - **Test:** `pnpm install` succeeds. `import { generateObject } from 'ai'` resolves. TypeScript types available.
  - **Depends on:** Nothing
  - **Files:** `package.json`
  - Notes: _____

- [ ] **P4-INFRA-03: Update `.env.example` with Phase 4 variables** — S
  - Document: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `LLM_CONCURRENCY`, `LLM_COST_BUDGET_MONTHLY_USD`
  - Add comment block explaining provider routing and cost guardrails
  - **Test:** `cp .env.example .env.local` + fill → pipeline functional.
  - **Depends on:** P4-INFRA-01
  - **Files:** `.env.example`
  - Notes: _____

---

## 2.2 Database & Schema Layer

- [ ] **P4-DB-01: Add `justificationStatus` and `healthReportStatus` columns to Repo model** — S
  - New columns on `kap10.repos`: `justification_status` (String, default "pending"), `health_report_status` (String, default "pending")
  - Not an enum — plain string to avoid migration on every status addition
  - Values: `pending | running | complete | failed` (justification), `pending | generating | available | failed` (health report)
  - **Test:** Migration runs. Existing repos get default "pending". Status updates work.
  - **Depends on:** Nothing
  - **Files:** `prisma/schema.prisma`, new migration file
  - **Acceptance:** Columns exist. Default values correct. No impact on existing queries.
  - Notes: _____

- [ ] **P4-DB-02: Create ArangoDB collections for Phase 4** — M
  - Document collections: `justifications` (unified), `features`, `health_reports`, `token_usage_log`
  - Edge collections: `justified_by`, `belongs_to_feature`
  - Create within `bootstrapGraphSchema()` (extend existing method)
  - Indexes:
    - `justifications`: hash on `(entity_key, org_id)`, fulltext on `purpose`, persistent on `(taxonomy, org_id, repo_id)`, persistent on `(feature_area, org_id, repo_id)`
    - `features`: hash on `(name, org_id, repo_id)`
    - `token_usage_log`: persistent on `(org_id, repo_id, created_at)`, TTL on `created_at` (90 days)
  - **Test:** `bootstrapGraphSchema()` creates all collections. Indexes verified via `db._collection().indexes()`. Document insert/read works on each collection.
  - **Depends on:** Nothing (extends existing ArangoDB setup)
  - **Files:** `lib/adapters/arango-graph-store.ts`
  - **Acceptance:** All 4 doc collections + 2 edge collections created. Indexes in place. TTL index verified (insert doc, verify expiry after TTL).
  - Notes: _____

- [ ] **P4-DB-03: Create `justification_embeddings` table in pgvector** — M
  - SQL migration: `CREATE TABLE kap10.justification_embeddings (id UUID PK, org_id TEXT, repo_id TEXT, entity_key TEXT, purpose_text TEXT, embedding vector(768), created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)`
  - Unique constraint: `(repo_id, entity_key)`
  - HNSW index: `CREATE INDEX idx_justification_embeddings_hnsw ON kap10.justification_embeddings USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)`
  - Composite index: `CREATE INDEX idx_justification_embeddings_repo ON kap10.justification_embeddings (repo_id, entity_key)`
  - **Test:** `\d kap10.justification_embeddings` shows correct schema. Upsert by `(repo_id, entity_key)` works. Vector similarity search works.
  - **Depends on:** Phase 3 P3-DB-02 (pgvector extension enabled)
  - **Files:** `prisma/schema.prisma`, new migration file
  - **Acceptance:** Table exists. HNSW index created. Cosine similarity query on 10K embeddings < 100ms.
  - Notes: _____

- [ ] **P4-DB-04: Add `JustificationEmbedding` Prisma model** — S
  - Model with `@@schema("kap10")`, `@@map("justification_embeddings")`
  - Fields matching the SQL migration above
  - `embedding` field: `Unsupported("vector(768)")`
  - **Test:** `pnpm migrate` runs. Model introspectable via Prisma Client.
  - **Depends on:** P4-DB-03
  - **Files:** `prisma/schema.prisma`
  - Notes: _____

---

## 2.3 Ports & Adapters Layer

### ILLMProvider — Phase 4 Implementation

- [ ] **P4-ADAPT-01: Implement `VercelAILLMProvider` adapter** — L
  - Implement `ILLMProvider.generateObject()` using Vercel AI SDK's `generateObject()`
  - Implement `ILLMProvider.streamText()` using Vercel AI SDK's `streamText()`
  - Model routing: `getModel(complexity)` → `openai('gpt-4o-mini')` / `openai('gpt-4o')` / `anthropic('claude-3-5-haiku-latest')`
  - Provider fallback: on OpenAI error, auto-retry with Anthropic
  - Token usage tracking: extract `usage` from response, return as `TokenUsage`
  - Lazy initialization: models created on first call (not at import time)
  - **Test:** `generateObject()` with JustificationSchema → returns valid typed object. Fallback: mock OpenAI failure → Anthropic called. Token usage returned.
  - **Depends on:** P4-INFRA-02
  - **Files:** `lib/adapters/vercel-ai-llm-provider.ts`, `lib/ai/models.ts`
  - **Acceptance:** Provider-agnostic via `ILLMProvider` port. Fallback works. Usage tracked. No top-level imports of `ai` or `@ai-sdk/*`.
  - Notes: _____

- [ ] **P4-ADAPT-02: Register `VercelAILLMProvider` in DI container** — S
  - Update `lib/di/container.ts`: add `llmProvider` getter that lazy-loads `VercelAILLMProvider`
  - Replace the existing `NotImplementedError` stub for `ILLMProvider`
  - **Test:** `getContainer().llmProvider.generateObject(...)` works in integration test.
  - **Depends on:** P4-ADAPT-01
  - **Files:** `lib/di/container.ts`
  - **Acceptance:** `llmProvider` lazily initialized. No build-time connections to OpenAI.
  - Notes: _____

- [ ] **P4-ADAPT-03: Update `InMemoryLLMProvider` fake for testing** — S
  - The existing `InMemoryLLMProvider` in `lib/di/fakes.ts` must return deterministic taxonomy results
  - `generateObject()`: return a pre-configured taxonomy based on entity name heuristics (name contains "format"/"slugify" → UTILITY, name contains "auth"/"login" → HORIZONTAL, otherwise → VERTICAL)
  - Token usage: return deterministic `{ inputTokens: 100, outputTokens: 50 }`
  - **Test:** `createTestContainer()` provides working LLM provider. Unit tests don't call real APIs.
  - **Depends on:** Nothing
  - **Files:** `lib/di/fakes.ts`
  - **Acceptance:** All Phase 4 unit tests pass with fakes. No network calls.
  - Notes: _____

### IGraphStore — Phase 4 Additions

- [ ] **P4-ADAPT-04: Implement unified justification CRUD methods on `ArangoGraphStore`** — M
  - New methods: `upsertJustification(orgId, justification)`, `getJustification(orgId, entityKey)`, `getJustificationsByTaxonomy(orgId, repoId, taxonomy)`, `getJustificationsByFeatureArea(orgId, repoId, featureArea)`, `batchUpsertJustifications(orgId, justifications[])`, `deleteJustification(orgId, entityKey)`
  - Justification is a UNIFIED document containing: purpose, business_value, taxonomy, feature_area, user_flows, technology_type, consumers, tags, design_patterns, confidence (see Canonical Terminology)
  - All methods scoped to org (multi-tenant)
  - Batch methods for efficient write during pipeline execution
  - **Test:** Upsert justification → read it back (all fields including tags, design_patterns). Batch upsert 100 → all retrievable. Filter by taxonomy returns correct entities. Filter by feature_area returns correct VERTICAL entities.
  - **Depends on:** P4-DB-02
  - **Files:** `lib/ports/graph-store.ts` (interface), `lib/adapters/arango-graph-store.ts` (implementation)
  - **Acceptance:** CRUD works. Multi-tenant isolation verified. Batch writes <500ms for 100 documents. Unified model — no separate classification methods needed.
  - Notes: _____

- [ ] **P4-ADAPT-05: Implement feature aggregation methods on `ArangoGraphStore`** — M
  - Extend existing `getFeatures()` and `getBlueprint()` stubs with real implementation
  - New methods: `upsertFeature(orgId, feature)`, `deleteFeature(orgId, featureKey)`, `getFeatureByEntity(orgId, entityKey)`
  - `getBlueprint()`: aggregate features + HORIZONTAL nodes + consumer edges into `BlueprintData`
  - **Test:** Upsert features → `getBlueprint()` returns correct structure. Entity→feature edges traversable.
  - **Depends on:** P4-DB-02
  - **Files:** `lib/ports/graph-store.ts`, `lib/adapters/arango-graph-store.ts`
  - **Acceptance:** Blueprint data correct. Feature CRUD works. Edges properly link entities to features.
  - Notes: _____

- [ ] **P4-ADAPT-06: Implement health report storage methods** — S
  - New methods: `storeHealthReport(orgId, repoId, report)`, `getHealthReport(orgId, repoId, version?)`, `getLatestHealthReport(orgId, repoId)`
  - Versioned: each generation creates a new document with incrementing version
  - **Test:** Store report → retrieve by version. Store 3 versions → `getLatest` returns v3.
  - **Depends on:** P4-DB-02
  - **Files:** `lib/adapters/arango-graph-store.ts`
  - **Acceptance:** Versioned storage works. Latest retrieval correct.
  - Notes: _____

- [ ] **P4-ADAPT-07: Implement token usage logging methods** — S
  - New methods: `logTokenUsage(orgId, entry)`, `getTokenUsage(orgId, repoId, dateRange?)`, `getTokenUsageSummary(orgId, repoId)`
  - Summary returns: total tokens, total cost, breakdown by model
  - **Test:** Log 10 entries → summary returns correct totals. Date range filter works. TTL expiry verified.
  - **Depends on:** P4-DB-02
  - **Files:** `lib/adapters/arango-graph-store.ts`
  - **Acceptance:** Usage logged. Summary aggregation correct. TTL auto-expiry works.
  - Notes: _____

- [ ] **P4-ADAPT-08: Implement justification embedding storage via `IVectorSearch`** — M
  - Extend `LlamaIndexVectorSearch` (or create a parallel instance) to manage `justification_embeddings` table
  - New methods or separate adapter: `upsertJustificationEmbedding(id, embedding, metadata)`, `searchJustificationEmbeddings(embedding, topK, filter)`
  - Uses same `nomic-embed-text-v1.5` model as Phase 3 (shared embedding function)
  - **Test:** Embed justification text → upsert → search → returns similar justifications. Multi-tenant isolation on `org_id` + `repo_id`.
  - **Depends on:** P4-DB-03, Phase 3 `IVectorSearch` implementation
  - **Files:** `lib/adapters/llamaindex-vector-search.ts` (extend), or `lib/adapters/justification-vector-search.ts` (new)
  - **Acceptance:** Justification embeddings stored separately from entity embeddings. Search returns semantically similar justifications.
  - Notes: _____

---

## 2.4 Backend / API Layer

### Core AI Pipeline

- [ ] **P4-API-01: Create `JustificationSchema` and related Zod definitions** — M
  - File: `lib/ai/justification-schema.ts`
  - **`JustificationSchema`** (unified — replaces old separate Taxonomy + Classification):
    ```typescript
    const TaxonomyEnum = z.enum(["VERTICAL", "HORIZONTAL", "UTILITY"]);
    const BusinessValueEnum = z.enum([
      "Revenue Critical", "Core Infrastructure", "User Experience",
      "Compliance & Security", "Developer Productivity", "Operational", "Supporting"
    ]);
    const TechnologyTypeEnum = z.enum([
      "Database", "Cache", "Queue", "Auth", "Logging",
      "Monitoring", "HTTP", "Storage", "Config", "Serialization"
    ]);
    const UserFlowSchema = z.object({
      name: z.string(),
      step: z.string(),
      actors: z.array(z.string()),
    });
    const JustificationSchema = z.object({
      purpose: z.string().min(20).max(500),       // 2-4 sentences, enforced length
      business_value: BusinessValueEnum,            // constrained enum, no free text
      taxonomy: TaxonomyEnum,                       // constrained enum
      feature_area: z.string().nullable(),          // normalized post-LLM
      user_flows: z.array(UserFlowSchema).nullable(),
      technology_type: TechnologyTypeEnum.nullable(),
      consumers: z.array(z.string()).nullable(),
      tags: z.array(z.string()).min(2).max(6),     // 2-6 lowercase tags
      confidence: z.number().min(0).max(1),
    });
    ```
  - **`HealthReportSchema`**: sections for dead_code, architecture_drift, testing_gaps, duplicate_logic, circular_deps, unused_exports, complexity_hotspots + llm_risk_assessment + suggested_rules
  - **`RerankSchema`**: `{ rankedEntityKeys: string[] }` (for search_by_purpose LLM re-ranking)
  - **`FeatureAreaSeedSchema`**: `z.array(z.string())` — canonical feature area list per repo
  - **`TagSeedSchema`**: `z.array(z.string())` — canonical tag list per repo
  - **Key design decision:** `taxonomy`, `business_value`, and `technology_type` are Zod enums (not free strings) to prevent LLM output variance. `feature_area` and `tags` are free strings but go through mandatory post-processing normalization (see § Post-Processing & Normalization).
  - **Test:** `JustificationSchema.parse(validInput)` succeeds. Invalid taxonomy → error. business_value not in enum → error. purpose < 20 chars → error. All fields typed.
  - **Depends on:** Nothing
  - **Files:** `lib/ai/justification-schema.ts`
  - **Acceptance:** Schemas enforce canonical terminology. Zod v4 compliant (no `.url()` or `.email()`). Enums constrain free-text variance.
  - Notes: _____

- [ ] **P4-API-02: Create model routing logic** — S
  - File: `lib/ai/models.ts`
  - `getModel(complexity: 'simple' | 'complex' | 'fallback')` — returns appropriate Vercel AI SDK model instance
  - `classifyComplexity(entity: EntityDoc)` — deterministic classification based on callees count, body length, kind, and domain-term detection
  - Domain terms list: configurable, default includes business-domain keywords detected from repo file paths
  - **Test:** Entity with 0 callees, 20-line body → `simple`. Entity with 10 callees, 200-line class → `complex`. OpenAI failure → `fallback`.
  - **Depends on:** P4-INFRA-02
  - **Files:** `lib/ai/models.ts`
  - **Acceptance:** Routing is deterministic. Same entity always gets same model. Domain term detection works.
  - Notes: _____

- [ ] **P4-API-03: Create prompt builder** — L
  - File: `lib/justification/prompt-builder.ts`
  - `buildJustificationPrompt(entity, context)` → string
  - Context includes (see § Prompt Construction for full template):
    - Entity code + signature + parameters + return type (max 300 lines complex, 150 simple)
    - File-level context: imports, exports, sibling entity names
    - Class hierarchy: parent classes, implemented interfaces
    - Callers (up to 10) with file paths and line numbers
    - Callees (up to 10) with file paths and line numbers
    - Already-justified callee context (purpose, taxonomy, feature_area) from lower levels
    - Detected design patterns for this entity
    - Side effects and data flow hints (AST heuristic-detected)
    - Top-5 semantically similar entities with their justifications (from pgvector)
    - Canonical feature_area list (seeded for this repo)
    - Canonical tags list (seeded for this repo)
  - `buildFeatureAreaSeed(orgId, repoId)` → string[] — scans file paths, route handlers, dependencies
  - `buildTagSeed(orgId, repoId)` → string[] — scans file paths, package.json, framework detection
  - Truncation: at statement boundary (never mid-expression), with `[... truncated, {n} more lines]` marker
  - Token budget: 4,096 for simple, 8,192 for complex (see § Token Budget)
  - **Test:** Prompt for Level 0 entity has no callee justification context. Prompt for Level 2 entity includes callee justifications (purpose, taxonomy, feature_area). Body truncation at function boundary. Token count within budget. Feature area seed list included. Tags seed list included.
  - **Depends on:** P4-API-01
  - **Files:** `lib/justification/prompt-builder.ts`
  - **Acceptance:** Prompts are deterministic for same input. Token budget respected. All context sections populated when data available. Canonical value lists included to constrain LLM output.
  - Notes: _____

- [ ] **P4-API-04: Create topological sort module** — M
  - File: `lib/justification/topological-sort.ts`
  - Input: entity IDs + call edges from ArangoDB
  - Output: `Map<number, string[]>` (level → entityIds)
  - Handles cycles via Tarjan's SCC (entities in cycle → same level)
  - Handles disconnected components (island entities → Level 0)
  - Memory-efficient: streams edges from ArangoDB cursor for repos >20K entities
  - **Test:** Linear chain A→B→C → {0: [C], 1: [B], 2: [A]}. Cycle A→B→A → {0: [A, B]}. Disconnected D → {0: [D]}. 10K entities → completes in <5s.
  - **Depends on:** Nothing (pure algorithm, no external dependencies)
  - **Files:** `lib/justification/topological-sort.ts`
  - **Acceptance:** Correct level assignment. Cycles broken. Memory usage <500 MB for 50K entities.
  - Notes: _____

- [ ] **P4-API-05: Create justification pipeline orchestrator** — L
  - File: `lib/justification/pipeline.ts`
  - `processBatch(entities, level, calleeContext, concurrency)` → processes entities with semaphore-limited concurrency
  - Calls `ILLMProvider.generateObject()` with `JustificationSchema`
  - Enriches prompt with semantic context from `IVectorSearch.search()`
  - **Post-processing pipeline** (mandatory, runs on every LLM response):
    1. Zod validation (`JustificationSchema.parse`)
    2. feature_area normalization (trim, title-case, alias resolution, fuzzy match to canonical list)
    3. tags normalization (lowercase, singular, alias dedup)
    4. user_flows dedup (merge by normalized name)
    5. design_patterns merge (combine heuristic + LLM-detected, dedup)
  - Tracks token usage per entity
  - Handles retries and provider fallback (3 retries → fallback → mark failed)
  - Reports progress via callback (for Temporal heartbeat)
  - **Test:** Process 10 entities → all justified. Rate limit simulation → retry succeeds. Provider failure → fallback used. Progress callback called for each entity. Normalization: "Auth" → "Authentication", "AUTHENTICATIONS" tag → "authentication".
  - **Depends on:** P4-API-01, P4-API-02, P4-API-03, P4-ADAPT-01
  - **Files:** `lib/justification/pipeline.ts`
  - **Acceptance:** Batch processing works. Concurrency limited. Retries and fallback function. Progress tracked. Output normalization ensures consistent naming.
  - Notes: _____

- [ ] **P4-API-06: Create feature aggregator** — M
  - File: `lib/justification/feature-aggregator.ts`
  - `aggregateFromJustifications(orgId, repoId, justifications[])` → FeatureDoc[]
  - Filters justifications where `taxonomy == "VERTICAL"`
  - Groups by `feature_area` (already normalized by pipeline post-processing)
  - Computes: entity count, entry points, merged user_flows, horizontal dependencies, unique tags, avg confidence
  - Handles edge cases: null feature_area → "Uncategorized", small features (<3 entities) → low confidence flag
  - **Test:** 100 VERTICALs across 5 feature_areas → 5 feature docs with correct stats. Null feature_area → "Uncategorized". 2 entities with same flow name → deduplicated. Tags merged across entities.
  - **Depends on:** P4-API-01
  - **Files:** `lib/justification/feature-aggregator.ts`
  - **Acceptance:** Features correctly aggregated. Stats accurate. Edge cases handled. Uses only canonical terminology.
  - Notes: _____

### Temporal Workflows & Activities

- [ ] **P4-API-07: Create `justifyRepoWorkflow` Temporal workflow** — L
  - Workflow ID: `justify-{orgId}-{repoId}` (idempotent)
  - Queue: starts on `heavy-compute-queue` (topoSort), then `light-llm-queue` (rest)
  - Steps: set justification_status → detectFeatureAreaSeed + detectTagSeed → topoSort → detectDesignPatterns → for each level: justifyBatch → writeJustifications → aggregateFeatures → embedJustifications → trigger health report (child workflow) → set justification_status
  - Uses `continueAsNew` after every 5,000 entities (Temporal event limit)
  - On failure: set justification_status to "failed", log error
  - Conflict policy: `WORKFLOW_ID_CONFLICT_POLICY_USE_EXISTING` (prevents duplicate runs)
  - **Test:** Workflow replay test with mock activities. Correct activity call order. Status transitions correct. `continueAsNew` triggered at 5K entities. Failure sets "failed" status.
  - **Depends on:** P4-API-04, P4-API-05, P4-API-06
  - **Files:** `lib/temporal/workflows/justify-repo.ts`
  - **Acceptance:** Full pipeline executes. Status transitions correct. Idempotent. Large repos handled via continueAsNew.
  - Notes: _____

- [ ] **P4-API-08: Create `justifyEntityWorkflow` Temporal workflow** — M
  - Workflow ID: `justify-entity-{orgId}-{entityId}` (idempotent)
  - Queue: `light-llm-queue`
  - Steps: justifySingle (single entity) → writeJustification → embedJustification → evaluateCascade → updateFeature
  - Used by Phase 5's incremental re-justification
  - **Test:** Single entity justified (unified doc with all fields). Justification written. Cascade triggered if justification changed significantly.
  - **Depends on:** P4-API-05
  - **Files:** `lib/temporal/workflows/justify-entity.ts`
  - **Acceptance:** Single-entity justification works. Cascade evaluation correct. Feature updated.
  - Notes: _____

- [ ] **P4-API-09: Create `generateHealthReportWorkflow` Temporal workflow** — L
  - Workflow ID: `health-report-{orgId}-{repoId}` (idempotent)
  - Queue: `light-llm-queue`
  - Steps: gatherRepoStats → 7 parallel analysis activities → synthesizeReport → storeHealthReport → update healthReportStatus
  - Analysis activities are all graph-based (not LLM), except `synthesizeReport`
  - Synthesis uses `gpt-4o` for quality (128K context window)
  - **Test:** All 7 analyses return results. Synthesis produces valid HealthReportSchema. Report stored in ArangoDB. Status updated to "available".
  - **Depends on:** P4-API-01, P4-ADAPT-04, P4-ADAPT-05, P4-ADAPT-06
  - **Files:** `lib/temporal/workflows/health-report.ts`
  - **Acceptance:** Report generated. All sections populated. Overall score computed. Suggested rules present.
  - Notes: _____

- [ ] **P4-API-10: Create Temporal activities for justification pipeline** — L
  - Activities in `lib/temporal/activities/justification.ts`:
    - `detectFeatureAreaSeed(orgId, repoId)` — scans file paths, route handlers, dependencies → canonical feature_area list. Runs on `heavy-compute-queue`.
    - `detectTagSeed(orgId, repoId)` — scans file paths, package.json, frameworks → canonical tags list. Runs on `heavy-compute-queue`.
    - `topoSort(orgId, repoId)` — runs on `heavy-compute-queue`, returns level map
    - `detectDesignPatterns(orgId, repoId)` — heuristic pattern detection across all entities (Factory, Singleton, Observer, Repository, Service, Builder, Strategy, Decorator). Runs on `heavy-compute-queue`. Returns `Map<entityKey, string[]>`.
    - `justifyBatch(orgId, repoId, entityIds, level, calleeContext, featureAreaSeed, tagSeed, designPatterns)` — runs on `light-llm-queue`, returns unified justification results (includes post-processing normalization)
    - `writeJustifications(orgId, justifications[], edges[])` — batch write unified justification docs to ArangoDB
    - `aggregateFeatures(orgId, repoId)` — compute features from VERTICAL justifications
    - `embedJustifications(orgId, repoId, justifications[])` — embed purpose + business_value + tags text → pgvector
  - All activities have heartbeat (report progress for dashboard)
  - **Test:** Each activity callable independently. `detectFeatureAreaSeed` returns plausible areas from file paths. `topoSort` produces correct levels. `justifyBatch` calls LLM and normalizes output. `writeJustifications` persists unified docs to ArangoDB. `embedJustifications` persists to pgvector.
  - **Depends on:** P4-API-04, P4-API-05, P4-API-06, P4-ADAPT-04, P4-ADAPT-08
  - **Files:** `lib/temporal/activities/justification.ts`
  - **Acceptance:** All activities functional. Heartbeat reports progress. Error handling works. Canonical value seeding produces consistent lists.
  - Notes: _____

- [ ] **P4-API-11: Create Temporal activities for health report** — L
  - Activities in `lib/temporal/activities/health-report.ts`:
    - `gatherRepoStats(orgId, repoId)` — entity counts, edge counts, taxonomy distribution
    - `detectDeadCode(entities, edges)` — graph: 0 inbound edges, not entry point
    - `detectArchitectureDrift(entities, taxonomy)` — VERTICAL→VERTICAL imports
    - `detectTestingGaps(entities, edges)` — cross-ref with test file patterns
    - `detectDuplicateLogic(entities)` — embedding cosine similarity >0.92 (Phase 3 embeddings)
    - `detectCircularDeps(edges)` — Tarjan's SCC on import edges
    - `detectUnusedExports(entities, edges)` — exported with 0 external refs
    - `detectComplexityHotspots(entities)` — LOC + fan-in thresholds
    - `synthesizeReport(analysisResults)` — LLM synthesis via `generateObject({ schema: HealthReportSchema })`
    - `storeHealthReport(orgId, repoId, report)` — persist to ArangoDB + update Supabase status
  - **Test:** Each analysis detects known issues in a test graph. Synthesis produces valid report. Dead code: entity with 0 callers detected. Architecture drift: VERTICAL→VERTICAL import flagged.
  - **Depends on:** P4-API-01, P4-ADAPT-04, P4-ADAPT-06, Phase 3 embeddings
  - **Files:** `lib/temporal/activities/health-report.ts`
  - **Acceptance:** All 7 analyses produce correct results. Synthesis generates coherent report. Storage works.
  - Notes: _____

- [ ] **P4-API-12: Chain `justifyRepoWorkflow` trigger from `embedRepoWorkflow` completion** — M
  - After `embedRepoWorkflow` completes successfully, start `justifyRepoWorkflow`
  - Implementation: in the embedding completion handler, call `workflowEngine.startWorkflow("justifyRepoWorkflow", ...)`
  - Only trigger if `justification_status` is "pending" (don't re-trigger on re-embed)
  - **Test:** Embed a repo → justification workflow starts automatically. Re-embed → justification NOT re-triggered (status already "complete").
  - **Depends on:** P4-API-07, Phase 3 `embedRepoWorkflow`
  - **Files:** `app/api/repos/route.ts` or `lib/temporal/workflows/embed-repo.ts` (whichever handles the trigger)
  - **Acceptance:** Repo lifecycle: pending → indexing → embedding → justifying → ready. Automatic chain works.
  - Notes: _____

### MCP Tools

- [ ] **P4-API-13: Create `get_justification` MCP tool** — M
  - Tool name: `get_justification`
  - Input schema: `{ entityKey: string }`
  - Fetches unified justification + feature in a single AQL query (see Flow 3)
  - Returns: `{ entityKey, purpose, businessValue, taxonomy, featureArea?, userFlows?, technologyType?, consumers?, tags, designPatterns, confidence, feature? }`
  - All field names use canonical terminology (see § Canonical Terminology)
  - Returns graceful "not yet analyzed" message if justification doesn't exist
  - Cached in Redis (TTL 10 min)
  - OTel span: `mcp.get_justification`
  - **Test:** Tool call for justified entity → returns full unified context (including tags, design_patterns). Unjustified entity → "not yet analyzed" message. Cached: second call within 10 min → Redis hit.
  - **Depends on:** P4-ADAPT-04, Phase 2 MCP tool registration
  - **Files:** `lib/mcp/tools/business.ts`
  - **Acceptance:** Tool registered. Returns unified justification. Cache works. OTel span present.
  - Notes: _____

- [ ] **P4-API-14: Create `search_by_purpose` MCP tool** — L
  - Tool name: `search_by_purpose`
  - Input schema: `{ query: string, featureArea?: string, rerank?: boolean (default false), limit?: number (default 10, max 50) }`
  - Pipeline (see Flow 4 for full detail):
    1. **Intent classification** (regex-based): definition/usage/conceptual/keyword → tuned RRF k constants
    2. **Query expansion** (optional LLM-based): generate 2-3 synonyms for conceptual/keyword intents
    3. **Feature area scoping** (if featureArea provided): restrict keyword search to feature's files
    4. **Parallel search**: embed query → pgvector justification_embeddings (semantic) + ArangoDB fulltext on purpose (keyword)
    5. **RRF merge** with intent-tuned k + heuristic boosts (feature_area match 1.5x, name match 1.3x, high confidence 1.1x)
    6. **Justification enrichment**: attach purpose, business_value, taxonomy, feature_area, tags, design_patterns, confidence
    7. **Optional LLM re-rank**: top 30 → re-ranked by LLM → top `limit`
    8. **Summary-First response** (Two-Step RAG): lightweight summaries only, no bodies
  - Returns: `{ entityKey, entityName, entityType, filePath, purpose, featureArea, taxonomy, businessValue, tags, designPatterns, confidence, score }`
  - Returns `meta: { intent, expandedTerms, semanticCount, keywordCount, processingTimeMs }`
  - OTel span: `mcp.search_by_purpose`
  - **Test:** Search "billing code" → returns entities in Checkout/Billing features. With featureArea: "Checkout" → scoped results. With `rerank: true` → results re-ordered. Intent "where is X defined?" → definition intent, steep RRF. Summary-only (no bodies).
  - **Depends on:** P4-ADAPT-08, P4-ADAPT-04, Phase 3 hybrid search
  - **Files:** `lib/mcp/tools/business.ts`
  - **Acceptance:** Business-purpose search works. Intent classification drives RRF. Feature area scoping works. Justification enrichment complete (all canonical fields). Re-ranking optional. Two-Step RAG pattern followed.
  - Notes: _____

- [ ] **P4-API-15: Create `analyze_impact` MCP tool** — M
  - Tool name: `analyze_impact`
  - Input schema: `{ entityKey: string, depth?: number (default 3, max 5) }`
  - Pipeline: Phase 2 `impactAnalysis()` graph traversal → fetch justifications for affected entities → fetch feature context → format response with business impact
  - Returns: `{ entityKey, entityName, affectedEntities: [{ entityKey, name, purpose, featureArea, distance }], affectedFeatures: string[], riskAssessment: string }`
  - Risk assessment: count of VERTICAL entities affected → higher count = higher risk
  - OTel span: `mcp.analyze_impact`
  - **Test:** Change a HORIZONTAL entity → many VERTICALs affected. Change a UTILITY → few affected. Risk assessment reflects affected count.
  - **Depends on:** P4-ADAPT-04, Phase 2 `impactAnalysis()`, Phase 2 MCP registration
  - **Files:** `lib/mcp/tools/business.ts`
  - **Acceptance:** Impact analysis includes business context. Feature-level impact shown. Risk assessment present.
  - Notes: _____

- [ ] **P4-API-16: Create `get_blueprint` MCP tool** — M
  - Tool name: `get_blueprint`
  - Input schema: `{ repoId?: string }` (defaults to session repo)
  - Fetches features collection → aggregates into business swimlanes
  - Returns: `{ verticals: [{ name, entityCount, entryPoints, userFlows, horizontalDeps }], horizontals: [{ name, type, entityCount, consumers }], utilityCount: number }`
  - OTel span: `mcp.get_blueprint`
  - Cached in Redis (TTL 30 min)
  - **Test:** Blueprint for a justified repo → returns features with correct counts. Cached: second call → Redis hit.
  - **Depends on:** P4-ADAPT-05, Phase 2 MCP registration
  - **Files:** `lib/mcp/tools/business.ts`
  - **Acceptance:** Blueprint data accurate. Feature counts match. Cache works.
  - Notes: _____

### Dashboard API Routes

- [ ] **P4-API-17: Create `GET /api/repos/[repoId]/blueprint` route** — M
  - Auth: Better Auth session required. Verify user has access to org.
  - Calls `graphStore.getBlueprint(orgId, repoId)`
  - Transforms to React Flow graph format: nodes (features + horizontals) + edges (dependencies)
  - Returns: `{ nodes: ReactFlowNode[], edges: ReactFlowEdge[] }`
  - **Test:** Authenticated request → React Flow data. Unauthenticated → 401. Wrong org → 403.
  - **Depends on:** P4-ADAPT-05
  - **Files:** `app/api/repos/[repoId]/blueprint/route.ts`
  - **Acceptance:** React Flow compatible data. Nodes positioned in swimlane layout.
  - Notes: _____

- [ ] **P4-API-18: Create `GET /api/repos/[repoId]/health` route** — M
  - Auth: Better Auth session required. Verify user has access to org.
  - Calls `graphStore.getLatestHealthReport(orgId, repoId)`
  - Returns full health report or `{ status: "generating" }` / `{ status: "pending" }`
  - **Test:** Report available → full JSON. Generating → status message. Not started → pending status.
  - **Depends on:** P4-ADAPT-06
  - **Files:** `app/api/repos/[repoId]/health/route.ts`
  - **Acceptance:** Report returned. Status states handled correctly.
  - Notes: _____

- [ ] **P4-API-19: Create `POST /api/repos/[repoId]/health/regenerate` route** — S
  - Auth: Better Auth session, org admin only
  - Triggers a new `generateHealthReportWorkflow` with incremented version
  - Returns `{ status: "generating", workflowId }`
  - Rate limited: max 1 regeneration per hour per repo
  - **Test:** POST → workflow started. Second POST within 1 hour → 429.
  - **Depends on:** P4-API-09
  - **Files:** `app/api/repos/[repoId]/health/regenerate/route.ts`
  - **Acceptance:** Regeneration works. Rate limited. Admin-only.
  - Notes: _____

- [ ] **P4-API-20: Create `GET /api/repos/[repoId]/entities/[entityId]` route** — M
  - Auth: Better Auth session required.
  - Fetches entity from ArangoDB + unified justification + feature + callers/callees
  - Returns composite entity detail payload
  - **Test:** Entity with justification → full detail. Entity without justification → partial detail (code only).
  - **Depends on:** P4-ADAPT-04, Phase 1 entity data
  - **Files:** `app/api/repos/[repoId]/entities/[entityId]/route.ts`
  - **Acceptance:** Entity detail complete. Justification included if available. Graph context included.
  - Notes: _____

- [ ] **P4-API-21: Create `POST /api/repos/[repoId]/justify` route** — S
  - Auth: Better Auth session, org admin only
  - Triggers `justifyRepoWorkflow` manually (for re-run after initial completion)
  - Checks cost estimate before starting (if over budget: return estimate, await approval)
  - Returns `{ status: "started", estimatedCost, workflowId }` or `{ status: "approval_required", estimatedCost }`
  - **Test:** POST → workflow started. Over-budget → approval required response.
  - **Depends on:** P4-API-07
  - **Files:** `app/api/repos/[repoId]/justify/route.ts`
  - **Acceptance:** Manual trigger works. Cost guardrail enforced. Admin-only.
  - Notes: _____

- [ ] **P4-API-22: Create `GET /api/repos/[repoId]/costs` route** — S
  - Auth: Better Auth session required.
  - Returns token usage summary for the repo: total tokens, total cost, breakdown by model, trend over time
  - **Test:** After justification → cost data returned. Empty repo → zero costs.
  - **Depends on:** P4-ADAPT-07
  - **Files:** `app/api/repos/[repoId]/costs/route.ts`
  - **Acceptance:** Cost data accurate. Model breakdown correct. Trend data available.
  - Notes: _____

---

## 2.5 Frontend / UI Layer

- [ ] **P4-UI-01: Create Entity Detail page at `/repos/[repoId]/entities/[entityId]`** — L
  - Shows: entity code (syntax-highlighted), justification card (purpose, business value, confidence badge), taxonomy card (VERTICAL/HORIZONTAL/UTILITY with type-specific details), graph context (callers/callees with links), file path (clickable link to GitHub)
  - If justification pending: shows skeleton with "Analyzing..." message
  - Classification badge: VERTICAL (purple), HORIZONTAL (blue), UTILITY (gray)
  - Confidence: 0–0.5 red, 0.5–0.8 yellow, 0.8–1.0 green
  - **Test:** Navigate to entity → code displayed. Justification card renders. Taxonomy badge correct color.
  - **Depends on:** P4-API-20
  - **Files:** `app/(dashboard)/repos/[repoId]/entities/[entityId]/page.tsx`, `components/entity/entity-detail.tsx`, `components/entity/justification-card.tsx`, `components/entity/taxonomy-badge.tsx`
  - **Acceptance:** Entity detail page renders. Justification and taxonomy shown. Design system compliant (glass-card, font-grotesk headings).
  - Notes: _____

- [ ] **P4-UI-02: Create Blueprint Dashboard at `/repos/[repoId]/blueprint`** — L
  - React Flow visualization with custom nodes:
    - VERTICAL nodes: business swimlane cards (feature name, entity count, user flow count)
    - HORIZONTAL nodes: infrastructure cards (technology type, entity count, consumer edges pointing up)
    - UTILITY summary: single node at bottom with total count
  - Edges: consumer relationships between features + horizontal dependencies
  - Interactive: zoom, pan, click feature to expand entity list
  - Click entity in expanded list → navigate to entity detail page
  - **Test:** Blueprint page renders React Flow graph. Click feature → expands. Click entity → navigates. Zoom/pan works.
  - **Depends on:** P4-API-17
  - **Files:** `app/(dashboard)/repos/[repoId]/blueprint/page.tsx`, `components/blueprint/blueprint-graph.tsx`, `components/blueprint/feature-node.tsx`, `components/blueprint/horizontal-node.tsx`, `components/blueprint/utility-node.tsx`
  - **Acceptance:** Graph renders correctly. Custom nodes match design system. Interactive. Performance: renders <1s for 20 features.
  - Notes: _____

- [ ] **P4-UI-03: Create Health Report page at `/repos/[repoId]/health`** — L
  - Expandable sections for each analysis area (dead code, architecture drift, testing gaps, etc.)
  - Each section: severity badge (low/medium/high/critical), count, top offenders list, recommendation
  - LLM Risk Assessment section with severity-colored risk items
  - Overall score: large circular progress indicator
  - Suggested Rules section: each rule has a "Create Rule" button (links to Phase 6 when available, otherwise disabled with "Coming in future update" tooltip)
  - "Regenerate Report" button (admin only, rate limited)
  - Export as PDF button (uses browser print + CSS media)
  - If report generating: progress skeleton with "Analyzing codebase..." message
  - **Test:** Health report page renders. Sections expandable. Severity badges colored correctly. Regenerate button works.
  - **Depends on:** P4-API-18, P4-API-19
  - **Files:** `app/(dashboard)/repos/[repoId]/health/page.tsx`, `components/health/health-report.tsx`, `components/health/section-card.tsx`, `components/health/severity-badge.tsx`, `components/health/score-circle.tsx`, `components/health/suggested-rule-card.tsx`
  - **Acceptance:** Report renders all sections. Severity badges correct. Regenerate works. PDF export produces clean output.
  - Notes: _____

- [ ] **P4-UI-04: Update repo card with justification + health status** — S
  - Repo card shows:
    - "Analyzing architecture..." badge during justification (polls justification_status)
    - "Health report available" badge with link after health report completes
    - Taxonomy distribution mini-chart (tiny bar: purple=VERTICAL, blue=HORIZONTAL, gray=UTILITY)
  - **Test:** Repo in "running" justification status → badge shown. Report available → link works.
  - **Depends on:** P4-DB-01
  - **Files:** `components/dashboard/repo-card.tsx` (modified), `components/dashboard/repos-list.tsx` (modified)
  - **Acceptance:** Status badges render. Taxonomy mini-chart visible. Design system compliant.
  - Notes: _____

- [ ] **P4-UI-05: Add navigation links for Blueprint and Health Report** — S
  - New sidebar items: "Blueprint" (icon: Lucide `Network`), "Health" (icon: Lucide `HeartPulse`)
  - Appear under the repo section when viewing a repo
  - Active state: highlighted when on respective routes
  - **Test:** Nav links visible. Click navigates. Active state renders.
  - **Depends on:** P4-UI-02, P4-UI-03
  - **Files:** `components/dashboard/sidebar.tsx` or equivalent nav component (modified)
  - **Acceptance:** Navigation links work. Icons correct. Active state visible.
  - Notes: _____

- [ ] **P4-UI-06: Create cost tracking section in repo settings** — S
  - Shows: total tokens used, total cost USD, breakdown by model (pie chart), trend over last 30 days (line chart)
  - Monthly budget indicator: bar showing current spend vs budget
  - **Test:** After justification → cost data shown. Chart renders. Budget indicator correct.
  - **Depends on:** P4-API-22
  - **Files:** `app/(dashboard)/repos/[repoId]/settings/page.tsx` (modified or new section), `components/settings/cost-tracking.tsx`
  - **Acceptance:** Cost data accurate. Charts render. Budget indicator visible.
  - Notes: _____

---

## 2.6 Testing & Verification

### Unit Tests

- [ ] **P4-TEST-01: Topological sort algorithm tests** — M
  - Linear chain: A→B→C → {0: [C], 1: [B], 2: [A]}
  - Diamond: A→B, A→C, B→D, C→D → {0: [D], 1: [B, C], 2: [A]}
  - Cycle: A→B→A → same level (SCC)
  - Disconnected: A→B, C (no edges) → {0: [B, C], 1: [A]}
  - Large graph: 10K entities → completes in <5s, memory <500MB
  - Empty graph: → empty map
  - **Depends on:** P4-API-04
  - **Files:** `lib/justification/__tests__/topological-sort.test.ts`
  - Notes: _____

- [ ] **P4-TEST-02: Prompt builder tests** — M
  - Level 0 entity (no callees): prompt has no "Already-justified callees" section
  - Level 2 entity: prompt includes callee justifications (purpose, taxonomy, feature_area)
  - Long body (>200 lines): truncated at function boundary, not mid-statement
  - Token budget: simple entity prompt < 4,096 tokens, complex < 8,192
  - Semantic context: if pgvector returns similar entities, they're included
  - **Depends on:** P4-API-03
  - **Files:** `lib/justification/__tests__/prompt-builder.test.ts`
  - Notes: _____

- [ ] **P4-TEST-03: Feature aggregator tests** — M
  - 100 VERTICAL justifications across 5 feature_areas → 5 features with correct stats
  - Null feature_area → "Uncategorized" feature
  - Duplicate user_flows names → deduplicated
  - Feature with 0 entry points → flagged
  - Small feature (<3 entities) → low confidence flag
  - Tags merged across entities in same feature
  - **Depends on:** P4-API-06
  - **Files:** `lib/justification/__tests__/feature-aggregator.test.ts`
  - Notes: _____

- [ ] **P4-TEST-04: Model routing tests** — S
  - Entity with 0 callees, 20 lines → `simple`
  - Entity with 10 callees, 200 lines → `complex`
  - Entity kind "class" → `complex`
  - Domain term in file path ("billing/") → `complex`
  - **Depends on:** P4-API-02
  - **Files:** `lib/ai/__tests__/models.test.ts`
  - Notes: _____

- [ ] **P4-TEST-05: Health report analysis tests** — L
  - Dead code: entity with 0 inbound edges → detected
  - Architecture drift: VERTICAL entity importing VERTICAL → flagged
  - Testing gaps: VERTICAL feature with no test files → detected
  - Duplicate logic: two entities with cosine similarity >0.92 → flagged
  - Circular deps: A→B→A import cycle → detected via SCC
  - Unused exports: exported symbol with 0 references → detected
  - Complexity: entity with LOC >200 and fan-in >10 → flagged as hotspot
  - **Depends on:** P4-API-11
  - **Files:** `lib/temporal/activities/__tests__/health-report.test.ts`
  - Notes: _____

- [ ] **P4-TEST-06: Schema validation tests** — M
  - JustificationSchema.parse with valid VERTICAL input (incl. feature_area, user_flows, tags, design_patterns) → success
  - JustificationSchema.parse with valid HORIZONTAL input (incl. technology_type, consumers) → success
  - JustificationSchema.parse with valid UTILITY input → success
  - JustificationSchema.parse with invalid taxonomy (not in enum) → Zod error
  - JustificationSchema.parse with invalid business_value (not in enum) → Zod error
  - JustificationSchema.parse with purpose < 20 chars → Zod error (too vague)
  - JustificationSchema.parse with tags count < 2 or > 6 → Zod error
  - Confidence must be 0–1 → values outside range rejected
  - HealthReportSchema.parse with valid input → success
  - **Depends on:** P4-API-01
  - **Files:** `lib/ai/__tests__/justification-schema.test.ts`
  - Notes: _____

- [ ] **P4-TEST-07: LLM response cache tests** — S
  - Same prompt hash → cached response returned (no LLM call)
  - Different prompt hash → new LLM call
  - Cache TTL (24h) → expired entries trigger new call
  - **Depends on:** P4-API-05
  - **Files:** `lib/justification/__tests__/pipeline.test.ts`
  - Notes: _____

- [ ] **P4-TEST-08: MCP tool input validation tests** — L
  - `get_justification` with valid entityKey → returns unified justification (purpose, taxonomy, feature_area, tags, design_patterns, confidence)
  - `get_justification` with non-existent entity → "not yet analyzed"
  - `search_by_purpose` with valid query → success (summary-only, no bodies, all canonical fields in results)
  - `search_by_purpose` with `featureArea: "Checkout"` → results scoped to Checkout feature
  - `search_by_purpose` with `rerank: true` → LLM re-ranking invoked
  - `search_by_purpose` meta includes: intent, expandedTerms, timing
  - `analyze_impact` with valid entityKey → impact results with business context (justification fields)
  - `get_blueprint` → blueprint data returned with features, horizontals, utility count
  - **Depends on:** P4-API-13, P4-API-14, P4-API-15, P4-API-16
  - **Files:** `lib/mcp/tools/__tests__/business.test.ts`
  - Notes: _____

- [ ] **P4-TEST-08a: Output normalization and consistency tests** — M
  - feature_area normalization: " checkout " → "Checkout", "Auth" → "Authentication" (alias map), "Paymants" → "Payments" (fuzzy match, Levenshtein < 3)
  - tags normalization: "Authentications" → "authentication", "DB" → "database", dedup after normalization
  - user_flows dedup: two flows with name "Checkout Flow" (different casing) → merged, keep most detailed
  - design_patterns merge: heuristic ["Factory"] + LLM ["Factory", "Observer"] → ["Factory", "Observer"] (deduped)
  - End-to-end: 100 entities justified → all feature_area values are from canonical list (no drift). All tags lowercase. All taxonomy values are exactly "VERTICAL"/"HORIZONTAL"/"UTILITY". All business_value values are from the 7-value enum.
  - **Depends on:** P4-API-05
  - **Files:** `lib/justification/__tests__/normalization.test.ts`
  - Notes: _____

### Integration Tests

- [ ] **P4-TEST-09: Full justification pipeline integration test** — L
  - End-to-end: entities in ArangoDB + embeddings in pgvector → run `justifyRepoWorkflow` → verify:
    - Unified justifications in ArangoDB (all fields: purpose, business_value, taxonomy, feature_area, tags, design_patterns, confidence)
    - All taxonomy values are valid enums. All business_value values are valid enums.
    - feature_area values are consistent (no drift across entities in same feature)
    - Features aggregated correctly from VERTICAL justifications
    - Justification embeddings stored in pgvector
    - Token usage logged
  - Requires: testcontainers (ArangoDB + PostgreSQL with pgvector) or test containers
  - **Depends on:** P4-API-07, P4-API-10
  - **Files:** `lib/temporal/workflows/__tests__/justify-repo.integration.test.ts`
  - Notes: _____

- [ ] **P4-TEST-10: Temporal workflow replay tests** — M
  - Deterministic replay of `justifyRepoWorkflow` with mock activities
  - Verify: correct activity call order (detectFeatureAreaSeed → detectTagSeed → topoSort → detectDesignPatterns → justifyBatch per level → writeJustifications → aggregateFeatures → embedJustifications → health report)
  - Verify: status transitions, heartbeat calls, `continueAsNew` trigger
  - **Depends on:** P4-API-07
  - **Files:** `lib/temporal/workflows/__tests__/justify-repo.replay.test.ts`
  - Notes: _____

- [ ] **P4-TEST-11: Provider failover integration test** — M
  - Mock OpenAI to return 429 → verify fallback to Anthropic
  - Mock both providers failing → verify entity marked as `justification_failed`
  - Verify token usage logged for both successful and failed calls
  - **Depends on:** P4-ADAPT-01
  - **Files:** `lib/adapters/__tests__/vercel-ai-llm-provider.test.ts`
  - Notes: _____

### E2E Tests

- [ ] **P4-TEST-12: Entity detail page E2E** — M
  - Navigate to entity detail → code displayed with syntax highlighting
  - Justification card shows purpose and business value
  - Taxonomy badge shows correct type and color
  - Callers/callees list with clickable links
  - **Depends on:** P4-UI-01, P4-API-20
  - **Files:** `e2e/entity-detail.spec.ts`
  - Notes: _____

- [ ] **P4-TEST-13: Blueprint Dashboard E2E** — M
  - Navigate to blueprint → React Flow graph renders
  - Feature nodes show correct entity counts
  - Click feature → entity list expands
  - Click entity → navigates to entity detail
  - **Depends on:** P4-UI-02, P4-API-17
  - **Files:** `e2e/blueprint.spec.ts`
  - Notes: _____

- [ ] **P4-TEST-14: Health Report E2E** — M
  - Navigate to health report → sections render with severity badges
  - Expand section → top offenders list visible
  - Overall score circle shows correct value
  - Regenerate button triggers new report generation
  - **Depends on:** P4-UI-03, P4-API-18, P4-API-19
  - **Files:** `e2e/health-report.spec.ts`
  - Notes: _____

### Manual Verification

- [ ] **P4-TEST-15: Manual taxonomy quality check** — L
  - Index a real repo (e.g., this project's codebase)
  - Verify: `formatDate` justified as taxonomy=UTILITY, `auth` middleware as taxonomy=HORIZONTAL, `createOrder` as taxonomy=VERTICAL
  - MCP `get_justification` for a login handler → returns "HORIZONTAL / authentication"
  - MCP `get_blueprint` → features list with correct entity counts
  - MCP `search_by_purpose` "authentication" → returns auth-related entities
  - MCP `analyze_impact` on a shared utility → shows wide blast radius
  - Health report: dead code section identifies at least 1 unused function, architecture drift identifies at least 1 layer violation (if present)
  - **Depends on:** All P4 items
  - Notes: _____

---

## Dependency Graph

```
P4-INFRA-01 (env vars) ──────────┐
P4-INFRA-02 (AI SDK packages) ───┤
P4-INFRA-03 (.env.example) ──────┘
    │
P4-DB-01 (Prisma: justification/health status) ─┐
P4-DB-02 (ArangoDB: 4 doc + 2 edge collections) ┤   ← unified model: no classifications/classified_as
P4-DB-03 (pgvector: justification_embeddings) ───┤
P4-DB-04 (Prisma: JustificationEmbedding model) ─┘
    │
P4-ADAPT-01 (VercelAILLMProvider) ─────────┐
P4-ADAPT-02 (DI container registration) ───┤
P4-ADAPT-03 (InMemoryLLMProvider fake) ────┤
P4-ADAPT-04 (unified justification CRUD) ──┤   ← single collection, all fields
P4-ADAPT-05 (feature aggregation) ─────────┤
P4-ADAPT-06 (health report storage) ───────┤
P4-ADAPT-07 (token usage logging) ─────────┤
P4-ADAPT-08 (justification embeddings) ────┘
    │
    ├── P4-API-01..06 (Core AI: schemas [enum-constrained], routing, prompt builder [comprehensive context + canonical seeds], topoSort, pipeline [+ normalization], aggregator)
    ├── P4-API-07..08 (Temporal: justifyRepo [+ detectFeatureAreaSeed + detectDesignPatterns], justifyEntity)
    ├── P4-API-09..12 (Temporal: healthReport workflow, activities, chain trigger)
    ├── P4-API-13..16 (MCP tools: get_justification, search_by_purpose [+ intent classification + query expansion + feature scoping], analyze_impact, get_blueprint)
    ├── P4-API-17..22 (Dashboard APIs: blueprint, health, regenerate, entity detail, justify trigger, costs)
    │       │
    │       ├── P4-UI-01..06 (Entity detail, Blueprint, Health Report, repo card updates, nav, cost tracking)
    │       └── P4-TEST-01..15 + P4-TEST-08a (all tests + normalization tests)
    │
    └── Phase 5 consumes: justifyEntityWorkflow, JustificationSchema, token_usage_log, feature aggregation, canonical value seeds
```

**Recommended implementation order:**

1. **Infrastructure** (P4-INFRA-01..03) — AI SDK packages, env vars
2. **Database** (P4-DB-01..04) — Prisma migrations, ArangoDB collections, pgvector table
3. **Adapters** (P4-ADAPT-01..08) — LLM provider, graph store additions, embeddings
4. **Core AI** (P4-API-01..06) — Schemas, model routing, prompt builder, topoSort, pipeline, aggregator
5. **Temporal workflows** (P4-API-07..12) — justifyRepo, justifyEntity, healthReport, activities, chain trigger
6. **MCP tools** (P4-API-13..16) — 4 business context tools
7. **Dashboard APIs** (P4-API-17..22) — Blueprint, health, entity detail, costs
8. **Frontend** (P4-UI-01..06) — Entity detail, Blueprint Dashboard, Health Report, repo card, nav, costs
9. **Testing** (P4-TEST-01..15) — Unit, integration, E2E, manual

---

## New Files Summary

```
lib/
  ai/
    justification-schema.ts         ← JustificationSchema (unified, enum-constrained), UserFlowSchema,
                                      HealthReportSchema, RerankSchema, FeatureAreaSeedSchema, TagSeedSchema,
                                      BusinessValueEnum, TaxonomyEnum, TechnologyTypeEnum
    models.ts                       ← Model routing (getModel, classifyComplexity)
  justification/
    pipeline.ts                     ← Batch processing orchestrator with concurrency control + post-processing normalization
    topological-sort.ts             ← DAG level assignment from call graph (Tarjan's SCC for cycles)
    prompt-builder.ts               ← Comprehensive context prompt construction (file context, class hierarchy,
                                      design patterns, side effects, call graph, semantic similarity,
                                      canonical value seeds) with token budgets
    feature-aggregator.ts           ← Aggregate VERTICAL justifications → features collection
    normalizer.ts                   ← Post-processing normalization: feature_area alias/fuzzy match,
                                      tags lowercase/singular/dedup, user_flows dedup, design_patterns merge
    pattern-detector.ts             ← Heuristic design pattern detection (Factory, Singleton, Observer,
                                      Repository, Service, Builder, Strategy, Decorator)
    seed-detector.ts                ← Canonical value seeding: detectFeatureAreaSeed (file paths, routes,
                                      dependencies), detectTagSeed (file paths, package.json, frameworks)
  adapters/
    vercel-ai-llm-provider.ts       ← ILLMProvider implementation via Vercel AI SDK
  temporal/
    workflows/
      justify-repo.ts               ← justifyRepoWorkflow (full-repo, hierarchical)
      justify-entity.ts             ← justifyEntityWorkflow (single-entity, for Phase 5)
      health-report.ts              ← generateHealthReportWorkflow (7 analyses + synthesis)
    activities/
      justification.ts              ← detectFeatureAreaSeed, detectTagSeed, topoSort, detectDesignPatterns,
                                      justifyBatch (+ normalization), writeJustifications, aggregateFeatures,
                                      embedJustifications
      health-report.ts              ← 10 activities: gatherStats, 7 analyses, synthesize, store
  mcp/
    tools/
      business.ts                   ← get_justification, search_by_purpose (+ intent classification +
                                      query expansion + feature scoping + heuristic boosts),
                                      analyze_impact, get_blueprint
app/
  api/
    repos/
      [repoId]/
        blueprint/route.ts          ← GET /api/repos/{repoId}/blueprint
        health/
          route.ts                  ← GET /api/repos/{repoId}/health
          regenerate/route.ts       ← POST /api/repos/{repoId}/health/regenerate
        entities/
          [entityId]/route.ts       ← GET /api/repos/{repoId}/entities/{entityId}
        justify/route.ts            ← POST /api/repos/{repoId}/justify
        costs/route.ts              ← GET /api/repos/{repoId}/costs
  (dashboard)/
    repos/
      [repoId]/
        entities/
          [entityId]/page.tsx       ← Entity detail page
        blueprint/page.tsx          ← Blueprint Dashboard (React Flow)
        health/page.tsx             ← Health Report page
components/
  entity/
    entity-detail.tsx               ← Entity detail composite component
    justification-card.tsx          ← Purpose + business value card
    taxonomy-badge.tsx              ← VERTICAL/HORIZONTAL/UTILITY badge
  blueprint/
    blueprint-graph.tsx             ← React Flow graph wrapper
    feature-node.tsx                ← VERTICAL swimlane node
    horizontal-node.tsx             ← Infrastructure node
    utility-node.tsx                ← Utility summary node
  health/
    health-report.tsx               ← Full report composite component
    section-card.tsx                ← Expandable analysis section
    severity-badge.tsx              ← Low/medium/high/critical badge
    score-circle.tsx                ← Overall health score indicator
    suggested-rule-card.tsx         ← Rule suggestion with "Create Rule" button
  settings/
    cost-tracking.tsx               ← Token usage charts + budget indicator
```

### Modified Files

```
lib/di/container.ts               ← Register VercelAILLMProvider (replace stub)
lib/di/fakes.ts                   ← Update InMemoryLLMProvider with working justify (unified model)
lib/ports/graph-store.ts          ← Add unified justification/feature/health report methods (no separate classification)
lib/adapters/arango-graph-store.ts ← Implement new graph store methods + bootstrapGraphSchema (4 doc + 2 edge collections)
lib/adapters/llamaindex-vector-search.ts ← Add justification embedding support (or new adapter)
prisma/schema.prisma              ← Repo model: justificationStatus + healthReportStatus columns, JustificationEmbedding model
env.mjs                           ← OPENAI_API_KEY, ANTHROPIC_API_KEY, LLM_CONCURRENCY, LLM_COST_BUDGET_MONTHLY_USD
.env.example                      ← Document Phase 4 variables
package.json                      ← ai, @ai-sdk/openai, @ai-sdk/anthropic
components/dashboard/repo-card.tsx ← Justification + health status badges
components/dashboard/repos-list.tsx ← Taxonomy mini-chart
components/dashboard/sidebar.tsx   ← Blueprint + Health nav links
```

---

## Revision Log

| Date | Author | Change |
|------|--------|--------|
| 2026-02-21 | — | Initial document created. 22 API items, 8 adapter items, 3 infrastructure items, 4 database items, 6 UI items, 15 test items. Total: **58 tracker items.** |
| 2026-02-21 | — | **Major revision:** (1) Added Canonical Terminology table — every concept has ONE name, used everywhere. (2) Unified justification + classification into single `justifications` document (like Code Synapse). Removed `classifications` collection and `classified_as` edges. (3) Expanded prompt template: file context, class hierarchy, design patterns, side effects, canonical value seeds — 3-6K input tokens/entity (was 2K). (4) Added enum-constrained fields (`taxonomy`, `business_value`, `technology_type`) to prevent LLM free-text variance. (5) Added post-processing normalization pipeline for `feature_area` (alias + fuzzy match), `tags` (lowercase + singular + dedup), `user_flows` (dedup), `design_patterns` (merge). (6) Added canonical value seeding: `detectFeatureAreaSeed` (file paths, routes, deps) and `detectTagSeed` (file paths, package.json). (7) Added Code Synapse search enhancements to `search_by_purpose`: intent classification, query expansion, feature area scoping, heuristic boosts. (8) Renamed `get_business_context` → `get_justification` (canonical naming). (9) Added P4-TEST-08a (normalization tests). (10) New files: `normalizer.ts`, `pattern-detector.ts`, `seed-detector.ts`. Total: **59 tracker items.** |
