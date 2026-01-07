// Prisma client for Better Auth
export { prisma } from "./prisma"

// Mongoose connection for application features
export { default as connectDB, getModel, getCollection } from "./mongodb"

// Re-export for convenience
export { default as mongoose } from "mongoose"
