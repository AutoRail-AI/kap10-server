# Kap10

Cloud-native code intelligence platform. Connects to your repositories, builds a knowledge graph of your codebase, and exposes it to AI coding agents via MCP (Model Context Protocol). Built with Next.js 16, React 19, and a Ports & Adapters (hexagonal) architecture.

---

## Architecture

```
Developer's IDE                        kap10 Cloud
┌──────────────┐                      ┌──────────────────────────────────────────┐
│  Cursor /    │   MCP (HTTP-SSE)     │  Next.js 16 App                         │
│  Claude Code │◄────────────────────►│  ┌───────────┐  ┌──────────────────┐    │
│  Windsurf    │                      │  │ MCP Server │  │ Web Dashboard    │    │
└──────────────┘                      │  └─────┬─────┘  └────────┬─────────┘    │
                                      │        │                  │              │
                                      │  ┌─────▼──────────────────▼─────────┐   │
                                      │  │          Core Engine              │   │
                                      │  │  (11 port interfaces, DI container)│  │
                                      │  └─────┬──────────────────┬─────────┘   │
                                      │        │                  │              │
                                      │  ┌─────▼─────┐    ┌──────▼──────────┐  │
                                      │  │ ArangoDB   │    │ Supabase        │  │
                                      │  │ (Graph DB) │    │ (App + Vectors) │  │
                                      │  └───────────┘    └─────────────────┘  │
                                      │        │                                │
                                      │  ┌─────▼───────────────────────────┐   │
                                      │  │ Temporal (Workflow Orchestration) │   │
                                      │  │  ├─ heavy-compute-queue          │   │
                                      │  │  └─ light-llm-queue             │   │
                                      │  └─────────────────────────────────┘   │
                                      └──────────────────────────────────────────┘
```

### Storage & Infrastructure

| Store | Role | What lives here |
|-------|------|-----------------|
| **Supabase (PostgreSQL)** | App data, auth, billing | Auth tables in `public`; kap10 app tables in schema **`kap10`** (repos, deletion_logs, etc.) |
| **ArangoDB** | Graph knowledge store | Files, functions, classes, relationships (calls, imports, extends), rules, patterns |
| **Temporal** | Workflow orchestration | Repo indexing, justification, pattern detection, PR review pipelines |
| **Redis** | Cache & rate limits | Hot query cache, API rate limiting, MCP session state |

Kap10 uses a **PostgreSQL schema** (not table prefix): all kap10-managed tables live in schema `kap10`. Better Auth tables stay in `public`. See [VERTICAL_SLICING_PLAN.md § Storage & Infrastructure Split](docs/architecture/VERTICAL_SLICING_PLAN.md).

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Next.js 16 (App Router), React 19 |
| **Language** | TypeScript (strict mode) |
| **Auth** | Better Auth (email/password, Google OAuth, GitHub OAuth, organizations) |
| **Database** | Supabase (PostgreSQL) via Prisma 7; kap10 tables in schema `kap10` |
| **Graph DB** | ArangoDB 3.12 (pool-based multi-tenancy, `arangojs`) |
| **Workflows** | Temporal 1.24 (durable execution, resume-from-failure, TypeScript SDK) |
| **Code Intel** | SCIP (Sourcegraph) + Tree-sitter (Phase 1+) |
| **AI** | Vercel AI SDK (`generateObject()` + Zod structured output) (Phase 4+) |
| **LLM Observability** | Langfuse (via OpenTelemetry) |
| **Cache & Rate Limits** | Redis 7 (ioredis) |
| **UI** | shadcn/ui, Radix UI, Tailwind CSS v4 |
| **Testing** | Vitest, Playwright, Storybook |
| **Package Manager** | pnpm (via Corepack) |

### Ports & Adapters

All external dependencies are behind port interfaces (`lib/ports/`). Business logic depends on abstractions, never on concrete adapters. This means every technology can be swapped by writing a single adapter file.

