"use client"

import { ChevronRight, FileCode, FolderOpen } from "lucide-react"
import { useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"

interface TreeNode {
  name: string
  path: string
  type: "file" | "dir"
  children?: TreeNode[]
}

export function RepoDetailClient({
  repoId,
  repoName: _repoName,
  initialTree,
  orgId: _orgId,
}: {
  repoId: string
  repoName: string
  initialTree: TreeNode[]
  orgId: string
}) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [entities, setEntities] = useState<{ id: string; name: string; kind: string; line: number; signature?: string }[]>([])
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null)
  const [entityDetail, setEntityDetail] = useState<{
    entity: { id: string; name: string; kind: string; file_path: string; line: number; signature?: string }
    callers: { id: string; name: string; file_path: string; kind: string }[]
    callees: { id: string; name: string; file_path: string; kind: string }[]
  } | null>(null)
  const [loadingEntities, setLoadingEntities] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [fileFilter, setFileFilter] = useState("")

  const filteredTree = useMemo(() => {
    if (!fileFilter.trim()) return initialTree
    const lower = fileFilter.toLowerCase()
    function filterNodes(nodes: TreeNode[]): TreeNode[] {
      return nodes.reduce<TreeNode[]>((acc, node) => {
        if (node.type === "file") {
          if (node.name.toLowerCase().includes(lower) || node.path.toLowerCase().includes(lower)) {
            acc.push(node)
          }
        } else if (node.children) {
          const filtered = filterNodes(node.children)
          if (filtered.length > 0) {
            acc.push({ ...node, children: filtered })
          }
        }
        return acc
      }, [])
    }
    return filterNodes(initialTree)
  }, [initialTree, fileFilter])

  const onSelectFile = async (path: string) => {
    setSelectedFile(path)
    setSelectedEntityId(null)
    setEntityDetail(null)
    setLoadingEntities(true)
    try {
      const res = await fetch(`/api/repos/${repoId}/entities?file=${encodeURIComponent(path)}`)
      const body = (await res.json()) as { data?: { entities?: { id: string; name: string; kind: string; line: number; signature?: string }[] } }
      const raw = body?.data?.entities ?? []
      const seen = new Set<string>()
      setEntities(raw.filter((e) => {
        if (seen.has(e.id)) return false
        seen.add(e.id)
        return true
      }))
    } finally {
      setLoadingEntities(false)
    }
  }

  const onSelectEntity = async (entityId: string) => {
    setSelectedEntityId(entityId)
    setLoadingDetail(true)
    try {
      const res = await fetch(`/api/repos/${repoId}/entities/${entityId}`)
      const body = (await res.json()) as { data?: { entity: { id: string; name: string; kind: string; file_path: string; line: number; signature?: string }; callers: { id: string; name: string; file_path: string; kind: string }[]; callees: { id: string; name: string; file_path: string; kind: string }[] } }
      setEntityDetail(body?.data ?? null)
    } finally {
      setLoadingDetail(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Files panel */}
      <div className="glass-panel border-border rounded-lg border overflow-hidden">
        <div className="border-b border-border px-4 py-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Files</h3>
        </div>
        <div className="p-3">
          <Input
            className="h-7 text-xs mb-2"
            placeholder="Filter files..."
            value={fileFilter}
            onChange={(e) => setFileFilter(e.target.value)}
          />
          <div className="max-h-[60vh] overflow-y-auto">
            <FileTree nodes={filteredTree} selectedPath={selectedFile} onSelect={onSelectFile} />
          </div>
        </div>
      </div>

      {/* Entities panel */}
      <div className="glass-panel border-border rounded-lg border overflow-hidden">
        <div className="border-b border-border px-4 py-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {selectedFile ? "Entities" : "Select a file"}
          </h3>
        </div>
        <div className="p-3">
          {selectedFile && (
            loadingEntities ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <ul className="space-y-1 max-h-[60vh] overflow-y-auto">
                {entities.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => onSelectEntity(e.id)}
                      className={`w-full text-left rounded px-2 py-1.5 text-xs flex items-center gap-2 ${
                        selectedEntityId === e.id ? "bg-primary/20 text-foreground" : "text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      <Badge variant="outline" className="h-4 px-1 text-[9px] font-normal flex-shrink-0">
                        {e.kind}
                      </Badge>
                      <span className="font-mono text-xs truncate flex-1">{e.name}</span>
                      <span className="text-[10px] text-muted-foreground flex-shrink-0">L{e.line}</span>
                    </button>
                  </li>
                ))}
                {entities.length === 0 && !loadingEntities && (
                  <p className="text-muted-foreground text-xs py-2">No entities in this file.</p>
                )}
              </ul>
            )
          )}
        </div>
      </div>

      {/* Detail panel */}
      <div className="glass-panel border-border rounded-lg border overflow-hidden">
        <div className="border-b border-border px-4 py-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Detail</h3>
        </div>
        <div className="p-3">
          {entityDetail ? (
            loadingDetail ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <div className="space-y-4 text-sm">
                <div>
                  <p className="font-mono text-xs text-foreground font-medium">{entityDetail.entity.name}</p>
                  <p className="text-muted-foreground text-[10px] mt-0.5">
                    {entityDetail.entity.kind} · {entityDetail.entity.file_path}:{entityDetail.entity.line}
                  </p>
                  {entityDetail.entity.signature && (
                    <div className="bg-muted/20 rounded-md p-2 font-mono text-xs mt-2 break-all text-muted-foreground">
                      {entityDetail.entity.signature}
                    </div>
                  )}
                </div>
                {entityDetail.callers.length > 0 && (
                  <div>
                    <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider mb-1">Callers</p>
                    <ul className="space-y-1">
                      {entityDetail.callers.slice(0, 5).map((c) => (
                        <li key={c.id} className="flex items-center gap-2">
                          <span className="font-mono text-xs text-foreground">{c.name}</span>
                          <span className="font-mono text-[10px] text-muted-foreground truncate">{c.file_path}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {entityDetail.callees.length > 0 && (
                  <div>
                    <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider mb-1">Callees</p>
                    <ul className="space-y-1">
                      {entityDetail.callees.slice(0, 5).map((c) => (
                        <li key={c.id} className="flex items-center gap-2">
                          <span className="font-mono text-xs text-foreground">{c.name}</span>
                          <span className="font-mono text-[10px] text-muted-foreground truncate">{c.file_path}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )
          ) : (
            <p className="text-muted-foreground text-xs py-2">Select an entity to see details.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function FileTree({
  nodes,
  selectedPath,
  onSelect,
  depth = 0,
}: {
  nodes: TreeNode[]
  selectedPath: string | null
  onSelect: (path: string) => void
  depth?: number
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  return (
    <ul className="space-y-0.5">
      {nodes.map((node) => (
        <li key={node.path}>
          {node.type === "dir" ? (
            <>
              <button
                type="button"
                onClick={() => setExpanded((e) => {
                  const next = new Set(e)
                  if (next.has(node.path)) next.delete(node.path)
                  else next.add(node.path)
                  return next
                })}
                className="flex items-center gap-1 w-full text-left px-1 py-0.5 rounded text-sm text-foreground hover:bg-muted"
              >
                <ChevronRight className={`h-3.5 w-3.5 transition-transform ${expanded.has(node.path) ? "rotate-90" : ""}`} />
                <FolderOpen className="text-muted-foreground h-3.5 w-3.5" />
                <span>{node.name}</span>
              </button>
              {expanded.has(node.path) && node.children && node.children.length > 0 && (
                <div className="pl-4">
                  <FileTree nodes={node.children} selectedPath={selectedPath} onSelect={onSelect} depth={depth + 1} />
                </div>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={() => onSelect(node.path)}
              className={`flex items-center gap-1 w-full text-left px-1 py-0.5 rounded text-sm ${selectedPath === node.path ? "bg-primary/20 text-foreground" : "text-muted-foreground hover:bg-muted"}`}
            >
              <FileCode className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate">{node.name}</span>
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
