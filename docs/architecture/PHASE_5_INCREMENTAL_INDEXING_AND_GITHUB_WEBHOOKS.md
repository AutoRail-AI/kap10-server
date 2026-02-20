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

### Cascade Re-Justification Logic

Phase 5 triggers Phase 4's `justifyEntityWorkflow` for entities whose business context may have changed. The cascade algorithm:

```
Cascade Re-Justification Algorithm:

Input: Set of changed entity keys (added, modified, deleted)
Config: MAX_HOPS = 2, MAX_CASCADE_ENTITIES = 50, SIGNIFICANCE_THRESHOLD = 0.3

1. Direct re-justification (hop 0):
   For each MODIFIED entity:
     a) Compute new code embedding (from updated entity body)
     b) Fetch old justification embedding from pgvector
     c) If cosine_distance(old_justification_emb, new_code_emb) > SIGNIFICANCE_THRESHOLD:
        → Add to re-justify queue
     d) If entity has no existing justification (new to Phase 4):
        → Add to re-justify queue unconditionally
   For each ADDED entity:
     → Add to re-justify queue unconditionally (new entity, needs justification)

2. Cascade (hop 1):
   For each entity in re-justify queue:
     a) Fetch 1-hop callers from ArangoDB call graph
     b) For each caller:
        - Check caller.justification.updated_at
        - If updated < 5 minutes ago: skip (recently re-justified)
        - Else: add caller to cascade queue

3. Cascade (hop 2, optional):
   If cascade queue size < MAX_CASCADE_ENTITIES / 2:
     For each entity added in hop 1:
       Fetch 1-hop callers → add to cascade queue (same skip logic)

4. Cap enforcement:
   If total re-justify + cascade > MAX_CASCADE_ENTITIES:
     Prioritize by: deleted callee's callers > modified callee's callers > hop 2
     Truncate to MAX_CASCADE_ENTITIES

5. Execute:
   For each entity in (re-justify queue + cascade queue):
     Start justifyEntityWorkflow (Phase 4, idempotent by workflow ID)
     Pass: entity key, existing callee context, canonical value seeds from repo

6. Feature aggregation:
   After all justifyEntityWorkflow instances complete:
     If any entity's feature_area changed:
       Run aggregateFeatures (Phase 4 reusable activity) for affected features

7. Cost tracking:
   Log all LLM calls to token_usage_log with workflow_id = incrementalIndexWorkflow ID
```

**Cost model for cascade re-justification:**

| Push size | Entities changed | Entities re-justified (avg) | Est. cost |
|---|---|---|---|
| Small (1-3 files) | 5–15 entities | 5–20 (direct + 1-hop) | ~$0.01 |
| Medium (5-10 files) | 20–80 entities | 20–50 (capped) | ~$0.05 |
| Large (20+ files) | 100+ entities | 50 (capped) | ~$0.10 |
| Force push (full) | All entities | Full re-justify (Phase 4) | $1-16 |

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

- [ ] **P5-INFRA-01: Add Phase 5 env vars to `env.mjs`** — S
  - New variables: `INCREMENTAL_BATCH_SIZE` (default: 5, max: 20), `CASCADE_MAX_HOPS` (default: 2, max: 3), `CASCADE_MAX_ENTITIES` (default: 50, max: 200), `CASCADE_SIGNIFICANCE_THRESHOLD` (default: 0.3), `RECONCILIATION_INTERVAL_MINUTES` (default: 15, min: 5), `INCREMENTAL_FALLBACK_THRESHOLD` (default: 200 — files changed above this → full re-index)
  - All optional with sensible defaults. Phase 5 works with zero additional configuration.
  - **Test:** `pnpm build` succeeds. Default values used when env vars missing. Invalid values (negative, > max) produce clear error.
  - **Depends on:** Nothing
  - **Files:** `env.mjs`, `.env.example`
  - Notes: _____

- [ ] **P5-INFRA-02: Update `.env.example` with Phase 5 variables** — S
  - Document all new variables with comments explaining cascade behavior and thresholds
  - Add comment block: "Phase 5: Incremental Indexing — these are optional, defaults are production-ready"
  - **Test:** `cp .env.example .env.local` + fill → incremental pipeline functional.
  - **Depends on:** P5-INFRA-01
  - **Files:** `.env.example`
  - Notes: _____

