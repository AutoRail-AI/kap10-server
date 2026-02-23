/**
 * In-memory fakes for all 11 ports (testing).
 * Phase 2: Extended with searchEntities, getImports, getProjectStats,
 *           workspace overlay, API key CRUD, workspace CRUD.
 */

import type { IBillingProvider } from "@/lib/ports/billing-provider"
import type { ICacheStore } from "@/lib/ports/cache-store"
import type { Definition, ICodeIntelligence, Reference } from "@/lib/ports/code-intelligence"
import type { FileEntry, GitHubRepo, IGitHost, PullRequest } from "@/lib/ports/git-host"
import type { IGraphStore } from "@/lib/ports/graph-store"
import type { ILLMProvider } from "@/lib/ports/llm-provider"
import type { CostBreakdown, IObservability, ModelUsageEntry } from "@/lib/ports/observability"
import type { IPatternEngine, PatternMatch } from "@/lib/ports/pattern-engine"
import type { ApiKeyRecord, DeletionLogRecord, GitHubInstallationRecord, IRelationalStore, RepoRecord, WorkspaceRecord } from "@/lib/ports/relational-store"
import type { IStorageProvider } from "@/lib/ports/storage-provider"
import type { ADRDoc, BlueprintData, DomainOntologyDoc, DriftScoreDoc, EdgeDoc, EntityDoc, FeatureAggregation, FeatureDoc, HealthReportDoc, ImpactReportDoc, ImpactResult, ImportChain, IndexEventDoc, JustificationDoc, LedgerEntry, LedgerEntryStatus, LedgerSummary, LedgerTimelineQuery, MinedPatternDoc, PaginatedResult, PatternDoc, PrReviewCommentRecord, PrReviewRecord, ProjectStats, ReviewConfig, RuleDoc, RuleExceptionDoc, RuleHealthDoc, SearchResult, SnippetDoc, SubgraphResult, TokenUsageEntry, TokenUsageSummary, WorkingSnapshot } from "@/lib/ports/types"
import { DEFAULT_REVIEW_CONFIG, validateLedgerTransition } from "@/lib/ports/types"
import type { IVectorSearch } from "@/lib/ports/vector-search"
import type { IWorkflowEngine } from "@/lib/ports/workflow-engine"

export class InMemoryGraphStore implements IGraphStore {
  private entities = new Map<string, EntityDoc>()
  private edges: Array<{ _from: string; _to: string; kind: string; org_id: string; repo_id: string }> = []
  private workspaceEntities = new Map<string, EntityDoc>()
  private justifications = new Map<string, JustificationDoc>()
  private featureAggregations = new Map<string, FeatureAggregation>()
  private healthReports = new Map<string, HealthReportDoc>()
  private domainOntologies = new Map<string, DomainOntologyDoc>()
  private driftScores = new Map<string, DriftScoreDoc>()
  private adrs = new Map<string, ADRDoc>()
  private tokenUsageLog = new Map<string, TokenUsageEntry>()

  async bootstrapGraphSchema(): Promise<void> {}
  async healthCheck(): Promise<{ status: "up" | "down"; latencyMs?: number }> {
    return { status: "up", latencyMs: 0 }
  }
  async upsertEntity(_orgId: string, entity: EntityDoc): Promise<void> {
    this.entities.set(entity.id, entity)
  }
  async getEntity(orgId: string, entityId: string): Promise<EntityDoc | null> {
    const e = this.entities.get(entityId)
    if (e && e.org_id === orgId) return e
    return null
  }
  async deleteEntity(_orgId: string, entityId: string): Promise<void> {
    this.entities.delete(entityId)
  }
  async upsertEdge(_orgId: string, edge: { _from: string; _to: string; kind: string; org_id: string; repo_id: string }): Promise<void> {
    this.edges.push(edge)
  }
  async getCallersOf(orgId: string, entityId: string): Promise<EntityDoc[]> {
    return this.edges
      .filter((e) => e._to.endsWith(`/${entityId}`) && e.org_id === orgId && e.kind === "calls")
      .map((e) => {
        const fromId = e._from.split("/").pop()!
        return this.entities.get(fromId)
      })
      .filter((e): e is EntityDoc => e != null)
  }
  async getCalleesOf(orgId: string, entityId: string): Promise<EntityDoc[]> {
    return this.edges
      .filter((e) => e._from.endsWith(`/${entityId}`) && e.org_id === orgId && e.kind === "calls")
      .map((e) => {
        const toId = e._to.split("/").pop()!
        return this.entities.get(toId)
      })
      .filter((e): e is EntityDoc => e != null)
  }
  async impactAnalysis(_orgId: string, entityId: string): Promise<ImpactResult> {
    return { entityId, affected: [] }
  }
  async getEntitiesByFile(orgId: string, repoId: string, filePath: string): Promise<EntityDoc[]> {
    return Array.from(this.entities.values())
      .filter((e) => e.org_id === orgId && e.repo_id === repoId && e.file_path === filePath)
      .sort((a, b) => (Number(a.start_line) || 0) - (Number(b.start_line) || 0))
  }
  private rules = new Map<string, RuleDoc>()
  private patterns = new Map<string, PatternDoc>()
  private ruleHealth = new Map<string, RuleHealthDoc>()
  private minedPatterns = new Map<string, MinedPatternDoc>()
  private impactReports = new Map<string, ImpactReportDoc>()
  private ruleExceptions = new Map<string, RuleExceptionDoc>()

