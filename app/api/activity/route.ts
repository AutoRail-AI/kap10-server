import { headers } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { getActivityFeed, getUserActivity } from "@/lib/activity/feed"
import { auth } from "@/lib/auth"

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const organizationId = searchParams.get("organizationId")
  const userId = searchParams.get("userId")
  const resource = searchParams.get("resource")
  const resourceId = searchParams.get("resourceId")
  const limit = parseInt(searchParams.get("limit") || "50", 10)
  const before = searchParams.get("before")
    ? new Date(searchParams.get("before")!)
    : undefined

  if (!organizationId && !userId) {
    return NextResponse.json(
      { error: "organizationId or userId is required" },
      { status: 400 }
    )
  }

  let activities

  if (userId) {
    activities = await getUserActivity(userId, {
      organizationId: organizationId || undefined,
      limit,
    })
  } else {
    activities = await getActivityFeed(organizationId!, {
      resource: resource || undefined,
      resourceId: resourceId || undefined,
      limit,
      before,
    })
  }

  return NextResponse.json(activities)
}

