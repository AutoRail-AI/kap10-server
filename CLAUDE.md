# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Unerr Web Server** — Cloud-native code intelligence platform that connects to repositories, builds a knowledge graph, and exposes it to AI coding agents via MCP. Built with Next.js 16, React 19, Tailwind CSS v4, and Zod v4. Uses Ports & Adapters (hexagonal) architecture.

**Package Manager**: pnpm (via Corepack). **Node**: >=20.9.0.

## Commands

```bash
pnpm dev                        # Dev server (Turbopack) — auto-runs migrations via predev hook
pnpm build                      # Production build (uses --webpack flag)
pnpm lint                       # ESLint
pnpm lint:fix                   # ESLint auto-fix
pnpm prettier                   # Check formatting
pnpm prettier:fix               # Fix formatting

# Testing
pnpm test                       # Vitest (all tests)
pnpm test path/to/file.test.ts  # Single test file
pnpm test:watch                 # Watch mode
pnpm test:coverage              # With coverage
pnpm e2e:headless               # Playwright E2E
pnpm e2e:ui                     # Playwright with UI

# Workers & Docker
pnpm temporal:worker:heavy      # Temporal heavy-compute worker (SCIP, Semgrep)
pnpm temporal:worker:light      # Temporal light worker (LLM, email, webhooks)
docker compose up -d             # Infrastructure only (Redis, ArangoDB, Temporal, PostgreSQL)
docker compose --profile worker up -d  # + Temporal workers
docker compose --profile app up -d     # + Next.js app (everything)

# Database
pnpm seed                       # Seed database
pnpm migrate                    # Run SQL migrations + Better Auth migrations

# Storybook
pnpm storybook                  # Dev on port 6006
```

**Dev ports**: App `localhost:3000`, Temporal UI `localhost:8080`, ArangoDB UI `localhost:8529`.

## Architecture

### Hexagonal / Ports & Adapters

All external dependencies are behind port interfaces in `lib/ports/`. Business logic depends only on abstractions. The DI container (`lib/di/container.ts`) provides `createProductionContainer()` for runtime and `createTestContainer(overrides?)` with 11 in-memory fakes for testing.

**11 ports** (`lib/ports/`): `IGraphStore`, `IRelationalStore`, `IWorkflowEngine`, `ICacheStore`, `IObservability`, `ILLMProvider`, `IGitHost`, `IVectorSearch`, `IBillingProvider`, `ICodeIntelligence`, `IPatternEngine`.

**Production adapters** (`lib/adapters/`): ArangoDB (graph), Prisma/Supabase (relational), Temporal (workflows), Redis (cache). Six ports are stubs (throw `NotImplementedError`).

### Four-Store Architecture

| Store | Role | What lives here |
|-------|------|-----------------|
| **Supabase (PostgreSQL)** | App data, auth, billing | Auth tables in `public`; unerr app tables in schema `unerr` |
| **ArangoDB** | Graph knowledge store | Files, functions, classes, relationships, rules, patterns |
| **Temporal** | Workflow orchestration | Repo indexing, pattern detection, PR review pipelines |
| **Redis** | Cache & rate limits | Hot query cache, API rate limiting, MCP session state |

### Key Files

- `proxy.ts` — Route protection (replaces `middleware.ts` in Next.js 16). Public paths whitelist lives here.
- `env.mjs` — T3 Env with Zod validation for all environment variables
- `lib/auth/` — Better Auth config (connects via `pg` Pool to Supabase PostgreSQL)
- `lib/db/supabase.ts` — Singleton Supabase server client (lazy Proxy pattern)
- `lib/di/container.ts` — DI container. Production adapters loaded via `require()` inside getters (never static imports)
- `lib/ports/types.ts` — Shared domain types (`EntityDoc`, `EdgeDoc`, `OrgContext`, etc.)
- `lib/use-cases/` — Business logic functions (receive container as arg)
- `styles/tailwind.css` — Design system tokens, glass utilities, custom fonts

