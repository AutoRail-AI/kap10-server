"use client"

import { useEffect, useState } from "react"
import { Shield, Plus } from "lucide-react"
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
}

export default function OrgRulesPage() {
  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchRules() {
      try {
        const res = await fetch("/api/settings/rules")
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
    fetchRules()
  }, [])

  return (
    <div className="space-y-6 py-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="font-grotesk text-lg font-semibold text-foreground">Organization Rules</h1>
          <p className="text-sm text-foreground mt-0.5">
            Rules that apply across all repositories in your organization
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-[100px] w-full" />
          <Skeleton className="h-[100px] w-full" />
        </div>
      ) : rules.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <Shield className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-grotesk text-sm font-medium text-foreground">No Organization Rules</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Organization-level rules apply to all repositories. Create rules at the repo level first, then promote them.
          </p>
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
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