  async upsertRule(_orgId: string, rule: RuleDoc): Promise<void> {
    this.rules.set(rule.id, rule)
  }
  async queryRules(orgId: string, filter: { repoId?: string; status?: string; scope?: string; limit?: number }): Promise<RuleDoc[]> {
    let results = Array.from(this.rules.values()).filter((r) => r.org_id === orgId)
    if (filter.repoId) results = results.filter((r) => !r.repo_id || r.repo_id === filter.repoId)
    if (filter.status) results = results.filter((r) => r.status === filter.status)
    if (filter.scope) results = results.filter((r) => r.scope === filter.scope)
    results.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    return results.slice(0, filter.limit ?? 50)
  }
  async deleteRule(orgId: string, ruleId: string): Promise<void> {
    const rule = this.rules.get(ruleId)
    if (rule && rule.org_id === orgId) this.rules.delete(ruleId)
  }
  async archiveRule(orgId: string, ruleId: string): Promise<void> {
    const rule = this.rules.get(ruleId)
    if (rule && rule.org_id === orgId) rule.status = "archived"
  }
  async upsertPattern(_orgId: string, pattern: PatternDoc): Promise<void> {
    this.patterns.set(pattern.id, pattern)
  }
  async queryPatterns(orgId: string, filter: { repoId?: string; status?: string; minConfidence?: number; limit?: number }): Promise<PatternDoc[]> {
    let results = Array.from(this.patterns.values()).filter((p) => p.org_id === orgId)
    if (filter.repoId) results = results.filter((p) => p.repo_id === filter.repoId)
    if (filter.status) results = results.filter((p) => p.status === filter.status)
    if (filter.minConfidence !== undefined) results = results.filter((p) => p.confidence >= filter.minConfidence!)
    results.sort((a, b) => b.confidence - a.confidence)
    return results.slice(0, filter.limit ?? 50)
  }
  async updatePatternStatus(orgId: string, patternId: string, status: string): Promise<void> {
    const p = this.patterns.get(patternId)
    if (p && p.org_id === orgId) (p as unknown as Record<string, unknown>).status = status
  }
  async getPatternByHash(orgId: string, repoId: string, hash: string): Promise<PatternDoc | null> {
    return Array.from(this.patterns.values()).find((p) => p.org_id === orgId && p.repo_id === repoId && p.id === hash) ?? null
  }
  async getRuleHealth(orgId: string, ruleId: string): Promise<RuleHealthDoc | null> {
    return Array.from(this.ruleHealth.values()).find((h) => h.org_id === orgId && h.rule_id === ruleId) ?? null
  }
  async upsertRuleHealth(_orgId: string, health: RuleHealthDoc): Promise<void> {
    this.ruleHealth.set(health.id, health)
  }
  async upsertMinedPattern(_orgId: string, pattern: MinedPatternDoc): Promise<void> {
    this.minedPatterns.set(pattern.id, pattern)
  }
  async queryMinedPatterns(orgId: string, repoId: string): Promise<MinedPatternDoc[]> {
    return Array.from(this.minedPatterns.values())
      .filter((p) => p.org_id === orgId && p.repo_id === repoId)
      .sort((a, b) => b.confidence - a.confidence)
  }
  async upsertImpactReport(_orgId: string, report: ImpactReportDoc): Promise<void> {
    this.impactReports.set(report.id, report)
  }
  async getImpactReport(orgId: string, ruleId: string): Promise<ImpactReportDoc | null> {
    return Array.from(this.impactReports.values())
      .filter((r) => r.org_id === orgId && r.rule_id === ruleId)
      .sort((a, b) => b.generated_at.localeCompare(a.generated_at))[0] ?? null
  }
  async queryRuleExceptions(orgId: string, ruleId: string): Promise<RuleExceptionDoc[]> {
    return Array.from(this.ruleExceptions.values())
      .filter((e) => e.org_id === orgId && e.rule_id === ruleId && e.status === "active")
  }
  async upsertRuleException(_orgId: string, exception: RuleExceptionDoc): Promise<void> {
    this.ruleExceptions.set(exception.id, exception)
  }
  async updateRuleException(orgId: string, exceptionId: string, status: string): Promise<void> {
    const e = this.ruleExceptions.get(exceptionId)
    if (e && e.org_id === orgId) (e as unknown as Record<string, unknown>).status = status
  }
  async upsertSnippet(): Promise<void> {}
  async querySnippets(): Promise<SnippetDoc[]> {
    return []
  }
  async getFeatures(): Promise<FeatureDoc[]> {
    return []
  }
  async getBlueprint(): Promise<BlueprintData> {
    return { features: [] }
  }
  async bulkUpsertEntities(_orgId: string, entities: EntityDoc[]): Promise<void> {
    for (const e of entities) {
      this.entities.set(e.id, e)
    }
  }
  async bulkUpsertEdges(_orgId: string, edges: Array<{ _from: string; _to: string; kind: string; org_id: string; repo_id: string }>): Promise<void> {
    this.edges.push(...edges)
  }
  async getFilePaths(orgId: string, repoId: string): Promise<{ path: string }[]> {
    const paths = new Set<string>()
    Array.from(this.entities.values()).forEach((e) => {
      if (e.org_id === orgId && e.repo_id === repoId && e.file_path) {
        paths.add(e.file_path)
      }
    })
    return Array.from(paths).sort().map((p) => ({ path: p }))
  }
  async deleteRepoData(orgId: string, repoId: string): Promise<void> {
    Array.from(this.entities.entries()).forEach(([k, e]) => {
      if (e.org_id === orgId && e.repo_id === repoId) this.entities.delete(k)
    })
    this.edges = this.edges.filter((e) => !(e.org_id === orgId && e.repo_id === repoId))
  }

  // Phase 2 methods
  async searchEntities(orgId: string, repoId: string, query: string, limit = 20): Promise<SearchResult[]> {
    const q = query.toLowerCase()
    const results: SearchResult[] = []
    for (const e of Array.from(this.entities.values())) {
      if (e.org_id === orgId && e.repo_id === repoId) {
        const name = (e.name ?? "").toLowerCase()
        const sig = ((e.signature as string) ?? "").toLowerCase()
        if (name.includes(q) || sig.includes(q)) {
          results.push({
            name: e.name,
            kind: e.kind,
            file_path: e.file_path,
            line: Number(e.start_line) || 0,
            signature: e.signature as string | undefined,
            score: q.length / Math.max(name.length, 1),
          })
        }
      }
    }
    results.sort((a, b) => b.score - a.score)
    return results.slice(0, limit)
  }

  async getImports(orgId: string, repoId: string, filePath: string, _depth = 1): Promise<ImportChain[]> {
    // Find import edges from this file
    const fileEntities = Array.from(this.entities.values())
      .filter((e) => e.org_id === orgId && e.repo_id === repoId && e.file_path === filePath && e.kind === "file")
    if (fileEntities.length === 0) return []

    const importEdges = this.edges.filter(
      (e) => e.kind === "imports" && e.org_id === orgId && e.repo_id === repoId
    )

    const results: ImportChain[] = []
    for (const edge of importEdges) {
      const fromId = edge._from.split("/").pop()
      const entity = fromId ? this.entities.get(fromId) : undefined
      if (entity?.file_path === filePath) {
        const toId = edge._to.split("/").pop()
        const targetEntity = toId ? this.entities.get(toId) : undefined
        if (targetEntity) {
          const entitiesInFile = Array.from(this.entities.values())
            .filter((e) => e.org_id === orgId && e.repo_id === repoId && e.file_path === targetEntity.file_path)
          results.push({
            path: targetEntity.file_path,
            entities: entitiesInFile,
            distance: 1,
          })
        }
      }
    }
    return results
  }

