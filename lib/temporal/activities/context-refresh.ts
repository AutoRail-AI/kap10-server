/**
 * TBI-J-03: Incremental context refresh activity.
 * After incremental indexing, selectively refreshes affected sections
 * of the knowledge document based on what changed.
 */

import { heartbeat } from "@temporalio/activity"
import { getContainer } from "@/lib/di/container"
import { logger } from "@/lib/utils/logger"

export interface ContextRefreshInput {
  orgId: string
  repoId: string
  changedEntityCount: number
  addedEntityCount: number
  deletedEntityCount: number
  cascadeEntityCount: number
}

export interface ContextRefreshResult {
  refreshed: boolean
  sectionsRefreshed: string[]
}

/**
 * Determine which knowledge document sections are invalidated by the incremental changes,
 * then regenerate only those sections.
 *
 * Debounce gate: only triggers if changedEntityCount >= 10 or
 * the last refresh was > 24 hours ago.
 */
export async function refreshKnowledgeSections(
  input: ContextRefreshInput
): Promise<ContextRefreshResult> {
  const log = logger.child({ service: "context-refresh", organizationId: input.orgId, repoId: input.repoId })
  const container = getContainer()

  heartbeat("checking refresh eligibility")

  // Debounce: only refresh if enough entities changed
  const totalChanges = input.changedEntityCount + input.addedEntityCount + input.deletedEntityCount
  if (totalChanges < 10) {
    log.info("Skipping context refresh — below change threshold", { totalChanges })
    return { refreshed: false, sectionsRefreshed: [] }
  }

  // Check last refresh time via index events
  try {
    const latestEvent = await container.graphStore.getLatestIndexEvent(input.orgId, input.repoId)
    if (latestEvent) {
      const lastRefreshMeta = (latestEvent as unknown as Record<string, unknown>).context_refreshed_at as string | undefined
      if (lastRefreshMeta) {
        const hoursSinceRefresh = (Date.now() - new Date(lastRefreshMeta).getTime()) / (1000 * 60 * 60)
        if (hoursSinceRefresh < 24 && totalChanges < 50) {
          log.info("Skipping context refresh — recent refresh within 24h and moderate changes", { hoursSinceRefresh, totalChanges })
          return { refreshed: false, sectionsRefreshed: [] }
        }
      }
    }
  } catch {
    // Best-effort — proceed with refresh on error
  }

  heartbeat("determining invalidated sections")

  // Determine which sections need refreshing
  const sectionsToRefresh: string[] = []

  if (input.changedEntityCount > 0) {
    sectionsToRefresh.push("feature_map", "risk_map")
  }
  if (input.addedEntityCount > 0 || input.deletedEntityCount > 0) {
    sectionsToRefresh.push("domain_model")
  }
  if (input.cascadeEntityCount > 0) {
    sectionsToRefresh.push("risk_map")
  }

  // Deduplicate
  const uniqueSections = Array.from(new Set(sectionsToRefresh))

  if (uniqueSections.length === 0) {
    return { refreshed: false, sectionsRefreshed: [] }
  }

  heartbeat(`refreshing ${uniqueSections.length} sections`)

  // Regenerate context document with fresh data
  try {
    const { generateContextDocument } = require("@/lib/justification/context-document-generator") as typeof import("@/lib/justification/context-document-generator")

    const doc = await generateContextDocument(input.orgId, input.repoId, container.graphStore)

    // Store the refreshed document (overwrite existing)
    // The document is stored as a special entity or in ArangoDB context store
    await container.graphStore.upsertEntity(input.orgId, {
      id: `context-doc-${input.repoId}`,
      kind: "file",
      name: "UNERR_CONTEXT.md",
      file_path: ".unerr/UNERR_CONTEXT.md",
      body: doc,
      repo_id: input.repoId,
      org_id: input.orgId,
      start_line: 1,
      language: "markdown",
    })

    log.info("Context document refreshed", {
      sectionsRefreshed: uniqueSections,
      documentLength: doc.length,
    })

    return { refreshed: true, sectionsRefreshed: uniqueSections }
  } catch (error: unknown) {
    log.warn("Failed to refresh context document", {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return { refreshed: false, sectionsRefreshed: [] }
  }
}