| Port | Production Adapter | Phase 0 Status |
|------|-------------------|----------------|
| `IGraphStore` | `ArangoGraphStore` | Working (bootstrap + health) |
| `IRelationalStore` | `PrismaRelationalStore` | Working (CRUD + health) |
| `IWorkflowEngine` | `TemporalWorkflowEngine` | Working (health only) |
| `ICacheStore` | `RedisCacheStore` | Working (full) |
| `IObservability` | `LangfuseObservability` | Partial (health + unconfigured) |
| `ILLMProvider` | `VercelAIProvider` | Stub |
| `IGitHost` | `GitHubHost` | Stub |
| `IVectorSearch` | `LlamaIndexVectorSearch` | Stub |
| `IBillingProvider` | `StripePayments` | Stub |
| `ICodeIntelligence` | `SCIPCodeIntelligence` | Stub |
| `IPatternEngine` | `SemgrepPatternEngine` | Stub |

DI container: `createProductionContainer()` for runtime, `createTestContainer(overrides?)` with 11 in-memory fakes for testing.

---

## Quick Start

### Prerequisites

- Node.js >= 20.9.0
- pnpm (via Corepack)
- Docker & Docker Compose
- Supabase project (cloud or local)

### Development Setup (recommended)

Run infrastructure in Docker, web server on your machine for fast iteration:

```bash
# 1. Enable Corepack for pnpm
corepack enable

# 2. Clone and install dependencies
git clone <your-repo-url>
cd kap10-server
pnpm install

# 3. Configure environment
cp .env.example .env.local
# Edit .env.local — see Environment Variables section below

# 4. Start infrastructure (Redis, ArangoDB, Temporal, PostgreSQL)
docker compose up -d

# 5. Run database migrations
pnpm migrate

# 6. Start development server
pnpm dev
```

App runs at http://localhost:3000. Temporal UI at http://localhost:8080. ArangoDB UI at http://localhost:8529.

### Docker Compose Profiles

```bash
# Infrastructure only (default) — web server runs on host
docker compose up -d

# Infrastructure + Temporal workers
docker compose --profile worker up -d

# Everything in Docker (infra + app + workers)
docker compose --profile app up -d
```

### Infrastructure Services

All services expose ports to `localhost` for host-machine access:

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `redis` | `redis:7-alpine` | 6379 | Cache, rate limits, MCP session state |
| `arangodb` | `arangodb/arangodb:3.12` | 8529 | Graph knowledge store (API + web UI) |
| `temporal` | `temporalio/auto-setup:1.24.2` | 7233 | Workflow orchestration (gRPC) |
| `temporal-ui` | `temporalio/ui:2.31.2` | 8080 | Temporal web dashboard |
| `postgresql` | `postgres:13` | 5432 | Temporal persistence (NOT app data) |

**Note:** App data lives in cloud Supabase. The local PostgreSQL is only for Temporal's internal persistence.

### Application Services (profile: `app`)

| Service | Port | Purpose |
|---------|------|---------|
| `app` | 3000 | Next.js dev server |
| `temporal-worker-heavy` | — | Heavy compute worker (SCIP, Semgrep — Phase 1+) |
| `temporal-worker-light` | — | Light worker (LLM, email, webhooks — Phase 1+) |

---

## Environment Variables

Create `.env.local` from `.env.example`. The `.env.local` file is configured for running the web server on your host machine (all URLs point to `localhost`).

### Required

```bash
# Supabase (cloud project)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
SUPABASE_DB_URL=postgresql://postgres:password@db.your-project.supabase.co:5432/postgres

# Better Auth
BETTER_AUTH_SECRET=your-32-character-secret-here   # openssl rand -base64 32
BETTER_AUTH_URL=http://localhost:3000
```

### Infrastructure (Docker services on localhost)

```bash
# Redis — cache & rate limiting
REDIS_URL=redis://localhost:6379

# Temporal — workflow orchestration
TEMPORAL_ADDRESS=localhost:7233

# ArangoDB — graph knowledge store
ARANGODB_URL=http://localhost:8529
ARANGODB_DATABASE=kap10_db
ARANGO_ROOT_PASSWORD=firstPassword12345    # must match docker-compose default
```

### Optional Features