---

## 2.2 Database & Schema Layer

- [ ] **P5-DB-01: Create `index_events` ArangoDB collection** — M
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

- [ ] **P5-DB-02: Add `webhook_secret` and `incremental_enabled` columns to Repo model** — S
  - New columns on `kap10.repos`: `webhook_secret` (String?, null = use global secret), `incremental_enabled` (Boolean, default true)
  - Prisma migration. Existing repos get defaults (null, true).
  - **Test:** Migration runs. Existing repos get default values. New repos can set webhook_secret.
  - **Depends on:** Nothing
  - **Files:** `prisma/schema.prisma`, new migration file
  - **Acceptance:** Columns exist. Default values correct. No impact on existing queries.
  - Notes: _____

- [ ] **P5-DB-03: Add `indexEvent` CRUD methods to `ArangoGraphStore`** — S
  - New methods: `insertIndexEvent(orgId, event)`, `getIndexEvents(orgId, repoId, options: { since?, limit?, eventType? })`, `getLatestIndexEvent(orgId, repoId)`
  - **Test:** Insert 10 events → query by time range returns correct subset. getLatest returns most recent.
  - **Depends on:** P5-DB-01
  - **Files:** `lib/ports/graph-store.ts` (interface additions), `lib/adapters/arango-graph-store.ts`
  - **Acceptance:** CRUD works. Time-range filtering works. Limit parameter respected.
  - Notes: _____

- [ ] **P5-DB-04: Ensure `lastIndexedSha` is updated by indexing activities** — S
  - The existing `updateRepoStatus` method already accepts `lastIndexedSha` parameter but the indexing workflow never passes it
  - Fix: Phase 1's `writeToArango` activity and Phase 5's `applyEntityDiffs` activity must pass `lastIndexedSha` when updating repo status
  - **Test:** Full index → `lastIndexedSha` populated. Incremental index → `lastIndexedSha` updated to push `after` SHA. Verify via `getRepo()`.
  - **Depends on:** Nothing
  - **Files:** `lib/temporal/activities/indexing-light.ts` (modify), `lib/temporal/workflows/index-repo.ts` (modify)
  - **Acceptance:** `lastIndexedSha` correctly maintained after every index operation.
  - Notes: _____

---

## 2.3 Ports & Adapters Layer

### IGraphStore — Phase 5 Additions

- [ ] **P5-ADAPT-01: Implement entity-by-file query methods on `ArangoGraphStore`** — M
  - New methods: `getEntitiesByFile(orgId, repoId, filePath)` → returns all entities for a file with their hashes, `getEdgesForEntities(orgId, entityKeys[])` → returns all edges involving these entities, `batchDeleteEntities(orgId, entityKeys[])` → delete entities + all their edges, `batchDeleteEdgesByEntity(orgId, entityKeys[])` → delete edges referencing these entities
  - These methods enable the entity diff algorithm to load old entities for comparison and efficiently delete removed entities with their edges.
  - **Test:** Insert 10 entities for a file → `getEntitiesByFile` returns all 10. Delete 3 → edges involving those 3 also gone. Remaining 7 entities and their edges intact.
  - **Depends on:** Nothing
  - **Files:** `lib/ports/graph-store.ts` (interface), `lib/adapters/arango-graph-store.ts`
  - **Acceptance:** File-scoped entity queries work. Batch delete cascades to edges. Multi-tenant isolation.
  - Notes: _____

- [ ] **P5-ADAPT-02: Implement scoped cross-file edge repair methods** — M
  - New methods: `findBrokenEdges(orgId, repoId, deletedEntityKeys[])` → returns edges that reference deleted entities, `createEdgesForEntity(orgId, entity, importMap)` → creates call/import/extends edges for a newly added entity
  - Reuses Phase 1's edge creation logic but scoped to specific entities (not full repo scan)
  - **Test:** Delete entity B that entity A calls → `findBrokenEdges` returns the A→B edge. Add entity C → `createEdgesForEntity` creates edges based on C's imports.
  - **Depends on:** P5-ADAPT-01
  - **Files:** `lib/adapters/arango-graph-store.ts`
  - **Acceptance:** Broken edges detected. New edges created. No orphaned edges.
  - Notes: _____

