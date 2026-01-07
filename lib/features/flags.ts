import { connectDB } from "@/lib/db/mongoose"
import mongoose, { Schema } from "mongoose"

// Feature flag model
export interface IFeatureFlag extends mongoose.Document {
  key: string
  name: string
  description: string
  enabled: boolean
  rolloutPercentage: number // 0-100
  targetUsers?: string[] // User IDs
  targetOrganizations?: string[] // Organization IDs
  environments: string[] // ["development", "production"]
  createdAt: Date
  updatedAt: Date
}

const FeatureFlagSchema = new Schema<IFeatureFlag>(
  {
    key: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    description: { type: String },
    enabled: { type: Boolean, default: false },
    rolloutPercentage: { type: Number, default: 100, min: 0, max: 100 },
    targetUsers: [{ type: String }],
    targetOrganizations: [{ type: String }],
    environments: [{ type: String, default: ["production"] }],
  },
  { timestamps: true }
)

export const FeatureFlag =
  mongoose.models.FeatureFlag ||
  mongoose.model<IFeatureFlag>("FeatureFlag", FeatureFlagSchema)

// Check if feature is enabled
export async function isFeatureEnabled(
  key: string,
  userId?: string,
  organizationId?: string
): Promise<boolean> {
  await connectDB()

  const flag = await FeatureFlag.findOne({ key })
  if (!flag) return false

  // Check environment
  const env = process.env.NODE_ENV || "development"
  if (!flag.environments.includes(env)) return false

  if (!flag.enabled) return false

  // Check if user is in target list
  if (userId && flag.targetUsers?.includes(userId)) {
    return true
  }

  // Check if organization is in target list
  if (organizationId && flag.targetOrganizations?.includes(organizationId)) {
    return true
  }

  // Check rollout percentage
  if (flag.rolloutPercentage < 100) {
    // Simple hash-based rollout
    const hash = userId
      ? hashString(userId + key)
      : hashString(organizationId + key || key)
    return hash % 100 < flag.rolloutPercentage
  }

  return true
}

// Get all enabled features for user
export async function getEnabledFeatures(
  userId?: string,
  organizationId?: string
): Promise<string[]> {
  await connectDB()

  const flags = await FeatureFlag.find({ enabled: true })
  const enabled: string[] = []

  for (const flag of flags) {
    if (await isFeatureEnabled(flag.key, userId, organizationId)) {
      enabled.push(flag.key)
    }
  }

  return enabled
}

// Helper function to hash string
function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return Math.abs(hash)
}

