/**
 * L-14: Entity Profile Cache — pre-computed, cached artifact per entity
 * combining structural, intent, temporal, and confidence signals.
 *
 * Every MCP tool reads from this cache (single Redis read) instead of
 * making 3-5 database round-trips.
 */

import type { Container } from "@/lib/di/container"
import type { EntityDoc, JustificationDoc } from "@/lib/ports/types"
import { logger } from "@/lib/utils/logger"

const PROFILE_TTL_SECONDS = 86400 // 24 hours

// ── EntityProfile Interface ────────────────────────────────────────────────────

export interface EntityProfile {
  // Identity
  id: string
  kind: string
  name: string
  file_path: string
  line: number
  signature?: string

  // Structural signal
  callers: Array<{ name: string; kind: string; file_path: string }>
  callees: Array<{ name: string; kind: string; file_path: string }>
  centrality: number
  community: string
  blast_radius: number

  // Intent signal
  business_purpose: string
  feature_tag: string
  taxonomy: string
  domain_concepts: string[]
  test_coverage: string[]

  // Temporal signal
  change_frequency?: number
  stability_score?: number
  author_count?: number
  commit_intents?: string[]

  // Confidence
  confidence: {
    composite: number
    breakdown: { structural: number; intent: number; llm: number }
  }

  // Metadata
  architectural_pattern?: string
  is_dead_code: boolean
  semantic_triples?: Array<{ subject: string; predicate: string; object: string }>
}

// ── Cache Key ──────────────────────────────────────────────────────────────────

export function profileCacheKey(orgId: string, repoId: string, entityId: string): string {
  return `profile:${orgId}:${repoId}:${entityId}`
}

export function profileCachePrefix(orgId: string, repoId: string): string {
  return `profile:${orgId}:${repoId}:`
}

// ── Build Profiles ─────────────────────────────────────────────────────────────

/**
 * Build entity profiles for all entities in a repo.
 * Fetches entities, edges, and justifications from the graph store,
 * then assembles a profile per entity.
 */
export async function buildEntityProfiles(
  orgId: string,
  repoId: string,
  container: Container,
): Promise<Map<string, EntityProfile>> {
  const log = logger.child({ service: "entity-profile", organizationId: orgId, repoId })

  const [allEntities, allEdges, allJustifications] = await Promise.all([
    container.graphStore.getAllEntities(orgId, repoId),
    container.graphStore.getAllEdges(orgId, repoId),
    container.graphStore.getJustifications(orgId, repoId),
  ])

  log.info("Building entity profiles", {
    entityCount: allEntities.length,
    edgeCount: allEdges.length,
    justificationCount: allJustifications.length,
  })

  // Build lookup maps
  const entityMap = new Map<string, EntityDoc>()
  for (const e of allEntities) {
    entityMap.set(e.id, e)
  }

  const justMap = new Map<string, JustificationDoc>()
  for (const j of allJustifications) {
    justMap.set(j.entity_id, j)
  }

  // Build caller/callee maps from edges
  const callersMap = new Map<string, Array<{ name: string; kind: string; file_path: string }>>()
  const calleesMap = new Map<string, Array<{ name: string; kind: string; file_path: string }>>()

  for (const edge of allEdges) {
    if (edge.kind !== "calls") continue
    const fromId = String(edge._from).split("/").pop()!
    const toId = String(edge._to).split("/").pop()!

    const fromEntity = entityMap.get(fromId)
    const toEntity = entityMap.get(toId)

    if (toEntity) {
      const existing = callersMap.get(toId) ?? []
      if (fromEntity) {
        existing.push({ name: fromEntity.name, kind: fromEntity.kind, file_path: fromEntity.file_path })
      }
      callersMap.set(toId, existing)
    }

    if (fromEntity) {
      const existing = calleesMap.get(fromId) ?? []
      if (toEntity) {
        existing.push({ name: toEntity.name, kind: toEntity.kind, file_path: toEntity.file_path })
      }
      calleesMap.set(fromId, existing)
    }
  }

  // Dead code detection
  const { detectDeadCode } = require("@/lib/justification/dead-code-detector") as typeof import("@/lib/justification/dead-code-detector")
  const deadCodeMap = detectDeadCode(allEntities, allEdges)

  // Assemble profiles
  const profiles = new Map<string, EntityProfile>()
  for (const entity of allEntities) {
    const justification = justMap.get(entity.id)
    const ext = entity as Record<string, unknown>

    const callers = callersMap.get(entity.id) ?? []
    const callees = calleesMap.get(entity.id) ?? []

    // Confidence from justification
    const confidenceBreakdown = (justification as Record<string, unknown> | undefined)?.confidence_breakdown as
      | { structural?: number; intent?: number; llm?: number }
      | undefined
    const compositeConfidence = justification?.confidence ?? 0

    const profile: EntityProfile = {
      // Identity
      id: entity.id,
      kind: entity.kind,
      name: entity.name,
      file_path: entity.file_path,
      line: Number(entity.start_line) || 0,
      signature: entity.signature as string | undefined,

      // Structural
      callers: callers.slice(0, 20),
      callees: callees.slice(0, 20),
      centrality: (ext.pagerank_percentile as number) ?? 0,
      community: String((ext.community_label as string) ?? (ext.community_id as string) ?? ""),
      blast_radius: (ext.fan_in as number) ?? callers.length,

      // Intent
      business_purpose: justification?.business_purpose ?? "",
      feature_tag: justification?.feature_tag ?? "unclassified",
      taxonomy: justification?.taxonomy ?? "UTILITY",
      domain_concepts: justification?.domain_concepts ?? [],
      test_coverage: ((justification as Record<string, unknown> | undefined)?.test_coverage as string[]) ?? [],

      // Temporal (from L-24 temporal analysis)
      change_frequency: ext.change_frequency as number | undefined,
      stability_score: ext.stability_score as number | undefined,
      author_count: ext.author_count as number | undefined,
      commit_intents: ext.commit_intents as string[] | undefined,

      // Confidence
      confidence: {
        composite: compositeConfidence,
        breakdown: {
          structural: confidenceBreakdown?.structural ?? 0,
          intent: confidenceBreakdown?.intent ?? 0,
          llm: confidenceBreakdown?.llm ?? 0,
        },
      },

      // Metadata
      architectural_pattern: (justification as Record<string, unknown> | undefined)?.architectural_pattern as string | undefined,
      is_dead_code: deadCodeMap.has(entity.id),
      semantic_triples: justification?.semantic_triples,
    }

    profiles.set(entity.id, profile)
  }

  log.info("Entity profiles built", { profileCount: profiles.size })
  return profiles
}

