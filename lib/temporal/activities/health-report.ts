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
import { createPipelineLogger } from "@/lib/temporal/activities/pipeline-logs"

export interface HealthReportInput {
  orgId: string
  repoId: string
  runId?: string
}

/**
 * Fetch justifications/entities/edges, aggregate into features, and store.
 * Returns only the feature count — no large data crosses Temporal.
 */
export async function aggregateAndStoreFeatures(
  input: HealthReportInput,
): Promise<{ featureCount: number }> {
  const container = getContainer()
  const plog = createPipelineLogger(input.repoId, "justifying", input.runId)
  plog.log("info", "Step 9/10", "Aggregating features from justifications...")
  heartbeat("fetching data for feature aggregation")
  const justifications = await container.graphStore.getJustifications(input.orgId, input.repoId)
  const entities = await container.graphStore.getAllEntities(input.orgId, input.repoId)
  const edges = await container.graphStore.getAllEdges(input.orgId, input.repoId)

  heartbeat("aggregating features")
  const features = aggregateFeatures(justifications, entities, edges, input.orgId, input.repoId)
  await container.graphStore.bulkUpsertFeatureAggregations(input.orgId, features)
  plog.log("info", "Step 9/10", `Feature aggregation complete — ${features.length} features identified`)
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
  const plog = createPipelineLogger(input.repoId, "justifying", input.runId)
  plog.log("info", "Step 9/10", "Building health report...")
  heartbeat("fetching data for health report")
  const justifications = await container.graphStore.getJustifications(input.orgId, input.repoId)
  const entities = await container.graphStore.getAllEntities(input.orgId, input.repoId)
  const edges = await container.graphStore.getAllEdges(input.orgId, input.repoId)

  heartbeat("loading features for health report")
  const features: FeatureAggregation[] = await container.graphStore.getFeatureAggregations(input.orgId, input.repoId)

  heartbeat("building health report")
  const report = buildHealthReport(justifications, features, input.orgId, input.repoId, entities, edges)
  await container.graphStore.upsertHealthReport(input.orgId, report)
  plog.log("info", "Step 9/10", `Health report generated — ${report.risks.length} risks identified, avg confidence ${(report.average_confidence * 100).toFixed(0)}%`)
}

/**
 * Fetch features and justifications, synthesize ADRs, and store them.
 * Self-sufficient — fetches everything from ArangoDB internally.
 */
export async function synthesizeAndStoreADRs(
  input: HealthReportInput,
): Promise<void> {
  const container = getContainer()
  const plog = createPipelineLogger(input.repoId, "justifying", input.runId)
  plog.log("info", "Step 10/10", "Synthesizing Architecture Decision Records...")
  heartbeat("fetching data for ADR synthesis")
  const justifications = await container.graphStore.getJustifications(input.orgId, input.repoId)
  const features: FeatureAggregation[] = await container.graphStore.getFeatureAggregations(input.orgId, input.repoId)

  heartbeat("synthesizing ADRs")
  const adrs = await synthesizeADRs(features, justifications, container.llmProvider, input.orgId, input.repoId)
  if (adrs.length > 0) {
    await container.graphStore.bulkUpsertADRs(input.orgId, adrs)
  }
  plog.log("info", "Step 10/10", `ADR synthesis complete — ${adrs.length} architecture decision records generated`)
}
