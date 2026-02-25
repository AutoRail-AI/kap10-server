# Phase 12 — Multiplayer Collaboration & Collision Detection

> **Architectural Deep Dive & Implementation Tracker**
>
> _"When two agents (or developers) are editing the same function, I get a real-time warning before conflicts happen — not after a merge conflict."_

---

## Canonical Terminology

| Term | Definition | Boundary |
|------|-----------|----------|
| **Entity Activity Record** | An ephemeral ArangoDB document in the `entity_activity` collection recording that a session touched a specific entity (function, class, file). TTL: 30 min. | Not a permanent audit log — automatically pruned. Never replaces Git history. |
| **Collision** | Two or more MCP sessions touching the same entity within the TTL window, on the same repo but different user IDs. | Entity-level granularity, not line-level. A "touch" is any tool call that reads or mutates the entity. Same-user multi-session is NOT a collision. |
| **Presence** | A lightweight heartbeat indicating a session is connected and active on a repo. Stored in Redis with a short TTL (60 s, refreshed on every tool call). | Presence is NOT position — no cursor coordinates, no open-file tracking. It answers "who is online?" not "where are they?". |
| **Activity Tracker** | Server-side module that intercepts every MCP tool call, extracts affected entity keys, and upserts activity records. Runs synchronously in the tool-call hot path. | Adds latency to every tool response. Budget: < 5 ms per tool call (Redis write + ArangoDB upsert). |
| **Collision Detector** | Server-side module that queries `entity_activity` for overlapping sessions on the same entity set. Runs after entity activity is recorded, before the tool response is sent. | Returns collision metadata — does NOT block the tool call. Collisions are warnings, never locks. |
| **Broadcast Bus** | Redis pub/sub channel layer that pushes collision events to all connected SSE clients on the same repo. | One-way server→client push. Not a general-purpose message bus — scoped to collision and presence events only. |
| **SSE Client Registry** | In-memory `Map<sessionId, ServerResponse>` on the MCP server process that tracks connected SSE streams. | Per-process only. Multi-instance deployments require Redis pub/sub fanout so every process can push to its local clients. |
| **`_meta.collision`** | A structured object appended to MCP tool responses when the collision detector finds overlapping activity. Follows the same `_meta` extension pattern as Phase 11's `renderHint`. | Agents that ignore `_meta` see no difference. Agents that read it can surface warnings to users. |

---

## Part 1: Architectural Deep Dive

### 1. Core User Flows

#### Flow 1: Entity Activity Recording (Every Tool Call)

```
Actor: Any MCP client (Cursor, VS Code, JetBrains, CLI)
Trigger: Any tool call that touches entities (get_function, search_code, sync_local_diff, etc.)
```

1. MCP client sends `tools/call` request with session header `Mcp-Session-Id: sess_A`.
2. Transport layer authenticates session, resolves `McpAuthContext { orgId, repoId, userId }`.
3. Tool handler executes, produces a result containing entity references (entity keys, file paths, function names).
4. **Activity Recorder** intercepts the result before response serialization:
   a. Extracts affected entity keys from the tool result. Extraction is tool-specific:
      - `get_function` / `get_class` / `inspect_entity` → single entity key from the request params.
      - `search_code` / `search_semantic` → set of entity keys from the result content.
      - `sync_local_diff` → entity keys derived from `parseDiffHunks(diff)` mapped to overlapping entities via ArangoDB range query.
      - `get_file_tree` / `get_stats` → no entity-level activity (file-tree browsing is not a collision signal).
   b. For each affected entity key, upserts an activity record:
      ```
      entity_activity/{sessionId}_{entityKey}
        sessionId, userId, entityKey, entityType, entityName,
        filePath, action ("read" | "edit" | "search"),
        repoId, branch, org_id, timestamp
        TTL: 1800 (30 minutes)
      ```
   c. Upsert is idempotent — same session re-reading the same entity just refreshes the timestamp.
5. **Collision Detector** runs immediately after activity recording:
   a. Queries `entity_activity` for all records matching the same `repoId` + `entityKey` set, excluding the current `sessionId`.
   b. Groups results by entity, producing a collision set: `[{ entityKey, otherSessions: [{ userId, userName, branch, lastAction, lastActiveAt }] }]`.
   c. If collision set is non-empty, attaches `_meta.collision` to the tool response.
6. **Broadcast Bus** publishes a collision event to Redis channel `unerr:collab:{orgId}:{repoId}`:
   ```
   { type: "collision", entities: [...], involvedSessions: [sess_A, sess_B], timestamp }
   ```
7. MCP server processes with connected SSE clients on that repo receive the pub/sub message and push it to the relevant sessions via their `ServerResponse` handles.
8. Tool response (with `_meta.collision` if applicable) is sent to the original client.

**Latency budget for steps 4–7:** < 15 ms total (5 ms ArangoDB upsert + 3 ms ArangoDB query + 2 ms Redis publish + 5 ms SSE write). This is added to every tool call, so minimizing it is critical.

#### Flow 2: SSE Connection & Real-Time Collision Push

```
Actor: IDE extension (VS Code / JetBrains) or Dashboard
Trigger: Client opens an SSE connection to GET /mcp (or GET /api/repos/:repoId/presence for dashboard)
```

1. Client sends `GET /mcp` with `Authorization: Bearer <token>` and `Mcp-Session-Id: sess_A`.
2. Transport authenticates the session, confirms it belongs to a valid MCP session in Redis.
3. Server upgrades the response to SSE (`Content-Type: text/event-stream`).
4. **SSE Client Registry** stores `sseClients.set(sess_A, { res, orgId, repoId, userId })`.
5. Server immediately sends a `presence_snapshot` event with current active sessions on this repo:
   ```
   event: presence_snapshot
   data: { "sessions": [{ "userId": "user_bob", "userName": "Bob", "branch": "fix/jwt", "clientType": "vscode", "lastActiveAt": "..." }] }
   ```
6. Server subscribes (if not already) to Redis channel `unerr:collab:{orgId}:{repoId}`.
7. When a collision event arrives via pub/sub:
   a. Server iterates `sseClients` entries matching the involved sessions.
   b. Sends typed SSE event:
      ```
      event: collision
      data: { "entities": [...], "otherSessions": [...], "warning": "..." }
      ```
8. When a presence change arrives (new session joins, session disconnects):
   ```
   event: presence_update
   data: { "action": "join" | "leave", "session": { ... } }
   ```
9. On client disconnect (`req.on("close")`):
   a. Remove from SSE Client Registry.
   b. Publish `presence_update` (leave) to Redis channel.
   c. If no more local clients on this channel, unsubscribe from Redis.