```bash
# OAuth providers
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# Email (Resend)
RESEND_API_KEY=re_xxxxx
EMAIL_FROM=noreply@yourdomain.com

# AI (Vercel AI SDK — Phase 4+)
OPENAI_API_KEY=sk-xxxxx
ANTHROPIC_API_KEY=sk-ant-xxxxx

# LLM Observability (Langfuse — optional, health reports "unconfigured" if absent)
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_BASEURL=https://cloud.langfuse.com

# Stripe Billing
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...

# PostHog Analytics
NEXT_PUBLIC_POSTHOG_KEY=ph_...
NEXT_PUBLIC_POSTHOG_HOST=https://app.posthog.com

# Sentry Error Tracking
SENTRY_DSN=https://...

# File Uploads
UPLOADTHING_TOKEN=sk_live_xxxxx

# Public
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## Commands

```bash
# Development
pnpm dev                        # Start dev server (Turbopack) at localhost:3000
pnpm build                      # Production build
pnpm start                      # Start production server

# Background Workers (run in separate terminals or via Docker --profile worker)
pnpm temporal:worker:heavy      # Temporal: heavy compute (SCIP, Semgrep — Phase 1+)
pnpm temporal:worker:light      # Temporal: light activities (LLM, email — Phase 1+)

# Database
pnpm migrate                    # Run Prisma migrations against Supabase
pnpm seed                       # Seed database

# Testing
pnpm test                       # Run Vitest unit tests
pnpm test path/to/file.test.ts  # Run single test file
pnpm test:watch                 # Watch mode
pnpm test:coverage              # With coverage
pnpm e2e:headless               # Run Playwright E2E tests
pnpm e2e:ui                     # Playwright with UI
pnpm storybook                  # Start Storybook (port 6006)

# Code Quality
pnpm lint                       # Run ESLint
pnpm lint:fix                   # ESLint auto-fix
pnpm prettier                   # Check formatting
pnpm prettier:fix               # Fix formatting

# Docker
docker compose up -d            # Start infrastructure services
docker compose --profile worker up -d  # + Temporal workers
docker compose --profile app up -d     # + Next.js app (everything)
docker compose down             # Stop all services
```

---

## Project Structure

```
app/                            # Next.js App Router
├── (auth)/                     # Auth route group (login, register, verify-email)
├── (dashboard)/                # Authenticated dashboard
│   ├── layout.tsx              # Dashboard shell (sidebar, org switcher, user menu)
│   ├── page.tsx                # Repos list / empty state
│   ├── repos/                  # Repository management
│   └── settings/               # Org settings
├── onboarding/                 # First-time user org creation wizard
├── api/                        # API routes
│   ├── auth/                   # Better Auth endpoints
│   ├── health/                 # Health check (Supabase, ArangoDB, Temporal, Redis, Langfuse)
│   ├── org/bootstrap/          # ArangoDB org bootstrap after org creation
│   ├── webhooks/               # Stripe, GitHub webhook handlers
│   └── ...                     # Other API routes
├── proxy.ts                    # Route protection + email verification enforcement
├── instrumentation.ts          # OpenTelemetry registration
└── page.tsx                    # Home page

components/
├── auth/                       # Auth components (login-form, register-form, oauth)
├── onboarding/                 # Org creation wizard component
├── dashboard/                  # Dashboard-specific components (empty states)
├── providers/                  # React providers
└── ui/                         # shadcn/ui components

lib/
├── auth/                       # Better Auth configuration
├── db/                         # Supabase client + types
│   ├── supabase.ts             # Server client (lazy Proxy singleton)
│   ├── supabase-browser.ts     # Browser client
│   └── types.ts                # Database TypeScript types
├── ports/                      # Abstract interfaces (11 ports, zero dependencies)
│   ├── graph-store.ts          # IGraphStore (ArangoDB)
│   ├── relational-store.ts     # IRelationalStore (Supabase/Prisma)
│   ├── workflow-engine.ts      # IWorkflowEngine (Temporal)
│   ├── cache-store.ts          # ICacheStore (Redis)
│   ├── observability.ts        # IObservability (Langfuse)
│   ├── llm-provider.ts         # ILLMProvider (Vercel AI SDK)
│   ├── git-host.ts             # IGitHost (GitHub/Octokit)
│   ├── vector-search.ts        # IVectorSearch (LlamaIndex)
│   ├── billing-provider.ts     # IBillingProvider (Stripe)
│   ├── code-intelligence.ts    # ICodeIntelligence (SCIP)
│   ├── pattern-engine.ts       # IPatternEngine (Semgrep)
│   └── types.ts                # Shared domain types (EntityDoc, EdgeDoc, OrgContext, etc.)
├── adapters/                   # Concrete implementations (1 per external dependency)
│   ├── arango-graph-store.ts   # ArangoDB: bootstrap, health, tenant isolation
│   ├── prisma-relational-store.ts  # Supabase via Prisma: repos, deletion_logs
│   ├── temporal-workflow-engine.ts  # Temporal: health check, workflow stubs
│   ├── redis-cache-store.ts    # Redis: get/set/invalidate/rateLimit/health
│   ├── langfuse-observability.ts   # Langfuse: health (unconfigured if no env vars)
│   └── ...                     # 6 stub adapters (throw NotImplementedError)
├── di/                         # Dependency injection
│   ├── container.ts            # createProductionContainer() + createTestContainer()
│   └── fakes.ts                # 11 in-memory fakes for testing
├── use-cases/                  # Business logic functions (receive container as arg)
│   └── create-org.ts           # Org creation + ArangoDB bootstrap
├── domain/                     # Pure business logic (zero external imports)
├── queue/                      # Redis connection singleton (cache, rate limits)
│   ├── redis.ts                # ioredis lazy singleton
│   └── index.ts                # Barrel export (getRedis, closeRedis)
└── utils/                      # Utility functions

