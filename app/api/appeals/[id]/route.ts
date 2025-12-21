import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getAppeal, updateAppealStatus } from "@/lib/dashboard"
import { headers } from "next/headers"

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * GET /api/appeals/[id]
 * Get a single appeal by ID
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
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

    const { id } = await context.params

    const appeal = await getAppeal({
      userId: session.user.id,
      appealId: id,
    })

    if (!appeal) {
      return NextResponse.json(
        { error: "Appeal not found" },
        { status: 404 }
      )
    }

    return NextResponse.json({ appeal })
  } catch (error) {
    console.error("Error fetching appeal:", error)
    return NextResponse.json(
      { error: "Failed to fetch appeal" },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/appeals/[id]
 * Update appeal status
 */
export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
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

    const { id } = await context.params
    const body = (await request.json()) as {
      status?: "draft" | "generated" | "downloaded" | "submitted"
    }

    if (body.status) {
      const validStatuses = ["draft", "generated", "downloaded", "submitted"]
      if (!validStatuses.includes(body.status)) {
        return NextResponse.json(
          { error: "Invalid status" },
          { status: 400 }
        )
      }

      const success = await updateAppealStatus({
        userId: session.user.id,
        appealId: id,
        status: body.status,
      })

      if (!success) {
        return NextResponse.json(
          { error: "Failed to update appeal" },
          { status: 500 }
        )
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error updating appeal:", error)
    return NextResponse.json(
      { error: "Failed to update appeal" },
      { status: 500 }
    )
  }
}
