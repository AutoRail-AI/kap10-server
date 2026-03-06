/**
 * Phase 4: Health report activities.
 * Each activity is self-sufficient — fetches its own data from ArangoDB
 * to avoid serializing large payloads through Temporal's data converter.
 */

import { heartbeat } from "@temporalio/activity"
import { getContainer } from "@/lib/di/container"
import { synthesizeADRs } from "@/lib/justification/adr-synthesizer"
import { aggregateFeatures } from "@/lib/justification/feature-aggregator"
import { buildHealthReport } from "@/lib/justification/health-report-builder"
import type { FeatureAggregation } from "@/lib/ports/types"
import type { PipelineContext } from "@/lib/temporal/activities/pipeline-logs"
import { pipelineLogger } from "@/lib/temporal/activities/pipeline-logs"
import { logger } from "@/lib/utils/logger"

export interface HealthReportInput extends PipelineContext {}

/**
 * Fetch justifications/entities/edges, aggregate into features, and store.
 * Returns only the feature count — no large data crosses Temporal.
 */
export async function aggregateAndStoreFeatures(
  input: HealthReportInput,
): Promise<{ featureCount: number }> {
  const container = getContainer()
  const log = logger.child({ service: "health-report", organizationId: input.orgId, repoId: input.repoId })
  const plog = pipelineLogger(input, "justifying")
  const activityStart = Date.now()

  plog.log("info", "Step 9/10", "Aggregating features from justifications...")
  heartbeat("fetching data for feature aggregation")

  const fetchStart = Date.now()
  const justifications = await container.graphStore.getJustifications(input.orgId, input.repoId)
  const entities = await container.graphStore.getAllEntities(input.orgId, input.repoId)
  const edges = await container.graphStore.getAllEdges(input.orgId, input.repoId)
  const fetchMs = Date.now() - fetchStart
  log.info("Data loaded for feature aggregation", { justifications: justifications.length, entities: entities.length, edges: edges.length, fetchMs })

  heartbeat("aggregating features")
  const aggStart = Date.now()
  const features = aggregateFeatures(justifications, entities, edges, input.orgId, input.repoId)
  const aggMs = Date.now() - aggStart

  const storeStart = Date.now()
  await container.graphStore.bulkUpsertFeatureAggregations(input.orgId, features)
  const storeMs = Date.now() - storeStart

  const totalMs = Date.now() - activityStart
  log.info("Feature aggregation complete", { featureCount: features.length, timing: { fetchMs, aggMs, storeMs, totalMs } })
  plog.log("info", "Step 9/10", `Feature aggregation complete — ${features.length} features from ${justifications.length} justifications | Fetch: ${fetchMs}ms, Aggregate: ${aggMs}ms, Store: ${storeMs}ms, Total: ${totalMs}ms`)
  return { featureCount: features.length }
}

/**
 * Fetch all data needed, build health report, and store it.
 * Self-sufficient — fetches everything from ArangoDB internally.
 */
export async function buildAndStoreHealthReport(
  input: HealthReportInput,
): Promise<void> {
  const container = getContainer()
  const log = logger.child({ service: "health-report", organizationId: input.orgId, repoId: input.repoId })
  const plog = pipelineLogger(input, "justifying")
  const activityStart = Date.now()

  plog.log("info", "Step 9/10", "Building health report...")
  heartbeat("fetching data for health report")

  const fetchStart = Date.now()
  const justifications = await container.graphStore.getJustifications(input.orgId, input.repoId)
  const entities = await container.graphStore.getAllEntities(input.orgId, input.repoId)
  const edges = await container.graphStore.getAllEdges(input.orgId, input.repoId)

  heartbeat("loading features for health report")
  const features: FeatureAggregation[] = await container.graphStore.getFeatureAggregations(input.orgId, input.repoId)
  const fetchMs = Date.now() - fetchStart
  log.info("Data loaded for health report", { justifications: justifications.length, entities: entities.length, edges: edges.length, features: features.length, fetchMs })

  heartbeat("building health report")
  const buildStart = Date.now()
  const report = buildHealthReport(justifications, features, input.orgId, input.repoId, entities, edges)
  const buildMs = Date.now() - buildStart

  const storeStart = Date.now()
  await container.graphStore.upsertHealthReport(input.orgId, report)
  const storeMs = Date.now() - storeStart

  const totalMs = Date.now() - activityStart
  log.info("Health report generated", {
    risks: report.risks.length,
    avgConfidence: Math.round(report.average_confidence * 100),
    timing: { fetchMs, buildMs, storeMs, totalMs },
  })
  plog.log("info", "Step 9/10", `Health report — ${report.risks.length} risks, ${(report.average_confidence * 100).toFixed(0)}% avg confidence | Fetch: ${fetchMs}ms, Build: ${buildMs}ms, Store: ${storeMs}ms, Total: ${totalMs}ms`)
}

/**
 * Fetch features and justifications, synthesize ADRs, and store them.
 * Self-sufficient — fetches everything from ArangoDB internally.
 */
export async function synthesizeAndStoreADRs(
  input: HealthReportInput,
): Promise<void> {
  const container = getContainer()
  const log = logger.child({ service: "health-report", organizationId: input.orgId, repoId: input.repoId })
  const plog = pipelineLogger(input, "justifying")
  const activityStart = Date.now()

  plog.log("info", "Step 10/10", "Synthesizing Architecture Decision Records...")
  heartbeat("fetching data for ADR synthesis")

  const fetchStart = Date.now()
  const justifications = await container.graphStore.getJustifications(input.orgId, input.repoId)
  const features: FeatureAggregation[] = await container.graphStore.getFeatureAggregations(input.orgId, input.repoId)
  const fetchMs = Date.now() - fetchStart
  log.info("Data loaded for ADR synthesis", { justifications: justifications.length, features: features.length, fetchMs })

  heartbeat("synthesizing ADRs")
  const synthStart = Date.now()
  const adrs = await synthesizeADRs(features, justifications, container.llmProvider, input.orgId, input.repoId)
  const synthMs = Date.now() - synthStart

  if (adrs.length > 0) {
    const storeStart = Date.now()
    await container.graphStore.bulkUpsertADRs(input.orgId, adrs)
    const storeMs = Date.now() - storeStart
    log.info("ADRs stored", { adrCount: adrs.length, storeMs })
  }

  const totalMs = Date.now() - activityStart
  log.info("ADR synthesis complete", { adrCount: adrs.length, timing: { fetchMs, synthMs, totalMs } })
  plog.log("info", "Step 10/10", `ADR synthesis — ${adrs.length} records generated | Fetch: ${fetchMs}ms, Synthesize: ${synthMs}ms, Total: ${totalMs}ms`)
}
