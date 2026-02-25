#!/usr/bin/env tsx
/**
 * Reset all Supabase data for local/testing. Keeps schema and schema_migrations.
 * Usage: pnpm reset-db (or pnpm tsx scripts/reset-db.ts)
 *
 * Requires: SUPABASE_DB_URL in .env.local (or DATABASE_URL).
 */

import "./load-env"

import { Pool } from "pg"

function getDbUrl(): string | undefined {
  return process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL
}

async function main(): Promise<void> {
  const dbUrl = getDbUrl()
  if (!dbUrl) {
    console.error("Missing SUPABASE_DB_URL or DATABASE_URL. Set it in .env.local")
    process.exit(1)
  }

  const pool = new Pool({
    connectionString: dbUrl,
    ssl: dbUrl.includes("supabase.co") ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 30000,
    statement_timeout: 30000,
  })

  try {
    // Quick connectivity check
    await pool.query("SELECT 1")
    console.log("Resetting all data (keeping schema and migration history)...")

    // Unerr schema first (child tables with FKs to repos must be truncated together).
    // CASCADE handles FK ordering, but listing all tables ensures nothing is missed.
    await pool.query(`
      TRUNCATE TABLE
        unerr.pr_review_comments,
        unerr.pr_reviews,
        unerr.ledger_snapshots,
        unerr.rule_embeddings,
        unerr.justification_embeddings,
        unerr.entity_embeddings,
        unerr.active_vector_versions,
        unerr.graph_snapshot_meta,
        unerr.workspaces,
        unerr.api_keys,
        unerr.deletion_logs,
        unerr.github_installations,
        unerr.repos
      RESTART IDENTITY CASCADE
    `)
    console.log("  ✓ unerr schema tables truncated")

    // Public schema: Better Auth + app tables. Exclude schema_migrations so migrations stay recorded.
    await pool.query(`
      TRUNCATE TABLE
        public.invitation,
        public.member,
        public."session",
        public."account",
        public."organization",
        public."user",
        public."verification",
        public.subscriptions,
        public.activities,
        public.audit_logs,
        public.onboarding,
        public.costs,
        public.usage,
        public.feature_flags,
        public.api_keys,
        public.notifications,
        public.search_index,
        public.webhooks,
        public.templates,
        public.rate_limits,
        public.agent_conversations
      RESTART IDENTITY CASCADE
    `)
    console.log("  ✓ public schema tables truncated")

    console.log("Done. Database is empty and ready for testing.")
  } catch (err: unknown) {
    console.error(
      "Reset failed:",
      err instanceof Error ? err.message : String(err)
    )
    process.exit(1)
  } finally {
    await pool.end()
  }
}

main()
