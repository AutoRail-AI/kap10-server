import { supabase } from "@/lib/db"
import type { Database } from "@/lib/db/types"

export type AuditLog = Database["public"]["Tables"]["audit_logs"]["Row"]
export type AuditLogInsert = Database["public"]["Tables"]["audit_logs"]["Insert"]

// Audit Logger functions

export async function logAction(data: AuditLogInsert): Promise<AuditLog> {
  const { data: log, error } = await supabase
    .from("audit_logs")
    .insert(data)
    .select()
    .single()

  if (error) throw error
  return log
}

export async function getAuditLogs(options?: {
  userId?: string
  organizationId?: string
  action?: string
  resource?: string
  limit?: number
  offset?: number
  startDate?: string
  endDate?: string
}): Promise<AuditLog[]> {
  let query = supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })

  if (options?.userId) {
    query = query.eq("user_id", options.userId)
  }
  if (options?.organizationId) {
    query = query.eq("organization_id", options.organizationId)
  }
  if (options?.action) {
    query = query.eq("action", options.action)
  }
  if (options?.resource) {
    query = query.eq("resource", options.resource)
  }
  if (options?.startDate) {
    query = query.gte("created_at", options.startDate)
  }
  if (options?.endDate) {
    query = query.lte("created_at", options.endDate)
  }

  const limit = options?.limit || 50
  const offset = options?.offset || 0
  query = query.range(offset, offset + limit - 1)

  const { data, error } = await query
  if (error) throw error
  return data || []
}

export async function getAuditLogCount(options?: {
  userId?: string
  organizationId?: string
  action?: string
}): Promise<number> {
  let query = supabase
    .from("audit_logs")
    .select("id", { count: "exact", head: true })

  if (options?.userId) {
    query = query.eq("user_id", options.userId)
  }
  if (options?.organizationId) {
    query = query.eq("organization_id", options.organizationId)
  }
  if (options?.action) {
    query = query.eq("action", options.action)
  }

  const { count, error } = await query
  if (error) throw error
  return count || 0
}

export async function deleteAuditLogs(
  organizationId: string,
  olderThan?: string
): Promise<void> {
  let query = supabase
    .from("audit_logs")
    .delete()
    .eq("organization_id", organizationId)

  if (olderThan) {
    query = query.lt("created_at", olderThan)
  }

  const { error } = await query
  if (error) throw error
}