  async getProjectStats(orgId: string, repoId: string): Promise<ProjectStats> {
    const entities = Array.from(this.entities.values())
      .filter((e) => e.org_id === orgId && e.repo_id === repoId)

    const files = new Set<string>()
    let functions = 0, classes = 0, interfaces = 0, variables = 0
    const languages: Record<string, number> = {}

    for (const e of entities) {
      switch (e.kind) {
        case "file": files.add(e.file_path); break
        case "function": case "method": functions++; break
        case "class": case "struct": classes++; break
        case "interface": interfaces++; break
        case "variable": case "type": case "enum": variables++; break
      }
      if (e.kind === "file" && e.language) {
        const lang = e.language as string
        languages[lang] = (languages[lang] ?? 0) + 1
      }
    }

    return { files: files.size, functions, classes, interfaces, variables, languages }
  }

  async upsertWorkspaceEntity(_orgId: string, workspaceId: string, entity: EntityDoc): Promise<void> {
    this.workspaceEntities.set(`ws:${workspaceId}:${entity.id}`, entity)
  }

  async getEntityWithOverlay(orgId: string, entityId: string, workspaceId?: string): Promise<EntityDoc | null> {
    if (workspaceId) {
      const overlay = this.workspaceEntities.get(`ws:${workspaceId}:${entityId}`)
      if (overlay) return overlay
    }
    return this.getEntity(orgId, entityId)
  }

  async cleanupExpiredWorkspaces(workspaceId: string): Promise<void> {
    const prefix = `ws:${workspaceId}:`
    Array.from(this.workspaceEntities.keys()).forEach((key) => {
      if (key.startsWith(prefix)) {
        this.workspaceEntities.delete(key)
      }
    })
  }

