# Phase 2 — Hosted MCP Server: Deep Dive & Implementation Tracker

> **Phase Feature Statement:** _"I paste a kap10 MCP URL into Cursor/Claude Code, and my AI agent can search my codebase and inspect functions."_
>
> **Source:** [`VERTICAL_SLICING_PLAN.md`](./VERTICAL_SLICING_PLAN.md) — Phase 2
>
> **Prerequisite:** [Phase 1 — GitHub Connect & Repository Indexing](./PHASE_1_GITHUB_CONNECT_AND_INDEXING.md) (complete)
>
> **Parallel:** Phase 2 and [Phase 3 — Semantic Search](./VERTICAL_SLICING_PLAN.md) run concurrently after Phase 1. Phase 2 delivers keyword search + graph traversal via MCP tools. Phase 3 adds embedding-based semantic search as additional MCP tools. Both feed into Phase 4.
>
> **Database convention:** All kap10 Supabase tables use PostgreSQL schema `kap10`. See [VERTICAL_SLICING_PLAN.md § Storage & Infrastructure Split](./VERTICAL_SLICING_PLAN.md#storage--infrastructure-split).

---

## Table of Contents

- [Part 1: Architectural Deep Dive](#part-1-architectural-deep-dive)
  - [1.1 Core User Flows](#11-core-user-flows)
  - [1.2 System Logic & State Management](#12-system-logic--state-management)
  - [1.3 Reliability & Resilience](#13-reliability--resilience)
  - [1.4 Performance Considerations](#14-performance-considerations)
  - [1.5 Phase Bridge → Phase 3 & Phase 4](#15-phase-bridge--phase-3--phase-4)
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

Phase 2 has five actor journeys. Two actors exist: the **human user** (configures MCP, manages API keys) and the **AI agent** (Cursor, Claude Code, or any MCP-compatible client that invokes tools autonomously).

### Flow 1: API Key Provisioning

**Actor:** Authenticated user (org admin)
**Precondition:** At least one repo with `status: "ready"` (indexed in Phase 1)
**Outcome:** User has a scoped API key for MCP access

```mermaid
sequenceDiagram
    actor User
    participant Dashboard
    participant NextAPI as Next.js API (Vercel)
    participant Supabase as Supabase (kap10)

    User->>Dashboard: Navigate to /repos/[repoId]/connect
    Dashboard->>NextAPI: GET /api/repos/[repoId]
    NextAPI->>Supabase: SELECT * FROM kap10.repos WHERE id = ? AND org_id = ?
    NextAPI-->>Dashboard: Repo metadata (name, status)

    User->>Dashboard: Click "Generate API Key"
    Dashboard->>NextAPI: POST /api/api-keys { repoId, name: "Cursor - main" }
    NextAPI->>NextAPI: Generate key: kap10_sk_{random(32)}
    NextAPI->>Supabase: INSERT INTO kap10.api_keys (key_hash, repo_id, org_id, name, transport)
    Note over NextAPI: Store SHA-256 hash of key, NOT the raw key
    NextAPI-->>Dashboard: { key: "kap10_sk_a3f7c2...", id: "uuid" }

    Dashboard-->>User: API key shown ONCE (masked after dismiss)
    Dashboard-->>User: Copy-paste instructions for Cursor / Claude Code
```

**Critical decisions:**

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Key format | `kap10_sk_{random(32)}` prefixed | Prefix enables GitHub secret scanning to auto-revoke leaked keys. `sk_` is a common convention (Stripe, OpenAI). |
| Storage | SHA-256 hash in DB, raw key shown once | Industry standard. If DB is compromised, hashed keys are useless. The user must copy the key on creation. |
| Scope | Per-repo | Least privilege. A key for repo A cannot query repo B. Multi-repo keys are a Phase 5+ feature. |
| Rotation | Revoke + regenerate | No key rotation (swap). User revokes old key, generates new one. Simpler, fewer race conditions. |
| Rate limit identity | API key (not user, not IP) | API keys map 1:1 to a repo scope. Rate limiting per key prevents one agent session from starving others on the same org. |

---

### Flow 2: MCP Connection from IDE

**Actor:** AI agent (Cursor / Claude Code) via user configuration
**Precondition:** User has API key, MCP URL configured in IDE
**Outcome:** Agent establishes SSE connection to MCP server, tools available

```mermaid
sequenceDiagram
    actor Agent as AI Agent (Cursor)
    participant MCP as MCP Server (Fly.io)
    participant Redis
    participant Supabase as Supabase (kap10)

    Note over Agent: User adds MCP config to .cursor/mcp.json or claude_desktop_config.json
    Agent->>MCP: GET /api/mcp/kap10_sk_a3f7c2.../sse (SSE handshake)
    MCP->>MCP: Extract API key from URL path
    MCP->>Supabase: SELECT * FROM kap10.api_keys WHERE key_hash = SHA256(key) AND revoked_at IS NULL
    Supabase-->>MCP: { orgId, repoId, scopes }
    MCP->>MCP: Validate key → resolve org + repo context
    MCP->>Redis: INCR rate:mcp:{keyId}:connections (max 5 concurrent)

    alt Key valid, under connection limit
        MCP-->>Agent: 200 OK, SSE stream open
        MCP-->>Agent: SSE: event=endpoint, data={sessionId, postUrl}
        MCP-->>Agent: SSE: event=capabilities, data={tools: [9 tools]}
        Note over Agent,MCP: SSE stream stays open for IDE session lifetime
    else Key invalid or revoked
        MCP-->>Agent: 401 Unauthorized {error: "Invalid or revoked API key"}
    else Connection limit reached
        MCP-->>Agent: 429 Too Many Connections {error: "Max 5 concurrent sessions per key"}
    end
```

**MCP transport model — HTTP+SSE (Streamable HTTP):**

```
┌───────────────────────────────────────────────────────────────┐
│              MCP Transport: HTTP + SSE                         │
│                                                               │
│  Client (Cursor)                    Server (Fly.io)           │
│  ──────────────                     ─────────────             │
│                                                               │
│  GET /api/mcp/{key}/sse ──────────► SSE stream opened         │
│                          ◄──────── event: endpoint            │
│                          ◄──────── event: capabilities        │
│                                                               │
│  POST /api/mcp/{key}/message ────► tool_call: search_code    │
│                          ◄──────── SSE: tool_result           │
│                                                               │
│  POST /api/mcp/{key}/message ────► tool_call: get_function   │
│                          ◄──────── SSE: tool_result           │
│                                                               │
│  [... session continues for minutes to hours ...]             │
│                                                               │
│  Connection closed ──────────────► Cleanup session state      │
└───────────────────────────────────────────────────────────────┘
```

**Why this cannot run on Vercel:** SSE requires the server to hold an open TCP connection for the duration of the IDE session (minutes to hours). Vercel serverless functions timeout at 10–60 seconds. The MCP server must run as a long-lived process on Fly.io, Railway, or ECS.

---

### Flow 3: AI Agent Invokes an MCP Tool

**Actor:** AI agent (autonomous tool invocation during a coding task)
**Precondition:** SSE connection established, tools available
**Outcome:** Agent receives structured code intelligence data

```mermaid
sequenceDiagram
    actor Agent as AI Agent
    participant MCP as MCP Server
    participant Scrubber as Secret Scrubber
    participant RateLimit as Rate Limiter
    participant ArangoDB
    participant Formatter as Semantic Truncator

    Agent->>MCP: POST /message { tool: "get_function", args: { name: "validateCredentials" } }

    MCP->>Scrubber: Scrub incoming payload
    Scrubber->>Scrubber: Regex patterns (AWS keys, tokens, passwords)
    Scrubber->>Scrubber: Entropy analysis (high-entropy strings > 4.5 bits/char)
    Scrubber-->>MCP: Cleaned payload (secrets replaced with [REDACTED])

    MCP->>RateLimit: Check sliding window (apiKeyId)
    RateLimit->>Redis: EVALSHA rate_limit_script
    Redis-->>RateLimit: { allowed: true, remaining: 42 }

    alt Rate limit exceeded
        RateLimit-->>MCP: { allowed: false }
        MCP-->>Agent: SSE: tool_result { error: "Rate limit exceeded. You are calling tools too rapidly — this usually means the agent is in a loop. Pause, review your context, and ask the user for clarification." }
    end

    MCP->>ArangoDB: Search entity by name across functions, classes collections
    ArangoDB-->>MCP: EntityDoc { name, signature, file_path, line, body }
    MCP->>ArangoDB: FOR v IN 1..1 INBOUND @entityId calls RETURN v
    ArangoDB-->>MCP: Caller entities
    MCP->>ArangoDB: FOR v IN 1..1 OUTBOUND @entityId calls RETURN v
    ArangoDB-->>MCP: Callee entities

    MCP->>Formatter: Truncate response to MAX_RESPONSE_BYTES
    Formatter->>Formatter: Prioritize: signature > callers > callees > body
    Formatter->>Formatter: Trim body at function boundaries (not mid-line)
    Formatter-->>MCP: Truncated, structured response

    MCP-->>Agent: SSE: tool_result { function: {...}, callers: [...], callees: [...] }
```

**The three security layers every MCP request passes through:**

| Layer | Purpose | Failure mode |
|-------|---------|-------------|
| **Edge Secret Scrubber** | Prevent agents from leaking secrets found in source code back to the LLM provider. Catches: AWS keys, GitHub tokens, JWTs, high-entropy strings. | If a secret is missed: LLM provider sees it (data leak). False positive: benign string redacted (minor UX issue). Conservative approach: over-scrub. |
| **Rate Limiter** | Prevent runaway agent loops from exhausting ArangoDB connections and running up costs. 60 tool calls per 60-second sliding window per API key. | At 429: agent receives structured error in tool result body (not HTTP status). Smart agents (Claude, GPT-4) read this and self-correct. Dumb agents may keep retrying — the rate limit caps damage. |
| **Semantic Truncator** | Prevent MCP responses from exceeding LLM context windows. Truncates large function bodies, long caller/callee lists. Respects function boundaries (never cuts mid-statement). | Over-truncation: agent gets partial info but can call `get_function` again with depth parameter. Under-truncation: token budget exceeded in LLM — the LLM's own context window management handles this. |

---

### Flow 4: Auto-PR Onboarding (Bootstrap Rule Distribution)

**Actor:** System (triggered after first successful indexing of a repo)
**Precondition:** Repo status transitions to `ready` for the first time, org has GitHub App installation
**Outcome:** PR opened on GitHub with `.cursor/rules/kap10.mdc` and `.cursor/mcp.json`

```mermaid
sequenceDiagram
    participant Temporal as Temporal (light-llm-queue)
    participant GitHub
    participant Supabase as Supabase (kap10)

    Note over Temporal: indexRepoWorkflow completes → status = ready (first time)

    Temporal->>Supabase: SELECT * FROM kap10.api_keys WHERE repo_id = ?
    Note over Temporal: If no API key exists, auto-generate one for the onboarding PR

    Temporal->>Temporal: Generate .cursor/rules/kap10.mdc content
    Note over Temporal: Bootstrap Rule: pre-flight sync, post-flight sync, tool usage guidelines

    Temporal->>Temporal: Generate .cursor/mcp.json content
    Note over Temporal: { "mcpServers": { "kap10": { "url": "https://mcp.kap10.dev/api/mcp/{key}/sse" } } }

    Temporal->>GitHub: Create branch: kap10/onboarding-{repoId}
    Temporal->>GitHub: Commit .cursor/rules/kap10.mdc + .cursor/mcp.json
    Temporal->>GitHub: Open PR: "Enable kap10 Code Intelligence for your AI agents"
    GitHub-->>Temporal: PR #N created

    Temporal->>Supabase: UPDATE kap10.repos SET onboarding_pr_url = ?, onboarding_pr_number = ?
```

**The Bootstrap Rule (`kap10.mdc`) — what it tells AI agents:**

```
RULE: Before starting any coding task, call sync_local_diff to upload
uncommitted changes to kap10's cloud graph. This ensures search results
reflect your current working state, not just the last commit.

RULE: After completing a significant change, call sync_local_diff again
so kap10 can update the cloud graph with your modifications.

RULE: When asked about code structure, use get_function, get_class,
get_callers, and get_callees to understand relationships before modifying code.

RULE: When searching for code, use search_code with descriptive terms.
If initial results are insufficient, try alternative keywords or use
get_imports to trace module dependencies.
```

**Why Auto-PR instead of dashboard instructions:**

| Approach | Pros | Cons |
|----------|------|------|
| Dashboard instructions (manual) | User controls when to adopt | Friction — user must copy files manually, easy to skip |
| **Auto-PR (Phase 2)** | **One-click merge enables whole team. Reviewed in standard PR workflow.** | PR noise. User must merge. |
| Direct commit to default branch | Zero friction | Dangerous — bypasses review. Branch protection blocks this. |

---

### Flow 5: `sync_local_diff` — Shadow Workspace

**Actor:** AI agent (invokes `sync_local_diff` tool as instructed by Bootstrap Rule)
**Precondition:** Agent has MCP connection, user has uncommitted changes locally
**Outcome:** Cloud graph updated with a workspace overlay reflecting local changes

```mermaid
sequenceDiagram
    actor Agent as AI Agent (Cursor)
    participant MCP as MCP Server
    participant Supabase as Supabase (kap10)
    participant ArangoDB

    Agent->>MCP: POST /message { tool: "sync_local_diff", args: { diff: "unified diff text..." } }

    MCP->>MCP: Parse unified diff → extract modified files, added/removed lines
    MCP->>MCP: Identify affected entities (functions whose line ranges overlap diff hunks)

    MCP->>Supabase: UPSERT INTO kap10.workspaces (user_id, repo_id, branch, base_sha, expires_at)
    Note over Supabase: Workspace TTL: 1 hour from last sync. Auto-expires stale overlays.

    MCP->>ArangoDB: Read current entities for affected files
    MCP->>MCP: Apply diff to entity metadata (line numbers shift, bodies change)
    MCP->>ArangoDB: Upsert workspace-scoped entities (prefixed: ws:{workspaceId}:{entityKey})

    MCP-->>Agent: { synced: true, filesAffected: 3, entitiesUpdated: 12 }

    Note over MCP: Subsequent tool calls check workspace overlay first, then fall back to committed graph
```

**Workspace overlay read path:**

When an MCP tool (e.g., `get_function`) executes, the query path is:

```
1. Check if active workspace exists for (userId, repoId, branch)
2. If workspace exists and not expired:
   a. Query workspace-scoped entities first (ws:{workspaceId}:*)
   b. Merge with committed entities (committed graph)
   c. Workspace entities override committed entities by _key match
3. If no workspace: query committed graph directly (Phase 1 behavior)
```

**Critical constraint — workspace TTL:**

Workspaces expire 1 hour after last `sync_local_diff` call. This prevents stale overlays from polluting search results. The TTL is enforced via:
- Supabase `expires_at` column — checked on every workspace resolution
- ArangoDB: workspace-scoped entities carry `expires_at` field — a periodic cleanup job (Temporal cron, every 15 min) removes expired workspace entities

---

## 1.2 System Logic & State Management

### Deployment Topology — The Two-Process Architecture

Phase 2 introduces a split deployment. The Next.js dashboard and the MCP server are separate processes:

```
┌──────────────────────────────────┐    ┌──────────────────────────────────┐
│         Vercel (Dashboard)        │    │       Fly.io (MCP Server)         │
│                                   │    │                                   │
│  Next.js 16 SSR/SSG              │    │  Express / Hono + SSE            │
│  /dashboard/*                     │    │  /api/mcp/:apiKey/sse            │
│  /api/repos/*                     │    │  /api/mcp/:apiKey/message        │
│  /api/api-keys/*                  │    │                                   │
│  /api/webhooks/*                  │    │  Long-lived connections           │
│  /api/github/*                    │    │  Auto-scaling (min: 1, max: 10)  │
│                                   │    │  256 MB per instance              │
│  Serverless (10s–60s timeout)    │    │  Sticky sessions (per API key)   │
└──────────────┬───────────────────┘    └──────────────┬───────────────────┘
               │                                        │
               │         Shared Infrastructure          │
               │                                        │
          ┌────▼────────────────────────────────────────▼────┐
          │                                                    │
          │  Supabase (PostgreSQL) ── Auth + Repos + API Keys  │
          │  ArangoDB ── Code Intelligence Graph                │
          │  Redis ── Rate Limiting + Caching + Sessions        │
          │  Temporal ── Background Workflows                    │
          │                                                    │
          └────────────────────────────────────────────────────┘
```

**Why split deployment:**

| Concern | Dashboard (Vercel) | MCP Server (Fly.io) |
|---------|-------------------|---------------------|
| Connection lifetime | Request-response (ms) | SSE stream (minutes–hours) |
| Scaling model | Serverless (per-request) | Container (per-connection) |
| Cold start tolerance | Yes (Vercel handles) | No (SSE clients don't retry gracefully) |
| Cost model | Per-invocation | Per-container-hour |
| Region affinity | Edge (global CDN) | Single region (close to ArangoDB/Supabase) |

**Shared infrastructure access:** Both processes connect to the same Supabase, ArangoDB, Redis, and Temporal instances. The DI container (`getContainer()`) works identically in both processes. The MCP server uses the same `lib/ports/*` and `lib/adapters/*` as the dashboard — no code duplication.

### API Key Lifecycle

```
┌──────────┐     POST /api/api-keys      ┌──────────┐
│  (none)  │ ──────────────────────────► │  active   │
└──────────┘                              └──────────┘
                                               │
                                  DELETE /api/api-keys/:id
                                               │
                                               ▼
                                          ┌──────────┐
                                          │ revoked   │
                                          └──────────┘
                                               │
                                     30-day retention
                                               │
                                               ▼
                                          [hard delete]
```

**Key storage schema (Supabase `kap10.api_keys`):**

```
key_hash        VARCHAR    SHA-256 of raw key (lookup index)
key_prefix      VARCHAR    First 8 chars of raw key (display: "kap10_sk_a3f7****")
org_id          VARCHAR    FK → organization
repo_id         VARCHAR    FK → repo (nullable for future org-wide keys)
name            VARCHAR    User-provided label ("Cursor - main branch")
transport       VARCHAR    "mcp-sse" (Phase 2) | "mcp-stdio" (future)
scopes          JSONB      ["read"] (Phase 2) | ["read", "write"] (future)
last_used_at    TIMESTAMP  Updated on every MCP request (async, non-blocking)
revoked_at      TIMESTAMP  NULL = active, non-NULL = revoked
created_at      TIMESTAMP
```

**Lookup path (on every MCP request):** API key is in the URL path. Server extracts it, computes SHA-256, queries `kap10.api_keys WHERE key_hash = ? AND revoked_at IS NULL`. This lookup is cached in Redis (`kap10:apikey:{hash}`, TTL 5 min) to avoid hitting Supabase on every tool call.

### MCP Session State

Each SSE connection creates a lightweight session tracked in Redis:

```
Redis key: kap10:mcp:session:{sessionId}
TTL: matches SSE connection lifetime + 5 min grace period
Value: {
  apiKeyId: "uuid",
  orgId: "uuid",
  repoId: "uuid",
  userId: "uuid",          // resolved from API key owner
  branch: "main",
  workspaceId: "uuid|null", // linked workspace for sync_local_diff
  connectedAt: ISO-8601,
  toolCallCount: number,    // total calls in this session
  lastToolCallAt: ISO-8601
}
```

Session state is ephemeral — if the MCP server restarts, the SSE connection drops, and the client (Cursor/Claude Code) reconnects automatically. The new connection creates a fresh session. Workspace overlays survive reconnection (they're in Supabase + ArangoDB, not Redis).

### MCP Tool Registry

All 9 Phase 2 tools are read-only (no mutations to the committed graph). `sync_local_diff` writes to the workspace overlay only.

| Tool | Input Schema | Output Shape | ArangoDB Queries | Estimated Latency |
|------|-------------|-------------|-----------------|-------------------|
| `search_code` | `{ query: string, limit?: number }` | `{ results: [{ name, kind, file, line, signature, score }] }` | Fulltext search on `functions.name` + `functions.signature` | < 200ms |
| `get_function` | `{ name: string } \| { file: string, line: number }` | `{ function: EntityDoc, callers: EntityDoc[], callees: EntityDoc[] }` | Entity lookup + 1-hop `calls` traversal | < 300ms |
| `get_class` | `{ name: string }` | `{ class: EntityDoc, methods: EntityDoc[], extends: EntityDoc[], implements: EntityDoc[] }` | Entity lookup + `extends`/`implements` traversal | < 300ms |
| `get_file` | `{ path: string }` | `{ file: FileDoc, entities: EntityDoc[] }` | `getEntitiesByFile()` | < 200ms |
| `get_callers` | `{ name: string, depth?: number }` | `{ entity: EntityDoc, callers: EntityDoc[] }` | N-hop INBOUND on `calls` (max depth: 5) | < 500ms (depth 5) |
| `get_callees` | `{ name: string, depth?: number }` | `{ entity: EntityDoc, callees: EntityDoc[] }` | N-hop OUTBOUND on `calls` (max depth: 5) | < 500ms (depth 5) |
| `get_imports` | `{ file: string, depth?: number }` | `{ file: string, imports: [{ path, entities }] }` | N-hop OUTBOUND on `imports` | < 500ms |
| `get_project_stats` | `{}` | `{ files, functions, classes, interfaces, languages: {} }` | Aggregation across collections | < 300ms |
| `sync_local_diff` | `{ diff: string, branch?: string }` | `{ synced: boolean, filesAffected, entitiesUpdated }` | Read + workspace overlay write | < 1s |

---

## 1.3 Reliability & Resilience

### Failure Scenario Matrix

| # | Failure Scenario | Probability | Impact | Detection | Recovery Strategy |
|---|-----------------|-------------|--------|-----------|-------------------|
| 1 | **MCP server container crash** | Low | All active SSE connections drop. Agents lose tool access. | Fly.io health check fails → auto-restart. | Fly.io auto-restarts container (< 5s). Cursor/Claude Code retry SSE connection automatically. Session state rebuilt from Redis. Workspace overlays survive (Supabase + ArangoDB). |
| 2 | **ArangoDB timeout during tool call** | Medium | Single tool call fails. Agent gets error response. | Activity timeout (2s per ArangoDB query). | Return structured error in MCP tool result: `"Database temporarily unavailable. Retry in a few seconds."` Agent can retry. Circuit breaker after 5 consecutive failures → tool returns cached/stale result or graceful error. |
| 3 | **Runaway agent loop** (60+ calls/min) | Medium–High | ArangoDB connection pool exhausted, other agents starved. | Rate limiter triggers at 60 calls/60s window. | 429 returned in tool result body with self-correction message. Agent reads it and pauses. If agent ignores: rate limit caps damage. No cascading failure to other API keys. |
| 4 | **SSE connection drop** (network flap) | Medium | Agent loses tool access temporarily. | Server detects broken pipe on SSE write. | Client reconnects automatically (MCP protocol spec). New session created. Workspace overlay preserved. Pending tool results lost (client should re-request). |
| 5 | **API key leaked** (committed to public repo) | Low–Medium | Unauthorized access to org's code intelligence data. | GitHub secret scanning detects `kap10_sk_` prefix. `/api/api-keys/[id]/rotate` endpoint. | Auto-revoke via GitHub webhook (`secret_scanning_alert`). Notify org admin via email. Key hash invalidated in Redis immediately. Audit log created. |
| 6 | **Secret found in MCP response** (scrubber miss) | Low | Secret sent to LLM provider via agent context. | Post-hoc audit: log all MCP responses (hashed), periodic grep for known patterns. | Immediate scrubber rule update. Incident response: rotate the leaked secret. Improve scrubber regex/entropy thresholds. |
| 7 | **Auto-PR creation fails** (branch protection, no write access) | Medium | Onboarding PR not created. User must manually configure MCP. | Temporal activity failure logged. Repo dashboard shows "Manual setup required". | Fallback: dashboard shows manual copy-paste instructions. Retry Auto-PR on next indexing completion. Log failure reason for debugging. |
| 8 | **Redis down** (rate limiter unavailable) | Low | Rate limiting disabled (fail-open). Secret scrubber still works (stateless). Session state lost. | Health check reports Redis down. | **Fail-open on rate limiting** — allow requests but log warning. This is safe because ArangoDB's own connection pool limits act as a secondary circuit breaker. API key lookup falls back to Supabase (slower). |
| 9 | **Stale workspace overlay** (user forgot to re-sync) | High | Agent searches return outdated results that don't match local files. | No automated detection — relies on Bootstrap Rule compliance. | Workspace TTL (1 hour) limits staleness. Dashboard shows workspace last-sync timestamp. Bootstrap Rule instructs agent to sync before and after each task. |
| 10 | **Concurrent tool calls from same agent** | Medium | Multiple ArangoDB queries in flight. No data corruption risk (read-only). | Connection pool metrics. | ArangoDB connection pool (5 connections) naturally serializes. If pool exhausted: request queues briefly (< 100ms). No data integrity concern for read-only tools. |

### Circuit Breaker Pattern for ArangoDB

The MCP server handles dozens of concurrent tool calls. A single slow ArangoDB query can cascade into connection pool exhaustion. The circuit breaker prevents this:

```
State: CLOSED (normal operation)
  │
  │  5 consecutive failures (timeout or error)
  │
  ▼
State: OPEN (reject all ArangoDB queries for 30s)
  │  Return cached results if available, else structured error
  │
  │  After 30s cooldown
  │
  ▼
State: HALF-OPEN (allow 1 probe query)
  │
  ├── Probe succeeds → CLOSED
  └── Probe fails → OPEN (reset 30s timer)
```

Implementation: use a lightweight in-process state machine (no library needed — 30 lines of code). The circuit breaker is per MCP server instance, not global. Each Fly.io container has its own breaker.

---

## 1.4 Performance Considerations

### Critical Path Latency Targets

| # | Path | Target (p95) | Breakdown | Bottleneck | Mitigation |
|---|------|-------------|-----------|------------|------------|
| 1 | **SSE connection handshake** | < 500ms | API key validation (~50ms cached, ~200ms cold) + session creation (~10ms Redis) + tool capability announcement (~5ms) | First connection after API key cache expires. | Cache API key lookup in Redis (TTL 5 min). Warm connection pool on container start. |
| 2 | **`search_code` tool call** | < 200ms | Scrub (~1ms) + rate check (~5ms Redis) + ArangoDB fulltext (~100ms) + truncation (~5ms) + SSE write (~5ms) | ArangoDB fulltext index performance on large repos (100k+ entities). | Fulltext index on `functions.name` + `functions.signature`. Limit results to top 20. |
| 3 | **`get_function` tool call** | < 300ms | Entity lookup (~50ms) + callers query (~80ms) + callees query (~80ms) + truncation (~10ms) | Three sequential ArangoDB queries. | Run callers + callees queries in parallel. Entity lookup is a direct `_key` access (O(1)). |
| 4 | **`get_callers`/`get_callees` (depth 5)** | < 500ms | N-hop graph traversal (~400ms for large graphs) | Explosion of results at depth 5 (callers of callers of callers...). | Hard cap: 500 results per traversal (already in `ArangoGraphStore`). Depth max: 5. Semantic truncation drops least-relevant results. |
| 5 | **`sync_local_diff`** | < 1s | Diff parsing (~50ms) + entity lookup (~100ms) + workspace upsert (~200ms Supabase) + ArangoDB overlay write (~300ms) | Large diffs (1000+ line changes across 20+ files). | Limit diff size to 50KB. Reject larger diffs with message: "Diff too large. Commit your changes first, then re-sync." |
| 6 | **`get_project_stats`** | < 300ms | Aggregation across 5 entity collections (COUNT per collection per repo). | Full collection scans without index. | Precalculated: entity counts stored in `kap10.repos` table (updated during indexing). ArangoDB query only for language breakdown. |
| 7 | **Auto-PR creation** | < 10s | Branch creation (~2s) + file commits (~2s) + PR creation (~2s) + Supabase update (~100ms) | GitHub API latency (3 sequential API calls). | Run as Temporal activity on `light-llm-queue` — not in the critical user path. Dashboard shows "Onboarding PR being created..." until complete. |

### Connection Pool Sizing (Phase 2 additions)

| System | Phase 1 Size | Phase 2 Size | Rationale |
|--------|-------------|-------------|-----------|
| ArangoDB (MCP server) | N/A (didn't exist) | **10 connections per container** | Each MCP tool call runs 1–3 ArangoDB queries. With 60 calls/min rate limit and ~300ms avg query time, 10 connections handle ~200 concurrent queries. |
| Redis (MCP server) | N/A | **5 connections per container** | Rate limit checks + session reads + API key cache. All sub-millisecond operations. |
| Supabase (MCP server) | N/A | **3 connections per container** | Only for API key validation cache miss and workspace upserts. Most reads hit Redis cache. |

### Memory Budget (MCP Server Container)

| Component | Memory | Rationale |
|-----------|--------|-----------|
| Node.js baseline | 50 MB | Express/Hono + MCP SDK |
| SSE connection state (per connection) | ~2 KB | Session ID, org/repo context, rate limit counters |
| ArangoDB connection pool | 10 MB | 10 connections × ~1 MB TCP buffer each |
| Redis connection | 2 MB | Single multiplexed connection |
| Secret scrubber regex cache | 5 MB | Compiled regex patterns, entropy lookup tables |
| Headroom | 189 MB | GC overhead, spike handling |
| **Total per container** | **256 MB** | Supports ~500 concurrent SSE connections per container |

---

## 1.5 Phase Bridge → Phase 3 & Phase 4

Phase 3 (Semantic Search) and Phase 4 (Business Justification) build directly on Phase 2's MCP infrastructure.

### What Phase 2 Builds That Phase 3 Inherits

| Phase 2 Artifact | Phase 3 Usage |
|------------------|--------------|
| MCP server + transport layer | Phase 3 adds 2 new tools: `semantic_search`, `find_similar`. Same server, same transport, same security layers. |
| Tool registry (`lib/mcp/tools/index.ts`) | Phase 3 registers new tools in the same registry. No server-side changes needed. |
| Secret scrubber | Applied to all tools including new semantic search results. |
| Rate limiter | Same 60 calls/min limit covers new tools. |
| Semantic truncation (`formatter.ts`) | Embedding search results go through the same truncation pipeline. |
| API key system | Same keys grant access to new tools (backward-compatible scope expansion). |
| Dashboard "Connect IDE" page | Phase 3 adds search demo/playground widget on the same page. |
| Workspace overlay system | Semantic search respects workspace overlays — search results include uncommitted changes. |

### What Phase 2 Builds That Phase 4 Inherits

| Phase 2 Artifact | Phase 4 Usage |
|------------------|--------------|
| MCP tool infrastructure | Phase 4 adds `explain_function`, `justify_change`, `impact_analysis` tools. |
| `get_function` / `get_callers` / `get_callees` data | Phase 4's LLM prompts assemble context from these same graph traversals. |
| Workspace overlay | Phase 4 justification runs on the user's current working state, not just committed code. |
| Auto-PR system | Phase 4 extends Auto-PR to include justification reports in PR descriptions. |

### Seam Points Left for Phase 3

```
Seam 1: Embedding pipeline trigger
  Phase 2: indexRepoWorkflow ends at status "ready" (ArangoDB populated, no embeddings)
  Phase 3: After "ready", trigger embedRepoWorkflow → ILLMProvider.embed() → IVectorSearch.upsert()
           Repo status: ready → embedding → embedded

Seam 2: search_code tool — keyword only
  Phase 2: ArangoDB fulltext search on entity names + signatures
  Phase 3: Hybrid search = keyword (ArangoDB) + semantic (PGVectorStore) + reciprocal rank fusion

Seam 3: MCP tool set expansion
  Phase 2: 9 read-only tools
  Phase 3: +2 tools (semantic_search, find_similar)
  Phase 4: +3 tools (explain_function, justify_change, impact_analysis)

Seam 4: ILLMProvider activation
  Phase 2: ILLMProvider still a stub (not needed for keyword search + graph traversal)
  Phase 3: ILLMProvider.embed() activated (HuggingFaceEmbedding, nomic-embed-text-v1.5)
  Phase 4: ILLMProvider.generateObject() + streamText() activated (Vercel AI SDK)

Seam 5: IVectorSearch activation
  Phase 2: IVectorSearch still a stub
  Phase 3: IVectorSearch fully activated (LlamaIndex PGVectorStore → kap10.entity_embeddings)
```

### What Phase 2 Must NOT Do

1. **Do NOT implement embedding generation.** Phase 2's tools use keyword search and graph traversal only. Embeddings are Phase 3.
2. **Do NOT implement `ILLMProvider`.** No LLM calls in Phase 2. All tools return structured data from ArangoDB, not LLM-generated text.
3. **Do NOT add a chat interface** in the dashboard. The MCP server provides tools to external agents, not a built-in chat.
4. **Do NOT allow write operations** to the committed graph via MCP tools. `sync_local_diff` writes to the workspace overlay only. The committed graph is modified only by Temporal indexing workflows.
5. **Do NOT build billing/metering** for MCP usage. Usage tracking (`last_used_at`, `toolCallCount`) is logged, but billing integration is Phase 5+.

---

# Part 2: Implementation & Tracing Tracker

> **Status Key:** `[ ]` = Not started | `[~]` = In progress | `[x]` = Complete | `[!]` = Blocked
>
> **Each item includes:** Testing criteria, estimated complexity (S/M/L), dependencies, and a notes field for tracing.

---

## 2.1 Infrastructure Layer

### MCP Server Deployment

- [ ] **P2-INFRA-01: Create MCP server entry point and project structure** — M
  - Create `mcp-server/` directory at project root (separate from Next.js app)
  - Entry point: `mcp-server/index.ts` — Express/Hono HTTP server
  - Imports from shared `lib/` (ports, adapters, DI container) — same codebase, different process
  - `tsconfig.mcp.json` extending root `tsconfig.json` with MCP-specific paths
  - `package.json` script: `pnpm mcp:dev` (local dev) and `pnpm mcp:build` (production)
  - **Test:** `pnpm mcp:dev` starts HTTP server on port 3001. `curl localhost:3001/health` returns 200.
  - **Depends on:** Nothing
  - **Files:** `mcp-server/index.ts`, `mcp-server/tsconfig.json`, `package.json` (scripts)
  - **Acceptance:** MCP server starts independently of Next.js. Shares `lib/` code via TypeScript path aliases.
  - Notes: _____

- [ ] **P2-INFRA-02: Create `Dockerfile.mcp-server`** — M
  - Base image: Node.js 20 Alpine (lightweight — no SCIP/Go/Python needed)
  - Install: `pnpm` via Corepack
  - Multi-stage build: install deps → build TypeScript → slim runtime image
  - Entrypoint: `node dist/mcp-server/index.js`
  - Health check: `curl -f http://localhost:3001/health`
  - **Test:** `docker build -f Dockerfile.mcp-server .` succeeds. Container starts and serves requests.
  - **Depends on:** P2-INFRA-01
  - **Files:** `Dockerfile.mcp-server`
  - **Acceptance:** Image size < 200 MB. Health check passes. Container runs in < 2s.
  - Notes: _____

- [ ] **P2-INFRA-03: Fly.io deployment configuration** — M
  - `fly.toml` in project root:
    - App name: `kap10-mcp`
    - Region: same as Supabase/ArangoDB (minimize latency)
    - Internal port: 3001
    - Min machines: 1, max machines: 10
    - Auto-scale based on connection count
    - Health check: HTTP GET `/health`, interval 10s, timeout 2s
  - Environment variables: same set as Next.js (`SUPABASE_DB_URL`, `ARANGODB_URL`, `REDIS_URL`, etc.) + `MCP_SERVER_PORT=3001`
  - Secrets: `GITHUB_APP_PRIVATE_KEY`, `BETTER_AUTH_SECRET` via `fly secrets set`
  - **Test:** `fly deploy` succeeds. `curl https://kap10-mcp.fly.dev/health` returns 200.
  - **Depends on:** P2-INFRA-02
  - **Files:** `fly.toml`, `.github/workflows/deploy-mcp.yml` (CI/CD)
  - **Acceptance:** MCP server accessible at public URL. Auto-scales under load. Restarts on crash.
  - Notes: _____

- [ ] **P2-INFRA-04: Add MCP server to Docker Compose for local dev** — S
  - Service `mcp-server` built from `Dockerfile.mcp-server`
  - Port: 3001 (mapped)
  - Same env vars as other services
  - Depends on: `arangodb`, `redis`, `temporal` (for shared infrastructure)
  - **Test:** `docker compose up mcp-server` starts alongside other services.
  - **Depends on:** P2-INFRA-02
  - **Files:** `docker-compose.yml`
  - **Acceptance:** Local dev workflow: `docker compose up` starts dashboard + MCP server + all infra.
  - Notes: _____

- [ ] **P2-INFRA-05: Add MCP-specific env vars to `env.mjs`** — S
  - New variables: `MCP_SERVER_URL` (public URL for Auto-PR configuration), `MCP_SERVER_PORT` (default 3001)
  - Optional: `MCP_MAX_CONNECTIONS_PER_KEY` (default 5), `MCP_RATE_LIMIT_PER_MINUTE` (default 60)
  - **Test:** `pnpm build` succeeds. Missing MCP vars don't crash dashboard (lazy init).
  - **Depends on:** Nothing
  - **Files:** `env.mjs`, `.env.example`
  - **Acceptance:** Env vars documented in `.env.example` with explanatory comments.
  - Notes: _____

---

## 2.2 Database & Schema Layer

### Prisma Schema Updates

- [ ] **P2-DB-01: Add `ApiKey` model to Prisma schema** — M
  - Fields: `id` (UUID PK), `keyHash` (String — SHA-256 of raw key, indexed), `keyPrefix` (String — first 8 chars for display), `orgId` (String FK), `repoId` (String? FK), `name` (String — user label), `transport` (String, default "mcp-sse"), `scopes` (Json — `["read"]`), `lastUsedAt` (DateTime?), `revokedAt` (DateTime?), `createdAt`, `updatedAt`
  - Unique index: `keyHash`
  - Relations: `Repo` (optional), `Organization` (via `orgId`)
  - Schema: `@@schema("kap10")`, `@@map("api_keys")`
  - **Test:** `pnpm prisma migrate dev` runs cleanly. Insert + lookup by hash works.
  - **Depends on:** Nothing
  - **Files:** `prisma/schema.prisma`
  - **Acceptance:** Table created with correct indexes. Revoked keys are soft-deleted (retained for audit).
  - Notes: _____

- [ ] **P2-DB-02: Add `Workspace` model to Prisma schema** — M
  - Fields: `id` (UUID PK), `userId` (String), `repoId` (String FK), `branch` (String), `baseSha` (String?), `lastSyncAt` (DateTime?), `expiresAt` (DateTime), `createdAt`
  - Unique: `(userId, repoId, branch)`
  - Schema: `@@schema("kap10")`, `@@map("workspaces")`
  - **Test:** Migration runs. UPSERT by unique constraint works.
  - **Depends on:** Nothing
  - **Files:** `prisma/schema.prisma`
  - **Acceptance:** Workspace creation and TTL-based expiry verified.
  - Notes: _____

- [ ] **P2-DB-03: Extend `Repo` model with onboarding fields** — S
  - Add: `onboardingPrUrl` (String?), `onboardingPrNumber` (Int?), `onboardingPrStatus` (String? — "open"/"merged"/"closed")
  - **Test:** Migration runs. Existing repos get NULL defaults.
  - **Depends on:** Nothing
  - **Files:** `prisma/schema.prisma`
  - **Acceptance:** Auto-PR metadata stored and queryable per repo.
  - Notes: _____

- [ ] **P2-DB-04: Create ArangoDB fulltext index on entity names** — S
  - Fulltext index on `functions` collection: `name` and `signature` fields
  - Fulltext index on `classes` collection: `name` field
  - Fulltext index on `interfaces` collection: `name` field
  - Purpose: `search_code` MCP tool performance
  - **Test:** `db._query("FOR doc IN FULLTEXT(functions, 'name', 'validate') RETURN doc")` returns results.
  - **Depends on:** Nothing (collections exist from Phase 0)
  - **Files:** `lib/adapters/arango-graph-store.ts` (extend `bootstrapGraphSchema`)
  - **Acceptance:** Fulltext search returns results in < 100ms for repos with 50k+ entities.
  - Notes: _____

---

## 2.3 Ports & Adapters Layer

### IGraphStore — Phase 2 Additions

- [ ] **P2-ADAPT-01: Implement `ArangoGraphStore.impactAnalysis()`** — M
  - Replace stub that returns empty `{ entityId: "", affected: [] }`
  - AQL: `FOR v, e, p IN 1..@maxDepth OUTBOUND @entityId calls, imports, extends, implements OPTIONS { uniqueVertices: "global" } FILTER v.org_id == @orgId RETURN DISTINCT v`
  - Max depth configurable (default 3, max 5)
  - Deduplicates entities across edge types
  - **Test:** Insert graph with A→B→C call chain. `impactAnalysis(A, depth=2)` returns B and C.
  - **Depends on:** Nothing (graph data exists from Phase 1)
  - **Files:** `lib/adapters/arango-graph-store.ts`
  - **Acceptance:** Returns transitive closure of affected entities. Depth limit enforced.
  - Notes: _____

- [ ] **P2-ADAPT-02: Implement `ArangoGraphStore.searchEntities()`** — M
  - New method on `IGraphStore`: `searchEntities(orgId: string, repoId: string, query: string, limit?: number): Promise<EntityDoc[]>`
  - Uses ArangoDB fulltext index: `FOR doc IN FULLTEXT(functions, "name", @query) FILTER doc.org_id == @orgId AND doc.repo_id == @repoId LIMIT @limit RETURN doc`
  - Also searches `classes` and `interfaces` collections, merges results by relevance
  - **Test:** Index a repo with function "validateCredentials". Search "validate" → returns it.
  - **Depends on:** P2-DB-04
  - **Files:** `lib/ports/graph-store.ts`, `lib/adapters/arango-graph-store.ts`
  - **Acceptance:** Keyword search across entity names and signatures. Results ranked by relevance.
  - Notes: _____

- [ ] **P2-ADAPT-03: Implement `ArangoGraphStore.getImports()`** — S
  - New method: `getImports(orgId: string, repoId: string, filePath: string, depth?: number): Promise<{ path: string, entities: EntityDoc[] }[]>`
  - AQL: N-hop OUTBOUND traversal on `imports` edge from file entity
  - **Test:** File A imports file B, which imports file C. `getImports(A, depth=2)` returns B and C.
  - **Depends on:** Nothing
  - **Files:** `lib/ports/graph-store.ts`, `lib/adapters/arango-graph-store.ts`
  - **Acceptance:** Returns import chain with entities per file. Depth limit enforced.
  - Notes: _____

- [ ] **P2-ADAPT-04: Implement `ArangoGraphStore.getProjectStats()`** — S
  - New method: `getProjectStats(orgId: string, repoId: string): Promise<ProjectStats>`
  - AQL: COUNT queries across `files`, `functions`, `classes`, `interfaces`, `variables` collections filtered by `org_id` + `repo_id`
  - Also: language distribution aggregation from `files` collection
  - **Test:** Stats match known entity counts after indexing a test repo.
  - **Depends on:** Nothing
  - **Files:** `lib/ports/graph-store.ts`, `lib/adapters/arango-graph-store.ts`
  - **Acceptance:** Returns `{ files, functions, classes, interfaces, variables, languages: { typescript: 120, python: 45 } }`.
  - Notes: _____

- [ ] **P2-ADAPT-05: Implement workspace-scoped entity overlay in `ArangoGraphStore`** — L
  - New methods: `upsertWorkspaceEntity(orgId, workspaceId, entity)`, `getEntityWithOverlay(orgId, entityId, workspaceId?)`, `cleanupExpiredWorkspaces()`
  - Workspace entities stored with key prefix `ws:{workspaceId}:{entityKey}` in the same collections
  - Query path: if `workspaceId` provided, check overlay first, fall back to committed entity
  - Cleanup: remove all `ws:{workspaceId}:*` documents when workspace expires
  - **Test:** Upsert workspace entity. Query with workspaceId → returns overlay. Query without → returns committed version.
  - **Depends on:** P2-DB-02
  - **Files:** `lib/adapters/arango-graph-store.ts`
  - **Acceptance:** Overlay entities isolated per workspace. Cleanup removes all workspace data. No committed data affected.
  - Notes: _____

### IRelationalStore — Phase 2 Extensions

- [ ] **P2-ADAPT-06: Extend `PrismaRelationalStore` with API key and workspace methods** — M
  - New methods: `createApiKey(data)`, `getApiKeyByHash(hash)`, `revokeApiKey(id)`, `listApiKeys(orgId)`, `updateApiKeyLastUsed(id)`, `createWorkspace(data)`, `getWorkspace(userId, repoId, branch)`, `updateWorkspaceSync(id)`, `deleteExpiredWorkspaces()`, `updateRepoOnboardingPr(repoId, prUrl, prNumber)`
  - **Test:** Full CRUD for API keys and workspaces. Revoked keys not returned by `getApiKeyByHash`.
  - **Depends on:** P2-DB-01, P2-DB-02, P2-DB-03
  - **Files:** `lib/ports/relational-store.ts`, `lib/adapters/prisma-relational-store.ts`
  - **Acceptance:** All methods type-safe via Prisma. No raw SQL.
  - Notes: _____

---

## 2.4 Backend / API Layer

### MCP Server Core

- [ ] **P2-API-01: Implement MCP server using `@modelcontextprotocol/sdk`** — L
  - Use `@modelcontextprotocol/sdk` Server class with HTTP+SSE transport
  - Per-connection server instance with resolved org/repo context
  - Register all 9 tools via `server.setRequestHandler(ListToolsRequestSchema, ...)` and `server.setRequestHandler(CallToolRequestSchema, ...)`
  - Tool handlers receive DI container (same `getContainer()` pattern as Next.js API routes)
  - **Test:** Connect MCP Inspector to local server → tools listed → invoke `get_project_stats` → returns data.
  - **Depends on:** P2-INFRA-01
  - **Files:** `lib/mcp/server.ts`, `lib/mcp/transport.ts`
  - **Acceptance:** MCP protocol compliant. Tools discoverable by any MCP client.
  - Notes: _____

- [ ] **P2-API-02: Implement MCP API key authentication middleware** — M
  - Extract API key from URL path (`/api/mcp/{apiKey}/sse` and `/api/mcp/{apiKey}/message`)
  - Compute SHA-256 hash, lookup in Redis cache (TTL 5 min), fallback to Supabase
  - Resolve `orgId`, `repoId`, `scopes` from API key record
  - Reject revoked keys (401), expired keys (401), missing keys (401)
  - Attach resolved context to request for downstream handlers
  - **Test:** Valid key → 200 + context resolved. Revoked key → 401. Unknown key → 401. Cached lookup < 5ms.
  - **Depends on:** P2-ADAPT-06
  - **Files:** `lib/mcp/auth.ts`
  - **Acceptance:** Auth middleware runs on every MCP request. Cache hit ratio > 90% under normal use.
  - Notes: _____

- [ ] **P2-API-03: Implement edge secret scrubber** — M
  - Processes all incoming MCP payloads before tool dispatch
  - Regex patterns for: AWS access keys (`AKIA[0-9A-Z]{16}`), GitHub tokens (`gh[ps]_[A-Za-z0-9_]{36,}`), JWTs (`eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+`), generic API keys (`[A-Za-z0-9]{32,}` with entropy > 4.5 bits/char), `password`/`secret`/`token` in key-value contexts
  - Entropy analysis: Shannon entropy per token, flag strings > 4.5 bits/char and > 20 chars
  - Replace matches with `[REDACTED:{type}]` (e.g., `[REDACTED:aws_key]`)
  - Scrubber also runs on MCP responses (outbound) to catch secrets in code bodies
  - **Test:** Input containing `AKIAIOSFODNN7EXAMPLE` → replaced with `[REDACTED:aws_key]`. Normal code unaffected.
  - **Depends on:** Nothing
  - **Files:** `lib/mcp/security/scrubber.ts`
  - **Acceptance:** All known secret patterns caught. False positive rate < 1% on normal code. < 1ms per scrub operation.
  - Notes: _____

- [ ] **P2-API-04: Implement sliding window rate limiter** — M
  - Uses `@upstash/ratelimit` with standard `ioredis` (no Upstash hosting required)
  - Sliding window: 60 tool calls per 60-second window per API key
  - Rate limit check happens before tool dispatch (after auth, after scrubber)
  - On 429: return structured error in MCP tool result body (not HTTP 429) so agents can parse and self-correct
  - Error message: `"Rate limit exceeded. You are calling tools too rapidly — this usually means the agent is in a loop. Pause, review your context, and ask the user for clarification before continuing."`
  - Response includes `X-RateLimit-Remaining` header and `retryAfterMs` in body
  - **Test:** Send 61 requests in 60 seconds → 61st returns rate limit error. Wait 60s → allowed again.
  - **Depends on:** Nothing
  - **Files:** `lib/mcp/security/rate-limiter.ts`
  - **Acceptance:** Sliding window accurately tracks calls. Error message parseable by agents.
  - Notes: _____

- [ ] **P2-API-05: Implement semantic truncation formatter** — M
  - Processes all outgoing MCP tool results before SSE write
  - Max response size: configurable, default 32 KB (fits within LLM context windows)
  - Truncation priority (highest preserved first): entity name + signature → file path + line number → callers/callees (capped at 20 each) → body/source code (truncated at function boundaries, never mid-statement)
  - If truncated: append `"[truncated — call get_function with specific name for full details]"` hint
  - **Test:** Response with 100 KB body → truncated to < 32 KB. Truncation point is at a function boundary.
  - **Depends on:** Nothing
  - **Files:** `lib/mcp/formatter.ts`
  - **Acceptance:** All tool results within size budget. Truncation is semantically meaningful (not arbitrary byte cut).
  - Notes: _____

### MCP Tool Implementations

- [ ] **P2-API-06: Implement `search_code` tool** — M
  - Input: `{ query: string, limit?: number (default 20, max 50) }`
  - Uses `IGraphStore.searchEntities()` for keyword search
  - Returns: `{ results: [{ name, kind, file_path, line, signature, score }] }`
  - Score based on ArangoDB fulltext relevance ranking
  - **Test:** Search "validate" in a repo with `validateCredentials` function → found. Search nonexistent term → empty results.
  - **Depends on:** P2-ADAPT-02
  - **Files:** `lib/mcp/tools/search.ts`
  - **Acceptance:** Results sorted by relevance. Respects repo scope from API key.
  - Notes: _____

- [ ] **P2-API-07: Implement `get_function` tool** — M
  - Input: `{ name: string } | { file: string, line: number }`
  - Uses `IGraphStore.getEntity()` + `getCallersOf()` + `getCalleesOf()` (depth 1)
  - Returns: `{ function: { name, signature, file_path, line, body }, callers: [...], callees: [...] }`
  - If workspace overlay exists: merge overlay entities with committed entities
  - **Test:** Get known function → returns signature, callers, callees. Unknown function → clear error message.
  - **Depends on:** P2-ADAPT-05 (workspace overlay)
  - **Files:** `lib/mcp/tools/inspect.ts`
  - **Acceptance:** Function details match indexed data. Workspace overlay applied when active.
  - Notes: _____

- [ ] **P2-API-08: Implement `get_class` tool** — M
  - Input: `{ name: string }`
  - Uses `IGraphStore.getEntity()` + traversal on `extends` and `implements` edges
  - Returns: `{ class: { name, file_path, line }, methods: [...], extends: [...], implements: [...] }`
  - Inheritance chain: up to 5 levels deep (prevents infinite loops in circular inheritance)
  - **Test:** Class with parent and interface → both chains returned. Depth 5 cap enforced.
  - **Depends on:** Nothing (uses existing graph traversal)
  - **Files:** `lib/mcp/tools/inspect.ts`
  - **Acceptance:** Inheritance chain complete. Methods listed with signatures.
  - Notes: _____

- [ ] **P2-API-09: Implement `get_file` tool** — S
  - Input: `{ path: string }`
  - Uses `IGraphStore.getEntitiesByFile()`
  - Returns: `{ file: { path, language, line_count }, entities: [{ name, kind, line, signature }] }`
  - **Test:** Get known file → entities listed sorted by line. Unknown file → clear error.
  - **Depends on:** Nothing (uses Phase 1 implementation)
  - **Files:** `lib/mcp/tools/inspect.ts`
  - **Acceptance:** All entities in file returned, grouped by kind.
  - Notes: _____

- [ ] **P2-API-10: Implement `get_callers` and `get_callees` tools** — M
  - Input: `{ name: string, depth?: number (default 1, max 5) }`
  - Uses `IGraphStore.getCallersOf()` / `getCalleesOf()` with configurable depth
  - Returns: `{ entity: { name, kind }, callers|callees: [{ name, file_path, kind, distance }] }`
  - `distance` field indicates hop count from origin entity
  - **Test:** Depth 1 → direct callers only. Depth 3 → transitive callers up to 3 hops.
  - **Depends on:** Nothing
  - **Files:** `lib/mcp/tools/graph.ts`
  - **Acceptance:** Depth parameter respected. Results deduplicated. LIMIT 500 enforced.
  - Notes: _____

- [ ] **P2-API-11: Implement `get_imports` tool** — S
  - Input: `{ file: string, depth?: number (default 1, max 5) }`
  - Uses `IGraphStore.getImports()`
  - Returns: `{ file: string, imports: [{ path, entities: [...], distance }] }`
  - **Test:** File A imports B imports C. Depth 2 → returns both B and C with entities.
  - **Depends on:** P2-ADAPT-03
  - **Files:** `lib/mcp/tools/graph.ts`
  - **Acceptance:** Import chain resolved. Circular imports handled (visited set prevents loops).
  - Notes: _____

- [ ] **P2-API-12: Implement `get_project_stats` tool** — S
  - Input: `{}` (no args — uses repo context from API key)
  - Uses `IGraphStore.getProjectStats()` for entity counts, `IRelationalStore` for repo metadata
  - Returns: `{ name, files, functions, classes, interfaces, variables, languages: { ... }, lastIndexedAt, indexedSha }`
  - **Test:** Stats match post-indexing counts in Supabase `repos` table.
  - **Depends on:** P2-ADAPT-04
  - **Files:** `lib/mcp/tools/stats.ts`
  - **Acceptance:** Aggregated stats correct. Language distribution matches.
  - Notes: _____

- [ ] **P2-API-13: Implement `sync_local_diff` tool** — L
  - Input: `{ diff: string, branch?: string (default "main") }`
  - Validates diff size (max 50 KB), parses unified diff format
  - Creates or updates workspace in Supabase (UPSERT by user+repo+branch)
  - Identifies affected files and entities from diff hunks (line range overlap)
  - Reads current entities from ArangoDB → applies diff transformations (line shifts, body updates)
  - Writes workspace overlay entities to ArangoDB (prefixed keys)
  - **Test:** Sync a diff that adds a new function → subsequent `search_code` finds it in overlay. Sync a diff that modifies a function signature → `get_function` returns updated signature.
  - **Depends on:** P2-ADAPT-05, P2-ADAPT-06
  - **Files:** `lib/mcp/tools/sync.ts`, `lib/mcp/workspace.ts`
  - **Acceptance:** Overlay reflects diff. TTL set. Subsequent tool calls use overlay. Expired overlays cleaned up.
  - Notes: _____

### Dashboard API Routes

- [ ] **P2-API-14: `POST /api/api-keys` — Create API key** — M
  - Body: `{ repoId: string, name: string }`
  - Generates cryptographically random key with `kap10_sk_` prefix
  - Stores SHA-256 hash + key prefix in Supabase
  - Returns raw key ONCE in response (never stored or retrievable again)
  - Validates: user is org admin, repo belongs to org, repo status is "ready"
  - Enforces limit: max 10 API keys per repo
  - **Test:** Create key → response contains raw key. Create 11th key → 400 "limit reached".
  - **Depends on:** P2-DB-01
  - **Files:** `app/api/api-keys/route.ts` (extend existing)
  - **Acceptance:** Key generated with correct prefix. Hash stored. Raw key returned once.
  - Notes: _____

- [ ] **P2-API-15: `GET /api/api-keys` — List API keys** — S
  - Returns keys for org (filtered by session org). Shows: `id`, `keyPrefix`, `name`, `repoId`, `lastUsedAt`, `createdAt`, `revokedAt`
  - Never returns raw key or full hash
  - **Test:** List keys → returns metadata only. Revoked keys included with `revokedAt` timestamp.
  - **Depends on:** P2-ADAPT-06
  - **Files:** `app/api/api-keys/route.ts`
  - **Acceptance:** Pagination for orgs with many keys. Sorted by createdAt desc.
  - Notes: _____

- [ ] **P2-API-16: `DELETE /api/api-keys/[id]` — Revoke API key** — S
  - Sets `revokedAt` to now (soft delete)
  - Invalidates Redis cache for this key hash immediately
  - Any active MCP session using this key will fail on next tool call (auth re-check)
  - **Test:** Revoke key → immediate invalidation. Next MCP tool call with this key → 401.
  - **Depends on:** P2-ADAPT-06
  - **Files:** `app/api/api-keys/[id]/route.ts`
  - **Acceptance:** Revocation is instant (Redis cache purged). Audit trail preserved.
  - Notes: _____

### Auto-PR & Onboarding

- [ ] **P2-API-17: Implement Auto-PR onboarding workflow** — L
  - Temporal activity on `light-llm-queue`, triggered after first successful indexing (status → `ready` AND `onboardingPrUrl IS NULL`)
  - Generates `.cursor/rules/kap10.mdc` (Bootstrap Rule content)
  - Generates `.cursor/mcp.json` (MCP server URL with auto-generated API key)
  - Creates branch `kap10/onboarding-{repoId}` via GitHub API (installation token)
  - Commits both files to branch
  - Opens PR with title "Enable kap10 Code Intelligence for your AI agents" and descriptive body
  - Stores PR URL and number in Supabase `repos` table
  - **Test:** Index a repo → PR created on GitHub with correct files. PR body contains setup instructions.
  - **Depends on:** P2-ADAPT-06, Phase 1 GitHub App (installation token)
  - **Files:** `lib/onboarding/auto-pr.ts`, `lib/onboarding/bootstrap-rule.ts`, `lib/temporal/activities/onboarding.ts`
  - **Acceptance:** PR created once per repo (idempotent check on `onboardingPrUrl`). Files match expected content.
  - Notes: _____

- [ ] **P2-API-18: Implement workspace cleanup cron workflow** — S
  - Temporal cron workflow on `light-llm-queue`, runs every 15 minutes
  - Queries `kap10.workspaces WHERE expires_at < NOW()`
  - For each expired workspace: delete overlay entities from ArangoDB, delete workspace row from Supabase
  - **Test:** Create workspace with 5-minute TTL. Wait 15 min → workspace cleaned up. Overlay entities removed.
  - **Depends on:** P2-ADAPT-05, P2-ADAPT-06
  - **Files:** `lib/temporal/workflows/cleanup-workspaces.ts`, `lib/temporal/activities/workspace-cleanup.ts`
  - **Acceptance:** Stale workspaces removed. No committed data affected.
  - Notes: _____

---

## 2.5 Frontend / UI Layer

### IDE Connection Page

- [ ] **P2-UI-01: "Connect to IDE" page at `/repos/[repoId]/connect`** — M
  - Shows for repos with status "ready"
  - Sections: (1) Generate API Key form, (2) Cursor setup instructions (copy-paste `.cursor/mcp.json`), (3) Claude Code setup instructions (copy-paste `claude_desktop_config.json`), (4) Active API keys list
  - API key shown once in a dismissable alert after generation (masked after dismiss)
  - Copy-to-clipboard button for MCP URL
  - **Test:** Navigate to connect page → generate key → instructions displayed with key embedded in URL.
  - **Depends on:** P2-API-14, P2-API-15
  - **Files:** `app/(dashboard)/repos/[repoId]/connect/page.tsx`, `components/repo/connect-ide.tsx`
  - **Acceptance:** Instructions match Cursor/Claude Code MCP configuration format. Key masked after first view.
  - Notes: _____

- [ ] **P2-UI-02: API key management in repo settings** — M
  - List of API keys for the repo: name, prefix (`kap10_sk_a3f7****`), last used, created date
  - "Revoke" button per key with confirmation dialog
  - "Generate New Key" button
  - **Test:** Revoke a key → removed from list. Generate new key → appears in list.
  - **Depends on:** P2-API-14, P2-API-15, P2-API-16
  - **Files:** `components/repo/api-key-manager.tsx`
  - **Acceptance:** Design system compliant (glass-card, size="sm" buttons). Revocation is immediate.
  - Notes: _____

- [ ] **P2-UI-03: Auto-PR status badge on repo card** — S
  - Shows on repo card when `onboardingPrUrl` is set
  - Badge states: "Onboarding PR Open" (link to GitHub PR), "Onboarding PR Merged" (checkmark), "Manual Setup Required" (if Auto-PR failed)
  - **Test:** Repo with open PR → badge links to GitHub. Repo with merged PR → shows checkmark.
  - **Depends on:** P2-API-17
  - **Files:** `components/dashboard/repo-card.tsx` (extend)
  - **Acceptance:** Badge reflects current PR state. Links open in new tab.
  - Notes: _____

- [ ] **P2-UI-04: MCP connection status indicator** — S
  - Shows on repo detail page: "N active sessions" (fetched from Redis session count)
  - Refreshes every 30 seconds
  - Shows "No active sessions" when idle
  - **Test:** Connect an MCP client → counter increments. Disconnect → counter decrements.
  - **Depends on:** P2-API-01 (session tracking in Redis)
  - **Files:** `components/repo/mcp-status.tsx`, `app/api/repos/[repoId]/mcp-sessions/route.ts`
  - **Acceptance:** Count matches actual SSE connections. Auto-refreshes.
  - Notes: _____

---

## 2.6 Testing & Verification

### In-Memory Fakes (extend Phase 1 fakes)

- [ ] **P2-TEST-01: Extend `InMemoryGraphStore` with Phase 2 methods** — M
  - Add: `searchEntities()` — filters in-memory store by name substring match
  - Add: `impactAnalysis()` — traverses in-memory edge Map to specified depth
  - Add: `getImports()` — traverses `imports` edges in memory
  - Add: `getProjectStats()` — counts in-memory store entries
  - Add: `upsertWorkspaceEntity()` / `getEntityWithOverlay()` / `cleanupExpiredWorkspaces()` — workspace overlay using prefixed keys in Map
  - **Test:** All methods return correct data from in-memory store.
  - **Depends on:** P2-ADAPT-01..05
  - **Files:** `lib/di/fakes.ts`
  - **Acceptance:** Fake mirrors real adapter behavior for all Phase 2 IGraphStore methods.
  - Notes: _____

- [ ] **P2-TEST-02: Extend `InMemoryRelationalStore` with Phase 2 methods** — S
  - Add: `createApiKey()`, `getApiKeyByHash()`, `revokeApiKey()`, `listApiKeys()`, `updateApiKeyLastUsed()`, `createWorkspace()`, `getWorkspace()`, `updateWorkspaceSync()`, `deleteExpiredWorkspaces()`, `updateRepoOnboardingPr()`
  - **Test:** Full CRUD for API keys and workspaces in memory.
  - **Depends on:** P2-ADAPT-06
  - **Files:** `lib/di/fakes.ts`
  - **Acceptance:** All new IRelationalStore methods have working fakes.
  - Notes: _____

### Unit Tests

- [ ] **P2-TEST-03: Secret scrubber tests** — M
  - AWS access key (`AKIAIOSFODNN7EXAMPLE`) → `[REDACTED:aws_key]`
  - GitHub token (`ghp_xxxx...`) → `[REDACTED:github_token]`
  - JWT (`eyJhbGci...`) → `[REDACTED:jwt]`
  - Generic high-entropy string (> 4.5 bits/char, > 20 chars) → `[REDACTED:high_entropy]`
  - Normal code (variable names, function bodies) → unchanged
  - `password = "hunter2"` in key-value context → `password = "[REDACTED:password]"`
  - **Test:** `pnpm test lib/mcp/security/scrubber.test.ts`
  - **Depends on:** P2-API-03
  - **Files:** `lib/mcp/security/scrubber.test.ts`
  - **Acceptance:** All known patterns caught. False positive rate < 1%.
  - Notes: _____

- [ ] **P2-TEST-04: Rate limiter tests** — S
  - 60 calls in 60s → all allowed
  - 61st call → blocked with structured error
  - After window slides → allowed again
  - Different API keys have independent windows
  - **Test:** `pnpm test lib/mcp/security/rate-limiter.test.ts`
  - **Depends on:** P2-API-04
  - **Files:** `lib/mcp/security/rate-limiter.test.ts`
  - **Acceptance:** Sliding window behavior verified. Error message contains self-correction hint.
  - Notes: _____

- [ ] **P2-TEST-05: Semantic truncation tests** — M
  - Response > 32 KB → truncated to < 32 KB
  - Truncation at function boundary (not mid-statement)
  - Priority: signature preserved, body truncated first
  - Truncation hint appended: `"[truncated — call get_function for full details]"`
  - Small response (< 32 KB) → unchanged
  - **Test:** `pnpm test lib/mcp/formatter.test.ts`
  - **Depends on:** P2-API-05
  - **Files:** `lib/mcp/formatter.test.ts`
  - **Acceptance:** All priority rules enforced. Function boundaries respected.
  - Notes: _____

- [ ] **P2-TEST-06: MCP tool handler unit tests** — L
  - For each of the 9 tools: input validation, correct IGraphStore method called, output shape matches schema, error handling for missing entities
  - Uses `createTestContainer()` with pre-populated `InMemoryGraphStore`
  - **Test:** `pnpm test lib/mcp/tools/`
  - **Depends on:** P2-API-06..13
  - **Files:** `lib/mcp/tools/search.test.ts`, `lib/mcp/tools/inspect.test.ts`, `lib/mcp/tools/graph.test.ts`, `lib/mcp/tools/stats.test.ts`, `lib/mcp/tools/sync.test.ts`
  - **Acceptance:** All tools return correct data. Error cases return structured error messages (not stack traces).
  - Notes: _____

- [ ] **P2-TEST-07: API key generation and auth tests** — M
  - Key format: `kap10_sk_{32 random chars}`
  - Hash stored, raw key not stored
  - Lookup by hash → correct record
  - Revoked key → rejected
  - Redis cache → hit on second lookup
  - **Test:** `pnpm test lib/mcp/auth.test.ts`
  - **Depends on:** P2-API-02
  - **Files:** `lib/mcp/auth.test.ts`
  - **Acceptance:** Auth flow correct. Timing-safe comparison used for hash lookup.
  - Notes: _____

- [ ] **P2-TEST-08: Bootstrap Rule and Auto-PR content tests** — S
  - Generated `.cursor/rules/kap10.mdc` contains pre-flight and post-flight sync instructions
  - Generated `.cursor/mcp.json` contains correct MCP server URL with key placeholder
  - Content is valid YAML/JSON respectively
  - **Test:** `pnpm test lib/onboarding/`
  - **Depends on:** P2-API-17
  - **Files:** `lib/onboarding/bootstrap-rule.test.ts`, `lib/onboarding/auto-pr.test.ts`
  - **Acceptance:** Generated content parseable. MCP URL matches `MCP_SERVER_URL` env var.
  - Notes: _____

### Integration Tests

- [ ] **P2-TEST-09: MCP server end-to-end integration test** — L
  - Start MCP server locally with test container (in-memory fakes)
  - Connect via MCP Inspector or raw HTTP+SSE client
  - Invoke all 9 tools → verify correct responses
  - Verify rate limiting triggers at 61st call
  - Verify secret scrubbing on payload with embedded AWS key
  - **Test:** `pnpm test mcp-server/integration.test.ts`
  - **Depends on:** P2-API-01..13
  - **Files:** `mcp-server/integration.test.ts`
  - **Acceptance:** Full MCP protocol compliance. All security layers active.
  - Notes: _____

- [ ] **P2-TEST-10: ArangoDB fulltext search integration test** — M
  - Requires Docker (ArangoDB running)
  - Index a test repo → run fulltext search → results match expected entities
  - Fulltext index on functions.name, functions.signature, classes.name
  - **Test:** `pnpm test lib/adapters/arango-graph-store.integration.test.ts` (extend Phase 1 test)
  - **Depends on:** P2-DB-04
  - **Files:** `lib/adapters/arango-graph-store.integration.test.ts`
  - **Acceptance:** Fulltext search returns relevant results in < 100ms.
  - Notes: _____

### E2E Tests (Playwright)

- [ ] **P2-TEST-11: E2E — API key generation and IDE connection flow** — M
  - Navigate to `/repos/[repoId]/connect`
  - Generate API key → verify shown once
  - Copy MCP URL → verify format
  - List API keys → verify new key appears
  - Revoke key → verify removed from list
  - **Test:** `pnpm e2e:headless`
  - **Depends on:** P2-UI-01, P2-UI-02
  - **Files:** `e2e/mcp-connect.spec.ts`
  - **Acceptance:** Full flow from generation to revocation works.
  - Notes: _____

- [ ] **P2-TEST-12: E2E — Auto-PR badge on repo card** — S
  - Index a repo → Auto-PR triggered → badge appears on repo card
  - Badge links to GitHub PR
  - **Test:** `pnpm e2e:headless` (may require mocked GitHub API)
  - **Depends on:** P2-UI-03
  - **Files:** `e2e/auto-pr-badge.spec.ts`
  - **Acceptance:** Badge state reflects PR status (open/merged).
  - Notes: _____

---

## Dependency Graph

```
P2-INFRA-01 (MCP server entry point)
    ├── P2-INFRA-02 (Dockerfile) ── P2-INFRA-03 (Fly.io config)
    │                              └── P2-INFRA-04 (Docker Compose)
    └── P2-API-01 (MCP server core)

P2-INFRA-05 (env vars) ── independent

P2-DB-01 (ApiKey model) ─────────┐
P2-DB-02 (Workspace model) ──────┤
P2-DB-03 (Repo onboarding) ──────┤
P2-DB-04 (ArangoDB fulltext) ────┘
    │
P2-ADAPT-01 (impactAnalysis) ────┐
P2-ADAPT-02 (searchEntities) ────┤
P2-ADAPT-03 (getImports) ────────┤
P2-ADAPT-04 (getProjectStats) ───┤
P2-ADAPT-05 (workspace overlay) ─┤
P2-ADAPT-06 (relational CRUD) ───┘
    │
    ├── P2-API-01..05 (MCP server core: auth, scrubber, rate limiter, formatter)
    ├── P2-API-06..13 (9 MCP tools)
    ├── P2-API-14..16 (API key CRUD routes)
    └── P2-API-17..18 (Auto-PR + workspace cleanup)
        │
        ├── P2-UI-01..04 (Connect IDE page, key manager, badges)
        └── P2-TEST-01..12 (all tests)
```

**Recommended implementation order:**

1. **Infrastructure** (P2-INFRA-01..05) — MCP server scaffold, Docker, Fly.io, env vars
2. **Database** (P2-DB-01..04) — Prisma migrations, ArangoDB fulltext indexes
3. **Adapters** (P2-ADAPT-01..06) — Graph store additions, relational CRUD, workspace overlay
4. **MCP core** (P2-API-01..05) — Server, auth, scrubber, rate limiter, formatter
5. **MCP tools** (P2-API-06..13) — All 9 tools (can be parallelized across developers)
6. **Dashboard APIs** (P2-API-14..18) — API key routes, Auto-PR, workspace cleanup
7. **Frontend** (P2-UI-01..04) — Connect IDE page, key management, badges
8. **Testing** (P2-TEST-01..12) — Unit, integration, E2E

---

## New Files Summary

```
mcp-server/
  index.ts                                 ← MCP server entry point (Express/Hono)
  tsconfig.json                            ← TypeScript config for MCP server
lib/
  mcp/
    server.ts                              ← MCP server factory (@modelcontextprotocol/sdk)
    transport.ts                           ← HTTP+SSE transport adapter
    auth.ts                                ← API key validation + context resolution
    formatter.ts                           ← Semantic truncation + pagination
    workspace.ts                           ← Workspace resolution (per-user, per-repo, per-branch)
    security/
      scrubber.ts                          ← Edge secret scrubbing (regex + entropy)
      rate-limiter.ts                      ← Sliding window rate limiter (Redis)
    tools/
      index.ts                             ← Tool registry
      search.ts                            ← search_code tool
      inspect.ts                           ← get_function, get_class, get_file tools
      graph.ts                             ← get_callers, get_callees, get_imports tools
      stats.ts                             ← get_project_stats tool
      sync.ts                              ← sync_local_diff tool
  onboarding/
    auto-pr.ts                             ← Create onboarding PR via GitHub API
    bootstrap-rule.ts                      ← Generate .cursor/rules/kap10.mdc content
  temporal/
    workflows/
      cleanup-workspaces.ts                ← Cron workflow: expire stale workspace overlays
    activities/
      onboarding.ts                        ← Auto-PR creation activity
      workspace-cleanup.ts                 ← Workspace expiry activity
app/
  api/
    api-keys/
      [id]/route.ts                        ← DELETE — revoke API key
    repos/
      [repoId]/
        mcp-sessions/route.ts              ← GET — active MCP session count
  (dashboard)/
    repos/
      [repoId]/
        connect/page.tsx                   ← "Connect to IDE" instructions + key management
components/
  repo/
    connect-ide.tsx                         ← IDE setup instructions component
    api-key-manager.tsx                     ← API key list + generate + revoke
    mcp-status.tsx                          ← Active MCP session count indicator
Dockerfile.mcp-server                      ← Production Docker image for MCP server
fly.toml                                   ← Fly.io deployment configuration
```

### Modified Files

```
lib/ports/graph-store.ts                   ← Add searchEntities, getImports, getProjectStats, workspace overlay methods
lib/adapters/arango-graph-store.ts         ← Implement impactAnalysis, searchEntities, getImports, getProjectStats, workspace overlay
lib/ports/relational-store.ts              ← Add API key and workspace methods
lib/adapters/prisma-relational-store.ts    ← Implement API key and workspace CRUD
lib/di/fakes.ts                            ← Extend fakes with Phase 2 methods
prisma/schema.prisma                       ← ApiKey + Workspace models, Repo onboarding fields
docker-compose.yml                         ← Add mcp-server service
env.mjs                                    ← Add MCP_SERVER_URL, MCP_SERVER_PORT, etc.
.env.example                               ← Document Phase 2 variables
package.json                               ← Add mcp:dev, mcp:build scripts
app/api/api-keys/route.ts                  ← Extend with POST (create) + GET (list)
components/dashboard/repo-card.tsx         ← Add Auto-PR badge
```

---

## Revision Log

| Date | Author | Change |
|------|--------|--------|
| 2026-02-18 | — | Initial document created. Part 1: 5 user flows with Mermaid diagrams (API key provisioning, MCP connection, tool invocation with 3 security layers, Auto-PR onboarding, sync_local_diff shadow workspace), system logic (two-process architecture, API key lifecycle, MCP session state, 9-tool registry), 10 failure scenarios with circuit breaker pattern, 7 performance budgets with connection pool sizing, Phase 3/4 bridge with 5 seam points. Part 2: 46 tracker items across 6 layers (Infrastructure: 5, Database: 4, Adapters: 6, API: 18, UI: 4, Testing: 12). |
