import { headers } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { hasPermission } from "@/lib/config/roles"

// Middleware to check admin access
export async function requireAdmin(_req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Check if user has admin permission
  // Note: In production, you'd check the user's actual role from the database
  // For now, we'll use a simple check - you can enhance this
  const userRole = "platform_admin" // Get from session or database
  const isAdmin = hasPermission(userRole, "admin", "view_analytics")
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  return null
}

// Admin dashboard stats
export async function GET(req: NextRequest) {
  const authError = await requireAdmin(req)
  if (authError) return authError

  // Get stats from database
  const { connectDB } = await import("@/lib/db/mongoose")
  await connectDB()
  const { prisma } = await import("@/lib/db/prisma")

  // Get user count
  const userCount = await prisma.user.count()

  // Get organization count
  const orgCount = await prisma.organization?.count() || 0

  // Get active subscriptions
  const { Subscription } = await import("@/lib/models/billing")
  const subscriptionCount = await Subscription.countDocuments({
    status: "active",
  })

  // Get recent activity
  const { getAuditLogs } = await import("@/lib/audit/logger")
  const recentActivity = await getAuditLogs({
    limit: 10,
  })

  return NextResponse.json({
    stats: {
      users: userCount,
      organizations: orgCount,
      activeSubscriptions: subscriptionCount,
    },
    recentActivity,
  })
}

