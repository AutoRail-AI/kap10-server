import { supabase } from "@/lib/db"
import type { Database, Json } from "@/lib/db/types"

export type Usage = Database["public"]["Tables"]["usage"]["Row"]
export type UsageInsert = Database["public"]["Tables"]["usage"]["Insert"]

// Usage Tracker functions

export async function trackUsage(data: UsageInsert): Promise<Usage> {
  const { data: usage, error } = await supabase
    .from("usage")
    .insert(data)
    .select()
    .single()

  if (error) throw error
  return usage
}

export async function getUsage(options?: {
  userId?: string
  organizationId?: string
  type?: string
  resource?: string
  startDate?: string
  endDate?: string
  limit?: number
  offset?: number
}): Promise<Usage[]> {
  let query = supabase
    .from("usage")
    .select("*")
    .order("timestamp", { ascending: false })

  if (options?.userId) query = query.eq("user_id", options.userId)
  if (options?.organizationId) query = query.eq("organization_id", options.organizationId)
  if (options?.type) query = query.eq("type", options.type)
  if (options?.resource) query = query.eq("resource", options.resource)
  if (options?.startDate) query = query.gte("timestamp", options.startDate)
  if (options?.endDate) query = query.lte("timestamp", options.endDate)

  const limit = options?.limit || 50
  const offset = options?.offset || 0
  query = query.range(offset, offset + limit - 1)

  const { data, error } = await query
  if (error) throw error
  return data || []
}

export async function getUsageSummary(options?: {
  userId?: string
  organizationId?: string
  startDate?: string
  endDate?: string
}): Promise<Record<string, { quantity: number; cost: number; count: number }>> {
  let query = supabase.from("usage").select("type, quantity, cost")

  if (options?.userId) query = query.eq("user_id", options.userId)
  if (options?.organizationId) query = query.eq("organization_id", options.organizationId)
  if (options?.startDate) query = query.gte("timestamp", options.startDate)
  if (options?.endDate) query = query.lte("timestamp", options.endDate)

  const { data, error } = await query
  if (error) throw error

  const result: Record<string, { quantity: number; cost: number; count: number }> = {}
  for (const row of data || []) {
    if (!result[row.type]) {
      result[row.type] = { quantity: 0, cost: 0, count: 0 }
    }
    result[row.type]!.quantity += row.quantity || 0
    result[row.type]!.cost += row.cost || 0
    result[row.type]!.count += 1
  }
  return result
}

export async function getUsageCount(options?: {
  userId?: string
  organizationId?: string
  type?: string
}): Promise<number> {
  let query = supabase
    .from("usage")
    .select("id", { count: "exact", head: true })

  if (options?.userId) query = query.eq("user_id", options.userId)
  if (options?.organizationId) query = query.eq("organization_id", options.organizationId)
  if (options?.type) query = query.eq("type", options.type)

  const { count, error } = await query
  if (error) throw error
  return count || 0
}

export async function checkQuota(
  userId: string,
  type: string,
  maxQuantity: number,
  windowStartDate: string
): Promise<{ used: number; remaining: number; exceeded: boolean }> {
  const { data, error } = await supabase
    .from("usage")
    .select("quantity")
    .eq("user_id", userId)
    .eq("type", type)
    .gte("timestamp", windowStartDate)

  if (error) throw error

  const used = (data || []).reduce((sum, r) => sum + (r.quantity || 0), 0)
  return {
    used,
    remaining: Math.max(0, maxQuantity - used),
    exceeded: used >= maxQuantity,
  }
}
