import { supabase } from "@/lib/db"
import type { Database } from "@/lib/db/types"

export type AgentConversation = Database["public"]["Tables"]["agent_conversations"]["Row"]
export type AgentConversationInsert = Database["public"]["Tables"]["agent_conversations"]["Insert"]
export type AgentConversationUpdate = Database["public"]["Tables"]["agent_conversations"]["Update"]

// Agent Conversation model functions

export async function createAgentConversation(
  data: AgentConversationInsert
): Promise<AgentConversation> {
  const { data: conversation, error } = await supabase
    .from("agent_conversations")
    .insert(data)
    .select()
    .single()

  if (error) throw error
  return conversation
}

export async function getAgentConversation(id: string): Promise<AgentConversation | null> {
  const { data, error } = await supabase
    .from("agent_conversations")
    .select("*")
    .eq("id", id)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function getAgentConversationsByUser(
  userId: string,
  limit = 50
): Promise<AgentConversation[]> {
  const { data, error } = await supabase
    .from("agent_conversations")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(limit)

  if (error) throw error
  return data || []
}

export async function updateAgentConversation(
  id: string,
  updates: AgentConversationUpdate
): Promise<AgentConversation> {
  const { data: conversation, error } = await supabase
    .from("agent_conversations")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single()

  if (error) throw error
  return conversation
}

export async function deleteAgentConversation(id: string): Promise<void> {
  const { error } = await supabase
    .from("agent_conversations")
    .delete()
    .eq("id", id)

  if (error) throw error
}
