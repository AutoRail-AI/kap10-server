"use client"

import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { FileText, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { RecentAppeal } from "@/lib/types/dashboard"

interface RecentAppealsProps {
  appeals: RecentAppeal[] | undefined
  isLoading?: boolean
}

const statusConfig = {
  draft: { label: "Draft", className: "bg-gray-100 text-gray-800" },
  generated: { label: "Generated", className: "bg-blue-100 text-blue-800" },
  downloaded: { label: "Downloaded", className: "bg-green-100 text-green-800" },
  submitted: { label: "Submitted", className: "bg-purple-100 text-purple-800" },
}

export function RecentAppeals({ appeals, isLoading }: RecentAppealsProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Recent Appeals</CardTitle>
          <CardDescription>Your latest generated appeals</CardDescription>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/history">
            View all
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-10 w-10 rounded" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-6 w-20" />
              </div>
            ))}
          </div>
        ) : appeals && appeals.length > 0 ? (
          <div className="space-y-4">
            {appeals.map((appeal) => {
              const status = statusConfig[appeal.status]
              return (
                <Link
                  key={appeal.id}
                  href={`/history/${appeal.id}`}
                  className="flex items-center gap-4 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{appeal.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {appeal.provider || "No provider"} ·{" "}
                      {new Date(appeal.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge variant="secondary" className={status.className}>
                    {status.label}
                  </Badge>
                </Link>
              )
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <FileText className="h-10 w-10 text-muted-foreground mb-4" />
            <p className="text-sm text-muted-foreground">No appeals yet</p>
            <Button variant="link" size="sm" asChild className="mt-2">
              <Link href="/chat">Start a new appeal</Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
