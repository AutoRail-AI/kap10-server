#!/usr/bin/env tsx
/**
 * Supabase/Postgres migration runner.
 * Applies SQL files from supabase/migrations/ in order and records them in schema_migrations.
 * Run automatically before pnpm dev (predev), or manually: pnpm migrate
 *
 * Requires: SUPABASE_DB_URL in .env.local (or DATABASE_URL).
 */

import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { config } from "dotenv"

// Load .env.local first (Next.js convention), then .env
config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true })
config({ path: path.resolve(process.cwd(), ".env"), quiet: true })

import { Pool } from "pg"

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations")
const MIGRATION_TABLE = "schema_migrations"

function getDbUrl(): string | undefined {
  return process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL
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

async function main(): Promise<void> {
  const dbUrl = getDbUrl()
  if (!dbUrl) {
    console.error("Missing SUPABASE_DB_URL or DATABASE_URL. Set it in .env.local")
    process.exit(1)
  }

  const connectionString =
    dbUrl +
    (dbUrl.includes("?") ? "&" : "?") +
    "options=-c%20search_path%3Dpublic"

  let migrationsDir: string[]
  try {
    migrationsDir = await readdir(MIGRATIONS_DIR)
  } catch (err) {
    console.error("Migrations directory not found:", MIGRATIONS_DIR)
    process.exit(1)
  }

  const sqlFiles = migrationsDir.filter((f) => f.endsWith(".sql")).sort()
  if (sqlFiles.length === 0) {
    console.log("No migration files found.")
    process.exit(0)
  }

  const pool = new Pool({
    connectionString,
    ssl: dbUrl.includes("supabase.co") ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 10000,
  })

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
    }

    if (appliedCount === 0) {
      console.log("No pending migrations. Database is up to date.")
    } else {
      console.log(`Applied ${appliedCount} migration(s).`)
    }
  } catch (err) {
    console.error("Migration failed:", err)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

main()
