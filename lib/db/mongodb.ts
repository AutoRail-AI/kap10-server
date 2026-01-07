// This file is kept for backward compatibility
// New code should use Mongoose models instead
// See lib/db/mongoose.ts for the Mongoose connection

import mongoose from "mongoose"
import connectDB from "./mongoose"

// Re-export Mongoose connection
export { default as connectDB } from "./mongoose"

// Helper to get a Mongoose model (for backward compatibility)
export async function getModel<T>(modelName: string): Promise<mongoose.Model<T>> {
  await connectDB()
  return mongoose.model<T>(modelName)
}

// Legacy exports (deprecated - use Mongoose models instead)
export async function getCollection<T>(
  name: string
): Promise<mongoose.Collection<T>> {
  await connectDB()
  return mongoose.connection.collection<T>(name)
}
