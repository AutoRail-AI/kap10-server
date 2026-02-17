import { supabase } from "@/lib/db"
import type { Database } from "@/lib/db/types"

export type SearchIndexEntry = Database["public"]["Tables"]["search_index"]["Row"]
export type SearchIndexInsert = Database["public"]["Tables"]["search_index"]["Insert"]
export type SearchIndexUpdate = Database["public"]["Tables"]["search_index"]["Update"]

// Search Engine functions

export async function indexDocument(data: SearchIndexInsert): Promise<SearchIndexEntry> {
  // Upsert: if resource+resource_id exists, update it
  const { data: entry, error } = await supabase
    .from("search_index")
    .upsert(data, { onConflict: "resource,resource_id" })
    .select()
    .single()

  if (error) throw error
  return entry
}

export async function removeFromIndex(
  resource: string,
  resourceId: string
): Promise<void> {
  const { error } = await supabase
    .from("search_index")
    .delete()
    .eq("resource", resource)
    .eq("resource_id", resourceId)

  if (error) throw error
}

export async function search(
  query: string,
  options?: {
    organizationId?: string
    resource?: string
    tags?: string[]
    limit?: number
    offset?: number
  }
): Promise<SearchIndexEntry[]> {
  let dbQuery = supabase
    .from("search_index")
    .select("*")
    .or(`title.ilike.%${query}%,content.ilike.%${query}%`)
    .order("updated_at", { ascending: false })

  if (options?.organizationId) {
    dbQuery = dbQuery.eq("organization_id", options.organizationId)
  }
  if (options?.resource) {
    dbQuery = dbQuery.eq("resource", options.resource)
  }
  if (options?.tags?.length) {
    dbQuery = dbQuery.overlaps("tags", options.tags)
  }

  const limit = options?.limit || 20
  const offset = options?.offset || 0
  dbQuery = dbQuery.range(offset, offset + limit - 1)

  const { data, error } = await dbQuery
  if (error) throw error
  return data || []
}

export async function reindexOrganization(organizationId: string): Promise<void> {
  // Remove all entries for this organization — caller should re-index after
  const { error } = await supabase
    .from("search_index")
    .delete()
    .eq("organization_id", organizationId)

  if (error) throw error
}
