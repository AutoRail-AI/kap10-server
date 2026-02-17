import { supabase } from "@/lib/db"
import type { Database } from "@/lib/db/types"

export type Subscription = Database["public"]["Tables"]["subscriptions"]["Row"]
export type SubscriptionInsert = Database["public"]["Tables"]["subscriptions"]["Insert"]
export type SubscriptionUpdate = Database["public"]["Tables"]["subscriptions"]["Update"]

// Billing / Subscription model functions

export async function getSubscription(userId: string): Promise<Subscription | null> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function getSubscriptionByStripeCustomerId(
  stripeCustomerId: string
): Promise<Subscription | null> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function getSubscriptionByStripeSubId(
  stripeSubscriptionId: string
): Promise<Subscription | null> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("stripe_subscription_id", stripeSubscriptionId)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function createSubscription(
  data: SubscriptionInsert
): Promise<Subscription> {
  const { data: subscription, error } = await supabase
    .from("subscriptions")
    .insert(data)
    .select()
    .single()

  if (error) throw error
  return subscription
}

export async function updateSubscription(
  id: string,
  updates: SubscriptionUpdate
): Promise<Subscription> {
  const { data: subscription, error } = await supabase
    .from("subscriptions")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single()

  if (error) throw error
  return subscription
}

export async function updateSubscriptionByStripeSubId(
  stripeSubscriptionId: string,
  updates: SubscriptionUpdate
): Promise<Subscription> {
  const { data: subscription, error } = await supabase
    .from("subscriptions")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", stripeSubscriptionId)
    .select()
    .single()

  if (error) throw error
  return subscription
}

export async function deleteSubscription(id: string): Promise<void> {
  const { error } = await supabase
    .from("subscriptions")
    .delete()
    .eq("id", id)

  if (error) throw error
}
