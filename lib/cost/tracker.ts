import mongoose, { Schema } from "mongoose"
import { connectDB } from "@/lib/db/mongoose"

export interface ICost extends Omit<mongoose.Document, "model"> {
  userId: string
  organizationId?: string
  provider: string // e.g., "openai", "anthropic"
  model: string // e.g., "gpt-4", "claude-3"
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cost: number // Cost in cents
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>
  timestamp: Date
  createdAt: Date
}

const CostSchema = new Schema<ICost>(
  {
    userId: { type: String, required: true, index: true },
    organizationId: { type: String, index: true },
    provider: { type: String, required: true, index: true },
    model: { type: String, required: true, index: true },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    totalTokens: { type: Number, required: true },
    cost: { type: Number, required: true }, // Cost in cents
    metadata: { type: Schema.Types.Mixed },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
)

// Indexes
CostSchema.index({ userId: 1, timestamp: -1 })
CostSchema.index({ organizationId: 1, timestamp: -1 })
CostSchema.index({ provider: 1, model: 1, timestamp: -1 })

export const Cost =
  mongoose.models.Cost ||
  mongoose.model<ICost>("Cost", CostSchema)

// Pricing per 1M tokens (in cents)
const PRICING: Record<string, Record<string, { input: number; output: number }>> = {
  openai: {
    "gpt-4-turbo-preview": { input: 10, output: 30 }, // $0.01/$0.03 per 1K tokens
    "gpt-4": { input: 30, output: 60 },
    "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
  },
  anthropic: {
    "claude-3-opus": { input: 15, output: 75 },
    "claude-3-sonnet": { input: 3, output: 15 },
    "claude-3-haiku": { input: 0.25, output: 1.25 },
  },
}

// Calculate cost
export function calculateCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = PRICING[provider]?.[model]
  if (!pricing) return 0

  const inputCost = (inputTokens / 1_000_000) * pricing.input
  const outputCost = (outputTokens / 1_000_000) * pricing.output

  return Math.round((inputCost + outputCost) * 100) // Convert to cents
}

// Track cost
export async function trackCost(
  data: {
    userId: string
    organizationId?: string
    provider: string
    model: string
    inputTokens: number
    outputTokens: number
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata?: Record<string, any>
  }
): Promise<ICost> {
  await connectDB()

  const totalTokens = data.inputTokens + data.outputTokens
  const cost = calculateCost(
    data.provider,
    data.model,
    data.inputTokens,
    data.outputTokens
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (Cost as any).create({
    userId: data.userId,
    organizationId: data.organizationId,
    provider: data.provider,
    model: data.model,
    inputTokens: data.inputTokens,
    outputTokens: data.outputTokens,
    totalTokens,
    cost,
    metadata: data.metadata,
    timestamp: new Date(),
  })
}

// Get cost summary
export async function getCostSummary(
  filters: {
    userId?: string
    organizationId?: string
    provider?: string
    model?: string
    startDate?: Date
    endDate?: Date
  }
): Promise<{
  totalCost: number // In cents
  totalTokens: number
  breakdown: Array<{
    provider: string
    model: string
    cost: number
    tokens: number
  }>
}> {
  await connectDB()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: any = {}

  if (filters.userId) query.userId = filters.userId
  if (filters.organizationId) query.organizationId = filters.organizationId
  if (filters.provider) query.provider = filters.provider
  if (filters.model) query.model = filters.model

  if (filters.startDate || filters.endDate) {
    query.timestamp = {}
    if (filters.startDate) query.timestamp.$gte = filters.startDate
    if (filters.endDate) query.timestamp.$lte = filters.endDate
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const costs = await (Cost as any).find(query)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalCost = costs.reduce((sum: number, c: any) => sum + c.cost, 0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalTokens = costs.reduce((sum: number, c: any) => sum + c.totalTokens, 0)

  // Breakdown by provider and model
  const breakdownMap = new Map<
    string,
    { provider: string; model: string; cost: number; tokens: number }
  >()

  for (const cost of costs) {
    const key = `${cost.provider}:${cost.model}`
    const existing = breakdownMap.get(key) || {
      provider: cost.provider,
      model: cost.model,
      cost: 0,
      tokens: 0,
    }
    breakdownMap.set(key, {
      ...existing,
      cost: existing.cost + cost.cost,
      tokens: existing.tokens + cost.totalTokens,
    })
  }

  const breakdown = Array.from(breakdownMap.values())

  return {
    totalCost,
    totalTokens,
    breakdown,
  }
}

