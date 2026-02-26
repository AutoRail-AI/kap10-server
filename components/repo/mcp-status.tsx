"use client"

import { Radio } from "lucide-react"
import { useEffect, useState } from "react"
import { useVisibility } from "@/hooks/use-visibility"

interface McpStatusProps {
  repoId: string
}

/** MCP session count poll — 60s interval, pauses when tab hidden. */
const POLL_INTERVAL_MS = 60_000

export function McpStatus({ repoId }: McpStatusProps) {
  const [activeSessions, setActiveSessions] = useState(0)
  const visible = useVisibility()

  useEffect(() => {
    // Pause when tab is hidden
    if (!visible) return

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
    const interval = setInterval(fetchStatus, POLL_INTERVAL_MS)

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [repoId, visible])

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Radio className={`h-3 w-3 ${activeSessions > 0 ? "text-electric-cyan" : "text-muted-foreground/50"}`} />
      {activeSessions > 0
        ? `${activeSessions} active session${activeSessions > 1 ? "s" : ""}`
        : "No active sessions"}
    </div>
  )
}
