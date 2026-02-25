"use client"

import { Check, Copy, Github, Terminal } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

const CLI_COMMAND = "npx @autorail/unerr connect"

interface OnboardingCommandCenterProps {
  installHref: string
}

/**
 * Onboarding Command Center — how to add repos: CLI (developer) or UI (manager).
 * Two-pillar layout: CLI terminal panel + GitHub App button.
 */
export function OnboardingCommandCenter({ installHref }: OnboardingCommandCenterProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(CLI_COMMAND)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for older browsers
      setCopied(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* CLI Route — Developer Preferred */}
      <div className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wider text-foreground flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-electric-cyan" />
          CLI (Developer)
        </h3>
        <div className="glass-panel rounded-lg border border-border overflow-hidden">
          <div className="terminal-header flex items-center gap-2 px-4 py-2.5 border-b border-border">
            <div className="terminal-dot" style={{ background: "#FF5F57" }} />
            <div className="terminal-dot" style={{ background: "#FEBC2E" }} />
            <div className="terminal-dot" style={{ background: "#28C840" }} />
            <span className="ml-2 text-[11px] font-mono text-muted-foreground">
              unerr connect
            </span>
          </div>
          <div className="bg-[#0e0e14] p-4 font-mono text-sm text-foreground">
            <div className="flex items-center justify-between gap-3">
              <code className="text-electric-cyan break-all">{CLI_COMMAND}</code>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-electric-cyan hover:bg-electric-cyan/10 transition-colors"
                onClick={handleCopy}
                aria-label="Copy command"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-success" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
              Run this in your project root to authenticate, detect the repo, and
              auto-configure your IDE&apos;s MCP. Zero clicks required.
            </p>
          </div>
        </div>
      </div>

      {/* UI Route — Visual Fallback */}
      <div className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wider text-foreground flex items-center gap-2">
          <Github className="h-3.5 w-3.5 text-electric-cyan" />
          UI (Manager)
        </h3>
        <Card className="glass-card border-border hover:border-electric-cyan/25 transition-colors">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
              Authorize the unerr GitHub App to select and index repositories
              manually.
            </p>
            <Button
              size="sm"
              asChild
              className="w-full sm:w-auto border border-electric-cyan/30 text-electric-cyan hover:bg-electric-cyan/10 hover:border-electric-cyan/50 bg-transparent"
            >
              <Link href={installHref}>Connect via GitHub App</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
