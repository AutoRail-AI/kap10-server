/**
 * Idempotency Risk Check (G8) — detects webhook/trigger handlers that mutate state without idempotency guards.
 */

import type {
  EntityDoc,
  IdempotencyFinding,
  ReviewConfig,
} from "@/lib/ports/types"
import type { IGraphStore } from "@/lib/ports/graph-store"

const TRIGGER_PATTERNS = /webhook|handler|on[A-Z]\w*Event|trigger|consumer|listener|subscriber/i
const TRIGGER_FILE_PATTERNS = /webhook|handler|trigger|consumer|listener|subscriber/i
const MUTATION_PATTERNS = /insert|update|delete|upsert|save|create|remove|destroy|write|put|post/i
const IDEMPOTENCY_PATTERNS = /idempoten|dedup|upsert|lock|mutex|semaphore|once|unique.*constraint/i

export async function runIdempotencyCheck(
  orgId: string,
  repoId: string,
  affectedEntities: Array<EntityDoc & { changedLines?: unknown }>,
  graphStore: IGraphStore,
  config: ReviewConfig
): Promise<IdempotencyFinding[]> {
  if (!config.checksEnabled.idempotency) return []

  const findings: IdempotencyFinding[] = []

  for (const entity of affectedEntities) {
    // Only check functions
    if (entity.kind !== "function" && entity.kind !== "method") continue

    // Check if entity is a webhook/trigger handler by name or file path
    const isTriggerHandler =
      TRIGGER_PATTERNS.test(entity.name) ||
      TRIGGER_FILE_PATTERNS.test(entity.file_path)

    if (!isTriggerHandler) continue

    try {
      // Get callees to find mutation patterns
      const callees = await graphStore.getCalleesOf(orgId, entity.id, 2)

      const mutations = callees.filter((c) => MUTATION_PATTERNS.test(c.name))
      if (mutations.length === 0) continue

      // Check if any entity on the call path has an idempotency guard
      const allEntities = [entity, ...callees]
      const hasGuard = allEntities.some((e) => IDEMPOTENCY_PATTERNS.test(e.name))

      if (!hasGuard) {
        for (const mutation of mutations.slice(0, 2)) {
          findings.push({
            triggerEntity: {
              id: entity.id,
              name: entity.name,
              filePath: entity.file_path,
            },
            mutationEntity: {
              id: mutation.id,
              name: mutation.name,
              filePath: mutation.file_path,
            },
            filePath: entity.file_path,
            line: (entity as { start_line?: number }).start_line ?? 1,
            message: `Webhook/trigger handler \`${entity.name}\` calls mutation \`${mutation.name}\` without an apparent idempotency guard. Duplicate deliveries could cause data inconsistency. Consider adding a deduplication key or upsert pattern.`,
          })
        }
      }
    } catch {
      // Skip entities with graph traversal errors
    }
  }

  return findings
}
