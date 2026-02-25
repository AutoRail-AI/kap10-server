"use client"

import { Check, Copy } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"

const CLI_COMMAND = "npx @autorail/unerr connect"

/**
 * CLI Hero — Terminal-first onboarding, top of overview.
 * Electric Cyan copy feedback, local-first messaging.
 */
export function CliHero() {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(CLI_COMMAND)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="glass-panel rounded-lg border border-border overflow-hidden">
      <div className="terminal-header flex items-center gap-2 px-4 py-2.5 border-b border-border">
        <div className="terminal-dot" style={{ background: "#FF5F57" }} />
        <div className="terminal-dot" style={{ background: "#FEBC2E" }} />
        <div className="terminal-dot" style={{ background: "#28C840" }} />
        <span className="ml-2 text-[11px] font-mono text-muted-foreground">
          unerr connect
        </span>
      </div>
      <div className="bg-[#0e0e14] p-5">
        <div className="flex items-center justify-between gap-4">
          <code className="font-mono text-sm text-electric-cyan break-all">
            {CLI_COMMAND}
          </code>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-electric-cyan hover:bg-electric-cyan/10 transition-colors"
            onClick={handleCopy}
            aria-label="Copy command"
          >
            {copied ? (
              <Check className="h-4 w-4 text-electric-cyan" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>
        <div className="mt-4 space-y-1">
          <h2 className="font-grotesk text-sm font-semibold text-foreground">
            Terminal-First Experience
          </h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Run this in your project root to authenticate and auto-configure your
            IDE. Works completely offline for local repositories—no GitHub
            connection required.
          </p>
        </div>
      </div>
    </div>
  )
}
