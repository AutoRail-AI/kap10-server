"use client"

import { useEffect } from "react"
import { ChatMessages } from "./chat-messages"
import { ChatInput } from "./chat-input"
import { useChat } from "@/hooks"
import { Loader2 } from "lucide-react"

interface ChatContainerProps {
  conversationId?: string
}

export function ChatContainer({ conversationId }: ChatContainerProps) {
  const {
    messages,
    isLoading,
    isStreaming,
    error,
    loadConversation,
    sendMessage,
    stopStreaming,
    clearConversation,
  } = useChat(conversationId)

  // Load conversation when ID changes
  useEffect(() => {
    if (conversationId) {
      loadConversation(conversationId)
    } else {
      clearConversation()
    }
  }, [conversationId, loadConversation, clearConversation])

  const handleSuggestionClick = (suggestion: string) => {
    sendMessage(suggestion)
  }

  // Show loading state when fetching conversation
  if (isLoading && conversationId && messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* Error Banner */}
      {error && (
        <div className="border-b bg-destructive/10 px-4 py-2 text-center text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Messages Area */}
      <ChatMessages
        messages={messages}
        isStreaming={isStreaming}
        onSuggestionClick={handleSuggestionClick}
      />

      {/* Input Area */}
      <ChatInput
        onSend={sendMessage}
        onStop={stopStreaming}
        isStreaming={isStreaming}
        placeholder="Ask about appeals, denial letters, or get help drafting..."
      />
    </div>
  )
}
