"use client"

import { useState } from "react"
import { Check, Copy, ExternalLink, Terminal, Zap } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ApiKeyManager } from "./api-key-manager"

interface ConnectIdeProps {
  repoId: string
  repoName: string
  mcpServerUrl: string
  apiKeys: Array<{
    id: string
    keyPrefix: string
    name: string
    scopes: string[]
    lastUsedAt: string | null
    revokedAt: string | null
    createdAt: string
  }>
}

type Tab = "oauth" | "apikey"

export function ConnectIde({ repoId, repoName, mcpServerUrl, apiKeys }: ConnectIdeProps) {
  const [activeTab, setActiveTab] = useState<Tab>("apikey")
  const [copied, setCopied] = useState<string | null>(null)

  const handleCopy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 2000)
  }

  const mcpUrl = `${mcpServerUrl}/mcp`

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex gap-1 rounded-lg border border-border bg-muted/10 p-1">
        <button
          onClick={() => setActiveTab("oauth")}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === "oauth"
              ? "bg-muted/30 text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <div className="flex items-center justify-center gap-1.5">
            <Zap className="h-3 w-3" />
            OAuth
            <Badge variant="outline" className="h-4 px-1 text-[9px] font-normal text-electric-cyan border-electric-cyan/30">
              Recommended
            </Badge>
          </div>
        </button>
        <button
          onClick={() => setActiveTab("apikey")}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === "apikey"
              ? "bg-muted/30 text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <div className="flex items-center justify-center gap-1.5">
            <Terminal className="h-3 w-3" />
            API Key
          </div>
        </button>
      </div>

      {/* OAuth tab */}
      {activeTab === "oauth" && (
        <div className="space-y-4">
          <div className="glass-card rounded-lg border border-border p-4 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">
              OAuth Authentication
            </h3>
            <p className="text-xs text-muted-foreground">
              For Claude Code and VS Code. Your IDE will open a browser for authentication — no API key needed.
            </p>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">MCP Server URL</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md border border-border bg-muted/20 px-3 py-2 font-mono text-xs text-foreground">
                  {mcpUrl}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleCopy(mcpUrl, "oauth-url")}
                  className="h-9 gap-1.5 px-3 text-xs"
                >
                  {copied === "oauth-url" ? (
                    <Check className="h-3.5 w-3.5 text-electric-cyan" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copied === "oauth-url" ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground/70">
              Paste this URL into your IDE's MCP server configuration. OAuth scope: <code className="text-xs">mcp:read mcp:sync</code> (full access).
            </p>
          </div>

          <div className="glass-card rounded-lg border border-border p-4 space-y-3">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Terminal className="h-3.5 w-3.5" />
              Claude Code CLI
            </h3>
            <CodeBlock
              code={`claude mcp add kap10 --transport streamable-http --url ${mcpUrl}`}
              label="claude-code"
              onCopy={handleCopy}
              copied={copied}
            />
          </div>
        </div>
      )}

      {/* API Key tab */}
      {activeTab === "apikey" && (
        <div className="space-y-4">
          <ApiKeyManager repoId={repoId} initialKeys={apiKeys} />

          <div className="glass-card rounded-lg border border-border p-4 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">
              Cursor IDE Configuration
            </h3>
            <p className="text-xs text-muted-foreground">
              Add this to your <code className="text-xs">.cursor/mcp.json</code>:
            </p>
            <CodeBlock
              code={JSON.stringify({
                mcpServers: {
                  kap10: {
                    url: mcpUrl,
                    transport: "streamable-http",
                    headers: {
                      Authorization: "Bearer <your-api-key>",
                    },
                  },
                },
              }, null, 2)}
              label="cursor-config"
              onCopy={handleCopy}
              copied={copied}
            />
          </div>

          <div className="glass-card rounded-lg border border-border p-4 space-y-3">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Terminal className="h-3.5 w-3.5" />
              Claude Code CLI
            </h3>
            <CodeBlock
              code={`claude mcp add kap10 --transport streamable-http --url ${mcpUrl} --header "Authorization: Bearer <your-api-key>"`}
              label="claude-cli"
              onCopy={handleCopy}
              copied={copied}
            />
          </div>

          <div className="glass-card rounded-lg border border-border p-4 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">
              CI / Automation
            </h3>
            <p className="text-xs text-muted-foreground">
              Use an environment variable for the API key:
            </p>
            <CodeBlock
              code={JSON.stringify({
                mcpServers: {
                  kap10: {
                    url: mcpUrl,
                    transport: "streamable-http",
                    headers: {
                      Authorization: "Bearer ${KAP10_API_KEY}",
                    },
                  },
                },
              }, null, 2)}
              label="ci-config"
              onCopy={handleCopy}
              copied={copied}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function CodeBlock({
  code,
  label,
  onCopy,
  copied,
}: {
  code: string
  label: string
  onCopy: (text: string, label: string) => void
  copied: string | null
}) {
  return (
    <div className="relative">
      <pre className="rounded-md border border-border bg-muted/20 p-3 font-mono text-xs text-foreground overflow-x-auto">
        {code}
      </pre>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => onCopy(code, label)}
        className="absolute right-2 top-2 h-6 gap-1 px-1.5 text-[10px]"
      >
        {copied === label ? (
          <Check className="h-3 w-3 text-electric-cyan" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
      </Button>
    </div>
  )
}
