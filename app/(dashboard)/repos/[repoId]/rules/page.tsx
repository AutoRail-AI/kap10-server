"use client"

import { Plus, Shield, Trash2 } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

interface Rule {
  id: string
  title: string
  description: string
  type: string
  scope: string
  enforcement: string
  priority: number
  status: string
  languages?: string[]
}

export default function RulesPage() {
  const pathname = usePathname()
  const repoId = pathname.match(/\/repos\/([^/]+)/)?.[1] ?? ""
  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchRules() {
      try {
        const res = await fetch(`/api/repos/${repoId}/rules`)
        if (res.ok) {
          const json = (await res.json()) as { data: { rules: Rule[] } }
          setRules(json.data.rules)
        }
      } catch {
        // fetch failed
      } finally {
        setLoading(false)
      }
    }
    if (repoId) fetchRules()
  }, [repoId])

  async function handleDelete(ruleId: string) {
    const res = await fetch(`/api/repos/${repoId}/rules/${ruleId}`, { method: "DELETE" })
    if (res.ok) {
      setRules((prev) => prev.filter((r) => r.id !== ruleId))
    }
  }

  return (
    <div className="space-y-6 py-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="font-grotesk text-lg font-semibold text-foreground">Rules</h1>
          <p className="text-sm text-foreground mt-0.5">
            Architecture rules and code policies for this repository
          </p>
        </div>
        <Link href={`/repos/${repoId}/rules/new`}>
          <Button size="sm" className="bg-rail-fade hover:opacity-90">
            <Plus className="h-3.5 w-3.5 mr-1" />
            New Rule
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-[100px] w-full" />
          <Skeleton className="h-[100px] w-full" />
        </div>
      ) : rules.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <Shield className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-grotesk text-sm font-medium text-foreground">No Rules Yet</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Create rules to enforce architecture decisions and code conventions.
          </p>
          <Link href={`/repos/${repoId}/rules/new`}>
            <Button size="sm" className="mt-4 bg-rail-fade hover:opacity-90">
              <Plus className="h-3.5 w-3.5 mr-1" />
              Create First Rule
            </Button>
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {rules.map((rule) => (
            <div key={rule.id} className="glass-card p-4">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-grotesk text-sm font-medium text-foreground">
                      {rule.title}
                    </h3>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                      rule.enforcement === "block" ? "bg-red-500/10 text-red-400" :
                      rule.enforcement === "warn" ? "bg-yellow-500/10 text-yellow-400" :
                      "bg-blue-500/10 text-blue-400"
                    }`}>
                      {rule.enforcement}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {rule.type}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{rule.description}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>Scope: {rule.scope}</span>
                    <span>Priority: {rule.priority}</span>
                    {rule.languages && rule.languages.length > 0 && (
                      <span>Languages: {rule.languages.join(", ")}</span>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => handleDelete(rule.id)}
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
