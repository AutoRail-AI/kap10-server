/**
 * Content-hash staleness detection for justification pipeline.
 *
 * Compares entity body hashes against stored justification body_hash values
 * to skip unchanged entities during re-justification. Reduces LLM calls
 * by 60-80% on re-indexing when most entities haven't changed.
 */

import { createHash } from "node:crypto"
import type { EntityDoc, JustificationDoc } from "@/lib/ports/types"

/**
 * Compute a stable hash of an entity's body content.
 * Used to detect whether an entity's code has changed since its last justification.
 */
export function computeBodyHash(entity: EntityDoc): string {
  const body = (entity.body as string) ?? ""
  const signature = (entity.signature as string) ?? ""
  // Include signature + body so that signature-only changes are also detected
  return createHash("sha256").update(`${signature}\n${body}`).digest("hex").slice(0, 16)
}

export interface StalenessResult {
  /** Entities that need re-justification (changed body or cascading invalidation) */
  stale: EntityDoc[]
  /** Entities whose existing justifications are still valid */
  fresh: EntityDoc[]
}

/**
 * Check which entities need re-justification based on content hashes.
 *
 * An entity is considered **fresh** (skip LLM) if ALL of:
 * 1. An existing justification exists for it
 * 2. The entity's current body hash matches the justification's stored body_hash
 * 3. None of its callees have been re-justified in this run (no cascading invalidation)
 *
 * @param entities - Entities to check
 * @param existingJustifications - Map of entity_id → current JustificationDoc
 * @param calleeChangedSet - Set of entity IDs that were re-justified in this run (cascading invalidation)
 * @param edges - All edges for the repo (used to check callee relationships)
 */
export function checkStaleness(
  entities: EntityDoc[],
  existingJustifications: Map<string, JustificationDoc>,
  calleeChangedSet: Set<string>,
  edges?: Array<{ _from: string; _to: string; kind: string }>
): StalenessResult {
  const stale: EntityDoc[] = []
  const fresh: EntityDoc[] = []

  // Build a quick lookup of outbound call edges per entity
  const outboundCallees = new Map<string, Set<string>>()
  if (edges) {
    for (const edge of edges) {
      if (edge.kind !== "calls") continue
      const fromId = edge._from.split("/").pop()!
      const toId = edge._to.split("/").pop()!
      let set = outboundCallees.get(fromId)
      if (!set) {
        set = new Set()
        outboundCallees.set(fromId, set)
      }
      set.add(toId)
    }
  }

  for (const entity of entities) {
    const existing = existingJustifications.get(entity.id)

    // No existing justification → stale
    if (!existing) {
      stale.push(entity)
      continue
    }

    // Check body hash
    const currentHash = computeBodyHash(entity)
    const storedHash = existing.body_hash as string | undefined

    if (!storedHash || storedHash !== currentHash) {
      stale.push(entity)
      continue
    }

    // Check cascading invalidation: if any callee was re-justified, this entity is stale
    const callees = outboundCallees.get(entity.id)
    if (callees && calleeChangedSet.size > 0) {
      let hasChangedCallee = false
      for (const calleeId of Array.from(callees)) {
        if (calleeChangedSet.has(calleeId)) {
          hasChangedCallee = true
          break
        }
      }
      if (hasChangedCallee) {
        stale.push(entity)
        continue
      }
    }

    // All checks passed — this entity is fresh
    fresh.push(entity)
  }

  return { stale, fresh }
}
