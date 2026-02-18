import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

export const env = createEnv({
  server: {
    ANALYZE: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => value === "true"),

    // ── Database (Supabase PostgreSQL) ──────────────────────────────
    SUPABASE_URL: z.string().url().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
    SUPABASE_SECRET_KEY: z.string().optional(),
    SUPABASE_DB_URL: z.string().optional(),

    // ── Redis (Cache & Rate Limits) ─────────────────────────────────
    REDIS_URL: z.string().refine((val) => !val || /^redis(s)?:\/\//.test(val), "Invalid Redis URL").optional(),

    // ── ArangoDB (Graph Store) ──────────────────────────────────────
    ARANGODB_URL: z.string().refine((val) => !val || /^https?:\/\//.test(val), "Invalid ArangoDB URL").optional(),
    ARANGODB_DATABASE: z.string().optional(),
    ARANGO_ROOT_PASSWORD: z.string().optional(),

    // ── Temporal (Workflow Orchestration) ────────────────────────────
    TEMPORAL_ADDRESS: z.string().optional(),

    // ── Langfuse (LLM Observability) ────────────────────────────────
    LANGFUSE_SECRET_KEY: z.string().optional(),
    LANGFUSE_PUBLIC_KEY: z.string().optional(),
    LANGFUSE_BASEURL: z.string().refine((val) => !val || /^https?:\/\//.test(val), "Invalid Langfuse URL").optional(),

    // ── Better Auth ─────────────────────────────────────────────────
    BETTER_AUTH_SECRET: z.string().min(32).optional(),
    BETTER_AUTH_URL: z.string().refine((val) => !val || /^https?:\/\//.test(val), "Invalid URL").optional(),

    // ── OAuth Providers ─────────────────────────────────────────────
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),

    // ── GitHub App (Phase 1 — repo access, installation tokens) ─────
    GITHUB_APP_ID: z.string().optional(),
    GITHUB_APP_PRIVATE_KEY: z.string().optional(),
    GITHUB_APP_SLUG: z.string().optional(),
    GITHUB_WEBHOOK_SECRET: z.string().optional(),

    // ── Email (Resend) ──────────────────────────────────────────────
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().optional(),

    // ── Organization Limits ─────────────────────────────────────────
    ORGANIZATION_LIMIT: z.string().optional(),
    MEMBERSHIP_LIMIT: z.string().optional(),

    // ── Sentry (Error Tracking) ─────────────────────────────────────
    SENTRY_DSN: z.string().refine((val) => !val || /^https?:\/\//.test(val), "Invalid URL").optional(),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.string().refine((val) => !val || /^https?:\/\//.test(val), "Invalid URL").optional(),
    NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
    NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
    NEXT_PUBLIC_POSTHOG_HOST: z.string().refine((val) => !val || /^https?:\/\//.test(val), "Invalid URL").optional(),
  },
  runtimeEnv: {
    ANALYZE: process.env.ANALYZE,
    // Database
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    SUPABASE_DB_URL: process.env.SUPABASE_DB_URL,
    // Redis
    REDIS_URL: process.env.REDIS_URL,
    // ArangoDB
    ARANGODB_URL: process.env.ARANGODB_URL,
    ARANGODB_DATABASE: process.env.ARANGODB_DATABASE,
    ARANGO_ROOT_PASSWORD: process.env.ARANGO_ROOT_PASSWORD,
    // Temporal
    TEMPORAL_ADDRESS: process.env.TEMPORAL_ADDRESS,
    // Langfuse
    LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY,
    LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY,
    LANGFUSE_BASEURL: process.env.LANGFUSE_BASEURL,
    // Better Auth
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    // OAuth
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
    // GitHub App
    GITHUB_APP_ID: process.env.GITHUB_APP_ID,
    GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,
    GITHUB_APP_SLUG: process.env.GITHUB_APP_SLUG,
    GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET,
    // Email
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    // Organization Limits
    ORGANIZATION_LIMIT: process.env.ORGANIZATION_LIMIT,
    MEMBERSHIP_LIMIT: process.env.MEMBERSHIP_LIMIT,
    // Sentry
    SENTRY_DSN: process.env.SENTRY_DSN,
    // Public
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  },
})
