"use client"

import { useCallback, useEffect } from "react"
import { useChatStore } from "@/lib/stores/chat-store"
import { getSessionId } from "@/lib/chat/session"
import { useAuth } from "@/components/providers"
import type { ConversationListItem } from "@/lib/types/chat"

/**
 * Hook for managing conversation list
 */
export function useConversations() {
  const { session } = useAuth()
  const {
    conversations,
    isLoading,
    error,
    setConversations,
    addConversation,
    removeConversation,
    setLoading,
    setError,
  } = useChatStore()

  // Fetch conversations on mount and when auth changes
  const fetchConversations = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const sessionId = getSessionId()
      const userId = session?.user?.id

      const params = new URLSearchParams()
      if (!userId && sessionId) {
        params.set("sessionId", sessionId)
      }

      const response = await fetch(`/api/chat?${params.toString()}`)

      if (!response.ok) {
        throw new Error("Failed to fetch conversations")
      }

      const data = await response.json() as { conversations: ConversationListItem[] }
      setConversations(data.conversations)
    } catch (err) {
      console.error("Error fetching conversations:", err)
      setError(err instanceof Error ? err.message : "Failed to fetch conversations")
    } finally {
      setLoading(false)
    }
  }, [session?.user?.id, setConversations, setLoading, setError])

  // Create a new conversation
  const createConversation = useCallback(async (): Promise<string | null> => {
    try {
      const sessionId = getSessionId()
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      })

      if (!response.ok) {
        throw new Error("Failed to create conversation")
      }

      const data = await response.json() as { conversation: ConversationListItem }
      const newConversation = data.conversation

      addConversation(newConversation)
      return newConversation.id
    } catch (err) {
      console.error("Error creating conversation:", err)
      setError(err instanceof Error ? err.message : "Failed to create conversation")
      return null
    }
  }, [addConversation, setError])

  // Delete a conversation
  const deleteConversation = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const sessionId = getSessionId()
        const params = new URLSearchParams()
        if (sessionId) {
          params.set("sessionId", sessionId)
        }

        const response = await fetch(`/api/chat/${id}?${params.toString()}`, {
          method: "DELETE",
        })

        if (!response.ok) {
          throw new Error("Failed to delete conversation")
        }

        removeConversation(id)
        return true
      } catch (err) {
        console.error("Error deleting conversation:", err)
        setError(err instanceof Error ? err.message : "Failed to delete conversation")
        return false
      }
    },
    [removeConversation, setError]
  )

  // Rename a conversation
  const renameConversation = useCallback(
    async (id: string, title: string): Promise<boolean> => {
      try {
        const sessionId = getSessionId()
        const response = await fetch(`/api/chat/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, sessionId }),
        })

        if (!response.ok) {
          throw new Error("Failed to rename conversation")
        }

        // Update in store handled by updateConversationTitle
        useChatStore.getState().updateConversationTitle(id, title)
        return true
      } catch (err) {
        console.error("Error renaming conversation:", err)
        setError(err instanceof Error ? err.message : "Failed to rename conversation")
        return false
      }
    },
    [setError]
  )

  // Fetch conversations on mount
  useEffect(() => {
    fetchConversations()
  }, [fetchConversations])

  return {
    conversations,
    isLoading,
    error,
    fetchConversations,
    createConversation,
    deleteConversation,
    renameConversation,
  }
}
