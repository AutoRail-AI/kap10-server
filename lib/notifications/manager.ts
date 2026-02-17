import { supabase } from "@/lib/db"
import type { Database } from "@/lib/db/types"

export type Notification = Database["public"]["Tables"]["notifications"]["Row"]
export type NotificationInsert = Database["public"]["Tables"]["notifications"]["Insert"]

// Notification Manager functions

export async function createNotification(
  data: NotificationInsert
): Promise<Notification> {
  const { data: notification, error } = await supabase
    .from("notifications")
    .insert(data)
    .select()
    .single()

  if (error) throw error
  return notification
}

export async function createBulkNotifications(
  notifications: NotificationInsert[]
): Promise<Notification[]> {
  const { data, error } = await supabase
    .from("notifications")
    .insert(notifications)
    .select()

  if (error) throw error
  return data || []
}

export async function getNotifications(
  userId: string,
  options?: {
    unreadOnly?: boolean
    type?: string
    limit?: number
    offset?: number
  }
): Promise<Notification[]> {
  let query = supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })

  if (options?.unreadOnly) {
    query = query.eq("read", false)
  }
  if (options?.type) {
    query = query.eq("type", options.type)
  }

  const limit = options?.limit || 50
  const offset = options?.offset || 0
  query = query.range(offset, offset + limit - 1)

  const { data, error } = await query
  if (error) throw error
  return data || []
}

export async function getUnreadCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("read", false)

  if (error) throw error
  return count || 0
}

export async function markAsRead(notificationId: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ read: true, read_at: new Date().toISOString() })
    .eq("id", notificationId)

  if (error) throw error
}

export async function markAllAsRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ read: true, read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("read", false)

  if (error) throw error
}

export async function deleteNotification(id: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("id", id)

  if (error) throw error
}

export async function deleteOldNotifications(
  userId: string,
  olderThan: string
): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("user_id", userId)
    .lt("created_at", olderThan)

  if (error) throw error
}
