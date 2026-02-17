import { headers } from "next/headers"
import { ContentBlock, ContentBlockDescription, ContentBlockHeader, ContentBlockTitle } from "@/components/ui/content-block"
import { Metric, MetricGrid } from "@/components/ui/metric"
import { getAuditLogs } from "@/lib/audit/logger"
import { auth } from "@/lib/auth"
import { supabase } from "@/lib/db"

export default async function AdminDashboard() {
  await auth.api.getSession({ headers: await headers() })

  // Get stats from Supabase
  // user and organization tables are managed by Better Auth, not our app Database type
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: userCount } = await (supabase as any)
    .from("user")
    .select("id", { count: "exact", head: true })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: orgCount } = await (supabase as any)
    .from("organization")
    .select("id", { count: "exact", head: true })

  const { count: subscriptionCount } = await supabase
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("status", "active")

  const recentActivity = await getAuditLogs({ limit: 10 })

  return (
    <div className="container mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-6">
      <div className="space-y-0.5">
        <h1 className="text-lg font-semibold">Admin Dashboard</h1>
        <p className="mt-0.5 text-sm text-foreground">Platform administration and monitoring</p>
      </div>

      <MetricGrid>
        <Metric
          label="Users"
          value={userCount || 0}
          description="Total registered users"
        />
        <Metric
          label="Organizations"
          value={orgCount || 0}
          description="Total organizations"
        />
        <Metric
          label="Active Subscriptions"
          value={subscriptionCount || 0}
          description="Currently active subscriptions"
        />
      </MetricGrid>

      <ContentBlock>
        <ContentBlockHeader>
          <ContentBlockTitle>Recent Activity</ContentBlockTitle>
          <ContentBlockDescription>Latest audit log entries</ContentBlockDescription>
        </ContentBlockHeader>
        <div className="space-y-2">
          {recentActivity.map((log) => (
            <div key={log.id} className="flex justify-between text-sm">
              <span className="text-foreground">
                {log.action} {log.resource}
              </span>
              <span className="text-muted-foreground">
                {new Date(log.created_at).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </ContentBlock>
    </div>
  )
}
