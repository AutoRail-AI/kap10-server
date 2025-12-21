import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getAppealHistory } from "@/lib/dashboard"
import { headers } from "next/headers"

/**
 * GET /api/appeals
 * Get paginated appeal history for the current user
 */
export async function GET(request: NextRequest) {
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

    // Parse query params
    const searchParams = request.nextUrl.searchParams
    const page = parseInt(searchParams.get("page") || "1", 10)
    const pageSize = parseInt(searchParams.get("pageSize") || "10", 10)
    const status = searchParams.get("status")
    const provider = searchParams.get("provider")
    const search = searchParams.get("search")
    const dateFrom = searchParams.get("dateFrom")
    const dateTo = searchParams.get("dateTo")

    const result = await getAppealHistory({
      userId: session.user.id,
      page,
      pageSize,
      filters: {
        status: status || undefined,
        provider: provider || undefined,
        search: search || undefined,
        dateFrom: dateFrom ? new Date(dateFrom) : undefined,
        dateTo: dateTo ? new Date(dateTo) : undefined,
      },
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error("Error fetching appeals:", error)
    return NextResponse.json(
      { error: "Failed to fetch appeals" },
      { status: 500 }
    )
  }
}
