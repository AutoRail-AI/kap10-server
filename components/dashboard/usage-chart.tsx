"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { UsageData } from "@/lib/types/dashboard"

interface UsageChartProps {
  data: UsageData[] | undefined
  isLoading?: boolean
}

export function UsageChart({ data, isLoading }: UsageChartProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent>
          <div className="h-[200px] flex items-end gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton
                key={i}
                className="flex-1"
                style={{ height: `${Math.random() * 100 + 20}px` }}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  const maxAppeals = Math.max(...(data?.map((d) => d.appeals) || [1]), 1)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage History</CardTitle>
        <CardDescription>Appeals generated over the last 6 months</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[200px] flex items-end gap-2">
          {data?.map((item) => {
            const heightPercent = (item.appeals / maxAppeals) * 100
            return (
              <div key={item.month} className="flex-1 flex flex-col items-center gap-2">
                <div className="w-full flex flex-col items-center justify-end h-[160px]">
                  <span className="text-xs font-medium mb-1">
                    {item.appeals > 0 ? item.appeals : ""}
                  </span>
                  <div
                    className="w-full bg-primary rounded-t transition-all duration-300"
                    style={{
                      height: `${Math.max(heightPercent, item.appeals > 0 ? 10 : 2)}%`,
                      minHeight: item.appeals > 0 ? "20px" : "4px",
                    }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">{item.month}</span>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
