"use client"

import { useState } from "react"
import {
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  MousePointerClick,
  Settings2,
  Terminal,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ApiKeyManager } from "./api-key-manager"

interface ConnectIdeProps {
  repoId: string
  repoName: string
  mcpServerUrl: string
  mcpEnvironment: "local" | "production" | "custom"
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

type ClientId = "cursor" | "claude-code" | "vscode" | "ci"

interface ClientOption {
  id: ClientId
  label: string
  icon: React.ReactNode
  auth: "api-key" | "oauth"
  description: string
}

const clients: ClientOption[] = [
  {
    id: "cursor",
    label: "Cursor",
    icon: <MousePointerClick className="h-4 w-4" />,
    auth: "api-key",
    description: "Add to .cursor/mcp.json",
  },
  {
    id: "claude-code",
    label: "Claude Code",
    icon: <Terminal className="h-4 w-4" />,
    auth: "oauth",
    description: "Run one CLI command",
  },
  {
    id: "vscode",
    label: "VS Code",
    icon: <Code2 className="h-4 w-4" />,
    auth: "oauth",
    description: "Add to settings.json",
  },
  {
    id: "ci",
    label: "CI / Manual",
    icon: <Settings2 className="h-4 w-4" />,
    auth: "api-key",
    description: "JSON config with env var",
  },
]

export function ConnectIde({
  repoId,
  repoName,
  mcpServerUrl,
  mcpEnvironment,
  apiKeys,
}: ConnectIdeProps) {
  const [copied, setCopied] = useState<string | null>(null)
  const [manualExpanded, setManualExpanded] = useState(false)
  const [selectedClient, setSelectedClient] = useState<ClientId | null>(null)
  const [keysExpanded, setKeysExpanded] = useState(false)

  const mcpUrl = `${mcpServerUrl}/mcp`
  const activeKeys = apiKeys.filter((k) => !k.revokedAt)
  const needsApiKey = selectedClient === "cursor" || selectedClient === "ci"

  const handleCopy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 2000)
  }

  const handleSelectClient = (id: ClientId) => {
    setSelectedClient(id)
    const clientNeedsKey = id === "cursor" || id === "ci"
    if (clientNeedsKey && activeKeys.length === 0) {
      setKeysExpanded(true)
    }
  }

  const environmentLabel =
    mcpEnvironment === "local"
      ? "Local Dev"
      : mcpEnvironment === "production"
        ? "Production"
        : "Custom"

  const environmentColor =
    mcpEnvironment === "local"
      ? "text-amber-400 border-amber-400/30"
      : mcpEnvironment === "production"
        ? "text-electric-cyan border-electric-cyan/30"
        : "text-rail-purple border-rail-purple/30"

  const cliCommand = "npx @autorail/unerr connect"

  return (
    <div className="space-y-5">
      {/* Environment badge */}
      <div className="flex items-center gap-2">
        <Badge variant="outline" className={`h-5 px-2 text-[10px] font-normal ${environmentColor}`}>
          {environmentLabel}
        </Badge>
        <code className="text-xs text-muted-foreground font-mono">{mcpUrl}</code>
      </div>

      {/* Primary CTA: CLI */}
      <div className="glass-card rounded-lg border border-rail-purple/30 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-rail-purple" />
          <h3 className="text-sm font-semibold text-foreground">Quickstart</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Run this in your project directory. It handles authentication, detects your IDE, and configures MCP automatically.
        </p>
        <CodeBlock
          code={cliCommand}
          label="cli-command"
          onCopy={handleCopy}
          copied={copied}
        />
      </div>

      {/* Manual setup accordion */}
      <div className="space-y-0">
        <button
          onClick={() => setManualExpanded((prev) => !prev)}
          className="flex items-center gap-2 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {manualExpanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          Manual setup
        </button>

        {manualExpanded && (
          <div className="space-y-4 animate-fade-in pt-1">
            {/* Client picker */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {clients.map((client) => (
                <button
                  key={client.id}
                  onClick={() => handleSelectClient(client.id)}
                  className={`group flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-all ${
                    selectedClient === client.id
                      ? "border-rail-purple/60 bg-rail-purple/10"
                      : "border-border bg-muted/5 hover:border-border/80 hover:bg-muted/10"
                  }`}
                >
                  <span
                    className={`${
                      selectedClient === client.id
                        ? "text-foreground"
                        : "text-muted-foreground group-hover:text-foreground"
                    } transition-colors`}
                  >
                    {client.icon}
                  </span>
                  <span className="text-xs font-medium text-foreground">{client.label}</span>
                  <span className="text-[10px] text-muted-foreground">{client.description}</span>
                </button>
              ))}
            </div>

            {/* Instruction card */}
            {!selectedClient && (
              <p className="text-sm text-muted-foreground text-center py-4">
                Select your IDE to get started
              </p>
            )}

            {selectedClient === "cursor" && (
              <InstructionCard title="Cursor Configuration" animate>
                <p className="text-xs text-muted-foreground">
                  Add to <code className="text-xs">.cursor/mcp.json</code> in your project root:
                </p>
                <CodeBlock
                  code={JSON.stringify(
                    {
                      mcpServers: {
                        unerr: {
                          url: mcpUrl,
                          transport: "streamable-http",
                          headers: {
                            Authorization: "Bearer <your-api-key>",
                          },
                        },
                      },
                    },
                    null,
                    2
                  )}
                  label="cursor-config"
                  onCopy={handleCopy}
                  copied={copied}
                />
              </InstructionCard>
            )}

            {selectedClient === "claude-code" && (
              <InstructionCard title="Claude Code" animate>
                <p className="text-xs text-muted-foreground">
                  Run this command in your terminal. OAuth will open a browser for authentication.
                </p>
                <CodeBlock
                  code={`claude mcp add unerr --transport streamable-http --url ${mcpUrl}`}
                  label="claude-code"
                  onCopy={handleCopy}
                  copied={copied}
                />
              </InstructionCard>
            )}

            {selectedClient === "vscode" && (
              <InstructionCard title="VS Code Configuration" animate>
                <p className="text-xs text-muted-foreground">
                  Add to your <code className="text-xs">.vscode/settings.json</code>. OAuth will open a browser for authentication.
                </p>
                <CodeBlock
                  code={JSON.stringify(
                    {
                      "mcp.servers": {
                        unerr: {
                          url: mcpUrl,
                          transport: "streamable-http",
                        },
                      },
                    },
                    null,
                    2
                  )}
                  label="vscode-config"
                  onCopy={handleCopy}
                  copied={copied}
                />
              </InstructionCard>
            )}

            {selectedClient === "ci" && (
              <InstructionCard title="CI / Manual Configuration" animate>
                <p className="text-xs text-muted-foreground">
                  Use an environment variable for the API key. Set <code className="text-xs">UNERR_API_KEY</code> in your CI secrets.
                </p>
                <CodeBlock
                  code={JSON.stringify(
                    {
                      mcpServers: {
                        unerr: {
                          url: mcpUrl,
                          transport: "streamable-http",
                          headers: {
                            Authorization: "Bearer ${UNERR_API_KEY}",
                          },
                        },
                      },
                    },
                    null,
                    2
                  )}
                  label="ci-config"
                  onCopy={handleCopy}
                  copied={copied}
                />
              </InstructionCard>
            )}

            {/* Collapsible API Keys section */}
            {selectedClient && (
              <div className="space-y-0">
                <button
                  onClick={() => setKeysExpanded((prev) => !prev)}
                  className="flex items-center gap-2 py-2 text-sm font-medium text-foreground hover:text-foreground/80 transition-colors"
                >
                  {keysExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                  API Keys
                  {activeKeys.length > 0 && (
                    <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-normal">
                      {activeKeys.length}
                    </Badge>
                  )}
                  {needsApiKey && activeKeys.length === 0 && (
                    <Badge
                      variant="outline"
                      className="h-4 px-1.5 text-[10px] font-normal text-amber-400 border-amber-400/30"
                    >
                      Required
                    </Badge>
                  )}
                </button>
                {keysExpanded && (
                  <div className="animate-fade-in">
                    <ApiKeyManager repoId={repoId} initialKeys={apiKeys} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function InstructionCard({
  title,
  animate,
  children,
}: {
  title: string
  animate?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={`glass-card rounded-lg border border-border p-4 space-y-3 ${
        animate ? "animate-fade-in" : ""
      }`}
    >
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children}
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
