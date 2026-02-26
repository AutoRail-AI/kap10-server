"use client"

import { useParams } from "next/navigation"
import { useEffect, useState } from "react"
import { ReviewConfigForm } from "@/components/repo/review-config-form"
import { Skeleton } from "@/components/ui/skeleton"
import type { ReviewConfig } from "@/lib/ports/types"

export default function ReviewSettingsPage() {
  const params = useParams()
  const repoId = params.repoId as string
  const [config, setConfig] = useState<ReviewConfig | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/repos/${repoId}/settings/review`)
      .then((r) => r.json())
      .then((data) => {
        setConfig(data as ReviewConfig)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [repoId])

  return (
    <div className="space-y-6 py-6 animate-fade-in">
      <div className="space-y-1">
        <h1 className="font-grotesk text-lg font-semibold text-foreground">Review Settings</h1>
        <p className="text-sm text-muted-foreground">Configure automated PR review behavior</p>
      </div>

      <div className="glass-card p-6 max-w-2xl">
        {loading || !config ? (
          <div className="space-y-4">
            <Skeleton className="h-[40px] w-full" />
            <Skeleton className="h-[40px] w-full" />
            <Skeleton className="h-[40px] w-full" />
          </div>
        ) : (
          <ReviewConfigForm config={config} repoId={repoId} />
        )}
      </div>
    </div>
  )
}
