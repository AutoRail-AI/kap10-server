import { headers } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  getNotifications,
  getUnreadCount,
  markAllAsRead,
  markAsRead,
} from "@/lib/notifications/manager"

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const unreadOnly = searchParams.get("unreadOnly") === "true"
  const limit = parseInt(searchParams.get("limit") || "50", 10)
  const organizationId = searchParams.get("organizationId") || undefined

  const notifications = await getNotifications(session.user.id, {
    unreadOnly,
    limit,
    organizationId,
  })

  return NextResponse.json(notifications)
}

export async function PATCH(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await req.json()) as {
    notificationId?: string
    markAll?: boolean
    organizationId?: string
  }
  const { notificationId, markAll, organizationId } = body

  if (markAll) {
    await markAllAsRead(session.user.id, organizationId)
    return NextResponse.json({ success: true })
  }

  if (!notificationId) {
    return NextResponse.json(
      { error: "Notification ID is required" },
      { status: 400 }
    )
  }

  await markAsRead(notificationId, session.user.id)

  return NextResponse.json({ success: true })
}

export async function HEAD(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const organizationId = searchParams.get("organizationId") || undefined

  const count = await getUnreadCount(session.user.id, organizationId)

  return NextResponse.json({ count })
}