#### Flow 3: Dashboard Presence Panel

```
Actor: Developer viewing the repo detail page in the unerr dashboard
Trigger: Page load of /repos/:repoId
```

1. Server component fetches active sessions via `ICacheStore.scan("mcp:session:*")`, filtering by `repoId`.
2. Renders `<ActiveSessions>` component showing avatars, branch names, client types, and last-active timestamps.
3. Client component opens an `EventSource` to `GET /api/repos/:repoId/presence` (lightweight SSE endpoint, separate from MCP).
4. As presence events arrive, the component live-updates the session roster.
5. If a collision is active, a `<CollisionBadge>` appears on the repo card in the dashboard list view, linking to the detail page for resolution context.

#### Flow 4: IDE Extension Collision Display

```
Actor: Developer using VS Code or JetBrains with unerr extension installed
Trigger: Collision SSE event received by the extension
```

1. Extension maintains a persistent SSE connection to the MCP server (established during `unerr connect`).
2. On receiving a `collision` event:
   a. Parse entity list and map entity keys to file paths + line ranges (using cached graph data from `get_function`/`get_class` responses).
   b. For each affected file currently open in the editor:
      - **VS Code**: Apply `TextEditorDecorationType` with gutter icon (collision warning) and inline annotation (`"Bob is editing this function"`). Decoration is styled with `#E34234` (warning red) and italic text.
      - **JetBrains**: Apply `ExternalAnnotator` with `HighlightSeverity.WARNING`, custom gutter icon, and tooltip showing the other user's identity and branch.
   c. Show a notification toast: `"Collision detected: Bob is also editing validateJWT on branch fix/jwt-expiry"`.
