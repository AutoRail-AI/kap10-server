/**
 * Phase 5: Entity diff algorithm for incremental indexing.
 * Compares old and new entity sets to determine what changed.
 */

import type { EntityDiff, EntityDoc } from "@/lib/ports/types"

/**
 * Compute the diff between old and new entity sets.
 * Uses entity IDs for identity and content hashing for change detection.
 * Returns added, updated, and deleted entities.
 */
export function diffEntitySets(
  oldEntities: EntityDoc[],
  newEntities: EntityDoc[]
): EntityDiff {
  const oldMap = new Map<string, EntityDoc>()
  for (const e of oldEntities) {
    oldMap.set(e.id, e)
  }

  const newMap = new Map<string, EntityDoc>()
  for (const e of newEntities) {
    newMap.set(e.id, e)
  }

  const added: EntityDoc[] = []
  const updated: EntityDoc[] = []
  const deleted: EntityDoc[] = []

  // Find added and updated
  newMap.forEach((newEntity, id) => {
    const oldEntity = oldMap.get(id)
    if (!oldEntity) {
      added.push(newEntity)
    } else if (hasEntityChanged(oldEntity, newEntity)) {
      updated.push(newEntity)
    }
  })

  // Find deleted
  oldMap.forEach((oldEntity, id) => {
    if (!newMap.has(id)) {
      deleted.push(oldEntity)
    }
  })

  return { added, updated, deleted }
}

/**
 * Check if an entity has meaningfully changed by comparing key fields.
 * Compares: name, kind, file_path, signature, body hash, start_line.
 */
function hasEntityChanged(oldEntity: EntityDoc, newEntity: EntityDoc): boolean {
  if (oldEntity.name !== newEntity.name) return true
  if (oldEntity.kind !== newEntity.kind) return true
  if (oldEntity.file_path !== newEntity.file_path) return true
  if ((oldEntity.signature as string) !== (newEntity.signature as string)) return true
  if ((oldEntity.body_hash as string) !== (newEntity.body_hash as string)) return true
  if ((oldEntity.start_line as number) !== (newEntity.start_line as number)) return true
  return false
}