  // Phase 4 methods
  async bulkUpsertJustifications(_orgId: string, justifications: JustificationDoc[]): Promise<void> {
    for (const j of justifications) {
      // Bi-temporal: close old justifications for same entity
      for (const [key, existing] of Array.from(this.justifications.entries())) {
        if (existing.entity_id === j.entity_id && existing.valid_to === null && existing.id !== j.id) {
          this.justifications.set(key, { ...existing, valid_to: new Date().toISOString() })
        }
      }
      this.justifications.set(j.id, j)
    }
  }
  async getJustification(orgId: string, entityId: string): Promise<JustificationDoc | null> {
    for (const j of Array.from(this.justifications.values())) {
      if (j.org_id === orgId && j.entity_id === entityId && j.valid_to === null) return j
    }
    return null
  }
  async getJustifications(orgId: string, repoId: string): Promise<JustificationDoc[]> {
    return Array.from(this.justifications.values())
      .filter((j) => j.org_id === orgId && j.repo_id === repoId && j.valid_to === null)
  }
  async getJustificationHistory(orgId: string, entityId: string): Promise<JustificationDoc[]> {
    return Array.from(this.justifications.values())
      .filter((j) => j.org_id === orgId && j.entity_id === entityId)
      .sort((a, b) => b.valid_from.localeCompare(a.valid_from))
  }
  async bulkUpsertFeatureAggregations(_orgId: string, features: FeatureAggregation[]): Promise<void> {
    for (const f of features) this.featureAggregations.set(f.id, f)
  }
  async getFeatureAggregations(orgId: string, repoId: string): Promise<FeatureAggregation[]> {
    return Array.from(this.featureAggregations.values())
      .filter((f) => f.org_id === orgId && f.repo_id === repoId)
  }
  async upsertHealthReport(_orgId: string, report: HealthReportDoc): Promise<void> {
    this.healthReports.set(report.id, report)
  }
  async getHealthReport(orgId: string, repoId: string): Promise<HealthReportDoc | null> {
    const reports = Array.from(this.healthReports.values())
      .filter((r) => r.org_id === orgId && r.repo_id === repoId)
      .sort((a, b) => b.generated_at.localeCompare(a.generated_at))
    return reports[0] ?? null
  }
  async upsertDomainOntology(_orgId: string, ontology: DomainOntologyDoc): Promise<void> {
    this.domainOntologies.set(ontology.id, ontology)
  }
  async getDomainOntology(orgId: string, repoId: string): Promise<DomainOntologyDoc | null> {
    const onts = Array.from(this.domainOntologies.values())
      .filter((o) => o.org_id === orgId && o.repo_id === repoId)
      .sort((a, b) => b.generated_at.localeCompare(a.generated_at))
    return onts[0] ?? null
  }
  async bulkUpsertDriftScores(_orgId: string, scores: DriftScoreDoc[]): Promise<void> {
    for (const s of scores) this.driftScores.set(s.id, s)
  }
  async getDriftScores(orgId: string, repoId: string): Promise<DriftScoreDoc[]> {
    return Array.from(this.driftScores.values())
      .filter((s) => s.org_id === orgId && s.repo_id === repoId)
  }
  async bulkUpsertADRs(_orgId: string, adrs: ADRDoc[]): Promise<void> {
    for (const a of adrs) this.adrs.set(a.id, a)
  }
  async getADRs(orgId: string, repoId: string): Promise<ADRDoc[]> {
    return Array.from(this.adrs.values())
      .filter((a) => a.org_id === orgId && a.repo_id === repoId)
  }
  async getSubgraph(orgId: string, entityId: string, depth = 2, opts?: { crossRepo?: boolean }): Promise<SubgraphResult> {
    const entity = this.entities.get(entityId)
    if (!entity || entity.org_id !== orgId) return { entities: [], edges: [] }
    const visited = new Set<string>([entityId])
    const resultEntities: EntityDoc[] = [entity]
    const resultEdges: Array<{ _from: string; _to: string; kind: string; org_id: string; repo_id: string }> = []
    let frontier = [entityId]
    for (let d = 0; d < depth; d++) {
      const nextFrontier: string[] = []
      for (const fId of frontier) {
        for (const edge of this.edges) {
          if (edge.org_id !== orgId) continue
          if (!opts?.crossRepo && entity.repo_id && edge.repo_id !== entity.repo_id) continue
          const fromId = edge._from.split("/").pop()!
          const toId = edge._to.split("/").pop()!
          let neighbor: string | null = null
          if (fromId === fId) neighbor = toId
          else if (toId === fId) neighbor = fromId
          if (neighbor && !visited.has(neighbor)) {
            visited.add(neighbor)
            const ne = this.entities.get(neighbor)
            if (ne && ne.org_id === orgId) {
              resultEntities.push(ne)
              nextFrontier.push(neighbor)
            }
            resultEdges.push(edge)
          }
        }
      }
      frontier = nextFrontier
    }
    return { entities: resultEntities, edges: resultEdges as unknown as import("@/lib/ports/types").EdgeDoc[] }
  }
  async getBatchSubgraphs(orgId: string, entityIds: string[], depth = 2): Promise<Map<string, SubgraphResult>> {
    const result = new Map<string, SubgraphResult>()
    for (const eid of entityIds) {
      result.set(eid, await this.getSubgraph(orgId, eid, depth))
    }
    return result
  }
  async getAllEntities(orgId: string, repoId: string): Promise<EntityDoc[]> {
    return Array.from(this.entities.values())
      .filter((e) => e.org_id === orgId && e.repo_id === repoId)
  }
  async getAllEdges(orgId: string, repoId: string): Promise<import("@/lib/ports/types").EdgeDoc[]> {
    return this.edges
      .filter((e) => e.org_id === orgId && e.repo_id === repoId) as unknown as import("@/lib/ports/types").EdgeDoc[]
  }
  async logTokenUsage(_orgId: string, entry: TokenUsageEntry): Promise<void> {
    this.tokenUsageLog.set(entry.id, entry)
  }
  async getTokenUsage(orgId: string, repoId: string): Promise<TokenUsageEntry[]> {
    return Array.from(this.tokenUsageLog.values())
      .filter((e) => e.org_id === orgId && e.repo_id === repoId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  }
  async getTokenUsageSummary(orgId: string, repoId: string): Promise<TokenUsageSummary> {
    const entries = await this.getTokenUsage(orgId, repoId)
    const byModel: Record<string, { input_tokens: number; output_tokens: number; cost_usd: number }> = {}
    let totalInput = 0, totalOutput = 0
    for (const e of entries) {
      totalInput += e.input_tokens
      totalOutput += e.output_tokens
      const m = byModel[e.model] ?? { input_tokens: 0, output_tokens: 0, cost_usd: 0 }
      m.input_tokens += e.input_tokens
      m.output_tokens += e.output_tokens
      byModel[e.model] = m
    }
    return { total_input_tokens: totalInput, total_output_tokens: totalOutput, estimated_cost_usd: 0, by_model: byModel }
  }

  // Phase 5: Incremental Indexing
  private indexEvents: IndexEventDoc[] = []

  async createEdgesForEntity(orgId: string, entityKey: string, edges: EdgeDoc[]): Promise<void> {
    // Filter out existing edges for this entity key
    this.edges = this.edges.filter((e) => {
      if (e.org_id !== orgId) return true
      const fromKey = e._from.split("/").pop()!
      const toKey = e._to.split("/").pop()!
      return fromKey !== entityKey && toKey !== entityKey
    })
    // Push new edges
    for (const edge of edges) {
      this.edges.push({
        _from: edge._from,
        _to: edge._to,
        kind: edge.kind,
        org_id: edge.org_id ?? orgId,
        repo_id: edge.repo_id ?? "",
      })
    }
  }

  async getEdgesForEntities(orgId: string, entityKeys: string[]): Promise<EdgeDoc[]> {
    const keySet = new Set(entityKeys)
    return this.edges
      .filter((e) => {
        if (e.org_id !== orgId) return false
        const fromKey = e._from.split("/").pop()!
        const toKey = e._to.split("/").pop()!
        return keySet.has(fromKey) || keySet.has(toKey)
      }) as unknown as EdgeDoc[]
  }

  async batchDeleteEntities(orgId: string, entityKeys: string[]): Promise<void> {
    for (const key of entityKeys) {
      const entity = this.entities.get(key)
      if (entity && entity.org_id === orgId) {
        this.entities.delete(key)
      }
    }
  }

  async batchDeleteEdgesByEntity(orgId: string, entityKeys: string[]): Promise<void> {
    const keySet = new Set(entityKeys)
    this.edges = this.edges.filter((e) => {
      if (e.org_id !== orgId) return true
      const fromKey = e._from.split("/").pop()!
      const toKey = e._to.split("/").pop()!
      return !keySet.has(fromKey) && !keySet.has(toKey)
    })
  }

  async findBrokenEdges(orgId: string, repoId: string, deletedKeys: string[]): Promise<EdgeDoc[]> {
    const keySet = new Set(deletedKeys)
    return this.edges
      .filter((e) => {
        if (e.org_id !== orgId || e.repo_id !== repoId) return false
        const fromKey = e._from.split("/").pop()!
        const toKey = e._to.split("/").pop()!
        return keySet.has(fromKey) || keySet.has(toKey)
      }) as unknown as EdgeDoc[]
  }

  async insertIndexEvent(_orgId: string, event: IndexEventDoc): Promise<void> {
    this.indexEvents.push({ ...event, created_at: event.created_at || new Date().toISOString() })
  }

  async getIndexEvents(orgId: string, repoId: string, limit = 50): Promise<IndexEventDoc[]> {
    return this.indexEvents
      .filter((e) => e.org_id === orgId && e.repo_id === repoId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit)
  }

  async getLatestIndexEvent(orgId: string, repoId: string): Promise<IndexEventDoc | null> {
    const events = await this.getIndexEvents(orgId, repoId, 1)
    return events[0] ?? null
  }

  // Phase 5.5: Ledger methods
  private ledgerEntries: LedgerEntry[] = []
  private ledgerSummaries: LedgerSummary[] = []
  private workingSnapshots: WorkingSnapshot[] = []

  async appendLedgerEntry(_orgId: string, entry: LedgerEntry): Promise<void> {
    this.ledgerEntries.push({ ...entry })
  }

  async updateLedgerEntryStatus(orgId: string, entryId: string, status: LedgerEntryStatus): Promise<void> {
    const entry = this.ledgerEntries.find((e) => e.id === entryId && e.org_id === orgId)
    if (!entry) throw new Error(`Ledger entry ${entryId} not found`)
    if (!validateLedgerTransition(entry.status, status)) {
      throw new Error(`Invalid ledger transition: ${entry.status} → ${status}`)
    }
    entry.status = status
    if (status === "working") entry.validated_at = new Date().toISOString()
  }

  async queryLedgerTimeline(query: LedgerTimelineQuery): Promise<PaginatedResult<LedgerEntry>> {
    let filtered = this.ledgerEntries.filter(
      (e) => e.org_id === query.orgId && e.repo_id === query.repoId
    )
    if (query.branch) filtered = filtered.filter((e) => e.branch === query.branch)
    if (query.timelineBranch !== undefined) filtered = filtered.filter((e) => e.timeline_branch === query.timelineBranch)
    if (query.status) filtered = filtered.filter((e) => e.status === query.status)
    if (query.userId) filtered = filtered.filter((e) => e.user_id === query.userId)

    filtered.sort((a, b) => b.created_at.localeCompare(a.created_at))

    const cursorIndex = query.cursor
      ? filtered.findIndex((e) => e.id === query.cursor) + 1
      : 0
    const limit = query.limit ?? 50
    const items = filtered.slice(cursorIndex, cursorIndex + limit)
    const hasMore = cursorIndex + limit < filtered.length
    const cursor = items.length > 0 ? items[items.length - 1]!.id : null

    return { items, cursor, hasMore }
  }

  async getUncommittedEntries(orgId: string, repoId: string, branch: string): Promise<LedgerEntry[]> {
    return this.ledgerEntries
      .filter((e) => e.org_id === orgId && e.repo_id === repoId && e.branch === branch
        && e.status !== "committed" && e.status !== "reverted")
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
  }

  async getMaxTimelineBranch(orgId: string, repoId: string, branch: string): Promise<number> {
    const entries = this.ledgerEntries.filter(
      (e) => e.org_id === orgId && e.repo_id === repoId && e.branch === branch
    )
    if (entries.length === 0) return 0
    return Math.max(...entries.map((e) => e.timeline_branch))
  }

  async markEntriesReverted(orgId: string, entryIds: string[]): Promise<void> {
    const idSet = new Set(entryIds)
    for (const entry of this.ledgerEntries) {
      if (entry.org_id === orgId && idSet.has(entry.id)) {
        entry.status = "reverted"
      }
    }
  }

  async appendLedgerSummary(_orgId: string, summary: LedgerSummary): Promise<void> {
    this.ledgerSummaries.push({ ...summary })
  }

  async queryLedgerSummaries(orgId: string, repoId: string, branch?: string, limit = 50): Promise<LedgerSummary[]> {
    let filtered = this.ledgerSummaries.filter(
      (s) => s.org_id === orgId && s.repo_id === repoId
    )
    if (branch) filtered = filtered.filter((s) => s.branch === branch)
    filtered.sort((a, b) => b.created_at.localeCompare(a.created_at))
    return filtered.slice(0, limit)
  }

  async getLedgerEntry(orgId: string, entryId: string): Promise<LedgerEntry | null> {
    return this.ledgerEntries.find((e) => e.org_id === orgId && e.id === entryId) ?? null
  }

  async appendWorkingSnapshot(_orgId: string, snapshot: WorkingSnapshot): Promise<void> {
    this.workingSnapshots.push({ ...snapshot })
  }

  async getLatestWorkingSnapshot(orgId: string, repoId: string, branch: string): Promise<WorkingSnapshot | null> {
    const snapshots = this.workingSnapshots
      .filter((s) => s.org_id === orgId && s.repo_id === repoId && s.branch === branch)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
    return snapshots[0] ?? null
  }
}

export class InMemoryRelationalStore implements IRelationalStore {
  private repos: RepoRecord[] = []
  private deletionLogs: DeletionLogRecord[] = []
  private installations: GitHubInstallationRecord[] = []
  private apiKeys: ApiKeyRecord[] = []
  private workspaces: WorkspaceRecord[] = []