### IGitHost — Phase 5 Additions

- [ ] **P5-ADAPT-03: Add `pullLatest` and `diffFiles` methods to GitHub adapter** — M
  - New methods on `IGitHost`: `pullLatest(workspacePath, branch)` → runs `git fetch && git checkout`, `diffFiles(workspacePath, fromSha, toSha)` → returns `ChangedFile[]` with `{ path, changeType: 'added' | 'modified' | 'removed' }`, `getLatestSha(owner, repo, branch, installationId)` → returns latest commit SHA from GitHub API
  - `diffFiles` uses `git diff --name-status {from}..{to}` under the hood
  - `getLatestSha` used by reconciliation job
  - **Test:** Pull on a test workspace → working tree advanced. Diff between two SHAs → correct file list. Added/modified/removed correctly classified.
  - **Depends on:** Nothing
  - **Files:** `lib/ports/git-host.ts` (interface), `lib/adapters/github-host.ts`
  - **Acceptance:** Pull works. Diff returns correct files. Change types accurate.
  - Notes: _____

- [ ] **P5-ADAPT-04: Update `InMemoryGitHost` fake for testing** — S
  - Extend the test fake in `lib/di/fakes.ts` to support `pullLatest` and `diffFiles`
  - `diffFiles` returns configurable changed files for testing
  - **Test:** `createTestContainer()` provides working git host with pull and diff.
  - **Depends on:** P5-ADAPT-03
  - **Files:** `lib/di/fakes.ts`
  - Notes: _____

---

## 2.4 Backend / API Layer

### Core Incremental Indexing Pipeline

- [ ] **P5-API-01: Create entity diff module** — M
  - File: `lib/indexer/incremental.ts`
  - `diffEntitySets(oldEntities, newEntities)` → `EntityDiff { added, updated, deleted }`
  - Compares by entity hash (identity-based, not content-based)
  - For "updated" entities: detects whether content actually changed (body or signature)
  - **Test:** Same entities → empty diff. New entity → added. Removed entity → deleted. Changed body → updated. Unchanged → skipped. Renamed function → delete old + add new.
  - **Depends on:** Nothing (pure algorithm)
  - **Files:** `lib/indexer/incremental.ts`
  - **Acceptance:** Diff algorithm correct. All edge cases handled. No false positives.
  - Notes: _____

- [ ] **P5-API-02: Create cascade re-justification module** — L
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

- [ ] **P5-API-03: Create scoped cross-file edge repair module** — M
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

- [ ] **P5-API-04: Extend GitHub webhook handler for push events** — L
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

- [ ] **P5-API-05: Create `incrementalIndexWorkflow` Temporal workflow** — L
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

- [ ] **P5-API-06: Create Temporal activities for incremental pipeline** — L
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

- [ ] **P5-API-07: Create reconciliation cron workflow** — M
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

- [ ] **P5-API-08: Create `get_recent_changes` MCP tool** — M
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

- [ ] **P5-API-09: Create `GET /api/repos/[repoId]/activity` route** — M
  - Auth: Better Auth session required. Verify user has access to org.
  - Queries index_events (ArangoDB, last 50 events)
  - Also queries Temporal for any in-flight incrementalIndexWorkflow (via workflow ID prefix)
  - Returns: `{ events: IndexEvent[], inFlight: { workflowId, status, progress }? }`
  - **Test:** Authenticated request → events returned. In-flight workflow → progress shown. Unauthenticated → 401.
  - **Depends on:** P5-DB-03
  - **Files:** `app/api/repos/[repoId]/activity/route.ts`
  - **Acceptance:** Activity feed data returned. In-flight status included.
  - Notes: _____

- [ ] **P5-API-10: Create `POST /api/repos/[repoId]/reindex` route** — S
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

- [ ] **P5-UI-01: Create Activity Feed page at `/repos/[repoId]/activity`** — L
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

- [ ] **P5-UI-02: Update repo card with incremental indexing status** — S
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

- [ ] **P5-UI-03: Add Activity nav link to sidebar** — S
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

- [ ] **P5-TEST-01: Entity diff algorithm tests** — M
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

