import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { connectDB } from "@/lib/db/mongoose"
import { prisma } from "@/lib/db/prisma"
import { getAuditLogs } from "@/lib/audit/logger"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default async function AdminDashboard() {
  const session = await auth.api.getSession({ headers: await headers() })
  await connectDB()

  // Get stats
  const userCount = await prisma.user.count()
  let orgCount = 0
  try {
    orgCount = await (prisma as any).organization?.count() || 0
  } catch {
    // Organization model might not exist yet
  }

  const { Subscription } = await import("@/lib/models/billing")
  const subscriptionCount = await Subscription.countDocuments({
    status: "active",
  })

  const recentActivity = await getAuditLogs({ limit: 10 })

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Admin Dashboard</h1>
        <p className="text-muted-foreground">Platform administration and monitoring</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Users</CardTitle>
            <CardDescription>Total registered users</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{userCount}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Organizations</CardTitle>
            <CardDescription>Total organizations</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{orgCount}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active Subscriptions</CardTitle>
            <CardDescription>Currently active subscriptions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{subscriptionCount}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>Latest audit log entries</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {recentActivity.map((log) => (
              <div key={log._id.toString()} className="flex justify-between text-sm">
                <span>
                  {log.action} {log.resource}
                </span>
                <span className="text-muted-foreground">
                  {new Date(log.createdAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

