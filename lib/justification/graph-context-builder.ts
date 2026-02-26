/**
 * Phase 4: GraphRAG Context Builder — extracts N-hop sub-graph context
 * for each entity to anchor LLM justification prompts in graph topology.
 *
 * Uses batched subgraph queries for 10-50x speedup over sequential calls.
 */

import type { IGraphStore } from "@/lib/ports/graph-store"
import type { EdgeDoc, EntityDoc } from "@/lib/ports/types"
import type { GraphContext } from "./schemas"

/**
 * Build graph contexts for a batch of entities by extracting N-hop
 * sub-graphs from the graph store. Uses batched query when available.
 */
export async function buildGraphContexts(
  entities: EntityDoc[],
  graphStore: IGraphStore,
  orgId: string,
  depth = 2
): Promise<Map<string, GraphContext>> {
  const contexts = new Map<string, GraphContext>()

  // Use batched subgraph query for efficiency
  const subgraphMap = await graphStore.getBatchSubgraphs(
    orgId,
    entities.map((e) => e.id),
    depth
  )

  for (const entity of entities) {
    const subgraph = subgraphMap.get(entity.id) ?? { entities: [], edges: [] }

    const neighbors = subgraph.entities
      .filter((e) => e.id !== entity.id)
      .map((e) => {
        // Find the connecting edge to determine direction and metadata
        const outEdge = subgraph.edges.find(
          (edge) =>
            edge._from.endsWith(`/${entity.id}`) &&
            edge._to.endsWith(`/${e.id}`)
        )
        const direction = outEdge ? ("outbound" as const) : ("inbound" as const)

        // Include imported_symbols from import edges if available
        const connectingEdge = outEdge ?? subgraph.edges.find(
          (edge) =>
            edge._from.endsWith(`/${e.id}`) &&
            edge._to.endsWith(`/${entity.id}`)
        )
        const importedSymbols = connectingEdge?.kind === "imports"
          ? (connectingEdge.imported_symbols as string[] | undefined)
          : undefined

        return {
          id: e.id,
          name: importedSymbols && importedSymbols.length > 0
            ? `${e.name} (imports: ${importedSymbols.join(", ")})`
            : e.name,
          kind: e.kind,
          direction,
          file_path: e.file_path,
        }
      })

    const centrality = computeApproxCentrality(entity.id, subgraph.entities, subgraph.edges)

    contexts.set(entity.id, {
      entityId: entity.id,
      neighbors,
      centrality,
      subgraphSummary: summarizeSubgraph(entity, neighbors),
    })
  }

  return contexts
}

/**
 * Approximate betweenness centrality using degree centrality (faster).
 * Returns a 0-1 score based on relative connection count.
 */
export function computeApproxCentrality(
  entityId: string,
  entities: EntityDoc[],
  edges: EdgeDoc[]
): number {
  if (entities.length <= 1) return 0

  let degree = 0
  for (const edge of edges) {
    if (edge._from.endsWith(`/${entityId}`) || edge._to.endsWith(`/${entityId}`)) {
      degree++
    }
  }

  // Normalize: max possible degree is (entities.length - 1) * 2 (in + out)
  const maxDegree = (entities.length - 1) * 2
  return maxDegree > 0 ? Math.min(degree / maxDegree, 1) : 0
}

/**
 * Summarize a sub-graph into a human-readable string for the LLM prompt.
 */
export function summarizeSubgraph(
  entity: EntityDoc,
  neighbors: Array<{ id: string; name: string; kind: string; direction: string; file_path?: string }>
): string {
  const inbound = neighbors.filter((n) => n.direction === "inbound")
  const outbound = neighbors.filter((n) => n.direction === "outbound")

  const parts: string[] = []

  if (inbound.length > 0) {
    const callerNames = inbound.slice(0, 5).map((n) => `${n.name} (${n.kind})`).join(", ")
    parts.push(`Called by: ${callerNames}${inbound.length > 5 ? ` and ${inbound.length - 5} more` : ""}`)
  }

  if (outbound.length > 0) {
    const calleeNames = outbound.slice(0, 5).map((n) => `${n.name} (${n.kind})`).join(", ")
    parts.push(`Calls: ${calleeNames}${outbound.length > 5 ? ` and ${outbound.length - 5} more` : ""}`)
  }

  if (parts.length === 0) {
    parts.push("Isolated entity with no direct connections")
  }

  return `${entity.name} (${entity.kind}) in ${entity.file_path}: ${parts.join(". ")}`
}