- [ ] **P5-TEST-02: Cascade re-justification tests** — L
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
  - **Depends on:** P5-API-02
  - **Files:** `lib/indexer/__tests__/cascade.test.ts`
  - Notes: _____

- [ ] **P5-TEST-03: Edge repair tests** — M
  - Delete entity → all its edges removed (both inbound and outbound)
  - Add entity that imports existing entity → call edge created
  - Add entity that is imported by existing entity → edge discovered and created
  - Update entity signature → call edges refreshed
  - No orphaned edges after repair (all _from and _to reference existing entities)
  - **Depends on:** P5-API-03
  - **Files:** `lib/indexer/__tests__/edge-repair.test.ts`
  - Notes: _____

- [ ] **P5-TEST-04: Webhook handler tests** — M
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

- [ ] **P5-TEST-05: MCP tool tests** — S
  - `get_recent_changes` with valid time range → returns events
  - `get_recent_changes` with no events → empty array
  - Entity enrichment: events include entity names, kinds, file paths
  - Time filtering: "2h" → only events within 2 hours
  - **Depends on:** P5-API-08
  - **Files:** `lib/mcp/tools/__tests__/changes.test.ts`
  - Notes: _____

### Integration Tests

- [ ] **P5-TEST-06: Full incremental pipeline integration test** — L
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

- [ ] **P5-TEST-07: Temporal workflow replay tests** — M
  - Deterministic replay of incrementalIndexWorkflow with mock activities
  - Verify: correct activity call order (pullAndDiff → reIndexBatch → applyEntityDiffs → repairEdges → updateEmbeddings → cascadeReJustify → invalidateCaches → writeIndexEvent)
  - Verify: heartbeat at each step, failure handling (doesn't advance lastIndexedSha)
  - Verify: large push fallback (>200 files → triggers full re-index instead)
  - **Depends on:** P5-API-05
  - **Files:** `lib/temporal/workflows/__tests__/incremental-index.replay.test.ts`
  - Notes: _____

- [ ] **P5-TEST-08: Reconciliation job tests** — M
  - Repo with stale SHA → workflow triggered
  - Repo with current SHA → no workflow
  - In-flight workflow already running → skip
  - Rate limit: >10 repos diverged → only 10 triggered
  - **Depends on:** P5-API-07
  - **Files:** `lib/temporal/workflows/__tests__/reconciliation.test.ts`
  - Notes: _____

### E2E Tests

- [ ] **P5-TEST-09: Activity feed E2E** — M
  - Navigate to activity page → events render
  - Each event shows: SHA, message, file count, entity diff badges
  - In-flight workflow → progress bar visible
  - Click SHA → opens GitHub commit link
  - **Depends on:** P5-UI-01, P5-API-09
  - **Files:** `e2e/activity-feed.spec.ts`
  - Notes: _____

### Manual Verification

- [ ] **P5-TEST-10: Manual incremental indexing test** — L
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
    cascade.ts                   ← Cascade re-justification: buildCascadeQueue(), isSignificantChange()
    edge-repair.ts               ← Scoped cross-file edge repair: repairEdges()
  temporal/
    workflows/
      incremental-index.ts       ← incrementalIndexWorkflow (diff-based, fan-out per batch)
      reconciliation.ts          ← Periodic cron: detect stale repos, trigger re-index
    activities/
      incremental.ts             ← pullAndDiff, reIndexBatch, applyEntityDiffs, repairEdges,
                                    updateEmbeddings, cascadeReJustify, invalidateCaches, writeIndexEvent
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
```

### Modified Files

```
app/api/webhooks/github/route.ts          ← Add push event handler (currently only handles installations)
lib/temporal/activities/indexing-light.ts  ← Pass lastIndexedSha to updateRepoStatus
lib/temporal/workflows/index-repo.ts      ← Pass lastIndexedSha after writeToArango
lib/ports/graph-store.ts                  ← Add entity-by-file, edge repair, index event methods
lib/ports/git-host.ts                     ← Add pullLatest, diffFiles, getLatestSha methods
lib/adapters/arango-graph-store.ts        ← Implement new methods + bootstrapGraphSchema additions
lib/adapters/github-host.ts               ← Implement pullLatest, diffFiles, getLatestSha
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
