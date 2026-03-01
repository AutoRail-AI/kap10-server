/**
 * Shared PrismaClient singleton for API routes that query unerr-schema tables
 * (e.g., GraphSnapshotMeta) outside the DI container.
 *
 * Uses lazy initialization with PrismaPg adapter (Prisma 7 requirement).
 * Reuses the same connection for the lifetime of the process.
 */

let prismaInstance: InstanceType<typeof import("@prisma/client").PrismaClient> | null = null

export function getPrisma(): InstanceType<typeof import("@prisma/client").PrismaClient> {
  if (prismaInstance) return prismaInstance

  const { PrismaPg } = require("@prisma/adapter-pg") as typeof import("@prisma/adapter-pg")
  const { PrismaClient } = require("@prisma/client") as typeof import("@prisma/client")

  const connectionString = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error("PrismaClient requires SUPABASE_DB_URL or DATABASE_URL")
  }

  // Set search_path so Prisma resolves unerr-schema tables alongside public-schema tables.
  // See: prisma/prisma#28611
  const searchPath = "unerr,public"
  const separator = connectionString.includes("?") ? "&" : "?"
  const connWithSchema = connectionString + separator + "options=-c%20search_path%3D" + encodeURIComponent(searchPath)

  // Use an explicit pg.Pool with a small max to avoid exhausting
  // Supabase session-mode pooler (pool_size is typically 10-15).
  // Better Auth uses another pool (max: 2), so keep this small.
  const { Pool } = require("pg") as typeof import("pg")
  const pool = new Pool({
    connectionString: connWithSchema,
    max: 3,
    ssl: connectionString.includes("supabase.co")
      ? { rejectUnauthorized: false }
      : undefined,
  })
  const adapter = new PrismaPg(pool)
  prismaInstance = new PrismaClient({ adapter })
  return prismaInstance
}
