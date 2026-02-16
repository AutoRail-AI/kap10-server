import { supabase } from "@/lib/db"
import type { Database, Json } from "@/lib/db/types"

export type Template = Database["public"]["Tables"]["templates"]["Row"]
export type TemplateInsert = Database["public"]["Tables"]["templates"]["Insert"]
export type TemplateUpdate = Database["public"]["Tables"]["templates"]["Update"]

// Template Manager functions

export async function createTemplate(data: TemplateInsert): Promise<Template> {
  const { data: template, error } = await supabase
    .from("templates")
    .insert(data)
    .select()
    .single()

  if (error) throw error
  return template
}

export async function getTemplate(id: string): Promise<Template | null> {
  const { data, error } = await supabase
    .from("templates")
    .select("*")
    .eq("id", id)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function getTemplates(options?: {
  userId?: string
  organizationId?: string
  type?: string
  category?: string
  publicOnly?: boolean
  featured?: boolean
  tags?: string[]
  limit?: number
  offset?: number
  search?: string
}): Promise<Template[]> {
  let query = supabase
    .from("templates")
    .select("*")
    .order("created_at", { ascending: false })

  if (options?.userId) query = query.eq("user_id", options.userId)
  if (options?.organizationId) query = query.eq("organization_id", options.organizationId)
  if (options?.type) query = query.eq("type", options.type)
  if (options?.category) query = query.eq("category", options.category)
  if (options?.publicOnly) query = query.eq("public", true)
  if (options?.featured) query = query.eq("featured", true)
  if (options?.tags?.length) query = query.overlaps("tags", options.tags)
  if (options?.search) {
    query = query.or(`name.ilike.%${options.search}%,description.ilike.%${options.search}%`)
  }

  const limit = options?.limit || 50
  const offset = options?.offset || 0
  query = query.range(offset, offset + limit - 1)

  const { data, error } = await query
  if (error) throw error
  return data || []
}

export async function updateTemplate(
  id: string,
  updates: TemplateUpdate
): Promise<Template> {
  const { data: template, error } = await supabase
    .from("templates")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single()

  if (error) throw error
  return template
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase
    .from("templates")
    .delete()
    .eq("id", id)

  if (error) throw error
}

export async function incrementUsageCount(id: string): Promise<void> {
  const template = await getTemplate(id)
  if (!template) return

  await supabase
    .from("templates")
    .update({
      usage_count: (template.usage_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
}

export async function getPopularTemplates(
  limit = 10,
  type?: string
): Promise<Template[]> {
  let query = supabase
    .from("templates")
    .select("*")
    .eq("public", true)
    .order("usage_count", { ascending: false })
    .limit(limit)

  if (type) query = query.eq("type", type)

  const { data, error } = await query
  if (error) throw error
  return data || []
}
