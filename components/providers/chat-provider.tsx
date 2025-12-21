"use client"

import { useEffect, type ReactNode } from "react"
import { getSessionId } from "@/lib/chat/session"

interface ChatProviderProps {
  children: ReactNode
}

/**
 * Provider component that initializes chat session for anonymous users
 */
export function ChatProvider({ children }: ChatProviderProps) {
  // Initialize session on mount (client-side only)
  // getSessionId creates a session if one doesn't exist
  useEffect(() => {
    getSessionId()
  }, [])

  return <>{children}</>
}
