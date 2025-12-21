import { ObjectId } from "mongodb"
import { getCollection } from "@/lib/db"
import type { Conversation, Message } from "@/lib/types/database"
import type { ChatConversation, ChatMessage, ConversationListItem } from "@/lib/types/chat"

// Helper to convert MongoDB document to frontend type
function toConversationListItem(doc: Conversation): ConversationListItem {
  return {
    id: doc._id.toString(),
    title: doc.title,
    updatedAt: doc.updatedAt,
    provider: doc.provider?.toString(),
  }
}

function toChatMessage(doc: Message): ChatMessage {
  return {
    id: doc._id.toString(),
    role: doc.role,
    content: doc.content,
    createdAt: doc.createdAt,
    metadata: doc.metadata,
  }
}

function toChatConversation(
  doc: Conversation,
  messages: Message[]
): ChatConversation {
  return {
    id: doc._id.toString(),
    title: doc.title,
    messages: messages.map(toChatMessage),
    provider: doc.provider?.toString(),
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

/**
 * Create a new conversation
 */
export async function createConversation(params: {
  userId?: string
  sessionId: string
  title?: string
  provider?: string
}): Promise<ConversationListItem> {
  const conversations = await getCollection<Conversation>("conversations")

  const now = new Date()
  const conversation: Omit<Conversation, "_id"> = {
    userId: params.userId ? new ObjectId(params.userId) : undefined,
    sessionId: params.sessionId,
    title: params.title || "New Chat",
    provider: params.provider ? new ObjectId(params.provider) : undefined,
    status: "active",
    createdAt: now,
    updatedAt: now,
    // Set expiration for anonymous users (30 days)
    expiresAt: params.userId ? undefined : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
  }

  const result = await conversations.insertOne(conversation as Conversation)

  return {
    id: result.insertedId.toString(),
    title: conversation.title,
    updatedAt: conversation.updatedAt,
    provider: params.provider,
  }
}

/**
 * Get list of conversations for a user or session
 */
export async function getConversationList(params: {
  userId?: string
  sessionId: string
}): Promise<ConversationListItem[]> {
  const conversations = await getCollection<Conversation>("conversations")

  const query = params.userId
    ? { userId: new ObjectId(params.userId), status: "active" as const }
    : { sessionId: params.sessionId, status: "active" as const }

  const docs = await conversations
    .find(query)
    .sort({ updatedAt: -1 })
    .limit(50)
    .toArray()

  // Get last message for each conversation
  const messages = await getCollection<Message>("messages")
  const conversationsWithLastMessage = await Promise.all(
    docs.map(async (doc) => {
      const lastMessage = await messages
        .findOne(
          { conversationId: doc._id },
          { sort: { createdAt: -1 } }
        )

      return {
        ...toConversationListItem(doc),
        lastMessage: lastMessage?.content?.slice(0, 100),
      }
    })
  )

  return conversationsWithLastMessage
}

/**
 * Get a single conversation with all messages
 */
export async function getConversation(params: {
  id: string
  userId?: string
  sessionId: string
}): Promise<ChatConversation | null> {
  const conversations = await getCollection<Conversation>("conversations")

  const query = params.userId
    ? { _id: new ObjectId(params.id), userId: new ObjectId(params.userId) }
    : { _id: new ObjectId(params.id), sessionId: params.sessionId }

  const conversation = await conversations.findOne(query)
  if (!conversation) return null

  const messagesCollection = await getCollection<Message>("messages")
  const messages = await messagesCollection
    .find({ conversationId: new ObjectId(params.id) })
    .sort({ createdAt: 1 })
    .toArray()

  return toChatConversation(conversation, messages)
}

/**
 * Add a message to a conversation
 */
export async function addMessage(params: {
  conversationId: string
  role: "user" | "assistant" | "system"
  content: string
  metadata?: Message["metadata"]
}): Promise<ChatMessage> {
  const messages = await getCollection<Message>("messages")
  const conversations = await getCollection<Conversation>("conversations")

  const now = new Date()
  const message: Omit<Message, "_id"> = {
    conversationId: new ObjectId(params.conversationId),
    role: params.role,
    content: params.content,
    metadata: params.metadata,
    createdAt: now,
  }

  const result = await messages.insertOne(message as Message)

  // Update conversation's updatedAt
  await conversations.updateOne(
    { _id: new ObjectId(params.conversationId) },
    { $set: { updatedAt: now } }
  )

  // Auto-generate title from first user message
  if (params.role === "user") {
    const messageCount = await messages.countDocuments({
      conversationId: new ObjectId(params.conversationId),
    })
    if (messageCount === 1) {
      const title = params.content.slice(0, 50) + (params.content.length > 50 ? "..." : "")
      await conversations.updateOne(
        { _id: new ObjectId(params.conversationId) },
        { $set: { title } }
      )
    }
  }

  return {
    id: result.insertedId.toString(),
    role: params.role,
    content: params.content,
    createdAt: now,
    metadata: params.metadata,
  }
}

/**
 * Update conversation title
 */
export async function updateConversationTitle(params: {
  id: string
  title: string
  userId?: string
  sessionId: string
}): Promise<void> {
  const conversations = await getCollection<Conversation>("conversations")

  const query = params.userId
    ? { _id: new ObjectId(params.id), userId: new ObjectId(params.userId) }
    : { _id: new ObjectId(params.id), sessionId: params.sessionId }

  await conversations.updateOne(query, {
    $set: { title: params.title, updatedAt: new Date() },
  })
}

/**
 * Delete a conversation and its messages
 */
export async function deleteConversation(params: {
  id: string
  userId?: string
  sessionId: string
}): Promise<void> {
  const conversations = await getCollection<Conversation>("conversations")
  const messages = await getCollection<Message>("messages")

  const query = params.userId
    ? { _id: new ObjectId(params.id), userId: new ObjectId(params.userId) }
    : { _id: new ObjectId(params.id), sessionId: params.sessionId }

  // Delete messages first
  await messages.deleteMany({ conversationId: new ObjectId(params.id) })

  // Then delete conversation
  await conversations.deleteOne(query)
}

/**
 * Archive a conversation (soft delete)
 */
export async function archiveConversation(params: {
  id: string
  userId?: string
  sessionId: string
}): Promise<void> {
  const conversations = await getCollection<Conversation>("conversations")

  const query = params.userId
    ? { _id: new ObjectId(params.id), userId: new ObjectId(params.userId) }
    : { _id: new ObjectId(params.id), sessionId: params.sessionId }

  await conversations.updateOne(query, {
    $set: { status: "archived", updatedAt: new Date() },
  })
}
