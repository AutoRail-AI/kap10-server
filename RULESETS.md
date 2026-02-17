# RULESETS.md

**⚠️ CRITICAL: Follow these rules when generating code to prevent build and lint errors.**

This file contains mandatory code patterns that must be followed. These rules prevent known build issues and ensure code compatibility with our tech stack.

## Quick Reference

Before generating code, check these common patterns:
- [Supabase Queries](#supabase-query-patterns) - Always use typed query functions
- [Zod Validation](#zod-v4-validation) - Use `.refine()` for URLs/emails, `z.record(keyType, valueType)`
- [JSON Parsing](#json-parsing) - Always type assert `await request.json()`
- [File Extensions](#jsx-in-typescript-files) - Use `.tsx` for JSX, never `.ts`
- [Lazy Initialization](#lazy-initialization) - For clients requiring env vars (Stripe, Redis, etc.)
- [Error Handling](#error-handling) - Type errors as `unknown` in catch blocks

---

## 1. Next.js 16 Middleware

**Rule**: Always use `proxy.ts`, never `middleware.ts`

Next.js 16 deprecated `middleware.ts` in favor of `proxy.ts`.

```typescript
// ❌ WRONG
// middleware.ts
export function middleware() { ... }

// ✅ CORRECT
// proxy.ts
export function proxy() { ... }
```

**When to apply**: Creating or modifying middleware/routing logic in Next.js 16+

---

## 2. Supabase Query Patterns

**Rule**: Use the typed Supabase client from `@/lib/db` for all database operations. Kap10 app tables live in PostgreSQL schema `kap10` (not `public`); for Prisma-managed tables use `@@schema("kap10")`. See docs/architecture/VERTICAL_SLICING_PLAN.md § Storage & Infrastructure Split.

All queries should import the singleton `supabase` client and use typed table names.

```typescript
import { supabase } from "@/lib/db"

// ❌ WRONG - Raw SQL or untyped queries
const result = await pool.query('SELECT * FROM users')

// ✅ CORRECT - Typed Supabase client
const { data, error } = await supabase
  .from("notifications")
  .select("*")
  .eq("user_id", userId)
  .order("created_at", { ascending: false })
  .limit(50)

if (error) throw error
return data || []
```

**Common patterns**:
- `supabase.from('table').insert(data).select().single()` — Create and return
- `supabase.from('table').select('*').eq('id', id).maybeSingle()` — Get one (nullable)
- `supabase.from('table').update(data).eq('id', id).select().single()` — Update and return
- `supabase.from('table').delete().eq('id', id)` — Delete
- `supabase.from('table').select('id', { count: 'exact', head: true })` — Count

**When to apply**: All database operations

---

## 3. Zod v4 Validation

**Rule**: Use `.refine()` for URL/email validation, specify key type for `z.record()`

Zod v4 changed API signatures - `.url()` and `.email()` are not available on strings, and `z.record()` requires key type.

### URL Validation

```typescript
// ❌ WRONG
link: z.string().url().optional()

// ✅ CORRECT
link: z.string().refine(
  (val) => {
    if (!val) return true
    try {
      new URL(val)
      return true
    } catch {
      return false
    }
  },
  { message: "Invalid URL format" }
).optional()
```

### Email Validation

```typescript
// ❌ WRONG
EMAIL_FROM: z.string().email().optional()

// ✅ CORRECT
EMAIL_FROM: z.string().refine(
  (val) => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
  "Invalid email"
).optional()
```

### Record Type

```typescript
// ❌ WRONG
metadata: z.record(z.any()).optional()

// ✅ CORRECT
metadata: z.record(z.string(), z.any()).optional()
```

**When to apply**: All Zod validation schemas (env.mjs, API validation, forms)

---

## 4. JSON Parsing

**Rule**: Always type assert `await request.json()` and `await response.json()`

JSON parsing returns `unknown` type, requiring explicit type assertions.

```typescript
// ❌ WRONG
const body = await request.json()
const { messages, task } = body // Error: Property doesn't exist on unknown

// ✅ CORRECT
const body = (await request.json()) as {
  messages?: AgentMessage[]
  task?: string
  organizationId?: string
}
const { messages, task } = body // Works correctly
```

**When to apply**: All API routes (`app/api/**/route.ts`), fetch calls, response handlers

---

## 5. Better Auth Import Paths

**Rule**: Use `better-auth/client/plugins` for client-side plugins

```typescript
// ❌ WRONG
import { organizationClient } from "better-auth/react/plugins"

// ✅ CORRECT
import { organizationClient } from "better-auth/client/plugins"
```

**When to apply**: Importing Better Auth plugins in client components

---

## 6. JSX in TypeScript Files

**Rule**: Always use `.tsx` extension for files containing JSX

```typescript
// ❌ WRONG
// MyComponent.ts
export function MyComponent() {
  return <div>Hello</div>
}

// ✅ CORRECT
// MyComponent.tsx
export function MyComponent() {
  return <div>Hello</div>
}
```

**When to apply**: Any file containing JSX syntax (components, pages, layouts)

---

## 7. Supabase Error Handling

**Rule**: Always check for `error` in Supabase query results before using `data`

```typescript
// ❌ WRONG - Ignoring error
const { data } = await supabase.from("users").select("*")
return data // Could be null if error occurred

// ✅ CORRECT - Check error first
const { data, error } = await supabase.from("users").select("*")
if (error) throw error
return data || []
```

**When to apply**: All Supabase queries

---

## 8. NextRequest IP Address

**Rule**: Extract IP from headers, never use `req.ip`

Next.js 16 `NextRequest` doesn't have `.ip` property.

```typescript
// ❌ WRONG
const ip = req.ip

// ✅ CORRECT
const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || 
           req.headers.get("x-real-ip") || 
           "anonymous"
```

**When to apply**: Any code accessing client IP from NextRequest

---

## 9. Stripe API Version

**Rule**: Use API version `"2025-02-24.acacia"` for Stripe

```typescript
// ✅ CORRECT
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-02-24.acacia",
})
```

**When to apply**: Initializing Stripe client

---

## 10. Missing Type Declarations

**Rule**: Create `.d.ts` files for libraries without TypeScript types

```typescript
// js-yaml.d.ts
declare module "js-yaml" {
  export function load<T = any>(str: string, options?: any): T
  export function dump(obj: any, options?: any): string
  export function safeLoad<T = any>(str: string, options?: any): T
  export function safeDump(obj: any, options?: any): string
  const yaml: {
    load: typeof load
    dump: typeof dump
    safeLoad: typeof safeLoad
    safeDump: typeof safeDump
  }
  export default yaml
}
```

**When to apply**: Using third-party libraries without @types packages

---

## 11. Reduce Function Type Annotations

**Rule**: Always type reduce callback parameters explicitly

```typescript
// ❌ WRONG
const total = items.reduce((sum, item) => sum + item.value, 0)

// ✅ CORRECT
const total = items.reduce((sum: number, item: any) => sum + item.value, 0)
```

**When to apply**: Any reduce callback function

---

## 12. Better Auth Secret During Build

**Rule**: Provide fallback secret for build (development only)

```typescript
// ✅ CORRECT - Allow build without env vars
secret: process.env.BETTER_AUTH_SECRET || "development-secret-change-in-production-min-32-chars",
```

**When to apply**: Better Auth configuration that might be evaluated during build

---

## 13. Supabase Type Imports

**Rule**: Import row/insert/update types from `@/lib/db/types` for type safety

```typescript
import type { Database } from "@/lib/db/types"

type Notification = Database["public"]["Tables"]["notifications"]["Row"]
type NotificationInsert = Database["public"]["Tables"]["notifications"]["Insert"]
```

**When to apply**: Defining types for Supabase table rows

---

## 14. Lazy Initialization

**Rule**: Use lazy initialization for third-party clients requiring environment variables

Clients like Stripe, Redis, and other services should not be initialized at module load time to allow builds without env vars.

### Stripe Client Pattern

```typescript
// ❌ WRONG - Fails during build if env var missing
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY is not set")
}
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-02-24.acacia",
})

// ✅ CORRECT - Lazy initialization
let stripeInstance: Stripe | null = null

function getStripe(): Stripe {
  if (!stripeInstance) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is not set")
    }
    stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-02-24.acacia",
      typescript: true,
    })
  }
  return stripeInstance
}

// Export as Proxy for backward compatibility
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    return getStripe()[prop as keyof Stripe]
  },
})

// Use getStripe() in functions
export async function createCheckoutSession(...) {
  const stripe = getStripe()
  return stripe.checkout.sessions.create(...)
}
```

### Redis Connection Pattern

```typescript
// ✅ CORRECT - Lazy initialization with lazyConnect
let redisInstance: Redis | null = null

function getRedisUrl(): string {
  return process.env.REDIS_URL || "redis://localhost:6379"
}

export function getRedis(): Redis {
  if (!redisInstance) {
    const url = getRedisUrl()
    redisInstance = new Redis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true, // Don't connect during build
    })
  }
  return redisInstance
}
```

**When to apply**: Any client/library that requires environment variables and might be imported during build

---

## 15. Supabase Client Initialization

**Rule**: Use lazy singleton pattern for Supabase client to support CI builds

The Supabase client supports builds without env vars via placeholder URLs.

```typescript
// ✅ CORRECT - Lazy proxy pattern in lib/db/supabase.ts
export const supabase = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop) {
    return getSupabase()[prop as keyof SupabaseClient<Database>]
  },
})
```

**When to apply**: Importing or initializing Supabase client

---

## 16. Error Handling in Catch Blocks

**Rule**: Type catch block errors as `unknown` and check type before accessing properties

```typescript
// ❌ WRONG
try {
  await someOperation()
} catch (error) {
  console.error(error.message) // Error: Property 'message' doesn't exist on unknown
}

// ✅ CORRECT
try {
  await someOperation()
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
}
```

**When to apply**: All catch blocks in TypeScript files

---

## 17. Background Jobs — Temporal (not BullMQ)

**Rule**: All async background work (email, webhooks, indexing, LLM calls) uses **Temporal workflows and activities**. BullMQ has been removed from the project.

- Email sending, webhook delivery, and other short tasks run as activities on the `light-llm-queue` Temporal worker.
- CPU-heavy tasks (SCIP indexing, Semgrep scans) run on the `heavy-compute-queue` Temporal worker.
- Redis is still used for caching and rate limiting (via `RedisCacheStore` adapter), but NOT for job queues.

**When to apply**: Any time you need to run work asynchronously or in the background.

---

## Build Checklist

Before committing code, verify:

- [ ] No `middleware.ts` file exists (use `proxy.ts`)
- [ ] All Supabase queries check for `error` before using `data`
- [ ] All `request.json()` and `response.json()` have type assertions
- [ ] All Zod validations use v4-compatible syntax (`.refine()` for URLs/emails, `z.record(keyType, valueType)`)
- [ ] No JSX in `.ts` files (use `.tsx`)
- [ ] Better Auth imports use correct paths (`better-auth/client/plugins`)
- [ ] IP addresses extracted from headers, not `req.ip`
- [ ] Reduce callbacks have explicit type annotations
- [ ] Third-party clients (Stripe, Redis, etc.) use lazy initialization
- [ ] Database types imported from `@/lib/db/types`
- [ ] Catch blocks type errors as `unknown`
- [ ] Background jobs use Temporal workflows/activities (not BullMQ)

---

## Additional Notes

- These rules are derived from actual build issues encountered in this codebase
- Rules are prioritized to prevent the most common build failures
- When in doubt, follow the patterns shown in existing code
- For detailed explanations of why these rules exist, see the git history and build logs
