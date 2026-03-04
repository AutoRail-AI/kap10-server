/**
 * L-27: Rich Context Assembly — orchestrator that chains vector search →
 * graph traversal → entity profile lookup → code snippets into a single
 * structured context response.
 */

import type { Container } from "@/lib/di/container"
import { getEntityProfile, getEntityProfiles, type EntityProfile } from "./entity-profile"

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AssembledContext {
  entry_point: EntityProfile | null
  semantic_neighborhood: Array<EntityProfile & { relationship: string; depth: number }>
  code_snippets: Array<{ entity_name: string; file_path: string; line: number; snippet: string }>
  confidence: number
  community_context: string | null
  _meta: { query: string; entry_entity_id: string | null; neighborhood_size: number }
}

// ── Orchestrator ───────────────────────────────────────────────────────────────

/**
 * Assemble rich, structured context for a natural language query.
 *
 * Chain: vector search → graph traversal → profile lookup → snippet assembly.
 */
export async function assembleContext(
  query: string,
  orgId: string,
  repoId: string,
  container: Container,
  options?: { limit?: number; includeSnippets?: boolean },
): Promise<AssembledContext> {
  const limit = Math.min(Math.max(options?.limit ?? 10, 1), 25)
  const includeSnippets = options?.includeSnippets !== false

  // Step 1: Find entry point via vector search
  const embedResult = container.vectorSearch.embedQuery
    ? await container.vectorSearch.embedQuery(query)
    : (await container.vectorSearch.embed([query]))[0]
  if (!embedResult) {
    return {
      entry_point: null,
      semantic_neighborhood: [],
      code_snippets: [],
      confidence: 0,
      community_context: null,
      _meta: { query, entry_entity_id: null, neighborhood_size: 0 },
    }
  }
  const embedQuery = embedResult

  const vectorResults = await container.vectorSearch.search(embedQuery, 1, { orgId, repoId })

  if (vectorResults.length === 0) {
    return {
      entry_point: null,
      semantic_neighborhood: [],
      code_snippets: [],
      confidence: 0,
      community_context: null,
      _meta: { query, entry_entity_id: null, neighborhood_size: 0 },
    }
  }

  // Strip ::code variant suffix so we match graph entities by base ID
  const CODE_VARIANT_SUFFIX = "::code"
  const rawId = vectorResults[0]!.id
  const entryEntityId = rawId.endsWith(CODE_VARIANT_SUFFIX)
    ? rawId.slice(0, -CODE_VARIANT_SUFFIX.length)
    : rawId
  const entryScore = vectorResults[0]!.score

  // Step 2: Get entry point profile
  const entryProfile = await getEntityProfile(orgId, repoId, entryEntityId, container)

  // Step 3: Traverse 1-hop neighborhood via graph
  const subgraph = await container.graphStore.getSubgraph(orgId, entryEntityId, 1)

  // Step 4: Get profiles for neighborhood entities
  const neighborIds = subgraph.entities
    .map((e) => e.id)
    .filter((id) => id !== entryEntityId)
    .slice(0, limit)

  const neighborProfiles = await getEntityProfiles(orgId, repoId, neighborIds, container)

  // Step 5: Build neighborhood with relationship info, sorted by centrality
  const edgeMap = new Map<string, string>()
  for (const edge of subgraph.edges) {
    const fromId = String(edge._from).split("/").pop()!
    const toId = String(edge._to).split("/").pop()!
    if (fromId === entryEntityId) {
      edgeMap.set(toId, `${edge.kind} (outbound)`)
    } else if (toId === entryEntityId) {
      edgeMap.set(fromId, `${edge.kind} (inbound)`)
    }
  }

  const neighborhood: Array<EntityProfile & { relationship: string; depth: number }> = []
  for (const [entityId, profile] of Array.from(neighborProfiles.entries())) {
    neighborhood.push({
      ...profile,
      relationship: edgeMap.get(entityId) ?? "neighbor",
      depth: 1,
    })
  }

  // Sort by centrality descending
  neighborhood.sort((a, b) => b.centrality - a.centrality)

  // Step 6: Fetch code snippets for top entities
  const codeSnippets: Array<{ entity_name: string; file_path: string; line: number; snippet: string }> = []
  if (includeSnippets) {
    const topEntities = [entryEntityId, ...neighborhood.slice(0, 4).map((n) => n.id)]
    for (const entityId of topEntities) {
      try {
        const entity = await container.graphStore.getEntity(orgId, entityId)
        if (entity) {
          const body = (entity as Record<string, unknown>).body as string | undefined
          if (body) {
            codeSnippets.push({
              entity_name: entity.name,
              file_path: entity.file_path,
              line: Number(entity.start_line) || 0,
              snippet: body.length > 500 ? body.slice(0, 500) + "..." : body,
            })
          }
        }
      } catch {
        // Non-fatal — skip entity
      }
    }
  }

  // Step 7: Build community context
  let communityContext: string | null = null
  if (entryProfile?.community) {
    const communityMembers = neighborhood.filter((n) => n.community === entryProfile.community)
    communityContext = `This entity belongs to community "${entryProfile.community}" (${communityMembers.length + 1} entities in neighborhood)`
  }

  // Step 8: Compute assembly confidence
  const profileCoverage = neighborProfiles.size / Math.max(neighborIds.length, 1)
  const confidence = Math.round(((entryScore + profileCoverage) / 2) * 1000) / 1000

  return {
    entry_point: entryProfile,
    semantic_neighborhood: neighborhood.slice(0, limit),
    code_snippets: codeSnippets,
    confidence,
    community_context: communityContext,
    _meta: { query, entry_entity_id: entryEntityId, neighborhood_size: neighborhood.length },
  }
}
