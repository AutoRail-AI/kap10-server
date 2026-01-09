import mongoose, { Schema } from "mongoose"
import { connectDB } from "@/lib/db/mongoose"

export type UsageType =
  | "api_call"
  | "ai_request"
  | "storage"
  | "bandwidth"
  | "feature_usage"

export interface IUsage extends mongoose.Document {
  userId: string
  organizationId?: string
  apiKeyId?: string
  type: UsageType
  resource: string // e.g., "openai.gpt-4", "storage.files"
  quantity: number // e.g., tokens, bytes, requests
  cost?: number // Cost in cents
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>
  timestamp: Date
  createdAt: Date
}

const UsageSchema = new Schema<IUsage>(
  {
    userId: { type: String, required: true, index: true },
    organizationId: { type: String, index: true },
    apiKeyId: { type: String, index: true },
    type: {
      type: String,
      enum: ["api_call", "ai_request", "storage", "bandwidth", "feature_usage"],
      required: true,
      index: true,
    },
    resource: { type: String, required: true, index: true },
    quantity: { type: Number, required: true },
    cost: { type: Number }, // Cost in cents
    metadata: { type: Schema.Types.Mixed },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
)

// Indexes for common queries
UsageSchema.index({ userId: 1, timestamp: -1 })
UsageSchema.index({ organizationId: 1, timestamp: -1 })
UsageSchema.index({ type: 1, resource: 1, timestamp: -1 })

export const Usage =
  mongoose.models.Usage ||
  mongoose.model<IUsage>("Usage", UsageSchema)

// Track usage
export async function trackUsage(
  data: {
    userId: string
    organizationId?: string
    apiKeyId?: string
    type: UsageType
    resource: string
    quantity: number
    cost?: number
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata?: Record<string, any>
  }
): Promise<void> {
  await connectDB()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (Usage as any).create({
    userId: data.userId,
    organizationId: data.organizationId,
    apiKeyId: data.apiKeyId,
    type: data.type,
    resource: data.resource,
    quantity: data.quantity,
    cost: data.cost,
    metadata: data.metadata,
    timestamp: new Date(),
  })
}

// Get usage stats
export async function getUsageStats(
  filters: {
    userId?: string
    organizationId?: string
    type?: UsageType
    resource?: string
    startDate?: Date
    endDate?: Date
  }
): Promise<{
  totalQuantity: number
  totalCost: number
  count: number
  breakdown: Array<{ resource: string; quantity: number; cost: number }>
}> {
  await connectDB()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: any = {}

  if (filters.userId) query.userId = filters.userId
  if (filters.organizationId) query.organizationId = filters.organizationId
  if (filters.type) query.type = filters.type
  if (filters.resource) query.resource = filters.resource

  if (filters.startDate || filters.endDate) {
    query.timestamp = {}
    if (filters.startDate) query.timestamp.$gte = filters.startDate
    if (filters.endDate) query.timestamp.$lte = filters.endDate
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const usage = await (Usage as any).find(query)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalQuantity = usage.reduce((sum: number, u: any) => sum + u.quantity, 0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalCost = usage.reduce((sum: number, u: any) => sum + (u.cost || 0), 0)

  // Breakdown by resource
  const breakdownMap = new Map<string, { quantity: number; cost: number }>()
  for (const u of usage) {
    const existing = breakdownMap.get(u.resource) || { quantity: 0, cost: 0 }
    breakdownMap.set(u.resource, {
      quantity: existing.quantity + u.quantity,
      cost: existing.cost + (u.cost || 0),
    })
  }

  const breakdown = Array.from(breakdownMap.entries()).map(([resource, data]) => ({
    resource,
    ...data,
  }))

  return {
    totalQuantity,
    totalCost,
    count: usage.length,
    breakdown,
  }
}

// Check quota
export interface Quota {
  limit: number
  windowMs: number
  type: UsageType
  resource?: string
}

export async function checkQuota(
  userId: string,
  organizationId: string | undefined,
  quota: Quota
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  await connectDB()

  const now = new Date()
  const windowStart = new Date(now.getTime() - quota.windowMs)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: any = {
    userId,
    type: quota.type,
    timestamp: { $gte: windowStart },
  }

  if (quota.resource) {
    query.resource = quota.resource
  }

  // Check organization-level quota if provided
  if (organizationId) {
    const orgUsage = await Usage.aggregate([
      {
        $match: {
          organizationId,
          type: quota.type,
          timestamp: { $gte: windowStart },
          ...(quota.resource && { resource: quota.resource }),
        },
      },
      { $group: { _id: null, total: { $sum: "$quantity" } } },
    ])

    const orgTotal = orgUsage[0]?.total || 0
    if (orgTotal >= quota.limit) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(now.getTime() + quota.windowMs),
      }
    }
  }

  const userUsage = await Usage.aggregate([
    { $match: query },
    { $group: { _id: null, total: { $sum: "$quantity" } } },
  ])

  const userTotal = userUsage[0]?.total || 0
  const remaining = Math.max(0, quota.limit - userTotal)

  return {
    allowed: userTotal < quota.limit,
    remaining,
    resetAt: new Date(now.getTime() + quota.windowMs),
  }
}

