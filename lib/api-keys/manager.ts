import { supabase } from "@/lib/db"
import crypto from "node:crypto"
import type { Database, Json } from "@/lib/db/types"

export type ApiKey = Database["public"]["Tables"]["api_keys"]["Row"]
export type ApiKeyInsert = Database["public"]["Tables"]["api_keys"]["Insert"]
export type ApiKeyUpdate = Database["public"]["Tables"]["api_keys"]["Update"]

// API Key Manager functions

function generateApiKey(): { key: string; prefix: string } {
  const key = `sk_${crypto.randomBytes(32).toString("hex")}`
  const prefix = key.substring(0, 12)
  return { key, prefix }
}

export async function createApiKey(
  userId: string,
  name: string,
  options?: {
    organizationId?: string
    scopes?: string[]
    expiresAt?: string
    rateLimit?: { windowMs: number; maxRequests: number }
  }
): Promise<ApiKey & { rawKey: string }> {
  const { key, prefix } = generateApiKey()
  const hashedKey = crypto.createHash("sha256").update(key).digest("hex")

  const { data: apiKey, error } = await supabase
    .from("api_keys")
    .insert({
      user_id: userId,
      organization_id: options?.organizationId || null,
      name,
      key: hashedKey,
      key_prefix: prefix,
      scopes: options?.scopes || ["read", "write"],
      expires_at: options?.expiresAt || null,
      rate_limit: (options?.rateLimit as Json) || null,
      enabled: true,
    })
    .select()
    .single()

  if (error) throw error
  return { ...apiKey, rawKey: key }
}

export async function verifyApiKey(
  rawKey: string
): Promise<ApiKey | null> {
  const hashedKey = crypto.createHash("sha256").update(rawKey).digest("hex")

  const { data: apiKey, error } = await supabase
    .from("api_keys")
    .select("*")
    .eq("key", hashedKey)
    .eq("enabled", true)
    .maybeSingle()

  if (error) throw error
  if (!apiKey) return null

  // Check expiration
  if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
    return null
  }

  // Update last used timestamp
  await supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", apiKey.id)

  return apiKey
}

export async function getApiKeys(userId: string): Promise<ApiKey[]> {
  const { data, error } = await supabase
    .from("api_keys")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })

  if (error) throw error
  return data || []
}

export async function getApiKeysByOrganization(
  organizationId: string
): Promise<ApiKey[]> {
  const { data, error } = await supabase
    .from("api_keys")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })

  if (error) throw error
  return data || []
}

export async function revokeApiKey(id: string): Promise<void> {
  const { error } = await supabase
    .from("api_keys")
    .update({ enabled: false, updated_at: new Date().toISOString() })
    .eq("id", id)

  if (error) throw error
}

export async function deleteApiKey(id: string): Promise<void> {
  const { error } = await supabase
    .from("api_keys")
    .delete()
    .eq("id", id)

  if (error) throw error
}
