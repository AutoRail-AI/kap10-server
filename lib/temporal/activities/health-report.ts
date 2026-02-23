/**
 * Phase 4: Health report activities.
 * Each activity is self-sufficient — fetches its own data from ArangoDB
 * to avoid serializing large payloads through Temporal's data converter.
 */

import { heartbeat } from "@temporalio/activity"
import { getContainer } from "@/lib/di/container"
import { aggregateFeatures } from "@/lib/justification/feature-aggregator"
import { buildHealthReport } from "@/lib/justification/health-report-builder"
import { synthesizeADRs } from "@/lib/justification/adr-synthesizer"
import type { FeatureAggregation } from "@/lib/ports/types"

export interface HealthReportInput {
  orgId: string
  repoId: string
}

/**
 * Fetch justifications/entities/edges, aggregate into features, and store.
 * Returns only the feature count — no large data crosses Temporal.
 */
export async function aggregateAndStoreFeatures(
  input: HealthReportInput,
): Promise<{ featureCount: number }> {
  const container = getContainer()
  heartbeat("fetching data for feature aggregation")
  const justifications = await container.graphStore.getJustifications(input.orgId, input.repoId)
  const entities = await container.graphStore.getAllEntities(input.orgId, input.repoId)
  const edges = await container.graphStore.getAllEdges(input.orgId, input.repoId)

  heartbeat("aggregating features")
  const features = aggregateFeatures(justifications, entities, edges, input.orgId, input.repoId)
  await container.graphStore.bulkUpsertFeatureAggregations(input.orgId, features)
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
  heartbeat("fetching data for health report")
  const justifications = await container.graphStore.getJustifications(input.orgId, input.repoId)
  const entities = await container.graphStore.getAllEntities(input.orgId, input.repoId)
  const edges = await container.graphStore.getAllEdges(input.orgId, input.repoId)

  heartbeat("loading features for health report")
  const features: FeatureAggregation[] = await container.graphStore.getFeatureAggregations(input.orgId, input.repoId)

  heartbeat("building health report")
  const report = buildHealthReport(justifications, features, input.orgId, input.repoId, entities, edges)
  await container.graphStore.upsertHealthReport(input.orgId, report)
}

/**
 * Fetch features and justifications, synthesize ADRs, and store them.
 * Self-sufficient — fetches everything from ArangoDB internally.
 */
export async function synthesizeAndStoreADRs(
  input: HealthReportInput,
): Promise<void> {
  const container = getContainer()
  heartbeat("fetching data for ADR synthesis")
  const justifications = await container.graphStore.getJustifications(input.orgId, input.repoId)
  const features: FeatureAggregation[] = await container.graphStore.getFeatureAggregations(input.orgId, input.repoId)

  heartbeat("synthesizing ADRs")
  const adrs = await synthesizeADRs(features, justifications, container.llmProvider, input.orgId, input.repoId)
  if (adrs.length > 0) {
    await container.graphStore.bulkUpsertADRs(input.orgId, adrs)
  }
}
