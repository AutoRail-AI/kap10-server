# Phase 0 — Foundation Wiring: Deep Dive & Implementation Tracker

> **Phase Feature Statement:** _"I can sign up and create an organization, then connect GitHub repos or start without GitHub. I see a dashboard where I can manage repositories."_
>
> **Source:** [`VERTICAL_SLICING_PLAN.md`](./VERTICAL_SLICING_PLAN.md) — Phase 0
>
> **Note (post–Phase 1, updated 2026-02-18):** A personal organization is **auto-provisioned on signup** via Better Auth `databaseHooks.user.create.after` (direct SQL insert into `organization` + `member` tables). Every user has at least one org from their first login — no welcome screen needed. The GitHub callback **strictly requires** an `orgId` in the state payload and never creates organizations. The old "Start without GitHub" / "Connect GitHub" welcome screen (`EmptyStateNoOrg`, `CreateWorkspaceFirstBanner`, `create-workspace.ts`) has been removed. See [PHASE_1_GITHUB_CONNECT_AND_INDEXING.md § Post-signup & organization provisioning](./PHASE_1_GITHUB_CONNECT_AND_INDEXING.md#post-signup--organization-provisioning).
>
> **Database convention:** All unerr Supabase tables use PostgreSQL schema `unerr`. See [VERTICAL_SLICING_PLAN.md § Storage & Infrastructure Split](./VERTICAL_SLICING_PLAN.md#storage--infrastructure-split) for the full rule.

---

## Table of Contents

- [Part 1: Architectural Deep Dive](#part-1-architectural-deep-dive)
  - [1.1 Core User Flows](#11-core-user-flows)
  - [1.2 System Logic & State Management](#12-system-logic--state-management)
  - [1.3 Reliability & Resilience](#13-reliability--resilience)
  - [1.4 Performance Considerations](#14-performance-considerations)
  - [1.5 Phase Bridge → Phase 1](#15-phase-bridge--phase-1)
- [Part 2: Remaining Tasks](#part-2-remaining-tasks)

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

**Email verification enforcement — Strategy A (implemented):** `proxy.ts` calls `auth.api.getSession()` which returns `session.user.emailVerified`. If `false` and the path is not in `publicPaths`, the request is redirected to `/verify-email`. The `cookieCache` (5 minutes in `auth.ts`) prevents this session lookup from becoming a per-request DB query. OAuth exemption: if `listUserAccounts()` finds a Google or GitHub provider account, the redirect does not apply — OAuth providers already verify email. The exemption is implemented in `proxy.ts` with a `hasOAuthAccount` check after the `emailVerified === false` condition.

**Public paths (no auth required):** `/login`, `/register`, `/verify-email`, `/api/auth`, `/api/webhooks`, `/api/health`, `/api/cli`.

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
                                  orgId validated against user's orgs →                      row created (no repos)
                                  setActiveOrganization → installation saved →
                                  redirect to /?connected=true
4     Add Repository             Click "Add Repository" → repo picker modal →             Supabase: repo rows created
                                  select repos → choose branches →                          per user selection
                                  POST /api/repos → indexing started
```

**Important — unerr organization ≠ GitHub organization:** "Organization" in unerr is the account-level tenant, created at signup from the **user's name** (`"{name}'s organization"`). It has no relationship to any GitHub account or organization name. GitHub accounts/orgs connect to a unerr org as **installations** (stored in `unerr.github_installations` with `accountLogin` for the GitHub name). One unerr org can have multiple GitHub connections. See [PHASE_1 § Terminology](./PHASE_1_GITHUB_CONNECT_AND_INDEXING.md#terminology-organization-workspace-and-github-disambiguation) for the full disambiguation.

A personal organization is **auto-provisioned on signup** via Better Auth `databaseHooks.user.create.after` — direct INSERT into `organization` + `member` tables using Better Auth's `generateId()`. The hook retries with a randomized slug on slug conflict. No welcome screen or manual org creation step is needed.

**Two user scenarios:**

| Scenario | Path | Outcome |
|----------|------|---------||
| **User has GitHub repos** | Dashboard → Connect GitHub → install App → callback → "Add Repository" → select repos → choose branch per repo → Connect & Index | GitHub installation attached to auto-provisioned organization. Repos are **not** auto-imported — user selects which repos to add via the repo picker modal. |
| **Local-only / code not on GitHub yet** | Dashboard | User sees empty-state-repos with "Connect GitHub" CTA for later. |

**Key nuance — ArangoDB org bootstrap:**

ArangoDB bootstrap (`createOrgUseCase()`) is triggered on first repo connect or via `/api/org/bootstrap`. The signup hook only creates the Better Auth org + member records (no ArangoDB dependency). This ensures signup never fails due to ArangoDB downtime. The bootstrap is global (not per-org): `bootstrapGraphSchema()` creates the shared collections and indexes once for the database; it does not create per-org collections. Tenant isolation is provided by the `org_id` field on every document, backed by a persistent compound index `[org_id, repo_id]`.

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
                                  organization") → DropdownMenu with sections:             updated on org switch
                                  Organization switcher, Settings, Help,
                                  Upgrade, Theme toggle, Sign Out
4     Navigate to Settings        /settings → org settings page (name, members, danger)    None
5     Navigate to Repos           /repos → same repos list as dashboard home               None
6     Click "Connect GitHub"      GET /api/github/install → redirect to GitHub             Redis: state token
```

**UserProfileMenu:** Provides organization switching (persisted via Better Auth `setActive`), dark/light mode toggle (via `next-themes`), navigation to Settings, sign out, and placeholder items for Help & Support and Upgrade Plan. No "personal" context exists; users always have an active organization. `AccountProvider` self-heals by auto-activating the first org if none is active. `activeOrgId` is always `string` (never null); server pages throw errors instead of silently redirecting when no org is found.

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

### Phase 0 Schema — Prisma-Managed Tables

All unerr-managed Supabase tables live in PostgreSQL schema **`unerr`** (multi-app same project). Better Auth tables (`user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`) remain in `public` and are NOT managed by Prisma. The schema for the two Phase 0 tables:

```
Table: repos (@@schema("unerr"), @@map("repos"))
  ├── id              UUID (PK, default uuid)
  ├── organization_id VARCHAR (FK → organization.id)
  ├── name            VARCHAR
  ├── full_name       VARCHAR (e.g., "org/repo-name")
  ├── provider        ENUM ("github", "local_cli")
  ├── provider_id     VARCHAR              -- GitHub repo ID
  ├── status          ENUM ("pending", "indexing", "ready", "error", "deleting",
  │                         "justifying", "justify_failed")
  ├── default_branch  VARCHAR (default "main")
  ├── last_indexed_at TIMESTAMPTZ (nullable)
  ├── created_at      TIMESTAMPTZ (default now)
  └── updated_at      TIMESTAMPTZ (auto-update)
  UNIQUE: (organization_id, provider, provider_id)
  INDEX: (organization_id)

Table: deletion_logs (@@schema("unerr"), @@map("deletion_logs"))
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
  INDEX: (status)
```

**Note:** The `repos` table has accumulated several additional fields beyond Phase 0 scope as later phases were implemented: `webhookSecret`, `incrementalEnabled` (Phase 5), `localCliUploadPath`, `ephemeral`, `ephemeralExpiresAt` (Phase 5.5/5.6), reindexing state fields, and relations to `Workspace` and `GraphSnapshotMeta`. The Prisma schema is the authoritative source for the current full table structure.

**Prisma + Better Auth coexistence strategy:**

1. Better Auth tables: NOT included in Prisma schema for migration purposes.
2. App tables (repos, deletion_logs, etc.): Fully managed by Prisma / `supabase/migrations/`.
3. `prisma.config.ts` loads `.env.local` first, then `.env`, and appends `search_path=unerr,public` to the DB URL (required Prisma 7 workaround — Prisma ignores the `schemas` config during queries without an explicit `search_path`).
4. Prisma is used solely as an ORM (`prisma generate`); there is no `prisma/migrations/` directory. All DDL lives in `supabase/migrations/`.

### DI Container Initialization

The DI container is the single source of truth for all adapters. It is initialized lazily once per process lifecycle via `getContainer()`.

```
Process Start (Next.js server / Temporal worker)
    │
    ├── instrumentation.ts runs (registerOTel("next-app") — Vercel OTel only)
    │
    └── Container initialization (lazy, on first use via getContainer())
          └── createLazyProductionContainer()
                Adapters are loaded via require() on first property access:
                ├── ArangoGraphStore        → IGraphStore
                ├── PrismaRelationalStore   → IRelationalStore
                ├── BedrockProvider         → ILLMProvider  (AWS Bedrock via Vercel AI SDK)
                ├── TemporalWorkflowEngine  → IWorkflowEngine
                ├── GitHubHost              → IGitHost       (Octokit + simple-git)
                ├── LlamaIndexVectorSearch  → IVectorSearch
                ├── StripePayments          → IBillingProvider
                ├── LangfuseObservability   → IObservability
                ├── RedisCacheStore         → ICacheStore
                ├── SCIPCodeIntelligence    → ICodeIntelligence
                ├── SemgrepPatternEngine    → IPatternEngine
                └── SupabaseStorageAdapter  → IStorageProvider  (12th port)
```

**12 ports, all implemented.** The container grew to 12 ports during Phase 0 implementation with the early addition of `IStorageProvider` (backing the CLI-based local repo upload path via Supabase Storage pre-signed URLs).

**Use cases are plain functions** that receive the container (or specific ports) as arguments — no class instantiation ceremony, maximally testable:

```
FUNCTION createOrgUseCase(container, { organizationId, name }):
    TRY:
        container.graphStore.bootstrapGraphSchema()  -- global, idempotent
        RETURN { organizationId, name, arangoBootstrapped: true }
    CATCH error:
        LOG "[createOrgUseCase] ArangoDB bootstrap failed:" error.message
        -- Org already created in Supabase; Phase 1 re-bootstraps on first repo connect
        RETURN { organizationId, name, arangoBootstrapped: false }
```

**How API routes access the container:**

```
HANDLER GET /api/repos:
    container = getContainer()
    repos = await container.relationalStore.getRepos(orgId)
    RETURN repos
```

---

## 1.3 Reliability & Resilience

Phase 0 establishes foundational connections to four external systems: Supabase, ArangoDB, Temporal, and Redis. Each can fail independently.

### Connection Failure Matrix

| System | Failure Mode | Impact if Down | Phase 0 Recovery Strategy | Acceptable Downtime |
|--------|-------------|----------------|---------------------------|---------------------|
| **Supabase** | Connection refused, timeout, pool exhaustion | Auth broken, no user/org data, app unusable | Lazy proxy pattern (already in `supabase.ts`). Fail-open on health check. Retry with exponential backoff (pg Pool default: 3 retries). **No fallback** — Supabase is the critical path. | 0 (hard dependency) |
| **ArangoDB** | Connection refused, auth failure, OOM | Graph operations fail, but in Phase 0 no graph operations occur in user flows | Lazy initialization. Health check returns `degraded` (not `unhealthy`) if ArangoDB is down in Phase 0 because no user-facing feature depends on it yet. | Phase 0: tolerable. Phase 1+: 0 |
| **Temporal** | Server unreachable, namespace not found | Workflow execution fails, but in Phase 0 no workflows are triggered | Same as ArangoDB. Health check returns `degraded`. Workers log warning and retry connection every 30s. | Phase 0: tolerable. Phase 1+: 0 |
| **Redis** | Connection refused, timeout | Session cache fails (falls back to DB), rate limiting disabled | ioredis `lazyConnect: true` + `enableOfflineQueue: false`. If Redis is down, the app continues but sessions hit Supabase on every request (performance degradation, not failure). | Degraded (perf hit only) |

### Health Check Endpoint — Implemented Design

`GET /api/health` checks all five systems in parallel using `Promise.allSettled()`. Each check has a 2-second timeout; the total health budget is 5 seconds. if the total check exceeds 5 seconds, a warning is logged (no failure).

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
  ELSE IF arangodb.down OR temporal.down OR redis.down → status = "degraded" (HTTP 200)
  ELSE → status = "healthy" (HTTP 200)
  Note: langfuse.status = "unconfigured" is treated as healthy for overall status.
  Note: langfuse.status = "down" does NOT count as "any other down" — it is optional.
```

Implementation uses `withTimeout()` helper that races a check against a 2-second rejection and falls back to `{ status: "down" }` on timeout or error.

### Graceful Degradation Rules

| Scenario | User-Visible Behavior | System Behavior |
|----------|----------------------|-----------------||
| ArangoDB down during org creation | Org created in Supabase successfully. ArangoDB bootstrap fails silently. | Log error. Return success from use case. Phase 1 will re-bootstrap on first repo connect. |
| Redis down | App works normally but slower. Session checks hit Supabase directly. | Log warning. Disable rate limiting (fail-open). |
| Temporal down | No user impact in Phase 0. | Log warning. Workers will reconnect automatically when Temporal comes back. |
| Supabase down | 503 on all protected routes. Login/register fail. | Health check returns "unhealthy". Alert fires. No fallback possible. |

### Adapter Error Handling Contract

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
| `GET /api/health` | < 2000ms | 5 parallel checks (max 2s each) | ArangoDB cold connection. First health check after deploy may be slow. |

### Connection Pool Sizing

| System | Pool Size | Rationale |
|--------|----------|-----------||
| Supabase (pg Pool) | 10 connections | Next.js in dev runs a single process. In production (serverless), each Lambda gets its own pool — keep small to avoid exhausting Supabase's connection limit (default: 60 for free tier, 200 for pro). |
| ArangoDB | 5 connections | Phase 0 has no graph queries. Phase 1+ will need more. Start conservative. |
| Redis (ioredis) | 1 connection (multiplexed) | ioredis uses a single TCP connection with command pipelining. No pool needed. |
| Temporal | 1 client connection | Temporal client is lightweight — one connection per process is sufficient. |

### Cold Start Mitigation

In serverless deployments (Vercel), every Lambda invocation may cold-start. The DI container uses lazy proxies — no eager connections. First request pays connection cost (~200ms for Supabase, ~100ms for ArangoDB). Subsequent requests reuse connections (Lambda is warm for ~5 minutes). Health check is NOT a good warm-up target (it eagerly connects all systems).

For Temporal workers (long-running processes, not serverless): workers connect eagerly on startup, retry with exponential backoff (Temporal SDK handles this), no cold-start concern.

### Memory Considerations for Docker Compose

> **Observed (2026-02-17):** Temporal server uses ~227 MB, Temporal UI uses ~30 MB, PostgreSQL (local persistence) is also running.

| Service | Memory Limit | Notes |
|---------|-------------|-------|
| `app` | — (runs outside Docker in dev) | Next.js dev server with Turbopack; Docker `app` profile available |
| `temporal` | — (no explicit limit) | `temporalio/auto-setup:1.24.2`, ~227 MB observed; backed by local PostgreSQL |
| `temporal-ui` | — (no explicit limit) | `temporalio/ui:2.31.2`, ~30 MB observed |
| `postgresql` | — (no explicit limit) | `pgvector/pgvector:pg13` — local PostgreSQL for Temporal persistence only |
| `temporal-worker-heavy` | 8 GB | Separate `Dockerfile.heavy-worker`; needs headroom for SCIP indexing |
| `temporal-worker-light` | 4 GB | Separate `Dockerfile.light-worker`; needs headroom for embedding batches |
| `tei` | 2 GB | `ghcr.io/huggingface/text-embeddings-inference:cpu-latest`; nomic-embed-text-v1.5 |
| `tei-reranker` | 2 GB | Same TEI image; BAAI/bge-reranker-v2-m3 cross-encoder for search reranking |
| `arangodb` | — (no explicit limit) | `arangodb/arangodb:3.12`; RocksDB engine needs memory for write buffers |
| `redis` | — (no explicit limit) | `redis:7-alpine`; minimal data in Phase 0 |
| `mcp-server` | 512 MB | Phase 2 MCP HTTP server on port 8787 |

**Worker networking:** Both temporal workers use `network_mode: host` so they can reach cloud Supabase and ArangoDB directly without Docker DNS resolution failures. `TEMPORAL_ADDRESS=localhost:7233` (not `temporal:7233`) is used as a result.

---

## 1.5 Phase Bridge → Phase 1

Phase 1's feature is: _"I connect my GitHub account, select a repo, and unerr indexes it."_

Everything Phase 0 builds must support Phase 1 without refactoring. Here's the explicit contract:

### What Phase 1 Inherits

| Phase 0 Artifact | Phase 1 Usage |
|------------------|--------------||
| `IGraphStore` port + `ArangoGraphStore` adapter | Phase 1 calls `bulkUpsertEntities()` and `bulkUpsertEdges()` to write SCIP output |
| `IWorkflowEngine` port + `TemporalWorkflowEngine` adapter | Phase 1 starts `indexRepoWorkflow` via `workflowEngine.startWorkflow()` |
| `IGitHost` port + `GitHubHost` adapter | Phase 1 calls `cloneRepo()` and `listFiles()` |
| `ICodeIntelligence` port + `SCIPCodeIntelligence` adapter | Phase 1 Temporal activities call `indexWorkspaceFull()` |
| `heavy-compute-queue` Temporal worker | Phase 1 runs `prepareRepoIntelligenceSpace` and `runSCIP` activities on this queue |
| `light-llm-queue` Temporal worker | Phase 1 runs `writeToArango` activity on this queue |
| `repos` Prisma table | Phase 1 writes repo records with `status: "indexing"` → `"ready"` |
| Dashboard shell with empty state | Phase 1 replaces empty state with repo cards showing indexing progress |
| `createTestContainer()` | Phase 1 tests use `InMemoryGraphStore` and `FakeGitHost` for unit tests |
| Docker Compose with ArangoDB + Temporal | Phase 1 developers run the full stack locally |

### What Phase 0 Must NOT Do

1. **Do NOT hard-code any adapter.** Every external call goes through the container.
2. **Do NOT create ArangoDB collections dynamically per-org.** The multi-tenancy model is pool-based (single `unerr_db`, `org_id` on every document). Creating the collections is a one-time global operation.
3. **Do NOT put org creation logic in the API route handler.** Extract it into a use case (`createOrgUseCase`) that takes the container as a dependency.
4. **Migrations live in `supabase/migrations/` only.** Prisma is used solely as an ORM (`prisma generate`); there is no `prisma/migrations/` directory.
5. **Do NOT couple the dashboard layout to "zero repos" state.** The layout must work identically with 0, 1, or 100 repos.

---

# Part 2: Architecture — Implementation

## 2.1 Infrastructure Layer

### Docker Compose

The `docker-compose.yml` defines the following services:

**Always-started infrastructure (no profile required):**

| Service | Image | Port | Volume | Health Check |
|---------|-------|------|--------|-------------|
| `redis` | `redis:7-alpine` | 6379 | `redis_data:/data` | `redis-cli ping` |
| `arangodb` | `arangodb/arangodb:3.12` | 8529 | `arangodb_data` | `arangosh db._version()` |
| `postgresql` | `pgvector/pgvector:pg13` | 5432 | `postgresql_data` | `pg_isready -U postgres` |
| `temporal` | `temporalio/auto-setup:1.24.2` | 7233 | — | `nc -z temporal 7233` |
| `temporal-ui` | `temporalio/ui:2.31.2` | 8080 | — | — |

**Profile `app` or `worker` (explicit start required):**

| Service | Image / Dockerfile | Port | Memory | Notes |
|---------|-------------------|------|--------|-------|
| `tei` | `ghcr.io/huggingface/text-embeddings-inference:cpu-latest` | 8090 | 2 GB | nomic-embed-text-v1.5 |
| `tei-reranker` | Same TEI image | 8091 | 2 GB | BAAI/bge-reranker-v2-m3 |
| `temporal-worker-heavy` | `Dockerfile.heavy-worker` | — | 8 GB | `network_mode: host`; `NODE_OPTIONS=--max-old-space-size=6144` |
| `temporal-worker-light` | `Dockerfile.light-worker` | — | 4 GB | `network_mode: host`; `NODE_OPTIONS=--max-old-space-size=4096`; `TEI_URL=http://localhost:8090` |

**Profile `app` only:**

| Service | Dockerfile | Port | Memory | Notes |
|---------|-----------|------|--------|-------|
| `app` | `Dockerfile` | 3000 | — | Hot reload via `WATCHPACK_POLLING=true` |

**Profile `app` or `mcp`:**

| Service | Dockerfile | Port | Memory | Health Check |
|---------|-----------|------|--------|-------------|
| `mcp-server` | `Dockerfile.mcp-server` | 8787 | 512 MB | `fetch http://localhost:8787/health` |

Redis persistence: AOF enabled (`redis-server --appendonly yes`). ArangoDB health check uses `arangosh` with the `ARANGO_ROOT_PASSWORD` env var. Temporal depends on `postgresql` (condition: `service_healthy`) before starting.

### Package Scripts

`package.json` scripts for Temporal workers:
- `pnpm temporal:worker:heavy` — starts `scripts/temporal-worker-heavy.ts` via `tsx` with exponential backoff (1s→60s)
- `pnpm temporal:worker:light` — starts `scripts/temporal-worker-light.ts` with the same retry behavior

### E2E Test Framework

Playwright is installed as a devDependency. `playwright.config.ts` has `baseURL: "http://127.0.0.1:3000"` and `webServer: { command: "pnpm dev", url: "http://127.0.0.1:3000", reuseExistingServer: !process.env.CI }`. Run `pnpm exec playwright install` (or `--with-deps chromium`) once per environment.

---

## 2.2 Database & Schema Layer

### Prisma Setup

Prisma 7 is initialized with `prisma/schema.prisma` (`provider = "postgresql"`). The datasource URL is configured in `prisma.config.ts` via the `SUPABASE_DB_URL` environment variable. `prisma.config.ts` loads `.env.local` first then `.env`; it appends `search_path=unerr,public` to the DB URL to work around a Prisma 7 bug where the `schemas` config setting is ignored during queries.

All unerr models use `@@schema("unerr")`. Prisma manages app-specific tables only; Better Auth tables remain in `public`. Both use the same Supabase PostgreSQL database.

Running `pnpm prisma generate` produces the Prisma Client. Schema changes are applied via SQL files under `supabase/migrations/` (via `scripts/migrate.ts`), not via Prisma's own migration system.

### ArangoDB Schema Bootstrap

`ArangoGraphStore.bootstrapGraphSchema()` in `lib/adapters/arango-graph-store.ts` does the following — idempotently, safe to call multiple times:

```
FUNCTION bootstrapGraphSchema():
    db = await getDbAsync()  -- creates DB "unerr_db" if missing
    FOR each collection in documentCollections:
        ["repos", "files", "functions", "classes", "interfaces",
         "variables", "patterns", "rules", "snippets", "ledger"]
        IF collection does not exist: db.createCollection(name)
    FOR each collection in edgeCollections (type 3):
        ["contains", "calls", "imports", "extends", "implements"]
        IF collection does not exist: db.createEdgeCollection(name)
    FOR each collection (doc + edge):
        ensure persistent index on [org_id, repo_id]
```

This runs on first org creation via `createOrgUseCase` → `/api/org/bootstrap`, not at app startup. ArangoDB downtime during org creation is tolerated — the use case logs the error and returns success (Phase 1 re-bootstraps on first repo connect).

---

## 2.3 Ports & Adapters Layer

### Port Interfaces (12 ports)

All 12 port interfaces are implemented in `lib/ports/`:

| Port file | Interface | Phase 0 role |
|-----------|-----------|-------------|
| `types.ts` | Domain types (`EntityDoc`, `EdgeDoc`, `OrgContext`, `TokenUsage`, etc.) | Shared by all ports |
| `graph-store.ts` | `IGraphStore` | `bootstrapGraphSchema()`, `healthCheck()` |
| `relational-store.ts` | `IRelationalStore` | `healthCheck()`, `getRepos()`, `createRepo()`, `getDeletionLogs()` |
| `llm-provider.ts` | `ILLMProvider` | `generateObject<T>()`, `streamText()`, `embed()` |
| `workflow-engine.ts` | `IWorkflowEngine` | `startWorkflow()`, `signalWorkflow()`, `getWorkflowStatus()`, `cancelWorkflow()`, `healthCheck()` |
| `git-host.ts` | `IGitHost` | `cloneRepo()`, `listFiles()`, `listBranches()`, plus PR/check/review methods |
| `vector-search.ts` | `IVectorSearch` | `embed()`, `search()`, `upsert()` |
| `billing-provider.ts` | `IBillingProvider` | `createCheckoutSession()`, `createSubscription()`, `cancelSubscription()`, `reportUsage()` |
| `observability.ts` | `IObservability` | `getOrgLLMCost()`, `getCostBreakdown()`, `getModelUsage()`, `healthCheck()` |
| `cache-store.ts` | `ICacheStore` | `get()`, `set()`, `setIfNotExists()`, `invalidate()`, `invalidateByPrefix()`, `rateLimit()`, `healthCheck()` |
| `code-intelligence.ts` | `ICodeIntelligence` | `indexWorkspace()`, `getDefinitions()`, `getReferences()` |
| `pattern-engine.ts` | `IPatternEngine` | `scanPatterns()`, `matchRule()` |
| `storage-provider.ts` | `IStorageProvider` | `generateUploadUrl()`, `downloadFile()`, `deleteFile()`, `healthCheck()` |

`IGitHost` was extended with `listBranches()` during Phase 1 work (two-step repo picker: select repos → choose branch per repo).

`ICacheStore` has two additional methods beyond the original design: `setIfNotExists()` (atomic set-if-absent for distributed locks and deduplication, using Redis `SET … NX`) and `invalidateByPrefix()` (cursor-based SCAN + multi-DEL — never uses the blocking `KEYS` command).

### Production Adapters

**Fully implemented adapters:**

| Adapter | Implements | Notes |
|---------|-----------|-------|
| `arango-graph-store.ts` | `IGraphStore` | `arangojs`; lazy `getDbAsync()` creates DB if missing; idempotent bootstrap; all methods implemented (Phase 1+ features) |
| `prisma-relational-store.ts` | `IRelationalStore` | `@prisma/client`; `healthCheck()` via `$queryRaw SELECT 1`; full CRUD for Phase 0–2 entities |
| `bedrock-provider.ts` | `ILLMProvider` | AWS Bedrock via `@ai-sdk/amazon-bedrock` (Vercel AI SDK); includes proactive sliding-window rate limiting (RPM/TPM via `RateLimiter`), exponential backoff with jitter for throttling errors, token budget pre-checks. Auth via `AWS_BEARER_TOKEN_BEDROCK` env var. `embed()` throws — embeddings handled by `LlamaIndexVectorSearch`. |
| `temporal-workflow-engine.ts` | `IWorkflowEngine` | `@temporalio/client`; lazy client via `getClient()`; all workflow operations implemented |
| `github-host.ts` | `IGitHost` | Octokit (GitHub App) + `simple-git`; `cloneRepo()`, `listFiles()`, `listBranches()`, `diffFiles()`, `getLatestSha()`, `blame()`, `getFileGitHistory()`, PR review methods, check run methods, issue commenting, branch creation, and file creation. `createWebhook()` is a no-op (App-level webhooks only). |
| `redis-cache-store.ts` | `ICacheStore` | `ioredis` via `lib/queue`; all methods implemented including `setIfNotExists()` and cursor-based `invalidateByPrefix()` |
| `langfuse-observability.ts` | `IObservability` | No external dep; reads `LANGFUSE_SECRET_KEY` + `LANGFUSE_PUBLIC_KEY`; if absent: healthCheck returns `unconfigured`, cost methods return 0/empty |
| `llamaindex-vector-search.ts` | `IVectorSearch` | `@llamaindex`; pgvector-backed; fully implemented for Phase 3 |
| `scip-code-intelligence.ts` | `ICodeIntelligence` | Full SCIP implementation using modular language plugin system (`lib/indexer/`); `indexWorkspace()` and `indexWorkspaceFull()` run SCIP indexers per language with Tree-sitter fallback for uncovered files; `getDefinitions()`/`getReferences()` return empty (Phase 2 shadow workspace, not yet implemented) |
| `semgrep-pattern-engine.ts` | `IPatternEngine` | Implemented for Phase 6; `scanPatterns()` and `matchRule()` |
| `stripe-payments.ts` | `IBillingProvider` | Stripe SDK; partially implemented for Phase 2 billing |
| `supabase-storage.ts` | `IStorageProvider` | Supabase Storage pre-signed URLs; `generateUploadUrl()`, `downloadFile()`, `deleteFile()`, `healthCheck()` |

**Test fakes** (`lib/di/fakes.ts`): `InMemoryGraphStore`, `InMemoryRelationalStore`, `MockLLMProvider`, `InlineWorkflowEngine`, `FakeGitHost`, `InMemoryVectorSearch`, `NoOpBillingProvider`, `InMemoryObservability`, `InMemoryCacheStore`, `FakeCodeIntelligence`, `FakePatternEngine`, `InMemoryStorageProvider`. All 12 fakes implement their respective port interfaces; all use Maps/arrays with no external dependencies.

### DI Container

`lib/di/container.ts` exports the `Container` interface (12 port fields), `getContainer()` (lazy singleton for production use), and `createTestContainer(overrides?)` (uses all 12 fakes with optional overrides). The production container uses `createLazyProductionContainer()` which loads infra adapters via `require()` on first property access — no infra modules (arangojs, `@temporalio/client`, ioredis) are loaded or connected at build/import time.

---

## 2.4 Backend / API Layer

### Health Check

`app/api/health/route.ts` — `GET /api/health`:
- Runs 5 parallel checks via `Promise.allSettled()`: Supabase (relationalStore), ArangoDB (graphStore), Temporal (workflowEngine), Redis (cacheStore), Langfuse (observability)
- Each check is wrapped in `withTimeout()` (2-second deadline); timeout → `{ status: "down" }`
- Response shape: `{ status, timestamp, checks }` — HTTP 503 only when Supabase is down
- Langfuse `unconfigured` does NOT count as `down` for overall `degraded` calculation

### Org Creation Use Case

`lib/use-cases/create-org.ts` exports `createOrgUseCase(container, { organizationId, name })`. It calls `container.graphStore.bootstrapGraphSchema()` (no per-org argument — bootstrap is global and idempotent). If ArangoDB is down, it logs and returns `{ arangoBootstrapped: false }` rather than throwing. The org is already persisted in Supabase by Better Auth at the time this use case runs.

The use case is invoked via `POST /api/org/bootstrap` (session required). The frontend calls this after Better Auth's `organization.create`. The auto-provisioned org on signup also triggers this path.

### Proxy — Email Verification Enforcement

`proxy.ts` (Next.js middleware export as `proxy`):

```
FOR every request NOT in publicPaths:
  IF no session cookie → redirect to /login
  IF session cookie AND path is /login or /register → redirect to /
  IF session cookie AND emailVerified === false:
    IF user has google or github OAuth account → allow through
    ELSE → redirect to /verify-email
  ALLOW through
```

`emailVerified` is read from `auth.api.getSession()`. `listUserAccounts()` is called only when `emailVerified === false` to check for OAuth accounts. Errors during session/accounts lookup are silently swallowed (`catch {}`) — request proceeds (fail-open for auth degradation).

Matcher pattern excludes `api/auth`, `api/webhooks`, `_next/static`, `_next/image`, and static files.

### Temporal Worker Entry Points

`scripts/temporal-worker-heavy.ts`: Connects to Temporal TypeScript SDK, registers `heavy-compute-queue`. Uses exponential backoff (1s→60s) on connection failure, retrying indefinitely.

`scripts/temporal-worker-light.ts`: Same pattern for `light-llm-queue`.

Both workers read `TEMPORAL_ADDRESS` from the environment (default `localhost:7233`). When running inside Docker containers, `TEMPORAL_ADDRESS=localhost:7233` is used due to `network_mode: host`.

### Langfuse / OpenTelemetry

`instrumentation.ts` calls `registerOTel("next-app")` (Vercel OTel). Full Langfuse span processor (OTel + Langfuse SDK) is deferred to when the AI SDK is actively used (Phase 1+). The `LangfuseObservability` adapter reports health status as `unconfigured` when `LANGFUSE_SECRET_KEY` and `LANGFUSE_PUBLIC_KEY` are absent.

---

## 2.5 Frontend / UI Layer

### Dashboard Shell

`app/(dashboard)/layout.tsx` — Resend-style authenticated dashboard layout:
- **Header:** Fixed top bar (`h-14`, `bg-[#0A0A0F]`, `border-b border-white/10`). Left: unerr logo. Right: "Docs" external link.
- **Sidebar:** `w-56`, Void Black (`bg-[#0A0A0F]`), `border-r border-white/10`. Contains `DashboardNav` (Overview, Repositories, Search nav items) + dynamic **Recents** section (top 5 most recently updated repos for active org, fetched server-side) + `UserProfileMenu` (bottom).
- **Nav active states:** Electric Cyan 2px left indicator, `bg-white/[0.08]` background, active icons use `text-[#00E5FF]`. Inactive: `text-white/60 hover:bg-white/5`.
- `UserProfileMenu`: avatar + context label → DropdownMenu: email header, organization switcher (with check marks), Settings/Help, Upgrade Plan, dark/light toggle (next-themes), Sign Out.
- `AccountProvider`: organization context (always has active org — no "personal" mode), persisted via Better Auth `setActive`.
- `DashboardAccountProvider`: wraps dashboard with `AccountProvider` so org hooks only run when authenticated.

**Files:** `app/(dashboard)/layout.tsx`, `components/dashboard/dashboard-header.tsx`, `components/dashboard/dashboard-nav.tsx`, `components/dashboard/user-profile-menu.tsx`, `components/dashboard/dashboard-account-provider.tsx`, `components/providers/account-context.tsx`

### Dashboard Overview Page

`app/(dashboard)/page.tsx` — Three-section layout:
1. **Platform Usage stats grid** (4 `StatCard` components): Repositories (count + active), Code Intelligence (functions & classes indexed), Governance (active rules from graph store), Intelligence (detected patterns). Cards use `glass-card`, `hover:shadow-glow-cyan`, Electric Cyan metric values.
2. **CLI Hero** (`components/dashboard/cli-hero.tsx`): terminal panel with `npx @autorail/unerr connect`, copy button (Electric Cyan flash on copy), heading, muted subtext.
3. **Repository grid** (`grid-cols-1 md:grid-cols-2 lg:grid-cols-4`): `OverviewRepoCard` + `OverviewAddRepoCard` (dashed-border, "Connect Repository" button).

Data is fetched server-side: repos, active rules (`queryRules`, limit 100), detected patterns (`queryPatterns`, limit 100) for the active org.

### Repository Management Page

`app/(dashboard)/repos/page.tsx` — GitHub-style paginated tabular view:
- **Columns:** Repository, Status, Branch, Files, Entities, Last Sync, MCP sessions, Actions (Open button + kebab: Copy ID, Onboarding PR, Remove Repository)
- **Toolbar:** Search input (real-time filter by name/fullName), GitHub account/org filter dropdown (auto-derived from repo owners), "Add Org" button → `/settings/connections`, "Add Repository" button → repo picker modal
- **Pagination:** 20 repos per page, previous/next controls, total count
- **Sorting:** Repository name, Status, Last Sync (click column headers to toggle direction)
- **Status dot:** With inline retry for error states
- **File:** `components/dashboard/repos-list.tsx`

### Empty State

`components/dashboard/empty-state-repos.tsx`: icon (Lucide), "No repositories connected", "Connect GitHub" CTA. Uses `useAccountContext()` to get `activeOrgId` and build the install href dynamically (`/api/github/install?orgId=xxx`); button disabled when no org is active.

### Org Settings Page

`app/(dashboard)/settings/page.tsx`: org name, member list (read-only from Better Auth), danger zone (placeholder).

### Org Auto-Provisioning

Every new user gets a personal organization (`"{name}'s organization"`) immediately on signup via Better Auth `databaseHooks.user.create.after` in `lib/auth/auth.ts`. The hook inserts directly into `organization` + `member` tables (pg Pool, `generateId()`). It retries with a randomized slug on slug conflict. No welcome screen or manual creation step needed.

The following files were removed as obsolete: `components/dashboard/empty-state-no-org.tsx`, `components/dashboard/create-workspace-first-banner.tsx`, `app/actions/create-workspace.ts`.

`app/onboarding/page.tsx` exists as a legacy fallback and redirects to `/` if the user already has an org.

---

## 2.6 Testing & Verification

### Testing Frameworks (Installed & Configured)

| Framework | Purpose | Config | Scripts |
|-----------|---------|--------|---------|
| **Vitest** | Unit & integration tests | `vitest.config.ts` (jsdom, `vitest.setup.ts`, include `**/*.test.{ts,tsx}`, exclude e2e/.next) | `pnpm test`, `test:watch`, `test:ui`, `test:coverage` |
| **Playwright** | E2E tests | `playwright.config.ts` (baseURL, webServer, testDir `./e2e`) | `pnpm e2e:headless`, `pnpm e2e:ui` |
| **Testing Library** | React component tests | `@testing-library/react`, `@testing-library/jest-dom` (in `vitest.setup.ts`) | Via `pnpm test` |

Existing tests: `app/api/__tests__/health.test.ts`, `app/api/__tests__/notifications.test.ts`, `app/api/__tests__/api-keys.test.ts`, `components/Button/Button.test.tsx`.

Port compliance tests (`lib/di/__tests__/port-compliance.test.ts`) exercise all 12 fakes against port interfaces. DI container factory tests (`lib/di/__tests__/container.test.ts`) verify all 12 keys and override behavior.

E2E auth flows (`e2e/auth-flows.spec.ts`) cover: unauthenticated redirect, login/register page rendering, protected route guards. Full authenticated flows (signup → verify → dashboard) are skipped pending a test auth helper.

### Remaining Tasks (Deferred)

- [ ] **Domain function tests (pure logic, zero deps)** — S
  - `entity-hashing.ts`, `rule-resolution.ts` (minimal in Phase 0)
  - **Test:** `pnpm test lib/domain/`
  - Notes: Deferred to Phase 1.

- [ ] **ArangoDB connection + tenant isolation integration test** — M
  - Bootstrap schema; insert/query with org_id; verify isolation.
  - **Test:** `pnpm test lib/adapters/arango-graph-store.test.ts` (requires Docker)
  - Notes: Deferred to Phase 1.

- [ ] **Temporal connection + queue registration integration test** — M
  - Connect to Temporal; verify queues; no-op workflow.
  - **Test:** `pnpm test lib/adapters/temporal-workflow-engine.test.ts` (requires Docker)
  - Notes: Deferred to Phase 1.

- [~] **Full E2E signup → dashboard flow** — L
  - Register → verify email → dashboard (org auto-provisioned) → Connect GitHub → Add Repository.
  - Notes: Partial. Unauthenticated flows pass. Full authenticated flow requires test auth helper.

---

## Configuration Reference

### Environment Variables

| Variable | Adapter/Component | Required | Default | Notes |
|----------|------------------|----------|---------|-------|
| `SUPABASE_DB_URL` | `prisma.config.ts` | Yes | — | PostgreSQL connection URL; `search_path=unerr,public` appended automatically |
| `ARANGODB_URL` | `ArangoGraphStore` | Yes | `http://localhost:8529` | ArangoDB HTTP endpoint |
| `ARANGODB_DATABASE` | `ArangoGraphStore` | No | `unerr_db` | Database name |
| `ARANGO_ROOT_PASSWORD` | `ArangoGraphStore`, docker-compose | Yes | `firstPassword12345` (dev) | ArangoDB root auth |
| `TEMPORAL_ADDRESS` | `TemporalWorkflowEngine`, workers | No | `localhost:7233` | Temporal gRPC address |
| `REDIS_URL` | `lib/queue` (ioredis) | Yes | `redis://localhost:6379` | Redis connection URL |
| `LANGFUSE_SECRET_KEY` | `LangfuseObservability` | No | — | If absent: health returns `unconfigured` |
| `LANGFUSE_PUBLIC_KEY` | `LangfuseObservability` | No | — | If absent: health returns `unconfigured` |
| `LANGFUSE_BASEURL` | `LangfuseObservability` | No | — | Langfuse server URL |
| `AWS_BEARER_TOKEN_BEDROCK` | `BedrockProvider` | Phase 1+ | — | AWS Bedrock auth token; auto-read by `@ai-sdk/amazon-bedrock` |
| `TEI_URL` | `LlamaIndexVectorSearch` | Phase 3+ | `http://localhost:8090` | Text Embeddings Inference server URL |
| `LLM_RETRY_MAX_ATTEMPTS` | `BedrockProvider` | No | `5` | Max retries for Bedrock throttling |
| `LLM_RETRY_BASE_DELAY_MS` | `BedrockProvider` | No | `1000` | Base delay (ms) for exponential backoff |
| `EMBEDDING_BATCH_SIZE` | Embedding activity | No | `32` | Entities per embedding batch; reduced from 100 to prevent OOM |

---

## Dependency Graph

```
Infrastructure ──────────────────────────┐
  Docker Compose (ArangoDB, Temporal,    │
  Temporal UI, TEI, workers, MCP server) │
  .env.example updates                   │
  package.json scripts                   │
                                         │
Database & Schema ───────────────────────┤ (depends on Infrastructure)
  Prisma init + migrations               │
  ArangoDB schema bootstrap              │
  Better Auth coexistence verified       │
                                         │
Ports & Adapters ────────────────────────┤ (depends on Database & Schema)
  12 port interfaces                     │
  12 production adapters                 │
  12 test fakes                          │
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
| 2026-02-17 | — | **Phase 0 implementation complete.** Infrastructure: ArangoDB, Temporal workers, .env.example, worker scripts. Database: Prisma (repos, deletion_logs), ArangoDB bootstrap. Ports: 11 interfaces + types. Adapters: 5 working (Arango, Prisma, Temporal, Redis, Langfuse) + 6 stubs; DI container + fakes. Backend: health expansion, create-org use case, proxy email verification, worker entry points. Frontend: (dashboard) layout, dashboard home + empty state, repos/settings, Phase 0 onboarding (org creation). |
| 2026-02-17 | — | **Supabase schema `unerr`.** Switched from table prefix to PostgreSQL schema: all unerr tables live in schema `unerr`. |
| 2026-02-18 | — | **Auto-provisioned org on signup.** Added `databaseHooks.user.create.after` to Better Auth — auto-creates personal org on signup. Added `UserProfileMenu` (Radix DropdownMenu) and `AccountProvider`. GitHub callback refactored: no org creation, strictly requires `orgId` in state. Removed welcome screen. |
| 2026-02-20 | — | **Remove "personal" context + user-driven repo selection.** `activeOrgId` is now always `string`. Repos no longer auto-added on GitHub installation. `prisma.config.ts`: loads `.env.local` first, appends `search_path=unerr,public`. `listBranches()` added to `IGitHost` for two-step repo picker. |
| 2026-02-20 | — | **Docker DNS fix.** Changed workers to `network_mode: host` to fix Supabase DNS resolution from inside Docker. |
| 2026-02-22 | — | **Dashboard overhaul: Resend-style header + Industrial Glass sidebar + Overview revamp + Tabular repos.** |
| 2026-02-23 | — | **Repo detail revamp:** persistent header layout, Pipeline tab, shadow reindexing, code graph visualization. |
| 2026-02-23 | — | **Light worker OOM fix:** removed `getAllEdges()` from buildDocuments; reduced embedding batch size to 32; increased heartbeat timeouts; increased light worker memory to 6 GB (Docker now 4 GB). |
| 2026-02-23 | — | **Temporal payload optimization:** refactored all 9 workflows to keep heavy data in workers; chunked embedding pipeline; merged multiple activities into single self-sufficient activities. |
| 2026-02-23 | — | **Scale safety audit:** added LIMIT clauses to 10 ArangoDB queries; N+1 query fixes; Prisma `take` limits; Redis pipeline log caps. |
| 2026-03-03 | — | **Doc audit (Phase 0):** merged all [x] completed tasks into architectural prose. Corrected discrepancies: LLM adapter is `BedrockProvider` (not `VercelAIProvider`); `github-host.ts` is fully implemented (not a stub — cloneRepo, listFiles, listBranches, PR/check/review methods all implemented); `scip-code-intelligence.ts` is fully implemented (SCIP + Tree-sitter fallback); 12th port (`IStorageProvider`) implemented and in container; docker workers use `network_mode: host` and 8 GB/4 GB memory limits; `postgresql` image is `pgvector/pgvector:pg13`; `tei`, `tei-reranker`, and `mcp-server` services added to docker-compose (undocumented); `ICacheStore` has `setIfNotExists()` and `invalidateByPrefix()` methods; proxy exempts `/api/cli`. Removed all [x] checklist items from Part 2; renamed Part 2 to "Remaining Tasks". Added Configuration Reference table with all env vars. |