### Data Flow

- **Auth**: Better Auth → `pg` Pool → Supabase PostgreSQL. Session token in cookies (`better-auth.session_token`).
- **Database**: All queries via `import { supabase } from "@/lib/db"` — never create ad-hoc clients.
- **Protected routes**: Defined in `proxy.ts` (public paths whitelist). Add new public paths there.
- **Background work**: All async jobs run as Temporal workflows/activities. Two worker queues: `heavy-compute-queue` (CPU-bound: SCIP, Semgrep) and `light-llm-queue` (network-bound: LLM, email, webhooks).

### Auth Patterns

**Server Component:**
```typescript
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
const session = await auth.api.getSession({ headers: await headers() })
```

**Client Component:**
```typescript
"use client"
import { authClient } from "@/lib/auth/client"
const { data: session } = authClient.useSession()
```

Email verification is enforced at the proxy level for email/password signups only. OAuth users (Google/GitHub) skip verification. Unverified users redirect to `/verify-email`.

### Organization vs GitHub Disambiguation

**"Organization" in unerr ≠ "organization" on GitHub.** They are independent entities:
- **Unerr org**: Better Auth tenant, created at signup from user's name (`"{name}'s organization"`). Lives in `public.organization` table.
- **GitHub account/org**: Stored as `accountLogin` on `unerr.github_installations` table. Never used as unerr org name.
- **GitHub installation**: Links a GitHub account/org to an existing unerr org. One unerr org can have multiple GitHub connections.
- **"Workspace"**: Repo-level technical context only (clone dirs, SCIP indexing, monorepo roots). Never means organization.

### Component Conventions

- Components in folders: `ComponentName.tsx`, `ComponentName.test.tsx`, `ComponentName.stories.tsx`
- Styling: CVA (`class-variance-authority`) for variants, `tailwind-merge` for className merging
- Icons: Lucide React only

## Code Generation Rules

**These rules prevent known build failures. Follow them strictly.**

### Next.js 16 / React 19

- **Use `proxy.ts`, never `middleware.ts`** — Next.js 16 deprecated middleware.ts
- **No `useEffect` for data fetching** — Use Server Components + `<Suspense>`. `useEffect` only for DOM side effects.
- **Server Actions**: Use `'use server'` at top of action files. Prefer `useActionState` (not `useFormState`).
- **Forms**: Use `action` prop on `<form>` with Server Actions.
- **Async Server Components**: Await promises directly (no useEffect).

### TypeScript & Type Safety

- **Strict mode** with `noUncheckedIndexedAccess` enabled
- **Catch blocks**: Always `catch (error: unknown)`, then `error instanceof Error ? error.message : String(error)`
- **JSON parsing**: Always type assert — `const body = (await request.json()) as { ... }`
- **Reduce callbacks**: Always type accumulator — `items.reduce((sum: number, item) => ...)`
- **JSX files**: Always `.tsx`, never `.ts` for files with JSX

### Supabase / Prisma

- **Relational data:** Supabase (PostgreSQL) and Prisma only. No MongoDB or other NoSQL for app/auth data.
- **Schema approach:** Unerr app tables live in PostgreSQL schema **`unerr`**. In Prisma: `schemas = ["public", "unerr"]` and `@@schema("unerr")` on every unerr model and enum. Do not add new unerr tables to `public`.
- **Import**: `import { supabase } from "@/lib/db"` — never create ad-hoc clients
- **Always check error**: `const { data, error } = await supabase.from("table").select("*"); if (error) throw error;`
- **Types**: `import type { Database } from "@/lib/db/types"` then `Database["public"]["Tables"]["table_name"]["Row"]` (or `Database["unerr"]["Tables"][...]` for unerr schema)
- **Common patterns**: `.insert(data).select().single()`, `.select("*").eq("id", id).maybeSingle()`, `.update(data).eq("id", id).select().single()`

### Zod v4

