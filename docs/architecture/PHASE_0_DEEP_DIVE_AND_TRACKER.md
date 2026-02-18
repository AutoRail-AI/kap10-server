# Phase 0 — Foundation Wiring: Deep Dive & Implementation Tracker

> **Phase Feature Statement:** _"I can sign up and create an organization, then connect GitHub repos or start without GitHub. I see a dashboard where I can manage repositories."_
>
> **Source:** [`VERTICAL_SLICING_PLAN.md`](./VERTICAL_SLICING_PLAN.md) — Phase 0
>
> **Note (post–Phase 1, updated 2026-02-18):** A personal organization is **auto-provisioned on signup** via Better Auth `databaseHooks.user.create.after` (direct SQL insert into `organization` + `member` tables). Every user has at least one org from their first login — no welcome screen needed. The GitHub callback **strictly requires** an `orgId` in the state payload and never creates organizations. The old "Start without GitHub" / "Connect GitHub" welcome screen (`EmptyStateNoOrg`, `CreateWorkspaceFirstBanner`, `create-workspace.ts`) has been removed. See [PHASE_1_GITHUB_CONNECT_AND_INDEXING.md § Post-signup & organization provisioning](./PHASE_1_GITHUB_CONNECT_AND_INDEXING.md#post-signup--organization-provisioning).
>
> **Database convention:** All kap10 Supabase tables use PostgreSQL schema `kap10`. See [VERTICAL_SLICING_PLAN.md § Storage & Infrastructure Split](./VERTICAL_SLICING_PLAN.md#storage--infrastructure-split) for the full rule.

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
                                  for orgs → auto-provisioned org found →
                                  render dashboard (repos list or empty-state-repos)
```

**Critical decision — What happens between step 3 and step 4?**

The user has a session cookie but `emailVerified = false`. Phase 0 must decide on one of two strategies:

| Strategy | Behavior | Trade-off |
|----------|----------|-----------|
| **A: Block at proxy** | `proxy.ts` checks `emailVerified` via a lightweight session lookup. Unverified users are redirected to `/verify-email` on every protected route. | Extra DB call per request (mitigated by `cookieCache: 5min`). Clean enforcement. |
| **B: Soft block in UI** | Let the user through to the dashboard but show a banner: "Verify your email to continue." Disable interactive elements. | No extra proxy logic. But if we forget to guard an API route, an unverified user can act. |

**Recommendation: Strategy A.** It is the safer default — enforcement at the perimeter, not scattered across UI components. The `cookieCache` (already configured at 5 minutes in `auth.ts`) prevents the session lookup from becoming a per-request DB query. Implementation detail: `proxy.ts` calls `auth.api.getSession()` which returns `session.user.emailVerified`. If false and path is not `/verify-email` or `/api/auth/*`, redirect to `/verify-email`.

### Flow 2: Verified User → Dashboard (Auto-Provisioned Organization)

**Actor:** Authenticated user
**Precondition:** Email verified (or OAuth). Organization auto-provisioned at signup.

```
Step  Actor Action                System Action                                           State Change
────  ─────────────────────────   ──────────────────────────────────────────────────────   ─────────────────────────────
1     Land on /                   Server component: fetch user's orgs via Better Auth      None
                                  organization plugin → auto-provisioned org found →
                                  render dashboard (repos list or empty-state-repos)
2     Click "Connect GitHub"      GET /api/github/install?orgId=xxx →                      Redis: state token with orgId
                                  Redirect to GitHub App install. orgId stored in state.
3     GitHub callback             GET /api/github/callback → state decoded →               Supabase: github_installation
                                  orgId validated against user's orgs →                      + repo rows created
                                  setActiveOrganization → repos imported →
                                  redirect to /?connected=true
```

**Important:** Organizations are the account-level grouping in kap10. They hold repos, GitHub installations, and settings. A personal organization (`"{name}'s workspace"`) is **auto-provisioned on signup** via Better Auth `databaseHooks.user.create.after` — direct INSERT into `organization` + `member` tables using Better Auth's `generateId()`. No welcome screen or manual org creation step is needed.

**Two user scenarios:**

| Scenario | Path | Outcome |
|----------|------|---------|
| **User has GitHub repos** | Dashboard → Connect GitHub → install App → callback | GitHub installation attached to auto-provisioned organization; repos imported. |
| **Local-only / code not on GitHub yet** | Dashboard | User sees empty-state-repos with "Connect GitHub" CTA for later. |

**Key nuance — ArangoDB org bootstrap:**

ArangoDB bootstrap (`createOrgUseCase()`) is triggered on first repo connect or via `/api/org/bootstrap`. The signup hook only creates the Better Auth org + member records (no ArangoDB dependency). This ensures signup never fails due to ArangoDB downtime.

### Flow 3: Returning User → Dashboard (With Organization)

**Actor:** Authenticated user with at least one organization
**Precondition:** Logged in, has organization, zero or more connected repos

```
Step  Actor Action                System Action                                           State Change
────  ─────────────────────────   ──────────────────────────────────────────────────────   ─────────────────────────────
1     Visit /                     proxy.ts: session valid → pass-through                   None
2     Dashboard renders           Server component:                                        None
                                  1. Fetch orgs → found
                                  2. Fetch repos + installation for active org
                                  3. Render ReposList (or EmptyStateRepos if no install)
                                  Sidebar: DashboardNav + UserProfileMenu (footer)
3     UserProfileMenu             Trigger: avatar + context label (e.g. "Jaswanth's        AccountContext
                                  Personal") → DropdownMenu with sections:                 updated (Personal
                                  Accounts (Personal + Orgs), Settings, Help,              ↔ Org) on switch
                                  Upgrade, Theme toggle, Sign Out
4     Navigate to Settings        /settings → org settings page (name, members, danger)    None
5     Navigate to Repos           /repos → same repos list as dashboard home               None
6     Click "Connect GitHub"      GET /api/github/install → redirect to GitHub             Redis: state token
```

**UserProfileMenu replaces the old static user info.** It provides:
- Account context switching (Personal vs Organization) — persisted via `AccountProvider` in `localStorage`
- Dark/light mode toggle (via `next-themes`)
- Navigation to Settings, sign out
- Placeholder items: Help & Support, Upgrade Plan, Invite Friends

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
| `POST /api/auth/sign-up/email` | < 800ms | Supabase insert (~50ms) + password hash (~200ms) + email send (~400ms) | Resend API latency. If email send is slow, decouple: return 200 immediately, queue email via Temporal activity on `light-llm-queue`. |
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

- [x] **Add ArangoDB service to `docker-compose.yml`** — S
  - Image: `arangodb/arangodb:3.12`
  - Port: 8529 (web UI + API)
  - Volume: `arangodb_data:/var/lib/arangodb3`
  - Environment: `ARANGO_ROOT_PASSWORD` from `.env.local`
  - Health check: `arangosh --server.password $password --javascript.execute-string "db._version()"`
  - **Test:** `docker compose up arangodb` starts cleanly. Web UI accessible at `localhost:8529`.
  - Notes: Implemented 2026-02-17. Service added with healthcheck.

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

- [x] **Add Temporal heavy-compute worker service** — M
  - Build from project root, custom entrypoint: `pnpm temporal:worker:heavy`
  - No exposed ports
  - Environment: `TEMPORAL_ADDRESS=temporal:7233` in Docker, `TASK_QUEUE=heavy-compute-queue`
  - Depends on: `temporal`
  - Memory limit: 256 MB (Phase 0 — no actual work)
  - **Test:** Worker connects, registers on `heavy-compute-queue`. Temporal UI shows worker in queue.
  - Notes: Implemented 2026-02-17. `scripts/temporal-worker-heavy.ts` with retry; service in docker-compose.

- [x] **Add Temporal light-llm worker service** — M
  - Same as heavy worker but `TASK_QUEUE=light-llm-queue`
  - Memory limit: 128 MB
  - **Test:** Worker registers on `light-llm-queue`. Temporal UI confirms.
  - Notes: Implemented 2026-02-17. `scripts/temporal-worker-light.ts` with retry.

- [x] **Update `.env.example` with new variables** — S (partially done)
  - Already configured in `.env.local`: `TEMPORAL_ADDRESS`, `REDIS_URL`
  - Still needed in `.env.example`: `ARANGODB_URL`, `ARANGODB_DATABASE`, `ARANGODB_ROOT_PASSWORD`, `TEMPORAL_ADDRESS`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_BASEURL`
  - **Test:** `cp .env.example .env.local` + fill values → `docker compose up` succeeds.
  - Notes: Implemented 2026-02-17.

- [x] **Add `pnpm temporal:worker:heavy` and `pnpm temporal:worker:light` scripts to `package.json`** — S
  - Both use `tsx` to run TypeScript worker entry points
  - **Test:** `pnpm temporal:worker:heavy` starts without error (may fail to connect if Temporal isn't running — that's expected).
  - Notes: Implemented 2026-02-17.

- [x] **Redis service in `docker-compose.yml`** — S
  - Already present in `docker-compose.yml` (`redis:7-alpine`, port 6379, AOF persistence)
  - Health check configured (`redis-cli ping`)
  - Notes: Pre-existing. No changes needed.

### E2E Test Framework Setup

- [x] **Verify Playwright is installed and scaffolded with browser binaries** — S
  - Playwright is already a devDependency (`@playwright/test`). Ensure browser binaries are installed: `pnpm exec playwright install --with-deps chromium`.
  - Confirm `playwright.config.ts` has a `baseURL` pointing to `localhost:3000` and a `webServer` block that starts the dev server before E2E runs.
  - Add `pnpm exec playwright install` to the Docker Compose `app` entrypoint or CI pipeline so browser binaries are available in every environment where E2E tests run.
  - **Test:** `pnpm e2e:headless` runs the existing example spec without "browser not found" errors.
  - Notes: Implemented. `playwright.config.ts` has `baseURL: "http://127.0.0.1:3000"` and `webServer: { command: "pnpm dev", url: "http://127.0.0.1:3000", reuseExistingServer: !process.env.CI }`. Example spec at `e2e/example.spec.ts`. Run `pnpm exec playwright install` (or `--with-deps chromium`) once per environment; CI/Docker can add this to entrypoint when E2E runs in pipeline.

---

## 2.2 Database & Schema Layer

**Rule: Supabase schema for kap10.** All kap10-managed Supabase tables live in PostgreSQL schema **`kap10`** (multi-app same project). Use `schemas = ["public", "kap10"]` and `@@schema("kap10")` on every kap10 model/enum; table names stay unprefixed (e.g. `repos`, `deletion_logs`). See VERTICAL_SLICING_PLAN.md § Storage & Infrastructure Split.

### Prisma Setup

- [x] **Initialize Prisma with Supabase PostgreSQL** — M
  - `pnpm add -D prisma && pnpm add @prisma/client`
  - `prisma/schema.prisma` with `provider = "postgresql"`; URL in `prisma.config.ts` via `SUPABASE_DB_URL`
  - **Test:** `pnpm prisma generate` succeeds.
  - Notes: Implemented 2026-02-17. Prisma 7 uses prisma.config.ts for datasource URL.

- [x] **Define `repos` table in Prisma schema** — S
  - Fields as specified in §1.2 (id, organization_id, name, full_name, provider, provider_id, status, default_branch, last_indexed_at, timestamps)
  - Status enum: `pending`, `indexing`, `ready`, `error`, `deleting`; **schema:** `@@schema("kap10")`, **table:** `@@map("repos")`
  - **Test:** `pnpm prisma migrate dev` runs cleanly. Table in Supabase as `kap10.repos`.
  - Notes: Implemented 2026-02-17. Migration `20260217100000_prefix_supabase_tables_kap10` moves tables/enums into schema `kap10`.

- [x] **Define `deletion_logs` table in Prisma schema** — S
  - Fields as specified in §1.2; **schema:** `@@schema("kap10")`, **table:** `@@map("deletion_logs")`
  - Index on `status` for audit queries
  - **Test:** Migration runs. Insert a test row and query it.
  - Notes: Implemented 2026-02-17. Same migration as repos; both live in schema `kap10`.

- [x] **Verify Better Auth table coexistence** — M
  - After Prisma migration, confirm Better Auth tables (`user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`) remain in `public`
  - Confirm Prisma can read from Better Auth tables via `$queryRaw` if needed
  - **Test:** Sign up a user via the existing auth flow → verify it still works after Prisma migration.
  - Notes: Kap10 app tables live in schema `kap10` (`kap10.repos`, `kap10.deletion_logs`); Better Auth tables stay in `public`.

### ArangoDB Schema Bootstrap

- [x] **Implement `bootstrapGraphSchema()` function** — M
  - Creates all document collections: `repos`, `files`, `functions`, `classes`, `interfaces`, `variables`, `patterns`, `rules`, `snippets`, `ledger`
  - Creates all edge collections: `contains`, `calls`, `imports`, `extends`, `implements`
  - Creates persistent index `[org_id, repo_id]` on every collection
  - Idempotent — safe to run multiple times
  - **Test:** Call twice in sequence. Second call is a no-op. All collections and indexes exist in ArangoDB web UI.
  - Notes: Implemented 2026-02-17 in `lib/adapters/arango-graph-store.ts`. Creates DB if missing, then collections/indexes.

- [x] **Wire `bootstrapGraphSchema()` into app startup** — S
  - Runs on first org creation via `createOrgUseCase` → `container.graphStore.bootstrapGraphSchema()` (not at app startup; on demand so ArangoDB down does not block startup).
  - **Test:** Create org → ArangoDB collections visible. Stop ArangoDB → app still starts (degraded).
  - Notes: Bootstrap runs when user creates org (POST /api/org/bootstrap after Better Auth create).

---

## 2.3 Ports & Adapters Layer

### Port Interfaces (11 ports)

- [x] **`lib/ports/types.ts`** — Domain types shared across all ports — M
  - `EntityDoc`, `EdgeDoc`, `RuleDoc`, `PatternDoc`, `SnippetDoc`, `FeatureDoc`, `BlueprintData`
  - `OrgContext` (orgId, repoId, userId, sessionId)
  - `TokenUsage`, `WorkflowHandle`, `WorkflowStatus`
  - `ImpactResult`, `RuleFilter`, `PatternFilter`, `SnippetFilter`
  - **Test:** Types compile. No runtime behavior to test.
  - Notes: Implemented 2026-02-17. All types used by port interfaces.

- [x] **`lib/ports/graph-store.ts`** — `IGraphStore` interface — S
  - All methods as defined in VERTICAL_SLICING_PLAN.md §5; includes `bootstrapGraphSchema()` and `healthCheck()`
  - **Test:** Type-check only. Implementation tested via adapter.
  - Notes: Implemented 2026-02-17.

- [x] **`lib/ports/relational-store.ts`** — `IRelationalStore` interface — S
  - `healthCheck()`, `getRepos(orgId)`, `createRepo()`, `getDeletionLogs()` (Phase 0); CRUD surface for Phase 1+
  - **Test:** Type-check only.
  - Notes: Implemented 2026-02-17. Aligns with Prisma/Supabase usage.

- [x] **`lib/ports/llm-provider.ts`** — `ILLMProvider` interface — S
  - `generateObject<T>()`, `streamText()`, `embed()`
  - **Test:** Type-check only.
  - Notes: Implemented 2026-02-17. Stub in Phase 0; Vercel AI SDK in Phase 4+.

- [x] **`lib/ports/workflow-engine.ts`** — `IWorkflowEngine` interface — S
  - `startWorkflow()`, `signalWorkflow()`, `getWorkflowStatus()`, `cancelWorkflow()`, `healthCheck()`
  - **Test:** Type-check only.
  - Notes: Implemented 2026-02-17. Temporal TypeScript SDK (not Python); same concepts (determinism, retry).

- [x] **`lib/ports/git-host.ts`** — `IGitHost` interface — S
  - `cloneRepo()`, `getPullRequest()`, `createPullRequest()`, `getDiff()`, `listFiles()`, `createWebhook()`
  - **Test:** Type-check only.
  - Notes: Implemented 2026-02-17. Stub in Phase 0; Octokit in Phase 1+.

- [x] **`lib/ports/vector-search.ts`** — `IVectorSearch` interface — S
  - `embed()`, `search()`, `upsert()`
  - **Test:** Type-check only.
  - Notes: Implemented 2026-02-17. Stub in Phase 0.

- [x] **`lib/ports/billing-provider.ts`** — `IBillingProvider` interface — S
  - `createCheckoutSession()`, `createSubscription()`, `cancelSubscription()`, `reportUsage()`
  - **Test:** Type-check only.
  - Notes: Implemented 2026-02-17. Stub in Phase 0; Stripe in Phase 2+.

- [x] **`lib/ports/observability.ts`** — `IObservability` interface — S
  - `getOrgLLMCost()`, `getCostBreakdown()`, `getModelUsage()`, `healthCheck()` (up/down/unconfigured)
  - **Test:** Type-check only.
  - Notes: Implemented 2026-02-17. Langfuse optional; health reports status.

- [x] **`lib/ports/cache-store.ts`** — `ICacheStore` interface — S
  - `get()`, `set()`, `invalidate()`, `rateLimit()`, `healthCheck()`
  - **Test:** Type-check only.
  - Notes: Implemented 2026-02-17. Redis (ioredis) via existing lib/queue/redis.

- [x] **`lib/ports/code-intelligence.ts`** — `ICodeIntelligence` interface — S
  - `indexWorkspace()`, `getDefinitions()`, `getReferences()`
  - **Test:** Type-check only.
  - Notes: Implemented 2026-02-17. Stub in Phase 0; SCIP in Phase 1+.

- [x] **`lib/ports/pattern-engine.ts`** — `IPatternEngine` interface — S
  - `scanPatterns()`, `matchRule()`
  - **Test:** Type-check only.
  - Notes: Implemented 2026-02-17. Stub in Phase 0; Semgrep/ast-grep in Phase 6+.

### Production Adapters (Phase 0 needs 5 working, 6 stubbed)

**Working adapters (used in Phase 0 user flows):**

- [x] **`lib/adapters/arango-graph-store.ts`** — `ArangoGraphStore implements IGraphStore` — L
  - Dependencies: `arangojs`
  - Lazy connection via `getDbAsync()`; creates DB if missing, then document/edge collections + persistent index `[org_id, repo_id]` (ArangoDB multi-tenant pattern)
  - Phase 0: `bootstrapGraphSchema()`, `healthCheck()`; all other methods no-op until Phase 1+
  - **Test:** Unit test with real ArangoDB (Docker): bootstrap twice (idempotent), health returns up/down.
  - Notes: Implemented 2026-02-17. Aligns with ArangoDB docs (createDatabase, ensureIndex, edge type 3).

- [x] **`lib/adapters/prisma-relational-store.ts`** — `PrismaRelationalStore implements IRelationalStore` — M
  - Dependencies: `@prisma/client`
  - Phase 0: `healthCheck()` ($queryRaw SELECT 1), `getRepos(orgId)`, `createRepo()`, `getDeletionLogs()`
  - **Test:** Integration test: create repo, query by orgId. Prisma 7 uses prisma.config.ts for URL (Supabase).
  - Notes: Implemented 2026-02-17. Supabase PostgreSQL via Prisma; no conflict with Better Auth tables.

- [x] **`lib/adapters/temporal-workflow-engine.ts`** — `TemporalWorkflowEngine implements IWorkflowEngine` — M
  - Dependencies: `@temporalio/client`
  - Lazy connection; Phase 0: `healthCheck()` only; workflow methods throw until Phase 1+
  - **Test:** Connect to Temporal (Docker). healthCheck() returns up/down. TypeScript SDK (Temporal docs apply to determinism/versioning).
  - Notes: Implemented 2026-02-17. Stack is TypeScript/Node (not Python); same Temporal concepts.

- [x] **`lib/adapters/redis-cache-store.ts`** — `RedisCacheStore implements ICacheStore` — M
  - Uses existing `lib/queue/redis.ts` (ioredis, lazyConnect)
  - `get()`, `set()`, `invalidate()`, `rateLimit()`, `healthCheck()` (PING)
  - **Test:** Set/get/invalidate, rateLimit, healthCheck. Redis docs: single connection, pipelining.
  - Notes: Implemented 2026-02-17.

- [x] **`lib/adapters/langfuse-observability.ts`** — `LangfuseObservability implements IObservability` (Partial) — M
  - No extra deps; checks `LANGFUSE_SECRET_KEY`/`LANGFUSE_PUBLIC_KEY`. If absent: health returns `unconfigured`, cost methods return 0/empty.
  - Phase 0 health reports Langfuse status. Full OpenTelemetry + Langfuse span processor deferred (instrumentation.ts uses Vercel OTel only).
  - **Test:** Without env vars → healthCheck() returns unconfigured; no errors.
  - Notes: Implemented 2026-02-17. Langfuse integration (OTel/Langfuse SDK) can be added when AI SDK is used.

**Stub adapters (implement interface, throw "not implemented" or return empty data):**

- [x] **`lib/adapters/vercel-ai-provider.ts`** — Stub — S
  - **Test:** `generateObject()` throws `NotImplementedError`. Compiles against `ILLMProvider`.
  - Notes: Implemented 2026-02-17.

- [x] **`lib/adapters/github-host.ts`** — Stub — S
  - **Test:** `cloneRepo()` throws `NotImplementedError`. Compiles against `IGitHost`.
  - Notes: Implemented 2026-02-17.

- [x] **`lib/adapters/llamaindex-vector-search.ts`** — Stub — S
  - **Test:** Compiles against `IVectorSearch`. Throws NotImplementedError.
  - Notes: Implemented 2026-02-17.

- [x] **`lib/adapters/stripe-payments.ts`** — Stub — S
  - **Test:** Compiles against `IBillingProvider`. Throws NotImplementedError.
  - Notes: Implemented 2026-02-17.

- [x] **`lib/adapters/scip-code-intelligence.ts`** — Stub — S
  - **Test:** Compiles against `ICodeIntelligence`. Throws NotImplementedError.
  - Notes: Implemented 2026-02-17.

- [x] **`lib/adapters/semgrep-pattern-engine.ts`** — Stub — S
  - **Test:** Compiles against `IPatternEngine`. Throws NotImplementedError.
  - Notes: Implemented 2026-02-17.

### DI Container

- [x] **`lib/di/container.ts`** — Container type + factory functions — M
  - `Container` interface with all 11 port fields
  - `createProductionContainer()` — wires real adapters (5 working + 6 stubs)
  - `createTestContainer(overrides?)` — in-memory fakes for all 11 ports
  - `getContainer()` — lazy singleton for production use
  - **Test:** TypeScript compile; createProductionContainer/createTestContainer return all 11 keys; overrides work.
  - Notes: Implemented 2026-02-17.

### Test Fakes (for `createTestContainer`)

- [x] **In-memory fakes for all 11 ports** — M
  - `lib/di/fakes.ts`: InMemoryGraphStore, InMemoryRelationalStore, MockLLMProvider, InlineWorkflowEngine, FakeGitHost, InMemoryVectorSearch, NoOpBillingProvider, InMemoryObservability, InMemoryCacheStore, FakeCodeIntelligence, FakePatternEngine
  - Store data in Maps/arrays; no external dependencies.
  - **Test:** Each fake implements the port interface; createTestContainer uses them.
  - Notes: Implemented 2026-02-17.

---

## 2.4 Backend / API Layer

### Health Check Expansion

- [x] **Expand `/api/health` to check all four systems** — M
  - Parallel checks: Supabase (`SELECT 1`), ArangoDB (listCollections), Temporal (cluster health), Redis (PING), Langfuse (adapter health)
  - 2-second timeout per check; uses DI container
  - Response shape: `{ status, timestamp, checks }`; only Supabase failure returns HTTP 503
  - **Test:** `app/api/health/route.test.ts` — response shape and 503 when Supabase down.
  - Notes: Implemented 2026-02-17.

### Org Creation Enhancement

- [x] **Create `lib/use-cases/create-org.ts`** — M
  - Receives container as dependency; calls `graphStore.bootstrapGraphSchema(organizationId)` (org created by Better Auth before this)
  - If ArangoDB bootstrap fails: log error, return success
  - **Test:** With `createTestContainer()` — verify bootstrap called with correct org id.
  - Notes: Implemented 2026-02-17.

- [x] **Wire org creation use case into auth flow** — S
  - POST `/api/org/bootstrap` (session required); frontend calls after Better Auth `organization.create`; runs createOrgUseCase
  - **Test:** E2E — signup → auto-provisioned org → connect GitHub → callback → ArangoDB bootstrap on first repo connect.
  - Notes: Implemented 2026-02-17.

### Proxy.ts Enhancement (Email Verification Enforcement)

- [x] **Add email verification check to `proxy.ts`** — M
  - For authenticated, non-public paths: check `session.user.emailVerified` via `auth.api.getSession({ headers })`
  - If false: redirect to `/verify-email`; exempt: `/verify-email`, `/api/auth/*`, `/api/health`
  - **Email/password only:** Redirect applies only to users who signed up with email/password. Users with a Google or GitHub account (from `auth.api.listUserAccounts`) are not redirected; OAuth providers already verify email.
  - **Test:** Register user (unverified) → access `/` → redirected to `/verify-email`. Sign in with Google/GitHub → no redirect to verify-email.
  - Notes: Implemented 2026-02-17. Aligns with Better Auth session/emailVerified; OAuth exemption added 2026-02-17.

### Temporal Worker Entry Points

- [x] **`scripts/temporal-worker-heavy.ts`** — S
  - Connects to Temporal (TypeScript SDK), registers `heavy-compute-queue`; exponential backoff 1s→60s
  - **Test:** `pnpm temporal:worker:heavy` starts; Temporal UI shows worker.
  - Notes: Implemented 2026-02-17. Temporal TypeScript SDK (not Python); same concepts (determinism, versioning).

- [x] **`scripts/temporal-worker-light.ts`** — S
  - Same for `light-llm-queue`, same retry behavior as heavy worker.
  - **Test:** `pnpm temporal:worker:light` starts.
  - Notes: Implemented 2026-02-17.

### Langfuse / OpenTelemetry Setup

- [x] **`instrumentation.ts` — OpenTelemetry + Langfuse span processor** — M
  - `instrumentation.ts`: `registerOTel("next-app")` (Vercel OTel). Langfuse span processor deferred; Langfuse adapter reports health.
  - **Test:** Build passes; no errors when Langfuse env absent. Full OTel+Langfuse when AI SDK used (Phase 1+).
  - Notes: Implemented 2026-02-17. Minimal OTel for Vercel; Langfuse optional.

---

## 2.5 Frontend / UI Layer

### Dashboard Shell

- [x] **`app/(dashboard)/layout.tsx` — Authenticated dashboard layout** — M
  - Sidebar: `RepositorySwitcher` (top — repo/scope navigation), `DashboardNav` (Repos, Search disabled, Settings), `UserProfileMenu` (bottom — identity/account switching)
  - `RepositorySwitcher` (top-left): Popover with Command-based search. Shows active repo or "All Repositories". Lists repos from `GET /api/repos` (filtered by `activeOrgId`). Status dots. "Add missing repository" → GitHub App install. Active repo derived from URL.
  - `UserProfileMenu` (bottom-left): avatar + context label → DropdownMenu: email header, Personal/Org account switcher, Settings/Help, Upgrade, dark/light toggle (next-themes), Sign Out
  - `DashboardAccountProvider`: wraps dashboard with `AccountProvider` so org hooks only run when authenticated
  - `AccountProvider`: global context (Personal vs Org), persisted via Better Auth `setActive`
  - `ThemeProvider` (next-themes): `defaultTheme="dark"`, `attribute="class"`, wired into root `<Providers>`
  - **Design principle:** Identity = bottom-left (UserProfileMenu). Resource = top-left (RepositorySwitcher). Active repo is URL-driven.
  - Uses design system: `bg-background`, `glass-panel`, `font-grotesk`, `bg-rail-fade` avatars
  - **Test:** Manual/E2E: log in → sidebar with repo switcher + nav + profile menu. Switch repos, switch identity, toggle theme, sign out.
  - **Files:** `app/(dashboard)/layout.tsx`, `components/dashboard/repository-switcher.tsx`, `components/dashboard/dashboard-nav.tsx`, `components/dashboard/user-profile-menu.tsx`, `components/dashboard/dashboard-account-provider.tsx`, `components/providers/account-context.tsx`
  - Notes: Implemented 2026-02-17. Updated 2026-02-18: RepositorySwitcher (top-left) + UserProfileMenu (bottom-left). Decoupled identity from resource context. Auto-provisioned org on signup removes welcome screen.

- [x] **`app/(dashboard)/page.tsx` — Dashboard home (repos list)** — M
  - Server component: fetches repos for active org via relational store; empty state when zero repos
  - **Test:** Zero repos → empty state; CTA disabled with tooltip.
  - Notes: Implemented 2026-02-17.

- [x] **Empty state component** — S
  - `components/dashboard/empty-state-repos.tsx`: icon (Lucide), "No repositories connected", CTA disabled with Tooltip "GitHub integration coming soon"
  - **Test:** Manual; tooltip on hover, button not clickable.
  - Notes: Implemented 2026-02-17.

- [x] **`app/(dashboard)/repos/page.tsx` — Repository management page** — S
  - List repos for active org; same empty state as dashboard home
  - **Test:** /repos shows empty state.
  - Notes: Implemented 2026-02-17.

- [x] **`app/(dashboard)/settings/page.tsx` — Org settings** — M
  - Org name, members (read-only from Better Auth), danger zone (placeholder)
  - **Test:** Org name and member list visible.
  - Notes: Implemented 2026-02-17.

### Onboarding / Organization Auto-Provisioning

- [x] **Auto-create personal organization on signup** — M
  - Every new user gets a personal organization (`"{name}'s workspace"`) immediately on signup via Better Auth `databaseHooks.user.create.after` in `lib/auth/auth.ts`.
  - The hook inserts directly into `organization` + `member` tables (pg Pool) using Better Auth's `generateId()`. Role: `owner`.
  - No welcome screen, no manual org creation step. Users land directly on the dashboard with their auto-provisioned org.
  - `app/onboarding/page.tsx` exists as a legacy fallback — redirects to `/` if user already has an org.
  - **Removed files:** `components/dashboard/empty-state-no-org.tsx`, `components/dashboard/create-workspace-first-banner.tsx`, `app/actions/create-workspace.ts` (all obsolete).
  - **Files:** `lib/auth/auth.ts` (databaseHooks), `app/(dashboard)/page.tsx` (simplified — no EmptyStateNoOrg)
  - **Test:** E2E: new user → signup → dashboard (org auto-provisioned, empty-state-repos shown).
  - Notes: Implemented 2026-02-17 (welcome screen). Refactored 2026-02-18: auto-provisioned org on signup, welcome screen removed.

---

## 2.6 Testing & Verification

**Testing plan:** This section is the Phase 0 testing plan. Unit, integration, and E2E test _cases_ are largely deferred to Phase 1; the _frameworks_ are installed and configured as below.

### Testing frameworks installed & configured (Phase 0)

| Framework | Purpose | Config / entrypoint | Scripts | Status |
|-----------|---------|--------------------|---------|--------|
| **Vitest** | Unit & integration tests | `vitest.config.ts` (jsdom, `vitest.setup.ts`, include `**/*.test.{ts,tsx}`, exclude e2e/.next) | `pnpm test`, `test:watch`, `test:ui`, `test:coverage` | Installed & configured |
| **Playwright** | E2E tests | `playwright.config.ts` (baseURL, webServer, testDir `./e2e`) | `pnpm e2e:headless`, `pnpm e2e:ui` | Installed & configured |
| **Testing Library** | React component tests | Used in Vitest via `@testing-library/react`, `@testing-library/jest-dom` (in `vitest.setup.ts`) | Via `pnpm test` | Installed & configured |

- **Vitest:** `vitest.config.ts` uses Vite path resolution (`vite-tsconfig-paths`), React plugin, jsdom environment. Existing tests: `app/api/__tests__/health.test.ts`, `app/api/__tests__/notifications.test.ts`, `app/api/__tests__/api-keys.test.ts`, `components/Button/Button.test.tsx`.
- **Playwright:** One-time browser install: `pnpm exec playwright install` (or `--with-deps chromium`). Example spec: `e2e/example.spec.ts`. For CI/Docker, add `pnpm exec playwright install` where E2E runs.

### Unit Tests

- [ ] **Port interface compliance tests** — M
  - For each of the 11 ports: verify production adapter AND test fake both satisfy the TypeScript interface
  - **Test:** `pnpm test lib/di/` — all 22 checks pass (11 adapters + 11 fakes).
  - Notes: Deferred to Phase 1. TypeScript compile + manual verification used in Phase 0.

- [ ] **DI container factory tests** — S
  - `createProductionContainer()` / `createTestContainer()` return all 11 keys; overrides work.
  - **Test:** `pnpm test lib/di/container.test.ts`
  - Notes: Deferred to Phase 1.

- [ ] **Domain function tests (pure logic, zero deps)** — S
  - `entity-hashing.ts`, `rule-resolution.ts` (minimal in Phase 0)
  - **Test:** `pnpm test lib/domain/`
  - Notes: Deferred to Phase 1.

### Integration Tests

- [ ] **ArangoDB connection + tenant isolation** — M
  - Bootstrap schema; insert/query with org_id; verify isolation.
  - **Test:** `pnpm test lib/adapters/arango-graph-store.test.ts` (requires Docker)
  - Notes: Deferred to Phase 1.

- [ ] **Temporal connection + queue registration** — M
  - Connect to Temporal; verify queues; no-op workflow.
  - **Test:** `pnpm test lib/adapters/temporal-workflow-engine.test.ts` (requires Docker)
  - Notes: Deferred to Phase 1.

- [x] **Health check integration** — S
  - Response shape and 503 when Supabase down.
  - **Test:** `pnpm test app/api/health/` (route.test.ts)
  - Notes: Implemented 2026-02-17.

### E2E Tests (Playwright)

- [ ] **Full signup → dashboard flow** — L
  - Register → verify email → dashboard (org auto-provisioned) → Connect GitHub → repos imported.
  - **Test:** `pnpm e2e:headless`
  - Notes: Deferred to Phase 1. Manual flow verified.

- [ ] **Returning user → dashboard** — S
  - Login → dashboard, nav (Repos, Settings).
  - **Test:** `pnpm e2e:headless`
  - Notes: Deferred to Phase 1.

- [ ] **Org settings page** — S
  - Settings → org name, member list.
  - **Test:** `pnpm e2e:headless`
  - Notes: Deferred to Phase 1.

### Phase 0 verification & tech stack alignment

**Completeness verification (2026-02-17):** Phase 0 is implemented per this tracker and per VERTICAL_SLICING_PLAN.md Phase 0 "What ships". All feature deliverables (auth + org creation + onboarding, empty dashboard shell, 11 ports, 5 working + 6 stub adapters, DI container, health checks, proxy email verification, Temporal workers, instrumentation) are in place. **Testing plan:** §2.6 Testing & Verification. **Testing frameworks:** Vitest and Playwright are installed and configured (see "Testing frameworks installed & configured" above); E2E framework setup item is marked complete. The only items left unchecked are **port/DI/domain unit tests**, **ArangoDB/Temporal integration tests**, and **E2E flow specs** — all explicitly deferred to Phase 1 with manual/compile verification used for Phase 0.

Implementation uses the **Temporal TypeScript SDK** (not Python); Temporal platform concepts (determinism, versioning, retries) apply and align with [Temporal TypeScript developer guide](https://docs.temporal.io/develop/typescript/). Gemini is not used in Phase 0 and is planned for later phases.

Tech stack alignment with referenced platforms:

| Stack | Phase 0 usage | Alignment |
|-------|----------------|-----------|
| **Temporal** | TypeScript SDK (`@temporalio/client`, `@temporalio/worker`); workers for `heavy-compute-queue` and `light-llm-queue`; health check | Same concepts as Temporal docs (determinism, versioning, retries); implementation is Node/TS, not Python. |
| **ArangoDB** | `arangojs`; `bootstrapGraphSchema()` creates DB, document/edge collections, persistent index `[org_id, repo_id]`; tenant isolation | Aligns with ArangoDB multi-doc/edge model and indexing. |
| **Supabase** | PostgreSQL via Prisma (repos, deletion_logs); Better Auth uses same DB for user/session/org | Prisma 7 + Supabase; no RLS on app tables in Phase 0. |
| **Better Auth** | Session, `listOrganizations`, `organization.create`, `emailVerified` in proxy | Session from headers; org plugin; email verification redirect. |
| **Prisma** | Prisma 7; `prisma.config.ts` for `SUPABASE_DB_URL`; migrations for repos + deletion_logs | No `url` in schema; config-only datasource. |
| **Redis** | `ioredis` via `lib/queue/redis.ts`; `RedisCacheStore` adapter (get/set/invalidate/rateLimit/health) | Single client, lazyConnect; health via PING. |
| **Langfuse** | `IObservability` adapter; health reports up/down/unconfigured; no SDK/OTel in Phase 0 | Optional; full tracing when AI SDK used (Phase 1+). |
| **Vercel** | Next.js 16, `registerOTel("next-app")` in instrumentation | Vercel OTel; deployment patterns per Vercel docs. |
| **Gemini** | Not used in Phase 0 | Planned for LLM provider in later phases. |

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
  5 working adapters + 6 stubs           │
  11 test fakes                           │
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
  Welcome screen                         │
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
| 2026-02-17 | — | **Phase 0 implementation complete.** Infrastructure: ArangoDB, Temporal workers, .env.example, worker scripts. Database: Prisma (repos, deletion_logs), ArangoDB bootstrap. Ports: 11 interfaces + types. Adapters: 5 working (Arango, Prisma, Temporal, Redis, Langfuse) + 6 stubs; DI container + fakes. Backend: health expansion, create-org use case, proxy email verification, worker entry points. Frontend: (dashboard) layout, dashboard home + empty state, repos/settings, Phase 0 onboarding (org creation). Tracker items updated to [x] with notes. |
| 2026-02-17 | — | **Tracker full pass.** All §2.3–§2.6 implemented items marked [x]. Testing: health integration [x]; port/DI/domain, ArangoDB/Temporal integration, E2E deferred to Phase 1. Added "Phase 0 verification & tech stack alignment" table (Temporal TS, ArangoDB, Supabase, Better Auth, Prisma, Redis, Langfuse, Vercel, Gemini). |
| 2026-02-17 | — | **Phase 0 verification.** Confirmed implementation complete per PHASE_0_DEEP_DIVE_AND_TRACKER and VERTICAL_SLICING_PLAN Phase 0. All "What ships" deliverables present; remaining [ ] items are deferred (tests) or optional (Playwright). Noted Temporal TypeScript SDK (not Python); Gemini reserved for later phases. |
| 2026-02-17 | — | **Supabase schema `kap10`.** Switched from table prefix to PostgreSQL schema: all kap10 tables live in schema `kap10` (multi-app same Supabase project). Prisma: `schemas = ["public", "kap10"]`, `@@schema("kap10")` on models/enums; `@@map("repos")`, `@@map("deletion_logs")`. Migration moves tables and enums into `kap10`. Rule and rationale in VERTICAL_SLICING_PLAN.md and PHASE_0_DEEP_DIVE_AND_TRACKER.md. |
| 2026-02-17 | — | **Schema approach documented everywhere.** Updated README, CLAUDE.md, .cursorrules, RULESETS.md, VERTICAL_SLICING_PLAN (§ mandatory "from now on" schema convention). All new kap10 tables MUST use schema `kap10`. Removed docs/architecture/README.md; convention lives in VERTICAL_SLICING_PLAN § Storage & Infrastructure Split and Phase 0 doc references it. |
| 2026-02-17 | — | **Testing plan & frameworks verification.** Confirmed §2.6 is the Phase 0 testing plan. Vitest and Playwright are installed and configured (vitest.config.ts, playwright.config.ts, scripts, vitest.setup.ts, e2e/example.spec.ts). Marked "E2E Test Framework Setup" [x] with implementation notes. Added "Testing frameworks installed & configured" table and summary under §2.6. Updated completeness verification to state testing plan and frameworks are in place; only port/DI/domain unit tests, ArangoDB/Temporal integration tests, and E2E flow specs remain deferred to Phase 1. |
| 2026-02-18 | — | **UserProfileMenu & AccountContext.** Replaced static user info in sidebar footer with Claude-style `UserProfileMenu` (Radix DropdownMenu). Sections: email header, Personal/Org account switcher (with check marks), Settings/Help, Upgrade Plan (electric-cyan), dark/light theme toggle, Sign Out. Added `AccountProvider` (global Personal-vs-Org context, persisted to `localStorage`). Added `ThemeProvider` (next-themes, `defaultTheme="dark"`). Wired into root `<Providers>` tree. Updated Flow 2 (onboarding wizard → welcome screen), Flow 3 (returning user — UserProfileMenu in sidebar). Updated §2.5 dashboard shell tracker item and onboarding section. |
| 2026-02-18 | — | **Auto-provisioned org on signup + RepositorySwitcher + strict GitHub callback.** (1) Added `databaseHooks.user.create.after` to Better Auth config — auto-creates personal org + member on signup via raw SQL (pg Pool + `generateId()`). (2) Added `RepositorySwitcher` (top-left sidebar) — Command-based repo search/switch, decoupled from identity (UserProfileMenu bottom-left). Active repo is URL-driven. (3) GitHub callback refactored: no org creation, strictly requires `orgId` in state, calls `setActiveOrganization`. (4) Removed welcome screen: `EmptyStateNoOrg`, `CreateWorkspaceFirstBanner`, `create-workspace.ts` deleted. Dashboard shows `EmptyStateRepos` directly. (5) Added `setActiveOrganization()` server helper to `lib/auth`. (6) `DashboardNav` Repos link highlights on `/repos/*` subpages. |
