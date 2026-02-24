"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronDown, ChevronRight, Copy, Download, Terminal } from "lucide-react"
import { usePipelineLogs } from "@/hooks/use-pipeline-logs"
import type { PipelineLogEntry } from "@/hooks/use-pipeline-logs"

interface PipelineLogViewerProps {
  repoId: string
  status: string
}

const ACTIVE_STATUSES = ["indexing", "embedding", "justifying", "ontology"]

function formatLogLine(entry: PipelineLogEntry): string {
  return `[${entry.timestamp}] [${entry.level.toUpperCase().padEnd(5)}] [${entry.phase}] ${entry.step ? `${entry.step} — ` : ""}${entry.message}`
}

export function PipelineLogViewer({ repoId, status }: PipelineLogViewerProps) {
  const isActive = ACTIVE_STATUSES.includes(status)
  const isError = status === "error" || status === "embed_failed" || status === "justify_failed"
  const { logs, source } = usePipelineLogs(repoId, isActive || isError || status === "ready")
  const [expanded, setExpanded] = useState(isActive || isError)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

  // Auto-expand when pipeline is active or errored
  useEffect(() => {
    if (isActive || isError) setExpanded(true)
  }, [isActive, isError])

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (scrollRef.current && expanded) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs.length, expanded])

  if (logs.length === 0 && source === "none") return null

  const handleCopy = async () => {
    const text = logs.map(formatLogLine).join("\n")
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="glass-card border-border rounded-lg border overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-2.5 hover:bg-muted/10 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">
            Pipeline Logs
          </span>
          {logs.length > 0 && (
            <span className="text-[10px] text-muted-foreground bg-muted/20 rounded px-1.5 py-0.5">
              {logs.length}
            </span>
          )}
          {source === "archived" && (
            <span className="text-[10px] text-muted-foreground">archived</span>
          )}
        </div>
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <>
          {/* Action bar */}
          <div className="flex items-center gap-1.5 px-4 py-1.5 border-t border-border bg-muted/5">
            <button
              type="button"
              aria-label="Copy all logs"
              className="hover-glow-cyan inline-flex items-center h-7 px-2.5 text-[10px] font-medium text-muted-foreground rounded-md border border-white/10 bg-white/6"
              onClick={handleCopy}
            >
              <Copy className="h-3 w-3 mr-1.5" />
              {copied ? "Copied" : "Copy All"}
            </button>
            <a
              href={`/api/repos/${repoId}/logs/download`}
              download
              aria-label="Download logs"
              className="hover-glow-cyan inline-flex items-center h-7 px-2.5 text-[10px] font-medium text-muted-foreground rounded-md border border-white/10 bg-white/6"
            >
              <Download className="h-3 w-3 mr-1.5" />
              Download
            </a>
          </div>

          {/* Log area */}
          <div
            ref={scrollRef}
            className="max-h-64 overflow-y-auto border-t border-border bg-background/50 px-4 py-2 font-mono text-[11px] leading-relaxed"
          >
            {logs.map((entry, i) => (
              <div
                key={`${entry.timestamp}-${i}`}
                className={
                  entry.level === "error"
                    ? "text-destructive"
                    : entry.level === "warn"
                      ? "text-yellow-500"
                      : "text-muted-foreground"
                }
              >
                <span className="text-muted-foreground/50 select-none">
                  {new Date(entry.timestamp).toLocaleTimeString()}{" "}
                </span>
                <span className="text-muted-foreground/70">[{entry.phase}]</span>{" "}
                {entry.step && (
                  <span className="text-foreground/70">{entry.step} — </span>
                )}
                <span>{entry.message}</span>
              </div>
            ))}
            {isActive && (
              <span className="inline-block w-1.5 h-3.5 bg-foreground/60 animate-pulse ml-0.5" />
            )}
          </div>
        </>
      )}
    </div>
  )
}
