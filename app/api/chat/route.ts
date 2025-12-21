import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createConversation, getConversationList } from "@/lib/chat"
import { headers } from "next/headers"

/**
 * GET /api/chat
 * Get list of conversations for the current user/session
 */
export async function GET(request: NextRequest) {
  try {
    // Get session ID from query params (for anonymous users)
    const sessionId = request.nextUrl.searchParams.get("sessionId") || ""

    // Try to get authenticated user
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    const userId = session?.user?.id

    if (!userId && !sessionId) {
      return NextResponse.json(
        { error: "Session ID required for anonymous users" },
        { status: 400 }
      )
    }

    const conversations = await getConversationList({
      userId: userId || undefined,
      sessionId,
    })

    return NextResponse.json({ conversations })
  } catch (error) {
    console.error("Error fetching conversations:", error)
    return NextResponse.json(
      { error: "Failed to fetch conversations" },
      { status: 500 }
    )
  }
}

/**
 * POST /api/chat
 * Create a new conversation
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { sessionId?: string; title?: string; provider?: string }
    const { sessionId, title, provider } = body

    // Try to get authenticated user
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    const userId = session?.user?.id

    if (!userId && !sessionId) {
      return NextResponse.json(
        { error: "Session ID required for anonymous users" },
        { status: 400 }
      )
    }

    const conversation = await createConversation({
      userId: userId || undefined,
      sessionId: sessionId || "",
      title,
      provider,
    })

    return NextResponse.json({ conversation }, { status: 201 })
  } catch (error) {
    console.error("Error creating conversation:", error)
    return NextResponse.json(
      { error: "Failed to create conversation" },
      { status: 500 }
    )
  }
}
