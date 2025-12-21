import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getDashboardData } from "@/lib/dashboard"
import { headers } from "next/headers"

/**
 * GET /api/dashboard
 * Get dashboard data for the current user
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

    const data = await getDashboardData(session.user.id)

    return NextResponse.json(data)
  } catch (error) {
    console.error("Error fetching dashboard data:", error)
    return NextResponse.json(
      { error: "Failed to fetch dashboard data" },
      { status: 500 }
    )
  }
}
