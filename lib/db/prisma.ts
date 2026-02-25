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

  const adapter = new PrismaPg({ connectionString: connWithSchema })
  prismaInstance = new PrismaClient({ adapter })
  return prismaInstance
}
