"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { FileText, TrendingUp, MessageSquare, FolderOpen } from "lucide-react"
import type { DashboardStats } from "@/lib/types/dashboard"

interface StatsCardsProps {
  stats: DashboardStats | undefined
  isLoading?: boolean
}

export function StatsCards({ stats, isLoading }: StatsCardsProps) {
  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-4" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-3 w-32 mt-1" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  const cards = [
    {
      title: "Total Appeals",
      value: stats?.totalAppeals ?? 0,
      description: `${stats?.appealsThisMonth ?? 0} this month`,
      icon: FileText,
    },
    {
      title: "Success Rate",
      value: `${stats?.successRate ?? 0}%`,
      description: "Downloaded or submitted",
      icon: TrendingUp,
    },
    {
      title: "Conversations",
      value: stats?.conversationsCount ?? 0,
      description: "Active chat threads",
      icon: MessageSquare,
    },
    {
      title: "Documents",
      value: stats?.documentsUploaded ?? 0,
      description: "Policy documents",
      icon: FolderOpen,
    },
  ]

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
            <card.icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{card.value}</div>
            <p className="text-xs text-muted-foreground">{card.description}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