  async healthCheck(): Promise<{ status: "up" | "down"; latencyMs?: number }> {
    return { status: "up", latencyMs: 0 }
  }
  async getRepos(orgId: string): Promise<RepoRecord[]> {
    return this.repos.filter((r) => r.organizationId === orgId)
  }
  async getRepo(orgId: string, repoId: string): Promise<RepoRecord | null> {
    return this.repos.find((r) => r.organizationId === orgId && r.id === repoId) ?? null
  }
  async createRepo(data: {
    organizationId: string
    name: string
    fullName: string
    provider: string
    providerId: string
    status?: string
    defaultBranch?: string
    githubRepoId?: number
    githubFullName?: string
  }): Promise<RepoRecord> {
    const rec: RepoRecord = {
      id: `repo-${Date.now()}`,
      organizationId: data.organizationId,
      name: data.name,
      fullName: data.fullName,
      provider: data.provider,
      providerId: data.providerId,
      status: data.status ?? "pending",
      defaultBranch: data.defaultBranch ?? "main",
      lastIndexedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      githubRepoId: data.githubRepoId ?? null,
      githubFullName: data.githubFullName ?? undefined,
    }
    this.repos.push(rec)
    return rec
  }
  async getDeletionLogs(orgId: string, limit = 50): Promise<DeletionLogRecord[]> {
    return this.deletionLogs.filter((l) => l.organizationId === orgId).slice(0, limit)
  }
  async getInstallation(orgId: string): Promise<GitHubInstallationRecord | null> {
    return this.installations.find((i) => i.organizationId === orgId) ?? null
  }
  async getInstallations(orgId: string): Promise<GitHubInstallationRecord[]> {
    return this.installations.filter((i) => i.organizationId === orgId)
  }
  async getInstallationByInstallationId(installationId: number): Promise<GitHubInstallationRecord | null> {
    return this.installations.find((i) => i.installationId === installationId) ?? null
  }
  async createInstallation(data: {
    organizationId: string
    installationId: number
    accountLogin: string
    accountType: string
    permissions?: unknown
  }): Promise<GitHubInstallationRecord> {
    const rec: GitHubInstallationRecord = {
      id: `inst-${Date.now()}`,
      organizationId: data.organizationId,
      installationId: data.installationId,
      accountLogin: data.accountLogin,
      accountType: data.accountType,
      permissions: data.permissions ?? null,
      suspendedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.installations.push(rec)
    return rec
  }
  async deleteInstallation(orgId: string): Promise<void> {
    this.installations = this.installations.filter((i) => i.organizationId !== orgId)
  }
  async deleteInstallationById(installationRecordId: string): Promise<void> {
    this.installations = this.installations.filter((i) => i.id !== installationRecordId)
  }
  async updateRepoStatus(
    repoId: string,
    data: {
      status: string
      progress?: number
      workflowId?: string | null
      fileCount?: number
      functionCount?: number
      classCount?: number
      errorMessage?: string | null
      lastIndexedSha?: string | null
    }
  ): Promise<void> {
    const r = this.repos.find((x) => x.id === repoId)
    if (!r) return
    if (data.status) r.status = data.status
    if (data.progress !== undefined) r.indexProgress = data.progress
    if (data.workflowId !== undefined) r.workflowId = data.workflowId
    if (data.fileCount !== undefined) r.fileCount = data.fileCount
    if (data.functionCount !== undefined) r.functionCount = data.functionCount
    if (data.classCount !== undefined) r.classCount = data.classCount
    if (data.errorMessage !== undefined) r.errorMessage = data.errorMessage
    if (data.lastIndexedSha !== undefined) r.lastIndexedSha = data.lastIndexedSha
  }
  async getRepoByGithubId(orgId: string, githubRepoId: number): Promise<RepoRecord | null> {
    return this.repos.find((r) => r.organizationId === orgId && r.githubRepoId === githubRepoId) ?? null
  }
  async getReposByStatus(orgId: string, status: string): Promise<RepoRecord[]> {
    return this.repos.filter((r) => r.organizationId === orgId && r.status === status)
  }
  async deleteRepo(repoId: string): Promise<void> {
    this.repos = this.repos.filter((r) => r.id !== repoId)
  }

  async promoteRepo(repoId: string): Promise<void> {
    const repo = this.repos.find((r) => r.id === repoId)
    if (repo) {
      repo.ephemeral = false
      repo.ephemeralExpiresAt = null
    }
  }

  // Phase 2: API key methods
  async createApiKey(data: {
    organizationId: string
    repoId?: string | null
    name: string
    keyPrefix: string
    keyHash: string
    scopes: string[]
    isDefault?: boolean
  }): Promise<ApiKeyRecord> {
    const rec: ApiKeyRecord = {
      id: `key-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      organizationId: data.organizationId,
      repoId: data.repoId ?? null,
      name: data.name,
      keyPrefix: data.keyPrefix,
      keyHash: data.keyHash,
      scopes: data.scopes,
      isDefault: data.isDefault ?? false,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.apiKeys.push(rec)
    return rec
  }
  async getApiKeyByHash(keyHash: string): Promise<ApiKeyRecord | null> {
    return this.apiKeys.find((k) => k.keyHash === keyHash && !k.revokedAt) ?? null
  }
  async getDefaultApiKey(orgId: string): Promise<ApiKeyRecord | null> {
    return this.apiKeys.find((k) => k.organizationId === orgId && k.isDefault && !k.revokedAt) ?? null
  }
  async revokeApiKey(id: string): Promise<void> {
    const k = this.apiKeys.find((x) => x.id === id)
    if (k) k.revokedAt = new Date()
  }
  async listApiKeys(orgId: string, repoId?: string): Promise<ApiKeyRecord[]> {
    return this.apiKeys.filter((k) => k.organizationId === orgId && (!repoId || k.repoId === repoId))
  }
  async updateApiKeyLastUsed(id: string): Promise<void> {
    const k = this.apiKeys.find((x) => x.id === id)
    if (k) k.lastUsedAt = new Date()
  }

  // Phase 2: Workspace methods
  async createWorkspace(data: {
    userId: string
    repoId: string
    branch: string
    baseSha?: string
    expiresAt: Date
  }): Promise<WorkspaceRecord> {
    // Upsert by user+repo+branch
    const existing = this.workspaces.find(
      (w) => w.userId === data.userId && w.repoId === data.repoId && w.branch === data.branch
    )
    if (existing) {
      existing.baseSha = data.baseSha ?? existing.baseSha
      existing.expiresAt = data.expiresAt
      existing.lastSyncAt = new Date()
      return existing
    }
    const rec: WorkspaceRecord = {
      id: `ws-${Date.now()}`,
      userId: data.userId,
      repoId: data.repoId,
      branch: data.branch,
      baseSha: data.baseSha ?? null,
      lastSyncAt: new Date(),
      expiresAt: data.expiresAt,
      createdAt: new Date(),
    }
    this.workspaces.push(rec)
    return rec
  }
  async getWorkspace(userId: string, repoId: string, branch: string): Promise<WorkspaceRecord | null> {
    return this.workspaces.find(
      (w) => w.userId === userId && w.repoId === repoId && w.branch === branch
    ) ?? null
  }
  async updateWorkspaceSync(id: string, baseSha?: string): Promise<void> {
    const w = this.workspaces.find((x) => x.id === id)
    if (!w) return
    w.lastSyncAt = new Date()
    w.expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000)
    if (baseSha) w.baseSha = baseSha
  }
  async deleteExpiredWorkspaces(): Promise<WorkspaceRecord[]> {
    const now = new Date()
    const expired = this.workspaces.filter((w) => w.expiresAt < now)
    this.workspaces = this.workspaces.filter((w) => w.expiresAt >= now)
    return expired
  }

  // Phase 2: Repo onboarding
  async updateRepoOnboardingPr(repoId: string, prUrl: string, prNumber: number): Promise<void> {
    const r = this.repos.find((x) => x.id === repoId)
    if (r) {
      r.onboardingPrUrl = prUrl
      r.onboardingPrNumber = prNumber
    }
  }

  // Phase 7: PR Review CRUD
  private prReviews: PrReviewRecord[] = []
  private prReviewComments: PrReviewCommentRecord[] = []
  private reviewConfigs = new Map<string, ReviewConfig>()

  async createPrReview(data: {
    repoId: string; prNumber: number; prTitle: string; prUrl: string; headSha: string; baseSha: string
  }): Promise<PrReviewRecord> {
    const rec: PrReviewRecord = {
      id: `review-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      repoId: data.repoId,
      prNumber: data.prNumber,
      prTitle: data.prTitle,
      prUrl: data.prUrl,
      headSha: data.headSha,
      baseSha: data.baseSha,
      status: "pending",
      checksPassed: 0,
      checksWarned: 0,
      checksFailed: 0,
      reviewBody: null,
      githubReviewId: null,
      githubCheckRunId: null,
      autoApproved: false,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    }
    this.prReviews.push(rec)
    return rec
  }
  async updatePrReview(id: string, data: Partial<Pick<PrReviewRecord, "status" | "checksPassed" | "checksWarned" | "checksFailed" | "reviewBody" | "githubReviewId" | "githubCheckRunId" | "autoApproved" | "errorMessage" | "completedAt">>): Promise<void> {
    const r = this.prReviews.find((x) => x.id === id)
    if (!r) return
    Object.assign(r, data)
  }
  async getPrReview(id: string): Promise<PrReviewRecord | null> {
    return this.prReviews.find((r) => r.id === id) ?? null
  }
  async getPrReviewByPrAndSha(repoId: string, prNumber: number, headSha: string): Promise<PrReviewRecord | null> {
    return this.prReviews.find((r) => r.repoId === repoId && r.prNumber === prNumber && r.headSha === headSha) ?? null
  }
  async listPrReviews(repoId: string, opts?: { status?: string; limit?: number; cursor?: string }): Promise<{ items: PrReviewRecord[]; cursor: string | null; hasMore: boolean }> {
    let filtered = this.prReviews.filter((r) => r.repoId === repoId)
    if (opts?.status) filtered = filtered.filter((r) => r.status === opts.status)
    filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const cursorIdx = opts?.cursor ? filtered.findIndex((r) => r.id === opts.cursor) + 1 : 0
    const limit = opts?.limit ?? 20
    const items = filtered.slice(cursorIdx, cursorIdx + limit)
    const hasMore = cursorIdx + limit < filtered.length
    return { items, cursor: items.length > 0 ? items[items.length - 1]!.id : null, hasMore }
  }
  async createPrReviewComment(data: Omit<PrReviewCommentRecord, "id" | "createdAt">): Promise<PrReviewCommentRecord> {
    const rec: PrReviewCommentRecord = {
      ...data,
      id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date().toISOString(),
    }
    this.prReviewComments.push(rec)
    return rec
  }
  async listPrReviewComments(reviewId: string): Promise<PrReviewCommentRecord[]> {
    return this.prReviewComments.filter((c) => c.reviewId === reviewId)
  }
  async updateRepoReviewConfig(repoId: string, config: ReviewConfig): Promise<void> {
    this.reviewConfigs.set(repoId, config)
  }
  async getRepoReviewConfig(repoId: string): Promise<ReviewConfig> {
    return this.reviewConfigs.get(repoId) ?? { ...DEFAULT_REVIEW_CONFIG }
  }
}

export class MockLLMProvider implements ILLMProvider {
  async generateObject<T>(params: { schema: { parse: (v: unknown) => T } }): Promise<{ object: T; usage: { inputTokens: number; outputTokens: number } }> {
    return {
      object: params.schema.parse({}),
      usage: { inputTokens: 0, outputTokens: 0 },
    }
  }
  async *streamText(): AsyncIterable<string> {
    yield ""
  }
  async embed(): Promise<number[][]> {
    return []
  }
}

export class InlineWorkflowEngine implements IWorkflowEngine {
  async startWorkflow<T>(): Promise<{ workflowId: string; runId: string; result: () => Promise<T> }> {
    return {
      workflowId: "test",
      runId: "test-run",
      result: async () => undefined as T,
    }
  }
  async signalWorkflow(): Promise<void> {}
  async getWorkflowStatus(): Promise<{ workflowId: string; status: string }> {
    return { workflowId: "", status: "completed" }
  }
  async cancelWorkflow(): Promise<void> {}
  async healthCheck(): Promise<{ status: "up" | "down"; latencyMs?: number }> {
    return { status: "up", latencyMs: 0 }
  }
}

export class FakeGitHost implements IGitHost {
  async cloneRepo(): Promise<void> {}
  async getPullRequest(): Promise<PullRequest> {
    return { number: 0, title: "" }
  }
  async createPullRequest(): Promise<PullRequest> {
    return { number: 42, title: "Enable kap10 Code Intelligence" }
  }
  async getDiff(): Promise<string> {
    return ""
  }
  async listFiles(): Promise<FileEntry[]> {
    return []
  }
  async createWebhook(): Promise<void> {}
  async getInstallationRepos(): Promise<GitHubRepo[]> {
    return []
  }
  async getInstallationToken(): Promise<string> {
    return "fake-token"
  }
  async listBranches(): Promise<string[]> {
    return ["main", "develop"]
  }

