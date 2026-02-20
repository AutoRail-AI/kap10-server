# Phase 3 — Semantic Search (LlamaIndex + Hybrid): Deep Dive & Implementation Tracker

> **Phase Feature Statement:** _"I can search my codebase by meaning, not just keywords. 'functions that handle authentication' returns auth middleware, login handlers, session validators."_
>
> **Source:** [`VERTICAL_SLICING_PLAN.md`](./VERTICAL_SLICING_PLAN.md) — Phase 3
>
> **Prerequisites:** [Phase 1 — GitHub Connect & Repo Indexing](./PHASE_1_GITHUB_CONNECT_AND_INDEXING.md) (entities in ArangoDB), [Phase 2 — Hosted MCP Server](./PHASE_2_HOSTED_MCP_SERVER.md) (MCP tool registration pattern, rate limiter, truncation, workspace resolution)
>
> **Database convention:** All kap10 Supabase tables use PostgreSQL schema `kap10`. See [VERTICAL_SLICING_PLAN.md § Storage & Infrastructure Split](./VERTICAL_SLICING_PLAN.md#storage--infrastructure-split).

---

## Table of Contents

- [Part 1: Architectural Deep Dive](#part-1-architectural-deep-dive)
  - [1.1 Core User Flows](#11-core-user-flows)
  - [1.2 System Logic & State Management](#12-system-logic--state-management)
  - [1.3 Reliability & Resilience](#13-reliability--resilience)
  - [1.4 Performance Considerations](#14-performance-considerations)
  - [1.5 Phase Bridge → Phase 4](#15-phase-bridge--phase-4)
- [Part 2: Implementation & Tracing Tracker](#part-2-implementation--tracing-tracker)
  - [2.1 Infrastructure Layer](#21-infrastructure-layer)
  - [2.2 Database & Schema Layer](#22-database--schema-layer)
  - [2.3 Ports & Adapters Layer](#23-ports--adapters-layer)
  - [2.4 Backend / API Layer](#24-backend--api-layer)
  - [2.5 Frontend / UI Layer](#25-frontend--ui-layer)
  - [2.6 Testing & Verification](#26-testing--verification)

---

# Part 1: Architectural Deep Dive

## 1.1 Core User Flows

Phase 3 has four actor journeys. Two are system-initiated (embedding generation), two are user-initiated (search).

### Flow 1: Embedding Generation on Repo Index Completion

**Actor:** System (Temporal orchestration)
**Precondition:** `indexRepoWorkflow` (Phase 1) has completed successfully — entities exist in ArangoDB
**Outcome:** Every entity in the repo has a 768-dimensional vector stored in pgvector; the repo is searchable by meaning

```
Step  System Action                                                         State Change
────  ──────────────────────────────────────────────────────────────────────  ──────────────────────────────
1     indexRepoWorkflow completes →                                         Repo status: "indexed"
      signals Phase 3 trigger
2     Temporal: startWorkflow("embedRepoWorkflow",                          Repo status: "embedding"
      { orgId, repoId })                                                    Supabase: kap10.repos.status
3     Activity: fetchEntities                                               None (read-only)
      → ArangoDB query: all entities for org_id + repo_id
      → Return entity docs with name, signature, body, file_path, kind
4     Activity: buildDocuments                                              None (in-memory transform)
      → For each entity, construct a LlamaIndex Document:
        - text: formatted entity text (name + signature + body + file context)
        - metadata: { orgId, repoId, entityKey, entityType, entityName, filePath }
      → Batch into chunks of 100 documents
5     Activity: generateEmbeds                                              None (in-memory vectors)
      → For each batch of 100 documents:
        - HuggingFaceEmbedding (nomic-embed-text-v1.5) generates 768-dim vectors
        - Local CPU execution in Temporal light-llm-queue worker
        - No API call, no cost, no rate limit
      → Return: pairs of (document, embedding vector)
6     Activity: storeInPGVector                                             Supabase: kap10.entity_embeddings
      → LlamaIndex PGVectorStore.add() with createTable: false              rows inserted/upserted
        (Prisma owns the schema)
      → Upsert by (repo_id, entity_key) composite — idempotent on retry
7     Workflow completes →                                                  Repo status: "ready"
      update repo status                                                    Supabase: kap10.repos.status
```

**Trigger mechanism:** The `indexRepoWorkflow` (Phase 1) uses Temporal's `continueAsNew` or a parent workflow pattern to chain into `embedRepoWorkflow`. Alternatively, the final activity of `indexRepoWorkflow` starts the embed workflow as a child workflow. The exact mechanism depends on whether we want independent retry boundaries (separate workflow = yes, recommended) vs. tight coupling (child workflow).

**Decision: Separate workflow, not child workflow.** Rationale:
- Independent retry: if embedding fails, re-indexing isn't required
- Independent timeout: embedding a 10K-entity repo takes 5-15 minutes; indexing takes 2-10 minutes. Different timeout budgets.
- The dashboard can show "Indexed, embedding in progress" as a distinct state

**Chaining approach:** The `POST /api/repos` handler (or the indexing workflow's completion handler) calls `workflowEngine.startWorkflow("embedRepoWorkflow", ...)` after the indexing workflow completes. The repo status transitions: `pending` → `indexing` → `embedding` → `ready`.

### Flow 2: Embedding Update on Incremental Re-Index

**Actor:** System (push webhook → incremental re-index in Phase 5)
**Precondition:** Repo is already indexed and embedded; a push event triggers incremental re-indexing
**Outcome:** Only changed entities get re-embedded; unchanged embeddings are preserved

> **Note:** Full incremental indexing is Phase 5. In Phase 3, re-indexing triggers a full re-embed of the entire repo. The incremental embedding optimization (diff-based re-embed) ships in Phase 5. Phase 3 must design the `entity_embeddings` table to support this — specifically, the `(repo_id, entity_key)` upsert pattern ensures idempotency.

```
Step  System Action                                                         State Change
────  ──────────────────────────────────────────────────────────────────────  ──────────────────────────────
1     Push webhook → indexRepoWorkflow (re-index)                           Repo status: "indexing"
2     Re-index completes → embedRepoWorkflow starts                         Repo status: "embedding"
3     fetchEntities returns ALL current entities                            None
4     buildDocuments + generateEmbeds (full repo)                           None
5     storeInPGVector upserts all embeddings                                Updated rows in entity_embeddings
6     deleteOrphanedEmbeddings:                                             Removed rows for deleted entities
      DELETE FROM entity_embeddings
      WHERE repo_id = ? AND entity_key NOT IN (current entity keys)
7     Workflow completes                                                    Repo status: "ready"
```

**Phase 5 optimization path:** The `deleteOrphanedEmbeddings` step and the full-repo re-embed are Phase 3's simple approach. Phase 5 introduces entity hash diffing — only entities whose content hash changed get re-embedded. The `entity_key` + content hash pattern is already established in Phase 1's entity hashing. Phase 3's schema must not block this optimization (it doesn't — upsert by `entity_key` is inherently diff-friendly).

### Flow 3: Semantic Search via MCP Tool

**Actor:** AI agent (via MCP client — Cursor, Claude Code, VS Code)
**Precondition:** Repo is in `ready` status (indexed + embedded); MCP session authenticated
**Outcome:** Agent receives semantically relevant code entities with graph context

```
Step  Actor Action                     System Action                                           Response
────  ──────────────────────────────   ──────────────────────────────────────────────────────   ─────────────────────────
1     Agent calls MCP tool:            MCP server receives tool call                            —
      semantic_search({
        query: "functions that
          validate permissions",
        limit: 10
      })
2                                      Hybrid search pipeline:                                  —
                                       a) Embed query via nomic-embed-text (local, <50ms)
                                       b) pgvector: cosine similarity search (top 20)
                                       c) ArangoDB: fulltext search on entity names+bodies (top 20)
                                       d) Reciprocal Rank Fusion: merge + de-duplicate
                                       e) Take top `limit` (default 10)
3                                      Graph enrichment (ArangoDB):                             —
                                       For each result entity:
                                       - File path + line range
                                       - Callers (1-hop)
                                       - Callees (1-hop)
                                       - Parent class/module
4                                      Semantic truncation (Phase 2):                           —
                                       Apply MAX_RESPONSE_BYTES limit
                                       Paginate if necessary
5                                      Return MCP tool response                                JSON with entities,
                                                                                                scores, graph context
```

**Query embedding reuse:** The query embedding is generated using the same `nomic-embed-text-v1.5` model and the same embedding function as the index-time embeddings. This ensures cosine similarity is meaningful (same vector space).

**Multi-tenancy enforcement:** All queries include `org_id` and `repo_id` filters. pgvector queries use a WHERE clause on these columns. ArangoDB fulltext queries already scope by `org_id` (established in Phase 0's pool-based multi-tenancy). Cross-tenant data leakage is architecturally impossible.

### Flow 4: Find Similar via MCP Tool

**Actor:** AI agent (via MCP client)
**Precondition:** Same as Flow 3
**Outcome:** Agent receives entities structurally/semantically similar to a reference entity

```
Step  Actor Action                     System Action                                           Response
────  ──────────────────────────────   ──────────────────────────────────────────────────────   ─────────────────────────
1     Agent calls MCP tool:            MCP server receives tool call                            —
      find_similar({
        entityKey: "fn_validateJWT",
        limit: 5
      })
2                                      Look up existing embedding for entityKey                 —
                                       → pgvector: SELECT embedding FROM entity_embeddings
                                         WHERE entity_key = ? AND repo_id = ?
3                                      If embedding exists:                                     —
                                         pgvector nearest-neighbor search
                                         (exclude self from results)
                                       If no embedding:
                                         Fetch entity body from ArangoDB →
                                         embed on-the-fly → search
4                                      Graph enrichment (same as Flow 3)                        —
5                                      Return MCP tool response                                Similar entities with
                                                                                                scores + context
```

**Edge case — entity without embedding:** If a workspace overlay entity (Phase 2 Shadow Workspace) hasn't been embedded yet (it exists only in the overlay, not in the persisted graph), the system embeds it on-the-fly. This adds ~50ms latency but avoids returning an error. The on-the-fly embedding is NOT persisted — workspace overlays are ephemeral.

### Flow 5: Dashboard Search

**Actor:** Authenticated user (browser)
**Precondition:** Repo is in `ready` status; user has access to the organization
**Outcome:** User sees search results in the dashboard with entity details

```
Step  Actor Action                     System Action                                           State Change
────  ──────────────────────────────   ──────────────────────────────────────────────────────   ─────────────────────────
1     User navigates to search page    Server component renders search UI                       None
      or uses global search bar
2     User types query:                Client-side debounce (300ms)                             None
      "authentication middleware"       → GET /api/search?q=...&repoId=...&mode=hybrid
3                                      API route:                                               None
                                       a) Validate session (Better Auth)
                                       b) Validate org membership
                                       c) Call hybrid search pipeline (same as MCP Flow 3)
                                       d) Return JSON results
4                                      Dashboard renders results:                               None
                                       - Entity name + kind (function/class/interface)
                                       - File path (clickable → GitHub)
                                       - Relevance score (visual bar)
                                       - Snippet of body (first 3 lines)
                                       - Callers/callees count
```

**Search modes:** The dashboard search supports three modes via a dropdown:
1. **Hybrid** (default) — keyword + semantic + graph enrichment (full pipeline)
2. **Semantic only** — pgvector cosine similarity only (useful for "find code like X")
3. **Keyword only** — ArangoDB fulltext only (useful for exact name/identifier matches)

The API route accepts `mode=hybrid|semantic|keyword` as a query parameter. The MCP tools always use `hybrid` mode (agents benefit most from the combined pipeline).

---

## 1.2 System Logic & State Management

### Data Flow Architecture

```
                    ┌──────────────────────────────────────────────────────────┐
                    │  Phase 1: Indexing Pipeline                              │
                    │                                                          │
                    │  SCIP → entities + edges → ArangoDB                      │
                    │                             (graph store)                │
                    └──────────────┬───────────────────────────────────────────┘
                                   │ entities exist
                                   ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  Phase 3: Embedding Pipeline                                                 │
│                                                                              │
│  ┌─────────────┐    ┌──────────────────┐    ┌────────────────────────────┐  │
│  │ fetchEntities│───▶│ buildDocuments   │───▶│ generateEmbeds             │  │
│  │              │    │                  │    │                            │  │
│  │ ArangoDB     │    │ Entity → text    │    │ nomic-embed-text-v1.5      │  │
│  │ query        │    │ formatting       │    │ via @xenova/transformers   │  │
│  │              │    │                  │    │ LOCAL CPU, $0, no limits   │  │
│  └─────────────┘    └──────────────────┘    └────────────┬───────────────┘  │
│                                                           │                  │
│                                                           ▼                  │
│                                              ┌────────────────────────────┐  │
│                                              │ storeInPGVector            │  │
│                                              │                            │  │
│                                              │ LlamaIndex PGVectorStore   │  │
│                                              │ → Supabase PostgreSQL      │  │
│                                              │   (kap10.entity_embeddings)│  │
│                                              └────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
                                   │ embeddings ready
                                   ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  Phase 3: Hybrid Search Pipeline                                             │
│                                                                              │
│  Query                                                                       │
│    │                                                                         │
│    ├──► pgvector (semantic)  ──► top 20 candidates (by cosine similarity)    │
│    │    Supabase PostgreSQL       with score + metadata                       │
│    │                                                                         │
│    ├──► ArangoDB (keyword)   ──► top 20 candidates (by fulltext match)       │
│    │    fulltext index             with score                                │
│    │                                                                         │
│    ▼                                                                         │
│  Reciprocal Rank Fusion                                                      │
│    │  merge + de-duplicate by entity_key                                     │
│    │  RRF score = Σ 1/(k + rank_i) for each source                          │
│    ▼                                                                         │
│  Graph Enrichment (ArangoDB)                                                 │
│    │  For top N results:                                                     │
│    │  - file path, line range, parent class/module                            │
│    │  - 1-hop callers + callees                                              │
│    ▼                                                                         │
│  Semantic Truncation (Phase 2)                                               │
│    └──► Final response (respects MAX_RESPONSE_BYTES)                         │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Document Construction Strategy

How an ArangoDB entity is transformed into a LlamaIndex `Document` for embedding:

```
Entity from ArangoDB:
{
  "_key": "fn_validateJWT",
  "name": "validateJWT",
  "kind": "function",
  "signature": "(token: string, options?: JWTOptions) => Promise<JWTPayload>",
  "body": "export async function validateJWT(token: string, ...) { ... }",
  "file_path": "lib/auth/jwt.ts",
  "org_id": "org_abc",
  "repo_id": "repo_123"
}

                    ▼ buildDocuments transform

LlamaIndex Document:
{
  text: "Function: validateJWT\n" +
        "File: lib/auth/jwt.ts\n" +
        "Signature: (token: string, options?: JWTOptions) => Promise<JWTPayload>\n" +
        "\n" +
        "export async function validateJWT(token: string, ...) { ... }",
  metadata: {
    orgId: "org_abc",
    repoId: "repo_123",
    entityKey: "fn_validateJWT",
    entityType: "function",
    entityName: "validateJWT",
    filePath: "lib/auth/jwt.ts"
  }
}
```

**Text formatting rationale:**
- **Kind prefix** ("Function:", "Class:", "Interface:") — helps the embedding model distinguish between structural types. "authentication function" should match functions, not classes named `AuthConfig`.
- **File path included** — directory structure is semantic signal. `lib/auth/jwt.ts` contains implicit context that this is auth-related infrastructure.
- **Signature before body** — the signature is a compact semantic summary. For large function bodies, the signature alone may carry enough meaning. LlamaIndex's chunking respects this ordering.

**Chunking strategy:** Most code entities fit within the embedding model's 8192-token context window. For entities with very large bodies (>8000 tokens — rare, typically generated code), the system truncates the body to the first 6000 tokens and appends `\n[truncated — {totalTokens} tokens total]`. The name, kind, path, and signature are never truncated — they carry the highest semantic density.

### Embedding Model Selection

| Criteria | nomic-embed-text-v1.5 | text-embedding-3-small (OpenAI) | text-embedding-3-large (OpenAI) |
|----------|----------------------|--------------------------------|--------------------------------|
| **Dimensions** | 768 | 1536 | 3072 |
| **Cost per 1K tokens** | $0 (local CPU) | $0.00002 | $0.00013 |
| **Quality (MTEB avg)** | 0.627 | 0.620 | 0.644 |
| **Rate limits** | None (local) | 3000 RPM | 3000 RPM |
| **Latency (single embed)** | ~15ms (CPU) | ~100ms (API) | ~120ms (API) |
| **Batch throughput** | ~200 entities/sec (CPU) | ~30 entities/sec (rate limited) | ~25 entities/sec (rate limited) |
| **Parallelism** | Unlimited (spawn workers) | Rate limited | Rate limited |
| **Privacy** | Code never leaves infra | Code sent to OpenAI API | Code sent to OpenAI API |

**Decision: nomic-embed-text-v1.5 via `@xenova/transformers`.** Rationale:
1. **$0 cost** — embedding 50,000 entities costs nothing. OpenAI would cost ~$5-15 per repo depending on code density.
2. **No rate limits** — can embed an entire repo in one batch without throttling. Critical for large monorepos.
3. **Quality parity** — MTEB scores show nomic is competitive with OpenAI's small model and only slightly behind the large model. For code search (not general NLP), the difference is negligible.
4. **Privacy** — source code never leaves the infrastructure. Enterprise customers care deeply about this.
5. **Runs on CPU** — the Temporal `light-llm-queue` worker doesn't need a GPU. The model runs via ONNX runtime in `@xenova/transformers`.

**Forward-compatibility:** If a future phase requires higher-quality embeddings (e.g., for cross-language code search), the `IVectorSearch` port abstracts the embedding model. Swapping nomic for a different model requires changing one adapter — the pipeline, storage, and search logic remain identical.

### Reciprocal Rank Fusion (RRF)

The hybrid search merges results from two independent retrieval systems (pgvector semantic search and ArangoDB fulltext search). RRF is a simple, robust fusion algorithm that doesn't require score normalization (which is problematic because pgvector cosine scores and ArangoDB BM25 scores are on different scales).

```
Algorithm: Reciprocal Rank Fusion

Input:
  - rankings: list of ranked result lists (one per retrieval source)
  - k: smoothing constant (default: 60)
  - limit: max results to return

For each entity appearing in any ranking:
  rrf_score = 0
  For each ranking where the entity appears:
    rrf_score += 1 / (k + rank_position)

Sort entities by rrf_score descending
Return top `limit` entities
```

**Why k=60:** This is the standard value from the original RRF paper (Cormack et al., 2009). It prevents low-ranked results from being dominated by high-ranked results while still giving meaningful weight to top-5 results.

**De-duplication:** An entity may appear in both keyword and semantic results. RRF naturally handles this — duplicates get a higher combined score (as intended). The merge step uses `entity_key` as the de-duplication key.

### ArangoDB Fulltext Search

Phase 2 already adds fulltext indexes on ArangoDB entity documents (P2-DB-04). Phase 3 leverages these indexes for the keyword leg of hybrid search.

**Fulltext query construction:** The user's natural language query is tokenized, and stop words are removed. The remaining tokens are used as ArangoDB fulltext search terms. Example:

```
User query: "functions that validate user permissions"
Tokens after stop-word removal: ["functions", "validate", "user", "permissions"]
ArangoDB fulltext query: FULLTEXT(entities, "name,body", "validate,user,permissions", "prefix:validate,prefix:user,prefix:permissions")
```

The fulltext search targets the `name` and body-summary fields (not the full body — fulltext indexing large bodies is expensive and noisy). The `prefix:` modifier enables partial matching (e.g., "valid" matches "validate", "validation", "validator").

### Repo Status State Machine

Phase 3 introduces the `embedding` state to the repo lifecycle:

```
pending ──► indexing ──► embedding ──► ready
               │             │           │
               ▼             ▼           ▼
           index_failed  embed_failed  (operational)
               │             │
               ▼             ▼
           (retry)        (retry — re-embed only, no re-index)
```

**Key state transitions:**
- `indexing → embedding`: Automatic, triggered by `indexRepoWorkflow` completion
- `embedding → ready`: Automatic, triggered by `embedRepoWorkflow` completion
- `embedding → embed_failed`: On workflow failure after all retries exhausted
- `embed_failed → embedding`: Manual retry via dashboard button or automatic retry after fix

**Dashboard impact:** The repo card shows the current status. Phase 3 adds:
- "Embedding..." status with progress indicator (percentage of entities embedded)
- "Embedding failed" status with retry button
- "Ready" status badge (repo is fully searchable)

The progress is reported by the `generateEmbeds` activity via Temporal heartbeat: `Context.current().heartbeat({ entitiesProcessed, totalEntities })`.

### Multi-tenancy in pgvector

All pgvector queries MUST include tenant scoping. The `entity_embeddings` table has `org_id` and `repo_id` columns indexed together. Every query adds:

```sql
WHERE org_id = $orgId AND repo_id = $repoId
```

**Cross-repo search (future):** Phase 3 scopes search to a single repo. A future enhancement could allow searching across all repos in an org by removing the `repo_id` filter. The schema supports this — `org_id` alone is a valid filter. However, cross-repo search introduces ranking challenges (how to weight results from different repos) and is deferred.

**Index strategy:** An IVFFlat or HNSW index on the `embedding` column, partitioned by `repo_id`, provides efficient approximate nearest-neighbor search. For repos with <100K entities (vast majority), exact search (`<=>` operator without index) is fast enough (<50ms). HNSW is recommended for repos exceeding 100K entities.

```sql
-- HNSW index for cosine distance, filtered by repo
CREATE INDEX idx_entity_embeddings_hnsw
ON kap10.entity_embeddings
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Composite index for tenant scoping + lookup
CREATE INDEX idx_entity_embeddings_repo_entity
ON kap10.entity_embeddings (repo_id, entity_key);
```

---

## 1.3 Reliability & Resilience

### Failure Scenario Matrix

| # | Failure | Detection | Recovery | Impact |
|---|---------|-----------|----------|--------|
| 1 | **Model load failure** — `@xenova/transformers` fails to download or load `nomic-embed-text-v1.5` ONNX model on first run | Activity throws `ModelLoadError` | Temporal retries activity (3 retries, 30s backoff). Model is cached after first successful load in `~/.cache/huggingface`. Worker restart re-downloads if cache is corrupted. | First embed is ~30s slower (model download). Subsequent embeds use cached model. |
| 2 | **OOM during embedding** — Large entity batch causes Node.js heap exhaustion | Process crash → Temporal activity timeout | Temporal retries from last heartbeat. Reduce batch size on retry (100 → 50 → 25 entities per batch). Adaptive batch sizing based on entity body length. | Temporary delay. Automatic recovery via reduced batch size. |
| 3 | **pgvector insert failure** — Supabase connection pool exhausted or transaction timeout | `PGVectorStore.add()` throws `ConnectionError` or `TimeoutError` | Temporal retries activity. Exponential backoff (1s, 2s, 4s). Connection pool has max 10 connections. If sustained, circuit breaker opens (fail-fast for 60s). | Embeddings delayed but not lost — entities are re-fetched and re-embedded on retry. |
| 4 | **ArangoDB fulltext query timeout** — Complex fulltext query exceeds 5s timeout | Query timeout error from `arangojs` | Hybrid search degrades gracefully: return semantic-only results with a `_meta.degraded: true` flag. Log warning for monitoring. | User gets semantic results only. Keyword results omitted. UX is degraded but functional. |
| 5 | **Stale embeddings after re-index** — Entities deleted in ArangoDB but embeddings remain in pgvector | Orphaned rows detected by `deleteOrphanedEmbeddings` step | The `embedRepoWorkflow` always runs `deleteOrphanedEmbeddings` as its final activity. This compares current ArangoDB entity keys against pgvector entity keys and deletes orphans. | Search may briefly return stale results during the re-embed window. Acceptable — eventual consistency. |
| 6 | **Embedding dimension mismatch** — Model version change produces different-dimension vectors | `PGVectorStore.add()` throws dimension error (e.g., inserting 384-dim into 768-dim column) | Fail loudly — this is a deployment error, not a runtime error. Alert ops. Fix: ensure model version is pinned in the worker Docker image. | Blocks embedding pipeline until fixed. Existing embeddings remain valid. |
| 7 | **Concurrent embed workflows for same repo** — User triggers re-index while embedding is in progress | Temporal workflow ID uses `embed-{orgId}-{repoId}` — duplicate start is rejected (or terminates-and-restarts) | Temporal's idempotency guarantee: same workflow ID = same execution. New start request terminates the old workflow and starts fresh. | No duplicate work. The new workflow re-embeds from scratch (correct — ArangoDB entities may have changed). |
| 8 | **pgvector search returns 0 results** — Repo has embeddings but query is too dissimilar | Empty result set from cosine similarity search | Fall back to keyword-only search. If keyword also returns 0, return empty results with a helpful message: "No results found. Try a broader query or different terms." | User sees fallback results or a clear empty state. |
| 9 | **Temporal worker crash mid-batch** — Worker process killed during `generateEmbeds` | Temporal detects activity timeout (heartbeat timeout: 60s) | Temporal reschedules the activity on another worker. The activity uses heartbeats to report progress (`{ batchIndex, totalBatches }`). On retry, the activity can optionally skip already-embedded batches by checking pgvector for existing keys. | Partial embedding work may be duplicated (upsert is idempotent — no data corruption). |

### Graceful Degradation Strategy

The hybrid search pipeline is designed to degrade gracefully when individual components fail:

```
Full pipeline (normal):
  semantic (pgvector) + keyword (ArangoDB fulltext) + graph enrichment (ArangoDB)
  → RRF merge → truncation → response

Degraded mode 1 — ArangoDB fulltext unavailable:
  semantic (pgvector) + graph enrichment (ArangoDB)
  → skip RRF, use semantic ranking only → truncation → response
  → _meta.degraded: { keyword: false, reason: "ArangoDB fulltext timeout" }

Degraded mode 2 — pgvector unavailable:
  keyword (ArangoDB fulltext) + graph enrichment (ArangoDB)
  → skip RRF, use keyword ranking only → truncation → response
  → _meta.degraded: { semantic: false, reason: "pgvector connection failed" }

Degraded mode 3 — Both search backends unavailable:
  → Return error: "Search is temporarily unavailable. Please try again."
  → HTTP 503 with Retry-After header

Degraded mode 4 — Graph enrichment unavailable:
  semantic + keyword → RRF merge → truncation → response (without callers/callees)
  → _meta.degraded: { graphEnrichment: false, reason: "ArangoDB graph timeout" }
```

**Implementation:** Each leg of the pipeline runs with an independent timeout (semantic: 3s, keyword: 3s, graph enrichment: 2s). If a leg times out, the pipeline continues with available results. The `_meta.degraded` field in the MCP response tells the agent which data sources were unavailable.

### Embedding Model Caching

The `nomic-embed-text-v1.5` ONNX model (~500 MB) is downloaded on first use and cached in the worker's filesystem at `~/.cache/huggingface/`. In Docker:

- **Development:** Cache is ephemeral (container restart re-downloads). Acceptable for dev.
- **Production:** The model is baked into the Docker image during build (`Dockerfile.light-worker` runs a warm-up step that pre-downloads the model). This eliminates cold-start latency.

```
# In Dockerfile.light-worker (Phase 3 addition)
RUN node -e "const { pipeline } = require('@xenova/transformers'); pipeline('feature-extraction', 'nomic-ai/nomic-embed-text-v1.5')"
```

---

## 1.4 Performance Considerations

### Latency Budgets

| Operation | Target | Bottleneck | Mitigation |
|-----------|--------|------------|------------|
| **Single entity embedding** | <20ms | ONNX inference on CPU | Batch embeddings (amortize model load). nomic-embed-text-v1.5 is optimized for CPU inference via ONNX. |
| **Batch embedding (100 entities)** | <2s | Sequential inference in `@xenova/transformers` | Process batches in parallel across Temporal activity executions (fan-out pattern). Each activity handles one batch. |
| **Full repo embedding (5K entities)** | <3 min | Total inference time + pgvector insert | 50 batches × 2s = 100s inference + 50 × 200ms insert = 10s. Well within budget. |
| **Full repo embedding (50K entities — large monorepo)** | <15 min | Total inference + insert at scale | 500 batches. Consider parallelizing across multiple activity executions (Temporal fan-out). |
| **Semantic search (pgvector)** | <100ms | pgvector ANN search + SQL overhead | HNSW index. For repos <100K entities, exact search is <50ms. |
| **Keyword search (ArangoDB)** | <50ms | Fulltext index query | ArangoDB fulltext index already optimized in Phase 2. |
| **Hybrid search (full pipeline)** | <300ms | Serial: embed query + pgvector + ArangoDB + RRF + graph enrichment | Parallelize pgvector and ArangoDB queries (Promise.all). Graph enrichment batches N-hop lookups. |
| **Query embedding** | <50ms | Single-vector inference | Trivial — one forward pass of the embedding model. |
| **Dashboard search (E2E)** | <500ms | API route + hybrid search + JSON serialization | Client-side debounce (300ms) prevents excessive queries during typing. Server cache (Redis) for repeated queries. |

### Memory Budget

| Component | Memory | Notes |
|-----------|--------|-------|
| nomic-embed-text-v1.5 ONNX model (loaded) | ~500 MB | Loaded once per worker process, shared across all embedding operations |
| Batch of 100 entity Documents (in-memory) | ~5-20 MB | Depends on entity body sizes. Freed after each batch. |
| 100 embedding vectors (768-dim, float32) | ~0.3 MB | Trivial |
| pgvector connection pool | ~10 MB | 10 connections × ~1 MB each |

**Total light-llm-queue worker memory (Phase 3):** ~600 MB baseline + ~20 MB per batch. The worker should have at least 1 GB allocated (already established in Phase 0).

**Supabase storage:** Each embedding row is ~3.1 KB (768 float32 values = 3072 bytes + metadata ~100 bytes). A 10K-entity repo requires ~31 MB of pgvector storage. A 50K-entity repo requires ~155 MB. Supabase Pro plans include 8 GB of database storage — this comfortably supports hundreds of repos.

### Caching Strategy

| What | Cache | TTL | Invalidation |
|------|-------|-----|-------------|
| **Query embeddings** | Redis | 1 hour | Same query text → same vector. Cache key: `embed:query:{sha256(query)}` |
| **Search results** | Redis | 5 minutes | Cache key: `search:{orgId}:{repoId}:{sha256(query)}:{mode}`. Invalidated on repo re-index (embed workflow completion publishes cache-bust event). |
| **Graph enrichment data** | Redis | 10 minutes | Cache key: `graph:enrichment:{orgId}:{entityKey}`. Invalidated on entity change. |
| **ONNX model** | Filesystem | Permanent | Baked into Docker image. Only changes on worker image rebuild. |

**Cache-busting on re-embed:** When `embedRepoWorkflow` completes, it publishes a cache invalidation event: `cacheStore.deletePattern("search:{orgId}:{repoId}:*")`. This ensures stale search results are never served after re-indexing.

### Indexing Throughput Estimates

| Repo size | Entity count | Embedding time | pgvector insert time | Total workflow time |
|-----------|-------------|----------------|---------------------|---------------------|
| Small (100 files) | ~500 entities | ~10s | ~2s | ~15s |
| Medium (1K files) | ~5,000 entities | ~100s | ~10s | ~2 min |
| Large (5K files) | ~25,000 entities | ~500s | ~50s | ~10 min |
| Monorepo (10K+ files) | ~50,000 entities | ~1000s | ~100s | ~20 min |

These are conservative estimates assuming single-worker, serial batch processing. Temporal fan-out (parallel activities) can reduce the large/monorepo times by 3-5x.

---

## 1.5 Phase Bridge → Phase 4

Phase 3 establishes the semantic search foundation that Phase 4 (Business Justification & Taxonomy) directly builds upon. Here is how Phase 3's architecture cleanly hands off:

### What Phase 4 Consumes from Phase 3

| Phase 3 artifact | Phase 4 usage |
|-----------------|---------------|
| **Entity embeddings (pgvector)** | Phase 4's `justifyRepoWorkflow` uses embeddings to find semantically related entities when building context for LLM justification. Instead of sending raw code to the LLM, it retrieves the top-5 similar entities as additional context ("here are related functions — what does this one do in the bigger picture?"). |
| **Hybrid search pipeline** | Phase 4's `search_by_purpose` MCP tool is a thin wrapper around Phase 3's hybrid search with an additional LLM re-ranking step. The pipeline is reused as-is. |
| **IVectorSearch port** | Phase 4's justification pipeline calls `vectorSearch.search()` to find semantically similar entities for context enrichment. No new port methods needed. |
| **LlamaIndex PGVectorStore** | Phase 4 does not add new vector data — it consumes the existing embeddings. The store is read-only from Phase 4's perspective. |
| **nomic-embed-text model** | Phase 4 may embed LLM-generated justification text for future retrieval ("find entities with similar business purpose"). This reuses the same model and pipeline — no new embedding infrastructure. |

### What Phase 3 Must NOT Do (to avoid Phase 4 rework)

1. **Do not embed justification text in Phase 3.** Justifications don't exist yet — they're created in Phase 4. Phase 3 embeds entity code only. Phase 4 may add a second embedding column or a separate table for justification embeddings.
2. **Do not add taxonomy fields to `entity_embeddings`.** The `entityType` metadata field stores the SCIP-derived kind (function, class, interface). Phase 4's VERTICAL/HORIZONTAL/UTILITY classification is a separate concept stored in ArangoDB, not pgvector.
3. **Do not couple the embedding pipeline to any specific LLM.** Phase 3 uses local embeddings only. Phase 4 introduces Vercel AI SDK for LLM calls — these must be independent. The `IVectorSearch` port and `ILLMProvider` port are separate interfaces.

### Schema Forward-Compatibility

The `entity_embeddings` Prisma model is designed for Phase 5's incremental re-embedding:

- **`entity_key` column:** Matches ArangoDB's entity `_key`. Phase 5's entity hash diff uses this to identify which entities changed and need re-embedding.
- **Upsert pattern:** `storeInPGVector` uses upsert by `(repo_id, entity_key)`. Phase 5 can re-embed only changed entities without touching unchanged ones.
- **`text_content` column:** Stores the exact text that was embedded. Phase 5 can compare this against the current entity body to detect content changes without re-computing the hash.

### Infrastructure Forward-Compatibility

- **Temporal workflow separation:** `embedRepoWorkflow` is independent of `indexRepoWorkflow`. Phase 5 introduces `incrementalIndexWorkflow` which chains into a partial `embedRepoWorkflow` (only changed entities). The workflow boundary is clean.
- **`light-llm-queue`:** All Phase 3 activities run on the light queue (network/CPU-bound, not heavy-compute). Phase 4's LLM calls also run on this queue. No queue changes needed.

---

# Part 2: Implementation & Tracing Tracker

## 2.1 Infrastructure Layer

### Environment & Configuration

- [ ] **P3-INFRA-01: Add embedding model env vars to `env.mjs`** — S
  - New variables: `EMBEDDING_MODEL_NAME` (default: `"nomic-ai/nomic-embed-text-v1.5"`), `EMBEDDING_DIMENSIONS` (default: `768`), `EMBEDDING_BATCH_SIZE` (default: `100`)
  - All optional with defaults — no breaking change to existing deployments
  - **Test:** `pnpm build` succeeds. Embedding pipeline uses defaults when vars are absent.
  - **Depends on:** Nothing
  - **Files:** `env.mjs`, `.env.example`
  - Notes: _____

- [ ] **P3-INFRA-02: Pre-download embedding model in `Dockerfile.light-worker`** — S
  - Add warm-up step to `Dockerfile.light-worker` that downloads `nomic-embed-text-v1.5` ONNX model into the image layer
  - Eliminates cold-start latency (model download is ~500 MB, takes 30-60s on first run without this)
  - **Test:** `docker compose build temporal-worker-light` succeeds. Inside container: model files exist at `~/.cache/huggingface/`. Embedding a test string returns a 768-dim vector without network calls.
  - **Depends on:** Nothing
  - **Files:** `Dockerfile.light-worker` (or equivalent light worker Dockerfile)
  - Notes: _____

- [ ] **P3-INFRA-03: Update `.env.example` with Phase 3 variables** — S
  - Add: `EMBEDDING_MODEL_NAME`, `EMBEDDING_DIMENSIONS`, `EMBEDDING_BATCH_SIZE`
  - Document: comment block explaining local embedding model (no API key needed)
  - **Test:** `cp .env.example .env.local` + fill → app starts with embedding pipeline functional.
  - **Depends on:** P3-INFRA-01
  - **Files:** `.env.example`
  - Notes: _____

---

## 2.2 Database & Schema Layer

- [ ] **P3-DB-01: Add `EntityEmbedding` model to Prisma schema** — M
  - New model in `kap10` schema with fields: `id`, `orgId`, `repoId`, `entityKey`, `entityType`, `entityName`, `filePath`, `textContent`, `embedding` (`Unsupported("vector(768)")`), `createdAt`, `updatedAt`
  - Unique constraint on `(repoId, entityKey)` for upsert semantics
  - Index on `(orgId, repoId)` for tenant-scoped queries
  - Foreign key: `repoId` → `Repo.id` with `onDelete: Cascade` (deleting a repo removes all embeddings)
  - **Important:** Use `@@schema("kap10")` — all kap10 tables live in the `kap10` PostgreSQL schema
  - **Important:** `createTable: false` in LlamaIndex PGVectorStore config — Prisma owns the schema
  - **Test:** `pnpm migrate` runs migration successfully. `\d kap10.entity_embeddings` shows correct columns, constraints, and indexes.
  - **Depends on:** Nothing
  - **Files:** `prisma/schema.prisma`, new migration file
  - **Acceptance:** Table exists with correct schema. Upsert by `(repoId, entityKey)` works without constraint violation.
  - Notes: _____

- [ ] **P3-DB-02: Enable pgvector extension in Supabase** — S
  - SQL migration: `CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;`
  - Must run before the EntityEmbedding migration (Prisma can't manage extensions directly)
  - Supabase dashboard: verify `vector` extension is enabled
  - **Test:** `SELECT * FROM pg_extension WHERE extname = 'vector';` returns a row. `SELECT '[1,2,3]'::vector;` succeeds.
  - **Depends on:** Nothing
  - **Files:** `supabase/migrations/YYYYMMDDHHMMSS_enable_pgvector.sql`
  - Notes: _____

- [ ] **P3-DB-03: Create HNSW index on embedding column** — S
  - SQL migration: `CREATE INDEX idx_entity_embeddings_hnsw ON kap10.entity_embeddings USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);`
  - Also create composite index: `CREATE INDEX idx_entity_embeddings_repo_entity ON kap10.entity_embeddings (repo_id, entity_key);`
  - **Test:** `\di kap10.idx_entity_embeddings_hnsw` shows the index. Search query uses index (verify with `EXPLAIN ANALYZE`).
  - **Depends on:** P3-DB-01, P3-DB-02
  - **Files:** Same migration as P3-DB-01 or separate migration
  - **Acceptance:** Cosine similarity query on 10K embeddings completes in <100ms.
  - Notes: _____

- [ ] **P3-DB-04: Add `embedding` and `embed_failed` to `RepoStatus` enum** — S
  - Extend the `RepoStatus` Prisma enum with `embedding` and `embed_failed` values
  - **Test:** Repo status can be set to `embedding` and `embed_failed` without error.
  - **Depends on:** Nothing
  - **Files:** `prisma/schema.prisma`, new migration file
  - Notes: _____

---

## 2.3 Ports & Adapters Layer

- [ ] **P3-ADAPT-01: Implement `IVectorSearch.embed()` with nomic-embed-text** — M
  - Implement the `embed(texts: string[]): Promise<number[][]>` method using `@xenova/transformers` HuggingFaceEmbedding
  - Model: `nomic-ai/nomic-embed-text-v1.5` (768 dimensions, ONNX runtime, CPU)
  - Batch processing: handle arrays up to 100 texts
  - Error handling: wrap `@xenova/transformers` errors in domain-specific `EmbeddingError`
  - **Test:** `embed(["hello world"])` returns a `number[]` of length 768. `embed(["a", "b"])` returns 2 vectors. Cosine similarity between "authentication" and "auth middleware" > 0.7.
  - **Depends on:** P3-INFRA-01
  - **Files:** `lib/adapters/llamaindex-vector-search.ts`
  - **Acceptance:** Local CPU embedding produces consistent 768-dim vectors. No API calls made. Model cached after first load.
  - Notes: _____

- [ ] **P3-ADAPT-02: Implement `IVectorSearch.upsert()` with LlamaIndex PGVectorStore** — M
  - Implement the `upsert(ids: string[], embeddings: number[][], metadata: Record<string, unknown>[]): Promise<void>` method
  - Use LlamaIndex `PGVectorStore` with `connectionString: process.env.SUPABASE_DB_URL`, `tableName: "entity_embeddings"`, `dimensions: 768`, `createTable: false`
  - Upsert semantics: ON CONFLICT (repo_id, entity_key) DO UPDATE
  - **Test:** Upsert 10 embeddings → query → all present. Upsert same 10 with different vectors → vectors updated. Insert + upsert same key → no constraint violation.
  - **Depends on:** P3-DB-01, P3-DB-02
  - **Files:** `lib/adapters/llamaindex-vector-search.ts`
  - **Acceptance:** Embeddings persist in Supabase. Upsert is idempotent. `org_id` and `repo_id` metadata stored correctly.
  - Notes: _____

- [ ] **P3-ADAPT-03: Implement `IVectorSearch.search()` with pgvector cosine similarity** — M
  - Implement the `search(embedding: number[], topK: number, filter?: { orgId?: string; repoId?: string }): Promise<{ id: string; score: number }[]>` method
  - Use LlamaIndex `VectorStoreIndex.asRetriever()` or direct pgvector SQL: `SELECT entity_key, 1 - (embedding <=> $1) as score FROM kap10.entity_embeddings WHERE org_id = $orgId AND repo_id = $repoId ORDER BY embedding <=> $1 LIMIT $topK`
  - **Critical:** Always include `org_id` filter (multi-tenancy). `repo_id` filter is optional (default: required in Phase 3).
  - **Test:** Insert 100 embeddings. Search with a related query → top result is the most semantically similar. Search with `repoId` filter → only returns entities from that repo.
  - **Depends on:** P3-DB-03, P3-ADAPT-02
  - **Files:** `lib/adapters/llamaindex-vector-search.ts`
  - **Acceptance:** Search returns ranked results with cosine similarity scores. Multi-tenant isolation enforced. Latency <100ms for 10K embeddings.
  - Notes: _____

- [ ] **P3-ADAPT-04: Update `InMemoryVectorSearch` fake with working implementation** — S
  - The existing `InMemoryVectorSearch` fake in `lib/di/fakes.ts` must implement `embed()`, `search()`, and `upsert()` for unit tests
  - `embed()`: Return deterministic pseudo-vectors (e.g., hash of text → normalized vector)
  - `search()`: Brute-force cosine similarity over in-memory store
  - `upsert()`: Store in a `Map<string, { embedding: number[], metadata: Record<string, unknown> }>`
  - **Test:** `createTestContainer()` can run the full hybrid search pipeline with in-memory fakes.
  - **Depends on:** Nothing
  - **Files:** `lib/di/fakes.ts`
  - **Acceptance:** All Phase 3 unit tests pass with `createTestContainer()` and no external dependencies.
  - Notes: _____

- [ ] **P3-ADAPT-05: Add `searchEntities` fulltext method to `IGraphStore` (if not in Phase 2)** — S
  - Verify Phase 2's `P2-ADAPT-02` (searchEntities) is implemented. If not, implement: fulltext query on entity `name` and body-summary fields in ArangoDB
  - Input: query string, orgId, repoId, limit
  - Output: `{ entityKey: string; score: number }[]`
  - **Test:** Insert entities with known names. Fulltext search "validate" returns entities with "validate" in name/body.
  - **Depends on:** Phase 2 P2-ADAPT-02, P2-DB-04
  - **Files:** `lib/ports/graph-store.ts`, `lib/adapters/arango-graph-store.ts`
  - Notes: _____

---

## 2.4 Backend / API Layer

### Temporal Workflows & Activities

- [ ] **P3-API-01: Create `embedRepoWorkflow` Temporal workflow** — L
  - Workflow ID format: `embed-{orgId}-{repoId}` (idempotent — re-triggering same repo terminates old workflow)
  - Queue: `light-llm-queue`
  - Workflow steps:
    1. Set repo status to `embedding`
    2. Call `fetchEntities` activity
    3. Call `buildDocuments` activity
    4. Call `generateEmbeds` activity (batched, with heartbeat progress)
    5. Call `storeInPGVector` activity (batched)
    6. Call `deleteOrphanedEmbeddings` activity
    7. Set repo status to `ready`
  - On failure: set repo status to `embed_failed`
  - **Test:** Temporal workflow replay test with mock activities. Workflow completes with correct status transitions. Workflow ID prevents duplicate concurrent executions.
  - **Depends on:** P3-ADAPT-01, P3-ADAPT-02, P3-ADAPT-03, P3-DB-04
  - **Files:** `lib/temporal/workflows/embed-repo.ts`
  - **Acceptance:** Workflow executes all activities in order. Repo status transitions correctly. Failure sets `embed_failed`. Heartbeat reports progress.
  - Notes: _____

- [ ] **P3-API-02: Create `fetchEntities` activity** — M
  - Query ArangoDB for all entities matching `org_id` and `repo_id`
  - Return: array of entity docs with `_key`, `name`, `kind`, `signature`, `body`, `file_path`
  - **Test:** With 100 entities in ArangoDB fake → returns 100 entities with correct fields.
  - **Depends on:** Nothing (uses existing `IGraphStore`)
  - **Files:** `lib/temporal/activities/embedding.ts`
  - Notes: _____

- [ ] **P3-API-03: Create `buildDocuments` activity** — M
  - Transform entity docs into LlamaIndex-compatible text + metadata format
  - Text format: `"{Kind}: {name}\nFile: {filePath}\nSignature: {signature}\n\n{body}"`
  - Truncation: bodies exceeding 8000 tokens are truncated with `[truncated — {N} tokens total]`
  - Metadata: `{ orgId, repoId, entityKey, entityType, entityName, filePath }`
  - **Test:** Entity with kind "function" produces text starting with "Function: ". Large body is truncated. Metadata includes all required fields.
  - **Depends on:** P3-API-02
  - **Files:** `lib/temporal/activities/embedding.ts`
  - Notes: _____

- [ ] **P3-API-04: Create `generateEmbeds` activity** — L
  - Batch entities into groups of `EMBEDDING_BATCH_SIZE` (default 100)
  - For each batch: call `vectorSearch.embed(texts)` → receive vectors
  - Report progress via Temporal heartbeat: `{ batchIndex, totalBatches, entitiesProcessed, totalEntities }`
  - On OOM or batch failure: reduce batch size by half and retry the failed batch
  - **Test:** 100 entities → 1 batch → 100 vectors returned. 250 entities → 3 batches → heartbeat called 3 times. Batch failure → retried with half batch size.
  - **Depends on:** P3-ADAPT-01, P3-API-03
  - **Files:** `lib/temporal/activities/embedding.ts`
  - **Acceptance:** All entities embedded. Heartbeat reports accurate progress. Adaptive batch sizing handles OOM.
  - Notes: _____

- [ ] **P3-API-05: Create `storeInPGVector` activity** — M
  - For each batch of (entity, embedding) pairs: call `vectorSearch.upsert(ids, embeddings, metadata)`
  - Upsert semantics: existing embeddings for the same `entity_key` are updated
  - **Test:** Upsert 100 embeddings → all present in pgvector. Re-upsert → no duplicates.
  - **Depends on:** P3-ADAPT-02, P3-API-04
  - **Files:** `lib/temporal/activities/embedding.ts`
  - Notes: _____

- [ ] **P3-API-06: Create `deleteOrphanedEmbeddings` activity** — S
  - Query current entity keys from ArangoDB (via `IGraphStore`)
  - Delete from pgvector any rows where `entity_key NOT IN (current keys)` for the given `repo_id`
  - **Test:** Insert 100 embeddings. Remove 10 entities from ArangoDB fake. Run activity → 10 embeddings deleted, 90 remain.
  - **Depends on:** P3-ADAPT-02
  - **Files:** `lib/temporal/activities/embedding.ts`
  - **Acceptance:** Orphaned embeddings are removed. Non-orphaned embeddings are untouched.
  - Notes: _____

- [ ] **P3-API-07: Chain `embedRepoWorkflow` trigger from `indexRepoWorkflow` completion** — M
  - After `indexRepoWorkflow` completes successfully, start `embedRepoWorkflow`
  - Implementation: in the `POST /api/repos` handler (or indexing completion callback), call `workflowEngine.startWorkflow("embedRepoWorkflow", ...)` after indexing succeeds
  - Alternatively: use a Temporal signal or continuation pattern
  - **Test:** Index a repo → embedding workflow starts automatically. Index failure → embedding workflow NOT started.
  - **Depends on:** P3-API-01, Phase 1 `indexRepoWorkflow`
  - **Files:** `app/api/repos/route.ts` or `lib/temporal/workflows/index-repo.ts` (whichever handles the trigger)
  - **Acceptance:** Repo lifecycle: `pending` → `indexing` → `embedding` → `ready`. No manual intervention needed.
  - Notes: _____

### Hybrid Search Pipeline

- [ ] **P3-API-08: Create hybrid search module** — L
  - Implement the three-stage pipeline: semantic search + keyword search + RRF merge
  - Input: `{ query: string, orgId: string, repoId: string, mode: "hybrid" | "semantic" | "keyword", limit: number }`
  - Semantic leg: embed query → `vectorSearch.search()` → top 20 candidates
  - Keyword leg: `graphStore.searchEntities()` → top 20 candidates
  - Merge: Reciprocal Rank Fusion (k=60) on entity_key
  - De-duplicate: single entity appearing in both legs gets a combined RRF score
  - Mode filtering: `semantic` = skip keyword leg, `keyword` = skip semantic leg, `hybrid` = both
  - **Test:** Insert entities with known semantics. Hybrid search returns results from both legs. RRF scores are correct. De-duplication works.
  - **Depends on:** P3-ADAPT-01, P3-ADAPT-03, P3-ADAPT-05
  - **Files:** `lib/embeddings/hybrid-search.ts`
  - **Acceptance:** Hybrid search returns relevant results. `mode` parameter filters correctly. RRF merge produces a single ranked list.
  - Notes: _____

- [ ] **P3-API-09: Add graph enrichment step to hybrid search** — M
  - For each result entity from the RRF merge (top N), query ArangoDB for:
    - File path + line range (already in entity metadata)
    - 1-hop callers (via `graphStore.getCallersOf()`)
    - 1-hop callees (via `graphStore.getCalleesOf()`)
    - Parent class/module (via `graphStore.getEntity()` on parent edge)
  - Batch graph queries for efficiency (one AQL query per result set, not per entity)
  - Apply timeout: 2s max for graph enrichment. If timeout, return results without graph context + `_meta.degraded` flag.
  - **Test:** Search result includes callers/callees. Timeout produces degraded results without error.
  - **Depends on:** P3-API-08, Phase 2 graph store methods
  - **Files:** `lib/embeddings/hybrid-search.ts`
  - **Acceptance:** Each search result includes graph context. Batch queries keep latency <2s for top 10 results.
  - Notes: _____

- [ ] **P3-API-10: Apply semantic truncation to search results** — S
  - Reuse Phase 2's semantic truncation (formatter) to ensure search results respect `MAX_RESPONSE_BYTES`
  - If results exceed limit: truncate entity bodies, then reduce result count, then omit graph context
  - **Test:** 10 results with large bodies → truncated to fit within byte limit. Metadata (scores, entity keys) never truncated.
  - **Depends on:** P3-API-09, Phase 2 formatter
  - **Files:** `lib/embeddings/hybrid-search.ts`
  - Notes: _____

### MCP Tools

- [ ] **P3-API-11: Create `semantic_search` MCP tool** — M
  - Tool name: `semantic_search`
  - Input schema: `{ query: string, limit?: number (default 10, max 50) }`
  - Calls hybrid search pipeline (mode: `hybrid`)
  - Returns: array of `{ entityKey, entityName, entityType, filePath, score, snippet, callers: string[], callees: string[] }`
  - Apply rate limiting (Phase 2 rate limiter)
  - Apply secret scrubbing on results (Phase 2 scrubber)
  - **Test:** MCP tool call with query returns relevant results. Rate limiter enforced. Response within `MAX_RESPONSE_BYTES`.
  - **Depends on:** P3-API-08, P3-API-09, P3-API-10, Phase 2 MCP tool registration pattern
  - **Files:** `lib/mcp/tools/semantic.ts`
  - **Acceptance:** Tool registered in MCP server. Returns structured results. Rate limited. Secrets scrubbed.
  - Notes: _____

- [ ] **P3-API-12: Create `find_similar` MCP tool** — M
  - Tool name: `find_similar`
  - Input schema: `{ entityKey: string, limit?: number (default 5, max 20) }`
  - Flow: look up existing embedding → if exists, nearest-neighbor search (exclude self) → if not, embed entity body on-the-fly → search
  - Returns: array of `{ entityKey, entityName, entityType, filePath, similarityScore, snippet }`
  - **Test:** `find_similar("fn_validateJWT")` returns related auth functions. Entity without embedding → on-the-fly embed → results returned.
  - **Depends on:** P3-ADAPT-01, P3-ADAPT-03
  - **Files:** `lib/mcp/tools/semantic.ts`
  - **Acceptance:** Similar entities returned with meaningful similarity scores. On-the-fly embedding works for unembedded entities.
  - Notes: _____

### API Routes

- [ ] **P3-API-13: Create `GET /api/search` route** — M
  - Query parameters: `q` (required), `repoId` (required), `mode` (optional, default `hybrid`), `limit` (optional, default 10)
  - Auth: Better Auth session required. Verify user has access to org owning the repo.
  - Calls hybrid search pipeline
  - Returns: `{ results: SearchResult[], meta: { mode, totalResults, queryTimeMs, degraded? } }`
  - **Test:** Authenticated request returns search results. Unauthenticated → 401. Wrong org → 403. Invalid `mode` → 400.
  - **Depends on:** P3-API-08
  - **Files:** `app/api/search/route.ts`
  - Notes: _____

- [ ] **P3-API-14: Add Redis caching to search API** — S
  - Cache search results in Redis with TTL of 5 minutes
  - Cache key: `search:{orgId}:{repoId}:{sha256(query)}:{mode}`
  - Cache-bust on embed workflow completion (via Redis key pattern deletion)
  - **Test:** Same query twice → second hit is from cache (verify with Redis `GET`). Re-embed → cache cleared.
  - **Depends on:** P3-API-13
  - **Files:** `app/api/search/route.ts`
  - Notes: _____

---

## 2.5 Frontend / UI Layer

- [ ] **P3-UI-01: Create search page** — M
  - Route: `/dashboard/search` (or integrated into existing dashboard layout)
  - Components:
    - Search input with mode selector (Hybrid / Semantic / Keyword)
    - Repo scope selector (dropdown of user's repos)
    - Results list: entity name (bold), kind badge (function/class/interface), file path (clickable link to GitHub), relevance score (visual indicator), body snippet (first 3 lines, syntax-highlighted), callers/callees count
    - Empty state: "No results found. Try a broader query or different terms."
    - Loading state: Skeleton placeholders during search
  - Client-side debounce: 300ms before sending search request
  - **Test:** Type query → results appear. Change mode → results update. Select different repo → results scoped.
  - **Depends on:** P3-API-13
  - **Files:** `app/(dashboard)/search/page.tsx`, `components/dashboard/search-results.tsx`, `components/dashboard/search-input.tsx`
  - **Acceptance:** Search page renders. Results are relevant. Mode switching works. Repo scoping works. Design follows design system (glass-card, font-grotesk headings, etc.).
  - Notes: _____

- [ ] **P3-UI-02: Add global search bar to dashboard header** — S
  - Add a search input to the dashboard header/sidebar (existing layout)
  - Keyboard shortcut: `Cmd+K` / `Ctrl+K` to focus
  - On submit: navigate to `/dashboard/search?q={query}&repoId={activeRepoId}`
  - Inline preview: show top 3 results in a dropdown (no full-page navigation for quick lookups)
  - **Test:** `Cmd+K` focuses search bar. Typing shows inline preview. Enter navigates to search page.
  - **Depends on:** P3-UI-01, P3-API-13
  - **Files:** `components/dashboard/global-search.tsx`, `app/(dashboard)/layout.tsx` (modified)
  - Notes: _____

- [ ] **P3-UI-03: Update repo card with embedding status** — S
  - Show embedding status on the repo card:
    - "Indexing..." → "Embedding..." → "Ready" (with corresponding icons/colors)
    - "Embedding failed" → red badge with retry button
  - Progress indicator: show percentage of entities embedded (from Temporal heartbeat data via status polling)
  - **Test:** Repo in `embedding` status shows progress. `embed_failed` shows retry button. `ready` shows green badge.
  - **Depends on:** P3-DB-04, P3-API-01
  - **Files:** `components/dashboard/repos-list.tsx` (modified), `components/dashboard/repo-card.tsx` (modified)
  - **Acceptance:** Repo card reflects embedding state. Progress updates in near-real-time (polling every 5s during embedding).
  - Notes: _____

- [ ] **P3-UI-04: Add "Search" link to dashboard navigation** — S
  - Add a navigation item in the dashboard sidebar/nav for the search page
  - Icon: Lucide `Search` icon (`h-4 w-4`)
  - Active state: highlighted when on `/dashboard/search`
  - **Test:** Navigation link visible. Click navigates to search page. Active state renders correctly.
  - **Depends on:** P3-UI-01
  - **Files:** `components/dashboard/sidebar.tsx` or equivalent nav component (modified)
  - Notes: _____

---

## 2.6 Testing & Verification

### Unit Tests

- [ ] **P3-TEST-01: Embedding adapter tests** — M
  - `embed()` returns 768-dim vectors
  - `embed([])` returns empty array (no error)
  - Two semantically similar texts produce vectors with cosine similarity > 0.7
  - Two unrelated texts produce vectors with cosine similarity < 0.3
  - **Depends on:** P3-ADAPT-01
  - **Files:** `lib/adapters/__tests__/llamaindex-vector-search.test.ts`
  - Notes: _____

- [ ] **P3-TEST-02: Document builder tests** — S
  - Entity with kind "function" → text starts with "Function:"
  - Entity with kind "class" → text starts with "Class:"
  - Large body (>8000 tokens) → truncated with `[truncated — N tokens total]`
  - Metadata includes all required fields (orgId, repoId, entityKey, entityType, entityName, filePath)
  - **Depends on:** P3-API-03
  - **Files:** `lib/temporal/activities/__tests__/embedding.test.ts`
  - Notes: _____

- [ ] **P3-TEST-03: Hybrid search pipeline tests** — M
  - Mode `hybrid`: both semantic and keyword results merged
  - Mode `semantic`: only pgvector results
  - Mode `keyword`: only ArangoDB results
  - RRF merge: entity appearing in both legs gets higher score than entity in one leg
  - De-duplication: same entity from both legs → single result
  - Graceful degradation: keyword timeout → semantic-only results with `_meta.degraded`
  - **Depends on:** P3-API-08
  - **Files:** `lib/embeddings/__tests__/hybrid-search.test.ts`
  - Notes: _____

- [ ] **P3-TEST-04: RRF algorithm tests** — S
  - Two rankings with no overlap → union with correct RRF scores
  - Two rankings with full overlap → all items get double weight
  - Empty ranking → other ranking returned as-is
  - k parameter affects score distribution
  - **Depends on:** P3-API-08
  - **Files:** `lib/embeddings/__tests__/hybrid-search.test.ts`
  - Notes: _____

- [ ] **P3-TEST-05: Orphaned embedding cleanup tests** — S
  - 100 embeddings, 10 entities removed from graph store → 10 embeddings deleted after cleanup
  - 0 entities removed → 0 embeddings deleted
  - All entities removed → all embeddings deleted
  - **Depends on:** P3-API-06
  - **Files:** `lib/temporal/activities/__tests__/embedding.test.ts`
  - Notes: _____

- [ ] **P3-TEST-06: MCP tool input validation tests** — S
  - `semantic_search` with valid query → success
  - `semantic_search` with empty query → error
  - `semantic_search` with limit > 50 → clamped to 50
  - `find_similar` with valid entityKey → success
  - `find_similar` with non-existent entityKey → on-the-fly embed → search
  - **Depends on:** P3-API-11, P3-API-12
  - **Files:** `lib/mcp/tools/__tests__/semantic.test.ts`
  - Notes: _____

- [ ] **P3-TEST-07: Multi-tenancy isolation tests** — M
  - Embed entities for org A, repo 1 and org B, repo 2
  - Search from org A → only returns org A entities
  - Search from org B → only returns org B entities
  - Cross-org search attempt → empty results (not an error)
  - **Depends on:** P3-ADAPT-03
  - **Files:** `lib/adapters/__tests__/llamaindex-vector-search.test.ts`
  - Notes: _____

### Integration Tests

- [ ] **P3-TEST-08: Full embedding pipeline integration test** — L
  - End-to-end: insert entities into ArangoDB → run `embedRepoWorkflow` → verify embeddings in pgvector → search → get results
  - Requires: testcontainers (ArangoDB + PostgreSQL with pgvector)
  - **Depends on:** P3-API-01, P3-API-02, P3-API-03, P3-API-04, P3-API-05
  - **Files:** `lib/temporal/workflows/__tests__/embed-repo.integration.test.ts`
  - Notes: _____

- [ ] **P3-TEST-09: Temporal workflow replay test** — M
  - Deterministic replay of `embedRepoWorkflow` with mock activities
  - Verify: correct activity call order, status transitions, heartbeat calls, error handling
  - **Depends on:** P3-API-01
  - **Files:** `lib/temporal/workflows/__tests__/embed-repo.replay.test.ts`
  - Notes: _____

### E2E Tests

- [ ] **P3-TEST-10: Dashboard search E2E** — M
  - User navigates to search page → types "authentication" → results appear with entity names and file paths
  - User switches mode to "Keyword" → results update
  - User selects different repo → results scoped to new repo
  - **Depends on:** P3-UI-01, P3-API-13
  - **Files:** `e2e/search.spec.ts`
  - Notes: _____

- [ ] **P3-TEST-11: MCP semantic search E2E** — M
  - Connect MCP client to server → call `semantic_search` tool → receive relevant results with graph context
  - Call `find_similar` tool → receive similar entities
  - **Depends on:** P3-API-11, P3-API-12
  - **Files:** `e2e/mcp-search.spec.ts`
  - Notes: _____

### Manual Verification

- [ ] **P3-TEST-12: Manual semantic quality check** — M
  - Index a real repo (e.g., this project's codebase)
  - MCP `semantic_search` "error handling" → returns catch blocks, error boundaries, validators
  - MCP `semantic_search` "database queries" → returns Prisma calls, ArangoDB queries, SQL
  - MCP `find_similar` on a known function → returns structurally/semantically similar functions
  - Dashboard search produces the same quality results
  - **Depends on:** All P3 items
  - Notes: _____

---

## Dependency Graph

```
P3-INFRA-01 (env vars) ──── P3-INFRA-03 (.env.example)
P3-INFRA-02 (model pre-download) ── independent

P3-DB-02 (pgvector ext) ─┐
P3-DB-01 (EntityEmbedding)┤── P3-DB-03 (HNSW index)
P3-DB-04 (RepoStatus enum)┘

P3-ADAPT-01 (embed impl) ─────────┐
P3-ADAPT-02 (upsert impl) ────────┤
P3-ADAPT-03 (search impl) ────────┤── P3-API-01 (embedRepoWorkflow)
P3-ADAPT-04 (fake update) ────────┘         │
P3-ADAPT-05 (fulltext verify) ──────────────┤
                                             │
P3-API-02 (fetchEntities) ─────────┐        │
P3-API-03 (buildDocuments) ────────┤        │
P3-API-04 (generateEmbeds) ────────┤── P3-API-01 (embedRepoWorkflow)
P3-API-05 (storeInPGVector) ───────┤        │
P3-API-06 (deleteOrphaned) ────────┘        │
                                             │
P3-API-07 (chain trigger) ─── depends on P3-API-01 + Phase 1 indexRepoWorkflow
                                             │
P3-API-08 (hybrid search) ───┐              │
P3-API-09 (graph enrichment) ┤── P3-API-10 (truncation)
P3-API-10 (truncation) ──────┘              │
        │                                    │
        ├── P3-API-11 (semantic_search MCP tool)
        ├── P3-API-12 (find_similar MCP tool)
        └── P3-API-13 (search API route) ── P3-API-14 (Redis cache)
                │
                ├── P3-UI-01 (search page) ── P3-UI-02 (global search bar)
                └── P3-UI-03 (embedding status)
                    P3-UI-04 (nav link)
                        │
                        └── P3-TEST-01..12 (all tests)
```

**Recommended implementation order:**

1. **Database** (P3-DB-01..04) — Prisma migration, pgvector extension, HNSW index, status enum
2. **Infrastructure** (P3-INFRA-01..03) — Env vars, model pre-download, .env.example
3. **Adapters** (P3-ADAPT-01..05) — Vector search implementation, fake update, fulltext verify
4. **Embedding pipeline** (P3-API-01..07) — Workflow, activities, trigger chain
5. **Search pipeline** (P3-API-08..10) — Hybrid search, graph enrichment, truncation
6. **MCP tools** (P3-API-11..12) — semantic_search, find_similar
7. **API routes** (P3-API-13..14) — Search endpoint, Redis cache
8. **Frontend** (P3-UI-01..04) — Search page, global search, embedding status, nav
9. **Testing** (P3-TEST-01..12) — Unit, integration, E2E, manual

---

## New Files Summary

```
lib/
  adapters/
    llamaindex-vector-search.ts       ← IVectorSearch implementation (nomic-embed + PGVectorStore)
  embeddings/
    hybrid-search.ts                  ← Hybrid search pipeline (semantic + keyword + RRF + graph enrichment)
  mcp/
    tools/
      semantic.ts                     ← semantic_search, find_similar MCP tools
  temporal/
    workflows/
      embed-repo.ts                   ← embedRepoWorkflow definition
    activities/
      embedding.ts                    ← fetchEntities, buildDocuments, generateEmbeds, storeInPGVector, deleteOrphanedEmbeddings
app/
  api/
    search/
      route.ts                        ← GET /api/search (hybrid search API)
  (dashboard)/
    search/
      page.tsx                        ← Search UI page
components/
  dashboard/
    search-results.tsx                ← Search results list component
    search-input.tsx                  ← Search input with mode selector
    global-search.tsx                 ← Global Cmd+K search bar
supabase/
  migrations/
    YYYYMMDDHHMMSS_enable_pgvector.sql  ← Enable pgvector extension
```

### Modified Files

```
lib/di/fakes.ts                       ← Update InMemoryVectorSearch with working embed/search/upsert
lib/ports/vector-search.ts            ← Verify interface matches implementation needs (no changes expected)
prisma/schema.prisma                  ← EntityEmbedding model, RepoStatus enum extension
env.mjs                               ← EMBEDDING_MODEL_NAME, EMBEDDING_DIMENSIONS, EMBEDDING_BATCH_SIZE
.env.example                          ← Document Phase 3 variables
Dockerfile.light-worker               ← Model pre-download warm-up step
components/dashboard/repos-list.tsx   ← Embedding status on repo card
components/dashboard/repo-card.tsx    ← Embedding progress indicator
app/(dashboard)/layout.tsx            ← Global search bar integration
```

---

## Revision Log

| Date | Author | Change |
|------|--------|--------|
| 2026-02-20 | — | Initial document created. 14 API items, 5 adapter items, 3 infrastructure items, 4 database items, 4 UI items, 12 test items. Total: **42 tracker items.** |
