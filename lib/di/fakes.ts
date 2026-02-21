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
import type { BlueprintData, EntityDoc, FeatureDoc, ImpactResult, ImportChain, ProjectStats, SearchResult, SnippetDoc } from "@/lib/ports/types"
import type { IVectorSearch } from "@/lib/ports/vector-search"
import type { IWorkflowEngine } from "@/lib/ports/workflow-engine"

export class InMemoryGraphStore implements IGraphStore {
  private entities = new Map<string, EntityDoc>()
  private edges: Array<{ _from: string; _to: string; kind: string; org_id: string; repo_id: string }> = []
  private workspaceEntities = new Map<string, EntityDoc>()

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
  async upsertRule(): Promise<void> {}
  async queryRules(): Promise<never[]> {
    return []
  }
  async upsertPattern(): Promise<void> {}
  async queryPatterns(): Promise<never[]> {
    return []
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
}
