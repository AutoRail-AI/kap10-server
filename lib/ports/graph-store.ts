import type { ADRDoc, BlueprintData, BoundedContextFinding, DomainOntologyDoc, DriftScoreDoc, EdgeDoc, EntityDoc, FeatureAggregation, FeatureDoc, HealthReportDoc, ImpactReportDoc, ImpactResult, ImportChain, IndexEventDoc, JustificationDoc, LedgerEntry, LedgerEntryStatus, LedgerSummary, LedgerTimelineQuery, MinedPatternDoc, PaginatedResult, PatternDoc, PatternFilter, ProjectStats, RuleDoc, RuleExceptionDoc, RuleFilter, RuleHealthDoc, SearchResult, SnippetDoc, SnippetFilter, SubgraphResult, TokenUsageEntry, TokenUsageSummary, WorkingSnapshot } from "./types"

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
  deleteRule(orgId: string, ruleId: string): Promise<void>
  archiveRule(orgId: string, ruleId: string): Promise<void>
  upsertPattern(orgId: string, pattern: PatternDoc): Promise<void>
  queryPatterns(orgId: string, filter: PatternFilter): Promise<PatternDoc[]>
  updatePatternStatus(orgId: string, patternId: string, status: string): Promise<void>
  getPatternByHash(orgId: string, repoId: string, hash: string): Promise<PatternDoc | null>

  // Phase 6: Rule Health
  getRuleHealth(orgId: string, ruleId: string): Promise<RuleHealthDoc | null>
  upsertRuleHealth(orgId: string, health: RuleHealthDoc): Promise<void>

  // Phase 6: Mined Patterns
  upsertMinedPattern(orgId: string, pattern: MinedPatternDoc): Promise<void>
  queryMinedPatterns(orgId: string, repoId: string): Promise<MinedPatternDoc[]>

  // Phase 6: Impact Reports
  upsertImpactReport(orgId: string, report: ImpactReportDoc): Promise<void>
  getImpactReport(orgId: string, ruleId: string): Promise<ImpactReportDoc | null>

  // Phase 6: Rule Exceptions
  queryRuleExceptions(orgId: string, ruleId: string): Promise<RuleExceptionDoc[]>
  upsertRuleException(orgId: string, exception: RuleExceptionDoc): Promise<void>
  updateRuleException(orgId: string, exceptionId: string, status: string): Promise<void>

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

  // Phase 4: Justification & Taxonomy
  /** Upsert a batch of justifications (bi-temporal: sets valid_to on old before insert) */
  bulkUpsertJustifications(orgId: string, justifications: JustificationDoc[]): Promise<void>
  /** Get the current (valid_to=null) justification for an entity */
  getJustification(orgId: string, entityId: string): Promise<JustificationDoc | null>
  /** Get all current justifications for a repo */
  getJustifications(orgId: string, repoId: string): Promise<JustificationDoc[]>
  /** Get bi-temporal history for an entity's justifications */
  getJustificationHistory(orgId: string, entityId: string): Promise<JustificationDoc[]>

  // Phase 4: Feature aggregations
  /** Upsert feature aggregations (grouped by featureTag) */
  bulkUpsertFeatureAggregations(orgId: string, features: FeatureAggregation[]): Promise<void>
  /** Get all feature aggregations for a repo */
  getFeatureAggregations(orgId: string, repoId: string): Promise<FeatureAggregation[]>

  // Phase 4: Health reports
  /** Store a health report */
  upsertHealthReport(orgId: string, report: HealthReportDoc): Promise<void>
  /** Get the latest health report for a repo */
  getHealthReport(orgId: string, repoId: string): Promise<HealthReportDoc | null>

  // Phase 4: Domain ontology
  /** Store domain ontology for a repo */
  upsertDomainOntology(orgId: string, ontology: DomainOntologyDoc): Promise<void>
  /** Get domain ontology for a repo */
  getDomainOntology(orgId: string, repoId: string): Promise<DomainOntologyDoc | null>

  // Phase 4: Drift detection
  /** Bulk upsert drift scores */
  bulkUpsertDriftScores(orgId: string, scores: DriftScoreDoc[]): Promise<void>
  /** Get drift scores for a repo */
  getDriftScores(orgId: string, repoId: string): Promise<DriftScoreDoc[]>

  // Phase 4: ADR (Architecture Decision Records)
  /** Bulk upsert ADRs */
  bulkUpsertADRs(orgId: string, adrs: ADRDoc[]): Promise<void>
  /** Get ADRs for a repo */
  getADRs(orgId: string, repoId: string): Promise<ADRDoc[]>

  // Phase 4: GraphRAG — N-hop sub-graph extraction
  /** Get a sub-graph (entities + edges) within N hops of a starting entity */
  getSubgraph(orgId: string, entityId: string, depth?: number, opts?: { crossRepo?: boolean }): Promise<SubgraphResult>
  /** Get sub-graphs for multiple entities in a single batched query (chunked at 50 per call) */
  getBatchSubgraphs(orgId: string, entityIds: string[], depth?: number): Promise<Map<string, SubgraphResult>>

  // Phase 4: Bulk fetch entities + edges for a repo
  /** Get all entities for a repo (default limit 10000 to prevent OOM) */
  getAllEntities(orgId: string, repoId: string, limit?: number): Promise<EntityDoc[]>
  /** Get all edges for a repo (default limit 20000 to prevent OOM) */
  getAllEdges(orgId: string, repoId: string, limit?: number): Promise<EdgeDoc[]>

  // Phase 4: Token usage tracking
  /** Log a token usage entry */
  logTokenUsage(orgId: string, entry: TokenUsageEntry): Promise<void>
  /** Get token usage entries for a repo */
  getTokenUsage(orgId: string, repoId: string): Promise<TokenUsageEntry[]>
  /** Get aggregated token usage summary with cost estimates */
  getTokenUsageSummary(orgId: string, repoId: string): Promise<TokenUsageSummary>

  // Phase 5: Incremental Indexing
  /** Create edges for a specific entity (used during incremental reindex) */
  createEdgesForEntity(orgId: string, entityKey: string, edges: EdgeDoc[]): Promise<void>
  /** Get edges connected to specified entity keys */
  getEdgesForEntities(orgId: string, entityKeys: string[]): Promise<EdgeDoc[]>
  /** Batch delete entities by their keys */
  batchDeleteEntities(orgId: string, entityKeys: string[]): Promise<void>
  /** Batch delete edges that reference specified entity keys */
  batchDeleteEdgesByEntity(orgId: string, entityKeys: string[]): Promise<void>
  /** Find edges that reference deleted entity keys (broken edges) */
  findBrokenEdges(orgId: string, repoId: string, deletedKeys: string[]): Promise<EdgeDoc[]>

  // Phase 5: Index events
  /** Insert an index event record */
  insertIndexEvent(orgId: string, event: IndexEventDoc): Promise<void>
  /** Get index events for a repo (newest first) */
  getIndexEvents(orgId: string, repoId: string, limit?: number): Promise<IndexEventDoc[]>
  /** Get the latest index event for a repo */
  getLatestIndexEvent(orgId: string, repoId: string): Promise<IndexEventDoc | null>

  // Phase 5.5: Prompt Ledger
  /** Append a new ledger entry */
  appendLedgerEntry(orgId: string, entry: LedgerEntry): Promise<void>
  /** Update the status of a ledger entry */
  updateLedgerEntryStatus(orgId: string, entryId: string, status: LedgerEntryStatus): Promise<void>
  /** Query ledger entries with cursor-based pagination */
  queryLedgerTimeline(query: LedgerTimelineQuery): Promise<PaginatedResult<LedgerEntry>>
  /** Get uncommitted ledger entries for a branch */
  getUncommittedEntries(orgId: string, repoId: string, branch: string): Promise<LedgerEntry[]>
  /** Get the maximum timeline_branch number for a repo+branch */
  getMaxTimelineBranch(orgId: string, repoId: string, branch: string): Promise<number>
  /** Mark entries as reverted (atomic batch update) */
  markEntriesReverted(orgId: string, entryIds: string[]): Promise<void>
  /** Append a ledger summary (commit roll-up) */
  appendLedgerSummary(orgId: string, summary: LedgerSummary): Promise<void>
  /** Query ledger summaries for a repo */
  queryLedgerSummaries(orgId: string, repoId: string, branch?: string, limit?: number): Promise<LedgerSummary[]>
  /** Get a single ledger entry by ID */
  getLedgerEntry(orgId: string, entryId: string): Promise<LedgerEntry | null>
  /** Append a working snapshot */
  appendWorkingSnapshot(orgId: string, snapshot: WorkingSnapshot): Promise<void>
  /** Get the latest working snapshot for a branch */
  getLatestWorkingSnapshot(orgId: string, repoId: string, branch: string): Promise<WorkingSnapshot | null>

  // Scale: Bounded Context Analysis
  /** Find cross-feature mutations that indicate bounded context bleed */
  findCrossFeatureMutations(orgId: string, repoId: string): Promise<BoundedContextFinding[]>

  // Entity browsing with joined justifications
  /** Get paginated entities with their current justifications */
  getEntitiesWithJustifications(orgId: string, repoId: string, opts?: {
    kind?: string; taxonomy?: string; featureTag?: string;
    search?: string; offset?: number; limit?: number;
  }): Promise<{ entities: Array<EntityDoc & { justification?: JustificationDoc }>; total: number }>

  // Shadow reindexing
  /** Delete all entities and edges for a specific index_version */
  deleteByIndexVersion(orgId: string, repoId: string, indexVersion: string): Promise<void>
}
