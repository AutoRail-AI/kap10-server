"use client"

import { useCallback, useRef } from "react"
import { useChatStore } from "@/lib/stores/chat-store"
import { getSessionId } from "@/lib/chat/session"
import { useAuth } from "@/components/providers"
import type { ChatMessage, ChatConversation } from "@/lib/types/chat"

/**
 * Hook for chat functionality with streaming support
 */
export function useChat(conversationId?: string) {
  const { session } = useAuth()
  const abortControllerRef = useRef<AbortController | null>(null)

  const {
    activeConversation,
    isLoading,
    isStreaming,
    streamingContent,
    error,
    setActiveConversation,
    addMessage,
    setStreamingContent,
    appendStreamingContent,
    finalizeStreamingMessage,
    setLoading,
    setStreaming,
    setError,
  } = useChatStore()

  // Load a conversation by ID
  const loadConversation = useCallback(
    async (id: string): Promise<ChatConversation | null> => {
      setLoading(true)
      setError(null)

      try {
        const sessionId = getSessionId()
        const params = new URLSearchParams()
        if (sessionId) {
          params.set("sessionId", sessionId)
        }

        const response = await fetch(`/api/chat/${id}?${params.toString()}`)

        if (!response.ok) {
          if (response.status === 404) {
            return null
          }
          throw new Error("Failed to load conversation")
        }

        const data = await response.json() as { conversation: ChatConversation }
        setActiveConversation(data.conversation)
        return data.conversation
      } catch (err) {
        console.error("Error loading conversation:", err)
        setError(err instanceof Error ? err.message : "Failed to load conversation")
        return null
      } finally {
        setLoading(false)
      }
    },
    [setActiveConversation, setLoading, setError]
  )

  // Send a message and stream the response
  const sendMessage = useCallback(
    async (content: string): Promise<void> => {
      if (!content.trim()) return

      setError(null)
      setStreaming(true)
      setStreamingContent("")

      // Create optimistic user message
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        createdAt: new Date(),
      }

      // Add user message to active conversation
      addMessage(userMessage)

      try {
        const sessionId = getSessionId()

        // Create abort controller for cancellation
        abortControllerRef.current = new AbortController()

        const response = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: content,
            conversationId: activeConversation?.id || conversationId,
            sessionId,
          }),
          signal: abortControllerRef.current.signal,
        })

        if (!response.ok) {
          const errorData = await response.json() as { error?: string }
          throw new Error(errorData.error || "Failed to send message")
        }

        // Check if a new conversation was created
        const newConversationId = response.headers.get("X-Conversation-Id")
        if (newConversationId && !activeConversation) {
          // Load the new conversation
          await loadConversation(newConversationId)
        }

        // Handle streaming response
        const reader = response.body?.getReader()
        if (!reader) {
          throw new Error("No response body")
        }

        const decoder = new TextDecoder()
        let accumulatedContent = ""

        while (true) {
          const { done, value } = await reader.read()

          if (done) {
            break
          }

          // toTextStreamResponse returns plain text chunks
          const chunk = decoder.decode(value, { stream: true })
          accumulatedContent += chunk
          setStreamingContent(accumulatedContent)
        }

        // Finalize the streaming message
        finalizeStreamingMessage()
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          // User cancelled, finalize with current content
          if (streamingContent) {
            finalizeStreamingMessage()
          }
          return
        }

        console.error("Error sending message:", err)
        setError(err instanceof Error ? err.message : "Failed to send message")
      } finally {
        setStreaming(false)
        abortControllerRef.current = null
      }
    },
    [
      activeConversation,
      conversationId,
      addMessage,
      setStreamingContent,
      finalizeStreamingMessage,
      setStreaming,
      setError,
      streamingContent,
      loadConversation,
    ]
  )

  // Stop streaming response
  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
  }, [])

  // Clear the active conversation
  const clearConversation = useCallback(() => {
    setActiveConversation(null)
    setStreamingContent("")
    setError(null)
  }, [setActiveConversation, setStreamingContent, setError])

  // Get messages including streaming content
  const messages = activeConversation?.messages || []
  const allMessages = isStreaming && streamingContent
    ? [
        ...messages,
        {
          id: "streaming",
          role: "assistant" as const,
          content: streamingContent,
          createdAt: new Date(),
          metadata: { streaming: true },
        },
      ]
    : messages

  return {
    conversation: activeConversation,
    messages: allMessages,
    isLoading,
    isStreaming,
    error,
    loadConversation,
    sendMessage,
    stopStreaming,
    clearConversation,
  }
}
