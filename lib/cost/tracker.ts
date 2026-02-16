import { supabase } from "@/lib/db"
import type { Database, Json } from "@/lib/db/types"

export type Cost = Database["public"]["Tables"]["costs"]["Row"]
export type CostInsert = Database["public"]["Tables"]["costs"]["Insert"]

// Cost Tracker functions

export async function trackCost(data: CostInsert): Promise<Cost> {
  const { data: cost, error } = await supabase
    .from("costs")
    .insert(data)
    .select()
    .single()

  if (error) throw error
  return cost
}

export async function getCosts(options?: {
  userId?: string
  organizationId?: string
  provider?: string
  model?: string
  startDate?: string
  endDate?: string
  limit?: number
  offset?: number
}): Promise<Cost[]> {
  let query = supabase
    .from("costs")
    .select("*")
    .order("timestamp", { ascending: false })

  if (options?.userId) query = query.eq("user_id", options.userId)
  if (options?.organizationId) query = query.eq("organization_id", options.organizationId)
  if (options?.provider) query = query.eq("provider", options.provider)
  if (options?.model) query = query.eq("model", options.model)
  if (options?.startDate) query = query.gte("timestamp", options.startDate)
  if (options?.endDate) query = query.lte("timestamp", options.endDate)

  const limit = options?.limit || 50
  const offset = options?.offset || 0
  query = query.range(offset, offset + limit - 1)

  const { data, error } = await query
  if (error) throw error
  return data || []
}

export async function getTotalCost(options?: {
  userId?: string
  organizationId?: string
  startDate?: string
  endDate?: string
}): Promise<{ totalCost: number; totalTokens: number; count: number }> {
  let query = supabase.from("costs").select("cost, total_tokens")

  if (options?.userId) query = query.eq("user_id", options.userId)
  if (options?.organizationId) query = query.eq("organization_id", options.organizationId)
  if (options?.startDate) query = query.gte("timestamp", options.startDate)
  if (options?.endDate) query = query.lte("timestamp", options.endDate)

  const { data, error } = await query
  if (error) throw error

  const rows = data || []
  return {
    totalCost: rows.reduce((sum, r) => sum + (r.cost || 0), 0),
    totalTokens: rows.reduce((sum, r) => sum + (r.total_tokens || 0), 0),
    count: rows.length,
  }
}

export async function getCostsByProvider(options?: {
  userId?: string
  organizationId?: string
  startDate?: string
  endDate?: string
}): Promise<Record<string, { cost: number; tokens: number; count: number }>> {
  let query = supabase.from("costs").select("provider, cost, total_tokens")

  if (options?.userId) query = query.eq("user_id", options.userId)
  if (options?.organizationId) query = query.eq("organization_id", options.organizationId)
  if (options?.startDate) query = query.gte("timestamp", options.startDate)
  if (options?.endDate) query = query.lte("timestamp", options.endDate)

  const { data, error } = await query
  if (error) throw error

  const result: Record<string, { cost: number; tokens: number; count: number }> = {}
  for (const row of data || []) {
    if (!result[row.provider]) {
      result[row.provider] = { cost: 0, tokens: 0, count: 0 }
    }
    result[row.provider]!.cost += row.cost || 0
    result[row.provider]!.tokens += row.total_tokens || 0
    result[row.provider]!.count += 1
  }
  return result
}
