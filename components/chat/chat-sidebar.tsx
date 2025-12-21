"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { PenSquare } from "lucide-react"
import { ConversationList } from "./conversation-list"
import { useConversations } from "@/hooks"

interface ChatSidebarProps {
  onNewChat?: () => void
  onSelectConversation?: () => void
}

export function ChatSidebar({ onNewChat, onSelectConversation }: ChatSidebarProps) {
  const router = useRouter()
  const {
    conversations,
    isLoading,
    deleteConversation,
    renameConversation,
  } = useConversations()

  const handleNewChat = () => {
    router.push("/chat")
    onNewChat?.()
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header with New Chat button */}
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="text-lg font-semibold">Chats</h2>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={handleNewChat}
        >
          <PenSquare className="h-4 w-4" />
          New Chat
        </Button>
      </div>

      {/* Conversation List */}
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <ConversationList
            conversations={conversations}
            onDelete={deleteConversation}
            onRename={renameConversation}
            onSelect={onSelectConversation}
          />
        )}
      </ScrollArea>
    </div>
  )
}
