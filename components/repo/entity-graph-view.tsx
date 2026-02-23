"use client"

import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
  MarkerType,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { Loader2, Minus, X } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

interface GraphData {
  nodes: Array<{
    id: string
    type: string
    data: {
      name: string
      kind: string
      filePath: string
      isCenter: boolean
      taxonomy: string | null
      confidence: number | null
      businessPurpose: string | null
      domainConcepts: string[]
      featureTag: string | null
    }
    position: { x: number; y: number }
  }>
  edges: Array<{
    id: string
    source: string
    target: string
    data: { kind: string }
  }>
  centerEntityId: string
}

const taxonomyColors: Record<string, { bg: string; border: string; text: string }> = {
  VERTICAL: { bg: "bg-electric-cyan/10", border: "border-electric-cyan/40", text: "text-electric-cyan" },
  HORIZONTAL: { bg: "bg-primary/10", border: "border-primary/40", text: "text-primary" },
  UTILITY: { bg: "bg-white/5", border: "border-white/20", text: "text-white/60" },
}

const edgeColors: Record<string, string> = {
  calls: "#00E5FF",
  imports: "rgba(255,255,255,0.15)",
  extends: "#6E18B3",
  implements: "#FFB800",
  contains: "rgba(255,255,255,0.08)",
}

