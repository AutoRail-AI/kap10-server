# Phase 0 — Foundation Wiring: Deep Dive & Implementation Tracker

> **Phase Feature Statement:** _"I can sign up, create an org, and see an empty dashboard with a 'Connect Repository' button."_
>
> **Source:** [`VERTICAL_SLICING_PLAN.md`](./VERTICAL_SLICING_PLAN.md) — Phase 0

---

## Table of Contents

- [Part 1: Architectural Deep Dive](#part-1-architectural-deep-dive)
  - [1.1 Core User Flows](#11-core-user-flows)
  - [1.2 System Logic & State Management](#12-system-logic--state-management)
  - [1.3 Reliability & Resilience](#13-reliability--resilience)
  - [1.4 Performance Considerations](#14-performance-considerations)
  - [1.5 Phase Bridge → Phase 1](#15-phase-bridge--phase-1)
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

Phase 0 has three actor journeys. Each is described step-by-step with the system-level actions that occur at each step.

### Flow 1: New User Registration → Email Verification → First Login

**Actor:** Anonymous visitor
**Precondition:** No account exists

```
Step  Actor Action                System Action                                           State Change
────  ─────────────────────────   ──────────────────────────────────────────────────────   ─────────────────────────────
1     Visit /register             proxy.ts: /register is in publicPaths → pass-through    None
2     Fill name, email, password  Client-side form validation (Zod schema)                None
3     Submit form                 POST /api/auth/sign-up/email →                          Supabase: user row created
                                  Better Auth creates user + session                       (emailVerified = false)
                                  Resend sends verification email (or log URL in dev)      Session cookie set (but
                                                                                           limited until verified)
4     Click email link            GET /api/auth/verify-email?token=... →                  Supabase: user.emailVerified
                                  Better Auth verifies token, marks user verified           = true
                                  autoSignInAfterVerification: true → session active
5     Redirect to /               proxy.ts: session cookie present → pass-through          None
                                  Dashboard page loads → server component checks
                                  for orgs → none found → redirect to onboarding
```

**Critical decision — What happens between step 3 and step 4?**

The user has a session cookie but `emailVerified = false`. Phase 0 must decide on one of two strategies:

| Strategy | Behavior | Trade-off |
|----------|----------|-----------|
| **A: Block at proxy** | `proxy.ts` checks `emailVerified` via a lightweight session lookup. Unverified users are redirected to `/verify-email` on every protected route. | Extra DB call per request (mitigated by `cookieCache: 5min`). Clean enforcement. |
| **B: Soft block in UI** | Let the user through to the dashboard but show a banner: "Verify your email to continue." Disable interactive elements. | No extra proxy logic. But if we forget to guard an API route, an unverified user can act. |

**Recommendation: Strategy A.** It is the safer default — enforcement at the perimeter, not scattered across UI components. The `cookieCache` (already configured at 5 minutes in `auth.ts`) prevents the session lookup from becoming a per-request DB query. Implementation detail: `proxy.ts` calls `auth.api.getSession()` which returns `session.user.emailVerified`. If false and path is not `/verify-email` or `/api/auth/*`, redirect to `/verify-email`.

### Flow 2: Verified User → Org Creation (Onboarding Wizard)

**Actor:** Authenticated user with no organizations
**Precondition:** Email verified, zero org memberships

```
Step  Actor Action                System Action                                           State Change
────  ─────────────────────────   ──────────────────────────────────────────────────────   ─────────────────────────────
1     Land on /                   Server component: fetch user's orgs via Better Auth      None
                                  organization plugin → empty array →
                                  render onboarding wizard (not redirect, to avoid
                                  flash-of-content)
2     Enter org name              Client-side validation: non-empty, 2-50 chars,           None
                                  alphanumeric + spaces + hyphens
3     (Optional) Upload logo      Uploadthing handles file → returns URL                   Uploadthing: file stored
4     Submit                      POST /api/auth/organization/create →                     Supabase: organization row
                                  Better Auth org plugin creates org                        + membership (role: owner)
                                  Server creates matching org context in ArangoDB:           ArangoDB: org_id namespace
                                  ensure collections exist, verify tenant indexes            created (idempotent)
5     Redirect to dashboard       Server component: fetch orgs → found →                   None
                                  render dashboard shell with empty repos state
```

**Key nuance — step 4, the ArangoDB org bootstrap:**

When a new org is created in Supabase, the system must also prepare ArangoDB for that org's data. This is NOT creating a new database (pool-based multi-tenancy — single `kap10_db`). Instead, it's a **verification step**: ensure all expected collections and indexes exist. This is idempotent — calling it twice is safe.

Pseudo-code for the org bootstrap:
```
FUNCTION bootstrapOrgInGraphStore(orgId):
    FOR EACH collection IN [repos, files, functions, classes, interfaces,
                             variables, patterns, rules, snippets, ledger]:
        ENSURE collection EXISTS in kap10_db
        ENSURE persistent index on [org_id, repo_id] EXISTS
    FOR EACH edgeCollection IN [contains, calls, imports, extends, implements]:
        ENSURE edgeCollection EXISTS in kap10_db
        ENSURE persistent index on [org_id, repo_id] EXISTS
    RETURN { status: "ready", orgId }
```

This runs synchronously during org creation. Latency is ~50ms (index creation is a no-op if they already exist). No Temporal workflow needed — it's fast and idempotent.

### Flow 3: Returning User → Dashboard (Empty State)

**Actor:** Authenticated user with at least one org
**Precondition:** Logged in, has org, zero connected repos

```
Step  Actor Action                System Action                                           State Change
────  ─────────────────────────   ──────────────────────────────────────────────────────   ─────────────────────────────
1     Visit /                     proxy.ts: session valid → pass-through                   None
2     Dashboard renders           Server component:                                        None
                                  1. Fetch active org from session/cookie
                                  2. Fetch repos for org → empty array
                                  3. Render empty state with "Connect Repository" CTA
3     Navigate to Settings        /settings → org settings page loads                      None
                                  Shows org name, members, danger zone (delete org)
4     Navigate to Repos           /repos → same empty state as dashboard home              None
5     Click "Connect Repository"  Phase 0: disabled button with tooltip                   None
                                  "Coming in the next update" OR
                                  modal stub that shows "GitHub integration coming soon"
```

**The "Connect Repository" button is the Phase 1 entry point.** In Phase 0, it must exist in the UI but be non-functional. Options:

| Approach | UX | Recommended |
|----------|-----|-------------|
| Disabled button + tooltip | Clean, honest. `<Button disabled>` with a Tooltip explaining it's coming. | Yes |
| Opens a stub modal | More engaging, but sets expectation it should work. | No — confusing |
| Links to a waitlist | Appropriate for a public beta, overkill for Phase 0. | No |

---

## 1.2 System Logic & State Management

### State Distribution Across Stores

Phase 0 introduces a **four-store architecture**. Understanding what lives where — and why — is critical for every subsequent phase.

```
                    ┌──────────────────────────────────────────────────┐
                    │                  Request Path                      │
                    │                                                    │
                    │  Browser ──► proxy.ts ──► API Route / Page        │
                    │                              │                     │
                    │         ┌─────────────────────┼──────────────┐     │
                    │         │                     │              │     │
                    │    ┌────▼────┐          ┌─────▼─────┐  ┌────▼──┐ │
                    │    │ Supabase │          │  ArangoDB  │  │ Redis │ │
                    │    │ (Prisma) │          │ (Graph)    │  │(Cache)│ │
                    │    └─────────┘          └───────────┘  └───────┘ │
                    │                                                    │
                    │    Auth state              Graph state    Ephemeral│
                    │    User profiles           (empty in P0)  state   │
                    │    Org memberships                        Sessions │
                    │    Subscriptions                          Rate lim │
                    │    Deletion logs                                   │
                    └──────────────────────────────────────────────────┘
```

### Phase 0 Schema Changes

**Supabase (via Prisma):**

Phase 0 introduces Prisma as the ORM layer *on top of* the existing Supabase database. The Prisma schema must **coexist** with Better Auth's table management. Better Auth creates its own tables (`user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`). Prisma should NOT try to manage those tables — it references them via `@@map` and `@@ignore` as needed.

New Prisma-managed tables for Phase 0:

```
Table: repos
  ├── id              UUID (PK, default uuid)
  ├── organization_id VARCHAR (FK → organization.id)
  ├── name            VARCHAR
  ├── full_name       VARCHAR (e.g., "org/repo-name")
  ├── provider        ENUM ("github")      -- future: gitlab, bitbucket
  ├── provider_id     VARCHAR              -- GitHub repo ID
  ├── status          ENUM ("pending", "indexing", "ready", "error", "deleting")
  ├── default_branch  VARCHAR (default "main")
  ├── last_indexed_at TIMESTAMPTZ (nullable)
  ├── created_at      TIMESTAMPTZ (default now)
  └── updated_at      TIMESTAMPTZ (auto-update)
  INDEX: (organization_id)
  UNIQUE: (organization_id, provider, provider_id)

Table: deletion_logs
  ├── id                UUID (PK, default uuid)
  ├── organization_id   VARCHAR
  ├── repo_id           VARCHAR (nullable — null for org-level deletion)
  ├── requested_at      TIMESTAMPTZ (default now)
  ├── completed_at      TIMESTAMPTZ (nullable)
  ├── entities_deleted  INT (default 0)
  ├── embeddings_deleted INT (default 0)
  ├── status            ENUM ("pending", "in_progress", "completed", "failed")
  └── error_message     TEXT (nullable)
  INDEX: (organization_id)
  INDEX: (status) WHERE status != 'completed'  -- partial index for audit queries
```

**ArangoDB:**

Phase 0 creates the empty schema — all document and edge collections with tenant isolation indexes. No data is written yet (that's Phase 1). The schema is defined above in Flow 2, step 4.

**Critical: The Prisma + Better Auth coexistence strategy:**

Better Auth manages its tables via its own migration system. Prisma manages app-specific tables. They share the same Supabase PostgreSQL database. The strategy:

1. Better Auth tables: DO NOT include in Prisma schema for migration purposes. If Prisma needs to read from them (e.g., join repos to organizations), define them with `@@ignore` or use raw SQL through Prisma's `$queryRaw`.
2. App tables (repos, deletion_logs, etc.): Fully managed by Prisma migrations.
3. Migration order: Better Auth migrations run first (on app startup via `betterAuth()` initialization), then Prisma migrations (`pnpm migrate`).

### DI Container Initialization Flow

The DI container is the single source of truth for all adapters. It must be initialized once per process lifecycle (not per request).

```
Process Start (Next.js server / Temporal worker)
    │
    ├── instrumentation.ts runs
    │     └── Initializes OpenTelemetry + Langfuse span processor
    │
    ├── Container initialization (lazy, on first use)
    │     └── createProductionContainer()
    │           ├── ArangoGraphStore: connect to ArangoDB, verify kap10_db exists
    │           ├── PrismaRelationalStore: Prisma client (auto-connects on first query)
    │           ├── VercelAIProvider: no initialization needed (stateless)
    │           ├── TemporalWorkflowEngine: Temporal client connection
    │           ├── GitHubHost: Octokit with app credentials
    │           ├── LlamaIndexVectorSearch: pgvector connection via Prisma
    │           ├── StripePayments: Stripe client (lazy proxy)
    │           ├── LangfuseObservability: Langfuse client
    │           ├── RedisCacheStore: ioredis connection
    │           ├── SCIPCodeIntelligence: no initialization (CLI binary)
    │           └── SemgrepPatternEngine: no initialization (CLI binary)
    │
    └── Container is available via getContainer() singleton
```

**How use cases access the container:**

Use cases are NOT classes with injected constructors. They are plain functions that receive the container (or the specific ports they need) as arguments. This keeps them testable without class instantiation ceremony.

```
// Pseudo-code — use case function signature pattern
FUNCTION indexRepo(graphStore: IGraphStore, gitHost: IGitHost, repoUrl: string):
    // ...business logic using only port interfaces
```

In API routes, the container is accessed via a lazy singleton:

```
// Pseudo-code — API route
HANDLER GET /api/repos:
    container = getContainer()
    repos = await container.relationalStore.getRepos(orgId)
    RETURN repos
```

---

## 1.3 Reliability & Resilience

Phase 0 establishes foundational connections to four external systems: Supabase, ArangoDB, Temporal, and Redis. Each can fail independently. The resilience strategy per system:

### Connection Failure Matrix

| System | Failure Mode | Impact if Down | Phase 0 Recovery Strategy | Acceptable Downtime |
|--------|-------------|----------------|---------------------------|---------------------|
| **Supabase** | Connection refused, timeout, pool exhaustion | Auth broken, no user/org data, app unusable | Lazy proxy pattern (already in `supabase.ts`). Fail-open on health check. Retry with exponential backoff (pg Pool default: 3 retries). **No fallback** — Supabase is the critical path. | 0 (hard dependency) |
| **ArangoDB** | Connection refused, auth failure, OOM | Graph operations fail, but in Phase 0 no graph operations occur in user flows | Lazy initialization. Health check returns `degraded` (not `unhealthy`) if ArangoDB is down in Phase 0 because no user-facing feature depends on it yet. | Phase 0: tolerable. Phase 1+: 0 |
| **Temporal** | Server unreachable, namespace not found | Workflow execution fails, but in Phase 0 no workflows are triggered | Same as ArangoDB. Health check returns `degraded`. Workers log warning and retry connection every 30s. | Phase 0: tolerable. Phase 1+: 0 |
| **Redis** | Connection refused, timeout | Session cache fails (falls back to DB), rate limiting disabled | ioredis `lazyConnect: true` + `enableOfflineQueue: false`. If Redis is down, the app continues but sessions hit Supabase on every request (performance degradation, not failure). | Degraded (perf hit only) |

### Health Check Endpoint Design

The existing `/api/health` must be expanded to check all four systems. The response should report each system independently:

```
GET /api/health

Response shape:
{
  status: "healthy" | "degraded" | "unhealthy",
  timestamp: ISO-8601,
  checks: {
    supabase:  { status: "up" | "down", latencyMs: number },
    arangodb:  { status: "up" | "down", latencyMs: number },
    temporal:  { status: "up" | "down", latencyMs: number },
    redis:     { status: "up" | "down", latencyMs: number },
    langfuse:  { status: "up" | "down" | "unconfigured", latencyMs: number },
  }
}

Logic:
  IF supabase.down → status = "unhealthy" (HTTP 503)
  ELSE IF any other system down → status = "degraded" (HTTP 200)
  ELSE → status = "healthy" (HTTP 200)
  Note: langfuse.status = "unconfigured" (env vars missing) is treated as "up" for
  overall status — it's optional infrastructure, not a failure.
```

**Why Supabase is the only "unhealthy" trigger:** In Phase 0, the user cannot sign up, log in, or do anything without Supabase. ArangoDB and Temporal have no user-facing functionality yet. Redis degradation is a performance issue, not a functional one.

**Health check latency budget:** Each check must timeout at 2 seconds. The total health check must respond within 5 seconds (container orchestrators like ECS/Kubernetes use this for liveness probes). Use `Promise.allSettled()` to run checks in parallel.

### Graceful Degradation Rules

| Scenario | User-Visible Behavior | System Behavior |
|----------|----------------------|-----------------|
| ArangoDB down during org creation | Org created in Supabase successfully. ArangoDB bootstrap fails silently. | Log error. Queue a retry. Phase 1 will re-bootstrap on first repo connect. |
| Redis down | App works normally but slower. Session checks hit Supabase directly. | Log warning. Disable rate limiting (fail-open). |
| Temporal down | No user impact in Phase 0. | Log warning. Workers will reconnect automatically when Temporal comes back. |
| Supabase down | 503 on all protected routes. Login/register fail. | Health check returns "unhealthy". Alert fires. No fallback possible. |

### Adapter Error Handling Contract

Every adapter method must follow this error contract (enforced by convention, verified in code review):

```
RULE: Adapter methods MUST:
  1. Catch SDK-specific errors and wrap them in domain-level errors
  2. Never throw raw SDK errors (arangojs errors, Prisma errors, etc.) to use cases
  3. Include the original error as `cause` for debugging
  4. Log the error with structured context (orgId, operation, adapter name)

RULE: Adapter constructors MUST:
  1. NOT throw if the external system is unreachable
  2. Defer connection until first use (lazy init)
  3. Surface connection failures on first operation, not on import
```

---

## 1.4 Performance Considerations

### Critical Path Latency Budgets

Phase 0's critical paths are auth and page loads. Target latencies:

| Path | Target (p95) | Breakdown | Bottleneck |
|------|-------------|-----------|------------|
| `POST /api/auth/sign-up/email` | < 800ms | Supabase insert (~50ms) + password hash (~200ms) + email send (~400ms) | Resend API latency. If email send is slow, decouple: return 200 immediately, queue email via BullMQ (already configured). |
| `POST /api/auth/sign-in/email` | < 400ms | Supabase lookup (~30ms) + password verify (~200ms) + session create (~50ms) | Password verification (bcrypt/argon2 by design). Cannot be faster without weakening security. |
| `GET /` (dashboard, authenticated) | < 300ms | proxy.ts session check (~5ms cached, ~50ms uncached) + server component render (~50ms) + org/repos query (~30ms) | First load after cache expires. The 5-minute `cookieCache` in Better Auth config is the mitigation. |
| `POST /api/auth/organization/create` | < 500ms | Supabase org insert (~50ms) + ArangoDB bootstrap (~100ms) + membership create (~50ms) | ArangoDB collection/index verification. This is idempotent and fast after first run. |
| `GET /api/health` | < 2000ms | 4 parallel checks (max 2s each) | ArangoDB cold connection. First health check after deploy may be slow. |

### Connection Pool Sizing

| System | Pool Size | Rationale |
|--------|----------|-----------|
| Supabase (pg Pool) | 10 connections | Next.js in dev runs a single process. In production (serverless), each Lambda gets its own pool — keep small to avoid exhausting Supabase's connection limit (default: 60 for free tier, 200 for pro). |
| ArangoDB | 5 connections | Phase 0 has no graph queries. Phase 1+ will need more. Start conservative. |
| Redis (ioredis) | 1 connection (multiplexed) | ioredis uses a single TCP connection with command pipelining. No pool needed. |
| Temporal | 1 client connection | Temporal client is lightweight — one connection per process is sufficient. |

### Cold Start Mitigation

In serverless deployments (Vercel), every Lambda invocation may cold-start. The DI container must not add significant cold-start latency.

```
Mitigation strategy:
  1. Container uses lazy proxies — no eager connections
  2. First request pays connection cost (~200ms for Supabase, ~100ms for ArangoDB)
  3. Subsequent requests reuse connections (Lambda is warm for ~5 minutes)
  4. Health check is NOT a good warm-up target (it eagerly connects all systems)

For Temporal workers (long-running processes, not serverless):
  - Workers connect eagerly on startup
  - Retry connection with exponential backoff (Temporal SDK handles this)
  - No cold-start concern
```

### Memory Considerations for Docker Compose

> **Observed (2026-02-17):** Temporal server uses ~227 MB, Temporal UI uses ~30 MB, PostgreSQL (local persistence) is also running.

| Service | Memory Limit | Actual (observed) | Rationale |
|---------|-------------|-------------------|-----------|
| `app` | 512 MB | — (runs outside Docker in dev) | Next.js dev server with Turbopack |
| `temporal` | 512 MB | ~227 MB | Temporal server (`auto-setup:1.24.2`, backed by local PostgreSQL) |
| `temporal-ui` | 128 MB | ~30 MB | Static web UI (`ui:2.31.2`) |
| `postgresql` | 512 MB | — | Local PostgreSQL 13 for Temporal persistence |
| `temporal-worker-heavy` | 256 MB (Phase 0 — no heavy work yet) | — (not yet running) | Will need 8 GB in Phase 1+ for SCIP |
| `temporal-worker-light` | 128 MB (Phase 0 — no LLM calls yet) | — (not yet running) | Will need 512 MB in Phase 4+ |
| `arangodb` | 1 GB | — (not yet running) | ArangoDB's RocksDB engine needs memory for write buffers |
| `redis` | 128 MB | — | Minimal data in Phase 0 |
| **Total** | ~3.2 GB | — | Fits on an 8 GB dev machine with headroom |

---

## 1.5 Phase Bridge → Phase 1

Phase 1's feature is: _"I connect my GitHub account, select a repo, and kap10 indexes it."_

Everything Phase 0 builds must support Phase 1 without refactoring. Here's the explicit contract:

### What Phase 1 Inherits

| Phase 0 Artifact | Phase 1 Usage |
|------------------|--------------|
| `IGraphStore` port + `ArangoGraphStore` adapter | Phase 1 calls `bulkUpsertEntities()` and `bulkUpsertEdges()` to write SCIP output |
| `IWorkflowEngine` port + `TemporalWorkflowEngine` adapter | Phase 1 starts `indexRepoWorkflow` via `workflowEngine.startWorkflow()` |
| `IGitHost` port + `GitHubHost` adapter | Phase 1 calls `cloneRepo()` and `listFiles()` |
| `heavy-compute-queue` Temporal worker | Phase 1 runs `prepareWorkspace` and `runSCIP` activities on this queue |
| `light-llm-queue` Temporal worker | Phase 1 runs `writeToArango` activity on this queue |
| `repos` Prisma table | Phase 1 writes repo records with `status: "indexing"` → `"ready"` |
| Dashboard shell with empty state | Phase 1 replaces empty state with repo cards showing indexing progress |
| `createTestContainer()` | Phase 1 tests use `InMemoryGraphStore` and `FakeGitHost` for unit tests |
| Docker Compose with ArangoDB + Temporal | Phase 1 developers run the full stack locally |

### What Phase 0 Must NOT Do

To avoid Phase 1 refactoring, Phase 0 must respect these constraints:

1. **Do NOT hard-code any adapter.** Every external call goes through the container. If Phase 0 writes a health check that directly imports `arangojs`, Phase 1 can't test the health check without a running ArangoDB.
2. **Do NOT create ArangoDB collections dynamically per-org.** The multi-tenancy model is pool-based (single `kap10_db`, `org_id` on every document). Creating the collections is a one-time operation (in `bootstrapOrgInGraphStore`), not a per-org operation.
3. **Do NOT put org creation logic in the API route handler.** Extract it into a use case (`createOrgUseCase`) that takes the container as a dependency. Phase 1 will extend this use case to also trigger GitHub App installation.
4. **Do NOT skip Prisma migration tooling.** Even though Supabase has its own migrations, Phase 0 establishes Prisma as the migration tool for app tables. Phase 1 will add columns to the `repos` table — this must work via `prisma migrate`.
5. **Do NOT couple the dashboard layout to "zero repos" state.** The layout must work identically with 0, 1, or 100 repos. The empty state is a conditional render, not a separate page.

### Seam Points for Phase 1

These are the exact integration points where Phase 1 plugs in:

```
Seam 1: Dashboard "Connect Repository" button
  Phase 0: Disabled button with tooltip
  Phase 1: Opens GitHub OAuth flow → repo selection modal

Seam 2: Repos list (dashboard home + /repos)
  Phase 0: Empty state component with CTA
  Phase 1: Fetches repos from Prisma, renders cards with status badges

Seam 3: Org settings
  Phase 0: Shows org name, members (from Better Auth plugin)
  Phase 1: Adds "Connected Repos" section with disconnect buttons

Seam 4: Temporal workers
  Phase 0: Workers start, connect, register queues, idle (no workflows to process)
  Phase 1: Workers receive indexRepoWorkflow tasks

Seam 5: ArangoDB
  Phase 0: Collections created, indexes verified, zero documents
  Phase 1: writeToArango activity populates collections with SCIP-extracted entities + edges
```

---

# Part 2: Implementation & Tracing Tracker

> **Status Key:** `[ ]` = Not started | `[~]` = In progress | `[x]` = Complete | `[!]` = Blocked
>
> **Each item includes:** Testing criteria, estimated complexity (S/M/L), and a notes field for tracing blockers.

---

## 2.1 Infrastructure Layer

### Docker Compose Expansion

> **Status Note (2026-02-17):** Temporal server, Temporal UI, Redis, and a local PostgreSQL instance are already running in Docker. Config values added to `.env.local`. The running containers are:
>
> | Container | Image | Port | Memory | Status |
> |-----------|-------|------|--------|--------|
> | `temporal` | `temporalio/auto-setup:1.24.2` | 7233 | ~227 MB | Running |
> | `ui` (Temporal UI) | `temporalio/ui:2.31.2` | 8080 | ~30 MB | Running |
> | `postgresql` | `postgres:13` | 5432 | — | Running |
> | `redis` | `redis:7-alpine` | 6379 | — | Running (already in docker-compose.yml) |

- [ ] **Add ArangoDB service to `docker-compose.yml`** — S
  - Image: `arangodb/arangodb:3.12`
  - Port: 8529 (web UI + API)
  - Volume: `arangodb_data:/var/lib/arangodb3`
  - Environment: `ARANGO_ROOT_PASSWORD` from `.env.local`
  - Health check: `arangosh --server.password $password --javascript.execute-string "db._version()"`
  - **Test:** `docker compose up arangodb` starts cleanly. Web UI accessible at `localhost:8529`.
  - Notes: _____

- [x] **Add Temporal server service** — M
  - Image: `temporalio/auto-setup:1.24.2` (pinned, not `:latest`)
  - Port: 7233 (gRPC)
  - Uses local PostgreSQL (`postgres:13` on port 5432) as persistence store
  - Health check: `temporal operator cluster health`
  - **Test:** ~~`docker compose up temporal` starts. `temporal operator namespace describe default` returns.~~
  - Notes: Running. ~227 MB memory, 1.38% CPU. Connected to local PostgreSQL for persistence.

- [x] **Add Temporal UI service** — S
  - Image: `temporalio/ui:2.31.2` (pinned)
  - Port: 8080
  - Environment: `TEMPORAL_ADDRESS=temporal:7233`
  - Depends on: `temporal`
  - **Test:** ~~Web UI loads at `localhost:8080`. Default namespace visible.~~
  - Notes: Running. ~30 MB memory. Accessible at `localhost:8080`.

- [ ] **Add Temporal heavy-compute worker service** — M
  - Build from project root, custom entrypoint: `pnpm temporal:worker:heavy`
  - No exposed ports
  - Environment: `TEMPORAL_ADDRESS=localhost:7233`, `TASK_QUEUE=heavy-compute-queue`
  - Depends on: `temporal`
  - Memory limit: 256 MB (Phase 0 — no actual work)
  - **Test:** Worker connects, registers on `heavy-compute-queue`. Temporal UI shows worker in queue.
  - Notes: Temporal server is ready. Worker code needs to be written (see §2.4).

- [ ] **Add Temporal light-llm worker service** — M
  - Same as heavy worker but `TASK_QUEUE=light-llm-queue`
  - Memory limit: 128 MB
  - **Test:** Worker registers on `light-llm-queue`. Temporal UI confirms.
  - Notes: Temporal server is ready. Worker code needs to be written (see §2.4).

- [ ] **Update `.env.example` with new variables** — S (partially done)
  - Already configured in `.env.local`: `TEMPORAL_ADDRESS`, `REDIS_URL`
  - Still needed in `.env.example`: `ARANGODB_URL`, `ARANGODB_DATABASE`, `ARANGODB_ROOT_PASSWORD`, `TEMPORAL_ADDRESS`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_BASEURL`
  - **Test:** `cp .env.example .env.local` + fill values → `docker compose up` succeeds.
  - Notes: `.env.local` has Temporal + Redis config. `.env.example` needs to be updated to document all new vars for other developers.

- [ ] **Add `pnpm temporal:worker:heavy` and `pnpm temporal:worker:light` scripts to `package.json`** — S
  - Both use `tsx` to run TypeScript worker entry points
  - **Test:** `pnpm temporal:worker:heavy` starts without error (may fail to connect if Temporal isn't running — that's expected).
  - Notes: _____

- [x] **Redis service in `docker-compose.yml`** — S
  - Already present in `docker-compose.yml` (`redis:7-alpine`, port 6379, AOF persistence)
  - Health check configured (`redis-cli ping`)
  - Notes: Pre-existing. No changes needed.

### E2E Test Framework Setup

- [ ] **Verify Playwright is installed and scaffolded with browser binaries** — S
  - Playwright is already a devDependency (`@playwright/test`). Ensure browser binaries are installed: `pnpm exec playwright install --with-deps chromium`.
  - Confirm `playwright.config.ts` has a `baseURL` pointing to `localhost:3000` and a `webServer` block that starts the dev server before E2E runs.
  - Add `pnpm exec playwright install` to the Docker Compose `app` entrypoint or CI pipeline so browser binaries are available in every environment where E2E tests run.
  - **Test:** `pnpm e2e:headless` runs the existing example spec without "browser not found" errors.
  - Notes: _____

---

## 2.2 Database & Schema Layer

### Prisma Setup

- [ ] **Initialize Prisma with Supabase PostgreSQL** — M
  - `pnpm add -D prisma && pnpm add @prisma/client`
  - `prisma/schema.prisma` with `provider = "postgresql"`, `url = env("SUPABASE_DB_URL")`
  - Enable `pgvector` extension: `extensions = [pgvector]`
  - **Test:** `pnpm prisma db pull` succeeds and introspects existing Better Auth tables.
  - Notes: _____

- [ ] **Define `repos` table in Prisma schema** — S
  - Fields as specified in §1.2 (id, organization_id, name, full_name, provider, provider_id, status, default_branch, last_indexed_at, timestamps)
  - Status enum: `pending`, `indexing`, `ready`, `error`, `deleting`
  - Unique constraint on `(organization_id, provider, provider_id)`
  - **Test:** `pnpm prisma migrate dev --name add-repos-table` runs cleanly. Table visible in Supabase dashboard.
  - Notes: _____

- [ ] **Define `deletion_logs` table in Prisma schema** — S
  - Fields as specified in §1.2
  - Partial index on `status` where `status != 'completed'` (for audit efficiency)
  - **Test:** Migration runs. Insert a test row and query it.
  - Notes: _____

- [ ] **Verify Better Auth table coexistence** — M
  - After Prisma migration, confirm Better Auth tables (`user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`) are untouched
  - Confirm Prisma can read from Better Auth tables via `$queryRaw` if needed
  - **Test:** Sign up a user via the existing auth flow → verify it still works after Prisma migration.
  - Notes: _____

### ArangoDB Schema Bootstrap

- [ ] **Implement `bootstrapGraphSchema()` function** — M
  - Creates all document collections: `repos`, `files`, `functions`, `classes`, `interfaces`, `variables`, `patterns`, `rules`, `snippets`, `ledger`
  - Creates all edge collections: `contains`, `calls`, `imports`, `extends`, `implements`
  - Creates persistent index `[org_id, repo_id]` on every collection
  - Idempotent — safe to run multiple times
  - **Test:** Call twice in sequence. Second call is a no-op. All collections and indexes exist in ArangoDB web UI.
  - Notes: _____

- [ ] **Wire `bootstrapGraphSchema()` into app startup** — S
  - Runs once on first container access (part of `ArangoGraphStore` constructor or lazy init)
  - Must not block app startup if ArangoDB is unreachable (log warning, skip)
  - **Test:** `docker compose up` → ArangoDB collections visible. Stop ArangoDB → app still starts (degraded).
  - Notes: _____

---

## 2.3 Ports & Adapters Layer

### Port Interfaces (11 ports)

- [ ] **`lib/ports/types.ts`** — Domain types shared across all ports — M
  - `EntityDoc`, `EdgeDoc`, `RuleDoc`, `PatternDoc`, `SnippetDoc`, `FeatureDoc`, `BlueprintData`
  - `OrgContext` (orgId, repoId, userId, sessionId)
  - `TokenUsage`, `WorkflowHandle`, `WorkflowStatus`
  - `ImpactResult`, `RuleFilter`, `PatternFilter`, `SnippetFilter`
  - **Test:** Types compile. No runtime behavior to test.
  - Notes: _____

- [ ] **`lib/ports/graph-store.ts`** — `IGraphStore` interface — S
  - All methods as defined in VERTICAL_SLICING_PLAN.md §5
  - **Test:** Type-check only. Implementation tested via adapter.
  - Notes: _____

- [ ] **`lib/ports/relational-store.ts`** — `IRelationalStore` interface — S
  - CRUD for users, orgs, repos, subscriptions, api_keys, deletion_logs
  - **Test:** Type-check only.
  - Notes: _____

- [ ] **`lib/ports/llm-provider.ts`** — `ILLMProvider` interface — S
  - `generateObject<T>()`, `streamText()`, `embed()`
  - **Test:** Type-check only.
  - Notes: _____

- [ ] **`lib/ports/workflow-engine.ts`** — `IWorkflowEngine` interface — S
  - `startWorkflow()`, `signalWorkflow()`, `getWorkflowStatus()`, `cancelWorkflow()`
  - **Test:** Type-check only.
  - Notes: _____

- [ ] **`lib/ports/git-host.ts`** — `IGitHost` interface — S
  - `cloneRepo()`, `getPullRequest()`, `createPullRequest()`, `getDiff()`, `listFiles()`, `createWebhook()`
  - **Test:** Type-check only.
  - Notes: _____

- [ ] **`lib/ports/vector-search.ts`** — `IVectorSearch` interface — S
  - `embed()`, `search()`, `upsert()`
  - **Test:** Type-check only.
  - Notes: _____

- [ ] **`lib/ports/billing-provider.ts`** — `IBillingProvider` interface — S
  - `createCheckoutSession()`, `createSubscription()`, `cancelSubscription()`, `reportUsage()`
  - **Test:** Type-check only.
  - Notes: _____

- [ ] **`lib/ports/observability.ts`** — `IObservability` interface — S
  - `getOrgLLMCost()`, `getCostBreakdown()`, `getModelUsage()`
  - **Test:** Type-check only.
  - Notes: _____

- [ ] **`lib/ports/cache-store.ts`** — `ICacheStore` interface — S
  - `get()`, `set()`, `invalidate()`, `rateLimit()`
  - **Test:** Type-check only.
  - Notes: _____

- [ ] **`lib/ports/code-intelligence.ts`** — `ICodeIntelligence` interface — S
  - `indexWorkspace()`, `getDefinitions()`, `getReferences()`
  - **Test:** Type-check only.
  - Notes: _____

- [ ] **`lib/ports/pattern-engine.ts`** — `IPatternEngine` interface — S
  - `scanPatterns()`, `matchRule()`
  - **Test:** Type-check only.
  - Notes: _____

### Production Adapters (Phase 0 needs 5 working, 6 stubbed)

**Working adapters (used in Phase 0 user flows):**

- [ ] **`lib/adapters/arango-graph-store.ts`** — `ArangoGraphStore implements IGraphStore` — L
  - Dependencies: `arangojs`
  - Constructor: takes ArangoDB config, lazy connection
  - Phase 0 methods needed: `bootstrapGraphSchema()` (called on init), health check
  - All other methods: implemented but unused until Phase 1+
  - Tenant isolation: every query includes `org_id` filter
  - **Test:** Unit test with real ArangoDB (Docker): create collection, insert doc with org_id, query with wrong org_id → empty result. Health check returns up/down.
  - Notes: _____

- [ ] **`lib/adapters/prisma-relational-store.ts`** — `PrismaRelationalStore implements IRelationalStore` — M
  - Dependencies: `@prisma/client`
  - Wraps Prisma client for all Supabase operations
  - Phase 0 methods needed: `getRepos(orgId)`, `createRepo()`, `getDeletionLogs()`
  - **Test:** Integration test: create repo, query by orgId, verify isolation.
  - Notes: _____

- [ ] **`lib/adapters/temporal-workflow-engine.ts`** — `TemporalWorkflowEngine implements IWorkflowEngine` — M
  - Dependencies: `@temporalio/client`
  - Lazy connection to Temporal server
  - Phase 0: connection + health check. No workflows started.
  - **Test:** Connect to Temporal (Docker). Call health check → returns status.
  - Notes: _____

- [ ] **`lib/adapters/redis-cache-store.ts`** — `RedisCacheStore implements ICacheStore` — M
  - Dependencies: `ioredis`
  - Wraps existing `lib/queue/redis.ts` pattern (lazy + `lazyConnect`)
  - Phase 0: replaces direct Redis usage in rate limiting
  - **Test:** Set key, get key, invalidate, confirm TTL behavior.
  - Notes: _____

- [ ] **`lib/adapters/langfuse-observability.ts`** — `LangfuseObservability implements IObservability` (Partial) — M
  - Dependencies: `@langfuse/client`, `@langfuse/otel`
  - If Langfuse env vars (`LANGFUSE_SECRET_KEY`, `LANGFUSE_PUBLIC_KEY`) are present: initialize real connection, perform health check (ping Langfuse API), integrate with OpenTelemetry span processor.
  - If absent: no-op — all methods return empty/zero data, health check returns `"down"` with a note that env vars are missing.
  - This is a **working adapter** (not a stub) because the Phase 0 health check depends on it to report Langfuse status, and `instrumentation.ts` wires it into the OpenTelemetry pipeline.
  - **Test:** Without env vars → no errors, health check returns `down` gracefully. With env vars → connection established, health check returns `up`.
  - Notes: _____

**Stub adapters (implement interface, throw "not implemented" or return empty data):**

- [ ] **`lib/adapters/vercel-ai-provider.ts`** — Stub — S
  - **Test:** `generateObject()` throws `NotImplementedError`. Compiles against `ILLMProvider`.
  - Notes: _____

- [ ] **`lib/adapters/github-host.ts`** — Stub — S
  - **Test:** `cloneRepo()` throws `NotImplementedError`. Compiles against `IGitHost`.
  - Notes: _____

- [ ] **`lib/adapters/llamaindex-vector-search.ts`** — Stub — S
  - **Test:** Compiles against `IVectorSearch`.
  - Notes: _____

- [ ] **`lib/adapters/stripe-payments.ts`** — Stub — S
  - **Test:** Compiles against `IBillingProvider`.
  - Notes: _____

- [ ] **`lib/adapters/scip-code-intelligence.ts`** — Stub — S
  - **Test:** Compiles against `ICodeIntelligence`.
  - Notes: _____

- [ ] **`lib/adapters/semgrep-pattern-engine.ts`** — Stub — S
  - **Test:** Compiles against `IPatternEngine`.
  - Notes: _____

### DI Container

- [ ] **`lib/di/container.ts`** — Container type + factory functions — M
  - `Container` interface with all 11 port fields
  - `createProductionContainer()` — wires real adapters (working + stubs)
  - `createTestContainer(overrides?)` — in-memory fakes for all 11 ports
  - `getContainer()` — lazy singleton for production use
  - **Test:** `createProductionContainer()` returns object with all 11 keys. Each key implements its port interface (TypeScript compile check). `createTestContainer({ graphStore: customFake })` correctly overrides.
  - Notes: _____

### Test Fakes (for `createTestContainer`)

- [ ] **In-memory fakes for all 11 ports** — M
  - `InMemoryGraphStore`, `InMemoryRelationalStore`, `MockLLMProvider`, `InlineWorkflowEngine`, `FakeGitHost`, `InMemoryVectorSearch`, `NoOpBillingProvider`, `InMemoryObservability`, `InMemoryCacheStore`, `FakeCodeIntelligence`, `FakePatternEngine`
  - Store data in plain Maps/arrays. No external dependencies.
  - **Test:** Each fake passes the same interface compliance check as its production adapter.
  - Notes: _____

---

## 2.4 Backend / API Layer

### Health Check Expansion

- [ ] **Expand `/api/health` to check all four systems** — M
  - Parallel checks: Supabase (`SELECT 1`), ArangoDB (version query), Temporal (cluster health), Redis (PING)
  - 2-second timeout per check
  - Response shape as defined in §1.3
  - Only Supabase failure returns HTTP 503. Others → 200 with `degraded` status.
  - **Test:** All up → 200 `healthy`. Kill ArangoDB → 200 `degraded`. Kill Supabase → 503 `unhealthy`.
  - Notes: _____

### Org Creation Enhancement

- [ ] **Create `lib/use-cases/create-org.ts`** — M
  - Receives container (or specific ports) as dependency
  - Steps: 1) Create org via Better Auth plugin, 2) Bootstrap ArangoDB for org, 3) Return org data
  - If ArangoDB bootstrap fails: log error, return success (org is created in Supabase, ArangoDB can be bootstrapped later)
  - **Test:** With `createTestContainer()` — verify `InMemoryGraphStore.bootstrapGraphSchema()` is called. Verify org creation succeeds even if graph store throws.
  - Notes: _____

- [ ] **Wire org creation use case into auth flow** — S
  - Hook into Better Auth's org creation (either post-creation hook or wrapper API route)
  - **Test:** E2E — create org → verify ArangoDB collections exist for that org.
  - Notes: _____

### Proxy.ts Enhancement (Email Verification Enforcement)

- [ ] **Add email verification check to `proxy.ts`** — M
  - For authenticated, non-public paths: check `session.user.emailVerified`
  - If false: redirect to `/verify-email`
  - Exempt paths: `/verify-email`, `/api/auth/*`, `/api/health`
  - Respects Better Auth's `cookieCache` (no extra DB call on every request)
  - **Test:** Register user (unverified) → access `/` → redirected to `/verify-email`. Verify email → access `/` → dashboard loads.
  - Notes: _____

### Temporal Worker Entry Points

- [ ] **`scripts/temporal-worker-heavy.ts`** — S
  - Connects to Temporal, registers `heavy-compute-queue` with empty activity set (Phase 0)
  - Logs "Heavy compute worker started, waiting for tasks..."
  - **Connection retry:** Must handle Temporal server unavailability during `docker compose up` startup race. The Temporal Docker image takes 5-10 seconds to initialize. Workers must retry connection with exponential backoff (e.g., 1s, 2s, 4s, 8s... up to 60s max) rather than crashing the container. Use Temporal SDK's built-in `ConnectionOptions.connectTimeout` + a wrapper retry loop. Log each retry attempt so developers can distinguish "still connecting" from "permanently broken."
  - **Test:** Script starts, connects, idles. Temporal UI shows worker. Also: start worker BEFORE Temporal server → worker retries and eventually connects when server becomes available.
  - Notes: _____

- [ ] **`scripts/temporal-worker-light.ts`** — S
  - Same for `light-llm-queue`, same retry behavior as heavy worker.
  - **Test:** Same as above.
  - Notes: _____

### Langfuse / OpenTelemetry Setup

- [ ] **`instrumentation.ts` — OpenTelemetry + Langfuse span processor** — M
  - Next.js 16 instrumentation file
  - Conditionally enables Langfuse if env vars present
  - Filters to AI SDK spans only (no Next.js infra noise)
  - **Test:** With Langfuse env vars: AI SDK call (even a mock one) appears in Langfuse dashboard. Without: no errors, no-op.
  - Notes: _____

---

## 2.5 Frontend / UI Layer

### Dashboard Shell

- [ ] **`app/(dashboard)/layout.tsx` — Authenticated dashboard layout** — M
  - Sidebar navigation: Repos, Search (disabled), Settings
  - Top bar: org switcher (if multiple orgs), user avatar/menu
  - Uses design system: `bg-background`, `glass-panel` sidebar, `font-grotesk` headings
  - Responsive: sidebar collapses on mobile
  - **Test:** Visual regression (Storybook story). Renders correctly at 1440px, 768px, 375px widths.
  - Notes: _____

- [ ] **`app/(dashboard)/page.tsx` — Dashboard home (repos list)** — M
  - Server component: fetches repos for active org
  - If zero repos: render empty state component
  - If repos exist (future): render repo cards (not implemented in Phase 0, but the conditional must exist)
  - **Test:** With zero repos → empty state visible. CTA button visible and disabled.
  - Notes: _____

- [ ] **Empty state component** — S
  - Illustration or icon (from Lucide)
  - Heading: "No repositories connected"
  - Description: "Connect your first GitHub repository to get started with code intelligence."
  - CTA: `<Button size="sm" disabled>` with Tooltip: "GitHub integration coming soon"
  - Uses design system: `space-y-6 py-6`, `font-grotesk text-lg font-semibold`
  - **Test:** Storybook story. Tooltip appears on hover. Button is not clickable.
  - Notes: _____

- [ ] **`app/(dashboard)/repos/page.tsx` — Repository management page** — S
  - Same content as dashboard home for Phase 0 (can be a shared component)
  - Nav item "Repos" is active
  - **Test:** Navigating to /repos shows the empty state.
  - Notes: _____

- [ ] **`app/(dashboard)/settings/page.tsx` — Org settings** — M
  - Sections: Org name (editable), Members list (from Better Auth org plugin), Danger zone (delete org)
  - Delete org: confirmation dialog → calls Better Auth org deletion → triggers deletion_logs entry
  - **Test:** Org name displays correctly. Member list shows current user as owner.
  - Notes: _____

### Onboarding Wizard

- [ ] **Onboarding flow for first-time users (no orgs)** — M
  - Triggered when authenticated user has zero org memberships
  - Step 1: Enter org name (validation: 2-50 chars, alphanumeric + spaces + hyphens)
  - Step 2 (optional): Upload org logo (Uploadthing)
  - Submit → calls org creation use case → redirects to dashboard
  - Uses design system: centered card layout, `glass-card`, `bg-rail-fade` submit button
  - **Test:** E2E: new user → lands on onboarding → creates org → sees dashboard.
  - Notes: _____

---

## 2.6 Testing & Verification

### Unit Tests

- [ ] **Port interface compliance tests** — M
  - For each of the 11 ports: verify production adapter AND test fake both satisfy the TypeScript interface
  - Pattern: `satisfies IGraphStore` compile check + basic smoke test (call each method, verify it doesn't crash)
  - **Test:** `pnpm test lib/di/` — all 22 checks pass (11 adapters + 11 fakes).
  - Notes: _____

- [ ] **DI container factory tests** — S
  - `createProductionContainer()` returns all 11 keys
  - `createTestContainer()` returns all 11 keys with in-memory fakes
  - `createTestContainer({ graphStore: custom })` correctly overrides one adapter
  - **Test:** `pnpm test lib/di/container.test.ts`
  - Notes: _____

- [ ] **Domain function tests (pure logic, zero deps)** — S
  - `entity-hashing.ts`: deterministic hash for same input, different hash for different input
  - `rule-resolution.ts`: basic resolution logic (can be minimal in Phase 0)
  - **Test:** `pnpm test lib/domain/`
  - Notes: _____

### Integration Tests

- [ ] **ArangoDB connection + tenant isolation** — M
  - Connect to ArangoDB (Docker). Bootstrap schema. Insert doc with `org_id: "A"`. Query with `org_id: "B"` → empty. Query with `org_id: "A"` → found.
  - **Test:** `pnpm test lib/adapters/arango-graph-store.test.ts` (requires Docker)
  - Notes: _____

- [ ] **Temporal connection + queue registration** — M
  - Connect to Temporal (Docker). Verify both queues are registered. Start a no-op workflow → completes.
  - **Test:** `pnpm test lib/adapters/temporal-workflow-engine.test.ts` (requires Docker)
  - Notes: _____

- [ ] **Health check integration** — S
  - With all services up: returns `healthy`. Verify response shape.
  - **Test:** `pnpm test app/api/health/`
  - Notes: _____

### E2E Tests (Playwright)

- [ ] **Full signup → onboarding → dashboard flow** — L
  - Register new user → verify email (via test helper or auto-verify) → land on onboarding → create org → see empty dashboard → "Connect Repository" CTA visible and disabled
  - **Test:** `pnpm e2e:headless` — this specific test passes.
  - Notes: _____

- [ ] **Returning user → dashboard** — S
  - Login with existing user → dashboard loads with correct org → nav works (Repos, Settings)
  - **Test:** `pnpm e2e:headless`
  - Notes: _____

- [ ] **Org settings page** — S
  - Navigate to settings → org name visible → member list shows owner
  - **Test:** `pnpm e2e:headless`
  - Notes: _____

---

## Dependency Graph

```
Infrastructure ──────────────────────────┐
  Docker Compose (ArangoDB, Temporal,    │
  Temporal UI, workers)                  │
  .env.example updates                   │
  package.json scripts                   │
                                         │
Database & Schema ───────────────────────┤ (depends on Infrastructure)
  Prisma init + migrations               │
  ArangoDB schema bootstrap              │
  Better Auth coexistence verified       │
                                         │
Ports & Adapters ────────────────────────┤ (depends on Database & Schema)
  11 port interfaces                     │
  4 working adapters + 7 stubs           │
  11 test fakes                          │
  DI container                           │
                                         │
Backend / API ───────────────────────────┤ (depends on Ports & Adapters)
  Health check expansion                 │
  Org creation use case                  │
  proxy.ts email verification            │
  Temporal worker entry points           │
  Langfuse instrumentation               │
                                         │
Frontend / UI ───────────────────────────┤ (depends on Backend / API)
  Dashboard layout + shell               │
  Empty state component                  │
  Onboarding wizard                      │
  Settings page                          │
                                         │
Testing & Verification ──────────────────┘ (runs after all layers)
  Unit tests (ports, DI, domain)
  Integration tests (ArangoDB, Temporal)
  E2E tests (full user flows)
```

---

## Revision Log

| Date | Author | Change |
|------|--------|--------|
| 2026-02-17 | — | Initial document created |
| 2026-02-17 | — | Marked Temporal server, Temporal UI, Redis as running. Recorded actual image versions (`auto-setup:1.24.2`, `ui:2.31.2`, `postgres:13`). Noted Temporal uses local PostgreSQL for persistence (not SQLite). Updated memory table with observed values. |
