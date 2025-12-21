import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  getConversation,
  updateConversationTitle,
  deleteConversation,
} from "@/lib/chat"
import { headers } from "next/headers"

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * GET /api/chat/[id]
 * Get a single conversation with all messages
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
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

    const conversation = await getConversation({
      id,
      userId: userId || undefined,
      sessionId,
    })

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      )
    }

    return NextResponse.json({ conversation })
  } catch (error) {
    console.error("Error fetching conversation:", error)
    return NextResponse.json(
      { error: "Failed to fetch conversation" },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/chat/[id]
 * Update conversation (title, status)
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const body = await request.json() as { title?: string; sessionId?: string }
    const { title, sessionId } = body

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

    if (title) {
      await updateConversationTitle({
        id,
        title,
        userId: userId || undefined,
        sessionId: sessionId || "",
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error updating conversation:", error)
    return NextResponse.json(
      { error: "Failed to update conversation" },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/chat/[id]
 * Delete a conversation and its messages
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
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

    await deleteConversation({
      id,
      userId: userId || undefined,
      sessionId,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting conversation:", error)
    return NextResponse.json(
      { error: "Failed to delete conversation" },
      { status: 500 }
    )
  }
}
