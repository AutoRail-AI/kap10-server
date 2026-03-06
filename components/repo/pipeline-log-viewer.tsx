"use client"

import { Copy, Download, Terminal } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { usePipelineLogs } from "@/hooks/use-pipeline-logs"
import type { PipelineLogEntry } from "@/hooks/use-pipeline-logs"

interface PipelineLogViewerProps {
  repoId: string
  status: string
  runId?: string
}

const ACTIVE_STATUSES = ["indexing", "embedding", "justifying", "ontology"]

function formatLogLine(entry: PipelineLogEntry): string {
  return `[${entry.timestamp}] [${entry.level.toUpperCase().padEnd(5)}] [${entry.phase}] ${entry.step ? `${entry.step} — ` : ""}${entry.message}`
}

export function PipelineLogViewer({ repoId, status, runId }: PipelineLogViewerProps) {
  const isActive = ACTIVE_STATUSES.includes(status)
  const isError = status === "error" || status === "embed_failed" || status === "justify_failed"
  const { logs, source } = usePipelineLogs(repoId, isActive || isError || status === "ready", runId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs.length])

  if (logs.length === 0 && source === "none") return null

  const handleCopy = async () => {
    const text = logs.map(formatLogLine).join("\n")
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex flex-col h-full rounded-lg border border-border bg-[#08080D] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/[0.06] bg-white/[0.02] shrink-0">
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-muted-foreground/60" />
          <span className="text-[11px] font-medium text-muted-foreground">
            Pipeline Logs
          </span>
          {logs.length > 0 && (
            <span className="text-[10px] text-muted-foreground/50 bg-white/[0.04] rounded px-1.5 py-0.5 font-mono tabular-nums">
              {logs.length}
            </span>
          )}
          {source === "archived" && (
            <span className="text-[10px] text-muted-foreground/40">archived</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Copy all logs"
            className="inline-flex items-center h-6 px-2 text-[10px] text-muted-foreground/60 rounded hover:text-muted-foreground hover:bg-white/[0.04] transition-colors"
            onClick={handleCopy}
          >
            <Copy className="h-3 w-3 mr-1" />
            {copied ? "Copied" : "Copy"}
          </button>
          <a
            href={`/api/repos/${repoId}/logs/download`}
            download
            aria-label="Download logs"
            className="inline-flex items-center h-6 px-2 text-[10px] text-muted-foreground/60 rounded hover:text-muted-foreground hover:bg-white/[0.04] transition-colors"
          >
            <Download className="h-3 w-3 mr-1" />
            Download
          </a>
        </div>
      </div>

      {/* Log area — fills remaining height */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-[1.6]"
      >
        {logs.map((entry, i) => (
          <div
            key={`${entry.timestamp}-${i}`}
            className={
              entry.level === "error"
                ? "text-destructive/80"
                : entry.level === "warn"
                  ? "text-yellow-500/70"
                  : "text-white/30"
            }
          >
            <span className="text-white/15 select-none">
              {new Date(entry.timestamp).toLocaleTimeString()}{" "}
            </span>
            <span className="text-white/20">[{entry.phase}]</span>{" "}
            {entry.step && (
              <span className="text-white/40">{entry.step} — </span>
            )}
            <span className={
              entry.level === "error"
                ? "text-destructive/90"
                : entry.level === "warn"
                  ? "text-yellow-500/80"
                  : "text-white/50"
            }>{entry.message}</span>
          </div>
        ))}
        {isActive && (
          <span className="inline-block w-1.5 h-3 bg-electric-cyan/60 animate-pulse ml-0.5" />
        )}
      </div>
    </div>
  )
}
