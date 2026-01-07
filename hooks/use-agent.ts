"use client"

import { useState, useCallback } from "react"
import type { AgentMessage } from "@/lib/ai/types"

export function useAgent() {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sendMessage = useCallback(async (content: string, organizationId?: string) => {
    setLoading(true)
    setError(null)

    const userMessage: AgentMessage = {
      role: "user",
      content,
      timestamp: new Date(),
    }

    setMessages(prev => [...prev, userMessage])

    try {
      const response = await fetch("/api/ai/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMessage],
          organizationId,
        }),
      })

      if (!response.ok) {
        throw new Error("Failed to get agent response")
      }

      const data = await response.json()
      setMessages(data.messages)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setLoading(false)
    }
  }, [messages])

  return {
    messages,
    sendMessage,
    loading,
    error,
  }
}

