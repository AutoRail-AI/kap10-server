/**
 * Phase 4: Health report activities.
 */

import { heartbeat } from "@temporalio/activity"
import { getContainer } from "@/lib/di/container"
import { aggregateFeatures } from "@/lib/justification/feature-aggregator"
import { buildHealthReport } from "@/lib/justification/health-report-builder"
import { synthesizeADRs } from "@/lib/justification/adr-synthesizer"
import type { EntityDoc, EdgeDoc, JustificationDoc, FeatureAggregation } from "@/lib/ports/types"

export interface HealthReportInput {
  orgId: string
  repoId: string
}

export interface FetchedData {
  justifications: JustificationDoc[]
  entities: EntityDoc[]
  edges: EdgeDoc[]
}

export async function fetchJustificationsAndEntities(
  input: HealthReportInput
): Promise<FetchedData> {
  const container = getContainer()
  heartbeat("fetching justifications and entities")
  const justifications = await container.graphStore.getJustifications(input.orgId, input.repoId)
  const entities = await container.graphStore.getAllEntities(input.orgId, input.repoId)
  const edges = await container.graphStore.getAllEdges(input.orgId, input.repoId)
  return { justifications, entities, edges }
}

export async function aggregateAndStoreFeatures(
  input: HealthReportInput,
  data: FetchedData
): Promise<FeatureAggregation[]> {
  const container = getContainer()
  heartbeat("aggregating features")
  const features = aggregateFeatures(
    data.justifications,
    data.entities,
    data.edges,
    input.orgId,
    input.repoId
  )
  await container.graphStore.bulkUpsertFeatureAggregations(input.orgId, features)
  return features
}

export async function buildAndStoreHealthReport(
  input: HealthReportInput,
  data: FetchedData,
  features: FeatureAggregation[]
): Promise<void> {
  const container = getContainer()
  heartbeat("building health report")
  const report = buildHealthReport(
    data.justifications,
    features,
    input.orgId,
    input.repoId,
    data.entities,
    data.edges
  )
  await container.graphStore.upsertHealthReport(input.orgId, report)
}

export async function synthesizeAndStoreADRs(
  input: HealthReportInput,
  features: FeatureAggregation[],
  justifications: JustificationDoc[]
): Promise<void> {
  const container = getContainer()
  heartbeat("synthesizing ADRs")
  const adrs = await synthesizeADRs(
    features,
    justifications,
    container.llmProvider,
    input.orgId,
    input.repoId
  )
  if (adrs.length > 0) {
    await container.graphStore.bulkUpsertADRs(input.orgId, adrs)
  }
}
