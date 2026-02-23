"use client"

import { ArrowDownRight, ArrowUpRight, ChevronRight, FileCode, FolderOpen, Search, TerminalSquare } from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
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

  const kindColors: Record<string, string> = {
    function: "text-electric-cyan border-electric-cyan/30",
    method: "text-electric-cyan border-electric-cyan/30",
    class: "text-primary border-primary/30",
    interface: "text-warning border-warning/30",
    variable: "text-emerald-400 border-emerald-400/30",
    type: "text-warning border-warning/30",
    enum: "text-primary border-primary/30",
  }

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40 px-1">
        Code Explorer
      </p>
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-white/10 bg-white/5 lg:grid-cols-[280px_1fr_1fr]">
        {/* Files panel */}
        <div className="flex flex-col bg-[#0A0A0F]">
          <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
            <Search className="h-3 w-3 text-white/30" />
            <input
              type="text"
              value={fileFilter}
              onChange={(e) => setFileFilter(e.target.value)}
              placeholder="Filter files…"
              className="h-6 flex-1 bg-transparent text-xs text-foreground placeholder:text-white/30 focus:outline-none"
            />
          </div>
          <div className="max-h-[55vh] overflow-y-auto custom-scrollbar p-2">
            {filteredTree.length > 0 ? (
              <FileTree nodes={filteredTree} selectedPath={selectedFile} onSelect={onSelectFile} />
            ) : (
              <p className="px-2 py-4 text-center text-xs text-white/30">No matching files.</p>
            )}
          </div>
        </div>

        {/* Entities panel */}
        <div className="flex flex-col bg-[#0A0A0F]">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
              {selectedFile ? selectedFile.split("/").pop() : "Select a file"}
            </p>
            {entities.length > 0 && (
              <span className="font-mono text-[10px] text-white/30 tabular-nums">
                {entities.length}
              </span>
            )}
          </div>
          <div className="max-h-[55vh] overflow-y-auto custom-scrollbar p-1">
            {!selectedFile ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <TerminalSquare className="h-8 w-8 text-white/10 mb-3" />
                <p className="text-xs text-white/30">Select a file to inspect its entities.</p>
              </div>
            ) : loadingEntities ? (
              <div className="space-y-2 p-2">
                <Skeleton className="h-7 w-full" />
                <Skeleton className="h-7 w-full" />
                <Skeleton className="h-7 w-full" />
              </div>
            ) : entities.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <FileCode className="h-8 w-8 text-white/10 mb-3" />
                <p className="text-xs text-white/30">No entities in this file.</p>
              </div>
            ) : (
              <ul className="space-y-0.5">
                {entities.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => onSelectEntity(e.id)}
                      className={`group w-full text-left rounded-md px-2.5 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                        selectedEntityId === e.id
                          ? "bg-electric-cyan/10 text-white"
                          : "text-white/60 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      <Badge
                        variant="outline"
                        className={`h-4 shrink-0 px-1 text-[9px] font-mono ${
                          kindColors[e.kind] ?? "text-white/50 border-white/20"
                        }`}
                      >
                        {e.kind}
                      </Badge>
                      <span className="font-mono text-xs truncate flex-1">{e.name}</span>
                      <span className="font-mono text-[10px] text-white/20 tabular-nums shrink-0">
                        {e.line}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Detail panel */}
        <div className="flex flex-col bg-[#0A0A0F]">
          <div className="border-b border-white/10 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
              {entityDetail ? entityDetail.entity.name : "Detail"}
            </p>
          </div>
          <div className="max-h-[55vh] overflow-y-auto custom-scrollbar p-3">
            {entityDetail ? (
              loadingDetail ? (
                <div className="space-y-3">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : (
                <div className="space-y-5">
                  {/* Identity */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={`h-5 px-1.5 text-[10px] font-mono ${
                          kindColors[entityDetail.entity.kind] ?? "text-white/50 border-white/20"
                        }`}
                      >
                        {entityDetail.entity.kind}
                      </Badge>
                      <Link
                        href={`/repos/${repoId}/entities/${entityDetail.entity.id}`}
                        className="text-xs text-electric-cyan hover:underline"
                      >
                        Full detail
                      </Link>
                    </div>
                    <p className="font-mono text-xs text-white/40 mt-1">
                      {entityDetail.entity.file_path}
                      <span className="text-white/20">:</span>
                      <span className="tabular-nums">{entityDetail.entity.line}</span>
                    </p>
                  </div>

                  {/* Signature */}
                  {entityDetail.entity.signature && (
                    <div className="rounded-md border border-white/10 bg-[#0e0e14] p-3 font-mono text-xs text-white/70 break-all leading-relaxed">
                      {entityDetail.entity.signature}
                    </div>
                  )}

                  {/* Callers */}
                  {entityDetail.callers.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <ArrowDownRight className="h-3 w-3 text-electric-cyan" />
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
                          Called by ({entityDetail.callers.length})
                        </p>
                      </div>
                      <ul className="space-y-0.5">
                        {entityDetail.callers.slice(0, 8).map((c) => (
                          <li
                            key={c.id}
                            className="flex items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-white/5 transition-colors"
                          >
                            <Badge variant="outline" className="h-4 shrink-0 px-1 text-[9px] font-mono text-white/40 border-white/15">
                              {c.kind}
                            </Badge>
                            <span className="font-mono text-white/80 truncate">{c.name}</span>
                            <span className="font-mono text-[10px] text-white/20 truncate ml-auto">{c.file_path}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Callees */}
                  {entityDetail.callees.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <ArrowUpRight className="h-3 w-3 text-primary" />
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
                          Calls ({entityDetail.callees.length})
                        </p>
                      </div>
                      <ul className="space-y-0.5">
                        {entityDetail.callees.slice(0, 8).map((c) => (
                          <li
                            key={c.id}
                            className="flex items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-white/5 transition-colors"
                          >
                            <Badge variant="outline" className="h-4 shrink-0 px-1 text-[9px] font-mono text-white/40 border-white/15">
                              {c.kind}
                            </Badge>
                            <span className="font-mono text-white/80 truncate">{c.name}</span>
                            <span className="font-mono text-[10px] text-white/20 truncate ml-auto">{c.file_path}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Empty call graph */}
                  {entityDetail.callers.length === 0 && entityDetail.callees.length === 0 && (
                    <p className="text-xs text-white/20 py-2">No call relationships found.</p>
                  )}
                </div>
              )
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <TerminalSquare className="h-8 w-8 text-white/10 mb-3" />
                <p className="font-grotesk text-sm font-semibold text-white/20 mb-1">
                  No entity selected
                </p>
                <p className="text-xs text-white/20">
                  Select an entity to inspect its signature and call graph.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function FileTree({
  nodes,
  selectedPath,
  onSelect,
}: {
  nodes: TreeNode[]
  selectedPath: string | null
  onSelect: (path: string) => void
  depth?: number
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  return (
    <ul className="space-y-px">
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
                className="group flex items-center gap-1.5 w-full text-left px-2 py-1 rounded-md text-[13px] text-white/70 hover:bg-white/5 transition-colors"
              >
                <ChevronRight className={`h-3 w-3 shrink-0 text-white/30 transition-transform ${expanded.has(node.path) ? "rotate-90" : ""}`} />
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-white/40" />
                <span className="truncate">{node.name}</span>
              </button>
              {expanded.has(node.path) && node.children && node.children.length > 0 && (
                <div className="ml-3 border-l border-white/5 pl-2">
                  <FileTree nodes={node.children} selectedPath={selectedPath} onSelect={onSelect} />
                </div>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={() => onSelect(node.path)}
              className={`flex items-center gap-1.5 w-full text-left px-2 py-1 rounded-md text-[13px] transition-colors ${
                selectedPath === node.path
                  ? "bg-electric-cyan/10 text-white"
                  : "text-white/50 hover:bg-white/5 hover:text-white/80"
              }`}
            >
              <FileCode className={`h-3.5 w-3.5 shrink-0 ${selectedPath === node.path ? "text-electric-cyan" : "text-white/30"}`} />
              <span className="truncate">{node.name}</span>
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
