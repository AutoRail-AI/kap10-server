/**
 * Phase 10b: Pre-fetch context expansion use case.
 *
 * Hexagonal: receives container. Expands entity context N-hops
 * and caches in Redis for fast subsequent MCP tool lookups.
 */

import { env } from "@/env.mjs"
import type { Container } from "@/lib/di/container"

export interface PrefetchInput {
  orgId: string
  repoId: string
  filePath: string
  line?: number
  entityKey?: string
}

export interface PrefetchedContext {
  filePath: string
  entityKey?: string
  entities: Array<{
    key: string
    kind: string
    name: string
    file_path: string
    relationship: string
  }>
  cachedAt: string
}

const CACHE_KEY_PREFIX = "prefetch:ctx"

function buildCacheKey(orgId: string, repoId: string, filePath: string, entityKey?: string): string {
  const base = `${CACHE_KEY_PREFIX}:${orgId}:${repoId}:${filePath}`
  return entityKey ? `${base}:${entityKey}` : base
}

/**
 * Expand entity context and cache for fast retrieval.
 */
export async function prefetchContext(
  container: Container,
  input: PrefetchInput
): Promise<PrefetchedContext> {
  const { orgId, repoId, filePath, entityKey } = input
  const hops = env.PREFETCH_EXPANSION_HOPS
  const ttl = env.PREFETCH_REDIS_TTL_SECONDS

  const entities: PrefetchedContext["entities"] = []
  const seen = new Set<string>()

  // If entityKey provided, start expansion from that entity
  if (entityKey) {
    await expandFromEntity(container, orgId, entityKey, hops, entities, seen)
  }

  // Also get same-file entities
  try {
    const fileEntities = await container.graphStore.getEntitiesByFile(orgId, repoId, filePath)
    for (const e of fileEntities) {
      if (!seen.has(e.id)) {
        seen.add(e.id)
        entities.push({
          key: e.id,
          kind: e.kind,
          name: e.name,
          file_path: e.file_path,
          relationship: "same_file",
        })

        // Expand callers/callees for same-file entities (1 hop)
        if (hops > 0) {
          await expandFromEntity(container, orgId, e.id, 1, entities, seen)
        }
      }
    }
  } catch {
    // Graph query failure — non-critical for prefetch
  }

  const result: PrefetchedContext = {
    filePath,
    entityKey,
    entities,
    cachedAt: new Date().toISOString(),
  }

  // Cache in Redis
  const cacheKey = buildCacheKey(orgId, repoId, filePath, entityKey)
  try {
    await container.cacheStore.set(cacheKey, result, ttl)
  } catch {
    // Cache write failure is non-fatal
  }

  return result
}

/**
 * Retrieve prefetched context from cache.
 */
export async function getPrefetchedContext(
  container: Container,
  orgId: string,
  repoId: string,
  filePath: string,
  entityKey?: string
): Promise<PrefetchedContext | null> {
  const cacheKey = buildCacheKey(orgId, repoId, filePath, entityKey)
  try {
    return await container.cacheStore.get<PrefetchedContext>(cacheKey)
  } catch {
    return null
  }
}

/**
 * Expand N-hops from an entity, collecting callers and callees.
 */
async function expandFromEntity(
  container: Container,
  orgId: string,
  entityKey: string,
  maxHops: number,
  results: PrefetchedContext["entities"],
  seen: Set<string>
): Promise<void> {
  const queue: Array<{ key: string; depth: number; relationship: string }> = [
    { key: entityKey, depth: 0, relationship: "root" },
  ]

  while (queue.length > 0) {
    const current = queue.shift()!
    if (current.depth >= maxHops) continue

    try {
      // Get callers
      const callers = await container.graphStore.getCallersOf(orgId, current.key)
      for (const caller of callers) {
        if (!seen.has(caller.id)) {
          seen.add(caller.id)
          results.push({
            key: caller.id,
            kind: caller.kind,
            name: caller.name,
            file_path: caller.file_path,
            relationship: "caller",
          })
          if (current.depth + 1 < maxHops) {
            queue.push({ key: caller.id, depth: current.depth + 1, relationship: "caller" })
          }
        }
      }

      // Get callees
      const callees = await container.graphStore.getCalleesOf(orgId, current.key)
      for (const callee of callees) {
        if (!seen.has(callee.id)) {
          seen.add(callee.id)
          results.push({
            key: callee.id,
            kind: callee.kind,
            name: callee.name,
            file_path: callee.file_path,
            relationship: "callee",
          })
          if (current.depth + 1 < maxHops) {
            queue.push({ key: callee.id, depth: current.depth + 1, relationship: "callee" })
          }
        }
      }
    } catch {
      // Entity lookup failure — skip this entity
    }
  }
}
