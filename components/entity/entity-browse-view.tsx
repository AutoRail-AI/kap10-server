"use client"

import { ChevronLeft, ChevronRight, Layers, Search } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

interface EntityItem {
  id: string
  name: string
  kind: string
  file_path: string
  line: number
  signature?: string
  justification: {
    taxonomy: string
    confidence: number
    businessPurpose: string
    featureTag: string
    domainConcepts: string[]
  } | null
}

interface EntityListResponse {
  entities: EntityItem[]
  total: number
  page: number
  limit: number
  totalPages: number
}

const TAXONOMY_COLORS: Record<string, string> = {
  VERTICAL: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  HORIZONTAL: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  UTILITY: "bg-amber-500/15 text-amber-400 border-amber-500/30",
}

const KIND_OPTIONS = [
  { value: "all", label: "All Kinds" },
  { value: "function", label: "Function" },
  { value: "class", label: "Class" },
  { value: "method", label: "Method" },
  { value: "interface", label: "Interface" },
  { value: "type", label: "Type" },
  { value: "enum", label: "Enum" },
  { value: "variable", label: "Variable" },
  { value: "file", label: "File" },
]

export function EntityBrowseView({ repoId }: { repoId: string }) {
  const router = useRouter()
  const [data, setData] = useState<EntityListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [kind, setKind] = useState("all")
  const [taxonomy, setTaxonomy] = useState("all")
  const [page, setPage] = useState(1)
  const [stats, setStats] = useState<{ VERTICAL: number; HORIZONTAL: number; UTILITY: number } | null>(null)

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  // Reset page when filters change
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, kind, taxonomy])

  const fetchEntities = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set("page", String(page))
      params.set("limit", "50")
      if (debouncedSearch) params.set("search", debouncedSearch)
      if (kind !== "all") params.set("kind", kind)
      if (taxonomy !== "all") params.set("taxonomy", taxonomy)

      const res = await fetch(`/api/repos/${repoId}/entities?${params.toString()}`)
      if (res.ok) {
        const json = (await res.json()) as { data: EntityListResponse }
        setData(json.data)
      }
    } finally {
      setLoading(false)
    }
  }, [repoId, page, debouncedSearch, kind, taxonomy])

  useEffect(() => {
    void fetchEntities()
  }, [fetchEntities])

  // Fetch stats once (unfiltered counts by taxonomy)
  useEffect(() => {
    async function fetchStats() {
      try {
        const [vRes, hRes, uRes] = await Promise.all([
          fetch(`/api/repos/${repoId}/entities?taxonomy=VERTICAL&limit=1`),
          fetch(`/api/repos/${repoId}/entities?taxonomy=HORIZONTAL&limit=1`),
          fetch(`/api/repos/${repoId}/entities?taxonomy=UTILITY&limit=1`),
        ])
        const vData = vRes.ok ? ((await vRes.json()) as { data: { total: number } }).data : null
        const hData = hRes.ok ? ((await hRes.json()) as { data: { total: number } }).data : null
        const uData = uRes.ok ? ((await uRes.json()) as { data: { total: number } }).data : null
        setStats({
          VERTICAL: vData?.total ?? 0,
          HORIZONTAL: hData?.total ?? 0,
          UTILITY: uData?.total ?? 0,
        })
      } catch {
        // non-critical
      }
    }
    void fetchStats()
  }, [repoId])

  return (
    <div className="space-y-4">
      {/* Stat Cards */}
      {stats && (
        <div className="grid grid-cols-3 gap-3">
          <button
            onClick={() => setTaxonomy(taxonomy === "VERTICAL" ? "all" : "VERTICAL")}
            className={`glass-card p-4 text-left transition-all hover:border-cyan-500/40 ${
              taxonomy === "VERTICAL" ? "border-cyan-500/50 ring-1 ring-cyan-500/20" : ""
            }`}
          >
            <p className="text-xs text-muted-foreground">Vertical</p>
            <p className="font-grotesk text-2xl font-semibold text-cyan-400">{stats.VERTICAL}</p>
            <p className="text-xs text-muted-foreground">Domain-specific business logic</p>
          </button>
          <button
            onClick={() => setTaxonomy(taxonomy === "HORIZONTAL" ? "all" : "HORIZONTAL")}
            className={`glass-card p-4 text-left transition-all hover:border-purple-500/40 ${
              taxonomy === "HORIZONTAL" ? "border-purple-500/50 ring-1 ring-purple-500/20" : ""
            }`}
          >
            <p className="text-xs text-muted-foreground">Horizontal</p>
            <p className="font-grotesk text-2xl font-semibold text-purple-400">{stats.HORIZONTAL}</p>
            <p className="text-xs text-muted-foreground">Cross-cutting infrastructure</p>
          </button>
          <button
            onClick={() => setTaxonomy(taxonomy === "UTILITY" ? "all" : "UTILITY")}
            className={`glass-card p-4 text-left transition-all hover:border-amber-500/40 ${
              taxonomy === "UTILITY" ? "border-amber-500/50 ring-1 ring-amber-500/20" : ""
            }`}
          >
            <p className="text-xs text-muted-foreground">Utility</p>
            <p className="font-grotesk text-2xl font-semibold text-amber-400">{stats.UTILITY}</p>
            <p className="text-xs text-muted-foreground">Testing, types, tooling</p>
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search entities..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-9"
          />
        </div>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="h-9 w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KIND_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="w-[80px]">Kind</TableHead>
              <TableHead>File</TableHead>
              <TableHead className="w-[100px]">Taxonomy</TableHead>
              <TableHead className="w-[60px] text-right">Conf.</TableHead>
              <TableHead className="w-[120px]">Feature</TableHead>
              <TableHead>Purpose</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <TableCell key={j}>
                      <div className="h-4 w-full animate-pulse rounded bg-white/5" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : data && data.entities.length > 0 ? (
              data.entities.map((entity) => (
                <TableRow
                  key={entity.id}
                  className="cursor-pointer hover:bg-white/[0.03]"
                  onClick={() => router.push(`/repos/${repoId}/entities/${entity.id}`)}
                >
                  <TableCell className="font-mono text-sm">{entity.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {entity.kind}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                    {entity.file_path}
                  </TableCell>
                  <TableCell>
                    {entity.justification ? (
                      <Badge
                        variant="outline"
                        className={`text-xs ${TAXONOMY_COLORS[entity.justification.taxonomy] ?? ""}`}
                      >
                        {entity.justification.taxonomy}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    {entity.justification
                      ? `${Math.round(entity.justification.confidence * 100)}%`
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {entity.justification?.featureTag ? (
                      <Badge variant="outline" className="text-xs">
                        {entity.justification.featureTag}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[250px] truncate text-xs text-muted-foreground">
                    {entity.justification?.businessPurpose ?? "—"}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Layers className="h-8 w-8 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">
                      No entities found. Run indexing and justification first.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Showing {(page - 1) * data.limit + 1}–{Math.min(page * data.limit, data.total)} of{" "}
            {data.total} entities
          </p>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="px-2 text-xs text-muted-foreground">
              {page} / {data.totalPages}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
              disabled={page >= data.totalPages}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
