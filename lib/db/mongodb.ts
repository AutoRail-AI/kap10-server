// This file is kept for backward compatibility
// New code should use Mongoose models instead
// See lib/db/mongoose.ts for the Mongoose connection

import mongoose from "mongoose"
import connectDBDefault from "./mongoose"

// Re-export Mongoose connection
export { default as connectDB } from "./mongoose"
export default connectDBDefault

// Helper to get a Mongoose model (for backward compatibility)
export async function getModel<T extends mongoose.Document>(modelName: string): Promise<mongoose.Model<T>> {
  await connectDBDefault()
  return mongoose.model<T>(modelName)
}

// Legacy exports (deprecated - use Mongoose models instead)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getCollection<T = any>(
  name: string
): Promise<mongoose.Collection> {
  await connectDBDefault()
  return mongoose.connection.collection(name)
}
