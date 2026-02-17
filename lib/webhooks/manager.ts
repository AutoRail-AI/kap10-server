import crypto from "node:crypto"
import { supabase } from "@/lib/db"
import type { Database } from "@/lib/db/types"

export type Webhook = Database["public"]["Tables"]["webhooks"]["Row"]
export type WebhookInsert = Database["public"]["Tables"]["webhooks"]["Insert"]
export type WebhookUpdate = Database["public"]["Tables"]["webhooks"]["Update"]

// Webhook Manager functions

export async function createWebhook(
  organizationId: string,
  url: string,
  events: string[]
): Promise<Webhook> {
  const secret = `whsec_${crypto.randomBytes(24).toString("hex")}`

  const { data: webhook, error } = await supabase
    .from("webhooks")
    .insert({
      organization_id: organizationId,
      url,
      secret,
      events,
      enabled: true,
      failure_count: 0,
    })
    .select()
    .single()

  if (error) throw error
  return webhook
}

export async function getWebhooks(organizationId: string): Promise<Webhook[]> {
  const { data, error } = await supabase
    .from("webhooks")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })

  if (error) throw error
  return data || []
}

export async function getWebhook(id: string): Promise<Webhook | null> {
  const { data, error } = await supabase
    .from("webhooks")
    .select("*")
    .eq("id", id)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function updateWebhook(
  id: string,
  updates: WebhookUpdate
): Promise<Webhook> {
  const { data: webhook, error } = await supabase
    .from("webhooks")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single()

  if (error) throw error
  return webhook
}

export async function deleteWebhook(id: string): Promise<void> {
  const { error } = await supabase
    .from("webhooks")
    .delete()
    .eq("id", id)

  if (error) throw error
}

export async function getWebhooksForEvent(
  event: string,
  organizationId?: string
): Promise<Webhook[]> {
  let query = supabase
    .from("webhooks")
    .select("*")
    .eq("enabled", true)
    .contains("events", [event])

  if (organizationId) {
    query = query.eq("organization_id", organizationId)
  }

  const { data, error } = await query
  if (error) throw error
  return data || []
}

export function generateSignature(payload: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex")
}

export function verifySignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = generateSignature(payload, secret)
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  )
}

export async function recordWebhookFailure(id: string): Promise<void> {
  const webhook = await getWebhook(id)
  if (!webhook) return

  const newCount = (webhook.failure_count || 0) + 1
  const updates: WebhookUpdate = {
    failure_count: newCount,
    updated_at: new Date().toISOString(),
  }

  // Auto-disable after 10 consecutive failures
  if (newCount >= 10) {
    updates.enabled = false
  }

  await supabase.from("webhooks").update(updates).eq("id", id)
}

export async function recordWebhookSuccess(id: string): Promise<void> {
  await supabase
    .from("webhooks")
    .update({
      failure_count: 0,
      last_triggered_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
}
