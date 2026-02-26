"use client"

import { Copy, Key, Plus, RotateCw, ShieldCheck, Trash2 } from "lucide-react"
import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface ApiKeyItem {
  id: string
  keyPrefix: string
  name: string
  scopes: string[]
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
}

interface ApiKeyManagerProps {
  repoId: string
  initialKeys: ApiKeyItem[]
}

export function ApiKeyManager({ repoId, initialKeys }: ApiKeyManagerProps) {
  const [keys, setKeys] = useState<ApiKeyItem[]>(initialKeys)
  const [name, setName] = useState("")
  const [syncEnabled, setSyncEnabled] = useState(true)
  const [loading, setLoading] = useState(false)
  const [newKeyRaw, setNewKeyRaw] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const handleGenerate = async () => {
    if (!name.trim()) return
    setLoading(true)
    try {
      const res = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoId,
          name: name.trim(),
          scopes: syncEnabled ? ["mcp:read", "mcp:sync"] : ["mcp:read"],
        }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { error: string }
        alert(data.error)
        return
      }
      const data = (await res.json()) as {
        id: string
        key: string
        keyPrefix: string
        name: string
        scopes: string[]
        createdAt: string
      }
      setNewKeyRaw(data.key)
      setKeys((prev) => [
        {
          id: data.id,
          keyPrefix: data.keyPrefix,
          name: data.name,
          scopes: data.scopes,
          lastUsedAt: null,
          revokedAt: null,
          createdAt: data.createdAt,
        },
        ...prev,
      ])
      setName("")
    } finally {
      setLoading(false)
    }
  }

  const handleRevoke = async (id: string) => {
    if (!confirm("Revoke this API key? Active MCP sessions using this key will be disconnected.")) return
    const res = await fetch(`/api/api-keys/${id}`, { method: "DELETE" })
    if (res.ok) {
      setKeys((prev) =>
        prev.map((k) => (k.id === id ? { ...k, revokedAt: new Date().toISOString() } : k))
      )
    }
  }

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const activeKeys = keys.filter((k) => !k.revokedAt)

  return (
    <div className="space-y-4">
      {/* Generate new key */}
      <div className="glass-card rounded-lg border border-border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Key className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Generate API Key
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Key name (e.g., Cursor IDE, CI Pipeline)"
            className="h-9 text-sm flex-1"
          />
          <Button
            size="sm"
            className="bg-rail-fade hover:opacity-90 gap-1.5"
            onClick={handleGenerate}
            disabled={loading || !name.trim()}
          >
            {loading ? <RotateCw className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Generate
          </Button>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={syncEnabled}
            onChange={(e) => setSyncEnabled(e.target.checked)}
            className="rounded border-border"
          />
          <ShieldCheck className="h-3 w-3" />
          Allow Workspace Sync (mcp:sync)
          <span className="text-muted-foreground/70">
            — Uncheck for read-only keys (CI pipelines, dashboards)
          </span>
        </label>
      </div>

      {/* New key alert */}
      {newKeyRaw && (
        <div className="rounded-lg border border-electric-cyan/30 bg-electric-cyan/5 p-4 space-y-2">
          <p className="text-xs font-semibold text-electric-cyan">
            API Key Generated — Copy it now, it won't be shown again
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-muted/20 px-2 py-1 font-mono text-xs text-foreground break-all">
              {newKeyRaw}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleCopy(newKeyRaw)}
              className="h-7 gap-1.5 px-2 text-xs"
            >
              <Copy className="h-3 w-3" />
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setNewKeyRaw(null)}
            className="h-6 px-2 text-xs text-muted-foreground"
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* Active keys list */}
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
    </div>
  )
}
