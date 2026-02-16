import { headers } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { getActivities, getActivitiesByUser, getActivitiesByResource } from "@/lib/activity/feed"
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

  if (!organizationId && !userId) {
    return NextResponse.json(
      { error: "organizationId or userId is required" },
      { status: 400 }
    )
  }

  let activities

  if (resource && resourceId) {
    activities = await getActivitiesByResource(resource, resourceId, limit)
  } else if (userId) {
    activities = await getActivitiesByUser(userId, limit)
  } else {
    activities = await getActivities(organizationId!, { limit })
  }

  return NextResponse.json(activities)
}
