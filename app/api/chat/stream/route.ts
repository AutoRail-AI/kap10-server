import { NextRequest } from "next/server"
import { streamText } from "ai"
import { auth } from "@/lib/auth"
import { createConversation, addMessage, getConversation } from "@/lib/chat"
import { getLLMModel, isLLMConfigured } from "@/lib/llm"
import { getSystemPrompt } from "@/lib/llm/prompts"
import { headers } from "next/headers"

/**
 * POST /api/chat/stream
 * Stream a chat response from the LLM
 *
 * Body:
 * - message: string - The user's message
 * - conversationId?: string - Existing conversation ID (creates new if omitted)
 * - sessionId: string - Session ID for anonymous users
 */
export async function POST(request: NextRequest) {
  try {
    // Check if LLM is configured
    if (!isLLMConfigured()) {
      return new Response(
        JSON.stringify({ error: "LLM not configured. Please set LLM_API_KEY or OPENAI_API_KEY." }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      )
    }

    const body = await request.json() as { message: string; conversationId?: string; sessionId?: string }
    const { message, conversationId, sessionId } = body

    if (!message || typeof message !== "string") {
      return new Response(
        JSON.stringify({ error: "Message is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )
    }

    // Try to get authenticated user
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    const userId = session?.user?.id

    if (!userId && !sessionId) {
      return new Response(
        JSON.stringify({ error: "Session ID required for anonymous users" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )
    }

    // Get or create conversation
    let activeConversationId: string
    let conversationHistory: Array<{ role: "user" | "assistant" | "system"; content: string }> = []

    if (conversationId) {
      activeConversationId = conversationId
      // Load existing conversation
      const conversation = await getConversation({
        id: conversationId,
        userId: userId || undefined,
        sessionId: sessionId || "",
      })

      if (!conversation) {
        return new Response(
          JSON.stringify({ error: "Conversation not found" }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        )
      }

      // Build conversation history for context
      conversationHistory = conversation.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }))
    } else {
      // Create new conversation
      const newConversation = await createConversation({
        userId: userId || undefined,
        sessionId: sessionId || "",
      })
      activeConversationId = newConversation.id
    }

    // Save user message
    await addMessage({
      conversationId: activeConversationId,
      role: "user",
      content: message,
    })

    // Add user message to history
    conversationHistory.push({ role: "user", content: message })

    // Get the LLM model
    const model = getLLMModel()

    // Stream the response
    const result = streamText({
      model,
      system: getSystemPrompt("general"),
      messages: conversationHistory,
      onFinish: async ({ text }) => {
        // Save assistant message after streaming completes
        await addMessage({
          conversationId: activeConversationId,
          role: "assistant",
          content: text,
          metadata: {
            appealGenerated: text.toLowerCase().includes("appeal") && text.length > 500,
          },
        })
      },
    })

    // Return streaming response with conversation ID in headers
    const response = result.toTextStreamResponse()

    // Add conversation ID to response headers for new conversations
    if (!conversationId) {
      response.headers.set("X-Conversation-Id", activeConversationId)
    }

    return response
  } catch (error) {
    console.error("Error in chat stream:", error)
    return new Response(
      JSON.stringify({ error: "Failed to process chat request" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    )
  }
}
