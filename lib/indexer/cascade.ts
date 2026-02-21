/**
 * Phase 5: Cascade re-justification queue builder.
 * Determines which downstream entities need re-justification after changes.
 */

import type { IGraphStore } from "@/lib/ports/graph-store"
import type { IVectorSearch } from "@/lib/ports/vector-search"
import { getInboundCallerCount, isHubNode } from "./centrality"

export interface CascadeConfig {
  maxHops: number
  maxEntities: number
  significanceThreshold: number
  centralityThreshold: number
}

export interface CascadeResult {
  reJustifyQueue: string[]  // Entity keys that need re-justification
  cascadeQueue: string[]    // Entity keys reached via cascade traversal
  skipped: string[]         // Entity keys skipped (hub nodes, below threshold)
}

function getDefaultConfig(): CascadeConfig {
  return {
    maxHops: parseInt(process.env.CASCADE_MAX_HOPS ?? "2", 10),
    maxEntities: parseInt(process.env.CASCADE_MAX_ENTITIES ?? "50", 10),
    significanceThreshold: parseFloat(process.env.CASCADE_SIGNIFICANCE_THRESHOLD ?? "0.3"),
    centralityThreshold: parseInt(process.env.CASCADE_CENTRALITY_THRESHOLD ?? "50", 10),
  }
}

/**
 * Build the cascade re-justification queue.
 *
 * Algorithm:
 * 1. Start with changed entity keys
 * 2. For each, check if the change is significant (cosine distance > threshold)
 * 3. If significant, traverse callers up to maxHops
 * 4. Skip hub nodes (too many callers)
 * 5. Cap total entities at maxEntities
 * 6. Priority: direct callers first, then hop-2, etc.
 */
export async function buildCascadeQueue(
  changedKeys: string[],
  graphStore: IGraphStore,
  vectorSearch: IVectorSearch | null,
  config?: Partial<CascadeConfig>
): Promise<CascadeResult> {
  const cfg = { ...getDefaultConfig(), ...config }
  const reJustifyQueue: string[] = [...changedKeys]
  const cascadeQueue: string[] = []
  const skipped: string[] = []
  const visited = new Set<string>(changedKeys)

  // BFS traversal from changed entities
  let frontier = [...changedKeys]

  for (let hop = 0; hop < cfg.maxHops; hop++) {
    if (cascadeQueue.length + reJustifyQueue.length >= cfg.maxEntities) break

    const nextFrontier: string[] = []

    for (const entityKey of frontier) {
      if (cascadeQueue.length + reJustifyQueue.length >= cfg.maxEntities) break

      // Check centrality before traversing
      const callerCount = await getInboundCallerCount(
        "", // orgId resolved from graphStore context
        entityKey,
        graphStore
      )

      if (isHubNode(callerCount, cfg.centralityThreshold)) {
        skipped.push(entityKey)
        continue
      }

      // Get callers of this entity
      const callers = await graphStore.getCallersOf("", entityKey)

      for (const caller of callers) {
        if (visited.has(caller.id)) continue
        visited.add(caller.id)

        // Significance check via cosine distance (if vector search available)
        if (vectorSearch && hop === 0) {
          const isSignificant = await checkSignificance(
            entityKey,
            caller.id,
            vectorSearch,
            caller.repo_id,
            cfg.significanceThreshold
          )
          if (!isSignificant) {
            skipped.push(caller.id)
            continue
          }
        }

        cascadeQueue.push(caller.id)
        nextFrontier.push(caller.id)

        if (cascadeQueue.length + reJustifyQueue.length >= cfg.maxEntities) break
      }
    }

    frontier = nextFrontier
  }

  return { reJustifyQueue, cascadeQueue, skipped }
}

/**
 * Check if a change is significant enough to warrant cascading.
 * Uses cosine distance between the changed entity's embedding and the caller's embedding.
 */
async function checkSignificance(
  changedKey: string,
  callerKey: string,
  vectorSearch: IVectorSearch,
  repoId: string,
  threshold: number
): Promise<boolean> {
  try {
    const getEmbed = vectorSearch.getEmbedding
    if (!getEmbed) return true

    const changedEmbed = await getEmbed.call(vectorSearch, repoId, changedKey)
    const callerEmbed = await getEmbed.call(vectorSearch, repoId, callerKey)

    if (!changedEmbed || !callerEmbed) return true

    // Compute cosine distance
    let dot = 0, normA = 0, normB = 0
    for (let i = 0; i < changedEmbed.length; i++) {
      dot += (changedEmbed[i] ?? 0) * (callerEmbed[i] ?? 0)
      normA += (changedEmbed[i] ?? 0) * (changedEmbed[i] ?? 0)
      normB += (callerEmbed[i] ?? 0) * (callerEmbed[i] ?? 0)
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB)
    const similarity = denom > 0 ? dot / denom : 0
    const distance = 1 - similarity

    return distance >= threshold
  } catch {
    return true // On error, assume significant
  }
}