  // Phase 5: Incremental indexing
  pullLatestResult: (() => Promise<void>) | null = null
  diffFilesResult: import("@/lib/ports/types").ChangedFile[] = []
  latestShaResult = "abc123"
  blameResult: string | null = "test-author"

  async pullLatest(): Promise<void> {
    if (this.pullLatestResult) return this.pullLatestResult()
  }
  async diffFiles(): Promise<import("@/lib/ports/types").ChangedFile[]> {
    return this.diffFilesResult
  }
  async getLatestSha(): Promise<string> {
    return this.latestShaResult
  }
  async blame(): Promise<string | null> {
    return this.blameResult
  }

  // Phase 7: PR Review
  postedReviews: Array<{ owner: string; repo: string; prNumber: number; review: unknown }> = []
  postedComments: Array<{ owner: string; repo: string; prNumber: number; comment: unknown }> = []
  checkRuns: Array<{ id: number; owner: string; repo: string; status: string; conclusion?: string; output?: unknown }> = []
  issueComments: Array<{ owner: string; repo: string; issueNumber: number; body: string }> = []
  branches: Array<{ owner: string; repo: string; name: string; fromSha: string }> = []
  files: Array<{ owner: string; repo: string; branch: string; path: string; content: string }> = []
  private nextCheckRunId = 1

