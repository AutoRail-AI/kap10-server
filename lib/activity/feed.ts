import { supabase } from "@/lib/db"
import type { Database } from "@/lib/db/types"

export type Activity = Database["public"]["Tables"]["activities"]["Row"]
export type ActivityInsert = Database["public"]["Tables"]["activities"]["Insert"]

// Activity Feed functions

export async function createActivity(data: ActivityInsert): Promise<Activity> {
  const { data: activity, error } = await supabase
    .from("activities")
    .insert(data)
    .select()
    .single()

  if (error) throw error
  return activity
}

export async function getActivities(
  organizationId: string,
  options?: {
    limit?: number
    offset?: number
    type?: string
    userId?: string
  }
): Promise<Activity[]> {
  let query = supabase
    .from("activities")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })

  if (options?.type) {
    query = query.eq("type", options.type)
  }
  if (options?.userId) {
    query = query.eq("user_id", options.userId)
  }
  if (options?.limit) {
    query = query.limit(options.limit)
  }
  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 50) - 1)
  }

  const { data, error } = await query
  if (error) throw error
  return data || []
}

export async function getActivitiesByUser(
  userId: string,
  limit = 50
): Promise<Activity[]> {
  const { data, error } = await supabase
    .from("activities")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) throw error
  return data || []
}

export async function getActivitiesByResource(
  resource: string,
  resourceId: string,
  limit = 50
): Promise<Activity[]> {
  const { data, error } = await supabase
    .from("activities")
    .select("*")
    .eq("resource", resource)
    .eq("resource_id", resourceId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) throw error
  return data || []
}

export async function deleteActivitiesForOrganization(
  organizationId: string
): Promise<void> {
  const { error } = await supabase
    .from("activities")
    .delete()
    .eq("organization_id", organizationId)

  if (error) throw error
}
