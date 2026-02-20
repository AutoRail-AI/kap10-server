"use client"

import { useEffect, useState } from "react"
import { Radio } from "lucide-react"

interface McpStatusProps {
  repoId: string
}

export function McpStatus({ repoId }: McpStatusProps) {
  const [activeSessions, setActiveSessions] = useState(0)

  useEffect(() => {
    let mounted = true

    async function fetchStatus() {
      try {
        const res = await fetch(`/api/repos/${repoId}/mcp-sessions`)
        if (res.ok && mounted) {
          const data = (await res.json()) as { activeSessions: number }
          setActiveSessions(data.activeSessions)
        }
      } catch {
        // ignore fetch errors
      }
    }

    fetchStatus()
    const interval = setInterval(fetchStatus, 30000) // Refresh every 30s

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [repoId])

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Radio className={`h-3 w-3 ${activeSessions > 0 ? "text-electric-cyan" : "text-muted-foreground/50"}`} />
      {activeSessions > 0
        ? `${activeSessions} active session${activeSessions > 1 ? "s" : ""}`
        : "No active sessions"}
    </div>
  )
}
