import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { updateLetterheadLogo, removeLetterheadLogo } from "@/lib/letterhead"
import { headers } from "next/headers"

/**
 * POST /api/letterhead/logo
 * Update just the logo for letterhead
 */
export async function POST(request: NextRequest) {
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

    const body = (await request.json()) as {
      logo: string
      logoKey: string
    }

    if (!body.logo || !body.logoKey) {
      return NextResponse.json(
        { error: "Logo URL and key are required" },
        { status: 400 }
      )
    }

    const success = await updateLetterheadLogo({
      userId: session.user.id,
      logo: body.logo,
      logoKey: body.logoKey,
    })

    if (!success) {
      return NextResponse.json(
        { error: "Failed to update logo" },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error updating logo:", error)
    return NextResponse.json(
      { error: "Failed to update logo" },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/letterhead/logo
 * Remove the logo from letterhead
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

    const result = await removeLetterheadLogo(session.user.id)

    // TODO: Delete file from uploadthing using result.logoKey if needed

    return NextResponse.json({ success: result.success })
  } catch (error) {
    console.error("Error removing logo:", error)
    return NextResponse.json(
      { error: "Failed to remove logo" },
      { status: 500 }
    )
  }
}
