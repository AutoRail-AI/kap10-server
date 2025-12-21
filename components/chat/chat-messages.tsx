"use client"

import { useEffect, useRef } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ChatMessage } from "./chat-message"
import { WelcomeScreen } from "./welcome-screen"
import type { ChatMessage as ChatMessageType } from "@/lib/types/chat"

interface ChatMessagesProps {
  messages: ChatMessageType[]
  isStreaming?: boolean
  onSuggestionClick?: (suggestion: string) => void
}

export function ChatMessages({
  messages,
  isStreaming,
  onSuggestionClick,
}: ChatMessagesProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages, isStreaming])

  // Show welcome screen when no messages
  if (messages.length === 0) {
    return <WelcomeScreen onSuggestionClick={onSuggestionClick} />
  }

  return (
    <ScrollArea className="flex-1" ref={scrollRef}>
      <div className="mx-auto max-w-3xl pb-4">
        {messages.map((message, index) => {
          const isLastMessage = index === messages.length - 1
          const isStreamingMessage =
            isLastMessage &&
            isStreaming &&
            message.role === "assistant"

          return (
            <ChatMessage
              key={message.id}
              message={message}
              isStreaming={isStreamingMessage}
            />
          )
        })}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  )
}
