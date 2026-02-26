"use client"

import { useSearchParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { SearchInput } from "@/components/dashboard/search-input"
import { SearchResults } from "@/components/dashboard/search-results"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"

interface SearchResult {
  entityKey: string
  entityName: string
  entityType: string
  filePath: string
  lineStart?: number
  signature?: string
  score: number
  callers?: string[]
  callees?: string[]
}

interface SearchResponse {
  results: SearchResult[]
  meta: {
    mode: string
    totalResults: number
    queryTimeMs: number
    degraded?: Record<string, string>
  }
}

export default function SearchPage() {
  const searchParams = useSearchParams()
  const initialQuery = searchParams.get("q") ?? ""
  const initialRepoId = searchParams.get("repoId") ?? ""

  const [query, setQuery] = useState(initialQuery)
  const [mode, setMode] = useState("hybrid")
  const [repoId, setRepoId] = useState(initialRepoId)
  const [repos, setRepos] = useState<Array<{ id: string; name: string; fullName: string; status: string }>>([])
  const [results, setResults] = useState<SearchResult[]>([])
  const [meta, setMeta] = useState<SearchResponse["meta"] | null>(null)
  const [loading, setLoading] = useState(false)

  // Fetch repos for the scope selector
  useEffect(() => {
    async function fetchRepos() {
      try {
        const res = await fetch("/api/repos")
        if (res.ok) {
          const data = (await res.json()) as { repos: Array<{ id: string; name: string; fullName: string; status: string }> }
          setRepos(data.repos ?? [])
          // Auto-select first ready repo if none selected
          if (!repoId && data.repos?.length > 0) {
            const readyRepo = data.repos.find((r) => r.status === "ready")
            if (readyRepo) setRepoId(readyRepo.id)
          }
        }
      } catch {
        // Silently fail — repos list is optional
      }
    }
    void fetchRepos()
  }, [])

  // Debounced search
  useEffect(() => {
    if (!query.trim() || !repoId) {
      setResults([])
      setMeta(null)
      return
    }

    const timer = setTimeout(() => {
      void performSearch(query, mode, repoId)
    }, 300)

    return () => clearTimeout(timer)
  }, [query, mode, repoId])

  const performSearch = useCallback(async (q: string, m: string, rid: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ q, mode: m, repoId: rid, limit: "20" })
      const res = await fetch(`/api/search?${params.toString()}`)
      if (res.ok) {
        const data = (await res.json()) as SearchResponse
        setResults(data.results)
        setMeta(data.meta)
      } else {
        setResults([])
        setMeta(null)
      }
    } catch {
      setResults([])
      setMeta(null)
    } finally {
      setLoading(false)
    }
  }, [])

  return (
    <div className="space-y-6 py-6 animate-fade-in">
      <div className="space-y-1">
        <h1 className="font-grotesk text-lg font-semibold text-foreground">Search</h1>
        <p className="text-sm text-muted-foreground">
          Search your codebase by meaning — find functions, classes, and patterns using natural language
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <SearchInput
              query={query}
              mode={mode}
              onQueryChange={setQuery}
              onModeChange={setMode}
              placeholder="Describe what you're looking for…"
            />
          </div>
          {repos.length > 0 && (
            <Select value={repoId} onValueChange={setRepoId}>
              <SelectTrigger className="h-9 w-[200px] text-xs">
                <SelectValue placeholder="Select repo" />
              </SelectTrigger>
              <SelectContent>
                {repos
                  .filter((r) => r.status === "ready")
                  .map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : (
        <SearchResults
          results={results}
          queryTimeMs={meta?.queryTimeMs}
          mode={meta?.mode}
          degraded={meta?.degraded}
        />
      )}
    </div>
  )
}
