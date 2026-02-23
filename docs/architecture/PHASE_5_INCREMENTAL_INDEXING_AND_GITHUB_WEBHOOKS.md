# Phase 5 — Incremental Indexing & GitHub Webhooks: Deep Dive & Implementation Tracker

> **Phase Feature Statement:** _"When I push to GitHub, kap10 automatically re-indexes only the changed files. My MCP connection always has up-to-date knowledge within 30 seconds."_
>
> **Source:** [`VERTICAL_SLICING_PLAN.md`](./VERTICAL_SLICING_PLAN.md) — Phase 5
>
> **Prerequisites:** [Phase 1 — GitHub Connect & Repo Indexing](./PHASE_1_GITHUB_CONNECT_AND_INDEXING.md) (entities + call graph in ArangoDB, stable entity hashing, persistent workspace), [Phase 2 — Hosted MCP Server](./PHASE_2_HOSTED_MCP_SERVER.md) (MCP tools, workspace resolution, OTel spans), [Phase 3 — Semantic Search](./PHASE_3_SEMANTIC_SEARCH.md) (entity embeddings in pgvector, hybrid search), [Phase 4 — Business Justification & Taxonomy](./PHASE_4_BUSINESS_JUSTIFICATION_AND_TAXONOMY.md) (unified justifications, `justifyEntityWorkflow`, cascade re-justification design, canonical value seeds)
>
> **Database convention:** All kap10 Supabase tables use PostgreSQL schema `kap10`. ArangoDB collections are org-scoped (`org_{orgId}/`). See [VERTICAL_SLICING_PLAN.md § Storage & Infrastructure Split](./VERTICAL_SLICING_PLAN.md#storage--infrastructure-split).

---

## Table of Contents

- [Part 1: Architectural Deep Dive](#part-1-architectural-deep-dive)
  - [1.1 Core User Flows](#11-core-user-flows)
  - [1.2 System Logic & State Management](#12-system-logic--state-management)
  - [1.3 Reliability & Resilience](#13-reliability--resilience)
  - [1.4 Performance Considerations](#14-performance-considerations)
  - [1.5 Phase Bridge → Phase 5.5 & Phase 6](#15-phase-bridge--phase-55--phase-6)
- [Part 2: Implementation & Tracing Tracker](#part-2-implementation--tracing-tracker)
  - [2.1 Infrastructure Layer](#21-infrastructure-layer)
  - [2.2 Database & Schema Layer](#22-database--schema-layer)
  - [2.3 Ports & Adapters Layer](#23-ports--adapters-layer)
  - [2.4 Backend / API Layer](#24-backend--api-layer)
  - [2.5 Frontend / UI Layer](#25-frontend--ui-layer)
  - [2.6 Testing & Verification](#26-testing--verification)

---

## Canonical Terminology

> **CRITICAL:** Use these canonical names. See [Phase 4 § Canonical Terminology](./PHASE_4_BUSINESS_JUSTIFICATION_AND_TAXONOMY.md#canonical-terminology) for justification-related terms (purpose, taxonomy, feature_area, etc.).

| Canonical Term | DB Field (snake_case) | TS Field (camelCase) | Definition | NOT called |
|---|---|---|---|---|
| **Push Event** | — | `PushEvent` | A GitHub `push` webhook payload containing commits and changed file paths. The atomic trigger for incremental indexing. | ~~webhook~~, ~~commit event~~, ~~change event~~ |
| **Changed Files** | — | `ChangedFile` | A file path with a change type (`added`, `modified`, `removed`). Extracted from a push event by computing the diff between the old and new HEAD. | ~~diff~~, ~~delta~~, ~~modified files~~ |
| **Entity Diff** | — | `EntityDiff` | The comparison result for a single file: `{ added: EntityRecord[], updated: EntityRecord[], deleted: EntityRecord[] }`. Computed by comparing old vs new entity hashes. | ~~entity delta~~, ~~hash diff~~ |
| **Cascade Re-Justification** | — | `cascadeReJustify` | The process of re-justifying callers when a callee's code or justification changes significantly. Triggers Phase 4's `justifyEntityWorkflow`. | ~~propagate~~, ~~ripple~~, ~~chain re-classify~~ |
| **Significant Change** | — | `isSignificantChange` | A justification is "significantly changed" when the cosine distance between old and new justification embeddings exceeds 0.3. Threshold for triggering cascade. | ~~meaningful change~~, ~~material change~~ |
| **Persistent Workspace** | `workspace_path` | `workspacePath` | The on-disk clone at `/data/workspaces/{orgId}/{repoId}/`. Created in Phase 1, reused for `git pull` in Phase 5. | ~~clone dir~~, ~~repo dir~~ |
| **Incremental Window** | — | `incrementalWindow` | The set of files changed between `lastIndexedSha` and the push event's `after` SHA. Defines the re-indexing scope. | ~~change set~~, ~~diff window~~ |
| **Activity Feed** | `index_events` (collection) | `IndexEvent` | Append-only log of indexing events shown on the dashboard. Each push produces one event with entity counts. | ~~activity log~~, ~~event stream~~ |
| **AST Comparator** | — | `AstComparator` | A pre-cascade activity that uses `ast-grep` to compare old and new ASTs of a modified entity. If the diff contains only whitespace, comment, or formatting changes (non-semantic), the entity is excluded from cascade re-justification. | ~~diff filter~~, ~~noise filter~~, ~~format checker~~ |
| **Centrality Score** | `centrality_score` | `centralityScore` | A PageRank-style inbound-edge count for an entity in the call graph. Entities with centrality above a configurable threshold (default: 50 inbound callers) are classified as **hub nodes** and exempt from caller-cascade re-justification. | ~~popularity~~, ~~hotness~~, ~~fan-in count~~ |
| **Signal Debouncing** | — | `pushSignal` | The Temporal Signal-with-Start pattern that absorbs "commit storms" (rapid successive pushes). Instead of starting N workflows for N pushes, a single repo-dedicated workflow receives signals and waits for a quiet period (60s) before batching all changes into one indexing run. | ~~rate limiting~~, ~~queue throttling~~, ~~push coalescing~~ |
| **Branch Shadow Graph** | `branch_overlay` | `BranchOverlay` | A lightweight delta graph in ArangoDB that stores only the AST nodes modified on a feature branch, linked to the stable `main` graph. Enables branch-aware MCP queries that traverse `main + feature-branch` combined. | ~~branch copy~~, ~~branch fork~~, ~~branch snapshot~~ |
| **Semantic Drift Alert** | — | `DriftAlert` | A proactive notification generated when a high-centrality entity's *business intent* changes (old vs new justification diverges semantically). Queries Git blame for downstream callers' authors and creates a GitHub Issue or notification. | ~~breaking change alert~~, ~~dependency warning~~ |
| **Blue/Green Vectoring** | `vector_version` | `vectorVersion` | A zero-downtime embedding update strategy where new vectors are written to a pending namespace, and a single atomic PostgreSQL transaction flips the active version pointer after the indexing workflow completes. | ~~hot swap~~, ~~rolling update~~, ~~vector rotation~~ |
| **Semantic Fingerprint** | — | `semanticFingerprint` | An AST-structure-based SHA-256 hash that identifies an entity by its structural shape (ignoring whitespace and variable names). Used to detect file moves/renames without losing entity history. | ~~content hash~~, ~~structural hash~~, ~~AST hash~~ |
| **Quarantine Node** | `is_quarantined` | `isQuarantined` | An ArangoDB entity tagged as unparseable (corrupted, minified, or syntax-error files). Stored as an opaque blob without edges. MCP tools warn agents: "This file is quarantined due to parsing limits." | ~~error node~~, ~~failed entity~~, ~~broken file~~ |

---

# Part 1: Architectural Deep Dive

## 1.1 Core User Flows

### Flow 1: Push Webhook → Incremental Re-Index (Primary Flow)

**Actor:** System (automated, triggered by GitHub push webhook)
**Precondition:** Repo is in `ready` status. Phase 1 full index completed. Persistent workspace exists. `lastIndexedSha` stored in Supabase.
**Outcome:** Only changed files are re-indexed. Entities added/updated/deleted in ArangoDB. Embeddings updated in pgvector. Justifications cascade-updated if needed. MCP queries reflect new code within 30 seconds.

```
Step  Actor Action                     System Action                                           Response
────  ──────────────────────────────   ──────────────────────────────────────────────────────   ─────────────────────────
1     Developer pushes to GitHub       GitHub sends POST /api/webhooks/github                   —
                                       Payload: { ref, before, after, commits, repository,
                                       installation: { id } }

2                                      Webhook handler validates:                                —
                                       a) HMAC-SHA256 signature (x-hub-signature-256)
                                       b) Event type is "push" (x-github-event header)
                                       c) Deduplicate via Redis (delivery ID, TTL 24h)
                                       d) Resolve orgId from installation.id
                                       e) Resolve repoId from repository.id

3                                      Guard checks:                                            —
                                       a) Repo exists and status == "ready"
                                          (reject if indexing/embedding/error)
                                       b) Push is to the repo's default branch
                                          (ignore feature branch pushes — configurable)
                                       c) before SHA matches lastIndexedSha
                                          (if not, queue a full re-index instead)

4                                      Start incrementalIndexWorkflow (Temporal)                 —
                                       workflowId: incr-{orgId}-{repoId}-{after_sha_short}
                                       Conflict policy: USE_EXISTING (debounce rapid pushes)
                                       Queue: heavy-compute-queue (workspace ops)

5                                      Activity: pullAndDiff (heavy-compute-queue)               —
                                       a) cd /data/workspaces/{orgId}/{repoId}
                                       b) git fetch origin {defaultBranch}
                                       c) git diff --name-status {before}..{after} → changed files
                                       d) git checkout {after} (advance working tree)
                                       e) Output: ChangedFile[] with changeType per file
                                       f) Update lastIndexedSha → after (optimistic, reverted on failure)

6                                      Fan-out per changed file (parallel, batched):             —

                                       For ADDED or MODIFIED files:
                                       Activity: reIndexFile (heavy-compute-queue)
                                         a) Detect language for this file
                                         b) Run SCIP or Tree-sitter extraction (same as Phase 1)
                                         c) Produce new entity set with stable hashes
                                         d) Load old entity hashes for this file from ArangoDB
                                         e) Compute entity diff: added / updated / deleted entities
                                         f) Report heartbeat with file progress

                                       For REMOVED files:
                                       Activity: removeFileEntities (heavy-compute-queue)
                                         a) Load all entities for this file from ArangoDB
                                         b) Collect entity keys for deletion
                                         c) Output: all entity keys + edge keys to delete

7                                      Activity: applyEntityDiffs (light-llm-queue)              —
                                       Batch-apply all entity diffs to ArangoDB:
                                       a) INSERT new entities
                                       b) UPDATE modified entities (content changed, hash unchanged)
                                       c) DELETE removed entities + all their edges
                                       d) Re-link cross-file edges affected by deletions
                                       e) Update repo stats (file_count, function_count, class_count)
                                       f) Write index_events activity feed document

8                                      Activity: updateEmbeddings (light-llm-queue)              —
                                       a) For added/modified entities: re-embed via nomic-embed-text
                                          Reuse Phase 3 embedRepoWorkflow logic (batch embed)
                                       b) For deleted entities: DELETE from pgvector entity_embeddings
                                       c) For added/modified entities: UPDATE pgvector

9                                      Activity: cascadeReJustify (light-llm-queue)              —
                                       (Only runs if Phase 4 justifications exist for this repo)
                                       a) Collect all entity keys that were added, modified, or deleted
                                       b) For each changed entity:
                                          - Compare old justification embedding vs new code embedding
                                          - If cosine distance > 0.3 (significant change):
                                            Start justifyEntityWorkflow (Phase 4) for this entity
                                       c) For each deleted entity:
                                          - Find all 1-hop callers from call graph
                                          - Start justifyEntityWorkflow for each caller
                                          - Delete the entity's justification + justified_by edge
                                          - Delete from justification_embeddings (pgvector)
                                       d) Cap cascade: max 2 hops, max 50 entities total
                                       e) If any entity's feature_area changed:
                                          Run aggregateFeatures (Phase 4 reusable activity)

10                                     Activity: invalidateCaches (light-llm-queue)              —
                                       a) Invalidate Redis keys:
                                          - search:* for this repo (hybrid search cache)
                                          - justification:* for affected entities
                                          - blueprint:* for this repo
                                       b) Broadcast workspace overlay invalidation
                                          (Phase 2 workspace resolution)

11                                     Repo remains status: "ready"                              Dashboard shows
                                       lastIndexedSha updated to {after}                        "Indexed 3 files from
                                       lastIndexedAt updated                                    push abc1234" in
                                                                                                activity feed
```

**Why fan-out per file (not per entity):** Files are the natural unit of change in a push. SCIP and Tree-sitter operate on entire files. Entities within a file are extracted as a group. Fan-out per file also maps cleanly to Temporal's parallel activity execution model and heartbeat granularity.

### Flow 2: Rapid Push Debouncing

**Actor:** System (multiple pushes arrive within seconds)
**Precondition:** Same repo, rapid successive pushes (e.g., CI bot, rebase, or force push)
**Outcome:** Only the latest push is processed. Intermediate pushes are coalesced.

```
Step  Actor Action                     System Action                                           Response
────  ──────────────────────────────   ──────────────────────────────────────────────────────   ─────────────────────────
1     Push A arrives (SHA: aaa→bbb)    Start incrementalIndexWorkflow                           —
                                       workflowId: incr-{orgId}-{repoId}-{bbb_short}

2     Push B arrives (SHA: bbb→ccc)    Start incrementalIndexWorkflow                           —
      (2 seconds later)                workflowId: incr-{orgId}-{repoId}-{ccc_short}
                                       Different workflow ID → STARTS (not deduplicated)

3                                      Workflow A sees SHA gap:                                  —
                                       before (aaa) matches lastIndexedSha → proceeds normally
                                       After A completes: lastIndexedSha = bbb

4                                      Workflow B starts pullAndDiff:                            —
                                       before (bbb) matches lastIndexedSha (updated by A)
                                       Diffs bbb..ccc → only files changed in push B

5     Push C arrives (SHA: ccc→ddd)    Start incrementalIndexWorkflow                           —
      (while B is still running)       workflowId: incr-{orgId}-{repoId}-{ddd_short}

6                                      Workflow C's pullAndDiff:                                 —
                                       before (ccc) does NOT match lastIndexedSha (still bbb
                                       because B hasn't finished yet)
                                       → SHA gap detected. Workflow C WAITS for B to complete,
                                         then re-reads lastIndexedSha. If now ccc → proceed.
                                         If still gap → fall back to full diff (ccc..ddd
                                         relative to whatever lastIndexedSha is)
```

**Key invariant:** `lastIndexedSha` is updated atomically AFTER successful applyEntityDiffs. Concurrent workflows respect this: each workflow diffs from the current `lastIndexedSha`, not from a stale value.

### Flow 3: Force Push / SHA Gap → Full Re-Index Fallback

**Actor:** Developer force-pushes (rewrites history)
**Precondition:** `before` SHA in webhook doesn't match `lastIndexedSha`
**Outcome:** Falls back to full re-index (Phase 1 pipeline) to ensure consistency

```
Step  Actor Action                     System Action                                           Response
────  ──────────────────────────────   ──────────────────────────────────────────────────────   ─────────────────────────
1     Developer runs git push --force  GitHub sends push webhook                                —
                                       before: {old_sha}, after: {new_sha}

2                                      Webhook handler resolves repo                            —
                                       lastIndexedSha != before SHA (history rewritten)

3                                      Start indexRepoWorkflow (FULL re-index, Phase 1)         —
                                       workflowId: index-{orgId}-{repoId}
                                       This is the existing full-index workflow.
                                       Clears and rebuilds the entire entity graph.

4                                      After full re-index completes:                           —
                                       → Trigger embedRepoWorkflow (Phase 3)
                                       → Trigger justifyRepoWorkflow (Phase 4, if first time)
                                       → lastIndexedSha updated to {new_sha}

5                                      Activity feed shows:                                     "Full re-index triggered
                                       "Force push detected — running full re-index"            (force push)"
```

### Flow 4: Agent Queries Recent Changes via MCP

**Actor:** AI agent (via MCP client)
**Precondition:** Repo has been incrementally indexed at least once
**Outcome:** Agent receives a summary of recently changed entities

```
Step  Actor Action                     System Action                                           Response
────  ──────────────────────────────   ──────────────────────────────────────────────────────   ─────────────────────────
1     Agent calls MCP tool:            MCP server receives tool call                            —
      get_recent_changes({
        since: "2h",
        limit: 20
      })

2                                      Query index_events collection (ArangoDB):                —
                                       FOR e IN index_events
                                         FILTER e.repo_id == @repoId
                                         AND e.org_id == @orgId
                                         AND e.created_at >= @sinceTimestamp
                                         SORT e.created_at DESC
                                         LIMIT @limit
                                         RETURN e

3                                      For each event, enrich with entity details:              —
                                       Fetch entity names, kinds, file paths for each
                                       added/modified/deleted entity key

4                                      Return MCP tool response                                 JSON with:
                                                                                                pushSha, timestamp,
                                                                                                filesChanged,
                                                                                                entitiesAdded[],
                                                                                                entitiesModified[],
                                                                                                entitiesDeleted[],
                                                                                                cascadeStatus
```

### Flow 5: Dashboard Activity Feed (Real-Time)

**Actor:** Human user (via browser)
**Precondition:** Repo exists, user has access
**Outcome:** User sees real-time indexing activity

```
Step  Actor Action                     System Action                                           Response
────  ──────────────────────────────   ──────────────────────────────────────────────────────   ─────────────────────────
1     User navigates to                API route: GET /api/repos/{repoId}/activity              —
      /repos/[repoId]/activity

2                                      Query index_events (ArangoDB, last 50)                   —
                                       + query Temporal for any in-flight workflows

3                                      Return JSON                                              Activity feed data

4     User sees activity feed          React renders timeline of indexing events:                Timeline with:
                                       - Push SHA + commit message                              "3 files indexed from
                                       - Files changed count                                    push abc1234 (2s ago)"
                                       - Entities added/modified/deleted counts                 entity diff badges,
                                       - Cascade re-justification status                        cascade status
                                       - In-flight workflow progress (if running)

5     New push arrives while user      Server-Sent Events or polling (every 5s):                Feed updates live
      is viewing                       Dashboard polls /api/repos/{repoId}/activity
```

---

## 1.2 System Logic & State Management

### Repo Status — Phase 5 Extension

Phase 5 does NOT add new `RepoStatus` enum values. The repo stays `ready` during incremental indexing. Incremental re-indexing is a background enrichment — the repo remains fully queryable throughout.

```
Phase 1:  pending → indexing → ready | error
Phase 3:  ready → embedding → ready | embed_failed
Phase 4:  ready + justification_status: pending → running → complete | failed
Phase 5:  ready (unchanged). Incremental indexing is tracked via:
          - Temporal workflow state (queryable)
          - index_events collection (activity feed)
          - lastIndexedSha field (progress marker)
```

**Why not a new status:** Adding an "incremental_indexing" status would block MCP queries and agent usage during the 10-30 second re-index window. This is unacceptable — the entire value proposition of Phase 5 is that agents always have up-to-date knowledge without interruption.

### Entity Hash Diff Algorithm

The core algorithm that makes incremental indexing work. Defined in Phase 1's `entityHash()` function — identity-based, not content-based:

```
Entity Hash Diff Algorithm:

Input:
  oldEntities: Map<entityHash, EntityRecord>  ← from ArangoDB (entities for this file)
  newEntities: Map<entityHash, EntityRecord>  ← from SCIP/Tree-sitter re-extraction

Algorithm:
  added   = []   // entities in newEntities but NOT in oldEntities (new code)
  updated = []   // entities in BOTH (same identity, content may differ)
  deleted = []   // entities in oldEntities but NOT in newEntities (removed/renamed)

  for (hash, entity) in newEntities:
    if hash in oldEntities:
      // Same identity. Check if content changed.
      old = oldEntities[hash]
      if entity.body != old.body OR entity.signature != old.signature:
        updated.push(entity)  // Content changed → update in ArangoDB
      // else: identical → skip (no-op)
    else:
      added.push(entity)      // New entity → insert

  for (hash, entity) in oldEntities:
    if hash NOT in newEntities:
      deleted.push(entity)    // Removed or renamed → delete + cascade

Output: EntityDiff { added, updated, deleted }

Edge cases:
  - RENAMED function (same body, new name):
    Old hash gone (deleted), new hash appears (added).
    Treated as delete + add. Callers of old entity get cascade re-justified.
    Old edges severed, new edges rebuilt by cross-file linker.
  - MOVED function (same name/body, new file):
    Different file path in hash → different hash.
    Same treatment as rename: delete old + add new.
  - SIGNATURE CHANGE only (e.g., added parameter):
    Same file + kind + name → same hash (identity preserved).
    Detected as "updated" (signature field differs).
    Edges preserved. Content updated in place.
```

### Cross-File Edge Repair

When entities are added or deleted, cross-file edges (calls, imports, extends, implements) may break or need creation. Phase 5 must repair edges selectively:

```
Edge Repair Strategy:

1. DELETED entity:
   - Find all edges where _from or _to references this entity
   - Delete those edges from ArangoDB
   - Callers that lost an edge: mark for cascade re-justification

2. ADDED entity:
   - Run a SCOPED cross-file linker (only for the new entity):
     a) Check if any existing entities call this new entity
        → Look for import edges pointing to this entity's file
        → Check if the imported symbol name matches the new entity
     b) Check if this new entity calls any existing entities
        → Parse the new entity's call sites
        → Resolve via import map (same as Phase 1 CallGraphLinker)
   - Create new edges for discovered relationships

3. UPDATED entity:
   - If signature changed: re-run call extraction for this entity
     → May discover new callees or lose old ones
   - If only body changed: edges likely unchanged (keep existing)
     → But re-extract calls from body to catch new internal calls
```

### Semantic AST Diffing — The Noise Filter

**Problem:** If a developer fixes a typo in a comment, reformats code (Prettier), or adjusts whitespace, the Git hash and file hash change, triggering expensive re-indexing and cascade re-justification for what is semantically a no-op.

**Solution:** Introduce an `AstComparator` activity that runs *before* entity diff and cascade re-justification. It uses `ast-grep` to compare the old and new ASTs of each modified file. If the diff contains **only** non-semantic changes (whitespace, comments, formatting, import reordering), the file is excluded from entity diffing entirely.

```
AST Comparison Pipeline (per modified file):

1. Read old entity body from ArangoDB (or workspace overlay cache)
2. Read new entity body from the just-pulled working tree
3. Run ast-grep structural comparison:
   a) Parse old body → AST_old (ignoring comments, whitespace, formatting)
   b) Parse new body → AST_new (ignoring comments, whitespace, formatting)
   c) If AST_old == AST_new → SKIP this file (no semantic change)
   d) If AST_old != AST_new → PROCEED to entity diff

Classification of changes:
  SEMANTIC (proceed):
    - Function body logic changed
    - Parameter added/removed/retyped
    - Return type changed
    - New branch/condition/loop added
    - Variable renamed (if used in logic)
    - Import of a new module

  NON-SEMANTIC (skip):
    - Comment added/removed/changed
    - Whitespace/indentation change
    - Prettier/ESLint auto-format
    - Import reordering (same imports, different order)
    - Trailing comma added/removed
    - String quote style change (' → ")
```

**Performance impact:** `ast-grep` structural parse adds ~50 ms per file. For a typical push of 5 files, this is ~250 ms of pre-filtering. However, it can **eliminate** 60–80% of cascade re-justification calls on format-heavy pushes (e.g., after running Prettier across the codebase), saving potentially hundreds of LLM calls.

**Fallback:** If `ast-grep` is not available or crashes for a file, fall back to the existing behavior (treat all modified files as semantically changed). The noise filter is an optimization, never a gate.

### Blast-Radius Bounding via Centrality Scoring

**Problem:** If someone updates a highly central node (e.g., `src/utils/logger.ts` which has 2,000 callers), Temporal will attempt to cascade re-justify all 2,000 caller functions, hitting LLM rate limits and bankrupting the Langfuse budget (Phase 8).

**Solution:** Implement **centrality scoring** in ArangoDB. Before cascading to callers, query the modified entity's inbound edge count. If it exceeds `CENTRALITY_THRESHOLD` (default: 50), the entity is classified as a **hub node**. For hub nodes, kap10 does **not** cascade to callers — it only re-justifies the hub entity itself and updates its embedding, letting the graph natively handle the topological shift.

```
Centrality Check (runs before cascade hop 1):

For each entity in the re-justify queue:
  inboundCount = AQL:
    RETURN LENGTH(
      FOR e IN calls
        FILTER e._to == @entityHandle
        RETURN 1
    )

  If inboundCount > CENTRALITY_THRESHOLD:
    → Mark as hub node
    → Re-justify THIS entity only (update justification + embedding)
    → Do NOT cascade to callers
    → Log: "Hub node detected: {entityName} has {inboundCount} callers — cascade suppressed"

  Else:
    → Normal cascade behavior (hop 1 + optional hop 2)
```

**Why this works:** Hub nodes (loggers, validators, base classes, utility functions) rarely change their *business justification* when their implementation changes. A logger's purpose is "logging" regardless of internal changes. Re-justifying 2,000 callers of a logger because its formatting changed is pure waste. By contrast, a leaf function that changes from "calculate tax" to "calculate discount" genuinely affects its 5 callers' justifications.

**Configurable threshold:** `CENTRALITY_THRESHOLD` env var (default: 50, min: 10, max: 500). Can be tuned per-org in future phases.

### Temporal Signal Debouncing — The "Commit Storm" Absorber

**Problem:** If a developer makes 10 small commits and pushes them over 5 minutes (or uses an auto-sync tool), GitHub fires 10 separate push webhooks. Starting 10 concurrent `incrementalIndexWorkflow` instances causes database write locks, race conditions, and massive LLM API waste on redundant cascade re-justifications.

**Solution:** Replace the per-push workflow start with the **Temporal Signal-with-Start pattern**. When a webhook arrives, the API route does not immediately start an indexing activity. Instead, it sends a Temporal Signal containing the target Git hash to the repo's dedicated workflow. The workflow uses `condition()` to pause for a "quiet period" (60 seconds). Every new signal resets the timer. Once the timer expires, it batches all accumulated changes and performs a single, optimized indexing run.

```
Signal Debouncing Architecture:

Webhook Handler (app/api/webhooks/github/route.ts):
  On push event:
    → signalWithStart("incrementalIndexWorkflow", {
        workflowId: "incr-{orgId}-{repoId}",      // FIXED per repo (not per SHA)
        signal: pushSignal,
        signalArgs: [{ afterSha, beforeSha, ref }],
        taskQueue: "heavy-compute-queue"
      })
    → Return 200 immediately

incrementalIndexWorkflow (Temporal):
  let pendingPushes: PushSignalPayload[] = []
  let isQuiet = false

  setHandler(pushSignal, (payload) => {
    pendingPushes.push(payload)
    isQuiet = false     // Reset quiet timer
  })

  // Debounce loop: wait until no new signals for DEBOUNCE_QUIET_PERIOD
  while (!isQuiet) {
    isQuiet = true
    await sleep(DEBOUNCE_QUIET_PERIOD)    // Default: 60s
  }

  // Batch: only diff from lastIndexedSha → latest afterSha
  const latestPush = pendingPushes[pendingPushes.length - 1]
  const earliestBefore = pendingPushes[0].beforeSha

  // Proceed with single indexing run
  await executeActivities(earliestBefore, latestPush.afterSha)
```

**Key behavioral change:** The workflow ID is now **fixed per repo** (`incr-{orgId}-{repoId}`) instead of per-SHA (`incr-{orgId}-{repoId}-{sha}`). This means `signalWithStart` either signals an existing running workflow or starts a new one — never creating duplicates.

**Configuration:**
- `DEBOUNCE_QUIET_PERIOD` env var (default: `60s`, min: `10s`, max: `300s`)
- Setting to `0s` effectively disables debouncing (each push processed immediately)

**Interaction with existing Flow 2 (Rapid Push Debouncing):** Signal debouncing *replaces* the current SHA-based dedup approach in Flow 2. The new mechanism is strictly more efficient — it coalesces N pushes into 1 workflow execution, whereas the old approach executed N separate workflows sequentially.

### Branch-Aware MVCC Shadow Graph

**Problem:** ArangoDB currently represents a single source of truth, likely the `main` branch. If a developer works on a feature branch, the MCP server feeds the agent outdated context from `main`, leading to hallucinated suggestions about code that doesn't exist on their branch.

**Solution:** Transform ArangoDB to support **branch-aware shadow graphs**. When a user pushes to a feature branch (or runs the CLI locally on a branch), Phase 5 doesn't overwrite `main`'s entities. It creates a lightweight "delta graph" — inserting only the modified AST nodes and linking them to the stable `main` nodes.

```
Branch Shadow Graph Architecture:

ArangoDB Schema Extension:
  Every entity document gains:
    branches: string[]     — branches where this entity version is active
                             Default: ["main"] for full-index entities
                             Feature branch entities: ["feature/auth-refactor"]

  Every edge document gains:
    branches: string[]     — same semantics as entity branches

Shadow Graph Creation (on feature branch push):
  1. Receive push webhook for refs/heads/feature/auth-refactor
  2. Diff feature branch HEAD against merge-base with main:
     git merge-base main feature/auth-refactor → base_sha
     git diff --name-status base_sha..feature_head → changed files
  3. For each changed file:
     a) Extract entities from feature branch version
     b) Compute entity diff against main's entities for that file
     c) For ADDED entities: insert with branches: ["feature/auth-refactor"]
     d) For MODIFIED entities: insert NEW version with branches: ["feature/auth-refactor"]
        (main version untouched — both coexist)
     e) For DELETED entities: mark branch deletion overlay
  4. Cross-file edges for feature branch entities link to:
     - Other feature branch entities (if they exist)
     - main entities (fallback — stable graph)

MCP Query Resolution (branch-aware):
  When agent queries with branch context:
    1. Query entities WHERE @branch IN branches
       UNION entities WHERE "main" IN branches
         AND _key NOT IN (shadow overrides for @branch)
    2. This produces a merged view: main + feature branch overlay
    3. Agent sees: "Your new AuthRouter (feature branch) connects to
       the existing UserService (main) via the login() call edge."

Cleanup:
  When feature branch is merged into main:
    1. Promote feature branch entities → add "main" to their branches array
    2. Delete superseded main entities (replaced by feature versions)
    3. Remove branch name from all branch arrays
  When feature branch is deleted:
    1. Delete all entities where branches == ["feature/..."] only
    2. Associated edges cleaned up
```

**Configuration:**
- `BRANCH_INDEXING_ENABLED` env var (default: `false` — opt-in per org)
- `BRANCH_INDEXING_PATTERN` env var (default: `*` — index all branches; can be set to `feature/*,fix/*` to limit)
- Feature branch pushes are processed on `heavy-compute-queue` (same as main)

**Storage cost:** Shadow graphs are lightweight — only modified entities are duplicated. A typical feature branch touching 10 files adds ~50–200 entity documents (vs. 10,000+ for a full repo). ArangoDB handles this trivially.

### Proactive Semantic Drift Alerting

**Problem:** Phase 5's cascade re-justification silently updates the database when a dependency changes. But if a core engineer fundamentally changes a widely used utility's behavior (e.g., changing date parsing semantics), downstream consumers won't know until their code breaks in production.

**Solution:** Inject a `driftEvaluationActivity` into the incremental webhook pipeline. When `ast-grep` detects a significant structural change in a node with high in-degree (many callers), the cloud LLM compares old and new justifications. If the *business intent* has changed, kap10 queries Git blame for the authors of all downstream calling functions and generates an automated alert.

```
Drift Alerting Pipeline:

Trigger: After cascadeReJustify completes, for each entity where:
  a) justification changed significantly (cosine distance > SIGNIFICANCE_THRESHOLD)
  b) entity has > DRIFT_ALERT_CALLER_THRESHOLD inbound callers (default: 10)

Activity: driftEvaluationActivity (light-llm-queue)
  Input: { entityKey, oldJustification, newJustification, callerEntityKeys[] }

  1. LLM comparison (gpt-4o-mini, 500 token budget):
     Prompt: "Compare these two descriptions of the same function.
              Has the BUSINESS INTENT changed, or just the implementation?
              Old: {oldJustification.purpose}
              New: {newJustification.purpose}
              Respond: { intentChanged: boolean, summary: string }"

  2. If intentChanged == false → exit (implementation detail change, safe)

  3. If intentChanged == true → Build Drift Alert:
     a) Query ArangoDB for all 1-hop callers of the changed entity
     b) For each caller entity:
        - Fetch file path + start line
        - Query Git blame via IGitHost.blame(filePath, startLine):
          → Extract last author email
     c) Deduplicate authors → unique author set

  4. Generate alert:
     Option A — GitHub Issue (if repo is GitHub-hosted):
       POST /repos/{owner}/{repo}/issues
       Title: "⚠️ Semantic drift detected: {entityName}"
       Body: "The Platform team pushed an update to `{entityName}`.
              The business intent has changed:
              - Before: {oldPurpose}
              - After: {newPurpose}

              Affected downstream functions ({callerCount}):
              - `BillingService.calculateTotal()` (@alice)
              - `UserDashboard.render()` (@bob)
              ...

              Please review your usage of this function."
       Assignees: [unique author logins]
       Labels: ["kap10:drift-alert"]

     Option B — Dashboard notification (always):
       INSERT INTO public.notifications:
         { type: "warning", title: "Semantic drift: {entityName}",
           message: summary, link: "/repos/{repoId}/entity/{entityKey}" }

     Option C — Slack (if Slack integration configured, Phase 9+):
       POST to configured webhook URL
```

**Configuration:**
- `DRIFT_ALERT_ENABLED` env var (default: `true`)
- `DRIFT_ALERT_CALLER_THRESHOLD` env var (default: 10 — minimum callers before drift alerting kicks in)
- `DRIFT_ALERT_CHANNEL` env var (default: `"dashboard"` — options: `"dashboard"`, `"github_issue"`, `"both"`)

### Zero-Downtime Blue/Green pgvector Hot Swapping

**Problem:** During a massive force-push or major incremental re-index, the Temporal worker aggressively deletes and re-inserts embeddings into pgvector. If an AI agent queries semantic search (Phase 3) at that exact moment, it gets fragmented, incomplete results.

**Solution:** Implement **Blue/Green Vector Namespacing**. When Phase 5 triggers an embedding update, it writes new vectors to a pending version. Once the entire indexing workflow completes, a single atomic PostgreSQL transaction flips the active version pointer, and a background worker garbage-collects the old vectors.

```
Blue/Green Vectoring Architecture:

Schema Extension (kap10.entity_embeddings):
  ADD COLUMN vector_version UUID NOT NULL DEFAULT gen_random_uuid()

New Table (kap10.active_vector_versions):
  repo_id    TEXT PRIMARY KEY
  version_id UUID NOT NULL
  activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

Write Path (during indexing):
  1. Generate new version_id = gen_random_uuid()
  2. All embedding INSERTs use this version_id:
     INSERT INTO kap10.entity_embeddings
       (entity_key, repo_id, embedding, vector_version)
     VALUES (@key, @repoId, @embedding, @newVersionId)
  3. Old embeddings (previous version) are untouched during writes

Activation (after indexing workflow completes successfully):
  BEGIN;
    UPDATE kap10.active_vector_versions
      SET version_id = @newVersionId, activated_at = NOW()
      WHERE repo_id = @repoId;
    -- If no row exists (first index):
    INSERT INTO kap10.active_vector_versions (repo_id, version_id)
      VALUES (@repoId, @newVersionId)
      ON CONFLICT (repo_id) DO UPDATE SET
        version_id = @newVersionId, activated_at = NOW();
  COMMIT;

Read Path (semantic search queries):
  SELECT e.* FROM kap10.entity_embeddings e
  JOIN kap10.active_vector_versions v ON e.repo_id = v.repo_id
  WHERE e.vector_version = v.version_id
    AND e.repo_id = @repoId
    AND e.embedding <=> @queryVector < @threshold
  ORDER BY e.embedding <=> @queryVector
  LIMIT @limit

Garbage Collection (background, after activation):
  DELETE FROM kap10.entity_embeddings
    WHERE repo_id = @repoId
      AND vector_version != @activeVersionId
      AND vector_version != @newVersionId    -- Safety: don't delete if another index is running
```

**Key properties:**
- **Zero downtime:** Read queries always hit the active version. During indexing, reads see the old (complete) data. After activation, reads instantly see new data.
- **Atomic switchover:** A single `UPDATE` flips the pointer — no partial state possible.
- **Safe rollback:** If indexing fails, the pending version is never activated. The old version remains active. The failed vectors are garbage-collected.
- **Concurrent indexing:** If two indexing workflows run simultaneously (shouldn't happen with debouncing, but safety-first), each writes to its own version. The last to complete wins the activation.

**Configuration:**
- `VECTOR_GC_DELAY_MINUTES` env var (default: 30 — wait before garbage-collecting old vectors, in case of rollback)

### Location-Agnostic Semantic Fingerprinting

**Problem:** When a developer refactors code by moving a file (e.g., `src/utils/auth.ts` → `src/core/security/auth.ts`), Git registers this as a deletion + addition. If kap10 blindly follows Git, it deletes the old ArangoDB node and creates a new one — wiping out all Phase 4 justifications, Phase 5.5 Prompt Ledger history, and learned rules tied to that entity's ID.

**Solution:** Implement **Semantic Fingerprinting** during extraction. The entity identity in ArangoDB should not be tied solely to the file path. Generate a SHA-256 hash of the entity's AST structure (ignoring whitespace, comments, and variable names). During an incremental index, if Temporal sees a "deletion" and an "addition" in the same push with identical semantic fingerprints, it executes an `entityMoveActivity` instead — updating the `filePath` property of the existing node while preserving all historical intelligence.

```
Semantic Fingerprinting Algorithm:

Extraction (per entity):
  1. Parse entity body into AST (via ast-grep or tree-sitter)
  2. Strip:
     - All comments and documentation strings
     - All whitespace and formatting
     - Variable names (replace with positional placeholders: $0, $1, $2...)
     - String literal values (replace with "")
  3. Serialize the stripped AST to a canonical string form
  4. Compute: semanticFingerprint = SHA-256(canonicalAstString)[0..16]
     (16 hex chars, same length as entityHash)
  5. Store on entity document:
     { ..., semantic_fingerprint: "a1b2c3d4e5f6g7h8" }

Move Detection (during entity diff):
  After computing EntityDiff { added, deleted }:

  1. Build fingerprint maps:
     deletedByFingerprint = Map<fingerprint, EntityRecord>
     addedByFingerprint = Map<fingerprint, EntityRecord>

  2. For each fingerprint in addedByFingerprint:
     if fingerprint in deletedByFingerprint:
       → MOVE DETECTED
       oldEntity = deletedByFingerprint[fingerprint]
       newEntity = addedByFingerprint[fingerprint]

       // Instead of delete + add:
       Execute entityMoveActivity:
         a) Update oldEntity's filePath → newEntity.filePath
         b) Update oldEntity's start_line → newEntity.start_line
         c) Preserve: _key, all edges, justifications, ledger history, rules
         d) Re-link file edges (old file → new file)
         e) Log: "Entity move detected: {name} from {oldPath} to {newPath}"

       Remove from added[] and deleted[] (handled by move, not add/delete)

  3. Remaining added[] and deleted[] entities proceed through normal pipeline

Edge Cases:
  - MOVE + MODIFY: If fingerprint has minor differences (threshold <10% AST nodes changed),
    still treat as move with update. If >10% different, treat as delete + add.
  - SPLIT: One entity becomes two (refactored into smaller functions). No fingerprint match.
    Treated as delete + 2 adds. Callers cascade normally.
  - MERGE: Two entities become one. Two deletions match one addition by fingerprint (ambiguous).
    Pick the closest match by name similarity. Second deletion is a true delete.
```

**Why this preserves history:** The entity `_key` in ArangoDB stays the same after a move. All edges (`calls`, `imports`, `justified_by`, `ledger` entries) reference this `_key`. By updating only the `filePath` and `start_line` fields, the entire graph topology and history remain intact. The entity's justification, prompt ledger entries, learned rules, and embeddings all survive the refactor.

### Dead-Letter Quarantine for Corrupted Code

**Problem:** If a developer accidentally pushes a corrupted file (a massive minified JS bundle they forgot to `.gitignore`, or a file with catastrophic syntax errors), the `ast-grep` Temporal worker will crash or hang, potentially stalling the entire indexing queue for that organization.

**Solution:** Wrap the Temporal `reIndexBatch` activity in a strict timeout and catch block. If parsing fails (or hits a memory/time limit), generate a generic quarantined node in ArangoDB instead of retrying infinitely.

```
Quarantine Pattern:

Activity: reIndexBatch (with quarantine wrapper)
  For each file in batch:
    try {
      // Existing extraction logic with strict limits:
      timeout = QUARANTINE_TIMEOUT (default: 30s per file)
      maxFileSize = QUARANTINE_MAX_FILE_SIZE (default: 5MB)

      if (fileSize > maxFileSize) throw QuarantineError("File too large")

      entities = await extractWithTimeout(file, timeout)
      // Normal processing continues...

    } catch (error) {
      if (error instanceof QuarantineError || error instanceof TimeoutError) {
        // Generate quarantined node:
        quarantineEntity = {
          kind: "file",
          name: file.path,
          file_path: file.path,
          is_quarantined: true,
          quarantine_reason: error.message,
          quarantine_timestamp: new Date().toISOString(),
          body: null,           // No parsed content
          signature: null,
          start_line: 0,
          end_line: 0,
          semantic_fingerprint: null
        }

        // Insert quarantined node (no edges — treated as opaque blob)
        await graphStore.upsertEntity(orgId, quarantineEntity)

        // Log to index_event
        extractionErrors.push({
          filePath: file.path,
          reason: error.message,
          quarantined: true
        })

        // Continue processing remaining files (don't abort batch)
        continue
      }
      throw error  // Re-throw non-quarantine errors
    }

MCP Tool Behavior:
  When a tool queries a quarantined entity:
    response._meta.quarantineWarning =
      "⚠️ This file is quarantined due to parsing limits ({reason}).
       Treat it as an opaque blob — do not infer structure or dependencies."

  When search returns a quarantined entity:
    Mark with quarantine badge in results
    Rank below non-quarantined entities
```

**Configuration:**
- `QUARANTINE_TIMEOUT` env var (default: `30s` — per-file extraction timeout)
- `QUARANTINE_MAX_FILE_SIZE` env var (default: `5242880` — 5MB, files larger than this are auto-quarantined)

**Self-healing:** When a previously quarantined file is pushed again with valid content (e.g., the developer adds it to `.gitignore` and pushes the correct version), the incremental index detects the file modification, re-extracts successfully, and removes the `is_quarantined` flag. The entity returns to normal operation.

### Recommended Package Integrations

Phase 5 leverages enterprise-grade open-source TypeScript packages to avoid reinventing core infrastructure:

| Package | Purpose | Integration Point |
|---|---|---|
| **`@ast-grep/napi`** | Zero-overhead Rust bindings for AST parsing in Node.js. Used for semantic AST diffing and semantic fingerprinting directly in Temporal workers, avoiding CLI subprocess overhead. | `lib/indexer/ast-comparator.ts`, `lib/indexer/semantic-fingerprint.ts` |
| **`@octokit/webhooks`** | Strongly-typed GitHub webhook handling with HMAC SHA-256 validation. Provides TypeScript intellisense for all event payloads (push, installation, etc.). Replaces hand-written crypto validation. | `app/api/webhooks/github/route.ts` |
| **`smee-client`** | Open-source webhook proxy (maintained by GitHub) for local development. Uses SSE to stream GitHub webhooks to `localhost:3000`. Eliminates Ngrok dependency. | `docker-compose.yml` (dev profile), dev docs |
| **`graphology` + `graphology-metrics`** | In-memory directed graph with centrality algorithms. Used for real-time PageRank/betweenness centrality without locking ArangoDB. Pull sub-graph → compute in memory → return score. | `lib/indexer/centrality.ts` |
| **`@temporalio/workflow` signals** | Native Temporal primitives (`defineSignal`, `condition`, `sleep`) for commit storm debouncing. No external queue (RabbitMQ, Redis pub/sub) needed. | `lib/temporal/workflows/incremental-index.ts` |

### Cascade Re-Justification Logic

Phase 5 triggers Phase 4's `justifyEntityWorkflow` for entities whose business context may have changed. The cascade algorithm incorporates the AST noise filter and centrality bounding:

```
Cascade Re-Justification Algorithm:

Input: Set of changed entity keys (added, modified, deleted)
Config: MAX_HOPS = 2, MAX_CASCADE_ENTITIES = 50, SIGNIFICANCE_THRESHOLD = 0.3,
        CENTRALITY_THRESHOLD = 50

0. AST noise filter (pre-step):
   For each MODIFIED entity:
     Run AstComparator: compare old vs new AST (ignoring comments/whitespace)
     If AST unchanged → remove from changed set (no semantic change)
   Log: "AST filter removed N of M modified entities (non-semantic changes)"

1. Direct re-justification (hop 0):
   For each MODIFIED entity (after AST filter):
     a) Compute new code embedding (from updated entity body)
     b) Fetch old justification embedding from pgvector
     c) If cosine_distance(old_justification_emb, new_code_emb) > SIGNIFICANCE_THRESHOLD:
        → Add to re-justify queue
     d) If entity has no existing justification (new to Phase 4):
        → Add to re-justify queue unconditionally
   For each ADDED entity:
     → Add to re-justify queue unconditionally (new entity, needs justification)

2. Centrality bounding (pre-cascade):
   For each entity in re-justify queue:
     Query inbound edge count from ArangoDB call graph
     If inboundCount > CENTRALITY_THRESHOLD:
       → Mark as hub node
       → Re-justify this entity ONLY (no caller cascade)
       → Remove from cascade candidate set
       → Log: "Hub node {entityName}: {inboundCount} callers — cascade suppressed"

3. Cascade (hop 1):
   For each NON-HUB entity in re-justify queue:
     a) Fetch 1-hop callers from ArangoDB call graph
     b) For each caller:
        - Check caller.justification.updated_at
        - If updated < 5 minutes ago: skip (recently re-justified)
        - Else: add caller to cascade queue

4. Cascade (hop 2, optional):
   If cascade queue size < MAX_CASCADE_ENTITIES / 2:
     For each entity added in hop 1:
       Fetch 1-hop callers → add to cascade queue (same skip logic)

5. Cap enforcement:
   If total re-justify + cascade > MAX_CASCADE_ENTITIES:
     Prioritize by: deleted callee's callers > modified callee's callers > hop 2
     Truncate to MAX_CASCADE_ENTITIES

6. Execute:
   For each entity in (re-justify queue + cascade queue):
     Start justifyEntityWorkflow (Phase 4, idempotent by workflow ID)
     Pass: entity key, existing callee context, canonical value seeds from repo

7. Feature aggregation:
   After all justifyEntityWorkflow instances complete:
     If any entity's feature_area changed:
       Run aggregateFeatures (Phase 4 reusable activity) for affected features

8. Cost tracking:
   Log all LLM calls to token_usage_log with workflow_id = incrementalIndexWorkflow ID
   Log: "Cascade stats: {astFiltered} AST-filtered, {hubsSuppressed} hub-suppressed,
         {cascaded} cascaded, {total} total LLM calls"
```

**Cost model for cascade re-justification (with AST filter + centrality bounding):**

| Push size | Entities changed | After AST filter (avg) | After centrality filter | Entities re-justified | Est. cost |
|---|---|---|---|---|---|
| Small (1-3 files) | 5–15 entities | 3–10 (semantic only) | 3–10 (no hubs typical) | 3–15 (direct + 1-hop) | ~$0.005 |
| Medium (5-10 files) | 20–80 entities | 10–50 (semantic only) | 8–45 (hubs excluded) | 10–45 (capped) | ~$0.03 |
| Large (20+ files) | 100+ entities | 40–80 (semantic only) | 30–60 (hubs excluded) | 30–50 (capped) | ~$0.06 |
| Prettier/format run (any size) | 10–500 entities | **0** (all non-semantic) | — | **0** | **$0.00** |
| Hub utility change (e.g., logger) | 1 entity, 2000 callers | 1 (semantic) | **1** (hub suppressed) | **1** | ~$0.001 |
| Force push (full) | All entities | N/A (full re-justify) | N/A | Full re-justify (Phase 4) | $1-16 |

### ArangoDB Collection — index_events

Phase 5 adds one new document collection for the activity feed:

```
org_{org_id}/
  └── index_events              (document collection — append-only activity feed)
      _key: "evt_{UUID}"
      Fields:
        org_id           String
        repo_id          String
        push_sha         String    — the "after" SHA from the push event
        commit_message   String    — first commit message (truncated to 200 chars)
        event_type       String    — "incremental" | "full_reindex" | "force_push_reindex"
        files_changed    Number    — count of files in the incremental window
        entities_added   Number    — count of new entities inserted
        entities_updated Number    — count of entities with content changes
        entities_deleted Number    — count of entities removed
        edges_repaired   Number    — count of edges created/deleted during repair
        embeddings_updated Number  — count of embeddings re-generated
        cascade_status   String    — "none" | "pending" | "running" | "complete" | "skipped"
        cascade_entities Number    — count of entities that were cascade re-justified
        duration_ms      Number    — total workflow duration
        workflow_id      String    — Temporal workflow ID (for status queries)
        created_at       String    — ISO 8601

      Indexes:
        persistent on (repo_id, org_id, created_at DESC)  — feed queries
        TTL on created_at (90 days)                       — auto-cleanup
```

### Supabase Schema Changes

Phase 5 adds two columns to `kap10.repos`:

```
ALTER TABLE kap10.repos ADD COLUMN webhook_secret TEXT;
  -- Per-repo webhook secret for signature validation (optional — falls back to global GITHUB_WEBHOOK_SECRET)

ALTER TABLE kap10.repos ADD COLUMN incremental_enabled BOOLEAN DEFAULT true;
  -- Feature flag: disable incremental indexing per-repo (force full re-index on every push)
```

The existing `last_indexed_sha` column (already in Prisma schema but never updated) is now actively maintained by the `pullAndDiff` activity.

---

## 1.3 Reliability & Resilience

### Failure Scenario Matrix

| # | Failure Scenario | Probability | Impact | Detection | Recovery Strategy |
|---|---|---|---|---|---|
| 1 | **GitHub webhook delivery failure** — GitHub can't reach our endpoint | Medium | Push goes unnoticed. Index stale. | GitHub shows delivery failure in App settings. No corresponding index_event. | GitHub retries webhooks 3× with exponential backoff (10s, 60s, 300s). If all fail: user can manually trigger re-index from dashboard. Also: periodic reconciliation job (every 15 min) compares `lastIndexedSha` with GitHub's latest SHA — if diverged, triggers incremental workflow. |
| 2 | **Webhook signature validation failure** — invalid or missing signature | Low | Legitimate push rejected. | 401 response logged. | Return HTTP 401 and log the event. Do NOT process. If recurring: check GITHUB_WEBHOOK_SECRET rotation. Dashboard shows "webhook auth error" alert. |
| 3 | **Webhook replay/duplication** — GitHub delivers same webhook twice | Medium | Same push processed twice. | Redis dedup key (delivery ID, TTL 24h). | Second delivery silently ignored (Redis set check). Temporal's workflow ID dedup provides a second layer — same SHA produces same workflow ID. |
| 4 | **Persistent workspace corrupted** — disk full, git state broken | Low | `git pull` fails. Workflow fails. | `git pull` returns non-zero exit code. | Retry: `git fetch --prune && git reset --hard origin/{branch}`. If still fails: delete workspace directory and fall back to full re-index (Phase 1 `prepareWorkspace` recreates it). |
| 5 | **SCIP/Tree-sitter extraction fails** for a single file | Medium | That file's entities not updated. Others proceed. | Activity throws `ExtractionError`. | Skip the failed file. Log to index_event as `extraction_errors: [filePath]`. Other files in the push continue processing. Dashboard shows "1 file failed extraction" warning. |
| 6 | **ArangoDB write conflict** during applyEntityDiffs | Low | Some entities not updated. | ArangoDB returns conflict error (409). | Retry the batch write 3× with 1s backoff. If conflict persists: fall back to individual document writes (1 at a time) to isolate the problematic document. |
| 7 | **Embedding generation fails** (nomic model unavailable) | Low | Entities indexed but not searchable via semantic search. | `IVectorSearch.embed()` throws error. | Skip embedding. Entities are still in ArangoDB (keyword search works). Log to index_event with `embedding_errors`. Next incremental push will retry embedding for those entities. |
| 8 | **Cascade re-justification overwhelms LLM budget** | Medium | LLM costs spike. Token budget exceeded. | Cost tracked in `token_usage_log`. Budget check before each LLM call. | Cap at MAX_CASCADE_ENTITIES (50). If monthly budget exceeded: skip cascade, mark as `cascade_status: "skipped"`. Dashboard shows "Re-justification skipped (budget exceeded)" warning. |
| 9 | **SHA gap: `before` doesn't match `lastIndexedSha`** | Medium | Git history diverged. Incremental diff unreliable. | SHA comparison in webhook handler. | Fall back to full re-index (Flow 3). This is safe but slow. Common causes: force push, direct push to default branch while incremental workflow is running. |
| 10 | **Rapid pushes create workflow pile-up** | Medium | Multiple workflows competing for same workspace. | Temporal shows queued workflows. | Workflow ID includes SHA → each push gets unique workflow. Sequential execution enforced: `pullAndDiff` acquires a per-repo file lock (or Temporal workflow ID serialization). If a workflow finds `lastIndexedSha` already advanced past its `before`, it re-diffs from the current `lastIndexedSha`. |
| 11 | **Large push (100+ files changed)** | Low–Medium | Workflow takes >30s target. Many activities. | Heartbeat monitoring. | Batch file processing: 10 files per activity invocation (not 1 per activity). This reduces Temporal overhead. If >200 files changed: fall back to full re-index (incremental advantage diminishes beyond this threshold). |
| 12 | **Feature branch push when only default branch is configured** | High | Unnecessary processing. Wasted compute. | Push ref doesn't match `refs/heads/{defaultBranch}`. | Webhook handler checks: `payload.ref === "refs/heads/" + repo.defaultBranch`. Non-default branch pushes are silently dropped. Configurable: future enhancement allows per-branch tracking. |

### Webhook Security

GitHub webhook validation is critical — the endpoint is public and receives POST requests from the internet:

```
Webhook Validation Protocol:

1. Extract x-hub-signature-256 header
2. Compute HMAC-SHA256 of raw request body using GITHUB_WEBHOOK_SECRET
   (or per-repo webhook_secret if configured)
3. Timing-safe comparison: crypto.timingSafeEqual(expected, received)
4. If mismatch: return 401 immediately. Do NOT process payload.
5. If match: parse JSON body and proceed.

CRITICAL: Validate BEFORE parsing JSON. A malicious actor could send
crafted payloads to trigger expensive Temporal workflows if signature
validation is skipped.
```

### Reconciliation Job (Self-Healing)

A periodic background job ensures the index doesn't silently drift:

```
Reconciliation Job (runs every 15 minutes via Temporal cron workflow):

For each repo where status == "ready":
  1. Fetch latest commit SHA from GitHub API:
     GET /repos/{owner}/{repo}/commits/{defaultBranch}
     → latestSha

  2. Compare with lastIndexedSha in Supabase

  3. If latestSha != lastIndexedSha:
     a) Check if an incrementalIndexWorkflow is currently running
        (query Temporal by workflow ID prefix)
     b) If no workflow running:
        Start incrementalIndexWorkflow with before=lastIndexedSha, after=latestSha
        Log: "Reconciliation triggered incremental re-index (missed webhook)"
     c) If workflow already running: skip (will catch up)

  4. Rate limit: max 10 reconciliation triggers per 15-min cycle
     (prevent thundering herd if many repos drift simultaneously)
```

---

## 1.4 Performance Considerations

### Latency Budgets

| # | Path | Target | Breakdown | Bottleneck | Mitigation |
|---|---|---|---|---|---|
| 1 | **Small push (1-3 files) → MCP reflects changes** | < 15s | Webhook receipt (~100ms) + git pull (~1s) + git diff (~100ms) + SCIP/TS extraction per file (~2s) + entity diff (~100ms) + ArangoDB writes (~500ms) + embedding (~2s) + cache invalidation (~100ms) | SCIP extraction per file (~2s for complex files). Embedding generation (~2s for batch of 10 entities). | Parallelize: extraction and embedding run concurrently where possible. SCIP is the floor — can't speed up AST analysis. |
| 2 | **Medium push (5-10 files)** | < 30s | Same as above but fan-out across 5-10 files. 10 files × 2s extraction / 5 parallel = 4s. Embedding batch for ~50 entities (~3s). ArangoDB batch write (~1s). | File extraction parallelism limited by CPU cores on heavy worker. | Batch files in groups of 5 per activity. 2 concurrent activities = 10 files in 2 batches. |
| 3 | **Large push (20+ files)** | < 60s or fallback to full | 20 files × 2s / 5 parallel = 8s. But entity diff complexity grows. Edge repair for 100+ entities. | Cross-file edge repair: finding all affected edges requires graph traversal. | If >200 files changed: fall back to full re-index (faster than incremental at that scale). Edge repair uses batch AQL queries, not per-entity lookups. |
| 4 | **Cascade re-justification** | < 60s (async, not blocking MCP) | LLM call per entity (~2s) × up to 50 entities / 10 concurrency = ~10s. But async — doesn't block the primary indexing. | LLM throughput. | Cascade runs AFTER primary indexing completes. MCP queries reflect code changes immediately; justification updates arrive shortly after. |
| 5 | **Webhook handler response** | < 500ms | Signature validation (~5ms) + Redis dedup check (~5ms) + repo lookup (~20ms) + Temporal workflow start (~50ms) | Must return 200 quickly to avoid GitHub webhook timeout (10s). | Webhook handler is fire-and-forget: validate, start workflow, return 200. All processing is async in Temporal. |
| 6 | **get_recent_changes MCP tool** | < 200ms | ArangoDB index_events query (~50ms) + entity enrichment (~100ms) | Index scan if no proper index on (repo_id, created_at). | Persistent index on `(repo_id, org_id, created_at DESC)`. Limit results to 50. |
| 7 | **Activity feed API** | < 300ms | ArangoDB index_events (~50ms) + Temporal workflow status query (~100ms for in-flight workflows) | Temporal query for running workflows adds latency. | Cache in-flight workflow status in Redis (TTL 5s). Don't query Temporal on every API call. |

### Batching Strategy

```
File Processing Batches:

Files per activity: 5 (configurable via INCREMENTAL_BATCH_SIZE env var)
  → Reduces Temporal activity overhead (each activity has ~200ms scheduling cost)
  → 10 files = 2 activities (not 10 activities)

Entity diff batch write: All diffs for all files collected, then applied in ONE
  ArangoDB transaction (or batched `:put` / `:rm` operations).
  → Avoids partial updates if workflow fails mid-way

Embedding batch: All added/modified entities embedded in a single batch call
  → Reuses Phase 3 batch embedding logic (groups of 100 entities)
```

### Workspace Locking

Only one incremental indexing workflow should operate on a workspace at a time (concurrent `git pull` on the same directory = corruption):

```
Workspace Locking Strategy:

Option A (Temporal-native, preferred):
  Workflow ID: incr-{orgId}-{repoId}-{sha_short}
  Conflict policy: WORKFLOW_ID_CONFLICT_POLICY_USE_EXISTING
  → Different SHAs = different workflow IDs = both can start
  → BUT: per-repo serialization via a semaphore signal

Option B (file lock):
  pullAndDiff acquires /data/workspaces/{orgId}/{repoId}/.kap10.lock
  If lock held: wait up to 30s, then fail (Temporal retries)

Chosen: Option A with Temporal signals.
  Use a separate "workspace-gate" workflow per repo that serializes all
  workspace operations. incrementalIndexWorkflow sends a signal to the gate
  and waits for permission before running pullAndDiff.
```

---

## 1.5 Phase Bridge → Phase 5.5 & Phase 6

Phase 5 establishes the real-time indexing pipeline that Phase 5.5 (Prompt Ledger) and Phase 6 (Pattern Enforcement) directly consume.

### What Phase 5.5 Consumes from Phase 5

| Phase 5 artifact | Phase 5.5 usage |
|---|---|
| **index_events collection** | Phase 5.5's `ledger` collection links ledger entries to index events. When `sync_local_diff` detects a push, it cross-references the index event to show which entities were affected by the AI's changes. |
| **incrementalIndexWorkflow** | Phase 5.5's `kap10 push` (local CLI) triggers the same workflow with `provider: "local_cli"`. The workflow's `pullAndDiff` activity gains a conditional branch: if local_cli, download zip from Supabase Storage instead of `git pull`. |
| **lastIndexedSha tracking** | Phase 5.5's incremental CLI push (future) can send only diffs, using `lastIndexedSha` as the baseline. |
| **Reconciliation job** | Phase 5.5 extends reconciliation to also check local repos for staleness (drift threshold). |

### What Phase 6 Consumes from Phase 5

| Phase 5 artifact | Phase 6 usage |
|---|---|
| **Webhook push handling** | Phase 6's `detectPatternsWorkflow` can be triggered after incremental indexing completes (chain trigger, same pattern as Phase 3→4). Only re-scans changed files for pattern violations. |
| **Entity diff (added/modified/deleted)** | Phase 6 only needs to re-run ast-grep and Semgrep on ADDED and MODIFIED files — not the entire repo. The entity diff drives this scoping. |
| **index_events.cascade_status** | Phase 6's pattern enforcement runs AFTER cascade re-justification completes (it needs updated justifications to check for architecture drift patterns). |

### What Phase 5 Must NOT Do (to avoid rework)

1. **Do not couple incremental indexing to a specific git host.** The `pullAndDiff` activity must be generic enough that Phase 5.5 can swap `git pull` for "download zip + extract" without changing the diff logic.
2. **Do not delete workspace directories after indexing.** Phase 5.5's `kap10 watch` needs the workspace to exist persistently for ledger operations. Phase 5's reconciliation job should NOT clean up workspaces.
3. **Do not hard-code the cascade trigger.** Phase 6 needs to chain pattern detection after indexing. Use an extensible post-indexing hook pattern: `onIncrementalIndexComplete(repoId, entityDiff)` that Phase 5.5 and Phase 6 can subscribe to.
4. **Do not assume push is the only trigger.** Phase 5.5 adds local CLI push. Phase 7 adds PR review. Both trigger incremental indexing with different input sources but the same entity diff pipeline.

### Schema Forward-Compatibility

- **`index_events.event_type`:** Phase 5.5 adds `"local_cli_push"`. Phase 7 adds `"pr_review"`. Use String (not enum) to avoid migrations.
- **`repos.incremental_enabled`:** Phase 5.5 respects this flag for local repos too.
- **`repos.last_indexed_sha`:** Phase 5.5's local repos use a content hash instead of a git SHA (no git history). The field must accept arbitrary strings, not just hex SHA.

### Infrastructure Forward-Compatibility

- **Temporal workflow IDs:** Phase 5.5 reuses `incr-{orgId}-{repoId}-{identifier}` pattern. For local repos, `identifier` is a content hash, not a git SHA.
- **heavy-compute-queue:** Phase 5's extraction activities share the queue with Phase 1. Phase 6's ast-grep/Semgrep activities also run here. Queue is pre-configured.
- **light-llm-queue:** Cascade re-justification runs here. Phase 6's LLM rule synthesis also runs here. No changes needed.

---

# Part 2: Implementation & Tracing Tracker

## 2.1 Infrastructure Layer

### Environment & Configuration

- [x] **P5-INFRA-01: Add Phase 5 env vars to `env.mjs`** — S
  - New variables: `INCREMENTAL_BATCH_SIZE` (default: 5, max: 20), `CASCADE_MAX_HOPS` (default: 2, max: 3), `CASCADE_MAX_ENTITIES` (default: 50, max: 200), `CASCADE_SIGNIFICANCE_THRESHOLD` (default: 0.3), `CASCADE_CENTRALITY_THRESHOLD` (default: 50, min: 10, max: 500 — entities with more inbound callers than this are classified as hub nodes and exempt from caller-cascade), `AST_DIFF_ENABLED` (default: true — enable/disable the ast-grep semantic noise filter), `RECONCILIATION_INTERVAL_MINUTES` (default: 15, min: 5), `INCREMENTAL_FALLBACK_THRESHOLD` (default: 200 — files changed above this → full re-index), `DEBOUNCE_QUIET_PERIOD` (default: "60s", min: "10s", max: "300s" — signal debouncing quiet period; 0 disables), `BRANCH_INDEXING_ENABLED` (default: false — enable feature branch shadow graph indexing), `BRANCH_INDEXING_PATTERN` (default: "*" — glob pattern for which branches to index), `DRIFT_ALERT_ENABLED` (default: true — enable proactive semantic drift alerting), `DRIFT_ALERT_CALLER_THRESHOLD` (default: 10 — minimum callers for drift alerting), `DRIFT_ALERT_CHANNEL` (default: "dashboard" — options: "dashboard", "github_issue", "both"), `VECTOR_GC_DELAY_MINUTES` (default: 30 — delay before garbage-collecting old vector versions), `QUARANTINE_TIMEOUT` (default: "30s" — per-file extraction timeout before quarantining), `QUARANTINE_MAX_FILE_SIZE` (default: 5242880 — 5MB, files larger are auto-quarantined)
  - All optional with sensible defaults. Phase 5 works with zero additional configuration.
  - **Test:** `pnpm build` succeeds. Default values used when env vars missing. Invalid values (negative, > max) produce clear error.
  - **Depends on:** Nothing
  - **Files:** `env.mjs`, `.env.example`
  - Notes: _____

- [x] **P5-INFRA-02: Update `.env.example` with Phase 5 variables** — S
  - Document all new variables with comments explaining cascade behavior and thresholds
  - Add comment block: "Phase 5: Incremental Indexing — these are optional, defaults are production-ready"
  - **Test:** `cp .env.example .env.local` + fill → incremental pipeline functional.
  - **Depends on:** P5-INFRA-01
  - **Files:** `.env.example`
  - Notes: _____

---

## 2.2 Database & Schema Layer

- [x] **P5-DB-01: Create `index_events` ArangoDB collection** — M
  - Collection: `index_events` (document, append-only activity feed)
  - Fields: org_id, repo_id, push_sha, commit_message, event_type, files_changed, entities_added, entities_updated, entities_deleted, edges_repaired, embeddings_updated, cascade_status, cascade_entities, duration_ms, workflow_id, extraction_errors (array of failed file paths), created_at
  - Indexes:
    - Persistent on `(repo_id, org_id, created_at)` — feed queries with time ordering
    - TTL on `created_at` (90 days) — auto-cleanup
  - Create within `bootstrapGraphSchema()` (extend existing method)
  - **Test:** `bootstrapGraphSchema()` creates collection. Insert event → read back. TTL index active. Query by repo_id + time range works.
  - **Depends on:** Nothing
  - **Files:** `lib/adapters/arango-graph-store.ts`
  - **Acceptance:** Collection created with indexes. TTL auto-expiry verified.
  - Notes: _____

- [x] **P5-DB-02: Add `webhook_secret` and `incremental_enabled` columns to Repo model** — S
  - New columns on `kap10.repos`: `webhook_secret` (String?, null = use global secret), `incremental_enabled` (Boolean, default true)
  - Prisma migration. Existing repos get defaults (null, true).
  - **Test:** Migration runs. Existing repos get default values. New repos can set webhook_secret.
  - **Depends on:** Nothing
  - **Files:** `prisma/schema.prisma`, new migration file
  - **Acceptance:** Columns exist. Default values correct. No impact on existing queries.
  - Notes: _____

- [x] **P5-DB-03: Add `indexEvent` CRUD methods to `ArangoGraphStore`** — S
  - New methods: `insertIndexEvent(orgId, event)`, `getIndexEvents(orgId, repoId, options: { since?, limit?, eventType? })`, `getLatestIndexEvent(orgId, repoId)`
  - **Test:** Insert 10 events → query by time range returns correct subset. getLatest returns most recent.
  - **Depends on:** P5-DB-01
  - **Files:** `lib/ports/graph-store.ts` (interface additions), `lib/adapters/arango-graph-store.ts`
  - **Acceptance:** CRUD works. Time-range filtering works. Limit parameter respected.
  - Notes: _____

- [x] **P5-DB-04: Ensure `lastIndexedSha` is updated by indexing activities** — S _(NOT YET: indexing-light.ts and index-repo.ts do not pass lastIndexedSha to updateRepoStatus)_
  - The existing `updateRepoStatus` method already accepts `lastIndexedSha` parameter but the indexing workflow never passes it
  - Fix: Phase 1's `finalizeIndexing` activity (formerly `writeToArango`) and Phase 5's `applyEntityDiffs` activity must pass `lastIndexedSha` when updating repo status
  - **Test:** Full index → `lastIndexedSha` populated. Incremental index → `lastIndexedSha` updated to push `after` SHA. Verify via `getRepo()`.
  - **Depends on:** Nothing
  - **Files:** `lib/temporal/activities/indexing-light.ts` (modify), `lib/temporal/workflows/index-repo.ts` (modify)
  - **Acceptance:** `lastIndexedSha` correctly maintained after every index operation.
  - Notes: _____

---

## 2.3 Ports & Adapters Layer

### IGraphStore — Phase 5 Additions

- [x] **P5-ADAPT-01: Implement entity-by-file query methods on `ArangoGraphStore`** — M
  - New methods: `getEntitiesByFile(orgId, repoId, filePath)` → returns all entities for a file with their hashes, `getEdgesForEntities(orgId, entityKeys[])` → returns all edges involving these entities, `batchDeleteEntities(orgId, entityKeys[])` → delete entities + all their edges, `batchDeleteEdgesByEntity(orgId, entityKeys[])` → delete edges referencing these entities
  - These methods enable the entity diff algorithm to load old entities for comparison and efficiently delete removed entities with their edges.
  - **Test:** Insert 10 entities for a file → `getEntitiesByFile` returns all 10. Delete 3 → edges involving those 3 also gone. Remaining 7 entities and their edges intact.
  - **Depends on:** Nothing
  - **Files:** `lib/ports/graph-store.ts` (interface), `lib/adapters/arango-graph-store.ts`
  - **Acceptance:** File-scoped entity queries work. Batch delete cascades to edges. Multi-tenant isolation.
  - Notes: _____

- [~] **P5-ADAPT-02: Implement scoped cross-file edge repair methods** — M _(Partial: findBrokenEdges implemented; createEdgesForEntity not yet in interface/adapter)_
  - New methods: `findBrokenEdges(orgId, repoId, deletedEntityKeys[])` → returns edges that reference deleted entities, `createEdgesForEntity(orgId, entity, importMap)` → creates call/import/extends edges for a newly added entity
  - Reuses Phase 1's edge creation logic but scoped to specific entities (not full repo scan)
  - **Test:** Delete entity B that entity A calls → `findBrokenEdges` returns the A→B edge. Add entity C → `createEdgesForEntity` creates edges based on C's imports.
  - **Depends on:** P5-ADAPT-01
  - **Files:** `lib/adapters/arango-graph-store.ts`
  - **Acceptance:** Broken edges detected. New edges created. No orphaned edges.
  - Notes: _____

### IGitHost — Phase 5 Additions

- [x] **P5-ADAPT-03: Add `pullLatest` and `diffFiles` methods to GitHub adapter** — M
  - New methods on `IGitHost`: `pullLatest(workspacePath, branch)` → runs `git fetch && git checkout`, `diffFiles(workspacePath, fromSha, toSha)` → returns `ChangedFile[]` with `{ path, changeType: 'added' | 'modified' | 'removed' }`, `getLatestSha(owner, repo, branch, installationId)` → returns latest commit SHA from GitHub API
  - `diffFiles` uses `git diff --name-status {from}..{to}` under the hood
  - `getLatestSha` used by reconciliation job
  - **Test:** Pull on a test workspace → working tree advanced. Diff between two SHAs → correct file list. Added/modified/removed correctly classified.
  - **Depends on:** Nothing
  - **Files:** `lib/ports/git-host.ts` (interface), `lib/adapters/github-host.ts`
  - **Acceptance:** Pull works. Diff returns correct files. Change types accurate.
  - Notes: _____

- [x] **P5-ADAPT-04: Update `InMemoryGitHost` fake for testing** — S
  - Extend the test fake in `lib/di/fakes.ts` to support `pullLatest` and `diffFiles`
  - `diffFiles` returns configurable changed files for testing
  - **Test:** `createTestContainer()` provides working git host with pull and diff.
  - **Depends on:** P5-ADAPT-03
  - **Files:** `lib/di/fakes.ts`
  - Notes: _____

---

## 2.4 Backend / API Layer

### Semantic AST Diffing & Centrality Bounding

- [x] **P5-API-00a: Create AST Comparator module** — M
  - File: `lib/indexer/ast-comparator.ts`
  - `isSemanticChange(oldBody: string, newBody: string, language: string): Promise<boolean>` — returns `true` if AST structure differs (ignoring comments, whitespace, formatting)
  - Uses `ast-grep` CLI via `execFileAsync` with `--pattern` for structural comparison
  - Language-aware: TypeScript, Python, Go grammars. Falls back to `true` (assume semantic change) for unsupported languages.
  - Timeout: 5s per file. On timeout or error, returns `true` (safe fallback — treat as semantic change).
  - **Test:** Whitespace-only change → `false`. Comment-only change → `false`. Import reorder → `false`. Function body logic change → `true`. New parameter added → `true`. ast-grep unavailable → `true` (fallback). Timeout → `true` (fallback).
  - **Depends on:** Nothing (pure utility)
  - **Files:** `lib/indexer/ast-comparator.ts`
  - **Acceptance:** Correctly classifies semantic vs non-semantic changes. Graceful fallback on error.
  - Notes: _____

- [x] **P5-API-00b: Create centrality scoring module** — M
  - File: `lib/indexer/centrality.ts`
  - `getInboundCallerCount(orgId: string, entityKey: string, graphStore: IGraphStore): Promise<number>` — returns count of inbound `calls` edges for an entity
  - `isHubNode(count: number, threshold?: number): boolean` — checks if count exceeds `CENTRALITY_THRESHOLD`
  - AQL query: `RETURN LENGTH(FOR e IN calls FILTER e._to == @entityHandle RETURN 1)`
  - Caches results per workflow execution (entities don't change mid-workflow)
  - **Test:** Entity with 5 callers → not a hub. Entity with 100 callers → hub at default threshold. Custom threshold respected. Cache hit on second query for same entity.
  - **Depends on:** Nothing (queries existing graph)
  - **Files:** `lib/indexer/centrality.ts`
  - **Acceptance:** Correct caller count. Hub classification matches threshold. Cache prevents redundant AQL queries.
  - Notes: _____

- [x] **P5-API-00c: Integrate AST filter + centrality bounding into cascade pipeline** — M
  - Modify `lib/indexer/cascade.ts` to:
    1. Run `AstComparator` on each modified entity before entity diff — remove non-semantic changes from the changed set
    2. Run centrality check on each entity in the re-justify queue before hop 1 — suppress cascade for hub nodes
  - Log filtering stats: `"AST filter removed N of M entities"`, `"Hub nodes suppressed: [entityNames]"`
  - Respect `AST_DIFF_ENABLED` env var (allow disabling the filter)
  - **Test:** Format-only push → zero cascade calls. Hub entity modified → only hub re-justified, callers untouched. AST filter disabled via env → all modified entities proceed to cascade. Mixed push (some semantic, some not) → only semantic changes cascade.
  - **Depends on:** P5-API-00a, P5-API-00b, P5-API-02
  - **Files:** `lib/indexer/cascade.ts` (modify)
  - **Acceptance:** Cascade costs dramatically reduced for format/comment pushes and hub node changes.
  - Notes: _____

### Signal Debouncing & Branch-Aware Indexing

- [x] **P5-API-00d: Implement Temporal Signal Debouncing** — L
  - Refactor `incrementalIndexWorkflow` to use `defineSignal` + `condition` + `sleep` for commit storm absorption
  - Workflow ID changes from per-SHA (`incr-{orgId}-{repoId}-{sha}`) to per-repo (`incr-{orgId}-{repoId}`)
  - Webhook handler uses `signalWithStart` instead of direct workflow start
  - Quiet period configurable via `DEBOUNCE_QUIET_PERIOD` (default 60s)
  - After quiet period expires, batch all accumulated SHAs and diff from `lastIndexedSha` to latest `afterSha`
  - **Test:** 10 rapid pushes within 30s → single indexing run. Quiet period reset on each signal. Debounce disabled with period=0. Workflow survives Temporal server restart (signal history preserved).
  - **Depends on:** P5-API-05
  - **Files:** `lib/temporal/workflows/incremental-index.ts` (refactor), `app/api/webhooks/github/route.ts` (modify — use signalWithStart)
  - **Acceptance:** N pushes within quiet period → 1 workflow execution. No duplicate work. No race conditions.
  - Notes: _____

- [x] **P5-API-00e: Implement Branch-Aware MVCC Shadow Graph** — XL
  - Add `branches: string[]` field to entity and edge documents in ArangoDB (default: `["main"]`)
  - Create `branchOverlayActivity` that diffs feature branch against merge-base with main
  - Shadow entities stored with `branches: ["feature/branch-name"]` — main entities untouched
  - MCP query resolution: UNION of branch entities + main entities (with branch override priority)
  - Branch cleanup: promote on merge, delete on branch deletion
  - Guard: only activates when `BRANCH_INDEXING_ENABLED=true`
  - **Test:** Feature branch push → shadow entities created (main untouched). MCP query with branch context → merged view. Branch merge → entities promoted to main. Branch delete → shadow entities cleaned up. Main-only query unaffected by branch entities.
  - **Depends on:** P5-API-05, P5-ADAPT-01
  - **Files:** `lib/indexer/branch-overlay.ts` (new), `lib/temporal/activities/incremental.ts` (modify), `lib/adapters/arango-graph-store.ts` (modify — branch-aware queries)
  - **Acceptance:** Branch-aware MCP queries return merged graph. Zero performance regression for main-only queries.
  - Notes: _____

### Proactive Drift Alerting & Vector Hot Swapping

- [x] **P5-API-00f: Implement Semantic Drift Alerting** — L
  - New activity: `driftEvaluationActivity` on `light-llm-queue`
  - Triggers after `cascadeReJustify` for entities where justification changed significantly AND caller count > `DRIFT_ALERT_CALLER_THRESHOLD`
  - LLM comparison (gpt-4o-mini, 500 token budget): determines if business intent changed
  - If intent changed: query Git blame for downstream callers' authors, generate alert
  - Alert channels: dashboard notification (always), GitHub Issue (opt-in via `DRIFT_ALERT_CHANNEL`)
  - **Test:** Intent-changing modification to entity with 20 callers → alert generated. Implementation-only change → no alert. Entity with 5 callers (below threshold) → no alert. GitHub Issue created with correct assignees. Dashboard notification created.
  - **Depends on:** P5-API-02 (cascade module), P5-ADAPT-03 (git host for blame)
  - **Files:** `lib/temporal/activities/drift-alert.ts` (new), `lib/temporal/activities/incremental.ts` (modify — chain after cascade)
  - **Acceptance:** Drift alerts fire for genuine semantic changes. No false positives on implementation-only changes.
  - Notes: _____

- [x] **P5-API-00g: Implement Blue/Green pgvector Hot Swapping** — L _(Migration created; adapter-level version-aware read/write deferred to Phase 5.5 when vector search adapter is built out)_
  - Add `vector_version UUID` column to `kap10.entity_embeddings`
  - New table: `kap10.active_vector_versions` (repo_id PK, version_id UUID)
  - Write path: all embedding INSERTs use a per-workflow version_id
  - Activation: single atomic `UPDATE` flips active version after workflow success
  - Read path: semantic search JOINs on `active_vector_versions` to filter
  - Garbage collection: background job deletes non-active versions after `VECTOR_GC_DELAY_MINUTES`
  - Supabase migration for schema changes
  - **Test:** Indexing in progress → search returns old (complete) results. After activation → search returns new results. Failed indexing → old version stays active. GC removes old vectors after delay. Concurrent indexing → last to complete wins.
  - **Depends on:** Phase 3 embedding pipeline
  - **Files:** `supabase/migrations/2026XXXX_phase5_blue_green_vectors.sql` (new), `lib/adapters/llamaindex-vector-search.ts` (modify — version-aware read/write), `lib/temporal/activities/incremental.ts` (modify — version activation)
  - **Acceptance:** Zero-downtime embedding updates. No partial/fragmented search results during indexing.
  - Notes: _____

### Entity Move Detection & Quarantine

- [x] **P5-API-00h: Implement Semantic Fingerprinting for Move Detection** — L
  - New module: `lib/indexer/semantic-fingerprint.ts`
  - `computeSemanticFingerprint(body, language): string` — strip comments/whitespace/variable names from AST, SHA-256 hash the canonical form
  - Add `semantic_fingerprint` field to entity documents in ArangoDB
  - Integrate into entity diff: after computing added/deleted sets, cross-check fingerprints to detect moves
  - On move detected: `entityMoveActivity` updates `filePath` and `start_line` on existing entity (preserves _key, edges, history)
  - Uses `@ast-grep/napi` for AST stripping
  - **Test:** File moved (same content) → entity `_key` preserved, filePath updated, edges intact. Move + minor modification → still detected as move. Split (1→2) → no false match. Merge (2→1) → best match by name similarity. Justifications survive move.
  - **Depends on:** P5-API-01 (entity diff), P5-API-00a (AST comparator)
  - **Files:** `lib/indexer/semantic-fingerprint.ts` (new), `lib/indexer/incremental.ts` (modify — integrate fingerprint matching)
  - **Acceptance:** File moves preserve entity history. Zero data loss on refactors.
  - Notes: _____

- [x] **P5-API-00i: Implement Dead-Letter Quarantine for Corrupted Code** — M
  - Wrap `reIndexBatch` per-file extraction in timeout + catch block
  - On extraction failure or timeout: generate quarantined entity with `is_quarantined: true`, `quarantine_reason`, no edges
  - Files exceeding `QUARANTINE_MAX_FILE_SIZE` auto-quarantined before parsing
  - MCP tools attach `_meta.quarantineWarning` when returning quarantined entities
  - Self-healing: re-push of valid content removes quarantine flag
  - **Test:** Minified 10MB JS file → quarantined (not crashed). Syntax error file → quarantined with reason. Remaining files in batch continue processing. MCP search shows quarantine badge. Valid re-push → quarantine removed. Worker queue not stalled by corrupted files.
  - **Depends on:** P5-API-06 (Temporal activities)
  - **Files:** `lib/temporal/activities/incremental.ts` (modify), `lib/mcp/tools/search.ts` (modify — quarantine warning)
  - **Acceptance:** Corrupted files never stall the indexing queue. Quarantined entities clearly flagged in MCP responses.
  - Notes: _____

### Core Incremental Indexing Pipeline

- [x] **P5-API-01: Create entity diff module** — M
  - File: `lib/indexer/incremental.ts`
  - `diffEntitySets(oldEntities, newEntities)` → `EntityDiff { added, updated, deleted }`
  - Compares by entity hash (identity-based, not content-based)
  - For "updated" entities: detects whether content actually changed (body or signature)
  - **Test:** Same entities → empty diff. New entity → added. Removed entity → deleted. Changed body → updated. Unchanged → skipped. Renamed function → delete old + add new.
  - **Depends on:** Nothing (pure algorithm)
  - **Files:** `lib/indexer/incremental.ts`
  - **Acceptance:** Diff algorithm correct. All edge cases handled. No false positives.
  - Notes: _____

- [x] **P5-API-02: Create cascade re-justification module** — L
  - File: `lib/indexer/cascade.ts`
  - `buildCascadeQueue(changedEntityKeys, graphStore, vectorSearch, config)` → `{ reJustifyQueue, cascadeQueue, skipped }`
  - Implements the cascade algorithm (§ 1.2 Cascade Re-Justification Logic)
  - Significance detection via cosine distance on justification embeddings
  - Hop-limited graph traversal (1-2 hops on call graph)
  - Entity cap enforcement with priority ordering
  - **Test:** Changed leaf function → direct re-justify only (no callers). Changed function with 5 callers → direct + 5 callers. Changed function with 100 callers → capped at 50. Deleted function → callers immediately cascade. Recently re-justified entity → skipped.
  - **Depends on:** Phase 4 `justifyEntityWorkflow`, Phase 4 justification embeddings
  - **Files:** `lib/indexer/cascade.ts`
  - **Acceptance:** Cascade correct. Hops limited. Cap enforced. Cost tracked.
  - Notes: _____

- [x] **P5-API-03: Create scoped cross-file edge repair module** — M
  - File: `lib/indexer/edge-repair.ts`
  - `repairEdges(entityDiff, graphStore, importMap)` → `{ edgesCreated, edgesDeleted }`
  - For deleted entities: find and remove broken edges
  - For added entities: create new cross-file edges based on import resolution
  - For updated entities: re-extract calls and update edges if signature changed
  - Reuses Phase 1's import resolution logic (CallGraphLinker) but scoped
  - **Test:** Delete entity → its edges removed. Add entity that imports existing entity → edge created. Update signature → call edges refreshed.
  - **Depends on:** P5-ADAPT-01, P5-ADAPT-02
  - **Files:** `lib/indexer/edge-repair.ts`
  - **Acceptance:** Edges repaired correctly. No orphaned edges. No duplicate edges.
  - Notes: _____

### Webhook Handler

- [x] **P5-API-04: Extend GitHub webhook handler for push events** — L
  - Extend existing `app/api/webhooks/github/route.ts` to handle `push` events
  - Push event handling:
    a) Extract: `ref`, `before`, `after`, `commits`, `repository.id`, `installation.id`
    b) Resolve orgId from installation, repoId from repository
    c) Guard: repo exists, status == "ready", push to default branch, incremental_enabled
    d) SHA gap check: `before` matches `lastIndexedSha` → incremental. Else → full re-index.
    e) Start `incrementalIndexWorkflow` (or `indexRepoWorkflow` for full) via Temporal
    f) Return 200 immediately (fire-and-forget)
  - Security: HMAC-SHA256 validation using global secret or per-repo `webhook_secret`
  - Rate limiting: max 10 workflows started per repo per minute
  - **Test:** Valid push → workflow started. Invalid signature → 401. Non-default branch → ignored. Force push (SHA gap) → full re-index triggered. Rapid pushes → rate limited.
  - **Depends on:** P5-DB-02, P5-DB-04
  - **Files:** `app/api/webhooks/github/route.ts` (modify)
  - **Acceptance:** Push events processed. Security validated. Guards enforced. Non-blocking (200 returned within 500ms).
  - Notes: _____

### Temporal Workflows & Activities

- [x] **P5-API-05: Create `incrementalIndexWorkflow` Temporal workflow** — L
  - Workflow ID: `incr-{orgId}-{repoId}-{afterSha_short}` (unique per push)
  - Queue: starts on `heavy-compute-queue`, cascade activities on `light-llm-queue`
  - Steps:
    1. `pullAndDiff` → fetch + diff → ChangedFile[]
    2. Guard: if files_changed > INCREMENTAL_FALLBACK_THRESHOLD → abort, trigger full re-index instead
    3. Fan-out: batch files into groups of INCREMENTAL_BATCH_SIZE
    4. For each batch: `reIndexBatch` → extract + entity diff per file
    5. `applyEntityDiffs` → batch write all diffs to ArangoDB
    6. `repairEdges` → fix cross-file edges
    7. `updateEmbeddings` → re-embed added/modified, delete removed
    8. `cascadeReJustify` → trigger Phase 4 re-justification (async, non-blocking)
    9. `invalidateCaches` → clear Redis caches for affected entities
    10. `writeIndexEvent` → append to index_events collection
    11. Update lastIndexedSha + lastIndexedAt + entity counts in Supabase
  - Uses heartbeat at each step for dashboard progress tracking
  - On failure: log error, write index_event with event_type "failed", do NOT update lastIndexedSha
  - **Test:** Workflow replay test with mock activities. Correct activity call order. Heartbeat at each step. Failure doesn't advance lastIndexedSha. Large push → fallback to full re-index.
  - **Depends on:** P5-API-01, P5-API-02, P5-API-03, P5-ADAPT-01, P5-ADAPT-03
  - **Files:** `lib/temporal/workflows/incremental-index.ts`
  - **Acceptance:** Full pipeline executes. File batching works. Cascade triggers correctly. Activity feed populated. Error handling robust.
  - Notes: _____

- [x] **P5-API-06: Create Temporal activities for incremental pipeline** — L
  - Activities in `lib/temporal/activities/incremental.ts`:
    - `pullAndDiff(orgId, repoId, beforeSha, afterSha)` → `{ changedFiles: ChangedFile[], workspacePath }`. Runs on `heavy-compute-queue`. Acquires workspace lock.
    - `reIndexBatch(orgId, repoId, files: ChangedFile[], workspacePath)` → `{ entityDiffs: EntityDiff[] }`. Runs on `heavy-compute-queue`. Extracts entities via SCIP/Tree-sitter, computes entity diff per file.
    - `applyEntityDiffs(orgId, repoId, entityDiffs: EntityDiff[])` → `{ entitiesAdded, entitiesUpdated, entitiesDeleted }`. Runs on `light-llm-queue`. Batch writes to ArangoDB.
    - `repairEdges(orgId, repoId, entityDiffs: EntityDiff[])` → `{ edgesCreated, edgesDeleted }`. Runs on `light-llm-queue`.
    - `updateEmbeddings(orgId, repoId, entityDiffs: EntityDiff[])` → `{ embeddingsUpdated, embeddingsDeleted }`. Runs on `light-llm-queue`. Reuses Phase 3 embedding logic.
    - `cascadeReJustify(orgId, repoId, entityDiffs: EntityDiff[])` → `{ cascadeEntities, cascadeStatus }`. Runs on `light-llm-queue`. Triggers Phase 4 workflows.
    - `invalidateCaches(orgId, repoId, affectedEntityKeys: string[])` → void. Runs on `light-llm-queue`.
    - `writeIndexEvent(orgId, repoId, event: IndexEvent)` → void. Runs on `light-llm-queue`.
  - All heavy activities have heartbeat (report file progress)
  - **Test:** Each activity callable independently. pullAndDiff produces correct file list. reIndexBatch extracts entities. applyEntityDiffs writes to ArangoDB. cascadeReJustify triggers Phase 4 workflows.
  - **Depends on:** P5-API-01, P5-API-02, P5-API-03, P5-ADAPT-01, P5-ADAPT-02, P5-ADAPT-03
  - **Files:** `lib/temporal/activities/incremental.ts`
  - **Acceptance:** All activities functional. Heartbeat reports progress. Error handling isolates per-file failures.
  - Notes: _____

- [x] **P5-API-07: Create reconciliation cron workflow** — M
  - File: `lib/temporal/workflows/reconciliation.ts`
  - Temporal cron workflow: runs every RECONCILIATION_INTERVAL_MINUTES
  - Steps:
    1. Fetch all repos where status == "ready" and incremental_enabled == true
    2. For each repo: call GitHub API to get latest SHA
    3. Compare with lastIndexedSha
    4. If diverged and no in-flight workflow: start incrementalIndexWorkflow
    5. Rate limit: max 10 triggers per cycle
  - **Test:** Repo with stale SHA → workflow triggered. Repo with current SHA → skipped. In-flight workflow → skipped. Rate limit enforced.
  - **Depends on:** P5-ADAPT-03, P5-API-05
  - **Files:** `lib/temporal/workflows/reconciliation.ts`
  - **Acceptance:** Self-healing works. Missed webhooks detected. Rate limited.
  - Notes: _____

### MCP Tool

- [x] **P5-API-08: Create `get_recent_changes` MCP tool** — M
  - Tool name: `get_recent_changes`
  - Input schema: `{ since?: string (default "24h", e.g. "2h", "1d", "7d"), limit?: number (default 10, max 50) }`
  - Queries index_events collection for recent indexing activity
  - Enriches each event with entity names and file paths
  - Returns: `{ events: [{ pushSha, commitMessage, timestamp, filesChanged, entitiesAdded: [{key, name, kind, filePath}], entitiesModified: [...], entitiesDeleted: [...], cascadeStatus }] }`
  - OTel span: `mcp.get_recent_changes`
  - **Test:** After incremental index → tool returns the event. Time filtering works. Entity enrichment correct.
  - **Depends on:** P5-DB-03, Phase 2 MCP tool registration
  - **Files:** `lib/mcp/tools/changes.ts`
  - **Acceptance:** Tool registered. Returns enriched activity data. Time filtering works.
  - Notes: _____

### Dashboard API Routes

- [x] **P5-API-09: Create `GET /api/repos/[repoId]/activity` route** — M
  - Auth: Better Auth session required. Verify user has access to org.
  - Queries index_events (ArangoDB, last 50 events)
  - Also queries Temporal for any in-flight incrementalIndexWorkflow (via workflow ID prefix)
  - Returns: `{ events: IndexEvent[], inFlight: { workflowId, status, progress }? }`
  - **Test:** Authenticated request → events returned. In-flight workflow → progress shown. Unauthenticated → 401.
  - **Depends on:** P5-DB-03
  - **Files:** `app/api/repos/[repoId]/activity/route.ts`
  - **Acceptance:** Activity feed data returned. In-flight status included.
  - Notes: _____

- [x] **P5-API-10: Create `POST /api/repos/[repoId]/reindex` route** — S
  - Auth: Better Auth session, org admin only.
  - Triggers a full `indexRepoWorkflow` (Phase 1 pipeline)
  - Used when incremental indexing is insufficient or user wants to force refresh
  - Rate limited: max 1 re-index per hour per repo
  - Returns: `{ status: "started", workflowId }`
  - **Test:** POST → workflow started. Second POST within 1 hour → 429. Non-admin → 403.
  - **Depends on:** Phase 1 `indexRepoWorkflow`
  - **Files:** `app/api/repos/[repoId]/reindex/route.ts`
  - **Acceptance:** Manual re-index works. Rate limited. Admin-only.
  - Notes: _____

---

## 2.5 Frontend / UI Layer

- [x] **P5-UI-01: Create Activity Feed page at `/repos/[repoId]/activity`** — L
  - Timeline component showing indexing events in reverse chronological order
  - Each event card shows:
    - Push SHA (truncated, clickable → GitHub commit link)
    - Commit message (first line)
    - Timestamp (relative: "2 minutes ago")
    - File change count badge
    - Entity diff badges: +N added (green), ~N modified (yellow), -N deleted (red)
    - Cascade status badge: "Re-justification complete" (green) or "Pending" (yellow) or "Skipped" (gray)
  - In-flight workflow: shows progress bar with current activity name
  - Polling: every 5 seconds when in-flight workflow detected
  - Empty state: "No indexing activity yet. Push to GitHub to get started."
  - **Test:** Navigate to activity page → events render. In-flight workflow → progress bar. Empty state shown when no events.
  - **Depends on:** P5-API-09
  - **Files:** `app/(dashboard)/repos/[repoId]/activity/page.tsx`, `components/activity/activity-feed.tsx`, `components/activity/index-event-card.tsx`, `components/activity/progress-bar.tsx`
  - **Acceptance:** Feed renders. Entity diff badges correct colors. In-flight progress works. Design system compliant.
  - Notes: _____

- [x] **P5-UI-02: Update repo card with incremental indexing status** — S
  - Repo card shows:
    - "Last indexed X ago" timestamp (from lastIndexedAt)
    - Small activity indicator: green dot if indexed within 1 hour, yellow if >1 hour, red if >24 hours
    - "Indexing..." spinner when in-flight workflow detected
  - Click indicator → navigates to activity feed page
  - **Test:** Repo recently indexed → green dot. Old index → yellow/red. In-flight → spinner.
  - **Depends on:** P5-DB-04
  - **Files:** `components/dashboard/repo-card.tsx` (modify)
  - **Acceptance:** Status indicators render. Clickable. Design system compliant.
  - Notes: _____

- [x] **P5-UI-03: Add Activity nav link to sidebar** — S _(Added as tab in repo layout, not sidebar — matches existing repo tab pattern)_
  - New sidebar item: "Activity" (icon: Lucide `Activity`)
  - Appears under the repo section when viewing a repo
  - Active state: highlighted when on activity route
  - **Test:** Nav link visible. Click navigates. Active state renders.
  - **Depends on:** P5-UI-01
  - **Files:** `components/dashboard/dashboard-nav.tsx` (modify)
  - **Acceptance:** Navigation link works. Icon correct. Active state visible.
  - Notes: _____

---

## 2.6 Testing & Verification

### Unit Tests

- [x] **P5-TEST-01: Entity diff algorithm tests** — M
  - Identical entities → empty diff (no adds, updates, or deletes)
  - New entity (hash not in old set) → added
  - Removed entity (hash not in new set) → deleted
  - Same hash, different body → updated
  - Same hash, identical content → skipped (not in updated)
  - Renamed function (different name → different hash) → delete old + add new
  - Moved function (different file → different hash) → delete old + add new
  - Signature-only change (same hash, different signature) → updated
  - Empty old set (new file) → all entities added
  - Empty new set (deleted file) → all entities deleted
  - **Depends on:** P5-API-01
  - **Files:** `lib/indexer/__tests__/incremental.test.ts`
  - Notes: _____

- [x] **P5-TEST-01a: AST Comparator tests** — M
  - Whitespace-only diff → `isSemanticChange` returns `false`
  - Comment-only diff (add/remove/edit comment) → returns `false`
  - Import reordering (same imports, different order) → returns `false`
  - Prettier formatting change (quotes, trailing commas, indentation) → returns `false`
  - Function body logic change (new if-branch) → returns `true`
  - Parameter added/removed → returns `true`
  - Return type changed → returns `true`
  - Variable renamed in logic → returns `true`
  - ast-grep binary not available → graceful fallback, returns `true`
  - ast-grep timeout (>5s) → graceful fallback, returns `true`
  - Unsupported language → returns `true` (safe default)
  - `AST_DIFF_ENABLED=false` → bypassed entirely, all changes treated as semantic
  - **Depends on:** P5-API-00a
  - **Files:** `lib/indexer/__tests__/ast-comparator.test.ts`
  - Notes: _____

- [x] **P5-TEST-01b: Centrality scoring tests** — M
  - Entity with 0 inbound callers → centralityScore 0, not a hub
  - Entity with 5 callers → not a hub (below default threshold 50)
  - Entity with 100 callers → hub node (above default threshold)
  - Entity with exactly 50 callers → NOT a hub (threshold is exclusive: > 50, not >=)
  - Custom threshold (e.g., 10) → respects custom value
  - Cache: second call for same entity returns cached count (no AQL re-query)
  - Hub node modified → only hub entity re-justified, zero caller cascade
  - Non-hub node modified → normal cascade behavior
  - **Depends on:** P5-API-00b
  - **Files:** `lib/indexer/__tests__/centrality.test.ts`
  - Notes: _____

- [x] **P5-TEST-01c: Signal Debouncing tests** — M _(NOT YET: no signal-debounce.test.ts file)_
  - 10 rapid signals within 30s → single indexing run after quiet period
  - Quiet period resets on each new signal
  - `DEBOUNCE_QUIET_PERIOD=0` → immediate processing (no debounce)
  - Workflow ID is per-repo (not per-SHA) — `signalWithStart` reuses existing workflow
  - After quiet period: diffs from `lastIndexedSha` to latest accumulated SHA (not intermediate SHAs)
  - Empty signal queue after processing → workflow waits for next signal (not terminate)
  - **Depends on:** P5-API-00d
  - **Files:** `lib/temporal/workflows/__tests__/signal-debounce.test.ts`
  - Notes: _____

- [x] **P5-TEST-01d: Branch Shadow Graph tests** — L
  - Feature branch push → shadow entities created with `branches: ["feature/x"]`
  - Main entities unchanged by feature branch indexing
  - MCP query with branch context → merged view (feature overrides + main base)
  - MCP query without branch context → main-only (no shadow entities)
  - Branch merge → entities promoted (branches gains "main")
  - Branch deletion → shadow entities removed
  - Multiple concurrent feature branches → isolated shadow graphs
  - `BRANCH_INDEXING_ENABLED=false` → feature branch pushes ignored
  - **Depends on:** P5-API-00e
  - **Files:** `lib/indexer/__tests__/branch-overlay.test.ts`
  - Notes: _____

- [x] **P5-TEST-01e: Semantic Drift Alert tests** — M _(NOT YET: no drift-alert.test.ts file)_
  - Entity intent changed + 20 callers → alert generated with correct author list
  - Entity intent unchanged (implementation only) → no alert
  - Entity with 5 callers (below threshold) → no alert
  - `DRIFT_ALERT_CHANNEL="github_issue"` → GitHub Issue created with assignees
  - `DRIFT_ALERT_CHANNEL="dashboard"` → notification only (no GitHub Issue)
  - `DRIFT_ALERT_ENABLED=false` → no alerts generated
  - Git blame failure → graceful skip (dashboard notification still created without assignees)
  - **Depends on:** P5-API-00f
  - **Files:** `lib/temporal/activities/__tests__/drift-alert.test.ts`
  - Notes: _____

- [x] **P5-TEST-01f: Blue/Green pgvector tests** — M _(NOT YET: no blue-green-vector.test.ts file)_
  - During indexing: search returns old (complete) version
  - After activation: search returns new version
  - Failed indexing: old version stays active, pending version orphaned
  - GC: old vectors deleted after `VECTOR_GC_DELAY_MINUTES`
  - GC safety: never deletes active or in-progress versions
  - Concurrent indexing: last to complete wins activation
  - First-time index: creates `active_vector_versions` row
  - **Depends on:** P5-API-00g
  - **Files:** `lib/adapters/__tests__/blue-green-vector.test.ts`
  - Notes: _____

- [x] **P5-TEST-01g: Semantic Fingerprint + Move Detection tests** — M
  - File moved (identical content) → entity `_key` preserved, `filePath` updated
  - Edges survive file move (no orphaned edges)
  - Justification survives file move (no re-justification needed)
  - Move + minor modification (<10% AST change) → still detected as move
  - Move + major modification (>10% AST change) → treated as delete + add
  - Split (1 entity → 2) → no false move match
  - Merge (2 entities → 1) → best match by name similarity
  - Fingerprint computation is deterministic (same input → same output)
  - **Depends on:** P5-API-00h
  - **Files:** `lib/indexer/__tests__/semantic-fingerprint.test.ts`
  - Notes: _____

- [x] **P5-TEST-01h: Dead-Letter Quarantine tests** — M _(Tests in lib/indexer/__tests__/quarantine.test.ts)_
  - Minified JS file (>5MB) → auto-quarantined before parsing
  - Syntax error file → quarantined after parse failure
  - Extraction timeout (>30s) → quarantined
  - Remaining files in batch continue processing (no batch abort)
  - MCP search returns quarantine warning in `_meta`
  - Quarantined entity has no edges (opaque blob)
  - Valid re-push of quarantined file → quarantine flag removed
  - Worker queue not stalled by corrupted files
  - **Depends on:** P5-API-00i
  - **Files:** `lib/temporal/activities/__tests__/quarantine.test.ts`
  - Notes: _____

- [x] **P5-TEST-02: Cascade re-justification tests (with AST filter + centrality)** — L
  - Changed leaf function (0 callers) → direct re-justify only
  - Changed function with 5 callers → direct + 5 callers (hop 1)
  - Changed function with 100 callers → capped at 50 (priority ordering)
  - Deleted function → callers immediately cascade (no significance check)
  - Recently re-justified entity (updated_at < 5 min) → skipped
  - No existing justification → entity added to queue unconditionally
  - Cosine distance < 0.3 → no cascade (not significant)
  - Cosine distance > 0.3 → cascade triggered
  - Feature area changed → aggregateFeatures called
  - Budget exceeded → cascade skipped, status = "skipped"
  - **NEW:** Hub node (>50 callers) modified → only hub re-justified, callers NOT cascaded
  - **NEW:** Format-only push (Prettier) → AST filter removes all entities, zero cascade
  - **NEW:** Mixed push (2 semantic + 3 format-only) → only 2 entities cascade
  - **Depends on:** P5-API-02, P5-API-00c
  - **Files:** `lib/indexer/__tests__/cascade.test.ts`
  - Notes: _____

- [x] **P5-TEST-03: Edge repair tests** — M
  - Delete entity → all its edges removed (both inbound and outbound)
  - Add entity that imports existing entity → call edge created
  - Add entity that is imported by existing entity → edge discovered and created
  - Update entity signature → call edges refreshed
  - No orphaned edges after repair (all _from and _to reference existing entities)
  - **Depends on:** P5-API-03
  - **Files:** `lib/indexer/__tests__/edge-repair.test.ts`
  - Notes: _____

- [x] **P5-TEST-04: Webhook handler tests** — M _(NOT YET: no push.test.ts file)_
  - Valid push to default branch → workflow started, 200 returned
  - Valid push to non-default branch → ignored, 200 returned (with "ignored" body)
  - Invalid signature → 401 returned, no workflow
  - Duplicate delivery (same delivery ID) → 200 returned, no new workflow
  - Force push (SHA gap) → full re-index workflow started
  - Repo not in "ready" status → ignored (return 200 but no workflow)
  - Push when incremental_enabled == false → full re-index instead
  - **Depends on:** P5-API-04
  - **Files:** `app/api/webhooks/github/__tests__/push.test.ts`
  - Notes: _____

- [x] **P5-TEST-05: MCP tool tests** — S
  - `get_recent_changes` with valid time range → returns events
  - `get_recent_changes` with no events → empty array
  - Entity enrichment: events include entity names, kinds, file paths
  - Time filtering: "2h" → only events within 2 hours
  - **Depends on:** P5-API-08
  - **Files:** `lib/mcp/tools/__tests__/changes.test.ts`
  - Notes: _____

### Integration Tests

- [x] **P5-TEST-06: Full incremental pipeline integration test** — L _(NOT YET: no integration test file)_
  - End-to-end: entities in ArangoDB (from Phase 1) → simulate push (add file, modify file, delete file) → run incrementalIndexWorkflow → verify:
    - New entities added to ArangoDB
    - Modified entities updated in place (edges preserved)
    - Deleted entities removed (edges cleaned up)
    - Embeddings updated in pgvector
    - index_events activity feed populated
    - lastIndexedSha updated
  - Requires: test containers (ArangoDB + PostgreSQL with pgvector) or mocks
  - **Depends on:** P5-API-05, P5-API-06
  - **Files:** `lib/temporal/workflows/__tests__/incremental-index.integration.test.ts`
  - Notes: _____

- [x] **P5-TEST-07: Temporal workflow replay tests** — M _(NOT YET: no replay test file)_
  - Deterministic replay of incrementalIndexWorkflow with mock activities
  - Verify: correct activity call order (pullAndDiff → reIndexBatch → applyEntityDiffs → repairEdges → updateEmbeddings → cascadeReJustify → invalidateCaches → writeIndexEvent)
  - Verify: heartbeat at each step, failure handling (doesn't advance lastIndexedSha)
  - Verify: large push fallback (>200 files → triggers full re-index instead)
  - **Depends on:** P5-API-05
  - **Files:** `lib/temporal/workflows/__tests__/incremental-index.replay.test.ts`
  - Notes: _____

- [x] **P5-TEST-08: Reconciliation job tests** — M _(NOT YET: no reconciliation.test.ts file)_
  - Repo with stale SHA → workflow triggered
  - Repo with current SHA → no workflow
  - In-flight workflow already running → skip
  - Rate limit: >10 repos diverged → only 10 triggered
  - **Depends on:** P5-API-07
  - **Files:** `lib/temporal/workflows/__tests__/reconciliation.test.ts`
  - Notes: _____

### E2E Tests

- [x] **P5-TEST-09: Activity feed E2E** — M
  - Navigate to activity page → events render
  - Each event shows: SHA, message, file count, entity diff badges
  - In-flight workflow → progress bar visible
  - Click SHA → opens GitHub commit link
  - **Depends on:** P5-UI-01, P5-API-09
  - **Files:** `e2e/activity-feed.spec.ts`
  - Notes: _____

### Manual Verification

- [x] **P5-TEST-10: Manual incremental indexing test** — L _(Manual verification — not automated)_
  - Connect a real repo via Phase 1
  - Push a commit changing 1 file → verify:
    - Only that file's entities updated (check ArangoDB timestamps)
    - MCP `get_recent_changes` reflects the push
    - MCP search returns updated entity content
    - Activity feed shows the event
    - Total time: < 30 seconds
  - Push a commit deleting a function → verify:
    - Entity removed from ArangoDB
    - Callers get cascade re-justified (if Phase 4 justifications exist)
    - Embedding removed from pgvector
  - Push a commit renaming a function → verify:
    - Old entity deleted, new entity created
    - Callers of old entity re-justified
  - Force push → verify:
    - Full re-index triggered (not incremental)
    - Activity feed shows "Force push detected"
  - **Depends on:** All P5 items
  - Notes: _____

---

## Dependency Graph

```
P5-INFRA-01 (env vars) ──────┐
P5-INFRA-02 (.env.example) ──┘
    │
P5-DB-01 (ArangoDB: index_events) ─┐
P5-DB-02 (Prisma: webhook_secret, incremental_enabled) ─┤
P5-DB-03 (index event CRUD) ──────┤
P5-DB-04 (lastIndexedSha fix) ────┘
    │
P5-ADAPT-01 (entity-by-file queries) ─┐
P5-ADAPT-02 (edge repair methods) ────┤
P5-ADAPT-03 (git pull + diff) ────────┤
P5-ADAPT-04 (InMemoryGitHost fake) ───┘
    │
    ├── P5-API-01 (entity diff algorithm)
    ├── P5-API-02 (cascade re-justification — consumes Phase 4)
    ├── P5-API-03 (edge repair module)
    ├── P5-API-04 (webhook handler extension)
    ├── P5-API-05 (incrementalIndexWorkflow)
    ├── P5-API-06 (Temporal activities)
    ├── P5-API-07 (reconciliation cron)
    ├── P5-API-08 (get_recent_changes MCP tool)
    ├── P5-API-09 (activity feed API)
    ├── P5-API-10 (manual reindex API)
    │       │
    │       ├── P5-UI-01..03 (Activity feed page, repo card update, nav link)
    │       └── P5-TEST-01..10 (all tests)
    │
    └── Phase 5.5 consumes: incrementalIndexWorkflow, index_events, lastIndexedSha
        Phase 6 consumes: post-indexing hook, entity diff, cascade completion
```

**Recommended implementation order:**

1. **Infrastructure** (P5-INFRA-01..02) — env vars
2. **Database** (P5-DB-01..04) — ArangoDB collection, Prisma migration, lastIndexedSha fix
3. **Adapters** (P5-ADAPT-01..04) — graph store additions, git host additions
4. **Core algorithms** (P5-API-01..03) — entity diff, cascade, edge repair
5. **Webhook handler** (P5-API-04) — push event processing
6. **Temporal workflows** (P5-API-05..07) — incremental workflow, activities, reconciliation
7. **MCP tool** (P5-API-08) — get_recent_changes
8. **Dashboard APIs** (P5-API-09..10) — activity feed, manual reindex
9. **Frontend** (P5-UI-01..03) — activity feed page, repo card, nav
10. **Testing** (P5-TEST-01..10) — unit, integration, E2E, manual

---

## New Files Summary

```
lib/
  indexer/
    incremental.ts               ← Entity diff algorithm: diffEntitySets()
    ast-comparator.ts            ← Semantic AST diffing: isSemanticChange() via ast-grep
    centrality.ts                ← Hub node detection: getInboundCallerCount(), isHubNode()
    cascade.ts                   ← Cascade re-justification: buildCascadeQueue(), isSignificantChange()
                                    (integrates AST filter + centrality bounding)
    edge-repair.ts               ← Scoped cross-file edge repair: repairEdges()
    semantic-fingerprint.ts      ← Move detection: computeSemanticFingerprint(), detectMoves()
    branch-overlay.ts            ← MVCC branch shadow graph: createBranchOverlay(), mergeBranch()
  temporal/
    workflows/
      incremental-index.ts       ← incrementalIndexWorkflow (diff-based, fan-out per batch)
      reconciliation.ts          ← Periodic cron: detect stale repos, trigger re-index
    activities/
      incremental.ts             ← pullAndDiff, reIndexBatch, applyEntityDiffs, repairEdges,
                                    updateEmbeddings, cascadeReJustify, invalidateCaches, writeIndexEvent
      drift-alert.ts             ← driftEvaluationActivity: LLM intent comparison, git blame, alert generation
  mcp/
    tools/
      changes.ts                 ← get_recent_changes MCP tool
app/
  api/
    repos/
      [repoId]/
        activity/route.ts        ← GET /api/repos/{repoId}/activity
        reindex/route.ts         ← POST /api/repos/{repoId}/reindex
  (dashboard)/
    repos/
      [repoId]/
        activity/page.tsx        ← Activity feed page
components/
  activity/
    activity-feed.tsx            ← Feed container with polling
    index-event-card.tsx         ← Individual event card with diff badges
    progress-bar.tsx             ← In-flight workflow progress
supabase/migrations/
  2026XXXX_phase5_blue_green_vectors.sql  ← vector_version column + active_vector_versions table
```

### Modified Files

```
app/api/webhooks/github/route.ts          ← Add push event handler (currently only handles installations)
lib/temporal/activities/indexing-light.ts  ← Pass lastIndexedSha to updateRepoStatus
lib/temporal/workflows/index-repo.ts      ← Pass lastIndexedSha after finalizeIndexing (formerly writeToArango)
lib/ports/graph-store.ts                  ← Add entity-by-file, edge repair, index event methods
lib/ports/git-host.ts                     ← Add pullLatest, diffFiles, getLatestSha methods
lib/adapters/arango-graph-store.ts        ← Implement new methods + bootstrapGraphSchema additions + branch-aware queries
lib/adapters/github-host.ts               ← Implement pullLatest, diffFiles, getLatestSha, blame
lib/adapters/llamaindex-vector-search.ts  ← Version-aware read/write for blue/green vectoring
lib/di/fakes.ts                           ← Update InMemoryGitHost fake
env.mjs                                   ← Phase 5 configuration variables
.env.example                              ← Document Phase 5 variables
prisma/schema.prisma                      ← webhook_secret, incremental_enabled columns
components/dashboard/repo-card.tsx         ← Last-indexed indicator
components/dashboard/dashboard-nav.tsx     ← Activity nav link
```

---

## Revision Log

| Date | Author | Change |
|------|--------|--------|
| 2026-02-21 | — | Initial document created. 10 API items, 4 adapter items, 2 infrastructure items, 4 database items, 3 UI items, 10 test items. Total: **33 tracker items.** |
| 2026-02-21 | — | Added Semantic AST Diffing (noise filter) and Blast-Radius Bounding (centrality scoring). New: 3 API items (P5-API-00a/b/c), 2 test items (P5-TEST-01a/b), expanded P5-TEST-02, 2 env vars. Total: **38 tracker items.** |
| 2026-02-21 | — | Major resilience & intelligence enhancements: Temporal Signal Debouncing (commit storm absorber), Branch-Aware MVCC Shadow Graph, Proactive Semantic Drift Alerting, Blue/Green pgvector Hot Swapping, Location-Agnostic Semantic Fingerprinting (file move detection), Dead-Letter Quarantine for corrupted code, Package Recommendations. New: 6 API items (P5-API-00d/e/f/g/h/i), 6 test items (P5-TEST-01c/d/e/f/g/h), 9 env vars, 1 migration. Total: **50 tracker items.** |
| 2026-02-23 | Claude | **Cross-ref: Post-Onboarding "Wow" Experience.** Entity detail page (`/repos/{repoId}/entities/{entityId}`) now displays dead code detection results, quality scores, and architectural pattern badges computed from Phase 5's graph data. See [PHASE_POST_ONBOARDING_WOW_EXPERIENCE.md](./PHASE_POST_ONBOARDING_WOW_EXPERIENCE.md). |