  async postReview(owner: string, repo: string, prNumber: number, review: { event: string; body: string; comments?: unknown[] }): Promise<{ reviewId: number }> {
    this.postedReviews.push({ owner, repo, prNumber, review })
    return { reviewId: this.postedReviews.length }
  }
  async postReviewComment(owner: string, repo: string, prNumber: number, comment: { path: string; line: number; body: string; commitId: string }): Promise<{ commentId: number }> {
    this.postedComments.push({ owner, repo, prNumber, comment })
    return { commentId: this.postedComments.length }
  }
  async getPullRequestFiles(): Promise<Array<{ filename: string; status: string; additions: number; deletions: number; patch?: string }>> {
    return []
  }
  async createCheckRun(owner: string, repo: string, opts: { name: string; headSha: string; status: string }): Promise<{ checkRunId: number }> {
    const id = this.nextCheckRunId++
    this.checkRuns.push({ id, owner, repo, status: opts.status })
    return { checkRunId: id }
  }
  async updateCheckRun(owner: string, repo: string, checkRunId: number, opts: { status: string; conclusion: string; output?: unknown }): Promise<void> {
    const run = this.checkRuns.find((r) => r.id === checkRunId)
    if (run) {
      run.status = opts.status
      run.conclusion = opts.conclusion
      run.output = opts.output
    }
  }
  async postIssueComment(owner: string, repo: string, issueNumber: number, body: string): Promise<{ commentId: number }> {
    this.issueComments.push({ owner, repo, issueNumber, body })
    return { commentId: this.issueComments.length }
  }
  async createBranch(owner: string, repo: string, branchName: string, fromSha: string): Promise<void> {
    this.branches.push({ owner, repo, name: branchName, fromSha })
  }
  async createOrUpdateFile(owner: string, repo: string, branch: string, path: string, content: string): Promise<{ sha: string }> {
    this.files.push({ owner, repo, branch, path, content })
    return { sha: `fake-sha-${Date.now()}` }
  }
}

export class InMemoryVectorSearch implements IVectorSearch {
  private store = new Map<string, { embedding: number[]; metadata: Record<string, unknown> }>()

  /**
   * Deterministic pseudo-embedding: hash text → normalized 768-dim vector.
   * Produces consistent vectors for the same input (important for tests).
   */
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.pseudoEmbed(text))
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.pseudoEmbed(text)
  }

  async upsert(ids: string[], embeddings: number[][], metadata: Record<string, unknown>[]): Promise<void> {
    for (let i = 0; i < ids.length; i++) {
      this.store.set(ids[i]!, { embedding: embeddings[i]!, metadata: metadata[i]! })
    }
  }