function EntityNode({ data }: NodeProps) {
  const d = data as GraphData["nodes"][number]["data"]
  const colors = d.taxonomy ? taxonomyColors[d.taxonomy] ?? taxonomyColors.UTILITY! : taxonomyColors.UTILITY!

  return (
    <div
      className={`rounded-lg border px-3 py-2 min-w-[140px] max-w-[220px] ${colors.bg} ${colors.border} ${
        d.isCenter ? "ring-1 ring-electric-cyan/50" : ""
      }`}
    >
      <Handle type="target" position={Position.Top} className="bg-white/20! border-0! w-2! h-2!" />
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <Badge
            variant="outline"
            className={`h-4 px-1 text-[8px] font-mono ${colors.text} ${colors.border}`}
          >
            {d.kind}
          </Badge>
          {d.taxonomy && (
            <span className={`text-[8px] font-mono ${colors.text}`}>
              {d.taxonomy}
            </span>
          )}
        </div>
        <p className="font-mono text-[11px] font-medium text-white truncate">
          {d.name}
        </p>
        <p className="font-mono text-[9px] text-white/30 truncate">
          {d.filePath}
        </p>
        {d.confidence !== null && (
          <div className="flex items-center gap-1">
            <div className="h-1 flex-1 rounded-full bg-white/10 overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  d.confidence >= 0.85
                    ? "bg-emerald-400"
                    : d.confidence >= 0.5
                      ? "bg-warning"
                      : "bg-white/30"
                }`}
                style={{ width: `${d.confidence * 100}%` }}
              />
            </div>
            <span className="font-mono text-[8px] text-white/40 tabular-nums">
              {Math.round(d.confidence * 100)}%
            </span>
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="bg-white/20! border-0! w-2! h-2!" />
    </div>
  )
}

const nodeTypes = { entity: EntityNode }

function layoutNodes(
  rawNodes: GraphData["nodes"],
  rawEdges: GraphData["edges"],
  centerId: string
): Node[] {
  const centerIdx = rawNodes.findIndex((n) => n.id === centerId)
  if (centerIdx < 0) {
    return rawNodes.map((n, i) => ({
      ...n,
      position: { x: (i % 4) * 260, y: Math.floor(i / 4) * 140 },
    }))
  }

  // Simple radial layout: center in middle, others in rings
  const center = rawNodes[centerIdx]!
  const others = rawNodes.filter((n) => n.id !== centerId)
  const cx = 400
  const cy = 300

  const result: Node[] = [{ ...center, position: { x: cx, y: cy } }]
  const ringRadius = 220
  others.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / others.length - Math.PI / 2
    result.push({
      ...n,
      position: {
        x: cx + ringRadius * Math.cos(angle),
        y: cy + ringRadius * Math.sin(angle),
      },
    })
  })
  return result
}

function toFlowEdges(rawEdges: GraphData["edges"]): Edge[] {
  return rawEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    animated: e.data.kind === "calls",
    style: { stroke: edgeColors[e.data.kind] ?? "rgba(255,255,255,0.1)", strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: edgeColors[e.data.kind] ?? "rgba(255,255,255,0.1)", width: 12, height: 12 },
    label: e.data.kind,
    labelStyle: { fontSize: 9, fill: "rgba(255,255,255,0.3)" },
    labelBgStyle: { fill: "#0A0A0F", fillOpacity: 0.8 },
  }))
}

interface EntityGraphViewProps {
  repoId: string
  entityId: string
  onClose: () => void
}

export function EntityGraphView({ repoId, entityId, onClose }: EntityGraphViewProps) {
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedNode, setSelectedNode] = useState<GraphData["nodes"][number]["data"] | null>(null)
  const [depth, setDepth] = useState(2)
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([] as Node[])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([] as Edge[])

  const fetchGraph = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(
        `/api/repos/${repoId}/entities/${entityId}/graph?depth=${depth}`
      )
      if (res.ok) {
        const json = (await res.json()) as { data: GraphData }
        setGraphData(json.data)
        const laid = layoutNodes(json.data.nodes, json.data.edges, json.data.centerEntityId)
        setNodes(laid)
        setEdges(toFlowEdges(json.data.edges))
      }
    } catch {
      // fetch failed
    } finally {
      setLoading(false)
    }
  }, [repoId, entityId, depth, setNodes, setEdges])

  useEffect(() => {
    fetchGraph()
  }, [fetchGraph])

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const raw = graphData?.nodes.find((n) => n.id === node.id)
      if (raw) setSelectedNode(raw.data)
    },
    [graphData]
  )

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0A0A0F]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk">
            Entity Graph
          </p>
          <div className="flex items-center gap-1 rounded-md border border-white/10 px-2 py-0.5">
            <button
              type="button"
              onClick={() => setDepth(Math.max(1, depth - 1))}
              className="text-white/40 hover:text-white"
            >
              <Minus className="h-3 w-3" />
            </button>
            <span className="font-mono text-xs text-white/60 tabular-nums w-16 text-center">
              Depth: {depth}
            </span>
            <button
              type="button"
              onClick={() => setDepth(Math.min(4, depth + 1))}
              className="text-white/40 hover:text-white"
            >
              <span className="text-sm">+</span>
            </button>
          </div>
          {graphData && (
            <span className="font-mono text-[10px] text-white/30">
              {graphData.nodes.length} nodes · {graphData.edges.length} edges
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-white/40 hover:text-white"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Canvas */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 relative">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 text-electric-cyan animate-spin" />
            </div>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              nodeTypes={nodeTypes}
              onNodeClick={onNodeClick}
              fitView
              proOptions={{ hideAttribution: true }}
              style={{ background: "#0A0A0F" }}
            >
              <Background color="rgba(255,255,255,0.03)" gap={40} />
              <Controls
                showInteractive={false}
                className="bg-white/5! border-white/10! rounded-md! [&>button]:bg-transparent! [&>button]:border-white/10! [&>button]:text-white/40! [&>button:hover]:text-white!"
              />
              <MiniMap
                nodeColor="#1E1E28"
                maskColor="rgba(10,10,15,0.8)"
                className="bg-white/5! border-white/10! rounded-md!"
              />
            </ReactFlow>
          )}
        </div>

        {/* Justification side panel */}
        {selectedNode && (
          <div className="w-72 shrink-0 border-l border-white/10 overflow-y-auto custom-scrollbar p-4 space-y-4">
            <div className="space-y-1">
              <p className="font-mono text-sm font-medium text-white">
                {selectedNode.name}
              </p>
              <p className="font-mono text-[10px] text-white/30">
                {selectedNode.kind} · {selectedNode.filePath}
              </p>
            </div>

            {selectedNode.taxonomy && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk">
                  Classification
                </p>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={`text-[10px] font-mono ${
                      taxonomyColors[selectedNode.taxonomy]?.text ?? "text-white/50"
                    } ${taxonomyColors[selectedNode.taxonomy]?.border ?? "border-white/20"}`}
                  >
                    {selectedNode.taxonomy}
                  </Badge>
                  {selectedNode.featureTag && (
                    <span className="font-mono text-[10px] text-white/40">
                      {selectedNode.featureTag}
                    </span>
                  )}
                </div>
              </div>
            )}

            {selectedNode.confidence !== null && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk">
                  Confidence
                </p>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        selectedNode.confidence >= 0.85
                          ? "bg-emerald-400"
                          : selectedNode.confidence >= 0.5
                            ? "bg-warning"
                            : "bg-white/30"
                      }`}
                      style={{ width: `${selectedNode.confidence * 100}%` }}
                    />
                  </div>
                  <span className="font-mono text-xs text-white/60 tabular-nums">
                    {Math.round(selectedNode.confidence * 100)}%
                  </span>
                </div>
              </div>
            )}

            {selectedNode.businessPurpose && (
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk">
                  Business Purpose
                </p>
                <p className="text-xs text-white/70 leading-relaxed">
                  {selectedNode.businessPurpose}
                </p>
              </div>
            )}

            {selectedNode.domainConcepts.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk">
                  Domain Concepts
                </p>
                <div className="flex flex-wrap gap-1">
                  {selectedNode.domainConcepts.map((c) => (
                    <span
                      key={c}
                      className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-white/50"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
