import type { BlueprintData, EdgeDoc, EntityDoc, FeatureDoc, ImpactResult, ImportChain, PatternDoc, PatternFilter, ProjectStats, RuleDoc, RuleFilter, SearchResult, SnippetDoc, SnippetFilter } from "./types"

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
  getEntitiesByFile(orgId: string, repoId: string, filePath: string): Promise<EntityDoc[]>

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
  /** Phase 1: List file paths for a repo (for file tree) */
  getFilePaths(orgId: string, repoId: string): Promise<{ path: string }[]>
  /** Phase 1: Delete all graph data for a repo */
  deleteRepoData(orgId: string, repoId: string): Promise<void>

  // Phase 2: MCP methods
  /** Fulltext search across entity names and signatures */
  searchEntities(orgId: string, repoId: string, query: string, limit?: number): Promise<SearchResult[]>
  /** Traverse import edges to specified depth */
  getImports(orgId: string, repoId: string, filePath: string, depth?: number): Promise<ImportChain[]>
  /** Aggregate entity counts and language distribution */
  getProjectStats(orgId: string, repoId: string): Promise<ProjectStats>

  // Phase 2: Workspace overlay
  /** Upsert an overlay entity scoped to a workspace */
  upsertWorkspaceEntity(orgId: string, workspaceId: string, entity: EntityDoc): Promise<void>
  /** Get entity with workspace overlay (overlay takes precedence) */
  getEntityWithOverlay(orgId: string, entityId: string, workspaceId?: string): Promise<EntityDoc | null>
  /** Remove all overlay entities for a workspace */
  cleanupExpiredWorkspaces(workspaceId: string): Promise<void>
}
