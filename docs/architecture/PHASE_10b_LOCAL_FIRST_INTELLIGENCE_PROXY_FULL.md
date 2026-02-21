# Phase 10b — Local-First Intelligence Proxy (Full): Deep Dive & Implementation Tracker

> **Phase Feature Statement:** _"Every rule check and pattern query resolves from my local graph in <5ms. The cloud only handles LLM operations and semantic search. My IDE pre-fetches context before I even ask — the experience feels telepathic."_
>
> **Source:** [`VERTICAL_SLICING_PLAN.md`](./VERTICAL_SLICING_PLAN.md) — Phase 10 (10b increment)
>
> **Prerequisites:** [Phase 10a — Local-First Intelligence Proxy (MVP)](./PHASE_10a_LOCAL_FIRST_INTELLIGENCE_PROXY.md) (7 local structural tools, CozoDB, `kap10 pull`, `kap10 serve`, query router, cloud proxy); [Phase 6 — Pattern Enforcement & Rules Engine](./PHASE_6_PATTERN_ENFORCEMENT_AND_RULES_ENGINE.md) (rules, patterns, `get_rules`, `check_rules`, Semgrep, ast-grep)
>
> **What this is NOT:** Phase 10b does not implement new MCP tools — it relocates `get_rules` and `check_rules` from cloud-only to local-first resolution. It does not add local semantic search (that remains cloud-only via pgvector). It does not modify rule enforcement logic — it mirrors it locally.
>
> **Delivery position:** Phase 10b ships after Phase 6 completes. It extends the Phase 10a CLI without refactoring any 10a code. See [dependency graph](./VERTICAL_SLICING_PLAN.md#phase-summary--dependencies).

---

## Table of Contents

- [Part 1: Architectural Deep Dive](#part-1-architectural-deep-dive)
  - [1.1 Canonical Terminology](#11-canonical-terminology)
  - [1.2 Core User Flows](#12-core-user-flows)
  - [1.3 System Logic & State Management](#13-system-logic--state-management)
  - [1.4 Reliability & Resilience](#14-reliability--resilience)
  - [1.5 Performance Considerations](#15-performance-considerations)
  - [1.6 Phase Bridge → Phase 11](#16-phase-bridge--phase-11)
- [Part 2: Implementation & Tracing Tracker](#part-2-implementation--tracing-tracker)
  - [2.1 Infrastructure Layer](#21-infrastructure-layer)
  - [2.2 Database & Schema Layer](#22-database--schema-layer)
  - [2.3 Ports & Adapters Layer](#23-ports--adapters-layer)
  - [2.4 Backend / API Layer](#24-backend--api-layer)
  - [2.5 CLI / Client Layer](#25-cli--client-layer)
  - [2.6 Frontend / UI Layer](#26-frontend--ui-layer)
  - [2.7 Testing & Verification](#27-testing--verification)

---

# Part 1: Architectural Deep Dive

## 1.1 Canonical Terminology

| Canonical term | DB / TS field | NOT called |
|---|---|---|
| **Rule** | ArangoDB `rules` collection; CozoDB `rules` relation; TS `RuleDoc` | "policy", "constraint", "lint rule" |
| **Pattern** | ArangoDB `patterns` collection; CozoDB `patterns` relation; TS `PatternDoc` | "template", "sample", "snippet" |
| **Rule scope** | `scope` field on `RuleDoc`: `org`, `repo`, `path`, `branch`, `workspace` | "level", "priority", "tier" |
| **Rule resolution** | Hierarchical merge: org → repo → path → branch → workspace | "rule evaluation", "rule matching" |
| **Snapshot (v2)** | msgpack envelope with `version: 2`, containing entities + edges + rules + patterns | "graph dump", "export", "backup" |
| **Predictive pre-fetch** | `POST /api/prefetch` — LSP cursor context → cloud pre-warms Redis | "pre-load", "eager fetch", "anticipatory query" |
| **Cursor context** | `{ filePath, symbol, line, repoId }` — sent from CLI to cloud on editor navigation | "editor state", "focus context" |
| **Pre-warm** | Cloud expands cursor context into likely queries, caches results in Redis | "pre-cache", "ahead-of-time query" |
| **Local rule check** | CozoDB Datalog query evaluating `check_rules` against local rules/patterns | "lint", "validation", "enforcement" |

---

## 1.2 Core User Flows

Phase 10b has five actor journeys. Two extend 10a flows (sync, querying), two are new (pre-fetching, rule checking), and one is system-initiated (cursor tracking).

### Flow 1: Extended Sync — Rules & Patterns in Snapshot (v2)

**Actor:** System (Temporal `syncLocalGraphWorkflow`)
**Precondition:** Phase 10a `syncLocalGraphWorkflow` operational; Phase 6 rules and patterns populated in ArangoDB
**Outcome:** Snapshot v2 includes rules and patterns alongside entities and edges

```
Step  System Action                                                                State Change
────  ──────────────────────────────────────────────────────────────────────────    ──────────────────────────────
1     syncLocalGraphWorkflow triggered (cron or post-index)                        Workflow started

2     Activity: queryCompactGraph (EXTENDED)                                       None (read-only)
      → Original 10a logic: export entities + edges
      → NEW: export rules collection for org_id + repo_id
        AQL: FOR r IN rules
               FILTER r.org_id == @orgId AND (r.repo_id == @repoId OR r.repo_id == null)
               RETURN { _key: r._key, name: r.name, scope: r.scope,
                        severity: r.severity, engine: r.engine,
                        query: r.query, message: r.message,
                        file_glob: r.file_glob, enabled: r.enabled }
      → NEW: export patterns collection
        AQL: FOR p IN patterns
               FILTER p.org_id == @orgId AND (p.repo_id == @repoId OR p.repo_id == null)
               RETURN { _key: p._key, name: p.name, kind: p.kind,
                        frequency: p.frequency, confidence: p.confidence,
                        exemplar_keys: p.exemplar_keys,
                        promoted_rule_key: p.promoted_rule_key }

3     Activity: serializeToMsgpack                                                 None
      → Envelope version bumped to 2:
        { version: 2, repoId, orgId,
          entities, edges,
          rules,       ← NEW
          patterns,    ← NEW
          generatedAt }

4-7   Activities: computeChecksum, uploadToStorage,                                Same as 10a
      updateMeta, notifyConnectedClients
```

**Backward compatibility:** A v2 snapshot loaded by a 10a-era CLI (which only understands v1) silently ignores the `rules` and `patterns` fields — the msgpack deserializer skips unknown keys. The CLI logs: `"Snapshot v2 detected. Upgrade CLI for local rule checking: npm install -g @autorail/kap10@latest"`.

### Flow 2: Agent Rule Check — Local Resolution

**Actor:** AI agent via MCP client
**Precondition:** `kap10 serve` running with v2 snapshot loaded; local `rules` and `patterns` CozoDB relations populated
**Outcome:** `get_rules` and `check_rules` resolve from local CozoDB in <5ms

```
Step  Actor Action                           System Action                                                      Latency
────  ─────────────────────────────────────  ─────────────────────────────────────────────────────────────────   ──────────
1     Agent calls MCP tool:                  IDE MCP client sends JSON-RPC via stdio to kap10 CLI               ~1ms
      get_rules({
        file_path: "lib/auth/jwt.ts"
      })

2                                            Query Router inspects tool name:                                    ~0.1ms
                                             "get_rules" → routing table → LOCAL

3                                            CozoDB rule resolution (Datalog):                                   ~2ms
                                             Step A: Collect rules at each scope level:
                                               ?[key, name, scope, severity, query, message] :=
                                                 *rules[key, name, scope, severity, engine, query,
                                                        message, file_glob, enabled, repo_id],
                                                 enabled = true,
                                                 (scope = "org" or scope = "repo")
                                             Step B: Filter by file_glob match
                                               (evaluate glob pattern against input file_path)
                                             Step C: Apply hierarchical resolution
                                               (workspace > branch > path > repo > org)
                                               If same rule name appears at multiple scopes,
                                               the narrowest scope wins

4     Agent receives rules list              CLI writes JSON-RPC response to stdout                              ~0.1ms
      Total: < 3ms

5     Agent calls MCP tool:                  IDE MCP client sends JSON-RPC                                       ~1ms
      check_rules({
        file_path: "lib/auth/jwt.ts",
        content: "function validateJWT..."
      })

6                                            Query Router → LOCAL                                                ~0.1ms

7                                            CozoDB rule evaluation:                                             ~3ms
                                             Step A: Resolve applicable rules (same as Flow 2, Step 3)
                                             Step B: For each rule where engine = "structural":
                                               Evaluate rule.query against content
                                               (ast-grep style matching via tree-sitter)
                                             Step C: For each rule where engine = "naming":
                                               Evaluate regex pattern against entity names
                                             Step D: Return violations list

8     Agent receives violations              Response with violations array                                      ~0.1ms
      Total: < 5ms
```

**Critical design decision — deterministic rules only on local:** Phase 6 defines three engines: `semgrep` (deterministic), `structural` (ast-grep, deterministic), and `llm` (non-deterministic). Only `structural` and `naming` rules can be evaluated locally because they require no external binary (Semgrep) and no LLM. Semgrep-engine rules fall through to the cloud:

| Rule engine | Local evaluation? | Rationale |
|---|---|---|
| `structural` (ast-grep patterns) | **Yes** — Tree-sitter is embeddable, patterns are Datalog-expressible | No external binary needed |
| `naming` (regex patterns) | **Yes** — Native regex evaluation | Pure string matching |
| `semgrep` | **No** — Cloud fallback | Semgrep binary (~200 MB) cannot be embedded in CLI |
| `llm` | **No** — Cloud fallback | Requires LLM API access (cloud-only) |

When `check_rules` encounters a Semgrep-engine rule locally, it skips the rule and annotates the response: `"_meta.skippedRules": [{ name: "no-eval", engine: "semgrep", reason: "requires cloud" }]`. The agent can then optionally call `check_rules` via the cloud to evaluate Semgrep rules.

### Flow 3: Predictive Context Pre-Fetching

**Actor:** System (CLI background process monitoring editor events)
**Precondition:** `kap10 serve` running; cloud API reachable; developer navigating code in IDE
**Outcome:** Cloud pre-warms Redis cache with likely queries for the developer's current context, so cloud-routed tools respond faster when called

```
Step  IDE (LSP)                     kap10 CLI                              Cloud
────  ────────────────────────────  ─────────────────────────────────────  ─────────────────────────────
1     textDocument/didOpen           CLI intercepts MCP notification        (no action yet)
      file: "lib/auth/jwt.ts"       (if IDE sends document open events
                                     via MCP resources/subscriptions)

2     (user moves cursor)            CLI debounces cursor movement          (no action yet)
                                     (500ms debounce window)

3     (debounce window expires)      CLI extracts cursor context:           POST /api/prefetch
                                     { filePath: "lib/auth/jwt.ts",         Body: { filePath, symbol,
                                       symbol: "validateJWT",                       line, repoId }
                                       line: 42,
                                       repoId: "repo_123" }

4                                                                           Cloud pre-fetch pipeline:
                                                                            a) Look up entity by name
                                                                               in ArangoDB
                                                                            b) Expand N-hop context:
                                                                               callers (2 hops),
                                                                               callees (2 hops),
                                                                               same-file entities
                                                                            c) Run semantic_search for
                                                                               related entities
                                                                            d) Resolve applicable rules
                                                                            e) Cache all results in Redis
                                                                               TTL: 5 minutes
                                                                               Key pattern:
                                                                               prefetch:{repoId}:{symbol}

5                                    CLI receives 200 OK (fire-and-forget)
                                     Pre-fetch is purely speculative —
                                     no response data needed

6     (later, agent asks)            Agent calls semantic_search or         Redis cache HIT
      get related entities           cloud-routed tool                      → Response in ~50ms
                                     → Cloud proxy forwards request         instead of ~300ms
                                     → Cloud checks Redis pre-cache first
```

**Pre-fetch is speculative and non-blocking.** If the cloud is unreachable, the pre-fetch silently fails. If the agent never queries the pre-fetched context, the Redis entries expire after 5 minutes. There is no correctness dependency on pre-fetching — it only improves latency for cloud-routed tools.

**Debounce strategy:** The CLI batches cursor movements using a 500ms debounce window. This prevents flooding the cloud with pre-fetch requests during rapid navigation. If the developer moves to 10 files in 2 seconds, only the last file triggers a pre-fetch.

### Flow 4: Extended Routing Table — Full Tool Set

**Actor:** AI agent via MCP client
**Precondition:** Phase 10b CLI running with v2 snapshot
**Outcome:** 9 tools resolve locally, remaining tools proxy to cloud

```
Phase 10b Complete Routing Table:

Tool Name              → Destination    Source Phase    Reason
─────────────────────    ──────────     ───────────    ──────────────────────────────
get_function           → LOCAL          10a            Entity lookup + traversal
get_class              → LOCAL          10a            Entity lookup + extends/implements
get_callers            → LOCAL          10a            N-hop inbound traversal
get_callees            → LOCAL          10a            N-hop outbound traversal
get_imports            → LOCAL          10a            File → import edges → entities
get_file_entities      → LOCAL          10a            File path → entities in that file
search_code            → LOCAL          10a            Inverted index keyword search

get_rules              → LOCAL          10b (NEW)      Hierarchical rule resolution from CozoDB
check_rules            → LOCAL          10b (NEW)      Structural/naming rule evaluation locally;
                                                        Semgrep rules annotated as "requires cloud"

sync_local_diff        → CLOUD          10a            Writes to workspace overlay (server-side)
get_project_stats      → CLOUD          10a            Aggregation across collections
semantic_search        → CLOUD          Phase 3        Requires pgvector embeddings
find_similar           → CLOUD          Phase 3        Requires pgvector embeddings
justify_entity         → CLOUD          Phase 4        Requires LLM (cloud-only)
generate_health_report → CLOUD          Phase 4        Requires LLM aggregation
inspect_entity         → CLOUD          Phase 2        Full entity details from ArangoDB

(unknown tool)         → CLOUD          —              Forward-compatible default
```

**Local tool count evolution:** 10a = 7 local tools (~70% of agent calls). 10b = 9 local tools (~80% of agent calls). The remaining 20% are inherently cloud-bound (LLM, vector search, writes).

### Flow 5: First Pull with v2 Snapshot

**Actor:** Developer running `kap10 pull` after CLI upgrade to 10b
**Precondition:** 10b-era CLI installed; cloud has generated v2 snapshots (post-Phase 6)
**Outcome:** CozoDB populated with entities, edges, rules, and patterns

```
Step  Actor Action                           System Action                                                      State Change
────  ─────────────────────────────────────  ─────────────────────────────────────────────────────────────────   ──────────────────────────────
1     Developer runs `kap10 pull`            CLI calls GET /api/graph-snapshots/{repoId}/download               None

2                                            Download msgpack snapshot                                          ~/.kap10/snapshots/{repoId}.msgpack
                                             → SHA-256 checksum verification ✓

3                                            Decode msgpack:                                                     None (in-memory)
                                             → envelope.version = 2
                                             → entities[], edges[] (same as v1)
                                             → rules[] (NEW — Phase 10b)
                                             → patterns[] (NEW — Phase 10b)

4                                            CozoDB bulk load (EXTENDED):                                       ~/.kap10/snapshots/{repoId}.msgpack
                                             → :create rules relation (if not exists)                           CozoDB relations: entities,
                                             → :create patterns relation (if not exists)                        edges, file_index,
                                             → :insert entities [...] (same as v1)                              search_tokens, rules, patterns
                                             → :insert edges [...] (same as v1)
                                             → :insert rules [...] (NEW)
                                             → :insert patterns [...] (NEW)
                                             → Build search_tokens index (same as v1)

5     Developer sees:                        CLI prints extended summary:                                        Manifest updated
      "Pulled 1 repo with rules"             "✓ org/backend-api: 5,231 entities, 8,492 edges,
                                              47 rules, 12 patterns (2.4 MB, snapshot v2)"
```

---

## 1.3 System Logic & State Management

### CozoDB Schema Extension (v2)

Phase 10b adds two new CozoDB relations to the existing schema from 10a:

```
Relation: rules
Columns: [key: String, name: String, scope: String, severity: String,
          engine: String, query: String, message: String,
          file_glob: String, enabled: Bool, repo_id: String]
Key: key (unique)
Index: None (full scan is fast at expected rule counts <500 per repo)

Relation: patterns
Columns: [key: String, name: String, kind: String,
          frequency: Int, confidence: Float,
          exemplar_keys: String, promoted_rule_key: String]
Key: key (unique)
Index: None (pattern count <200 per repo)
```

**Why no secondary indexes?** Rules and patterns are low-cardinality collections. A typical repo has 20-100 rules and 10-50 patterns. Full relation scans on <500 rows complete in <1ms in CozoDB. Adding indexes would increase schema complexity for negligible performance gain.

### Rule Resolution Algorithm (Local)

The local `get_rules` implementation mirrors Phase 6's cloud rule resolution, operating entirely in CozoDB Datalog:

```
Input: { filePath: "lib/auth/jwt.ts", repoId: "repo_123" }

Step 1: Collect all enabled rules for the repo + org
  ?[key, name, scope, severity, engine, query, message, file_glob] :=
    *rules[key, name, scope, severity, engine, query, message, file_glob, enabled, repo_id],
    enabled = true,
    (repo_id = $repoId or repo_id = "")  // "" = org-level rule

Step 2: Filter by file_glob match (application-level, not Datalog)
  For each rule:
    if rule.file_glob != "" AND !minimatch(filePath, rule.file_glob):
      skip this rule

Step 3: Hierarchical resolution (application-level)
  Group rules by name:
    For each unique rule name:
      Keep only the rule with the narrowest scope:
        workspace > branch > path > repo > org
      (In local context, workspace and branch scopes are always empty —
       local CozoDB only has org and repo scope rules.
       Path-scoped rules resolve by matching file_glob.)

Step 4: Return resolved rules list
  [{ key, name, scope, severity, engine, query, message }]
```

**Scope limitation on local:** The local graph only contains `org`-scope and `repo`-scope rules (synced from the cloud). `branch` and `workspace` scoped rules are ephemeral (created during PR review or workspace sessions) and are NOT synced to local. If the agent needs branch/workspace-scoped rules, the cloud fallback provides them. This is a deliberate trade-off: branch/workspace rules change frequently and would require near-real-time sync, which is out of scope for 10b's nightly sync model.

### Local `check_rules` Evaluation

```
Input: { filePath: "lib/auth/jwt.ts", content: "function validateJWT(token: string) { ... }" }

Step 1: Resolve applicable rules (same as get_rules above)

Step 2: Partition rules by engine
  structural_rules = rules.filter(r => r.engine === "structural")
  naming_rules     = rules.filter(r => r.engine === "naming")
  cloud_rules      = rules.filter(r => r.engine === "semgrep" || r.engine === "llm")

Step 3: Evaluate structural rules (tree-sitter pattern matching)
  For each structural rule:
    Parse content into AST using tree-sitter
    Match rule.query against AST
    If match found: add violation
      { ruleKey, ruleName, severity, line, column, message }

Step 4: Evaluate naming rules (regex matching)
  For each naming rule:
    Extract entity names from AST (function names, variable names, class names)
    Match rule.query (regex) against each name
    If match found (or inverse match expected but not found): add violation

Step 5: Annotate skipped cloud rules
  skipped_rules = cloud_rules.map(r => ({
    name: r.name, engine: r.engine, reason: "requires cloud evaluation"
  }))

Step 6: Return
  {
    violations: [...structural_violations, ...naming_violations],
    _meta: {
      source: "local",
      evaluatedRules: structural_rules.length + naming_rules.length,
      skippedRules: skipped_rules,
      note: skipped_rules.length > 0
        ? "Some rules require cloud evaluation (semgrep/llm). Call check_rules via cloud for full coverage."
        : undefined
    }
  }
```

### Tree-sitter in the CLI

Phase 10b embeds `tree-sitter` and language grammars in the CLI for structural rule evaluation. This is the same engine Phase 6 uses via ast-grep on the cloud, but invoked directly:

| Component | Package | Size | Purpose |
|---|---|---|---|
| Tree-sitter core | `tree-sitter` (npm) | ~3 MB | AST parsing engine |
| TypeScript grammar | `tree-sitter-typescript` | ~1 MB | TS/TSX parsing |
| Python grammar | `tree-sitter-python` | ~0.5 MB | Python parsing |
| Go grammar | `tree-sitter-go` | ~0.5 MB | Go parsing |

**Total addition to CLI binary:** ~5 MB. This is acceptable given `cozo-node` is already ~8 MB.

**Alternative considered:** Bundling `ast-grep` as a binary. Rejected — ast-grep is ~15 MB and requires spawning a subprocess. Direct tree-sitter integration is smaller and avoids IPC overhead.

### Predictive Pre-Fetch: Cloud Pipeline

When the CLI sends a cursor context to `POST /api/prefetch`, the cloud executes a pre-fetch pipeline:

```
Input: { filePath: "lib/auth/jwt.ts", symbol: "validateJWT", line: 42, repoId: "repo_123" }

Step 1: Entity resolution
  AQL: FOR e IN functions
         FILTER e.name == "validateJWT" AND e.repo_id == "repo_123"
         RETURN e
  If not found: try classes, then files. If still not found: return 200 (no-op).

Step 2: Context expansion (2-hop)
  callers_1hop = getCallersOf(entity._key, depth=1)
  callees_1hop = getCalleesOf(entity._key, depth=1)
  callers_2hop = getCallersOf(entity._key, depth=2)
  callees_2hop = getCalleesOf(entity._key, depth=2)
  same_file    = getEntitiesByFile(entity.file_path)

Step 3: Semantic neighbors (if Phase 3 embeddings exist)
  similar = vectorSearch(entity.embedding, topK=5)

Step 4: Applicable rules
  rules = resolveRules(entity.file_path, repoId)

Step 5: Cache all results in Redis
  Key pattern: prefetch:{repoId}:{entityKey}:{queryType}
  Examples:
    prefetch:repo_123:fn_validateJWT:callers_2hop → [caller entities...]
    prefetch:repo_123:fn_validateJWT:similar → [similar entities...]
    prefetch:repo_123:fn_validateJWT:rules → [resolved rules...]
  TTL: 300 seconds (5 minutes)

Step 6: Return 200 OK (no body — fire-and-forget)
```

**Cost model:** Pre-fetch is cheap — it reuses existing graph queries and vector search. No LLM calls. Estimated cost per pre-fetch: ~2ms of ArangoDB query time + ~5ms of pgvector search + ~1ms of Redis writes = ~8ms cloud-side. At 100 pre-fetches/hour (active developer), this adds ~0.8s of cloud compute per hour — negligible.

### Pre-Fetch Cache Integration with Cloud Tools

When a cloud-routed tool executes, it checks the Redis pre-fetch cache before querying ArangoDB/pgvector:

```
Cloud tool handler (e.g., semantic_search):
  1. Check Redis: GET prefetch:{repoId}:{entityKey}:similar
  2. If cache HIT:
       Return cached result (skip pgvector query)
       Set _meta.source: "cloud_prefetched"
       Latency: ~10ms (Redis read + response serialization)
  3. If cache MISS:
       Execute normal pgvector query
       Set _meta.source: "cloud"
       Latency: ~200-300ms (normal path)
```

**Cache invalidation:** Pre-fetch cache entries have a 5-minute TTL. There is no active invalidation — the short TTL ensures freshness. If the graph changes (new indexing run), the pre-fetch cache naturally expires before the developer's next query session.

---

## 1.4 Reliability & Resilience

### Failure Scenario Matrix

| # | Failure | Detection | Recovery | User Impact |
|---|---------|-----------|----------|-------------|
| 1 | **v2 snapshot loaded by v1 CLI** | CLI reads `envelope.version`, compares against supported range | CLI logs warning: `"Snapshot v2 detected. Upgrade CLI for local rules."` Loads entities + edges (v1 fields), ignores rules + patterns. | Rules not available locally — fall through to cloud. No crash. Structural tools work normally. |
| 2 | **Local `check_rules` — tree-sitter parse failure** | `tree-sitter.parse()` throws or returns partial AST | CLI catches error, skips structural rule evaluation for that file, returns `_meta.parseError: true`. Falls back to cloud for all rule checks on that file. | Agent sees partial results with annotation. Can call cloud `check_rules` for full evaluation. |
| 3 | **Local `get_rules` — CozoDB rules relation empty** | Query returns 0 rows | CLI returns empty rules list with `_meta.rulesLoaded: false, note: "No rules synced locally. Ensure kap10 pull ran after Phase 6 rules were configured."` | Agent sees no rules. Cloud fallback returns rules if they exist. |
| 4 | **Pre-fetch — cloud unreachable** | HTTP timeout (3s) on `POST /api/prefetch` | Silently ignored. Pre-fetch is fire-and-forget. No retry. | No pre-warming. Cloud tools take normal latency (~200-300ms instead of ~50ms). No functional impact. |
| 5 | **Pre-fetch — Redis write failure on cloud** | Redis `SET` returns error | Cloud logs warning. Pre-fetch pipeline returns 200 anyway (no error to CLI). | Same as #4 — no pre-warming, normal latency. |
| 6 | **Pre-fetch flood — developer navigates rapidly** | CLI debounce counter tracks requests/second | 500ms debounce window. If debounce window is exceeded (shouldn't happen with proper debounce), CLI drops the pre-fetch. Max 2 pre-fetches/second. | Some pre-fetches skipped. No functional impact. |
| 7 | **Rules synced but patterns missing from snapshot** | `envelope.patterns` is `undefined` or empty array | CLI creates `patterns` relation but inserts 0 rows. `get_rules` works without patterns. Log info: `"No patterns in snapshot — pattern-aware features unavailable locally."` | Rules work. Pattern-related queries (e.g., "what patterns exist?") return empty. |
| 8 | **Semgrep rule called locally** | CLI detects `rule.engine === "semgrep"` during `check_rules` | Rule skipped locally, added to `_meta.skippedRules`. Response annotates: `"1 rule requires cloud evaluation."` | Agent sees annotation, can optionally call cloud `check_rules` for Semgrep coverage. No false negatives — skipped rules are transparent. |
| 9 | **Snapshot v2 much larger than v1 (rules bloat)** | Snapshot size exceeds `maxLocalStorageMB` quota | CLI warns: `"Snapshot for org/repo is 450 MB (quota: 500 MB)."` Pull proceeds if space available. | User may need to increase quota or remove other repos. |
| 10 | **Rule conflict between local (stale) and cloud (current)** | Local rules were synced 20h ago; cloud rules changed 1h ago | No detection at query time — local rules serve until next pull. `_meta.staleness` includes `lastPulledAt` in every response. | Agent operates on slightly stale rules. For safety-critical checks, agent can force a cloud `check_rules` call. |
| 11 | **Pre-fetch cursor context references deleted entity** | Cloud entity lookup returns null in Step 1 | Pre-fetch pipeline returns 200 (no-op). No cache entries written. | No pre-warming for that symbol. Normal latency on next cloud query. |
| 12 | **CLI upgrade mid-session (v1 → v2 CLI, v1 snapshot loaded)** | CLI detects v1 snapshot after upgrade | CLI serves with v1 data. New `rules` and `patterns` relations created but empty. Logs: `"Run 'kap10 pull' to load rules and patterns."` | Local structural tools work. Rules not available until re-pull. |

### Rule Evaluation Safety

The local `check_rules` implementation follows Phase 6's deterministic-only principle:

1. **No LLM at check time** — local rule evaluation is pure pattern matching (tree-sitter AST + regex). This eliminates hallucination risk and ensures consistent results.
2. **Semgrep rules explicitly skipped** — rather than silently ignoring them, the response includes `skippedRules` metadata. The agent makes an informed decision about cloud follow-up.
3. **False negative transparency** — if local evaluation misses a Semgrep violation, the annotation tells the agent. This prevents a false sense of security.
4. **No rule mutation** — local CozoDB is read-only. Rules are never created, modified, or deleted locally. All rule management flows through the cloud.

---

## 1.5 Performance Considerations

### Latency Budgets

| Operation | Target | Phase 10a (local) | Phase 10b (local) | Improvement over cloud |
|---|---|---|---|---|
| `get_function` | <5ms | ~3ms | ~3ms (unchanged) | ~100x vs cloud |
| `get_callers` (depth 1) | <5ms | ~2ms | ~2ms (unchanged) | ~100x |
| `get_rules` | <5ms | N/A (cloud: ~200ms) | **~2ms** (CozoDB scan + glob filter) | **~100x** |
| `check_rules` (structural, 10 rules) | <10ms | N/A (cloud: ~500ms) | **~8ms** (tree-sitter parse + 10 pattern matches) | **~63x** |
| `check_rules` (naming, 20 rules) | <5ms | N/A (cloud: ~300ms) | **~3ms** (regex matching, no AST needed) | **~100x** |
| `semantic_search` (pre-fetched) | <50ms | N/A (cloud: ~300ms) | N/A (cloud: **~50ms** with pre-fetch hit) | **~6x** |
| `semantic_search` (cache miss) | ~300ms | N/A (cloud: ~300ms) | ~300ms (unchanged) | No change |
| Pre-fetch request (CLI → cloud) | <100ms | N/A | **~80ms** (fire-and-forget, non-blocking) | N/A (speculative) |

### Snapshot Size Impact

| Component | v1 (10a) | v2 (10b) | Delta |
|---|---|---|---|
| Entities (5K) | ~2 MB | ~2 MB | 0% |
| Edges (8K) | ~0.5 MB | ~0.5 MB | 0% |
| Rules (50) | 0 | ~20 KB | +1% |
| Patterns (20) | 0 | ~8 KB | +0.4% |
| **Total** | ~2.5 MB | **~2.53 MB** | **+1.4%** |

Rules and patterns are tiny compared to entities/edges. The v1→v2 snapshot size increase is negligible (<2%).

### Memory Budget (10b additions)

| Component | Memory | Notes |
|---|---|---|
| CozoDB `rules` relation (50 rules) | ~50 KB | Negligible |
| CozoDB `patterns` relation (20 patterns) | ~20 KB | Negligible |
| Tree-sitter parser (loaded on first `check_rules`) | ~5 MB | Lazy-loaded — not allocated until first rule check |
| Tree-sitter language grammars (3 languages) | ~3 MB | Loaded on-demand per language |
| Pre-fetch debounce state | ~1 KB | Timer + last context |
| **Total 10b addition** | **~8 MB** | On top of 10a's ~70 MB baseline |

**Total CLI memory (10a + 10b, 3 medium repos):** ~78 MB. Well within acceptable bounds.

### Pre-Fetch Hit Rate Estimation

Based on typical agent workflows, the pre-fetch hit rate depends on developer behavior:

| Scenario | Expected hit rate | Rationale |
|---|---|---|
| Developer reads code, then asks agent about same file | **~70%** | Pre-fetch fires on file open. Agent queries the same context. |
| Developer navigates rapidly, agent asks about earlier file | **~30%** | 5-minute TTL may expire. Developer moved on. |
| Agent asks about unrelated file (no prior navigation) | **~0%** | No cursor context was sent for that file. |
| **Weighted average** | **~50%** | Reduces average cloud latency from ~300ms to ~175ms. |

Pre-fetching is an optimization, not a requirement. The system works correctly at 0% hit rate — just with normal cloud latency.

### Tree-sitter Parse Performance

| File size | Parse time | Notes |
|---|---|---|
| Small (100 lines) | ~1ms | Most functions/files |
| Medium (500 lines) | ~3ms | Typical module |
| Large (2000 lines) | ~8ms | Large utility file |
| Very large (5000+ lines) | ~15ms | Generated files — consider skipping |

The `check_rules` latency budget of <10ms (for structural rules) assumes files under 500 lines. For very large files, the CLI can optionally skip tree-sitter parsing and return `_meta.skippedParse: true, reason: "file too large for local parsing"`.

---

## 1.6 Phase Bridge → Phase 11

Phase 10b is designed so that Phase 11 (Native IDE Integrations) requires **zero refactoring** of the 10b codebase — only additions.

### What Phase 11 inherits from 10b

| 10b artifact | Phase 11 usage | Change type |
|---|---|---|
| **Pre-fetch infrastructure** (`/api/prefetch`, debounce, Redis cache) | IDE extensions call pre-fetch directly (instead of CLI intercepting MCP notifications) | Reuse — new client, same API |
| **Tree-sitter in CLI** (structural rule evaluation) | IDE extensions can invoke tree-sitter for real-time diagnostics (red squiggles) | Reuse — same parser, new UI integration |
| **CozoDB rules/patterns relations** | IDE extensions query rules locally for inline hints | Reuse — same data, new presentation |
| **Routing table** (9 local, 6+ cloud) | No change — Phase 11 adds IDE-specific tools (e.g., `get_diagnostics`) that route locally | Additive — append entries |
| **Snapshot v2 envelope** | Phase 11 may add v3 with IDE-specific metadata (code actions, refactoring suggestions) | Version bump — no v2 changes |

### What 10b must NOT do (to avoid Phase 11 rework)

1. **Do not couple pre-fetch to MCP transport.** The pre-fetch debounce module should accept cursor context from any source (MCP notification, LSP event, IDE extension API). Phase 11 will provide cursor context via native IDE protocols, not MCP.
2. **Do not embed tree-sitter language grammars statically.** Use a dynamic grammar loader that loads grammars on-demand from a well-known path. Phase 11 may add more grammars (Rust, Java, C#) without modifying the loader.
3. **Do not hardcode pre-fetch expansion hops.** The N-hop depth (currently 2) should be configurable via `/api/prefetch` body or CLI config. Phase 11 may want deeper expansion for IDE features.
4. **Do not assume CLI is the only pre-fetch client.** The `/api/prefetch` endpoint should authenticate via API key or session token — not assume the caller is a CLI process. Phase 11 IDE extensions will call this endpoint directly.

---

# Part 2: Implementation & Tracing Tracker

## 2.1 Infrastructure Layer

- [ ] **P10b-INFRA-01: Add `tree-sitter` and language grammars to CLI package** — M
  - Add dependencies to `packages/cli/package.json`:
    - `tree-sitter` (core parser)
    - `tree-sitter-typescript` (TS/TSX grammar)
    - `tree-sitter-python` (Python grammar)
    - `tree-sitter-go` (Go grammar)
  - Verify NAPI binaries work on macOS (arm64 + x64), Linux (x64)
  - Lazy-load grammars on first `check_rules` call (do not load at CLI startup)
  - **Test:** `require('tree-sitter')` succeeds on all target platforms. Parse a TypeScript snippet → AST returned. Parse a Python snippet → AST returned.
  - **Depends on:** Phase 10a CLI package exists
  - **Files:** `packages/cli/package.json`
  - Notes: _____

- [ ] **P10b-INFRA-02: Add Phase 10b env vars to `env.mjs`** — S
  - New variables:
    - `PREFETCH_REDIS_TTL_SECONDS` (default: `300`)
    - `PREFETCH_EXPANSION_HOPS` (default: `2`)
    - `PREFETCH_DEBOUNCE_MS` (default: `500`, CLI-side config)
  - All optional with defaults
  - **Test:** `pnpm build` succeeds. Missing vars use defaults.
  - **Depends on:** Nothing
  - **Files:** `env.mjs`, `.env.example`
  - Notes: _____

---

## 2.2 Database & Schema Layer

- [ ] **P10b-DB-01: Extend CozoDB schema with `rules` and `patterns` relations** — M
  - Add to `packages/cli/src/cozo-schema.ts`:
    ```
    :create rules {
      key: String
      =>
      name: String,
      scope: String,
      severity: String,
      engine: String,
      query: String,
      message: String,
      file_glob: String default "",
      enabled: Bool default true,
      repo_id: String default ""
    }

    :create patterns {
      key: String
      =>
      name: String,
      kind: String,
      frequency: Int default 0,
      confidence: Float default 0.0,
      exemplar_keys: String default "",
      promoted_rule_key: String default ""
    }
    ```
  - `createSchema()` extended to create these relations alongside existing ones
  - Relations are idempotent (`:create` is safe to call multiple times)
  - **Test:** `createSchema(db)` creates `rules` and `patterns` relations. Insert a test rule → query returns it. Existing `entities`, `edges`, `file_index`, `search_tokens` relations unaffected.
  - **Depends on:** Phase 10a P10a-ADAPT-02
  - **Files:** `packages/cli/src/cozo-schema.ts` (modified)
  - Notes: _____

- [ ] **P10b-DB-02: Add pre-fetch cache key schema to Redis** — S
  - Key pattern: `prefetch:{repoId}:{entityKey}:{queryType}`
  - Query types: `callers_1hop`, `callers_2hop`, `callees_1hop`, `callees_2hop`, `same_file`, `similar`, `rules`
  - Value: JSON-serialized query result
  - TTL: configurable via `PREFETCH_REDIS_TTL_SECONDS` (default: 300s)
  - No migration needed — Redis keys are created on-demand
  - **Test:** Write a pre-fetch cache entry → read it back → value matches. Wait for TTL → key expired.
  - **Depends on:** Nothing
  - **Files:** Documentation only (no schema migration for Redis)
  - Notes: _____

---

## 2.3 Ports & Adapters Layer

- [ ] **P10b-ADAPT-01: Extend `CozoGraphStore` with rule resolution methods** — L
  - Add methods to `packages/cli/src/local-graph.ts`:
    - `getRules(filePath, repoId)` — Datalog query on `rules` relation + glob filtering + hierarchical resolution
    - `getPatterns(repoId)` — simple scan of `patterns` relation
  - Glob matching: use `minimatch` (already available in Node.js) for `file_glob` evaluation
  - Hierarchical resolution: group by rule name, keep narrowest scope
  - **Test:** Insert 10 rules at org + repo scope → `getRules("lib/auth/jwt.ts")` returns resolved set. Org-level rule overridden by repo-level rule with same name. Rule with non-matching file_glob excluded. Disabled rule excluded.
  - **Depends on:** P10b-DB-01
  - **Files:** `packages/cli/src/local-graph.ts` (modified)
  - **Acceptance:** Hierarchical resolution matches Phase 6's cloud implementation. Glob filtering correct.
  - Notes: _____

- [ ] **P10b-ADAPT-02: Create local rule evaluator (tree-sitter + regex)** — L
  - New module: `packages/cli/src/rule-evaluator.ts`
  - Two evaluation paths:
    - **Structural rules** (engine = `"structural"`): Parse file content with tree-sitter → match rule query against AST → return violations with line/column
    - **Naming rules** (engine = `"naming"`): Extract entity names from AST → match rule query (regex) → return violations
  - Skips `semgrep` and `llm` engine rules (adds to `skippedRules` metadata)
  - Tree-sitter grammar selection based on file extension (`.ts`/`.tsx` → TypeScript, `.py` → Python, `.go` → Go)
  - Unsupported file extension → skip all structural rules, annotate `_meta.unsupportedLanguage: true`
  - **Test:** Structural rule matching `"function_declaration"` on a TS file → violation on matching functions. Naming rule matching `"^[A-Z]"` on function names → violation on lowercase names. Semgrep rule → skipped with metadata. Unknown file extension → structural rules skipped.
  - **Depends on:** P10b-INFRA-01, P10b-ADAPT-01
  - **Files:** `packages/cli/src/rule-evaluator.ts` (new)
  - **Acceptance:** Tree-sitter parses correctly. Violations include accurate line/column. Skipped rules annotated.
  - Notes: _____

- [ ] **P10b-ADAPT-03: Create pre-fetch debounce module** — M
  - New module: `packages/cli/src/prefetch.ts`
  - Debounce logic:
    - Accept cursor context `{ filePath, symbol, line, repoId }`
    - 500ms debounce window (configurable)
    - On debounce expiry: fire `POST /api/prefetch` to cloud (non-blocking, fire-and-forget)
    - On new context within window: reset timer, discard previous context
  - Max 2 pre-fetches per second (rate limit guard)
  - Error handling: catch and log all errors silently (never crash CLI)
  - **Test:** Send 5 cursor contexts in 200ms → only last one fires pre-fetch. Wait 600ms after single context → pre-fetch fires. Cloud unreachable → no error thrown.
  - **Depends on:** Phase 10a cloud proxy (P10a-CLI-05)
  - **Files:** `packages/cli/src/prefetch.ts` (new)
  - **Acceptance:** Debounce works. Pre-fetch fires correctly. Errors silenced.
  - Notes: _____

---

## 2.4 Backend / API Layer

### Cloud API Endpoints

- [ ] **P10b-API-01: Create `POST /api/prefetch` endpoint** — L
  - Input: `{ filePath: string, symbol: string, line: number, repoId: string }`
  - Auth: API key Bearer header (same auth as other API routes)
  - Pipeline:
    1. Resolve entity by symbol name + repoId in ArangoDB
    2. Expand context: 2-hop callers, 2-hop callees, same-file entities
    3. If Phase 3 embeddings exist: vector search for similar entities (top 5)
    4. Resolve applicable rules for the file path
    5. Cache all results in Redis with TTL
  - Response: `200 OK` (empty body — fire-and-forget)
  - Rate limit: 10 requests/second per API key (prevent abuse)
  - **Test:** POST with valid context → Redis cache populated. GET from cache → correct data. POST with unknown symbol → 200 (no-op). POST without auth → 401. Rapid-fire 20 requests → rate limited at 10/s.
  - **Depends on:** Phase 10a cloud infrastructure, Phase 6 rule resolution
  - **Files:** `app/api/prefetch/route.ts` (new)
  - **Acceptance:** Pre-fetch populates Redis. Cache entries expire correctly. Rate limited. No errors on unknown symbols.
  - Notes: _____

- [ ] **P10b-API-02: Create pre-fetch context expansion use case** — M
  - Business logic for the pre-fetch pipeline (called by the API route)
  - Receives container as argument (hexagonal pattern)
  - Uses `IGraphStore.getCallersOf`, `getCalleesOf`, `getEntitiesByFile`
  - Uses `IVectorSearch.search` (if available — graceful if Phase 3 not deployed)
  - Uses Phase 6 rule resolution logic
  - Caches results via `ICacheStore.set` with TTL
  - **Test:** With mock graph store containing 5 entities → pre-fetch expands to callers + callees. With no vector search adapter → skips semantic neighbors. With 3 rules → rules cached.
  - **Depends on:** Phase 6 rule resolution, existing ports
  - **Files:** `lib/use-cases/prefetch-context.ts` (new)
  - Notes: _____

- [ ] **P10b-API-03: Add pre-fetch cache check to cloud MCP tool handlers** — M
  - Modify cloud MCP tool handlers (`semantic_search`, `find_similar`, `get_project_stats`, `justify_entity`) to check Redis pre-fetch cache before executing queries
  - Cache key lookup: `prefetch:{repoId}:{entityKey}:{queryType}`
  - If cache HIT: return cached result with `_meta.source: "cloud_prefetched"`
  - If cache MISS: execute normal query path
  - **Test:** Pre-fetch for entity → `semantic_search` for same entity → cache hit, result returned in <50ms. Cache expired → normal query path. Cache miss for different entity → normal query.
  - **Depends on:** P10b-API-01, existing MCP tool handlers
  - **Files:** `lib/mcp/tools/semantic.ts` (modified), `lib/mcp/tools/search.ts` (modified), `lib/mcp/tools/stats.ts` (modified)
  - Notes: _____

### Temporal Workflow Extensions

- [ ] **P10b-API-04: Extend `queryCompactGraph` activity to export rules and patterns** — M
  - Modify `lib/temporal/activities/graph-export.ts`:
    - Add AQL query to export rules for org_id + repo_id (including org-level rules where repo_id is null)
    - Add AQL query to export patterns for org_id + repo_id
    - Return extended compact graph: `{ entities, edges, rules, patterns, entityCount, edgeCount, ruleCount, patternCount }`
  - **Test:** Insert 10 rules + 5 patterns into ArangoDB fake → activity returns all 10 rules and 5 patterns. Org-level rules (repo_id = null) included. Repo from different org → not included.
  - **Depends on:** Phase 10a P10a-API-04, Phase 6 rules/patterns in ArangoDB
  - **Files:** `lib/temporal/activities/graph-export.ts` (modified)
  - **Acceptance:** Rules and patterns included in compact export. Org-level rules exported for all repos in the org.
  - Notes: _____

- [ ] **P10b-API-05: Update `serializeToMsgpack` to produce v2 envelope** — S
  - Bump snapshot version from 1 to 2 when rules or patterns are present
  - Envelope: `{ version: 2, repoId, orgId, entities, edges, rules, patterns, generatedAt }`
  - If no rules or patterns exist for the repo: still produce v2 envelope with empty arrays (v2 CLI knows rules were checked but none exist)
  - Backward-compatible: v1 CLIs decode and ignore unknown fields
  - **Test:** Serialize with rules → v2 envelope. Deserialize v2 with v1 decoder → entities + edges loaded, rules/patterns ignored. Round-trip v2 → data matches.
  - **Depends on:** Phase 10a P10a-API-06
  - **Files:** `lib/temporal/activities/graph-export.ts` (modified)
  - Notes: _____

---

## 2.5 CLI / Client Layer

- [ ] **P10b-CLI-01: Extend `kap10 pull` to load rules and patterns from v2 snapshot** — M
  - After decoding msgpack:
    - If `envelope.version >= 2` and `envelope.rules` exists:
      - Create `rules` relation (if not exists)
      - Bulk insert rules into CozoDB
    - If `envelope.version >= 2` and `envelope.patterns` exists:
      - Create `patterns` relation (if not exists)
      - Bulk insert patterns into CozoDB
  - Extended summary output:
    - v1: `"✓ org/repo: 5,231 entities, 8,492 edges (2.1 MB)"`
    - v2: `"✓ org/repo: 5,231 entities, 8,492 edges, 47 rules, 12 patterns (2.4 MB, v2)"`
  - **Test:** Pull v2 snapshot → CozoDB has rules + patterns. Pull v1 snapshot → no rules/patterns loaded, no error. Pull v2 with empty rules array → rules relation created but empty.
  - **Depends on:** P10b-DB-01, Phase 10a P10a-CLI-01
  - **Files:** `packages/cli/src/commands/pull.ts` (modified), `packages/cli/src/local-graph.ts` (modified)
  - **Acceptance:** v2 snapshots load rules + patterns. v1 snapshots degrade gracefully. Summary output reflects rule/pattern counts.
  - Notes: _____

- [ ] **P10b-CLI-02: Extend routing table with `get_rules` and `check_rules`** — S
  - Add two entries to the routing table in `packages/cli/src/query-router.ts`:
    ```
    get_rules   → LOCAL
    check_rules → LOCAL
    ```
  - `get_rules` dispatches to `CozoGraphStore.getRules()`
  - `check_rules` dispatches to rule evaluator (`rule-evaluator.ts`)
  - If CozoDB `rules` relation is empty (v1 snapshot or no rules synced): fall back to cloud
  - **Test:** `get_rules` with v2 snapshot → local result. `check_rules` with structural rules → local evaluation. `get_rules` with v1 snapshot (no rules relation) → cloud fallback. Unknown tool → cloud (forward-compatible).
  - **Depends on:** P10b-ADAPT-01, P10b-ADAPT-02
  - **Files:** `packages/cli/src/query-router.ts` (modified)
  - Notes: _____

- [ ] **P10b-CLI-03: Integrate pre-fetch debounce into `kap10 serve`** — M
  - On `kap10 serve` startup:
    - Initialize pre-fetch module (debounce timer, cloud proxy reference)
    - If MCP client sends `notifications/resources/updated` or custom cursor events:
      - Extract file path + cursor position
      - Feed to pre-fetch debounce module
  - Pre-fetch is opt-in: `~/.kap10/config.json` → `"prefetchEnabled": true` (default: false for 10b, true in Phase 11)
  - If pre-fetch disabled or cloud unreachable: no pre-fetching, no error
  - **Test:** Start serve with `prefetchEnabled: true` → cursor event → pre-fetch fires after debounce. `prefetchEnabled: false` → no pre-fetch. Cloud unreachable → pre-fetch silently fails.
  - **Depends on:** P10b-ADAPT-03, Phase 10a P10a-CLI-02
  - **Files:** `packages/cli/src/commands/serve.ts` (modified)
  - Notes: _____

- [ ] **P10b-CLI-04: Add `--prefetch` flag to `kap10 serve`** — S
  - `kap10 serve --prefetch` — enables predictive pre-fetching for this session
  - `kap10 serve --no-prefetch` — disables (overrides config)
  - Default: reads from `~/.kap10/config.json` (`prefetchEnabled` field)
  - **Test:** `kap10 serve --prefetch` → pre-fetching active. `kap10 serve --no-prefetch` → pre-fetching disabled. No flag → reads config.
  - **Depends on:** P10b-CLI-03
  - **Files:** `packages/cli/src/commands/serve.ts` (modified)
  - Notes: _____

---

## 2.6 Frontend / UI Layer

- [ ] **P10b-UI-01: Add "Rules synced" indicator to repo detail page** — S
  - Show rules/patterns sync status on the repo detail page:
    - "47 rules, 12 patterns synced" (from `GraphSnapshotMeta` when snapshot v2)
    - "Rules not synced" (when snapshot v1 or no snapshot)
  - Only visible when Phase 6 rules exist for the repo
  - **Test:** Repo with v2 snapshot → shows rule/pattern count. Repo with v1 snapshot → shows "Rules not synced". Repo with no snapshot → not shown.
  - **Depends on:** Phase 10a P10a-DB-01 (GraphSnapshotMeta)
  - **Files:** `app/(dashboard)/repos/[repoId]/page.tsx` (modified)
  - Notes: _____

- [ ] **P10b-UI-02: Add "Pre-fetch" toggle to local setup instructions** — S
  - Extend the local setup instructions (Phase 10a) with pre-fetch configuration:
    - Explain what pre-fetching does
    - Show how to enable: `kap10 serve --prefetch`
    - Note: "Pre-fetching sends your cursor position to the kap10 cloud. Disable if you prefer full privacy."
  - **Test:** Instructions render. Toggle explanation is clear.
  - **Depends on:** Phase 10a P10a-UI-03
  - **Files:** `components/repo/local-setup-instructions.tsx` (modified)
  - Notes: _____

- [ ] **P10b-UI-03: Update `GraphSnapshotMeta` display to show v2 metadata** — S
  - Extend the snapshot status badge (Phase 10a) to show:
    - Snapshot version ("v1" or "v2")
    - Rule count and pattern count (for v2 snapshots)
  - **Test:** v1 snapshot → badge shows "v1". v2 snapshot → badge shows "v2 · 47 rules · 12 patterns".
  - **Depends on:** Phase 10a P10a-UI-01
  - **Files:** `components/dashboard/repo-card.tsx` (modified)
  - Notes: _____

---

## 2.7 Testing & Verification

### Unit Tests

- [ ] **P10b-TEST-01: CozoDB rules relation tests** — M
  - Insert 5 org-level + 10 repo-level rules → `getRules("lib/auth/jwt.ts")` returns resolved set
  - Org-level rule overridden by repo-level rule with same name → repo rule wins
  - Rule with `file_glob: "lib/auth/**"` → matches `lib/auth/jwt.ts`, excludes `lib/db/query.ts`
  - Disabled rule → excluded from results
  - Empty rules relation → empty array returned
  - **Depends on:** P10b-ADAPT-01
  - **Files:** `packages/cli/src/__tests__/local-graph.test.ts` (extended)
  - Notes: _____

- [ ] **P10b-TEST-02: Rule evaluator — structural rules** — M
  - TypeScript file with function declarations → structural rule matching `function_declaration` finds violations
  - Rule query matching `arrow_function` → finds arrow functions
  - File with no matches → 0 violations
  - Invalid tree-sitter query → error caught, violation skipped, `_meta.queryError` annotated
  - Non-TypeScript file with TypeScript grammar → parser gracefully fails, `_meta.parseError` set
  - **Depends on:** P10b-ADAPT-02
  - **Files:** `packages/cli/src/__tests__/rule-evaluator.test.ts`
  - Notes: _____

- [ ] **P10b-TEST-03: Rule evaluator — naming rules** — S
  - Rule regex `^[a-z]` (functions must start lowercase) → function `ValidateJWT` violates
  - Rule regex `_test$` (test functions must end with _test) → function `validate` violates
  - No entity names match regex → 0 violations
  - Invalid regex → error caught, rule skipped
  - **Depends on:** P10b-ADAPT-02
  - **Files:** `packages/cli/src/__tests__/rule-evaluator.test.ts`
  - Notes: _____

- [ ] **P10b-TEST-04: Rule evaluator — engine partitioning** — S
  - 3 structural + 2 naming + 1 semgrep + 1 llm rules → only 5 evaluated locally
  - 2 skipped rules in `_meta.skippedRules` with correct engine and reason
  - All rules are Semgrep → 0 local evaluations, all skipped, annotation suggests cloud
  - **Depends on:** P10b-ADAPT-02
  - **Files:** `packages/cli/src/__tests__/rule-evaluator.test.ts`
  - Notes: _____

- [ ] **P10b-TEST-05: Pre-fetch debounce tests** — S
  - 5 cursor contexts in 200ms → only last fires pre-fetch
  - Single context → pre-fetch fires after 500ms debounce
  - Pre-fetch error → silently caught, no exception
  - Rate limit: 3 pre-fetches in 1000ms → only 2 fire (max 2/s)
  - **Depends on:** P10b-ADAPT-03
  - **Files:** `packages/cli/src/__tests__/prefetch.test.ts`
  - Notes: _____

- [ ] **P10b-TEST-06: Snapshot v2 deserialization tests** — S
  - v2 msgpack with rules + patterns → all four data types loaded into CozoDB
  - v2 msgpack with empty rules array → rules relation created but empty
  - v1 msgpack (no rules/patterns keys) → entities + edges loaded, rules/patterns skipped
  - v2 msgpack loaded by v1-compatible code path → rules/patterns ignored, no error
  - **Depends on:** P10b-CLI-01
  - **Files:** `packages/cli/src/__tests__/pull.test.ts` (extended)
  - Notes: _____

- [ ] **P10b-TEST-07: Extended routing table tests** — S
  - `get_rules` → dispatched to local with v2 snapshot
  - `check_rules` → dispatched to local with v2 snapshot
  - `get_rules` with v1 snapshot (no rules) → falls back to cloud
  - `check_rules` with v1 snapshot → falls back to cloud
  - All Phase 10a local tools still route locally
  - All cloud tools still route to cloud
  - **Depends on:** P10b-CLI-02
  - **Files:** `packages/cli/src/__tests__/query-router.test.ts` (extended)
  - Notes: _____

### Integration Tests

- [ ] **P10b-TEST-08: Pre-fetch pipeline integration test** — L
  - End-to-end: insert entities + rules into ArangoDB → POST `/api/prefetch` → check Redis → cache entries present with correct TTL
  - Verify: callers, callees, same-file entities, rules all cached
  - Verify: TTL expires after configured seconds
  - Requires: ArangoDB fake + Redis fake
  - **Depends on:** P10b-API-01, P10b-API-02
  - **Files:** `lib/use-cases/__tests__/prefetch-context.integration.test.ts`
  - Notes: _____

- [ ] **P10b-TEST-09: Cloud tool pre-fetch cache hit test** — M
  - Pre-fetch for entity → call `semantic_search` for same entity → response includes `_meta.source: "cloud_prefetched"` and latency <50ms
  - No pre-fetch → call `semantic_search` → response includes `_meta.source: "cloud"` and normal latency
  - **Depends on:** P10b-API-03
  - **Files:** `lib/mcp/tools/__tests__/semantic.test.ts` (extended)
  - Notes: _____

- [ ] **P10b-TEST-10: v2 sync pipeline integration test** — L
  - End-to-end: insert entities + edges + rules + patterns into ArangoDB → run `syncLocalGraphWorkflow` → download v2 snapshot → load into CozoDB → query rules locally → correct results
  - Verify: rule resolution matches cloud results
  - Requires: testcontainers or fakes for ArangoDB, Supabase Storage, CozoDB
  - **Depends on:** P10b-API-04, P10b-API-05, P10b-CLI-01
  - **Files:** `lib/temporal/workflows/__tests__/sync-local-graph.integration.test.ts` (extended)
  - Notes: _____

### Manual Verification

- [ ] **P10b-TEST-11: Manual rule check latency comparison** — M
  - Configure Phase 6 rules for a real repo
  - Run `kap10 pull` → verify v2 snapshot loaded (rules + patterns present)
  - Agent calls `get_rules("lib/auth/jwt.ts")`:
    - Via cloud MCP: measure latency (~200ms expected)
    - Via local CLI MCP: measure latency (<5ms expected)
  - Agent calls `check_rules(...)` with structural rules:
    - Via cloud: ~500ms (Semgrep + ast-grep)
    - Via local: <10ms (tree-sitter only, Semgrep rules skipped)
  - Verify `_meta.skippedRules` annotates Semgrep rules
  - **Depends on:** All P10b items
  - Notes: _____

- [ ] **P10b-TEST-12: Manual pre-fetch verification** — M
  - Start `kap10 serve --prefetch`
  - Open a file in IDE → wait 1s → check Redis for pre-fetch cache entries
  - Agent calls `semantic_search` for a symbol in the opened file → verify faster response
  - Close IDE → wait 5 minutes → verify Redis cache entries expired
  - **Depends on:** All P10b items
  - Notes: _____

---

## Dependency Graph

```
P10b-INFRA-01 (tree-sitter) ─── independent
P10b-INFRA-02 (env vars) ────── independent

P10b-DB-01 (CozoDB rules/patterns schema) ─── depends on Phase 10a ADAPT-02
P10b-DB-02 (Redis pre-fetch key schema) ────── documentation only

P10b-ADAPT-01 (CozoGraphStore rule methods) ── depends on P10b-DB-01
P10b-ADAPT-02 (rule evaluator) ──────────────── depends on P10b-INFRA-01, P10b-ADAPT-01
P10b-ADAPT-03 (pre-fetch debounce) ──────────── depends on Phase 10a CLI-05

P10b-API-01 (POST /api/prefetch) ────────────── depends on Phase 10a, Phase 6
P10b-API-02 (pre-fetch use case) ────────────── depends on Phase 6, existing ports
P10b-API-03 (pre-fetch cache in tools) ──────── depends on P10b-API-01
P10b-API-04 (queryCompactGraph + rules) ─────── depends on Phase 10a API-04, Phase 6
P10b-API-05 (v2 msgpack envelope) ───────────── depends on Phase 10a API-06

P10b-CLI-01 (pull v2 snapshot) ──────────────── depends on P10b-DB-01, Phase 10a CLI-01
P10b-CLI-02 (routing table extension) ──────── depends on P10b-ADAPT-01, P10b-ADAPT-02
P10b-CLI-03 (pre-fetch in serve) ────────────── depends on P10b-ADAPT-03, Phase 10a CLI-02
P10b-CLI-04 (--prefetch flag) ───────────────── depends on P10b-CLI-03

P10b-UI-01 (rules synced indicator) ─────────── depends on Phase 10a DB-01
P10b-UI-02 (pre-fetch toggle instructions) ──── depends on Phase 10a UI-03
P10b-UI-03 (v2 metadata display) ────────────── depends on Phase 10a UI-01

P10b-TEST-01..12 ── depend on corresponding implementation items
```

**Recommended implementation order:**

1. **Infrastructure** (P10b-INFRA-01..02) — tree-sitter, env vars
2. **Database** (P10b-DB-01..02) — CozoDB schema extension, Redis key documentation
3. **Adapters** (P10b-ADAPT-01..03) — rule resolution, rule evaluator, pre-fetch debounce
4. **Cloud API** (P10b-API-01..05) — pre-fetch endpoint, use case, cache integration, graph export extension, v2 envelope
5. **CLI** (P10b-CLI-01..04) — v2 pull, routing table, pre-fetch integration, CLI flag
6. **Frontend** (P10b-UI-01..03) — rules indicator, pre-fetch toggle, v2 metadata
7. **Testing** (P10b-TEST-01..12) — unit, integration, manual

---

## New Files Summary

```
packages/cli/src/
  rule-evaluator.ts              ← Tree-sitter + regex rule evaluation (structural/naming only)
  prefetch.ts                    ← Pre-fetch debounce module (cursor context → cloud)
app/api/prefetch/
  route.ts                       ← POST /api/prefetch (cursor context → Redis pre-warm)
lib/use-cases/
  prefetch-context.ts            ← Pre-fetch context expansion logic (N-hop + vector + rules)
```

### Modified Files

```
packages/cli/src/
  cozo-schema.ts                 ← Add rules + patterns CozoDB relations
  local-graph.ts                 ← Add getRules(), getPatterns() methods
  query-router.ts                ← Add get_rules + check_rules → LOCAL routing
  commands/pull.ts               ← Load rules/patterns from v2 snapshot
  commands/serve.ts              ← Pre-fetch integration + --prefetch flag
lib/temporal/activities/
  graph-export.ts                ← Export rules + patterns in queryCompactGraph; v2 envelope
lib/mcp/tools/
  semantic.ts                    ← Pre-fetch cache check before pgvector query
  search.ts                      ← Pre-fetch cache check
  stats.ts                       ← Pre-fetch cache check
env.mjs                          ← PREFETCH_REDIS_TTL_SECONDS, PREFETCH_EXPANSION_HOPS
.env.example                     ← Document Phase 10b variables
components/dashboard/repo-card.tsx  ← v2 metadata display
components/repo/local-setup-instructions.tsx  ← Pre-fetch toggle
app/(dashboard)/repos/[repoId]/page.tsx       ← Rules synced indicator
packages/cli/package.json        ← tree-sitter + grammar dependencies
```

---

## Revision Log

| Date | Author | Change |
|------|--------|--------|
| 2026-02-21 | — | Initial document created. 2 INFRA, 2 DB, 3 ADAPT, 5 API, 4 CLI, 3 UI, 12 TEST items. Total: **31 tracker items.** |
