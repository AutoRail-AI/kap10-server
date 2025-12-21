export interface ChatMessage {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  createdAt: Date
  metadata?: ChatMessageMetadata
}

export interface ChatMessageMetadata {
  masked?: boolean
  maskingStats?: {
    itemsMasked: number
    processingTimeMs: number
  }
  appealGenerated?: boolean
  citations?: string[]
  attachments?: string[]
  streaming?: boolean
}

export interface ChatConversation {
  id: string
  title: string
  messages: ChatMessage[]
  provider?: string
  status: "active" | "archived"
  createdAt: Date
  updatedAt: Date
}

export interface ChatState {
  conversations: ChatConversation[]
  activeConversationId: string | null
  isLoading: boolean
  isStreaming: boolean
  error: string | null
}

export interface ChatInput {
  message: string
  conversationId?: string
  attachments?: File[]
}

export interface StreamingMessage {
  id: string
  content: string
  done: boolean
  metadata?: ChatMessageMetadata
}

export interface ConversationListItem {
  id: string
  title: string
  lastMessage?: string
  updatedAt: Date
  provider?: string
}
