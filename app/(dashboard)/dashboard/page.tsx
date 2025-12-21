"use client"

import { useDashboard } from "@/hooks"
import { StatsCards, RecentAppeals, RecentConversations, UsageChart } from "@/components/dashboard"
import { Button } from "@/components/ui/button"
import { RefreshCw } from "lucide-react"

export default function DashboardPage() {
  const {
    stats,
    usageHistory,
    recentAppeals,
    recentConversations,
    isLoading,
    refresh,
  } = useDashboard()

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Welcome back</h1>
          <p className="text-muted-foreground mt-1">
            Here's an overview of your appeal generation activity.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="space-y-8">
        {/* Stats Cards */}
        <StatsCards stats={stats} isLoading={isLoading} />

        {/* Usage Chart */}
        <UsageChart data={usageHistory} isLoading={isLoading} />

        {/* Recent Activity */}
        <div className="grid gap-8 lg:grid-cols-2">
          <RecentAppeals appeals={recentAppeals} isLoading={isLoading} />
          <RecentConversations conversations={recentConversations} isLoading={isLoading} />
        </div>
      </div>
    </div>
  )
}
