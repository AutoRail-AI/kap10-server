/**
 * L-24: Temporal Analysis Activity — mines git commit history for co-change
 * coupling edges and per-entity temporal context.
 *
 * Runs on heavy-compute-queue (needs workspace filesystem for `git log`).
 */

import { heartbeat } from "@temporalio/activity"
import { logger } from "@/lib/utils/logger"

export interface TemporalAnalysisInput {
  orgId: string
  repoId: string
  workspacePath: string
}

export interface TemporalAnalysisOutput {
  coChangeEdgesStored: number
  entitiesUpdated: number
  filesAnalyzed: number
}

export async function computeTemporalAnalysis(
  input: TemporalAnalysisInput,
): Promise<TemporalAnalysisOutput> {
  const { getContainer } = require("@/lib/di/container") as typeof import("@/lib/di/container")
  const {
    mineCommitHistory,
    computeCoChangeEdges,
    computeTemporalContext,
    mapFileEdgesToEntityEdges,
  } = require("@/lib/indexer/git-analyzer") as typeof import("@/lib/indexer/git-analyzer")

  const container = getContainer()
  const log = logger.child({
    service: "temporal-analysis",
    organizationId: input.orgId,
    repoId: input.repoId,
  })

  // Step 1: Mine commit history
  log.info("Mining commit history (last 365 days, max 5000 commits)")
  const commits = await mineCommitHistory(input.workspacePath, 365, 5000)
  heartbeat(`Mined ${commits.length} commits`)
  log.info(`Mined ${commits.length} commits`)

  if (commits.length === 0) {
    log.info("No commits found, skipping temporal analysis")
    return { coChangeEdgesStored: 0, entitiesUpdated: 0, filesAnalyzed: 0 }
  }

  // Step 2: Compute file-level co-change edges
  log.info("Computing co-change edges")
  const coChangeEdges = computeCoChangeEdges(commits, 3, 0.3)
  heartbeat(`Computed ${coChangeEdges.length} co-change edges`)
  log.info(`Found ${coChangeEdges.length} co-change edges`)

  // Step 3: Fetch all entities to build entityFileMap
  log.info("Fetching entities for file-to-entity mapping")
  const allEntities = await container.graphStore.getAllEntities(input.orgId, input.repoId)
  heartbeat(`Fetched ${allEntities.length} entities`)

  const entityFileMap = new Map<string, string[]>()
  for (const entity of allEntities) {
    if (!entity.file_path) continue
    const existing = entityFileMap.get(entity.file_path)
    if (existing) {
      existing.push(entity.id)
    } else {
      entityFileMap.set(entity.file_path, [entity.id])
    }
  }

  // Step 4: Map file edges to entity edges and store
  let coChangeEdgesStored = 0
  if (coChangeEdges.length > 0) {
    const entityEdges = mapFileEdgesToEntityEdges(coChangeEdges, entityFileMap, 5)
    log.info(`Mapped to ${entityEdges.length} entity-level co-change edges`)

    if (entityEdges.length > 0) {
      const edgeDocs = entityEdges.map((e) => ({
        _from: e.fromId,
        _to: e.toId,
        kind: "logically_coupled" as const,
        org_id: input.orgId,
        repo_id: input.repoId,
      }))

      await container.graphStore.bulkUpsertEdges(input.orgId, edgeDocs as Parameters<typeof container.graphStore.bulkUpsertEdges>[1])
      coChangeEdgesStored = edgeDocs.length
    }
    heartbeat(`Stored ${coChangeEdgesStored} co-change edges`)
  }

  // Step 5: Compute temporal context per unique file and update entities
  const uniqueFiles = new Set<string>()
  for (const commit of commits) {
    for (const file of commit.files) {
      uniqueFiles.add(file)
    }
  }

  log.info(`Computing temporal context for ${uniqueFiles.size} files`)
  let entitiesUpdated = 0
  const entityUpdates: Array<Record<string, unknown>> = []

  for (const filePath of Array.from(uniqueFiles)) {
    const ctx = computeTemporalContext(commits, filePath)
    if (!ctx) continue

    const entityIds = entityFileMap.get(filePath)
    if (!entityIds) continue

    for (const entityId of entityIds) {
      entityUpdates.push({
        id: entityId,
        org_id: input.orgId,
        repo_id: input.repoId,
        change_frequency: ctx.change_frequency,
        recent_change_frequency: ctx.recent_change_frequency,
        author_count: ctx.author_count,
        author_concentration: ctx.author_concentration,
        stability_score: ctx.stability_score,
        commit_intents: ctx.commit_intents,
        last_changed_at: ctx.last_changed_at,
      })
    }
  }

  if (entityUpdates.length > 0) {
    // Batch update entities with temporal context
    // bulkUpsertEntities merges fields, so existing entity data is preserved
    await container.graphStore.bulkUpsertEntities(
      input.orgId,
      entityUpdates as Parameters<typeof container.graphStore.bulkUpsertEntities>[1],
    )
    entitiesUpdated = entityUpdates.length
  }
  heartbeat(`Updated ${entitiesUpdated} entities with temporal context`)

  log.info("Temporal analysis complete", {
    coChangeEdgesStored,
    entitiesUpdated,
    filesAnalyzed: uniqueFiles.size,
  })

  return {
    coChangeEdgesStored,
    entitiesUpdated,
    filesAnalyzed: uniqueFiles.size,
  }
}
