import type { BlueprintData, EdgeDoc, EntityDoc, FeatureDoc, ImpactResult, PatternDoc, PatternFilter, RuleDoc, RuleFilter, SnippetDoc, SnippetFilter } from "./types"

export interface IGraphStore {
  bootstrapGraphSchema(): Promise<void>
  /** Health: can we reach ArangoDB? */
  healthCheck(): Promise<{ status: "up" | "down"; latencyMs?: number }>

  upsertEntity(orgId: string, entity: EntityDoc): Promise<void>
  getEntity(orgId: string, entityId: string): Promise<EntityDoc | null>
  deleteEntity(orgId: string, entityId: string): Promise<void>

  upsertEdge(orgId: string, edge: EdgeDoc): Promise<void>
  getCallersOf(orgId: string, entityId: string, depth?: number): Promise<EntityDoc[]>
  getCalleesOf(orgId: string, entityId: string, depth?: number): Promise<EntityDoc[]>

  impactAnalysis(orgId: string, entityId: string, maxDepth: number): Promise<ImpactResult>
  getEntitiesByFile(orgId: string, filePath: string): Promise<EntityDoc[]>

  upsertRule(orgId: string, rule: RuleDoc): Promise<void>
  queryRules(orgId: string, filter: RuleFilter): Promise<RuleDoc[]>
  upsertPattern(orgId: string, pattern: PatternDoc): Promise<void>
  queryPatterns(orgId: string, filter: PatternFilter): Promise<PatternDoc[]>

  upsertSnippet(orgId: string, snippet: SnippetDoc): Promise<void>
  querySnippets(orgId: string, filter: SnippetFilter): Promise<SnippetDoc[]>

  getFeatures(orgId: string, repoId: string): Promise<FeatureDoc[]>
  getBlueprint(orgId: string, repoId: string): Promise<BlueprintData>

  bulkUpsertEntities(orgId: string, entities: EntityDoc[]): Promise<void>
  bulkUpsertEdges(orgId: string, edges: EdgeDoc[]): Promise<void>
}
