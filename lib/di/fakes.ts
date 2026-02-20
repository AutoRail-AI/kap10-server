/**
 * In-memory fakes for all 11 ports (testing).
 */

import type { IBillingProvider } from "@/lib/ports/billing-provider"
import type { ICacheStore } from "@/lib/ports/cache-store"
import type { Definition, ICodeIntelligence, Reference } from "@/lib/ports/code-intelligence"
import type { FileEntry, GitHubRepo, IGitHost, PullRequest } from "@/lib/ports/git-host"
import type { IGraphStore } from "@/lib/ports/graph-store"
import type { ILLMProvider } from "@/lib/ports/llm-provider"
import type { CostBreakdown, IObservability, ModelUsageEntry } from "@/lib/ports/observability"
import type { IPatternEngine, PatternMatch } from "@/lib/ports/pattern-engine"
import type { DeletionLogRecord, GitHubInstallationRecord, IRelationalStore, RepoRecord } from "@/lib/ports/relational-store"
import type { BlueprintData, EntityDoc, FeatureDoc, ImpactResult, PatternDoc, RuleDoc, SnippetDoc } from "@/lib/ports/types"
import type { IVectorSearch } from "@/lib/ports/vector-search"
import type { IWorkflowEngine } from "@/lib/ports/workflow-engine"

export class InMemoryGraphStore implements IGraphStore {
  async bootstrapGraphSchema(): Promise<void> {}
  async healthCheck(): Promise<{ status: "up" | "down"; latencyMs?: number }> {
    return { status: "up", latencyMs: 0 }
  }
  async upsertEntity(): Promise<void> {}
  async getEntity(): Promise<EntityDoc | null> {
    return null
  }
  async deleteEntity(): Promise<void> {}
  async upsertEdge(): Promise<void> {}
  async getCallersOf(): Promise<EntityDoc[]> {
    return []
  }
  async getCalleesOf(): Promise<EntityDoc[]> {
    return []
  }
  async impactAnalysis(): Promise<ImpactResult> {
    return { entityId: "", affected: [] }
  }
  async getEntitiesByFile(_orgId: string, _repoId: string, _filePath: string): Promise<EntityDoc[]> {
    return []
  }
  async upsertRule(): Promise<void> {}
  async queryRules(): Promise<RuleDoc[]> {
    return []
  }
  async upsertPattern(): Promise<void> {}
  async queryPatterns(): Promise<PatternDoc[]> {
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
  async bulkUpsertEntities(): Promise<void> {}
  async bulkUpsertEdges(): Promise<void> {}
  async getFilePaths(): Promise<{ path: string }[]> {
    return []
  }
  async deleteRepoData(): Promise<void> {}
}

export class InMemoryRelationalStore implements IRelationalStore {
  private repos: RepoRecord[] = []
  private deletionLogs: DeletionLogRecord[] = []
  private installations: GitHubInstallationRecord[] = []

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
    return { number: 0, title: "" }
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
  async embed(): Promise<number[][]> {
    return []
  }
  async search(): Promise<{ id: string; score: number }[]> {
    return []
  }
  async upsert(): Promise<void> {}
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
