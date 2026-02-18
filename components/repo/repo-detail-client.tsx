"use client"

import { ChevronRight, FileCode, FolderOpen } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { Skeleton } from "@/components/ui/skeleton"

interface TreeNode {
  name: string
  path: string
  type: "file" | "dir"
  children?: TreeNode[]
}

export function RepoDetailClient({
  repoId,
  repoName,
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

  const onSelectFile = async (path: string) => {
    setSelectedFile(path)
    setSelectedEntityId(null)
    setEntityDetail(null)
    setLoadingEntities(true)
    try {
      const res = await fetch(`/api/repos/${repoId}/entities?file=${encodeURIComponent(path)}`)
      const body = (await res.json()) as { data?: { entities?: { id: string; name: string; kind: string; line: number; signature?: string }[] } }
      setEntities(body?.data?.entities ?? [])
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
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/" className="text-electric-cyan hover:underline">Repositories</Link>
        <span>/</span>
        <span className="text-foreground">{repoName}</span>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="glass-panel border-border rounded-lg border p-4">
          <h3 className="font-grotesk text-sm font-semibold text-foreground mb-2">Files</h3>
          <FileTree nodes={initialTree} selectedPath={selectedFile} onSelect={onSelectFile} />
        </div>
        <div className="glass-panel border-border rounded-lg border p-4">
          <h3 className="font-grotesk text-sm font-semibold text-foreground mb-2">
            {selectedFile ? "Entities" : "Select a file"}
          </h3>
          {selectedFile && (
            loadingEntities ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <ul className="space-y-1">
                {entities.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => onSelectEntity(e.id)}
                      className={`w-full text-left rounded px-2 py-1 text-sm font-mono ${
                        selectedEntityId === e.id ? "bg-primary/20 text-foreground" : "text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {e.name} ({e.kind}) L{e.line}
                    </button>
                  </li>
                ))}
                {entities.length === 0 && !loadingEntities && (
                  <p className="text-muted-foreground text-xs">No entities in this file.</p>
                )}
              </ul>
            )
          )}
        </div>
        <div className="glass-panel border-border rounded-lg border p-4">
          <h3 className="font-grotesk text-sm font-semibold text-foreground mb-2">Detail</h3>
          {entityDetail ? (
            loadingDetail ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <div className="space-y-3 text-sm">
                <div>
                  <p className="font-mono text-foreground font-medium">{entityDetail.entity.name}</p>
                  <p className="text-muted-foreground text-xs">{entityDetail.entity.kind} · {entityDetail.entity.file_path}:{entityDetail.entity.line}</p>
                  {entityDetail.entity.signature && (
                    <pre className="font-mono text-xs mt-1 break-all text-muted-foreground">{entityDetail.entity.signature}</pre>
                  )}
                </div>
                {entityDetail.callers.length > 0 && (
                  <div>
                    <p className="text-muted-foreground text-xs font-medium">Callers</p>
                    <ul className="mt-0.5 space-y-0.5">
                      {entityDetail.callers.slice(0, 5).map((c) => (
                        <li key={c.id} className="font-mono text-xs text-foreground">{c.name} ({c.file_path})</li>
                      ))}
                    </ul>
                  </div>
                )}
                {entityDetail.callees.length > 0 && (
                  <div>
                    <p className="text-muted-foreground text-xs font-medium">Callees</p>
                    <ul className="mt-0.5 space-y-0.5">
                      {entityDetail.callees.slice(0, 5).map((c) => (
                        <li key={c.id} className="font-mono text-xs text-foreground">{c.name} ({c.file_path})</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )
          ) : (
            <p className="text-muted-foreground text-xs">Select an entity.</p>
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
