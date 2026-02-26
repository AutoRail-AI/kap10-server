"use client"

import { Check, Copy, Download, Terminal } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"

interface LocalSetupInstructionsProps {
  repoId: string
  repoName: string
  serverUrl: string
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={handleCopy}
      className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
    </Button>
  )
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="group relative rounded-md border border-border bg-muted/20 px-3 py-2">
      <code className="font-mono text-xs text-foreground">{code}</code>
      <div className="absolute right-2 top-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <CopyButton text={code} />
      </div>
    </div>
  )
}

export function LocalSetupInstructions({ repoId, repoName: _repoName, serverUrl }: LocalSetupInstructionsProps) {
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  const handleSync = async () => {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch(`/api/graph-snapshots/${repoId}/sync`, { method: "POST" })
      const body = (await res.json()) as { success: boolean; data?: { status: string } }
      if (body.success) {
        setSyncResult(body.data?.status === "already_running" ? "Sync already in progress" : "Sync started")
      } else {
        setSyncResult("Sync failed")
      }
    } catch {
      setSyncResult("Sync failed")
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Sync Now */}
      <div className="glass-card border-border rounded-lg border p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Download className="h-4 w-4 text-primary" />
          <h3 className="font-grotesk text-sm font-semibold text-foreground">Generate Local Snapshot</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Generate a graph snapshot for offline local queries. This exports the full knowledge graph to a compact binary format.
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleSync}
            disabled={syncing}
            className="bg-rail-fade hover:opacity-90 gap-1.5 h-7 text-xs"
          >
            <Download className="h-3 w-3" />
            {syncing ? "Syncing..." : "Sync Now"}
          </Button>
          {syncResult && (
            <span className="text-xs text-muted-foreground">{syncResult}</span>
          )}
        </div>
      </div>

      {/* CLI Setup */}
      <div className="glass-card border-border rounded-lg border p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-primary" />
          <h3 className="font-grotesk text-sm font-semibold text-foreground">CLI Setup</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Install the unerr CLI for local-first code intelligence with sub-5ms graph queries.
        </p>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground">1. Install CLI</p>
            <CodeBlock code="npm install -g @autorail/unerr" />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground">2. Authenticate</p>
            <CodeBlock code={`unerr auth login --server ${serverUrl}`} />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground">3. Pull graph snapshot</p>
            <CodeBlock code={`unerr pull --repo ${repoId}`} />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground">4. Start local MCP server</p>
            <CodeBlock code="unerr serve" />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground">5. (Optional) Enable pre-fetch</p>
            <CodeBlock code="unerr serve --prefetch" />
            <p className="text-[11px] text-muted-foreground">
              Predictive context pre-warming: pre-loads related entities as you navigate code.
            </p>
          </div>
        </div>

        <div className="rounded-md border border-border bg-muted/10 px-3 py-2">
          <p className="text-[11px] text-muted-foreground">
            The local MCP server provides 9 local tools (graph queries + rules) with sub-5ms latency and 4 cloud tools.
            Semantic search and stats are routed to the cloud automatically.
          </p>
        </div>
      </div>
    </div>
  )
}
