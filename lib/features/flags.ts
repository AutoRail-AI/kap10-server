import { supabase } from "@/lib/db"
import type { Database, Json } from "@/lib/db/types"

export type FeatureFlag = Database["public"]["Tables"]["feature_flags"]["Row"]
export type FeatureFlagInsert = Database["public"]["Tables"]["feature_flags"]["Insert"]
export type FeatureFlagUpdate = Database["public"]["Tables"]["feature_flags"]["Update"]

// Feature Flags functions

export async function getFeatureFlag(key: string): Promise<FeatureFlag | null> {
  const { data, error } = await supabase
    .from("feature_flags")
    .select("*")
    .eq("key", key)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function getAllFeatureFlags(): Promise<FeatureFlag[]> {
  const { data, error } = await supabase
    .from("feature_flags")
    .select("*")
    .order("key", { ascending: true })

  if (error) throw error
  return data || []
}

export async function createFeatureFlag(
  data: FeatureFlagInsert
): Promise<FeatureFlag> {
  const { data: flag, error } = await supabase
    .from("feature_flags")
    .insert(data)
    .select()
    .single()

  if (error) throw error
  return flag
}

export async function updateFeatureFlag(
  key: string,
  updates: FeatureFlagUpdate
): Promise<FeatureFlag> {
  const { data: flag, error } = await supabase
    .from("feature_flags")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("key", key)
    .select()
    .single()

  if (error) throw error
  return flag
}

export async function deleteFeatureFlag(key: string): Promise<void> {
  const { error } = await supabase
    .from("feature_flags")
    .delete()
    .eq("key", key)

  if (error) throw error
}

export async function isFeatureEnabled(
  key: string,
  context?: { userId?: string; organizationId?: string; environment?: string }
): Promise<boolean> {
  const flag = await getFeatureFlag(key)
  if (!flag || !flag.enabled) return false

  // Check environment
  if (context?.environment && flag.environments?.length) {
    if (!flag.environments.includes(context.environment)) return false
  }

  // Check targeted users
  if (context?.userId && flag.target_users?.length) {
    if (flag.target_users.includes(context.userId)) return true
  }

  // Check targeted organizations
  if (context?.organizationId && flag.target_organizations?.length) {
    if (flag.target_organizations.includes(context.organizationId)) return true
  }

  // Check rollout percentage
  if (flag.rollout_percentage < 100) {
    if (!context?.userId) return false
    // Deterministic hash-based rollout
    const hash = simpleHash(context.userId + key)
    return (hash % 100) < flag.rollout_percentage
  }

  return true
}

function simpleHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit int
  }
  return Math.abs(hash)
}
