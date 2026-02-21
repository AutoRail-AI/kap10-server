"use client"

import { useState } from "react"
import { Key, Trash2 } from "lucide-react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

interface ApiKeyItem {
  id: string
  keyPrefix: string
  name: string
  repoId: string
  repoName: string
  scopes: string[]
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
}

interface ApiKeysSettingsProps {
  initialKeys: ApiKeyItem[]
}

export function ApiKeysSettings({ initialKeys }: ApiKeysSettingsProps) {
  const [keys, setKeys] = useState<ApiKeyItem[]>(initialKeys)

  const activeKeys = keys.filter((k) => !k.revokedAt)
  const revokedKeys = keys.filter((k) => k.revokedAt)

  const handleRevoke = async (id: string) => {
    if (!confirm("Revoke this API key? Active MCP sessions using this key will be disconnected.")) return
    const res = await fetch(`/api/api-keys/${id}`, { method: "DELETE" })
    if (res.ok) {
      setKeys((prev) =>
        prev.map((k) => (k.id === id ? { ...k, revokedAt: new Date().toISOString() } : k))
      )
    }
  }

  if (keys.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted/30 mb-4">
          <Key className="h-5 w-5 text-muted-foreground" />
        </div>
        <h2 className="font-grotesk text-base font-semibold text-foreground">No API Keys</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          API keys are created per repository. Navigate to a repository's "Connect to IDE" page to generate keys.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {activeKeys.length > 0 && (
        <div className="glass-card rounded-lg border border-border divide-y divide-border">
          <div className="px-4 py-2.5 border-b border-border">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Active Keys ({activeKeys.length})
            </h3>
          </div>
          {activeKeys.map((key) => (
            <div key={key.id} className="flex items-center justify-between px-4 py-2.5">
              <div className="flex items-center gap-3 min-w-0">
                <Key className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{key.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <code className="font-mono text-xs text-muted-foreground">{key.keyPrefix}</code>
                    <Link
                      href={`/repos/${key.repoId}/connect`}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors truncate max-w-[200px]"
                    >
                      {key.repoName}
                    </Link>
                    <div className="flex gap-1">
                      {key.scopes.map((scope) => (
                        <Badge
                          key={scope}
                          variant="outline"
                          className="h-4 px-1 text-[9px] font-normal"
                        >
                          {scope.replace("mcp:", "")}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {key.lastUsedAt && (
                  <span className="text-xs text-muted-foreground">
                    Used {new Date(key.lastUsedAt).toLocaleDateString()}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  Created {new Date(key.createdAt).toLocaleDateString()}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleRevoke(key.id)}
                  className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {revokedKeys.length > 0 && (
        <div className="glass-card rounded-lg border border-border divide-y divide-border opacity-60">
          <div className="px-4 py-2.5 border-b border-border">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Revoked Keys ({revokedKeys.length})
            </h3>
          </div>
          {revokedKeys.map((key) => (
            <div key={key.id} className="flex items-center justify-between px-4 py-2.5">
              <div className="flex items-center gap-3 min-w-0">
                <Key className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate line-through">{key.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <code className="font-mono text-xs text-muted-foreground">{key.keyPrefix}</code>
                    <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                      {key.repoName}
                    </span>
                  </div>
                </div>
              </div>
              <span className="text-xs text-muted-foreground shrink-0">
                Revoked {key.revokedAt ? new Date(key.revokedAt).toLocaleDateString() : ""}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        To generate new API keys, go to a repository's{" "}
        <span className="text-foreground font-medium">Connect to IDE</span> page.
      </p>
    </div>
  )
}
