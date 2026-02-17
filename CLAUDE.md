# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Kap10 Web Server** — Production-ready Next.js starter with Better Auth, Supabase (PostgreSQL), BullMQ job queues, and shadcn/ui. Built with Next.js 16, React 19, Tailwind CSS v4, and Zod v4.

**Package Manager**: pnpm (via Corepack). **Node**: >=20.9.0.

## Commands

```bash
pnpm dev                        # Dev server (Turbopack)
pnpm build                      # Production build
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
pnpm worker                     # Start BullMQ workers
docker compose up                # App + worker + Redis

# Database
pnpm seed                       # Seed database
pnpm migrate                    # Run migrations

# Storybook
pnpm storybook                  # Dev on port 6006
```

## Architecture

### Key Directories

- `app/` — Next.js App Router. Route groups: `(auth)` for login/register, `(admin)` for admin pages
- `app/api/` — API routes (auth, health, uploadthing, webhooks, etc.)
- `components/ui/` — shadcn/ui components
- `components/auth/` — Auth components (login-form, register-form, oauth-buttons)
- `lib/auth/` — Better Auth config (connects via `pg` Pool to Supabase PostgreSQL)
- `lib/db/supabase.ts` — Singleton Supabase server client (lazy Proxy pattern)
- `lib/db/supabase-browser.ts` — Browser-side Supabase client
- `lib/db/types.ts` — Full TypeScript `Database` type with Row/Insert/Update generics
- `lib/queue/` — BullMQ queues (email, processing, webhooks) + Redis connection
- `proxy.ts` — Route protection (replaces `middleware.ts` in Next.js 16)
- `env.mjs` — T3 Env with Zod validation for all environment variables
- `styles/tailwind.css` — Design system tokens, glass utilities, custom fonts

### Data Flow

- **Auth**: Better Auth → `pg` Pool → Supabase PostgreSQL. Session token in cookies (`better-auth.session_token`).
- **Database**: All queries via `import { supabase } from "@/lib/db"` — never create ad-hoc clients.
- **Protected routes**: Defined in `proxy.ts` (public paths whitelist). Add new public paths there.
- **Job queues**: Use `queueEmail()`, `queueProcessing()`, `queueWebhook()` from `@/lib/queue`. Workers run as separate process (`pnpm worker`).

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

### Supabase

- **Import**: `import { supabase } from "@/lib/db"` — never create ad-hoc clients
- **Always check error**: `const { data, error } = await supabase.from("table").select("*"); if (error) throw error;`
- **Types**: `import type { Database } from "@/lib/db/types"` then `Database["public"]["Tables"]["table_name"]["Row"]`
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

Third-party clients (Stripe, Redis, Supabase) must use lazy init to avoid build-time failures when env vars are missing:

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
- **BullMQ**: Use `connection: getRedis() as any` for Queue/Worker constructors
- **State management**: URL-driven state first (nuqs), server state second, local state last

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

See `.cursor/patterns/golden-sample.tsx` for full example. Structure:
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
- [ARCHITECTURE.md](ARCHITECTURE.md) — Database architecture, multi-tenancy, billing, system design
- [docs/UI_UX_GUIDE.md](docs/UI_UX_GUIDE.md) — Complete design system documentation
- [docs/brand/brand.md](docs/brand/brand.md) — Brand guidelines, colors, typography, logos
