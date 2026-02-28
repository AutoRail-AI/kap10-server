/**
 * Graph analysis activities — pre-compute blast radius (fan-in/fan-out)
 * for all function/method entities and flag high-risk "god functions".
 */

import { heartbeat } from "@temporalio/activity"
import { getContainer } from "@/lib/di/container"
import { logger } from "@/lib/utils/logger"

export interface GraphAnalysisInput {
  orgId: string
  repoId: string
}

/**
 * Pre-compute fan-in and fan-out for all function/method entities
 * using a single AQL query with COLLECT. Updates entity documents
 * with fan_in, fan_out, and risk_level metadata.
 */
export async function precomputeBlastRadius(
  input: GraphAnalysisInput
): Promise<{ updatedCount: number; highRiskCount: number }> {
  const log = logger.child({
    service: "graph-analysis",
    organizationId: input.orgId,
    repoId: input.repoId,
  })

  const container = getContainer()
  heartbeat("fetching entities and edges for blast radius")

  const allEntities = await container.graphStore.getAllEntities(input.orgId, input.repoId)
  const edges = await container.graphStore.getAllEdges(input.orgId, input.repoId)

  // Filter to callable entities (functions, methods)
  const callableKinds = new Set(["function", "method"])
  const callableEntities = allEntities.filter((e) => callableKinds.has(e.kind))

  if (callableEntities.length === 0) {
    log.info("No callable entities found, skipping blast radius computation")
    return { updatedCount: 0, highRiskCount: 0 }
  }

  heartbeat(`computing fan-in/fan-out for ${callableEntities.length} callable entities`)

  // Count fan-in (inbound calls) and fan-out (outbound calls) per entity
  const callEdges = edges.filter((e) => e.kind === "calls")

  const fanInMap = new Map<string, number>()
  const fanOutMap = new Map<string, number>()

  for (const edge of callEdges) {
    // _from calls _to: _from has fan-out, _to has fan-in
    // Edge _from/_to are in "collection/key" format — extract the key
    const fromId = edge._from.includes("/") ? edge._from.split("/")[1]! : edge._from
    const toId = edge._to.includes("/") ? edge._to.split("/")[1]! : edge._to

    fanOutMap.set(fromId, (fanOutMap.get(fromId) ?? 0) + 1)
    fanInMap.set(toId, (fanInMap.get(toId) ?? 0) + 1)
  }

  // Update entities with blast radius metadata
  const HIGH_THRESHOLD = 10
  const MEDIUM_THRESHOLD = 5
  let highRiskCount = 0
  const updatedEntities: typeof callableEntities = []

  for (const entity of callableEntities) {
    const fanIn = fanInMap.get(entity.id) ?? 0
    const fanOut = fanOutMap.get(entity.id) ?? 0

    let riskLevel: "high" | "medium" | "normal" = "normal"
    if (fanIn >= HIGH_THRESHOLD || fanOut >= HIGH_THRESHOLD) {
      riskLevel = "high"
      highRiskCount++
    } else if (fanIn >= MEDIUM_THRESHOLD || fanOut >= MEDIUM_THRESHOLD) {
      riskLevel = "medium"
    }

    entity.fan_in = fanIn
    entity.fan_out = fanOut
    entity.risk_level = riskLevel
    updatedEntities.push(entity)
  }

  heartbeat(`storing blast radius for ${updatedEntities.length} entities (${highRiskCount} high-risk)`)

  // Bulk update entities in the graph store
  if (updatedEntities.length > 0) {
    await container.graphStore.bulkUpsertEntities(input.orgId, updatedEntities)
  }

  log.info("Blast radius pre-computation complete", {
    totalCallable: callableEntities.length,
    highRiskCount,
    callEdges: callEdges.length,
  })

  return { updatedCount: updatedEntities.length, highRiskCount }
}