prisma/
├── schema.prisma               # Prisma schema (schemas: public + kap10)
└── migrations/                 # SQL migrations (repos, deletion_logs in kap10 schema)

scripts/
├── temporal-worker-heavy.ts    # Heavy-compute worker (SCIP, Semgrep — Phase 1+)
└── temporal-worker-light.ts    # Light worker (LLM, email, webhooks — Phase 1+)

e2e/                            # Playwright E2E tests
docs/architecture/              # Architecture documentation
```

---

## Authentication

Better Auth with email/password, Google OAuth, GitHub OAuth, and organization-based multi-tenancy.

**Email verification** is enforced at the proxy level (`proxy.ts`). Unverified users are redirected to `/verify-email` on every protected route. The `cookieCache` (5 minutes) prevents per-request DB queries.

**Server Component:**
```typescript
import { auth } from "@/lib/auth"
import { headers } from "next/headers"

export default async function Page() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect("/login")
  return <div>Hello {session.user.name}</div>
}
```

**Client Component:**
```typescript
"use client"
import { authClient } from "@/lib/auth/client"

export function Component() {
  const { data: session } = authClient.useSession()
  if (!session) return <div>Not logged in</div>
  return <div>Hello {session.user.name}</div>
}
```

Protected routes are configured in `proxy.ts` (Next.js 16 replaces `middleware.ts` with `proxy.ts`).

---

## Health Check

`GET /api/health` checks all 5 infrastructure systems in parallel (2s timeout each):

```json
{
  "status": "healthy | degraded | unhealthy",
  "timestamp": "2026-02-17T...",
  "checks": {
    "supabase":  { "status": "up", "latencyMs": 45 },
    "arangodb":  { "status": "up", "latencyMs": 12 },
    "temporal":  { "status": "up", "latencyMs": 8 },
    "redis":     { "status": "up", "latencyMs": 2 },
    "langfuse":  { "status": "unconfigured", "latencyMs": 0 }
  }
}
```

- **Supabase down** = HTTP 503 (`unhealthy`) — hard dependency
- **Any other system down** = HTTP 200 (`degraded`) — tolerable in Phase 0
- **Langfuse unconfigured** = treated as "up" — optional infrastructure

Also available at `/healthz`, `/health`, `/ping`.

---

## Architecture Documentation

| Document | Purpose |
|----------|---------|
| [VERTICAL_SLICING_PLAN.md](docs/architecture/VERTICAL_SLICING_PLAN.md) | Master architecture — 10-phase delivery plan, system design, cross-cutting concerns |
| [PHASE_0_DEEP_DIVE_AND_TRACKER.md](docs/architecture/PHASE_0_DEEP_DIVE_AND_TRACKER.md) | Phase 0 deep dive: user flows, reliability, performance, implementation tracker |
| [CLAUDE.md](CLAUDE.md) | AI coding assistant guidance — code generation rules, design system |
| [RULESETS.md](RULESETS.md) | Mandatory code patterns to prevent build errors |
| [docs/UI_UX_GUIDE.md](docs/UI_UX_GUIDE.md) | Design system documentation |
| [docs/brand/brand.md](docs/brand/brand.md) | Brand guidelines, colors, typography, logos |

---

## License

MIT