3. Decorations auto-clear when:
   a. A `collision_resolved` event arrives (the other session's activity TTL expired).
   b. The user navigates away from the file.
   c. The SSE connection drops (graceful degradation — decorations are transient, not persistent).

---

### 2. System Logic & State Management

#### State Topology

```
                         ┌─────────────────────────────┐
                         │        Redis (Ephemeral)      │
                         │                               │
                         │  mcp:session:{id}  (1h TTL)   │
                         │  mcp:presence:{id} (60s TTL)  │
                         │  pub/sub channels:             │
                         │    unerr:collab:{org}:{repo}   │
                         └──────────┬────────────────────┘
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          │                         │                         │
          ▼                         ▼                         ▼
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────────┐
│  ArangoDB (TTL)   │   │  MCP Server       │   │  Supabase (Durable)   │
│                   │   │  (In-Memory)      │   │                       │
│  entity_activity  │   │                   │   │  notifications table  │
│  (30 min TTL)     │   │  SSE Client       │   │  (collision type)     │
│                   │   │  Registry (Map)   │   │                       │
└──────────────────┘   └──────────────────┘   └──────────────────────┘
```

**Three tiers of state, three durability guarantees:**

| Tier | Store | TTL | Purpose | Loss impact |
|------|-------|-----|---------|-------------|
| **Heartbeat** | Redis `mcp:presence:{sessionId}` | 60 s | "Is this session alive?" | Presence goes stale for 60 s — self-heals on next tool call |
| **Activity** | ArangoDB `entity_activity` | 30 min | "What entities has this session touched?" | Collision detection misses until next touch — non-critical |
| **Notification** | Supabase `notifications` | Permanent | "What collisions happened?" (audit trail) | User misses notification — can see it later in dashboard |

#### Entity Activity Write Path

The activity recorder must handle high throughput without becoming a bottleneck. Design:

```
Tool call completes
  │
  ▼
Extract entity keys (tool-specific extractor map)
  │
  ├── 0 entities (get_file_tree, get_stats) → skip activity recording entirely
  │
  ├── 1 entity (get_function, inspect_entity) → single upsert
  │
  └── N entities (search_code, sync_local_diff) → batch upsert (max 50)
        │
        ▼
  ArangoDB upsert with overwriteMode: "update"
    _key: deterministic hash of sessionId + entityKey
    ON DUPLICATE UPDATE timestamp, action
  │
  ▼
  Collision query: AQL
    FOR a IN entity_activity
      FILTER a.repoId == @repoId
        AND a.entityKey IN @entityKeys
        AND a.sessionId != @currentSession
        AND a.timestamp > DATE_SUB(DATE_NOW(), 30, "minute")
      COLLECT entityKey = a.entityKey INTO sessions
      RETURN { entityKey, sessions: sessions[*].a }
  │
  ├── Empty result → no collision, return tool response as-is
  │
  └── Non-empty → attach _meta.collision, publish to Redis channel
```

**Deterministic `_key` generation**: `sha256(sessionId + ":" + entityKey).slice(0, 16)`. This ensures upsert idempotency without needing a separate uniqueness constraint. Same session + same entity always maps to the same document.

#### Presence Heartbeat

Presence is maintained passively — no dedicated heartbeat messages from the client. Every MCP tool call refreshes the presence key:

```
On every tools/call:
  Redis SET mcp:presence:{sessionId} { userId, repoId, branch, clientType, lastActiveAt } EX 60
```

If a session goes 60 seconds without a tool call, its presence key expires and a `presence_update` (leave) event fires (detected via Redis keyspace notifications or a periodic sweep).

**Redis keyspace notifications vs polling sweep:**

| Approach | Latency | Complexity | Reliability |
|----------|---------|------------|-------------|
| `__keyevent@0__:expired` | ~0 s | Moderate (requires `notify-keyspace-events Ex` config) | Can miss events under Redis memory pressure |
| Periodic sweep (every 15 s) | 0–15 s | Low (simple `SCAN` + publish) | Deterministic, no Redis config dependency |

**Decision:** Use periodic sweep. A 15-second delay in detecting session departure is acceptable for presence indicators. This avoids requiring Redis keyspace notification configuration, which may not be enabled in all deployment environments (managed Redis services sometimes restrict `CONFIG SET`).

#### Collision Classification

Not all entity overlaps are equal. The collision detector classifies severity:

| Session A action | Session B action | Severity | Warning text |
|-----------------|-----------------|----------|-------------|
| `edit` | `edit` | **Critical** | "Both editing — high conflict risk" |
| `edit` | `read` | **Warning** | "You're reading code that {user} is editing" |
| `read` | `edit` | **Warning** | "You're editing code that {user} is reading" |
| `read` | `read` | **Info** | "Also being reviewed by {user}" (suppressed by default) |
| `search` | any | **None** | No collision — search hits are not intent signals |

The `action` field is set by the activity recorder based on the tool type:
- `edit`: `sync_local_diff`, `pin_snippet` (Phase 9)
- `read`: `get_function`, `get_class`, `inspect_entity`, `get_file`
- `search`: `search_code`, `search_semantic`, `get_file_tree`, `get_stats`

**Read-read collisions are suppressed by default** to avoid notification fatigue. They can be enabled per-org via a setting (`collaborationSettings.showReadReadCollisions: boolean`).

#### SSE Client Registry & Multi-Instance Fanout

The MCP server runs as a standalone Node.js process (`mcp-server/index.ts`), separate from Next.js. In production, multiple instances may run behind a load balancer:

```
Instance 1                    Instance 2
┌─────────────────┐          ┌─────────────────┐
│ SSE Registry     │          │ SSE Registry     │
│ sess_A → res_A   │          │ sess_B → res_B   │
│ sess_C → res_C   │          │ sess_D → res_D   │
└────────┬────────┘          └────────┬────────┘
         │                            │
         └────────────┬───────────────┘
                      │
              Redis pub/sub
         unerr:collab:{org}:{repo}
```

When Instance 1 detects a collision involving `sess_A` and `sess_B`:
1. Instance 1 publishes the collision event to Redis channel.
2. Instance 1 pushes to `sess_A` (local).
3. Instance 2 receives the pub/sub message, pushes to `sess_B` (local).

This requires two `ioredis` connections per MCP server process:
- **Command connection** (existing): GET/SET/DEL operations.
- **Subscriber connection** (new): Dedicated to `SUBSCRIBE`/`PSUBSCRIBE`. Once subscribed, this connection cannot run regular commands (Redis protocol constraint).

#### Redis Pub/Sub Channel Design

```
Channel pattern: unerr:collab:{orgId}:{repoId}

Message types:
  { type: "collision",        entities: [...], involvedSessions: [...] }
  { type: "collision_resolved", entityKey: "...", resolvedSession: "..." }
  { type: "presence_join",    session: { userId, userName, branch, clientType } }
  { type: "presence_leave",   session: { userId, sessionId } }
```

Channel granularity is per-repo, not per-entity. Rationale:
- A typical repo has 2–5 concurrent sessions (small fanout).
- Per-entity channels would create thousands of subscriptions — Redis `SUBSCRIBE` count becomes a scaling concern.
- Clients filter irrelevant events locally (cheap string comparison).

#### Schema Impact

**ArangoDB — New collection:**

```
Collection: entity_activity
Type: Document
Indexes:
  - TTL index on "timestamp" (expireAfter: 1800)
  - Persistent index on ["repoId", "entityKey"] (for collision queries)
  - Persistent index on ["sessionId"] (for session cleanup)

Document shape:
{
  _key: string,           // sha256(sessionId + ":" + entityKey).slice(0, 16)
  sessionId: string,
  userId: string,
  userName: string,       // Denormalized for display (avoids join at read time)
  entityKey: string,      // e.g., "fn_validateJWT"
  entityType: string,     // "function" | "class" | "file"
  entityName: string,     // "validateJWT"
  filePath: string,       // "lib/auth/jwt.ts"
  action: string,         // "read" | "edit" | "search"
  repoId: string,
  branch: string,
  org_id: string,
  timestamp: number       // Unix epoch ms (used by TTL index)
}
```

**Redis — New key patterns:**

```
mcp:presence:{sessionId}   → JSON { userId, repoId, branch, clientType, lastActiveAt }  TTL 60s
unerr:collab:{orgId}:{repoId}  → pub/sub channel (no key — channel only)
```

**Supabase — Extension of existing `notifications` table:**

Add `"collision"` to the `NotificationType` enum. No schema migration needed if the column is a text field (verify). Collision notifications are written asynchronously (fire-and-forget from the broadcast bus) for audit/history purposes.

**ICacheStore port — New methods:**

```
publish(channel: string, message: unknown): Promise<void>
subscribe(channel: string, handler: (message: unknown) => void): Promise<void>
unsubscribe(channel: string): Promise<void>
scan(pattern: string, count?: number): Promise<string[]>
```

**IGraphStore port — New methods:**

```
upsertEntityActivity(activity: EntityActivityDoc): Promise<void>
upsertEntityActivityBatch(activities: EntityActivityDoc[]): Promise<void>
queryEntityCollisions(repoId: string, entityKeys: string[], excludeSession: string): Promise<CollisionResult[]>
deleteEntityActivity(sessionId: string): Promise<void>  // cleanup on disconnect
```

---

### 3. Reliability & Resilience

#### Failure Mode: ArangoDB Upsert Fails

**Impact:** Activity record not written → collision detection blind spot for this tool call.

**Mitigation:** Activity recording is non-blocking. If the ArangoDB upsert fails:
1. Log the error at `warn` level (not `error` — this is degraded, not broken).
2. Return the tool response without `_meta.collision` (tool functionality is unaffected).
3. Do NOT retry — the next tool call will re-record activity. The 30-minute TTL window provides ample overlap.

**Rationale:** Collision detection is advisory, not transactional. A missed collision warning is far less costly than a blocked tool response. Users still have Git merge conflict detection as the ultimate safety net.

#### Failure Mode: Redis Pub/Sub Publish Fails

**Impact:** Collision event not broadcast → other sessions don't receive real-time push.

**Mitigation:**
1. The originating session still gets `_meta.collision` in its tool response (this is synchronous, not pub/sub-dependent).
2. Other sessions will detect the collision on their next tool call (when the collision detector runs for them).
3. Redis pub/sub is fire-and-forget by protocol — there is no delivery guarantee. The system is designed to tolerate missed events.

#### Failure Mode: SSE Connection Drops

**Impact:** Client stops receiving real-time collision and presence events.

**Mitigation:**
1. IDE extensions implement exponential backoff reconnection (initial: 1 s, max: 30 s, jitter: random 0–500 ms).
2. On reconnect, server sends a fresh `presence_snapshot` event so the client has current state.
3. The `_meta.collision` mechanism is independent of SSE — even without an SSE connection, tool responses include collision metadata. SSE is an enhancement, not the primary delivery channel.

#### Failure Mode: Redis Subscriber Connection Dies

**Impact:** This MCP server instance stops receiving pub/sub messages → its local SSE clients get no push events.

**Mitigation:**
1. `ioredis` has built-in reconnect with exponential backoff (default: enabled).
2. On reconnect, re-subscribe to all active channels (ioredis handles this automatically for `SUBSCRIBE` commands issued before disconnect).
3. Health check endpoint includes subscriber connection status. Load balancer can drain unhealthy instances.

#### Failure Mode: MCP Server Instance Crashes

**Impact:** All SSE connections on that instance drop. Presence keys in Redis expire after 60 s (self-healing). Activity records in ArangoDB remain valid (TTL-based, not process-bound).

**Mitigation:**
1. Load balancer detects health check failure, routes new connections to healthy instances.
2. IDE extensions reconnect to a (potentially different) instance.
3. No data loss — all state is in Redis/ArangoDB, not in-process memory (except the SSE Client Registry, which is transient by design).

#### Failure Mode: High Activity Volume (Thundering Herd)

**Scenario:** A large team (20+ sessions) all running `search_code` on the same repo simultaneously (e.g., after a deployment).

**Impact:** Each search returns 10–50 entity keys → 20 sessions × 50 entities = 1,000 activity upserts + 20 collision queries in a short window.

**Mitigation:**
1. **Search actions don't trigger collision detection** (see classification table above). `search` is excluded from collision signals, so the 1,000 upserts happen but zero collision queries fire.
2. Batch upserts are capped at 50 entities per tool call. If a search returns 200 results, only the top 50 (by relevance score) are recorded.
3. ArangoDB TTL index cleanup runs asynchronously — expired documents don't block writes.

#### Graceful Degradation Hierarchy

| Component down | User experience | Auto-recovery |
|---------------|----------------|---------------|
| ArangoDB `entity_activity` | No collision detection; tools work normally | Next successful write restores detection |
| Redis pub/sub | No real-time push; `_meta.collision` still works per-request | ioredis auto-reconnect |
| SSE connection | No push events; `_meta.collision` in tool responses is primary channel | Extension reconnects with backoff |
| Redis presence keys | Dashboard shows stale presence for up to 60 s | Keys expire, sweep publishes leave events |
| Entire collaboration layer | All MCP tools function identically to pre-Phase-12 behavior | Full system restart restores collaboration |

**Key design principle:** The collaboration layer is a pure enhancement. Removing it entirely leaves the system in its pre-Phase-12 state with zero functional regression.

---

### 4. Performance Considerations

#### Hot Path Latency Budget

The activity recording and collision detection run on every MCP tool call. The total added latency must stay under **15 ms** at p99:

| Step | Target | Technique |
|------|--------|-----------|
| Extract entity keys | < 1 ms | In-memory operation, no I/O |
| ArangoDB upsert (batch) | < 5 ms | `overwriteMode: "update"`, persistent index on `_key` |
| ArangoDB collision query | < 5 ms | Persistent composite index on `[repoId, entityKey]`, `LIMIT 10` |
| Redis publish | < 2 ms | Fire-and-forget (no `await` on delivery) |
| Attach `_meta.collision` | < 1 ms | JSON object construction |
| SSE write | < 1 ms | `res.write()` is buffered by Node.js |

**Measurement:** Wrap the activity+collision path in a `performance.mark()`/`performance.measure()` pair. Log p50/p95/p99 to observability. If p99 exceeds 15 ms, move activity recording to a post-response microtask (`queueMicrotask`) — collision metadata in `_meta` would be delayed to the next request, but tool response latency is preserved.

#### ArangoDB Index Strategy

The `entity_activity` collection will receive high write volume (every tool call) and moderate read volume (collision queries). Index design:

```
TTL index:       { "timestamp" }         → Auto-cleanup, no manual GC
Persistent:      { "repoId", "entityKey" } → Collision query (equality + IN)
Persistent:      { "sessionId" }         → Session cleanup on disconnect
```

**No full-text or geo indexes.** The collection is small (bounded by TTL) — a typical repo with 5 concurrent sessions produces ~500 activity records (5 sessions × ~100 entities touched in 30 min). ArangoDB handles this trivially.

#### Redis Pub/Sub Throughput

Redis pub/sub is O(N) where N is the number of subscribers on the channel. With per-repo channels and typical concurrency (2–10 sessions per repo), N is small.

**Worst case:** 100 repos × 10 sessions each = 1,000 channel subscriptions across all MCP server instances. Redis handles millions of pub/sub messages per second — this is not a bottleneck.

**Message size budget:** Collision events should be < 1 KB. Include only entity keys and session metadata — never include entity source code in pub/sub messages.

#### SSE Connection Limits

Each SSE connection holds an open HTTP response. Node.js default `maxConnections` is unlimited, but each connection consumes a file descriptor and ~50 KB of memory (TCP buffers).

**Budget:** 1,000 concurrent SSE connections per MCP server instance ≈ 50 MB memory overhead. Acceptable for a dedicated server process.

**Keepalive:** Send `event: ping` every 30 s (existing behavior) to prevent proxy/load balancer timeout. Most proxies close idle connections after 60–120 s.

#### Dashboard Presence Endpoint

`GET /api/repos/:repoId/presence` (the dashboard SSE endpoint) runs in Next.js, not the MCP server. It needs to:

1. Initial load: `SCAN mcp:presence:*` filtered by repoId → O(N) where N is total presence keys.
2. Live updates: Subscribe to `unerr:collab:{orgId}:{repoId}` for presence events.

**Optimization:** Cache the active session list in Redis as a sorted set `unerr:repo-sessions:{repoId}` with score = lastActiveAt. This avoids `SCAN` on every page load:

```
On presence refresh:  ZADD unerr:repo-sessions:{repoId} {timestamp} {sessionId}
On presence expire:   ZREM unerr:repo-sessions:{repoId} {sessionId}
On dashboard load:    ZRANGEBYSCORE unerr:repo-sessions:{repoId} {now - 120s} +inf
```

This turns the initial load from O(all-sessions) to O(sessions-on-this-repo).

---

### 5. Phase Bridge

#### What Phase 12 Hands to Phase ∞ (Heavy Worker Performance Rewrite)

Phase 12 introduces no Rust-rewritable components. All collaboration infrastructure is network-bound (Redis pub/sub, SSE, ArangoDB TTL queries) — exactly the workload that stays in TypeScript per Phase ∞'s decision matrix.

#### What Phase 12 Inherits from Previous Phases

| From Phase | What | How Phase 12 uses it |
|------------|------|---------------------|
| **Phase 2** (MCP Server) | `McpAuthContext`, session storage, `GET /mcp` SSE stub | Activity recorder reads session context. SSE stub is upgraded to a full event dispatch system. |
| **Phase 3** (Semantic Search) | Entity key format, `parseDiffHunks` | Collision detection uses entity keys as the unit of comparison. Diff parsing maps file changes to entity boundaries. |
| **Phase 5** (Workspace Overlays) | Per-user workspace model, Redis distributed lock | Workspace-scoped lock pattern (`setIfNotExists`) is extended to entity-scoped activity TTLs. |
| **Phase 11** (IDE Integrations) | VS Code extension, JetBrains plugin, `_meta` convention | Collision decorations are added to existing extension code. `_meta.collision` follows the same pattern as `_meta.renderHint`. |

#### What Phase 12 Establishes for Future Phases

1. **Redis pub/sub infrastructure** (`ICacheStore.publish/subscribe`) — reusable for any server→client push feature (live indexing progress, webhook notifications, CI/CD status updates).
2. **SSE Client Registry pattern** — the `Map<sessionId, ServerResponse>` + Redis fanout pattern is the foundation for any future real-time feature.
3. **Entity activity data** — while TTL-limited, the activity recording pattern can be adapted for analytics (aggregate "most actively edited entities this week" for team insights).
4. **Presence system** — the heartbeat + sweep pattern generalizes to any "online status" indicator.

#### Boundary Constraints

- **No CRDTs or OT:** Phase 12 is collision *detection*, not collision *resolution*. There is no shared document state, no real-time co-editing, no merge logic. Conflict resolution remains Git-based.
- **No WebSockets (yet):** SSE is sufficient for server→client push. WebSocket upgrade is deferred to when bidirectional communication is needed (e.g., cursor tracking, live co-editing in Phase 13+).
- **No LiveKit:** Raw WebSockets are the migration target if SSE proves insufficient. LiveKit is deferred until voice/video pair programming is on the roadmap.
- **Entity-level, not line-level:** Collisions are detected at function/class/file granularity, not at individual line ranges. Line-level tracking would require cursor position reporting from IDE extensions — a Phase 13+ concern.

---

## Part 2: Implementation & Tracing Tracker

### Layer: Infrastructure (INFRA)

- [ ] **INFRA-01: Create `entity_activity` ArangoDB collection**
  - Bootstrap in `arango-graph-store.ts` alongside existing collection setup
  - Add TTL index on `timestamp` (expireAfter: 1800)
  - Add persistent index on `[repoId, entityKey]`
  - Add persistent index on `[sessionId]`
  - **Test:** Collection exists after bootstrap; TTL index configured correctly
  - **Notes:** Follows existing collection bootstrap pattern in `ensureCollections()`

- [ ] **INFRA-02: Add Redis subscriber connection**
  - Create `getRedisSubscriber()` in `lib/queue/redis.ts` returning a dedicated `ioredis` instance
  - Must be a separate connection from the command connection (Redis protocol requirement)
  - Lazy initialization with same connection config as existing `getRedis()`
  - **Test:** Two distinct connections; subscriber can receive pub/sub messages while command connection runs GET/SET
  - **Notes:** `ioredis` auto-reconnects and re-subscribes. Existing `getRedis()` unchanged.

- [ ] **INFRA-03: Add `ws` package to dependencies**
  - `pnpm add ws` + `pnpm add -D @types/ws`
  - Reserved for future WebSocket upgrade path — not used in initial Phase 12 (SSE-first approach)
  - **Test:** Package installs without conflicts
  - **Notes:** Added now to establish the dependency. Actual WebSocket server implementation deferred until SSE proves insufficient.

---

### Layer: Database & Schema (DB)

- [ ] **DB-01: Define `EntityActivityDoc` type in `lib/ports/types.ts`**
  - Fields: `_key`, `sessionId`, `userId`, `userName`, `entityKey`, `entityType`, `entityName`, `filePath`, `action` (`"read" | "edit" | "search"`), `repoId`, `branch`, `org_id`, `timestamp`
  - Add `CollisionResult` type: `{ entityKey, entityType, entityName, filePath, otherSessions: CollisionSession[] }`
  - Add `CollisionSession` type: `{ userId, userName, branch, lastAction, lastActiveAt, sessionId }`
  - **Test:** Types compile; match ArangoDB document shape
  - **Notes:** `action` is a union, not an enum — no Prisma dependency

- [ ] **DB-02: Add `CollisionMeta` type for `_meta.collision`**
  - Define in `lib/ports/types.ts` alongside existing MCP types
  - Shape: `{ detected: boolean, entities: CollisionEntity[], warning: string }`
  - `CollisionEntity`: `{ entityKey, entityName, entityType, filePath, otherSessions: CollisionSession[] }`
  - **Test:** Type matches JSON shape from the vertical slicing plan spec
  - **Notes:** Follows same `_meta` extension pattern as Phase 11's `renderHint`

- [ ] **DB-03: Add `"collision"` to notification type**
  - Verify `notifications.type` column type in Supabase — if text, no migration needed
  - If enum, create migration `supabase/migrations/2026MMDD_add_collision_notification_type.sql`
  - **Test:** Can insert a notification with `type = 'collision'`
  - **Notes:** Check `lib/db/types.ts` `NotificationType` union and add `"collision"` if missing

- [ ] **DB-04: Add `unerr:repo-sessions:{repoId}` sorted set convention**
  - Document key pattern in Redis key registry
  - Score: Unix timestamp of last activity
  - Members: sessionId strings
  - **Test:** ZADD/ZRANGEBYSCORE/ZREM operations work as expected
  - **Notes:** No schema change — Redis is schemaless. This is a convention document.

---

### Layer: Adapters (ADAPT)

- [ ] **ADAPT-01: Extend `ICacheStore` port with pub/sub + scan methods**
  - Add `publish(channel: string, message: unknown): Promise<void>`
  - Add `subscribe(channel: string, handler: (message: unknown) => void): Promise<void>`
  - Add `unsubscribe(channel: string): Promise<void>`
  - Add `scan(pattern: string, count?: number): Promise<string[]>`
  - **Test:** Port interface compiles; existing implementations still satisfy the interface (add no-op defaults to fakes)
  - **Notes:** `subscribe` handler receives deserialized JSON. `scan` uses Redis `SCAN` with `COUNT` hint.

- [ ] **ADAPT-02: Implement pub/sub in `RedisCacheStore`**
  - `publish`: `this.redis.publish(channel, JSON.stringify(message))`
  - `subscribe`: Use subscriber connection (`getRedisSubscriber()`), parse JSON in message handler
  - `unsubscribe`: Unsubscribe from channel, clean up handler reference
  - `scan`: Use `redis.scanStream({ match: pattern, count })`, collect all keys
  - Maintain a `Map<string, Set<(msg: unknown) => void>>` for channel→handler mapping
  - **Test:** Publish on command connection, receive on subscriber connection; scan returns matching keys
  - **Notes:** `scanStream` is preferred over raw `SCAN` cursor management — ioredis handles cursor iteration

- [ ] **ADAPT-03: Implement entity activity methods in `ArangoGraphStore`**
  - `upsertEntityActivity(doc)`: `db.collection("entity_activity").save(doc, { overwriteMode: "update" })`
  - `upsertEntityActivityBatch(docs)`: `db.collection("entity_activity").saveAll(docs, { overwriteMode: "update" })`
  - `queryEntityCollisions(repoId, entityKeys, excludeSession)`: AQL query with composite index hint
  - `deleteEntityActivity(sessionId)`: AQL `REMOVE` by sessionId index
  - **Test:** Upsert idempotent (same key → update timestamp); collision query returns correct sessions; batch upsert handles 50 docs; TTL-expired docs excluded from query results
  - **Notes:** `_key` is deterministic: `sha256(sessionId + ":" + entityKey).slice(0, 16)`

- [ ] **ADAPT-04: Extend `IGraphStore` port with entity activity methods**
  - Add `upsertEntityActivity`, `upsertEntityActivityBatch`, `queryEntityCollisions`, `deleteEntityActivity` to interface
  - Add no-op implementations in `FakeGraphStore`
  - **Test:** Port compliance test updated; fake returns empty arrays
  - **Notes:** Follows existing pattern of adding methods to port + fake simultaneously

- [ ] **ADAPT-05: Update `FakeCacheStore` with pub/sub + scan stubs**
  - `publish`: Store messages in an in-memory array (for test assertions)
  - `subscribe`: Register handler in a Map, invoke on `publish` calls (in-process fanout)
  - `unsubscribe`: Remove handler
  - `scan`: Filter in-memory key store by glob pattern
  - **Test:** Fake pub/sub works end-to-end in unit tests without Redis
  - **Notes:** The fake must support synchronous in-process pub/sub for deterministic tests

---

### Layer: API & Business Logic (API)

- [ ] **API-01: Create `lib/use-cases/activity-recorder.ts`**
  - `recordEntityActivity(ctx, toolName, entityKeys, action)` → batch upsert to ArangoDB
  - Entity key extraction: tool-specific map:
    - `get_function`, `get_class`, `inspect_entity` → single key from params
    - `search_code`, `search_semantic` → keys from result (capped at 50)
    - `sync_local_diff` → keys from `parseDiffHunks()` mapped to entities
    - `get_file_tree`, `get_stats` → no-op (returns immediately)
  - Refresh presence key: `cacheStore.set("mcp:presence:{sessionId}", ..., 60)`
  - Update repo session set: `ZADD unerr:repo-sessions:{repoId} {now} {sessionId}`
  - **Test:** Correct entity extraction per tool type; ArangoDB upsert called with correct shape; presence refreshed; skip for no-entity tools
  - **Notes:** Must be non-blocking on failure (try/catch + warn log)

- [ ] **API-02: Create `lib/use-cases/collision-detector.ts`**
  - `detectCollisions(ctx, entityKeys)` → query ArangoDB → classify severity → build `CollisionMeta`
  - Severity classification: edit+edit=critical, edit+read=warning, read+read=info (suppressed default), search=none
  - Build warning text with user names, branches, and relative timestamps
  - **Test:** Correct severity per action-pair matrix; empty result when no collision; suppression of read-read; warning text includes user name and branch
  - **Notes:** Returns `null` when no collision (not an empty object)

- [ ] **API-03: Create `lib/mcp/middleware/collision-middleware.ts`**
  - Post-response middleware that runs after tool handler completes, before response serialization
  - Calls `recordEntityActivity` → `detectCollisions` → attaches `_meta.collision` if non-null
  - Publishes collision event to Redis channel if collision detected
  - Wraps entire flow in try/catch — never fails the tool response
  - **Test:** Tool response includes `_meta.collision` when collision exists; tool response unchanged when no collision; middleware catches and logs errors without propagation
  - **Notes:** Middleware pattern must integrate with existing tool dispatch in `lib/mcp/tools/index.ts`

- [ ] **API-04: Create entity key extractor registry**
  - `lib/mcp/middleware/entity-extractors.ts`
  - Map of `toolName → (params, result) => string[]` functions
  - Each extractor knows how to pull entity keys from the specific tool's params/result shape
  - Default extractor: returns empty array (unknown tools don't record activity)
  - **Test:** Each extractor returns correct keys for sample tool params/results; default extractor returns empty
  - **Notes:** New tools added in future phases just need to register an extractor here

- [ ] **API-05: Create `lib/mcp/broadcast-bus.ts`**
  - `BroadcastBus` class managing:
    - Redis pub/sub subscriptions (one per active repo channel)
    - SSE Client Registry (`Map<sessionId, { res, orgId, repoId, userId }>`)
    - `registerClient(sessionId, res, ctx)` → add to registry, subscribe to repo channel if first client
    - `unregisterClient(sessionId)` → remove from registry, unsubscribe if last client on channel
    - `publishCollision(orgId, repoId, collision)` → Redis publish
    - Internal handler: on pub/sub message → iterate local clients on that repo → `res.write()`
  - **Test:** Register two clients on same repo → publish collision → both receive SSE event; unregister one → remaining client still works; unregister all → channel unsubscribed
  - **Notes:** Singleton per MCP server process. Initialize in `mcp-server/index.ts` startup.

- [ ] **API-06: Upgrade `handleMcpSse` in `lib/mcp/transport.ts`**
  - Replace ping-only stub with full SSE event dispatch
  - On connection: register client with `BroadcastBus`, send `presence_snapshot`
  - On disconnect: unregister client, publish `presence_leave`
  - Keep 30 s ping interval for keepalive
  - **Test:** SSE connection receives presence_snapshot on connect; receives collision events; cleanup on disconnect
  - **Notes:** Existing SSE auth (Bearer token, session validation) is preserved unchanged

- [ ] **API-07: Implement presence sweep**
  - Periodic function (runs every 15 s on each MCP server instance)
  - `ZRANGEBYSCORE unerr:repo-sessions:{repoId} -inf {now - 120s}` → stale sessions
  - For each stale session: `ZREM` from sorted set, publish `presence_leave` to repo channel
  - Clean up ArangoDB activity records for departed sessions: `deleteEntityActivity(sessionId)`
  - **Test:** Stale sessions (>120 s since last activity) are detected and cleaned up; presence_leave event published; ArangoDB records deleted
  - **Notes:** 120 s threshold (not 60 s) to account for the 60 s presence TTL plus a 60 s grace period

- [ ] **API-08: Upgrade `GET /api/repos/[repoId]/mcp-sessions` endpoint**
  - Replace stub (returns 0) with real implementation
  - Use `ZRANGEBYSCORE unerr:repo-sessions:{repoId} {now - 120s} +inf` to get active session IDs
  - For each session ID, `GET mcp:presence:{sessionId}` to get metadata
  - Return `{ repoId, activeSessions: count, sessions: [{ userId, userName, branch, clientType, lastActiveAt }] }`
  - **Test:** Returns correct count; sessions filtered by repoId; stale sessions excluded; auth-gated (org membership required)
  - **Notes:** This is a Next.js API route, not an MCP endpoint. Auth uses Better Auth session.

- [ ] **API-09: Create `GET /api/repos/[repoId]/presence` SSE endpoint**
  - Next.js API route that serves SSE for the dashboard presence panel
  - Subscribes to `unerr:collab:{orgId}:{repoId}` Redis channel
  - Pushes `presence_update` and `collision` events to the dashboard client
  - On initial connection: send `presence_snapshot` from sorted set
  - **Test:** SSE connection established; receives presence updates; auth-gated
  - **Notes:** Separate from MCP SSE (`GET /mcp`) — this is for the dashboard, not for agents

- [ ] **API-10: Extend MCP session metadata**
  - Add `clientType` field to MCP session record in Redis: `"cursor" | "vscode" | "jetbrains" | "cli" | "unknown"`
  - Detect client type from `User-Agent` header or `_meta.clientInfo` in `initialize` request
  - Update `McpAuthContext` type to include optional `clientType`
  - **Test:** Session creation records client type; client type flows through to collision metadata
  - **Notes:** Best-effort detection. Default to `"unknown"` if undetectable.

---

### Layer: Frontend / UI (UI)

- [ ] **UI-01: Create `components/dashboard/active-sessions.tsx`**
  - Server component that fetches initial session list from `GET /api/repos/:repoId/mcp-sessions`
  - Client wrapper with `EventSource` to `GET /api/repos/:repoId/presence` for live updates
  - Display: avatar (or initial), branch badge, client type icon (Cursor/VS Code/JetBrains/CLI), "last active X min ago"
  - Empty state: "No active sessions"
  - **Test:** Renders session list; updates on presence events; shows empty state; handles SSE disconnect gracefully
  - **Notes:** Uses design system tokens: `glass-card`, `text-muted-foreground`, `font-mono` for branch names

- [ ] **UI-02: Create `components/dashboard/collision-badge.tsx`**
  - Small badge shown on repo cards in the repos list when a collision is active
  - Fetches collision status from session data (can be derived from active sessions endpoint)
  - Click navigates to repo detail page where `<ActiveSessions>` shows full collision context
  - **Test:** Badge appears when collision active; hidden when no collision; click navigates correctly
  - **Notes:** Uses `text-destructive` for collision warning color, not arbitrary `#E34234`

- [ ] **UI-03: Integrate `<ActiveSessions>` into repo detail page**
  - Add to `app/(dashboard)/repos/[repoId]/page.tsx` below the existing repo info section
  - Wrapped in `<Suspense>` with skeleton fallback
  - Only shown when `activeSessions > 0` (collapsed/hidden for repos with no active sessions)
  - **Test:** Component renders on repo page; Suspense boundary works; hidden when no sessions
  - **Notes:** Dashboard pages inherit layout — do not recreate sidebar/shell

- [ ] **UI-04: Integrate `<CollisionBadge>` into repo card**
  - Add to `components/dashboard/repo-card.tsx`
  - Conditionally rendered based on active session count from the repos list API
  - **Test:** Badge appears on repo card; does not appear when no collision
  - **Notes:** Keep repo card lightweight — badge is a small visual indicator, not a full collision panel

- [ ] **UI-05: Add collision notification type to notification system**
  - If dashboard has a notification bell/dropdown, ensure `"collision"` type renders with appropriate icon and styling
  - Use warning icon (Lucide `AlertTriangle`) for collision notifications
  - **Test:** Collision notification renders correctly in notification list
  - **Notes:** Only if a notification UI already exists. If not, this item is deferred.

---

### Layer: IDE Extensions (IDE)

- [ ] **IDE-01: VS Code — SSE connection manager**
  - Establish persistent `EventSource` to `GET /mcp` SSE endpoint
  - Handle reconnection with exponential backoff (1 s → 30 s, jitter)
  - Parse typed events: `collision`, `collision_resolved`, `presence_update`, `presence_snapshot`
  - Store current collision state in extension-local Map
  - **Test:** Connects on activation; reconnects on drop; parses all event types; clears state on deactivation
  - **Notes:** Extends Phase 11 VS Code extension. Reuses auth token from `unerr connect`.

- [ ] **IDE-02: VS Code — Collision decorations**
  - `TextEditorDecorationType` with gutter icon and inline annotation
  - Gutter icon: warning triangle (bundled SVG asset)
  - Inline text: `" {userName} is editing this function"` in italic, `text-destructive` equivalent color
  - Apply to line range of affected entity (function/class start line → end line)
  - Auto-clear on `collision_resolved` event or when file is closed
  - **Test:** Decoration appears on correct line range; text includes user name; clears on resolution; handles multiple simultaneous collisions in same file
  - **Notes:** Use `overviewRulerColor` for minimap visibility

- [ ] **IDE-03: VS Code — Collision notification toast**
  - `vscode.window.showWarningMessage` on critical collisions (edit+edit)
  - `vscode.window.showInformationMessage` on warning collisions (edit+read)
  - Include "View in Dashboard" action button that opens the repo page in browser
  - **Test:** Toast appears for critical/warning; not for info/suppressed; action button opens correct URL
  - **Notes:** Rate-limit toasts: max 1 per entity per 5 minutes to avoid notification fatigue

- [ ] **IDE-04: JetBrains — SSE connection manager**
  - Kotlin coroutine-based `EventSource` client connecting to `GET /mcp`
  - Reconnection with exponential backoff matching VS Code behavior
  - Parse events using `kotlinx.serialization`
  - Store collision state in `ConcurrentHashMap`
  - **Test:** Connects on plugin load; reconnects on drop; parses events; clears on plugin unload
  - **Notes:** Extends Phase 11 JetBrains plugin. Shares auth token from `unerr connect`.

- [ ] **IDE-05: JetBrains — Collision annotations**
  - `ExternalAnnotator` with `HighlightSeverity.WARNING`
  - Custom gutter icon (collision warning)
  - Tooltip: `"{userName} is editing this function on branch {branch}"`
  - Apply to line range of affected entity
  - Auto-clear on `collision_resolved` event
  - **Test:** Annotation appears on correct lines; tooltip includes user info; clears on resolution
  - **Notes:** Use `EditorColorsManager` for theme-consistent colors

- [ ] **IDE-06: JetBrains — Collision notification balloon**
  - `NotificationGroup.createIdManager` with `BALLOON` type
  - Warning level for edit+edit, info level for edit+read
  - Include "Open Dashboard" action
  - Rate-limited: max 1 per entity per 5 minutes
  - **Test:** Balloon appears; correct severity level; rate limiting works
  - **Notes:** Use existing JetBrains notification framework, not custom UI

---

### Layer: Testing (TEST)

- [ ] **TEST-01: Unit — Activity recorder**
  - Test entity key extraction for each tool type
  - Test batch upsert with 50 entity limit
  - Test no-op for tools with no entity activity (get_file_tree, get_stats)
  - Test presence refresh on every call
  - Test graceful failure (ArangoDB error → warn log, no throw)
  - **Notes:** Use `FakeGraphStore` and `FakeCacheStore`

- [ ] **TEST-02: Unit — Collision detector**
  - Test all severity classifications (edit+edit, edit+read, read+edit, read+read, search+any)
  - Test read-read suppression (default off, configurable)
  - Test multi-entity collision (2+ entities colliding across sessions)
  - Test no-collision (empty result from query)
  - Test collision with 3+ sessions on same entity
  - **Notes:** Use `FakeGraphStore` seeded with activity records

- [ ] **TEST-03: Unit — Collision middleware**
  - Test middleware attaches `_meta.collision` to tool response when collision detected
  - Test middleware leaves response unchanged when no collision
  - Test middleware catches and logs errors without failing tool response
  - Test middleware skips entirely when entity extraction returns empty
  - **Notes:** Mock activity recorder and collision detector

- [ ] **TEST-04: Unit — Broadcast bus**
  - Test client registration and unregistration
  - Test channel subscription management (subscribe on first client, unsubscribe on last)
  - Test local fanout (publish → all local clients on repo receive event)
  - Test SSE event format (`event: collision\ndata: {...}\n\n`)
  - **Notes:** Use `FakeCacheStore` with in-process pub/sub

- [ ] **TEST-05: Unit — Entity key extractors**
  - Test each tool-specific extractor with representative params/results
  - Test default extractor returns empty array
  - Test cap at 50 entity keys for search results
  - **Notes:** Pure functions, no mocking needed

- [ ] **TEST-06: Unit — Presence sweep**
  - Test stale session detection (>120 s threshold)
  - Test `ZREM` called for stale sessions
  - Test `deleteEntityActivity` called for stale sessions
  - Test `presence_leave` event published for each stale session
  - Test no action when no stale sessions
  - **Notes:** Use `FakeCacheStore` with seeded sorted set entries

- [ ] **TEST-07: Integration — SSE event delivery**
  - Spin up MCP server in test harness
  - Connect two SSE clients on the same repo
  - Trigger a collision (two sessions touch same entity)
  - Verify both clients receive `collision` event
  - Verify `presence_snapshot` on connect
  - Verify `presence_leave` on disconnect
  - **Notes:** Use `supertest` or raw HTTP client for SSE testing. Requires Redis (or FakeCacheStore with in-process pub/sub).

- [ ] **TEST-08: Integration — End-to-end collision flow**
  - Session A calls `get_function("validateJWT")` → activity recorded
  - Session B calls `get_function("validateJWT")` → collision detected
  - Verify Session B's response includes `_meta.collision` with Session A's info
  - Verify SSE event pushed to Session A
  - Wait 30+ minutes (simulated) → verify collision cleared (TTL expiry)
  - **Notes:** Use test container with `FakeGraphStore` seeded with entity data

- [ ] **TEST-09: Integration — Presence lifecycle**
  - Session connects → presence key created
  - Session makes tool calls → presence refreshed
  - Session goes idle → presence expires after 60 s
  - Sweep detects stale session → `presence_leave` published
  - Dashboard endpoint reflects changes
  - **Notes:** Use `jest.advanceTimersByTime` or actual Redis TTL in integration test

- [ ] **TEST-10: Port compliance — Updated ports**
  - `ICacheStore` with publish/subscribe/unsubscribe/scan
  - `IGraphStore` with entity activity methods
  - All fakes implement new methods
  - Existing port compliance tests still pass
  - **Notes:** Update `lib/di/__tests__/port-compliance.test.ts`

- [ ] **TEST-11: Performance — Activity recording latency**
  - Benchmark activity recorder + collision detector on a mock dataset
  - Target: < 15 ms p99 for the combined path
  - Measure with 500 activity records in `entity_activity` (simulating a busy repo)
  - **Notes:** Use `performance.mark()` / `performance.measure()`. Run in CI for regression detection.

- [ ] **TEST-12: Stress — Concurrent session simulation**
  - Simulate 20 concurrent sessions on the same repo
  - Each session making tool calls at 1 call/second
  - Verify collision detection remains accurate under load
  - Verify no Redis pub/sub message loss (within fire-and-forget tolerance)
  - Verify ArangoDB upsert throughput is sufficient
  - **Notes:** Integration test, may require dedicated test Redis + ArangoDB instances

---

### Implementation Priority & Dependencies

```
INFRA-01 ──────┐
               ├── ADAPT-03, ADAPT-04 ── API-01, API-02 ── API-03 ── API-04
INFRA-02 ──┐   │
           ├── ADAPT-01, ADAPT-02 ── API-05 ── API-06
           │                              │
DB-01 ─────┘                              ├── API-07, API-08, API-09
DB-02 ─── API-03                          │
DB-03 ─── UI-05                           ├── IDE-01 ── IDE-02, IDE-03
DB-04 ─── API-07                          └── IDE-04 ── IDE-05, IDE-06
                                          │
API-10 ────────────────────────────────── UI-01, UI-02 ── UI-03, UI-04

TEST-* items depend on their corresponding implementation items.
```

**Recommended implementation order:**
1. Types & ports (DB-01, DB-02, ADAPT-01, ADAPT-04) — establish contracts
2. Infrastructure (INFRA-01, INFRA-02) — provision storage
3. Adapters (ADAPT-02, ADAPT-03, ADAPT-05) — implement contracts
4. Core business logic (API-01, API-02, API-04) — activity recording & collision detection
5. Middleware integration (API-03) — wire into MCP tool dispatch
6. Broadcast bus & SSE upgrade (API-05, API-06, API-07) — real-time push
7. Dashboard endpoints & UI (API-08, API-09, API-10, UI-01–05) — user-facing features
8. IDE extensions (IDE-01–06) — editor integration
9. Testing throughout (TEST-01–12) — each test item alongside its implementation item