  async search(
    embedding: number[],
    topK: number,
    filter?: { orgId?: string; repoId?: string }
  ): Promise<{ id: string; score: number; metadata?: Record<string, unknown> }[]> {
    const results: { id: string; score: number; metadata: Record<string, unknown> }[] = []

    this.store.forEach((value, key) => {
      // Apply tenant filters
      if (filter?.orgId && value.metadata.orgId !== filter.orgId) return
      if (filter?.repoId && value.metadata.repoId !== filter.repoId) return

      const score = this.cosineSimilarity(embedding, value.embedding)
      results.push({ id: key, score, metadata: value.metadata })
    })

    results.sort((a, b) => b.score - a.score)
    return results.slice(0, topK)
  }

  async getEmbedding(_repoId: string, entityKey: string): Promise<number[] | null> {
    const entry = this.store.get(entityKey)
    return entry?.embedding ?? null
  }

  async deleteOrphaned(repoId: string, currentEntityKeys: string[]): Promise<number> {
    const keySet = new Set(currentEntityKeys)
    let deleted = 0
    Array.from(this.store.entries()).forEach(([key, value]) => {
      if (value.metadata.repoId === repoId && !keySet.has(key)) {
        this.store.delete(key)
        deleted++
      }
    })
    return deleted
  }

  /** Generate a deterministic 768-dim pseudo-vector from text using simple hash. */
  private pseudoEmbed(text: string): number[] {
    const dims = 768
    const vec = new Array<number>(dims)
    let hash = 0
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
    }
    // Use hash as seed for deterministic pseudo-random vector
    for (let i = 0; i < dims; i++) {
      hash = ((hash << 5) - hash + i) | 0
      vec[i] = (hash & 0xffff) / 0xffff - 0.5
    }
    // Normalize
    let norm = 0
    for (let i = 0; i < dims; i++) {
      norm += vec[i]! * vec[i]!
    }
    norm = Math.sqrt(norm)
    if (norm > 0) {
      for (let i = 0; i < dims; i++) {
        vec[i] = vec[i]! / norm
      }
    }
    return vec
  }

  /** Cosine similarity between two vectors. */
  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, normA = 0, normB = 0
    for (let i = 0; i < a.length; i++) {
      dot += (a[i] ?? 0) * (b[i] ?? 0)
      normA += (a[i] ?? 0) * (a[i] ?? 0)
      normB += (b[i] ?? 0) * (b[i] ?? 0)
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB)
    return denom > 0 ? dot / denom : 0
  }
}

export class NoOpBillingProvider implements IBillingProvider {
  async createCheckoutSession(): Promise<{ url: string }> {
    return { url: "" }
  }
  async createSubscription(): Promise<never> {
    return {} as never
  }
  async cancelSubscription(): Promise<void> {}
  async reportUsage(): Promise<void> {}
  async createOnDemandCharge(): Promise<{ url: string }> {
    return { url: "" }
  }
}

export class InMemoryObservability implements IObservability {
  async getOrgLLMCost(): Promise<number> {
    return 0
  }
  async getCostBreakdown(): Promise<CostBreakdown> {
    return { byModel: {}, total: 0 }
  }
  async getModelUsage(): Promise<ModelUsageEntry[]> {
    return []
  }
  async healthCheck(): Promise<{ status: "up" | "down" | "unconfigured"; latencyMs?: number }> {
    return { status: "up", latencyMs: 0 }
  }
}

const cache = new Map<string, { value: string; expires?: number }>()

export class InMemoryCacheStore implements ICacheStore {
  async get<T>(key: string): Promise<T | null> {
    const entry = cache.get(key)
    if (!entry) return null
    if (entry.expires != null && entry.expires < Date.now()) {
      cache.delete(key)
      return null
    }
    try {
      return JSON.parse(entry.value) as T
    } catch {
      return entry.value as unknown as T
    }
  }
  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const serialized = typeof value === "string" ? value : JSON.stringify(value)
    const expires = ttlSeconds != null ? Date.now() + ttlSeconds * 1000 : undefined
    cache.set(key, { value: serialized, expires })
  }
  async setIfNotExists(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (cache.has(key)) return false
    const expires = Date.now() + ttlSeconds * 1000
    cache.set(key, { value, expires })
    return true
  }
  async invalidate(key: string): Promise<void> {
    cache.delete(key)
  }
  private rateCounts = new Map<string, { count: number; resetAt: number }>()
  async rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const now = Date.now()
    const entry = this.rateCounts.get(key)
    if (!entry || entry.resetAt < now) {
      this.rateCounts.set(key, { count: 1, resetAt: now + windowSeconds * 1000 })
      return true
    }
    entry.count++
    return entry.count <= limit
  }
  async healthCheck(): Promise<{ status: "up" | "down"; latencyMs?: number }> {
    return { status: "up", latencyMs: 0 }
  }
}

export class FakeCodeIntelligence implements ICodeIntelligence {
  async indexWorkspace(): Promise<{ filesProcessed: number }> {
    return { filesProcessed: 0 }
  }
  async getDefinitions(): Promise<Definition[]> {
    return []
  }
  async getReferences(): Promise<Reference[]> {
    return []
  }
}

export class FakePatternEngine implements IPatternEngine {
  async scanPatterns(): Promise<PatternMatch[]> {
    return []
  }
  async matchRule(): Promise<PatternMatch[]> {
    return []
  }
  async scanWithAstGrep(): Promise<import("@/lib/ports/types").AstGrepResult[]> {
    return []
  }
  async validateSemgrepYaml(): Promise<{ valid: boolean; errors: string[] }> {
    return { valid: true, errors: [] }
  }
}

export class InMemoryStorageProvider implements IStorageProvider {
  private store = new Map<string, Buffer>()

  async generateUploadUrl(bucket: string, path: string): Promise<{ url: string; token: string }> {
    return {
      url: `https://fake-storage.local/${bucket}/${path}`,
      token: `fake-token-${Date.now()}`,
    }
  }

  async downloadFile(bucket: string, path: string): Promise<Buffer> {
    const key = `${bucket}/${path}`
    const data = this.store.get(key)
    if (!data) throw new Error(`File not found: ${key}`)
    return data
  }

  async deleteFile(bucket: string, path: string): Promise<void> {
    this.store.delete(`${bucket}/${path}`)
  }

  async healthCheck(): Promise<{ status: "up" | "down"; latencyMs?: number }> {
    return { status: "up", latencyMs: 0 }
  }

  /** Test helper: put a file directly into the in-memory store */
  putFile(bucket: string, path: string, data: Buffer): void {
    this.store.set(`${bucket}/${path}`, data)
  }
}
