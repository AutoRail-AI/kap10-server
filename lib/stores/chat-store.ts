import { create } from "zustand"
import type {
  ChatConversation,
  ChatMessage,
  ConversationListItem,
} from "@/lib/types/chat"

interface ChatStore {
  // State
  conversations: ConversationListItem[]
  activeConversation: ChatConversation | null
  isLoading: boolean
  isStreaming: boolean
  streamingContent: string
  error: string | null

  // Actions
  setConversations: (conversations: ConversationListItem[]) => void
  addConversation: (conversation: ConversationListItem) => void
  removeConversation: (id: string) => void
  updateConversationTitle: (id: string, title: string) => void
  setActiveConversation: (conversation: ChatConversation | null) => void
  addMessage: (message: ChatMessage) => void
  updateLastMessage: (content: string) => void
  setStreamingContent: (content: string) => void
  appendStreamingContent: (chunk: string) => void
  finalizeStreamingMessage: () => void
  setLoading: (loading: boolean) => void
  setStreaming: (streaming: boolean) => void
  setError: (error: string | null) => void
  reset: () => void
}

const initialState = {
  conversations: [],
  activeConversation: null,
  isLoading: false,
  isStreaming: false,
  streamingContent: "",
  error: null,
}

export const useChatStore = create<ChatStore>((set, get) => ({
  ...initialState,

  setConversations: (conversations) => set({ conversations }),

  addConversation: (conversation) =>
    set((state) => ({
      conversations: [conversation, ...state.conversations],
    })),

  removeConversation: (id) =>
    set((state) => ({
      conversations: state.conversations.filter((c) => c.id !== id),
      activeConversation:
        state.activeConversation?.id === id ? null : state.activeConversation,
    })),

  updateConversationTitle: (id, title) =>
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, title } : c
      ),
      activeConversation:
        state.activeConversation?.id === id
          ? { ...state.activeConversation, title }
          : state.activeConversation,
    })),

  setActiveConversation: (conversation) => set({ activeConversation: conversation }),

  addMessage: (message) =>
    set((state) => {
      if (!state.activeConversation) return state
      return {
        activeConversation: {
          ...state.activeConversation,
          messages: [...state.activeConversation.messages, message],
          updatedAt: new Date(),
        },
      }
    }),

  updateLastMessage: (content) =>
    set((state) => {
      if (!state.activeConversation) return state
      const messages = [...state.activeConversation.messages]
      const lastMessage = messages[messages.length - 1]
      if (lastMessage) {
        messages[messages.length - 1] = {
          id: lastMessage.id,
          role: lastMessage.role,
          content,
          createdAt: lastMessage.createdAt,
          metadata: lastMessage.metadata,
        }
      }
      return {
        activeConversation: {
          ...state.activeConversation,
          messages,
        },
      }
    }),

  setStreamingContent: (content) => set({ streamingContent: content }),

  appendStreamingContent: (chunk) =>
    set((state) => ({
      streamingContent: state.streamingContent + chunk,
    })),

  finalizeStreamingMessage: () => {
    const { activeConversation, streamingContent } = get()
    if (!activeConversation || !streamingContent) return

    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: streamingContent,
      createdAt: new Date(),
    }

    set((state) => ({
      activeConversation: state.activeConversation
        ? {
            ...state.activeConversation,
            messages: [...state.activeConversation.messages, assistantMessage],
            updatedAt: new Date(),
          }
        : null,
      streamingContent: "",
      isStreaming: false,
    }))
  },

  setLoading: (loading) => set({ isLoading: loading }),

  setStreaming: (streaming) => set({ isStreaming: streaming }),

  setError: (error) => set({ error }),

  reset: () => set(initialState),
}))
