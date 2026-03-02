/**
 * L-24: Temporal Analysis Activity — mines git commit history for co-change
 * coupling edges and per-entity temporal context.
 *
 * Runs on heavy-compute-queue (needs workspace filesystem for `git log`).
 */

import { heartbeat } from "@temporalio/activity"
import { createPipelineLogger } from "@/lib/temporal/activities/pipeline-logs"
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
    buildFileCommitIndex,
    mapFileEdgesToEntityEdges,
  } = require("@/lib/indexer/git-analyzer") as typeof import("@/lib/indexer/git-analyzer")

  const container = getContainer()
  const log = logger.child({
    service: "temporal-analysis",
    organizationId: input.orgId,
    repoId: input.repoId,
  })
  const plog = createPipelineLogger(input.repoId, "temporal-analysis")

  try {
    // Step 1: Mine commit history
    log.info("Mining commit history (last 365 days, max 5000 commits)")
    plog.log("info", "Step 4c/7", "Mining git commit history (last 365 days)...")
    const commits = await mineCommitHistory(input.workspacePath, 365, 5000)
    heartbeat(`Mined ${commits.length} commits`)
    log.info(`Mined ${commits.length} commits`)

    plog.log("info", "Step 4c/7", `Mined ${commits.length} commits`)

    if (commits.length === 0) {
      log.info("No commits found, skipping temporal analysis")
      plog.log("info", "Step 4c/7", "No commits found — skipping temporal analysis")
      return { coChangeEdgesStored: 0, entitiesUpdated: 0, filesAnalyzed: 0 }
    }

    // Step 2: Compute file-level co-change edges
    log.info("Computing co-change edges")
    plog.log("info", "Step 4c/7", "Computing co-change coupling edges...")
    const coChangeEdges = computeCoChangeEdges(commits, 3, 0.3)
    heartbeat(`Computed ${coChangeEdges.length} co-change edges`)
    log.info(`Found ${coChangeEdges.length} co-change edges`)

    // Step 3: Fetch all entities to build entityFileMap
    log.info("Fetching entities for file-to-entity mapping")
    const ENTITY_LIMIT = 200_000
    const allEntities = await container.graphStore.getAllEntities(input.orgId, input.repoId, ENTITY_LIMIT)
    if (allEntities.length >= ENTITY_LIMIT) {
      log.warn(`Entity count hit limit (${ENTITY_LIMIT}) — some entities may be excluded from temporal analysis`)
    }
    heartbeat(`Fetched ${allEntities.length} entities`)

    // Map kind → ArangoDB collection name for proper edge vertex handles
    const KIND_TO_COLL: Record<string, string> = {
      file: "files", function: "functions", method: "functions",
      class: "classes", interface: "interfaces", variable: "variables",
    }

    const entityFileMap = new Map<string, string[]>()
    const entityKindMap = new Map<string, string>()
    for (const entity of allEntities) {
      const coll = KIND_TO_COLL[entity.kind] ?? "functions"
      const qualifiedId = `${coll}/${entity.id}`
      entityKindMap.set(entity.id, qualifiedId)
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
          _from: entityKindMap.get(e.fromId) ?? `functions/${e.fromId}`,
          _to: entityKindMap.get(e.toId) ?? `functions/${e.toId}`,
          kind: "logically_coupled" as const,
          org_id: input.orgId,
          repo_id: input.repoId,
          support: e.support,
          confidence: e.confidence,
          jaccard: e.jaccard,
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
    plog.log("info", "Step 4c/7", `Computing temporal context for ${uniqueFiles.size} files...`)

    const fileCommitIndex = buildFileCommitIndex(commits)

    let entitiesUpdated = 0
    const entityUpdates: Array<Record<string, unknown>> = []

    for (const filePath of Array.from(uniqueFiles)) {
      const ctx = computeTemporalContext(commits, filePath, fileCommitIndex)
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
      await container.graphStore.bulkUpsertEntities(
        input.orgId,
        entityUpdates as Parameters<typeof container.graphStore.bulkUpsertEntities>[1],
      )
      entitiesUpdated = entityUpdates.length
    }
    heartbeat(`Updated ${entitiesUpdated} entities with temporal context`)

    plog.log("info", "Step 4c/7", `Temporal analysis complete — ${coChangeEdgesStored} co-change edges, ${entitiesUpdated} entities enriched`)

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
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    log.error("Temporal analysis failed", { errorMessage: msg })
    plog.log("error", "Step 4c/7", `Temporal analysis failed: ${msg}`)
    throw error
  }
}
