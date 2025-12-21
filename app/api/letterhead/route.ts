import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  getLetterhead,
  updateLetterhead,
  deleteLetterhead,
} from "@/lib/letterhead"
import { headers } from "next/headers"
import type { LetterheadSettings } from "@/lib/types/letterhead"

/**
 * GET /api/letterhead
 * Get letterhead settings for the current user
 */
export async function GET() {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      )
    }

    const letterhead = await getLetterhead(session.user.id)

    return NextResponse.json({ letterhead })
  } catch (error) {
    console.error("Error fetching letterhead:", error)
    return NextResponse.json(
      { error: "Failed to fetch letterhead settings" },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/letterhead
 * Update letterhead settings for the current user
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      )
    }

    const body = (await request.json()) as LetterheadSettings

    if (!body.organizationName?.trim()) {
      return NextResponse.json(
        { error: "Organization name is required" },
        { status: 400 }
      )
    }

    const success = await updateLetterhead({
      userId: session.user.id,
      settings: body,
    })

    if (!success) {
      return NextResponse.json(
        { error: "Failed to update letterhead settings" },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error updating letterhead:", error)
    return NextResponse.json(
      { error: "Failed to update letterhead settings" },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/letterhead
 * Delete letterhead settings for the current user
 */
export async function DELETE() {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      )
    }

    const success = await deleteLetterhead(session.user.id)

    return NextResponse.json({ success })
  } catch (error) {
    console.error("Error deleting letterhead:", error)
    return NextResponse.json(
      { error: "Failed to delete letterhead settings" },
      { status: 500 }
    )
  }
}