- **No `.url()` or `.email()`** on strings — use `.refine()` instead:
  ```typescript
  link: z.string().refine(val => { try { new URL(val); return true } catch { return false } }, "Invalid URL").optional()
  ```
- **Records**: `z.record(z.string(), z.any())` not `z.record(z.any())`

### Better Auth

- **Client plugins**: Import from `better-auth/client/plugins` (not `better-auth/react/plugins`)
- **Build fallback**: `secret: process.env.BETTER_AUTH_SECRET || "development-secret-..."`

### Lazy Initialization

All infra clients (Stripe, Redis, Supabase, ArangoDB, Temporal) must use lazy init so the Next.js build never connects to external services. Production adapters in `lib/di/container.ts` use `require()` inside getters. Auth, Supabase, and Redis modules also use `require()` inside their getter functions — no top-level imports of `pg`, `better-auth`, `@supabase/supabase-js`, `ioredis`, `arangojs`, or `@temporalio/client`.

```typescript
let instance: Client | null = null
function getClient(): Client {
  if (!instance) {
    instance = new Client(process.env.KEY!)
  }
  return instance
}
export const client = new Proxy({} as Client, {
  get(_target, prop) { return getClient()[prop as keyof Client] }
})
```

### Other Rules

- **IP extraction**: `req.headers.get("x-forwarded-for")?.split(",")[0] || req.headers.get("x-real-ip") || "anonymous"` — never `req.ip`
- **Stripe API version**: `"2025-02-24.acacia"`
- **State management**: URL-driven state first (nuqs), server state second, local state last
- **No `bg-white` or raw `bg-black`**: Use `bg-card` or `bg-background`

## Design System

**Aesthetic**: Dark-first, Industrial Glass. Reference `docs/UI_UX_GUIDE.md` and `docs/brand/brand.md` for full details.

### Key Rules

- **Background**: Always `bg-background` (Void Black `#0A0A0F`)
- **Text**: `text-foreground` for primary, `text-muted-foreground` for secondary
- **Primary accent**: `#6E18B3` (Rail Purple) — icons/borders only, never body text (WCAG fail)
- **No arbitrary colors** (`bg-blue-500`, etc.) — use design system tokens only
- **Buttons**: Always `size="sm"` (h-8 px-3). Primary: `className="bg-rail-fade hover:opacity-90"`
- **Inputs**: Always `h-9`, never `h-10`
- **Cards**: Use `glass-card` or `glass-panel` classes. `CardContent` always has `pt-6`
- **Fonts**: `font-grotesk` (Space Grotesk) for headings, `font-sans` (Inter) for body, `font-mono` (JetBrains Mono) for code
- **Page titles**: `font-grotesk text-lg font-semibold` — never larger
- **Page container**: `space-y-6 py-6`
- **Icons**: Lucide React. Nav: `h-4 w-4`, Buttons: `h-3.5 w-3.5`
- **Loading**: Use `<Skeleton />`, not `Loader2`
- **Dashboard pages inherit layout** — never recreate sidebar/shell

### Golden Page Pattern

```tsx
export default function Page() {
  return (
    <div className="space-y-6 py-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="font-grotesk text-lg font-semibold text-foreground">Title</h1>
          <p className="text-sm text-foreground mt-0.5">Description</p>
        </div>
        <Button size="sm" className="bg-rail-fade hover:opacity-90">Action</Button>
      </div>
      <Suspense fallback={<Skeleton className="h-[200px] w-full" />}>
        {/* Data-fetching component */}
      </Suspense>
    </div>
  )
}
```

## Additional Documentation

- [RULESETS.md](RULESETS.md) — Full code pattern reference with examples
- [docs/architecture/README.md](docs/architecture/README.md) — Configuration, env, database architecture, migrations, Docker, key directories
- [docs/UI_UX_GUIDE.md](docs/UI_UX_GUIDE.md) — Complete design system documentation
- [docs/brand/brand.md](docs/brand/brand.md) — Brand guidelines, colors, typography, logos
