#!/usr/bin/env tsx
/**
 * Supabase/Postgres migration runner.
 * Applies SQL files from supabase/migrations/ in order and records them in schema_migrations.
 * Run automatically before pnpm dev (predev), or manually: pnpm migrate
 *
 * Requires: SUPABASE_DB_URL in .env.local (or DATABASE_URL).
 */

import "./load-env"

import { Pool } from "pg"
import { execSync } from "node:child_process"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"


const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations")
const MIGRATION_TABLE = "schema_migrations"

function getDbUrl(): string | undefined {
  return process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL
}

function createPool(connectionString: string, dbUrl: string): Pool {
  return new Pool({
    connectionString,
    ssl: dbUrl.includes("supabase.co") ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 30000,
  })
}

async function getAppliedMigrations(client: Pool): Promise<Set<string>> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.${MIGRATION_TABLE} (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  const { rows } = await client.query<{ name: string }>(
    `SELECT name FROM public.${MIGRATION_TABLE} ORDER BY name`
  )
  return new Set(rows.map((r) => r.name))
}

async function runMigration(client: Pool, name: string, sql: string): Promise<void> {
  // ALTER TYPE ... ADD VALUE cannot run inside a transaction in PostgreSQL < 16.
  // Also, CREATE EXTENSION may need to commit before the type is visible.
  // Detect these cases and run without a wrapping transaction.
  const needsNoTx =
    /ALTER\s+TYPE\s+.*\bADD\s+VALUE\b/i.test(sql) ||
    /CREATE\s+EXTENSION\b/i.test(sql)

  if (needsNoTx) {
    await client.query(sql)
    await client.query(
      `INSERT INTO public.${MIGRATION_TABLE} (name) VALUES ($1)`,
      [name]
    )
  } else {
    await client.query("BEGIN")
    try {
      await client.query(sql)
      await client.query(
        `INSERT INTO public.${MIGRATION_TABLE} (name) VALUES ($1)`,
        [name]
      )
      await client.query("COMMIT")
    } catch (err) {
      await client.query("ROLLBACK")
      throw err
    }
  }
}

async function bootstrapArangoDB(): Promise<void> {
  const url = process.env.ARANGODB_URL ?? "http://localhost:8529"
  const password = process.env.ARANGO_ROOT_PASSWORD ?? "firstPassword12345"
  const databaseName = process.env.ARANGODB_DATABASE ?? "unerr_db"

  let Database: typeof import("arangojs").Database
  try {
    ;({ Database } = require("arangojs") as typeof import("arangojs"))
  } catch {
    console.log("ArangoDB: arangojs not installed — skipping bootstrap.")
    return
  }

  // Check if ArangoDB is reachable
  const base = new Database({ url, auth: { username: "root", password } })
  try {
    await base.version()
  } catch {
    console.log("ArangoDB: not reachable at", url, "— skipping bootstrap.")
    return
  }

  // Create database if needed
  try {
    await base.createDatabase(databaseName)
    console.log(`ArangoDB: created database "${databaseName}".`)
  } catch {
    // already exists
  }

  const db = base.database(databaseName)

  const DOC_COLLECTIONS = [
    "repos", "files", "functions", "classes", "interfaces", "variables",
    "patterns", "rules", "snippets", "ledger",
    "justifications", "features_agg", "health_reports", "domain_ontologies",
    "drift_scores", "adrs", "token_usage_log", "index_events",
    "ledger_summaries", "working_snapshots", "rule_health", "mined_patterns", "impact_reports",
  ]
  const EDGE_COLLECTIONS = [
    "contains", "calls", "imports", "extends", "implements",
    "rule_exceptions", "language_implementations",
  ]

  let created = 0
  for (const name of DOC_COLLECTIONS) {
    const col = db.collection(name)
    try {
      await col.create()
      created++
    } catch { /* exists */ }
    try {
      await col.ensureIndex({ type: "persistent", fields: ["org_id", "repo_id"], name: `idx_${name}_org_repo` })
    } catch { /* exists */ }
  }

  for (const name of EDGE_COLLECTIONS) {
    const col = db.collection(name)
    try {
      await col.create({ type: 3 })
      created++
    } catch { /* exists */ }
    try {
      await col.ensureIndex({ type: "persistent", fields: ["org_id", "repo_id"], name: `idx_${name}_org_repo` })
    } catch { /* exists */ }
  }

  if (created === 0) {
    console.log("ArangoDB: all collections already exist — up to date.")
  } else {
    console.log(`ArangoDB: created ${created} collection(s).`)
  }
}

async function main(): Promise<void> {
  // ── ArangoDB bootstrap (non-blocking — skips if unreachable) ──
  await bootstrapArangoDB()

  const dbUrl = getDbUrl()
  if (!dbUrl) {
    console.error("Missing SUPABASE_DB_URL or DATABASE_URL. Set it in .env.local")
    process.exit(1)
  }

  const connectionString =
    dbUrl +
    (dbUrl.includes("?") ? "&" : "?") +
    "options=-c%20search_path%3Dpublic,extensions"

  let migrationsDir: string[]
  try {
    migrationsDir = await readdir(MIGRATIONS_DIR)
  } catch (_err) {
    console.error("Migrations directory not found:", MIGRATIONS_DIR)
    process.exit(1)
  }

  const sqlFiles = migrationsDir.filter((f) => f.endsWith(".sql")).sort()
  if (sqlFiles.length === 0) {
    console.log("No migration files found.")
    process.exit(0)
  }

  let pool = createPool(connectionString, dbUrl)

  try {
    const applied = await getAppliedMigrations(pool)
    let appliedCount = 0

    for (const file of sqlFiles) {
      const name = file
      if (applied.has(name)) continue
      const filePath = path.join(MIGRATIONS_DIR, file)
      const sql = await readFile(filePath, "utf-8")
      console.log("Applying migration:", name)
      await runMigration(pool, name, sql)
      appliedCount++

      // After CREATE EXTENSION, reconnect so new types are visible to subsequent migrations
      if (/CREATE\s+EXTENSION\b/i.test(sql)) {
        await pool.end()
        pool = createPool(connectionString, dbUrl)
      }
    }

    if (appliedCount === 0) {
      console.log("No pending migrations. Database is up to date.")
    } else {
      console.log(`Applied ${appliedCount} migration(s).`)
    }

    // Better Auth tables: only run Better Auth migrate if its tables don't exist yet.
    // Better Auth's CLI uses CREATE TABLE (not IF NOT EXISTS), so it fails on re-runs.
    const { rows: authCheck } = await pool.query(`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'user'
      LIMIT 1
    `)
    if (authCheck.length === 0) {
      console.log("Better Auth tables not found — running Better Auth migrate...")
      await pool.end()
      try {
        execSync(
          'pnpm dlx dotenv-cli -e .env.local -- pnpm dlx @better-auth/cli@latest migrate --config ./lib/auth/better-auth.cli.ts --yes',
          { stdio: "inherit", cwd: process.cwd() }
        )
        console.log("Better Auth migration completed.")
      } catch (err: unknown) {
        console.error("Better Auth migration failed:", err instanceof Error ? err.message : String(err))
        process.exit(1)
      }
    } else {
      console.log("Better Auth tables already exist — skipping Better Auth migrate.")
    }
  } catch (err) {
    console.error("Migration failed:", err)
    process.exit(1)
  } finally {
    // Pool may already be ended if Better Auth migrate ran
    await pool.end().catch(() => {})
  }
}

main()
