# Phase 10a — Local-First Intelligence Proxy (MVP): Deep Dive & Implementation Tracker

> **Phase Feature Statement:** _"70% of my agent's tool calls resolve instantly from a local graph — no network round-trip. The 7 structural MCP tools run against an embedded CozoDB database on my machine. My IDE feels native-fast."_
>
> **Source:** [`VERTICAL_SLICING_PLAN.md`](./VERTICAL_SLICING_PLAN.md) — Phase 10 (10a increment)
>
> **Prerequisites:** [Phase 2 — Hosted MCP Server](./PHASE_2_HOSTED_MCP_SERVER.md) (9 MCP tools, MCP server, auth, scrubber, rate limiter, truncation)
>
> **What this is NOT:** Phase 10a does not include rules/patterns routing (10b, after Phase 6), predictive pre-fetching (10b), or semantic search (Phase 3). Those tools fall through to the cloud.
>
> **Delivery position:** Phase 10a can start as soon as Phase 2 ships. It runs in parallel with Phases 3-6 on the main track. See [dependency graph](./VERTICAL_SLICING_PLAN.md#phase-summary--dependencies).

---

## Table of Contents

- [Part 1: Architectural Deep Dive](#part-1-architectural-deep-dive)
  - [1.1 Core User Flows](#11-core-user-flows)
  - [1.2 System Logic & State Management](#12-system-logic--state-management)
  - [1.3 Reliability & Resilience](#13-reliability--resilience)
  - [1.4 Performance Considerations](#14-performance-considerations)
  - [1.5 Phase Bridge → Phase 10b](#15-phase-bridge--phase-10b)
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

## 1.1 Core User Flows

Phase 10a has five actor journeys. Three are user-initiated (setup, pull, querying) and two are system-initiated (sync workflow, cloud fallback).

### Terminology: Local graph vs. cloud graph

| Term | Meaning |
|------|---------|
| **Cloud graph** | ArangoDB — the authoritative, multi-tenant knowledge graph. Source of truth. Written by `indexRepoWorkflow`. |
| **Local graph** | CozoDB embedded — a single-tenant, read-only compact copy on the developer's machine. Refreshed by `kap10 pull`. Never written to by the developer or agent — only replaced wholesale by sync. |
| **Graph snapshot** | A msgpack-serialized export of entities + edges for one repo. Produced by `syncLocalGraphWorkflow`, consumed by `kap10 pull`. |
| **Query router** | The decision layer inside the CLI MCP proxy that inspects the tool name and dispatches to either the local CozoDB graph or the cloud MCP endpoint. |
| **Cloud fallback** | When a tool is marked as `cloud` in the routing table, or when the local graph has no data for the requested repo, the CLI proxies the MCP request to the cloud endpoint transparently. |

### Flow 1: First-Time Setup — `kap10 auth login` + `kap10 pull`

**Actor:** Developer with a kap10 account and at least one indexed repo
**Precondition:** `@kap10/cli` installed (`npm install -g @kap10/cli`), Phase 2 cloud MCP server running
**Outcome:** Local CozoDB graph populated with compact entity/edge data for selected repos; CLI ready to serve as local MCP server

```
Step  Actor Action                           System Action                                                      State Change
────  ─────────────────────────────────────  ─────────────────────────────────────────────────────────────────   ──────────────────────────────
1     Developer runs `kap10 auth login`      CLI opens browser to kap10 OAuth flow (reuses Better Auth)          ~/.kap10/credentials.json created
                                             or prompts for API key. Stores auth token locally.                  (token + org context)

2     Developer runs `kap10 pull`            CLI calls GET /api/graph-snapshots?orgId=...                        None (read-only)
                                             → Server returns list of available repos with snapshot metadata
                                             (repo name, entity count, snapshot size, last updated)

3                                            For each repo (or --repo flag for single):                          None
                                             CLI calls GET /api/graph-snapshots/{repoId}/download
                                             → Server returns pre-signed Supabase Storage URL (24h TTL)

4                                            CLI downloads msgpack snapshot from pre-signed URL                  ~/.kap10/graphs/{repoId}.cozo
                                             → Deserializes msgpack → bulk-loads into local CozoDB file          created/replaced
                                             CozoDB file stored at ~/.kap10/graphs/{repoId}.cozo

5     Developer sees:                        CLI prints summary:                                                 ~/.kap10/manifest.json updated
      "Pulled 3 repos, 12,847 entities"      "✓ org/backend-api: 5,231 entities, 8,492 edges (2.1 MB)           (repo list, versions, timestamps)
                                              ✓ org/frontend: 4,116 entities, 6,203 edges (1.6 MB)
                                              ✓ org/shared-lib: 3,500 entities, 5,100 edges (1.3 MB)"

6     Developer configures IDE:              IDE MCP client connects to CLI via stdio transport                   MCP session established (local)
      `kap10 serve` as MCP server            CLI starts MCP server on stdio, registers all 9 Phase 2 tools
      (or auto-starts via IDE config)
```

**Auth flow details:**

The CLI reuses the same authentication that Phase 5.5 establishes. Two modes:

| Mode | Flow | Token storage |
|------|------|---------------|
| **Browser OAuth** (recommended) | `kap10 auth login` → opens browser → Better Auth OAuth consent → redirect to `localhost:9876/callback` → CLI receives token | `~/.kap10/credentials.json` — `{ token, refreshToken, orgId, expiresAt }` |
| **API key** | `kap10 auth login --api-key` → paste API key → CLI validates against cloud | `~/.kap10/credentials.json` — `{ apiKey, orgId }` |

The CLI refreshes OAuth tokens automatically before expiry. If refresh fails, it prompts `kap10 auth login` again.

### Flow 2: Agent Tool Call — Local Resolution

**Actor:** AI agent (Cursor, Claude Code, VS Code Copilot) via MCP client
**Precondition:** `kap10 serve` running (or auto-started by IDE); local graph populated via `kap10 pull`
**Outcome:** Agent receives tool response from local CozoDB in <5ms — no network round-trip

```
Step  Actor Action                           System Action                                                      Latency
────  ─────────────────────────────────────  ─────────────────────────────────────────────────────────────────   ──────────
1     Agent calls MCP tool:                  IDE MCP client sends JSON-RPC via stdio to kap10 CLI               ~1ms
      get_function({
        name: "validateJWT"
      })

2                                            Query Router inspects tool name:                                    ~0.1ms
                                             "get_function" → routing table → LOCAL

3                                            CozoDB Datalog query:                                               ~2ms
                                             ?[name, kind, file_path, signature, body] :=
                                               *entities[name, kind, file_path, signature, body, repo_id],
                                               name = "validateJWT",
                                               repo_id = $repoId

4                                            1-hop caller/callee traversal (Datalog):                            ~2ms
                                             ?[caller_name, caller_kind, caller_file] :=
                                               *edges[from_id, to_id, kind],
                                               kind = "calls",
                                               to_id = $entityId,
                                               *entities[from_id, caller_name, caller_kind, caller_file, ...]

5                                            Response formatting:                                                ~0.5ms
                                             Apply same truncation rules as cloud MCP server
                                             (MAX_RESPONSE_BYTES respected)

6     Agent receives response                CLI writes JSON-RPC response to stdout                              ~0.1ms
      Total: < 5ms
```

**Contrast with cloud path (Phase 2):** The same `get_function` call via the cloud MCP server takes 200-300ms (TLS handshake + HTTP/2 + ArangoDB query + response serialization + network latency). Phase 10a eliminates ~97% of that latency for structural queries.

### Flow 3: Agent Tool Call — Cloud Fallback

**Actor:** AI agent via MCP client
**Precondition:** Same as Flow 2
**Outcome:** Tools not in the local routing table are transparently proxied to the cloud MCP server

```
Step  Actor Action                           System Action                                                      Latency
────  ─────────────────────────────────────  ─────────────────────────────────────────────────────────────────   ──────────
1     Agent calls MCP tool:                  IDE MCP client sends JSON-RPC via stdio to kap10 CLI               ~1ms
      sync_local_diff({
        diff: "unified diff text..."
      })

2                                            Query Router inspects tool name:                                    ~0.1ms
                                             "sync_local_diff" → routing table → CLOUD

3                                            CLI proxies the full MCP request to cloud:                          ~200-500ms
                                             POST {MCP_SERVER_URL}/mcp
                                             Headers: Authorization: Bearer {token}
                                             Body: original JSON-RPC payload (unchanged)

4                                            Cloud MCP server processes the request                              (cloud latency)
                                             → workspace overlay write → response

5     Agent receives response                CLI relays cloud response to stdout (unchanged)                     ~1ms
      Total: cloud latency + ~2ms overhead
```

**Transparency principle:** The agent never knows whether a tool resolved locally or via cloud. The response shape is identical. The only observable difference is latency. This means no changes to any MCP tool definitions, no changes to agent prompts, and no changes to the Bootstrap Rule.

### Flow 4: Cloud → Local Sync — `syncLocalGraphWorkflow`

**Actor:** System (Temporal scheduled workflow)
**Precondition:** Repo has been indexed (Phase 1); entity data exists in ArangoDB
**Outcome:** Compact graph snapshot uploaded to Supabase Storage, ready for `kap10 pull`

```
Step  System Action                                                                State Change
────  ──────────────────────────────────────────────────────────────────────────    ──────────────────────────────
1     Temporal cron trigger: daily at 02:00 UTC                                    Workflow started
      (or on-demand after indexRepoWorkflow completes)

2     Activity: queryCompactGraph (light-llm-queue)                                None (read-only)
      → ArangoDB query: export all entities for org_id + repo_id
      → Select compact fields only: _key, name, kind, signature,
        file_path, line_start, line_end (EXCLUDE full body)
      → Export all edges: _from, _to, kind
      → Return: { entities: EntityCompact[], edges: EdgeCompact[] }

3     Activity: serializeToMsgpack (light-llm-queue)                               None (in-memory)
      → msgpackr.encode({ version: 1, repoId, orgId,
          entityCount, edgeCount, entities, edges,
          generatedAt: ISO timestamp })
      → Result: Buffer (~10x smaller than JSON equivalent)

4     Activity: uploadToStorage (light-llm-queue)                                  Supabase Storage:
      → Upload msgpack buffer to Supabase Storage:                                 graph-snapshots/{orgId}/{repoId}/
        bucket: "graph-snapshots"                                                    latest.msgpack (replaced)
        path: "{orgId}/{repoId}/latest.msgpack"
      → Generate pre-signed download URL (24h TTL)
      → Store metadata in Supabase:
        kap10.graph_snapshot_meta (repoId, entityCount, edgeCount,
        sizeBytes, generatedAt, storageUrl)

5     Activity: notifyConnectedClients (light-llm-queue)                           Redis pub/sub event published
      → Publish to Redis channel: graph-sync:{orgId}
        payload: { repoId, entityCount, generatedAt }
      → Connected CLI instances (if any) receive the notification
        and can auto-pull
```

**Trigger modes:**

| Trigger | When | Why |
|---------|------|-----|
| **Scheduled (cron)** | Daily at 02:00 UTC | Baseline freshness guarantee. Even if no one pushes, local graphs stay no more than 24h stale. |
| **On-demand (post-index)** | After `indexRepoWorkflow` completes | Ensures the local graph reflects the latest indexing immediately. Critical for first-time setup. |
| **Manual** | User clicks "Sync now" in dashboard | Escape hatch for users who need fresher data than the nightly sync. |

### Flow 5: Stale Graph Detection and Auto-Pull

**Actor:** System (kap10 CLI background process)
**Precondition:** `kap10 serve` is running; local graph exists
**Outcome:** CLI detects stale local graph and auto-pulls fresh snapshot

```
Step  System Action                                                                State Change
────  ──────────────────────────────────────────────────────────────────────────    ──────────────────────────────
1     On `kap10 serve` startup:                                                    None
      CLI reads ~/.kap10/manifest.json for each repo's lastPulledAt timestamp

2     CLI checks freshness:                                                         None
      If (now - lastPulledAt) > 24 hours:
        Log warning: "Local graph for org/repo is stale (last pulled 36h ago)"
        If --auto-pull flag (default: true):
          Trigger background `kap10 pull --repo org/repo`

3     CLI subscribes to Redis pub/sub channel (via cloud WebSocket):               WebSocket connection established
      Channel: graph-sync:{orgId}
      On message { repoId, entityCount, generatedAt }:
        If generatedAt > local manifest.lastPulledAt:
          Trigger background `kap10 pull --repo {repoId}`

4     Background pull completes:                                                    ~/.kap10/graphs/{repoId}.cozo
      CozoDB file hot-swapped (close old → open new)                               replaced, manifest updated
      Active MCP sessions see updated data on next query
```

**Hot-swap strategy:** CozoDB files are replaced atomically. The CLI opens the new `.cozo` file, verifies it loads correctly, then closes the old one and renames. If the new file is corrupt, the old file is retained and an error is logged. Active queries complete against the old file before the swap.

---

## 1.2 System Logic & State Management

### Data Flow: Cloud → Local

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Cloud (authoritative)                                                    │
│                                                                          │
│  ArangoDB (entities + edges)                                              │
│       │                                                                  │
│       │ queryCompactGraph (strip body, keep structure)                    │
│       ▼                                                                  │
│  Compact Graph { entities: EntityCompact[], edges: EdgeCompact[] }        │
│       │                                                                  │
│       │ serializeToMsgpack (~10x compression vs JSON)                    │
│       ▼                                                                  │
│  Supabase Storage: graph-snapshots/{orgId}/{repoId}/latest.msgpack       │
│                                                                          │
└──────────────────────────┬───────────────────────────────────────────────┘
                           │ pre-signed URL (24h TTL)
                           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Developer's Machine (local)                                              │
│                                                                          │
│  kap10 pull:                                                              │
│    1. GET /api/graph-snapshots/{repoId}/download → pre-signed URL        │
│    2. Download msgpack from Supabase Storage                              │
│    3. msgpackr.decode() → { entities, edges }                            │
│    4. CozoDB bulk load:                                                  │
│       - Drop existing relations for this repo                            │
│       - :insert entities [...rows]                                       │
│       - :insert edges [...rows]                                          │
│    5. Update ~/.kap10/manifest.json                                      │
│                                                                          │
│  ~/.kap10/                                                                │
│    credentials.json        ← auth token / API key                        │
│    manifest.json           ← repo list, versions, timestamps             │
│    graphs/                                                                │
│      {repoId}.cozo         ← CozoDB embedded database file               │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Graph Compaction: What gets stripped

The local graph is a **structural skeleton** — enough for the 7 local MCP tools, but without the heavy payload fields that only the cloud needs.

| Field | In cloud (ArangoDB) | In local (CozoDB) | Why |
|-------|--------------------|--------------------|-----|
| `_key` (entity ID) | Yes | Yes | Primary lookup key |
| `name` | Yes | Yes | Tool queries by name |
| `kind` (function/class/interface) | Yes | Yes | Kind filtering |
| `signature` | Yes | Yes | Displayed in tool responses |
| `file_path` | Yes | Yes | File-based queries |
| `line_start`, `line_end` | Yes | Yes | Line-range lookups |
| `body` (full source code) | Yes | **Truncated to first 50 lines** | Local tools return signatures + truncated preview. Full body available via cloud fallback. Saves ~80% of snapshot size. |
| `org_id` | Yes | No (implicit — one CozoDB file per repo) | Single-tenant local store, no need for org scoping |
| `repo_id` | Yes | No (implicit — one CozoDB file per repo) | Same |
| `content_hash` | Yes | Yes | Stale detection for Phase 5 incremental re-sync |
| Edge `_from`, `_to` | Yes | Yes (as `from_key`, `to_key`) | Graph traversal |
| Edge `kind` (calls/imports/extends/implements) | Yes | Yes | Edge filtering |

**Body truncation rationale:** The `get_function` tool returns the entity signature plus callers/callees. The full function body is useful but not essential for structural queries. Truncating to 50 lines covers most functions entirely (median function length is ~15 lines). For large functions, the agent sees the first 50 lines plus a `[truncated — call get_function via cloud for full body]` annotation. This reduces snapshot size by ~80% — a 50K-entity repo goes from ~500 MB (full bodies) to ~100 MB (truncated).

### CozoDB Schema (Datalog Relations)

CozoDB uses Datalog — a declarative query language — with named relations instead of tables. Phase 10a defines three core relations:

```
Relation: entities
Columns: [key: String, name: String, kind: String, signature: String,
          body: String, file_path: String, line_start: Int, line_end: Int,
          content_hash: String]
Key: key (unique)

Relation: edges
Columns: [from_key: String, to_key: String, kind: String]
Key: [from_key, to_key, kind] (composite unique)

Relation: file_index
Columns: [file_path: String, entity_key: String]
Key: [file_path, entity_key] (composite unique — derived from entities on load)
```

**Why `file_index`?** The `get_file_entities` and `get_imports` tools query by file path. In ArangoDB, this is a secondary index on `file_path`. In CozoDB, a derived relation provides the same lookup performance. It is computed during `kap10 pull` bulk load — not synced from the cloud.

### Query Router: Routing Table

The routing table is a static map defined in the CLI. It determines where each MCP tool call is dispatched.

```
Phase 10a Routing Table:

Tool Name          → Destination    Reason
─────────────────    ──────────     ──────────────────────────────────────────
get_function       → LOCAL          Entity lookup + 1-hop traversal — pure graph
get_class          → LOCAL          Entity lookup + extends/implements traversal
get_callers        → LOCAL          N-hop inbound traversal — pure graph
get_callees        → LOCAL          N-hop outbound traversal — pure graph
get_imports        → LOCAL          File → import edges → target entities
get_file_entities  → LOCAL          File path → entities in that file
search_code        → LOCAL          Fulltext search on entity name + signature

sync_local_diff    → CLOUD          Writes to workspace overlay (server-side state)
get_project_stats  → CLOUD          Aggregation across all collections (too expensive locally)

(unknown tool)     → CLOUD          Forward-compatible: any tool added in future phases
                                    falls through to cloud by default
```

**Forward-compatibility by default:** If the cloud MCP server adds a new tool in Phase 3, 4, 5, or 6, the CLI automatically proxies it to the cloud. No CLI update needed. The routing table is a whitelist of LOCAL tools — everything else goes to the cloud. This is critical for the two-increment delivery: 10a ships before Phases 3-6, and those phases' tools work immediately via cloud fallback.

### `search_code` Local Implementation

The Phase 2 `search_code` tool uses ArangoDB's fulltext index. CozoDB does not have a built-in fulltext index. Phase 10a implements local fulltext search as:

1. **On `kap10 pull`:** Build an in-memory inverted index from entity `name` and `signature` fields. Store as a CozoDB relation `search_index[token: String, entity_key: String]`.
2. **On query:** Tokenize the search query, look up tokens in `search_index`, intersect/union results, rank by token overlap count.

This is simpler than ArangoDB's BM25-based fulltext but sufficient for name/signature matching. Semantic search (Phase 3's `semantic_search` tool) stays on the cloud.

**Alternative considered:** Embedding a Tantivy (Rust full-text search) index locally. Rejected — adds ~15 MB binary size, complex NAPI bridge, and `search_code` is the least latency-sensitive local tool (keyword search is fast even with a naive implementation).

### Local File System Layout

```
~/.kap10/
├── credentials.json          # Auth token or API key
│   {
│     "mode": "oauth",           // or "api_key"
│     "token": "ey...",          // OAuth access token
│     "refreshToken": "rt_...",  // OAuth refresh token
│     "orgId": "org_abc",
│     "expiresAt": "2026-02-21T..."
│   }
│
├── manifest.json             # Synced repo registry
│   {
│     "version": 1,
│     "repos": [
│       {
│         "repoId": "repo_123",
│         "name": "org/backend-api",
│         "entityCount": 5231,
│         "edgeCount": 8492,
│         "snapshotSizeBytes": 2202009,
│         "lastPulledAt": "2026-02-20T02:15:00Z",
│         "snapshotVersion": "v1",
│         "cloudGeneratedAt": "2026-02-20T02:00:00Z"
│       }
│     ]
│   }
│
├── graphs/
│   ├── repo_123.cozo          # CozoDB embedded database (binary)
│   ├── repo_456.cozo
│   └── repo_789.cozo
│
└── config.json               # CLI configuration (from Phase 5.5 kap10 init)
    {
      "defaultOrg": "org_abc",
      "mcpServerUrl": "https://mcp.kap10.dev",
      "autoPull": true,
      "pullIntervalHours": 24
    }
```

### Snapshot Versioning

Every graph snapshot includes a `version` field in the msgpack envelope. This enables forward-compatible schema evolution:

| Version | Phase | Schema |
|---------|-------|--------|
| `v1` | 10a | entities (structural fields + truncated body) + edges (calls/imports/extends/implements) |
| `v2` | 10b | v1 + rules relation + patterns relation |
| `v3` | Future | v2 + justifications + features |

The CLI checks the snapshot version against its supported version range. If the snapshot version is newer than the CLI supports, it logs a warning and prompts the user to upgrade: `"Graph snapshot v3 requires kap10 CLI >= 2.0.0. Run: npm install -g @kap10/cli@latest"`.

### Repo Status Extension

Phase 10a adds a `snapshotStatus` field to the `Repo` model (or a separate `GraphSnapshotMeta` table). This tracks the snapshot lifecycle independent of the repo indexing status:

```
Snapshot lifecycle:
  none ──► generating ──► available ──► stale (>24h since generated)
                │                        │
                ▼                        ▼
            generate_failed          (auto-regenerate via cron)
```

The dashboard shows a "Local sync" badge on repo cards: "Available" (green), "Generating..." (yellow), "Stale" (orange), or "Not available" (gray, for repos not yet indexed).

---

## 1.3 Reliability & Resilience

### Failure Scenario Matrix

| # | Failure | Detection | Recovery | User Impact |
|---|---------|-----------|----------|-------------|
| 1 | **`kap10 pull` — network failure during download** | HTTP error or timeout from Supabase Storage | CLI retries download 3 times with exponential backoff (1s, 3s, 9s). If all retries fail, existing local graph is preserved (not deleted). CLI logs error and suggests retrying. | No data loss. Existing local graph continues serving queries. User retries manually or waits for next auto-pull. |
| 2 | **Corrupt msgpack snapshot** | `msgpackr.decode()` throws parse error | CLI discards the corrupt download. Existing local graph preserved. Error logged with snapshot URL for debugging. CLI does not replace the `.cozo` file. | Transparent — old graph continues working. Cloud snapshot regenerated on next cron run. |
| 3 | **CozoDB bulk load failure** | CozoDB returns error on `:insert` | CLI keeps old `.cozo` file. New file written to `.cozo.tmp`, only renamed on success. On failure, `.tmp` is deleted. Error logged. | Transparent — old graph continues working. |
| 4 | **CozoDB query error during MCP tool call** | CozoDB Datalog query returns error or panics | CLI catches the error and falls back to cloud for that single tool call. Logs warning: `"Local query failed for get_function — falling back to cloud"`. `_meta.source: "cloud_fallback"` in response. | Slightly higher latency for that one call (~300ms instead of ~5ms). Transparent to agent. |
| 5 | **Cloud MCP server unreachable (for cloud-routed tools)** | HTTP connection error or timeout (5s) | CLI returns MCP error response to agent: `"Cloud server unreachable. Tools requiring cloud (sync_local_diff, get_project_stats) are temporarily unavailable."` Local tools continue working. | Cloud-routed tools fail. Local tools unaffected. Agent can continue structural queries. |
| 6 | **Local graph is stale (>24h old)** | CLI compares `manifest.lastPulledAt` against current time on startup and before each query | CLI adds `_meta.staleness: { lastPulledAt, hoursStale }` to every response. If >48h stale, adds warning: `"Local graph is 48h stale. Run 'kap10 pull' to refresh."` Auto-pull triggers if enabled. | Agent sees stale data. Structural queries (callers, callees) are still correct unless code changed significantly. Warning in `_meta` lets the agent decide whether to use cloud fallback. |
| 7 | **OAuth token expired during `kap10 pull`** | 401 response from cloud API | CLI attempts token refresh using `refreshToken`. If refresh succeeds, retries the request. If refresh fails (e.g., token revoked), prompts: `"Session expired. Run 'kap10 auth login' to re-authenticate."` | Pull fails until re-auth. Local graph preserved. Local queries unaffected. |
| 8 | **Disk full during `kap10 pull`** | Write error on `.cozo.tmp` file | CLI catches write error, deletes partial `.tmp` file, logs error with required disk space. | Pull fails. Old graph preserved. User must free disk space. |
| 9 | **`syncLocalGraphWorkflow` fails on cloud side** | Temporal activity failure (ArangoDB query timeout, Supabase Storage upload error) | Temporal retries each activity independently (3 retries, exponential backoff). If all retries fail, workflow fails. Next cron run retries the full workflow. Dashboard shows "Sync failed" badge. | Snapshot not updated. Existing snapshot (if any) remains downloadable. Users see stale data until next successful sync. |
| 10 | **Multiple CLI instances for same repo** | Not a failure — valid multi-IDE setup | Each CLI instance opens its own CozoDB file handle (read-only after load). `.cozo` files are safe for concurrent read. `kap10 pull` uses file locking (`flock`) to prevent concurrent writes. | No issues. Multiple IDEs can query the same local graph simultaneously. |

### Cloud Fallback Cascade

When a locally-routed tool fails, the CLI uses a three-level fallback:

```
Level 1: Local CozoDB query
    │
    │ success → return response with _meta.source: "local"
    │
    │ failure (query error, missing data, corrupt DB)
    ▼
Level 2: Cloud MCP proxy (same tool, same args)
    │
    │ success → return response with _meta.source: "cloud_fallback"
    │
    │ failure (network error, cloud down)
    ▼
Level 3: MCP error response
    │
    │ Return: { error: { code: -32603, message: "Tool unavailable locally and via cloud" } }
    │ _meta.source: "error"
```

This means **local graph corruption never breaks the agent's workflow** — it transparently degrades to cloud latency. The `_meta.source` field lets monitoring track how often fallback occurs (ideally ~0% after successful pull).

### Snapshot Integrity

Every msgpack snapshot includes a SHA-256 checksum in the upload metadata:

```
Supabase Storage metadata:
  x-kap10-checksum: sha256:{hex}
  x-kap10-entity-count: 5231
  x-kap10-edge-count: 8492
  x-kap10-version: v1
  x-kap10-generated-at: 2026-02-20T02:00:00Z
```

On `kap10 pull`, the CLI:
1. Downloads the msgpack blob
2. Computes SHA-256 of the downloaded bytes
3. Compares against `x-kap10-checksum` header
4. If mismatch: discards download, retries (possibly corrupted in transit)
5. If match: proceeds with decode + load

---

## 1.4 Performance Considerations

### Latency Budgets

| Operation | Target | Current (cloud) | With Phase 10a (local) | Improvement |
|-----------|--------|-----------------|----------------------|-------------|
| `get_function` | <5ms | ~300ms | ~3ms (CozoDB lookup + 1-hop traversal) | **~100x** |
| `get_callers` (depth 1) | <5ms | ~200ms | ~2ms | **~100x** |
| `get_callers` (depth 5) | <20ms | ~500ms | ~15ms (5 recursive Datalog hops) | **~33x** |
| `get_callees` (depth 1) | <5ms | ~200ms | ~2ms | **~100x** |
| `get_class` | <5ms | ~300ms | ~3ms | **~100x** |
| `get_imports` | <10ms | ~500ms | ~8ms | **~63x** |
| `get_file_entities` | <3ms | ~200ms | ~1ms (file_index lookup) | **~200x** |
| `search_code` | <30ms | ~200ms | ~20ms (inverted index scan) | **~10x** |
| `sync_local_diff` (cloud) | ~500ms | ~500ms | ~502ms (proxy overhead) | No change (cloud tool) |
| `get_project_stats` (cloud) | ~300ms | ~300ms | ~302ms (proxy overhead) | No change (cloud tool) |

**Cloud proxy overhead:** For cloud-routed tools, the CLI adds ~2ms of serialization/deserialization overhead. This is negligible compared to network latency.

### `kap10 pull` Performance

| Repo size | Entity count | Edge count | Snapshot size (msgpack) | Download time (50 Mbps) | CozoDB load time | Total pull time |
|-----------|-------------|------------|------------------------|------------------------|-----------------|----------------|
| Small (100 files) | ~500 | ~800 | ~200 KB | <1s | <0.5s | ~1.5s |
| Medium (1K files) | ~5,000 | ~8,000 | ~2 MB | ~1s | ~1s | ~2.5s |
| Large (5K files) | ~25,000 | ~40,000 | ~10 MB | ~2s | ~3s | ~5s |
| Monorepo (10K+ files) | ~50,000 | ~80,000 | ~20 MB | ~4s | ~5s | ~10s |

**CozoDB load time** is dominated by the bulk insert. CozoDB's NAPI binding supports batch operations — inserting 50K entities in a single `:insert` call is ~5s on an M1 MacBook Pro.

### Memory Budget

| Component | Memory | Notes |
|-----------|--------|-------|
| CozoDB per loaded repo | ~10-50 MB | Proportional to entity count. 5K entities ≈ 10 MB. 50K entities ≈ 50 MB. |
| kap10 CLI process baseline | ~30 MB | Node.js baseline + commander + MCP SDK |
| Search index (inverted) | ~2-10 MB | In-memory token → entity_key map |
| Cloud proxy HTTP client | ~5 MB | HTTP/2 connection pool (1-3 connections) |

**Total CLI memory (3 medium repos):** ~30 MB (baseline) + 3 × ~10 MB (CozoDB) + 3 × ~3 MB (search index) ≈ **~70 MB**

This is well within acceptable bounds for a CLI tool running alongside an IDE.

### Disk Budget

| Component | Size | Notes |
|-----------|------|-------|
| `@kap10/cli` npm package | ~15 MB | Includes `cozo-node` NAPI binary (~8 MB) |
| CozoDB file per repo (medium) | ~5-15 MB | Compact structural data |
| CozoDB file per repo (monorepo) | ~30-60 MB | Large but manageable |
| 10 repos total | ~100-300 MB | Worst case for heavy users |

**Disk quota:** The CLI enforces a configurable `maxLocalStorageMB` (default: 500 MB). If pulling a new repo would exceed the quota, the CLI prompts the user to remove old repos: `"Local storage limit reached (480/500 MB). Remove a repo with 'kap10 forget org/old-repo' to make space."`.

### CozoDB Query Performance Characteristics

CozoDB's Datalog engine compiles queries to a query plan at first execution and caches the plan. Key performance characteristics:

| Query pattern | CozoDB behavior | Expected latency |
|---------------|----------------|------------------|
| Point lookup by key | Hash index scan | <1ms |
| Name search (equality) | Full relation scan (no secondary index) | ~2ms for 5K entities |
| N-hop traversal (depth 1) | Single join | ~1ms |
| N-hop traversal (depth 5) | 5 recursive joins | ~10-15ms |
| File path lookup | `file_index` relation scan | ~1ms |

**No secondary indexes in CozoDB.** CozoDB uses Datalog's join optimization instead of B-tree indexes. For the entity counts we expect (<100K per repo), full relation scans are fast enough. This simplifies the schema (no index maintenance overhead).

---

## 1.5 Phase Bridge → Phase 10b

Phase 10a is designed so that Phase 10b requires **zero refactoring** of the 10a codebase — only additions.

### What 10b adds to 10a's foundation

| 10a artifact | 10b extension | Change type |
|-------------|---------------|-------------|
| **CozoDB schema** (entities, edges, file_index) | Add `rules` and `patterns` relations | Additive — new relations, no changes to existing |
| **Routing table** (7 local, 2 cloud) | Add `get_rules → LOCAL`, `check_rules → LOCAL` | Additive — append 2 entries to static map |
| **`syncLocalGraphWorkflow`** | Extend `queryCompactGraph` to also export rules + patterns collections | Modify one activity — add two AQL queries |
| **`kap10 pull`** | Deserialize rules/patterns from msgpack, load into CozoDB | Extend bulk load step — add two `:insert` calls |
| **Snapshot version** | Bump from `v1` to `v2` | Version field already exists; CLI version check already implemented |
| **Predictive pre-fetching** | New feature (10b only) — LSP cursor tracking | Additive — new CLI module, new API endpoint. No changes to existing 10a code. |

### What 10a must NOT do (to avoid 10b rework)

1. **Do not hardcode the routing table.** Use a declarative config structure (map of tool name → destination) so 10b can extend it by appending entries.
2. **Do not embed CozoDB schema in the load logic.** Define schemas in a separate module (`cozo-schema.ts`) so 10b can add relations without touching the load/query code.
3. **Do not assume snapshot contents.** The msgpack deserializer should handle unknown keys gracefully (skip, don't error). A v2 snapshot loaded by a v1 CLI should work — the extra `rules` and `patterns` data is ignored.
4. **Do not couple the cloud proxy to specific tool names.** The proxy path should forward any tool not in the LOCAL routing table — this naturally handles tools from Phases 3-6 that don't exist yet.

### Infrastructure Forward-Compatibility

- **`packages/cli/src/` structure:** Phase 5.5 establishes the CLI package at `packages/cli/`. Phase 10a adds `mcp-proxy.ts`, `local-graph.ts`, `sync.ts`, `query-router.ts`, `cozo-schema.ts` to this package. Phase 10b adds `prefetch.ts` and extends `cozo-schema.ts`. No structural conflict.
- **Temporal workflow:** `syncLocalGraphWorkflow` runs on `light-llm-queue`. Phase 10b extends its activities, not the workflow definition itself. Clean activity-level extension.
- **Supabase Storage bucket:** `graph-snapshots` bucket created in 10a. 10b uses the same bucket, same path structure, larger payloads (rules + patterns add ~10% to snapshot size).
- **CLI config:** `~/.kap10/config.json` is extensible by design (JSON object with optional keys). 10b adds `prefetchEnabled: true` without breaking 10a configs.

### Phase 5.5 CLI Compatibility

Phase 10a extends the CLI that Phase 5.5 creates. Critical compatibility rules:

| Phase 5.5 CLI feature | Phase 10a interaction |
|-----------------------|---------------------|
| `kap10 auth login/logout` | **Reused as-is.** Same auth flow, same `credentials.json`, same token refresh. |
| `kap10 init --org` | **Reused.** The `config.json` it creates is extended with local graph settings. |
| `kap10 push` | **No conflict.** Push uploads code for indexing. Pull downloads graph snapshots. Different API endpoints, different data flows. |
| `kap10 watch` | **No conflict.** Watch streams file changes to the cloud ledger. The local MCP proxy is a separate process. They can run concurrently. |
| `kap10 rewind/timeline/mark-working` | **No conflict.** Ledger commands interact with the cloud API. Local graph is read-only. |
| `packages/cli/src/client.ts` | **Reused.** The HTTP client for kap10 API. Phase 10a adds new API endpoints (`/api/graph-snapshots/*`) that use the same client. |

**Important timing note:** Phase 10a can start after Phase 2, but the CLI scaffold (`packages/cli/`) is created in Phase 5.5. Two options:
1. **If Phase 5.5 ships first:** 10a extends the existing CLI package. This is the ideal path.
2. **If 10a starts before Phase 5.5:** 10a creates a minimal CLI package (`packages/cli/`) with only the MCP proxy + pull commands. When Phase 5.5 ships, it merges into the same package. The `commander` entry point, `client.ts`, and `auth.ts` are shared.

In practice, Phase 5.5 depends on Phase 5 which depends on Phase 4 which depends on Phase 3 — so Phase 5.5 ships well after Phase 2. Phase 10a should create a minimal CLI package that Phase 5.5 later extends with ledger commands. The package structure (`packages/cli/src/commands/`) supports this — each command is a separate file.

---

# Part 2: Implementation & Tracing Tracker

## 2.1 Infrastructure Layer

### Cloud-Side Infrastructure

- [ ] **P10a-INFRA-01: Create `graph-snapshots` Supabase Storage bucket** — S
  - Bucket name: `graph-snapshots`
  - Access: private (pre-signed URLs only, 24h TTL)
  - Path convention: `{orgId}/{repoId}/latest.msgpack`
  - RLS policy: only authenticated users with org membership can generate download URLs
  - **Test:** Upload a test file → generate pre-signed URL → download succeeds. URL expires after 24h.
  - **Depends on:** Nothing
  - **Files:** `supabase/migrations/YYYYMMDDHHMMSS_create_graph_snapshots_bucket.sql`
  - Notes: _____

- [ ] **P10a-INFRA-02: Add Phase 10a env vars to `env.mjs`** — S
  - New variables: `GRAPH_SNAPSHOT_BUCKET` (default: `"graph-snapshots"`), `GRAPH_SNAPSHOT_TTL_HOURS` (default: `24`), `GRAPH_SYNC_CRON` (default: `"0 2 * * *"`)
  - All optional with defaults
  - **Test:** `pnpm build` succeeds. Missing vars use defaults.
  - **Depends on:** Nothing
  - **Files:** `env.mjs`, `.env.example`
  - Notes: _____

- [ ] **P10a-INFRA-03: Update `.env.example` with Phase 10a variables** — S
  - Document: comment block explaining graph snapshot sync and local-first proxy
  - **Test:** `cp .env.example .env.local` + fill → app starts.
  - **Depends on:** P10a-INFRA-02
  - **Files:** `.env.example`
  - Notes: _____

### CLI Infrastructure

- [ ] **P10a-INFRA-04: Create minimal CLI package scaffold at `packages/cli/`** — M
  - **If Phase 5.5 CLI already exists:** Skip this item — extend the existing package.
  - **If Phase 5.5 hasn't shipped yet:** Create `packages/cli/` with:
    - `package.json` (`@kap10/cli`, `bin: { "kap10": "./dist/index.js" }`, deps: `commander`, `cozo-node`, `msgpackr`, `@modelcontextprotocol/sdk`)
    - `tsconfig.json` (target: ES2022, module: Node16)
    - `src/index.ts` (commander entry point with `pull`, `serve`, `auth` subcommands)
    - `src/client.ts` (HTTP client for kap10 API — reusable by Phase 5.5)
  - **Test:** `npm install -g .` in packages/cli → `kap10 --version` prints version. `kap10 --help` shows subcommands.
  - **Depends on:** Nothing
  - **Files:** `packages/cli/` (new package)
  - **Acceptance:** CLI installs globally. Subcommands registered. TypeScript compiles.
  - Notes: _____

- [ ] **P10a-INFRA-05: Add `cozo-node` NAPI binary to CLI package** — S
  - Add `cozo-node` as a dependency of `@kap10/cli`
  - Verify NAPI binary works on macOS (arm64 + x64), Linux (x64), Windows (x64)
  - **Test:** `require('cozo-node')` succeeds on all target platforms. CozoDB opens/closes a test database without errors.
  - **Depends on:** P10a-INFRA-04
  - **Files:** `packages/cli/package.json`
  - **Acceptance:** `cozo-node` binary loads on all supported platforms. No NAPI version mismatch.
  - Notes: _____

---

## 2.2 Database & Schema Layer

- [ ] **P10a-DB-01: Create `GraphSnapshotMeta` model in Prisma schema** — M
  - New model in `kap10` schema:
    - `id` (UUID, PK)
    - `repoId` (FK → Repo, unique — one snapshot per repo)
    - `orgId` (FK → Organization)
    - `entityCount` (Int)
    - `edgeCount` (Int)
    - `sizeBytes` (Int)
    - `snapshotVersion` (String, default: `"v1"`)
    - `storagePath` (String — Supabase Storage path)
    - `checksum` (String — SHA-256 hex)
    - `status` (enum: `generating`, `available`, `failed`)
    - `generatedAt` (DateTime)
    - `createdAt`, `updatedAt`
  - `@@schema("kap10")`, `@@map("graph_snapshot_meta")`
  - **Test:** `pnpm migrate` succeeds. CRUD operations on the model work.
  - **Depends on:** Nothing
  - **Files:** `prisma/schema.prisma`, new migration file
  - **Acceptance:** Table exists. Unique constraint on `repoId` enforced. Status enum works.
  - Notes: _____

- [ ] **P10a-DB-02: Add `SnapshotStatus` enum to Prisma schema** — S
  - Values: `generating`, `available`, `failed`
  - `@@schema("kap10")`
  - **Test:** Enum values accepted in model operations.
  - **Depends on:** Nothing
  - **Files:** `prisma/schema.prisma`, new migration file
  - Notes: _____

---

## 2.3 Ports & Adapters Layer

- [ ] **P10a-ADAPT-01: Create `CozoGraphStore` adapter (local IGraphStore subset)** — L
  - Implements the read-only subset of `IGraphStore` needed by the 7 local tools:
    - `getEntity(orgId, entityId)` — Datalog point lookup on `entities` relation
    - `getCallersOf(orgId, entityId, depth?)` — recursive Datalog traversal on `edges` where `kind = "calls"`
    - `getCalleesOf(orgId, entityId, depth?)` — recursive Datalog traversal (outbound)
    - `getEntitiesByFile(orgId, repoId, filePath)` — `file_index` relation lookup
    - `healthCheck()` — verify CozoDB file is readable
  - Does NOT implement write methods (upsertEntity, upsertEdge, etc.) — throws `NotImplementedError`
  - Constructor takes a file path to the `.cozo` database
  - **Test:** Load a test CozoDB file with known entities. `getEntity("fn_validateJWT")` returns correct entity. `getCallersOf("fn_validateJWT", 2)` returns 2-hop callers. `getEntitiesByFile("lib/auth/jwt.ts")` returns entities in that file. `healthCheck()` returns `{ status: "up" }`.
  - **Depends on:** P10a-INFRA-05
  - **Files:** `packages/cli/src/local-graph.ts`
  - **Acceptance:** All read-only IGraphStore methods work against CozoDB. Query latency <5ms for point lookups, <20ms for depth-5 traversals.
  - Notes: _____

- [ ] **P10a-ADAPT-02: Create CozoDB schema definition module** — S
  - Define the three CozoDB relations (entities, edges, file_index) as Datalog schema strings
  - Export `createSchema()` function that creates relations in a CozoDB instance
  - Export `dropSchema()` function for clean reload
  - Designed for 10b extensibility — 10b will add `rules` and `patterns` relations to this module
  - **Test:** `createSchema(db)` creates all three relations. `dropSchema(db)` removes them cleanly. Re-creating after drop works.
  - **Depends on:** P10a-INFRA-05
  - **Files:** `packages/cli/src/cozo-schema.ts`
  - Notes: _____

- [ ] **P10a-ADAPT-03: Create local search index for `search_code`** — M
  - Build an in-memory inverted index from entity `name` and `signature` fields
  - Tokenization: split on camelCase boundaries, snake_case underscores, and whitespace. Lowercase all tokens.
  - Query: tokenize input → look up each token → intersect/union → rank by overlap count → return top N
  - Materialized as a CozoDB relation `search_index[token, entity_key]` during bulk load
  - **Test:** Index 100 entities. Search "validate" returns entities with "validate" in name/signature. Search "validateJWT" returns exact match first. Search "jwt validate" returns results containing either token.
  - **Depends on:** P10a-ADAPT-02
  - **Files:** `packages/cli/src/search-index.ts`
  - **Acceptance:** Keyword search returns relevant results. Latency <30ms for 5K entity index.
  - Notes: _____

---

## 2.4 Backend / API Layer

### Cloud API Endpoints

- [ ] **P10a-API-01: Create `GET /api/graph-snapshots` route** — M
  - Returns list of available snapshots for the authenticated user's active org
  - Response: `{ snapshots: [{ repoId, repoName, entityCount, edgeCount, sizeBytes, generatedAt, snapshotVersion }] }`
  - Auth: Better Auth session or API key Bearer header
  - Only returns repos the user has access to (org membership check)
  - **Test:** Authenticated request returns snapshots. Unauthenticated → 401. Repos from other orgs → not included.
  - **Depends on:** P10a-DB-01
  - **Files:** `app/api/graph-snapshots/route.ts`
  - Notes: _____

- [ ] **P10a-API-02: Create `GET /api/graph-snapshots/[repoId]/download` route** — M
  - Generates a pre-signed Supabase Storage URL for the snapshot msgpack file
  - Response: `{ downloadUrl: string, checksum: string, entityCount: number, edgeCount: number, snapshotVersion: string, generatedAt: string }`
  - Pre-signed URL TTL: 1 hour (short-lived — the CLI downloads immediately)
  - Auth: Better Auth session or API key Bearer header. Verify user has access to the repo's org.
  - If no snapshot exists for the repo: return 404 with `{ error: "No snapshot available. Repo may not be indexed yet." }`
  - **Test:** Valid repoId → pre-signed URL returned. Download via URL succeeds. Invalid repoId → 404. Expired URL → 403 from Supabase.
  - **Depends on:** P10a-INFRA-01, P10a-DB-01
  - **Files:** `app/api/graph-snapshots/[repoId]/download/route.ts`
  - Notes: _____

- [ ] **P10a-API-03: Create `POST /api/graph-snapshots/[repoId]/sync` route (manual trigger)** — S
  - Triggers `syncLocalGraphWorkflow` for the specified repo on-demand
  - Idempotent: if workflow already running for this repo, returns existing workflow status
  - Response: `{ workflowId: string, status: "started" | "already_running" }`
  - Auth: Better Auth session (admin/owner role only)
  - **Test:** POST triggers workflow. Second POST while running returns `already_running`. After completion, new POST starts a new workflow.
  - **Depends on:** P10a-API-05
  - **Files:** `app/api/graph-snapshots/[repoId]/sync/route.ts`
  - Notes: _____

### Temporal Workflows & Activities

- [ ] **P10a-API-04: Create `queryCompactGraph` activity** — L
  - ArangoDB queries to export compact entity and edge data for a single repo:
    - Entities: `_key`, `name`, `kind`, `signature`, `file_path`, `line_start`, `line_end`, `content_hash`, `body` (truncated to first 50 lines)
    - Edges: `_from` (key only), `_to` (key only), `kind`
  - Input: `{ orgId, repoId }`
  - Output: `{ entities: EntityCompact[], edges: EdgeCompact[], entityCount, edgeCount }`
  - Heartbeat: report progress as percentage of entities exported
  - **Test:** Insert 100 entities + 150 edges into ArangoDB fake. Activity returns all 100 entities (with truncated bodies) and 150 edges. Entity bodies >50 lines are truncated.
  - **Depends on:** Nothing (uses existing `IGraphStore`)
  - **Files:** `lib/temporal/activities/graph-export.ts`
  - **Acceptance:** Compact export contains all structural fields. Bodies truncated. Edge keys stripped to entity `_key` only (not full ArangoDB `_id`).
  - Notes: _____

- [ ] **P10a-API-05: Create `syncLocalGraphWorkflow` Temporal workflow** — L
  - Workflow ID format: `sync-graph-{orgId}-{repoId}` (idempotent)
  - Queue: `light-llm-queue`
  - Steps:
    1. Update `GraphSnapshotMeta.status` to `generating`
    2. Call `queryCompactGraph` activity → compact graph data
    3. Call `serializeToMsgpack` activity → msgpack buffer
    4. Call `computeChecksum` activity → SHA-256 of buffer
    5. Call `uploadToStorage` activity → Supabase Storage upload
    6. Update `GraphSnapshotMeta` (status: `available`, entityCount, edgeCount, sizeBytes, checksum, generatedAt)
    7. Call `notifyConnectedClients` activity → Redis pub/sub
  - On failure: set `GraphSnapshotMeta.status` to `failed`
  - Schedule: Temporal cron `"0 2 * * *"` (daily 02:00 UTC)
  - Also triggered on-demand after `indexRepoWorkflow` completion and via manual API
  - **Test:** Temporal workflow replay test with mock activities. Workflow completes with correct status transitions. Cron schedule registered.
  - **Depends on:** P10a-API-04, P10a-INFRA-01, P10a-DB-01
  - **Files:** `lib/temporal/workflows/sync-local-graph.ts`
  - **Acceptance:** Workflow runs to completion. Snapshot uploaded to Storage. Metadata updated. Cron fires daily.
  - Notes: _____

- [ ] **P10a-API-06: Create `serializeToMsgpack` activity** — S
  - Input: `{ version: "v1", repoId, orgId, entities, edges, generatedAt }`
  - Output: `Buffer` (msgpack-encoded)
  - Uses `msgpackr.encode()` for compact binary serialization
  - **Test:** Encode 1000 entities + 1500 edges → decode → data matches. Encoded size is <15% of JSON equivalent.
  - **Depends on:** Nothing
  - **Files:** `lib/temporal/activities/graph-export.ts`
  - Notes: _____

- [ ] **P10a-API-07: Create `uploadToStorage` activity** — M
  - Uploads msgpack buffer to Supabase Storage
  - Path: `{orgId}/{repoId}/latest.msgpack`
  - Sets custom metadata headers (checksum, entity count, edge count, version, generated timestamp)
  - Overwrites existing file (upsert semantics)
  - **Test:** Upload a test buffer → download → bytes match. Metadata headers present. Re-upload overwrites previous file.
  - **Depends on:** P10a-INFRA-01
  - **Files:** `lib/temporal/activities/graph-upload.ts`
  - Notes: _____

- [ ] **P10a-API-08: Create `notifyConnectedClients` activity** — S
  - Publish to Redis pub/sub channel `graph-sync:{orgId}`
  - Payload: `{ repoId, entityCount, edgeCount, generatedAt }`
  - Fire-and-forget — if no clients are subscribed, message is discarded (pub/sub semantics)
  - **Test:** Publish event → subscribed client receives it. No subscribers → no error.
  - **Depends on:** Nothing (uses existing `ICacheStore`)
  - **Files:** `lib/temporal/activities/graph-upload.ts`
  - Notes: _____

- [ ] **P10a-API-09: Create graph compaction utility** — M
  - Shared logic used by `queryCompactGraph` to strip entities to compact form
  - Body truncation: keep first 50 lines, append `\n[truncated — {totalLines} lines total. Use cloud for full body.]` if truncated
  - Edge key extraction: convert ArangoDB `_id` (e.g., `entities/fn_validateJWT`) to bare `_key` (e.g., `fn_validateJWT`)
  - **Test:** Entity with 200-line body → truncated to 50 lines + annotation. Entity with 30-line body → unchanged. Edge `_id` stripped to `_key`.
  - **Depends on:** Nothing
  - **Files:** `lib/use-cases/graph-compactor.ts`
  - Notes: _____

- [ ] **P10a-API-10: Chain `syncLocalGraphWorkflow` trigger from `indexRepoWorkflow` completion** — M
  - After `indexRepoWorkflow` completes successfully, start `syncLocalGraphWorkflow` for the same repo
  - This ensures the local graph snapshot is immediately available after first indexing
  - Uses same chaining pattern as Phase 3's `embedRepoWorkflow` trigger
  - **Test:** Index a repo → sync workflow starts automatically. Index failure → sync workflow NOT started.
  - **Depends on:** P10a-API-05, Phase 1 `indexRepoWorkflow`
  - **Files:** Modify existing trigger point (same file as Phase 3's embed trigger)
  - Notes: _____

---

## 2.5 CLI / Client Layer

- [ ] **P10a-CLI-01: Implement `kap10 pull` command** — L
  - Subcommand: `kap10 pull [--repo org/repo] [--force]`
  - Flow:
    1. Read auth from `~/.kap10/credentials.json` (fail if not authenticated)
    2. Call `GET /api/graph-snapshots` → list available repos
    3. For each repo (or filtered by `--repo`):
       a. Call `GET /api/graph-snapshots/{repoId}/download` → pre-signed URL + metadata
       b. Download msgpack from pre-signed URL
       c. Verify SHA-256 checksum
       d. Decode msgpack
       e. Create/replace CozoDB file at `~/.kap10/graphs/{repoId}.cozo`
       f. Bulk load entities, edges, and derived file_index
    4. Update `~/.kap10/manifest.json`
    5. Print summary
  - `--force` flag: skip version check, re-download even if local is up-to-date
  - Version check: compare `manifest.lastPulledAt` against `snapshot.generatedAt`. Skip if local is newer.
  - **Test:** Pull with 1 repo → CozoDB file created. Pull again → skipped (up-to-date). Pull with `--force` → re-downloaded. Pull with `--repo` → only that repo pulled. Network error → retry 3x → existing graph preserved.
  - **Depends on:** P10a-INFRA-04, P10a-ADAPT-02, P10a-API-02
  - **Files:** `packages/cli/src/commands/pull.ts`
  - **Acceptance:** CozoDB file created and queryable after pull. Manifest updated. Checksum verified. Existing data preserved on failure.
  - Notes: _____

- [ ] **P10a-CLI-02: Implement `kap10 serve` command (local MCP server)** — L
  - Subcommand: `kap10 serve [--repo org/repo]`
  - Starts a local MCP server using stdio transport (JSON-RPC over stdin/stdout)
  - Registers all 9 Phase 2 MCP tools with the same names and schemas
  - Uses the query router to dispatch: 7 tools → local CozoDB, 2 tools → cloud proxy
  - Loads CozoDB databases from `~/.kap10/graphs/` on startup
  - Runs until terminated (Ctrl+C or IDE disconnect)
  - IDE configuration example (Cursor `.cursor/mcp.json`):
    ```
    { "mcpServers": { "kap10": { "command": "kap10", "args": ["serve"] } } }
    ```
  - **Test:** Start `kap10 serve` → MCP client connects via stdio → `tools/list` returns all 9 tools. `get_function` resolves locally. `sync_local_diff` proxies to cloud.
  - **Depends on:** P10a-ADAPT-01, P10a-CLI-04, P10a-CLI-05
  - **Files:** `packages/cli/src/commands/serve.ts`, `packages/cli/src/mcp-proxy.ts`
  - **Acceptance:** MCP server starts on stdio. All 9 tools registered. Local tools respond in <5ms. Cloud tools proxy correctly. IDE connects successfully.
  - Notes: _____

- [ ] **P10a-CLI-03: Implement `kap10 auth login/logout`** — M
  - **If Phase 5.5 auth already exists:** Reuse it. Skip this item.
  - **If Phase 5.5 hasn't shipped:** Implement minimal auth:
    - `kap10 auth login` — opens browser to OAuth flow or prompts for API key
    - `kap10 auth logout` — deletes `~/.kap10/credentials.json`
    - Token refresh: background refresh before expiry (OAuth only)
  - Stores credentials at `~/.kap10/credentials.json`
  - **Test:** `kap10 auth login --api-key` → prompts for key → validates against cloud → stores. `kap10 auth logout` → deletes credentials. Expired OAuth token → auto-refreshes.
  - **Depends on:** P10a-INFRA-04
  - **Files:** `packages/cli/src/commands/auth.ts`
  - Notes: _____

- [ ] **P10a-CLI-04: Implement query router** — M
  - Static routing table: map of tool name → `"local"` | `"cloud"`
  - For `local` tools: dispatch to CozoDB adapter, format response
  - For `cloud` tools: proxy full JSON-RPC request to cloud MCP endpoint
  - For unknown tools: default to `cloud` (forward-compatible)
  - Cloud proxy: uses `~/.kap10/credentials.json` for auth header
  - Response format: identical to cloud MCP server responses. Adds `_meta.source: "local" | "cloud" | "cloud_fallback"` for observability.
  - **Test:** `get_function` → routed to local. `sync_local_diff` → routed to cloud. `unknown_tool` → routed to cloud. Local failure → fallback to cloud with `_meta.source: "cloud_fallback"`.
  - **Depends on:** P10a-ADAPT-01
  - **Files:** `packages/cli/src/query-router.ts`
  - **Acceptance:** Routing table dispatches correctly. Cloud proxy includes auth. Fallback works. `_meta.source` set correctly.
  - Notes: _____

- [ ] **P10a-CLI-05: Implement cloud MCP proxy client** — M
  - HTTP/2 client that proxies MCP JSON-RPC requests to the cloud MCP server
  - URL: reads `mcpServerUrl` from `~/.kap10/config.json` (default: `https://mcp.kap10.dev`)
  - Auth: includes `Authorization: Bearer {token}` or `Authorization: Bearer {apiKey}` from credentials
  - Timeout: 10s per request (cloud tools should respond within 1s, 10s is generous timeout)
  - Connection pooling: reuse HTTP/2 connection across requests
  - Error handling: on network error, return MCP error response (don't crash CLI)
  - **Test:** Proxy a `sync_local_diff` call → cloud responds → response relayed to stdio. Cloud timeout → MCP error returned. Cloud 401 → prompt re-auth.
  - **Depends on:** P10a-CLI-03
  - **Files:** `packages/cli/src/cloud-proxy.ts`
  - Notes: _____

- [ ] **P10a-CLI-06: Implement stale graph detection and auto-pull** — S
  - On `kap10 serve` startup: check each repo's `lastPulledAt` in manifest
  - If stale (>24h): log warning, trigger background pull if `autoPull` config is true
  - Subscribe to Redis pub/sub `graph-sync:{orgId}` via WebSocket relay (cloud endpoint)
  - On sync notification: trigger background pull for the updated repo
  - Hot-swap: after background pull completes, replace CozoDB instance without restarting MCP server
  - **Test:** Start serve with stale graph → auto-pull triggers → graph refreshed. Receive pub/sub notification → pull triggers. Hot-swap doesn't interrupt active queries.
  - **Depends on:** P10a-CLI-01, P10a-CLI-02, P10a-API-08
  - **Files:** `packages/cli/src/auto-sync.ts`
  - Notes: _____

---

## 2.6 Frontend / UI Layer

- [ ] **P10a-UI-01: Add "Local Sync" status badge to repo card** — S
  - Show snapshot availability on the repo card:
    - "Available" (green) — snapshot exists, generated within 24h
    - "Generating..." (yellow) — `syncLocalGraphWorkflow` in progress
    - "Stale" (orange) — snapshot exists but >24h old
    - "Not available" (gray) — no snapshot yet (repo may not be indexed)
    - "Failed" (red) — last sync workflow failed
  - Data source: `GraphSnapshotMeta` model (status + generatedAt)
  - **Test:** Repo with available snapshot → green badge. Repo with no snapshot → gray badge. Generating → yellow badge.
  - **Depends on:** P10a-DB-01
  - **Files:** `components/dashboard/repo-card.tsx` (modified)
  - Notes: _____

- [ ] **P10a-UI-02: Add "Sync Now" button to repo detail page** — S
  - Button triggers `POST /api/graph-snapshots/{repoId}/sync`
  - Shows spinner while workflow is running
  - On completion: badge updates to "Available"
  - Only visible to org admins/owners
  - **Test:** Click "Sync Now" → workflow starts → badge updates. Non-admin → button not visible.
  - **Depends on:** P10a-API-03
  - **Files:** `app/(dashboard)/repos/[repoId]/page.tsx` (modified)
  - Notes: _____

- [ ] **P10a-UI-03: Add "Local Setup" instructions to Connect IDE page** — S
  - Add a tab or section to the existing Connect IDE page (Phase 2) with local setup instructions:
    1. Install CLI: `npm install -g @kap10/cli`
    2. Authenticate: `kap10 auth login`
    3. Pull graph: `kap10 pull`
    4. Configure IDE: show MCP config snippet for Cursor/VS Code/Claude Code
  - Include a "Copy" button for the IDE config snippet
  - **Test:** Instructions render. Copy button copies correct config. Tab/section toggles correctly.
  - **Depends on:** Phase 2 Connect IDE page
  - **Files:** `app/(dashboard)/repos/[repoId]/connect/page.tsx` (modified), `components/repo/local-setup-instructions.tsx` (new)
  - Notes: _____

---

## 2.7 Testing & Verification

### Unit Tests

- [ ] **P10a-TEST-01: CozoDB adapter tests** — M
  - Point lookup by key → correct entity returned
  - Lookup for non-existent key → null returned
  - 1-hop callers → correct caller entities
  - 5-hop callers → recursion terminates, correct depth
  - File path lookup → correct entities for that file
  - Health check on valid DB → `{ status: "up" }`
  - Health check on corrupt DB → `{ status: "down" }`
  - **Depends on:** P10a-ADAPT-01
  - **Files:** `packages/cli/src/__tests__/local-graph.test.ts`
  - Notes: _____

- [ ] **P10a-TEST-02: Query router tests** — M
  - `get_function` → dispatched to local adapter
  - `sync_local_diff` → dispatched to cloud proxy
  - Unknown tool `foo_bar` → dispatched to cloud proxy (forward-compatible)
  - Local query failure → fallback to cloud with `_meta.source: "cloud_fallback"`
  - Cloud unreachable → MCP error response returned
  - `_meta.source` field set correctly for all paths
  - **Depends on:** P10a-CLI-04
  - **Files:** `packages/cli/src/__tests__/query-router.test.ts`
  - Notes: _____

- [ ] **P10a-TEST-03: Graph compactor tests** — S
  - Entity with 200-line body → truncated to 50 lines + annotation
  - Entity with 30-line body → unchanged
  - Edge `_id` "entities/fn_validateJWT" → stripped to `_key` "fn_validateJWT"
  - Compact output includes all structural fields (name, kind, signature, file_path, line_start, line_end)
  - **Depends on:** P10a-API-09
  - **Files:** `lib/use-cases/__tests__/graph-compactor.test.ts`
  - Notes: _____

- [ ] **P10a-TEST-04: Msgpack serialization round-trip tests** — S
  - Encode 1000 entities + 1500 edges → decode → data matches exactly
  - Encoded size is <15% of JSON equivalent
  - Version field preserved in round-trip
  - Unknown fields in v2 snapshot → gracefully ignored by v1 decoder (forward-compatible)
  - **Depends on:** P10a-API-06
  - **Files:** `lib/temporal/activities/__tests__/graph-export.test.ts`
  - Notes: _____

- [ ] **P10a-TEST-05: Local search index tests** — S
  - Tokenization: "validateJWT" → ["validate", "jwt"]. "get_user_by_id" → ["get", "user", "by", "id"]
  - Search "validate" → entities with "validate" in name/signature
  - Search "jwt validate" → results containing either token, ranked by overlap
  - Empty index → empty results (no error)
  - **Depends on:** P10a-ADAPT-03
  - **Files:** `packages/cli/src/__tests__/search-index.test.ts`
  - Notes: _____

- [ ] **P10a-TEST-06: Snapshot checksum verification tests** — S
  - Valid checksum → load proceeds
  - Invalid checksum → load rejected, error logged
  - Missing checksum header → load proceeds with warning
  - **Depends on:** P10a-CLI-01
  - **Files:** `packages/cli/src/__tests__/pull.test.ts`
  - Notes: _____

- [ ] **P10a-TEST-07: Stale graph detection tests** — S
  - Graph pulled 12h ago → not stale
  - Graph pulled 25h ago → stale warning logged
  - Graph pulled 49h ago → stale warning + auto-pull triggered (if autoPull config true)
  - No graph for a repo → "Not available" (no stale warning)
  - **Depends on:** P10a-CLI-06
  - **Files:** `packages/cli/src/__tests__/auto-sync.test.ts`
  - Notes: _____

### Integration Tests

- [ ] **P10a-TEST-08: Full sync pipeline integration test** — L
  - End-to-end: insert entities into ArangoDB → run `syncLocalGraphWorkflow` → download snapshot → load into CozoDB → query → correct results
  - Requires: testcontainers (ArangoDB) + Supabase Storage mock
  - **Depends on:** P10a-API-05, P10a-CLI-01, P10a-ADAPT-01
  - **Files:** `lib/temporal/workflows/__tests__/sync-local-graph.integration.test.ts`
  - Notes: _____

- [ ] **P10a-TEST-09: Temporal workflow replay test** — M
  - Deterministic replay of `syncLocalGraphWorkflow` with mock activities
  - Verify: correct activity call order, status transitions, failure handling
  - **Depends on:** P10a-API-05
  - **Files:** `lib/temporal/workflows/__tests__/sync-local-graph.replay.test.ts`
  - Notes: _____

- [ ] **P10a-TEST-10: MCP stdio transport integration test** — M
  - Spawn `kap10 serve` as child process → send JSON-RPC via stdin → read response from stdout
  - Verify: `tools/list` returns 9 tools. `get_function` returns entity. Response format matches cloud MCP server.
  - **Depends on:** P10a-CLI-02
  - **Files:** `packages/cli/src/__tests__/mcp-proxy.integration.test.ts`
  - Notes: _____

### E2E Tests

- [ ] **P10a-TEST-11: Dashboard snapshot status E2E** — S
  - Repo card shows "Available" badge after sync workflow completes
  - "Sync Now" button triggers workflow → badge updates to "Generating..." → then "Available"
  - **Depends on:** P10a-UI-01, P10a-UI-02
  - **Files:** `e2e/graph-snapshots.spec.ts`
  - Notes: _____

### Manual Verification

- [ ] **P10a-TEST-12: Manual latency comparison** — M
  - Index a real repo via Phase 1 + Phase 2
  - Run `kap10 pull` → verify CozoDB file created
  - Start `kap10 serve` → connect IDE (Cursor or VS Code)
  - Agent calls `get_function("validateJWT")`:
    - Via cloud MCP: measure latency (~200-300ms expected)
    - Via local CLI MCP: measure latency (<5ms expected)
  - Agent calls `get_callers("validateJWT", 3)`: verify results match between local and cloud
  - Agent calls `sync_local_diff(...)`: verify proxied to cloud correctly
  - **Depends on:** All P10a items
  - Notes: _____

---

## Dependency Graph

```
P10a-INFRA-01 (Storage bucket) ─── independent
P10a-INFRA-02 (env vars) ── P10a-INFRA-03 (.env.example)
P10a-INFRA-04 (CLI scaffold) ── P10a-INFRA-05 (cozo-node)

P10a-DB-01 (GraphSnapshotMeta) ─┐
P10a-DB-02 (SnapshotStatus enum)┘

P10a-ADAPT-02 (CozoDB schema) ─── P10a-ADAPT-01 (CozoGraphStore)
                               └── P10a-ADAPT-03 (search index)

P10a-API-09 (compactor) ─── P10a-API-04 (queryCompactGraph)
P10a-API-06 (msgpack) ──────┤
P10a-INFRA-01 ── P10a-API-07 (uploadToStorage)
                 P10a-API-08 (notifyClients)
                     │
                     └── P10a-API-05 (syncLocalGraphWorkflow)
                              │
                              ├── P10a-API-10 (chain from indexRepo)
                              └── P10a-API-03 (manual trigger API)

P10a-API-01 (list snapshots) ─── P10a-API-02 (download URL)
                                       │
P10a-ADAPT-01 ─── P10a-CLI-04 (router) │
                       │                │
P10a-CLI-03 (auth) ── P10a-CLI-05 (cloud proxy)
                       │
                       └── P10a-CLI-01 (kap10 pull)
                       └── P10a-CLI-02 (kap10 serve) ── P10a-CLI-06 (auto-sync)

P10a-DB-01 ── P10a-UI-01 (snapshot badge)
P10a-API-03 ── P10a-UI-02 (sync button)
Phase 2 ── P10a-UI-03 (local setup instructions)

All above ── P10a-TEST-01..12 (all tests)
```

**Recommended implementation order:**

1. **Infrastructure** (P10a-INFRA-01..05) — Storage bucket, env vars, CLI scaffold, cozo-node
2. **Database** (P10a-DB-01..02) — Prisma model, enum
3. **Adapters** (P10a-ADAPT-01..03) — CozoDB adapter, schema, search index
4. **Cloud activities** (P10a-API-04..09) — Compactor, queryCompactGraph, msgpack, upload, notify
5. **Workflow** (P10a-API-05, P10a-API-10) — syncLocalGraphWorkflow, chain trigger
6. **Cloud API** (P10a-API-01..03) — Snapshot list, download URL, manual trigger
7. **CLI commands** (P10a-CLI-01..06) — auth, pull, serve, router, cloud proxy, auto-sync
8. **Frontend** (P10a-UI-01..03) — Snapshot badge, sync button, local setup instructions
9. **Testing** (P10a-TEST-01..12) — Unit, integration, E2E, manual

---

## New Files Summary

```
packages/cli/src/
  commands/
    pull.ts                         ← kap10 pull — download + deserialize + CozoDB load
    serve.ts                        ← kap10 serve — local MCP server (stdio)
    auth.ts                         ← kap10 auth login/logout (if Phase 5.5 not shipped)
  mcp-proxy.ts                     ← MCP server factory (stdio transport, tool registration)
  local-graph.ts                   ← CozoGraphStore adapter (read-only IGraphStore subset)
  cozo-schema.ts                   ← CozoDB Datalog relation definitions
  query-router.ts                  ← Tool name → local/cloud dispatch
  cloud-proxy.ts                   ← HTTP/2 client for cloud MCP proxying
  search-index.ts                  ← In-memory inverted index for local search_code
  auto-sync.ts                     ← Stale detection + auto-pull + pub/sub listener
  client.ts                        ← HTTP client for kap10 API (reused by Phase 5.5)
lib/temporal/workflows/
  sync-local-graph.ts              ← syncLocalGraphWorkflow definition
lib/temporal/activities/
  graph-export.ts                  ← queryCompactGraph, serializeToMsgpack, computeChecksum
  graph-upload.ts                  ← uploadToStorage, notifyConnectedClients
lib/use-cases/
  graph-compactor.ts               ← Body truncation + edge key extraction
app/api/graph-snapshots/
  route.ts                         ← GET /api/graph-snapshots (list)
  [repoId]/
    download/route.ts              ← GET /api/graph-snapshots/{repoId}/download
    sync/route.ts                  ← POST /api/graph-snapshots/{repoId}/sync
components/repo/
  local-setup-instructions.tsx     ← Local setup instructions for Connect IDE page
```

### Modified Files

```
prisma/schema.prisma               ← GraphSnapshotMeta model + SnapshotStatus enum
env.mjs                            ← GRAPH_SNAPSHOT_BUCKET, GRAPH_SNAPSHOT_TTL_HOURS, GRAPH_SYNC_CRON
.env.example                       ← Document Phase 10a variables
components/dashboard/repo-card.tsx ← Local Sync status badge
app/(dashboard)/repos/[repoId]/page.tsx          ← "Sync Now" button
app/(dashboard)/repos/[repoId]/connect/page.tsx  ← Local setup tab
```

---

## Revision Log

| Date | Author | Change |
|------|--------|--------|
| 2026-02-20 | — | Initial document created. 10 API items, 3 adapter items, 5 infrastructure items, 2 database items, 6 CLI items, 3 UI items, 12 test items. Total: **41 tracker items.** |
