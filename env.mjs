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

    // ── Embedding (Phase 3 — Semantic Search) ──────────────────────
    EMBEDDING_MODEL_NAME: z.string().optional().default("nomic-ai/nomic-embed-text-v1.5"),
    EMBEDDING_DIMENSIONS: z.string().optional().transform((val) => val ? parseInt(val, 10) : 768),
    EMBEDDING_BATCH_SIZE: z.string().optional().transform((val) => val ? parseInt(val, 10) : 100),
    EMBEDDING_MODEL_VERSION: z.string().optional(),

    // ── Graph Snapshots (Phase 10a — Local-First Intelligence) ────
    GRAPH_SNAPSHOT_BUCKET: z.string().optional().default("graph-snapshots"),
    GRAPH_SNAPSHOT_TTL_HOURS: z.string().optional().transform((val) => val ? parseInt(val, 10) : 24),
    GRAPH_SYNC_CRON: z.string().optional().default("0 2 * * *"),

    // ── MCP Server (Phase 2) ──────────────────────────────────────
    MCP_SERVER_URL: z.string().refine((val) => !val || /^https?:\/\//.test(val), "Invalid MCP Server URL").optional(),
    MCP_SERVER_PORT: z.string().optional().transform((val) => val ? parseInt(val, 10) : 3001),
    MCP_JWT_AUDIENCE: z.string().optional().default("kap10-mcp"),
    MCP_OAUTH_DCR_TTL_HOURS: z.string().optional().transform((val) => val ? parseInt(val, 10) : 24),
    MCP_RATE_LIMIT_MAX: z.string().optional().transform((val) => val ? parseInt(val, 10) : 60),
    MCP_RATE_LIMIT_WINDOW_S: z.string().optional().transform((val) => val ? parseInt(val, 10) : 60),
    MCP_MAX_RESPONSE_BYTES: z.string().optional().transform((val) => val ? parseInt(val, 10) : 32768),
    MCP_WORKSPACE_TTL_HOURS: z.string().optional().transform((val) => val ? parseInt(val, 10) : 12),
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
    // Embedding
    EMBEDDING_MODEL_NAME: process.env.EMBEDDING_MODEL_NAME,
    EMBEDDING_DIMENSIONS: process.env.EMBEDDING_DIMENSIONS,
    EMBEDDING_BATCH_SIZE: process.env.EMBEDDING_BATCH_SIZE,
    // Graph Snapshots
    GRAPH_SNAPSHOT_BUCKET: process.env.GRAPH_SNAPSHOT_BUCKET,
    GRAPH_SNAPSHOT_TTL_HOURS: process.env.GRAPH_SNAPSHOT_TTL_HOURS,
    GRAPH_SYNC_CRON: process.env.GRAPH_SYNC_CRON,
    // MCP Server
    MCP_SERVER_URL: process.env.MCP_SERVER_URL,
    MCP_SERVER_PORT: process.env.MCP_SERVER_PORT,
    MCP_JWT_AUDIENCE: process.env.MCP_JWT_AUDIENCE,
    MCP_OAUTH_DCR_TTL_HOURS: process.env.MCP_OAUTH_DCR_TTL_HOURS,
    MCP_RATE_LIMIT_MAX: process.env.MCP_RATE_LIMIT_MAX,
    MCP_RATE_LIMIT_WINDOW_S: process.env.MCP_RATE_LIMIT_WINDOW_S,
    MCP_MAX_RESPONSE_BYTES: process.env.MCP_MAX_RESPONSE_BYTES,
    MCP_WORKSPACE_TTL_HOURS: process.env.MCP_WORKSPACE_TTL_HOURS,
    // Public
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  },
})
