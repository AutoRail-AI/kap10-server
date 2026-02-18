#!/usr/bin/env tsx
/**
 * Reset all Supabase data for local/testing. Keeps schema and schema_migrations.
 * Usage: pnpm reset-db (or pnpm tsx scripts/reset-db.ts)
 *
 * Requires: SUPABASE_DB_URL in .env.local (or DATABASE_URL).
 */

import { config } from "dotenv"
import { Pool } from "pg"
import path from "node:path"

config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true })
config({ path: path.resolve(process.cwd(), ".env"), quiet: true })

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
    connectionTimeoutMillis: 10000,
  })

  try {
    console.log("Resetting all data (keeping schema and migration history)...")

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

    // Kap10 schema: repos, deletion_logs, github_installations
    await pool.query(`
      TRUNCATE TABLE
        kap10.deletion_logs,
        kap10.repos,
        kap10.github_installations
      RESTART IDENTITY CASCADE
    `)
    console.log("  ✓ kap10 schema tables truncated")

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
