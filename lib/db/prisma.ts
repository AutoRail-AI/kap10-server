// Lazy import to allow Better Auth CLI to read config without Prisma client
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let PrismaClient: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prismaInstance: any

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const prismaModule = require("@prisma/client")
  PrismaClient = prismaModule.PrismaClient
  
  const globalForPrisma = globalThis as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma: any | undefined
  }

  prismaInstance =
    globalForPrisma.prisma ??
    new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
    })

  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prismaInstance
} catch (_error) {
  // Prisma client not generated yet - this is expected during initial setup
  // Better Auth CLI will generate the schema, then we can generate the client
  if (process.env.NODE_ENV !== "test") {
    console.warn("Prisma client not found. Run 'npx prisma generate' after generating Better Auth schema.")
  }
  prismaInstance = null
}

export const prisma = prismaInstance