// ── Cache Read/Write ───────────────────────────────────────────────────────────

/**
 * Get a single entity profile from cache, falling back to on-demand build.
 */
export async function getEntityProfile(
  orgId: string,
  repoId: string,
  entityId: string,
  container: Container,
): Promise<EntityProfile | null> {
  const key = profileCacheKey(orgId, repoId, entityId)
  try {
    const cached = await container.cacheStore.get<EntityProfile>(key)
    if (cached) return cached
  } catch {
    // Cache miss or error — fall through to DB
  }

  // On-demand build for a single entity
  try {
    const entity = await container.graphStore.getEntity(orgId, entityId)
    if (!entity) return null

    const [callers, callees, justification] = await Promise.all([
      container.graphStore.getCallersOf(orgId, entityId, 1),
      container.graphStore.getCalleesOf(orgId, entityId, 1),
      container.graphStore.getJustification(orgId, entityId),
    ])

    const ext = entity as Record<string, unknown>
    const confidenceBreakdown = (justification as Record<string, unknown> | null)?.confidence_breakdown as
      | { structural?: number; intent?: number; llm?: number }
      | undefined

    const profile: EntityProfile = {
      id: entity.id,
      kind: entity.kind,
      name: entity.name,
      file_path: entity.file_path,
      line: Number(entity.start_line) || 0,
      signature: entity.signature as string | undefined,
      callers: callers.slice(0, 20).map((c) => ({ name: c.name, kind: c.kind, file_path: c.file_path })),
      callees: callees.slice(0, 20).map((c) => ({ name: c.name, kind: c.kind, file_path: c.file_path })),
      centrality: (ext.pagerank_percentile as number) ?? 0,
      community: String((ext.community_label as string) ?? (ext.community_id as string) ?? ""),
      blast_radius: (ext.fan_in as number) ?? callers.length,
      business_purpose: justification?.business_purpose ?? "",
      feature_tag: justification?.feature_tag ?? "unclassified",
      taxonomy: justification?.taxonomy ?? "UTILITY",
      domain_concepts: justification?.domain_concepts ?? [],
      test_coverage: ((justification as Record<string, unknown> | null)?.test_coverage as string[]) ?? [],
      change_frequency: ext.change_frequency as number | undefined,
      stability_score: ext.stability_score as number | undefined,
      author_count: ext.author_count as number | undefined,
      commit_intents: ext.commit_intents as string[] | undefined,
      confidence: {
        composite: justification?.confidence ?? 0,
        breakdown: {
          structural: confidenceBreakdown?.structural ?? 0,
          intent: confidenceBreakdown?.intent ?? 0,
          llm: confidenceBreakdown?.llm ?? 0,
        },
      },
      architectural_pattern: (justification as Record<string, unknown> | null)?.architectural_pattern as string | undefined,
      is_dead_code: false, // Approximate — full dead code detection requires all entities
      semantic_triples: justification?.semantic_triples,
    }

    // Cache for next time
    try {
      await container.cacheStore.set(key, profile, PROFILE_TTL_SECONDS)
    } catch {
      // Cache write failure is non-fatal
    }

    return profile
  } catch {
    return null
  }
}

/**
 * Batch-read entity profiles from cache with DB fallback.
 */
export async function getEntityProfiles(
  orgId: string,
  repoId: string,
  entityIds: string[],
  container: Container,
): Promise<Map<string, EntityProfile>> {
  const result = new Map<string, EntityProfile>()
  const missingIds: string[] = []

  // Try cache first for each entity
  for (const entityId of entityIds) {
    const key = profileCacheKey(orgId, repoId, entityId)
    try {
      const cached = await container.cacheStore.get<EntityProfile>(key)
      if (cached) {
        result.set(entityId, cached)
        continue
      }
    } catch {
      // Cache miss
    }
    missingIds.push(entityId)
  }

  // Fall back to on-demand build for misses
  if (missingIds.length > 0) {
    for (const entityId of missingIds) {
      const profile = await getEntityProfile(orgId, repoId, entityId, container)
      if (profile) {
        result.set(entityId, profile)
      }
    }
  }

  return result
}

/**
 * Store pre-built profiles in Redis cache.
 */
export async function cacheEntityProfiles(
  orgId: string,
  repoId: string,
  profiles: Map<string, EntityProfile>,
  container: Container,
): Promise<number> {
  let cached = 0
  const entries = Array.from(profiles.entries())
  for (const [entityId, profile] of entries) {
    try {
      await container.cacheStore.set(
        profileCacheKey(orgId, repoId, entityId),
        profile,
        PROFILE_TTL_SECONDS,
      )
      cached++
    } catch {
      // Non-fatal — individual cache write failures
    }
  }
  return cached
}
