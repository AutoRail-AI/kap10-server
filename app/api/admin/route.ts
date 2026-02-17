import { headers } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { hasPermission } from "@/lib/config/roles"
import { supabase } from "@/lib/db"

// Middleware to check admin access
async function requireAdmin(_req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Check if user has admin permission
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

  // user and organization tables are managed by Better Auth, not our app Database type
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: userCount } = await (supabase as any)
    .from("user")
    .select("id", { count: "exact", head: true })

  // Get organization count
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: orgCount } = await (supabase as any)
    .from("organization")
    .select("id", { count: "exact", head: true })

  // Get active subscriptions
  const { count: subscriptionCount } = await supabase
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("status", "active")

  // Get recent activity
  const { getAuditLogs } = await import("@/lib/audit/logger")
  const recentActivity = await getAuditLogs({
    limit: 10,
  })

  return NextResponse.json({
    stats: {
      users: userCount || 0,
      organizations: orgCount || 0,
      activeSubscriptions: subscriptionCount || 0,
    },
    recentActivity,
  })
}
