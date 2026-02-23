"use client"

import { useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export default function NewRulePage() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const repoId = pathname.match(/\/repos\/([^/]+)/)?.[1] ?? ""

  // Pre-fill from query params (from InsightCard "Create Rule" links)
  const [title, setTitle] = useState(searchParams.get("title") ?? "")
  const [description, setDescription] = useState(searchParams.get("description") ?? "")
  const [type, setType] = useState(searchParams.get("type") ?? "architecture")
  const [scope, setScope] = useState("repo")
  const [enforcement, setEnforcement] = useState(searchParams.get("enforcement") ?? "suggest")
  const [priority, setPriority] = useState(
    searchParams.get("priority") ? Number(searchParams.get("priority")) : 50
  )
  const [astGrepQuery, setAstGrepQuery] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError("")

    try {
      const res = await fetch(`/api/repos/${repoId}/rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          type,
          scope,
          enforcement,
          priority,
          astGrepQuery: astGrepQuery || undefined,
        }),
      })

      if (res.ok) {
        router.push(`/repos/${repoId}/rules`)
      } else {
        const json = (await res.json()) as { error?: string }
        setError(json.error ?? "Failed to create rule")
      }
    } catch {
      setError("Network error")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6 py-6 animate-fade-in max-w-2xl">
      <div className="space-y-1">
        <h1 className="font-grotesk text-lg font-semibold text-foreground">Create Rule</h1>
        <p className="text-sm text-foreground mt-0.5">
          Define a new architecture rule for this repository
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Title</label>
          <Input
            className="h-9"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., No direct database access from components"
            required
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Description</label>
          <textarea
            className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what this rule enforces and why"
            required
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Type</label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="architecture">Architecture</option>
              <option value="naming">Naming</option>
              <option value="security">Security</option>
              <option value="performance">Performance</option>
              <option value="style">Style</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Scope</label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="org">Organization</option>
              <option value="repo">Repository</option>
              <option value="path">Path</option>
              <option value="branch">Branch</option>
              <option value="workspace">Workspace</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Enforcement</label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
              value={enforcement}
              onChange={(e) => setEnforcement(e.target.value)}
            >
              <option value="suggest">Suggest</option>
              <option value="warn">Warn</option>
              <option value="block">Block</option>
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Priority (0-100)</label>
          <Input
            className="h-9"
            type="number"
            min={0}
            max={100}
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">AST-grep Pattern (optional)</label>
          <textarea
            className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={astGrepQuery}
            onChange={(e) => setAstGrepQuery(e.target.value)}
            placeholder='e.g., console.log($$$ARGS)'
          />
        </div>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <div className="flex items-center gap-3">
          <Button size="sm" type="submit" className="bg-rail-fade hover:opacity-90" disabled={submitting}>
            {submitting ? "Creating..." : "Create Rule"}
          </Button>
          <Button size="sm" type="button" variant="ghost" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}
