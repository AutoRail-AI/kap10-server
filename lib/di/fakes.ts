/**
 * In-memory fakes for all 11 ports (testing).
 */

import type { IBillingProvider } from "@/lib/ports/billing-provider"
import type { ICacheStore } from "@/lib/ports/cache-store"
import type { Definition, ICodeIntelligence, Reference } from "@/lib/ports/code-intelligence"
import type { FileEntry, IGitHost, PullRequest } from "@/lib/ports/git-host"
import type { IGraphStore } from "@/lib/ports/graph-store"
import type { ILLMProvider } from "@/lib/ports/llm-provider"
import type { CostBreakdown, IObservability, ModelUsageEntry } from "@/lib/ports/observability"
import type { IPatternEngine, PatternMatch } from "@/lib/ports/pattern-engine"
import type { DeletionLogRecord, IRelationalStore, RepoRecord } from "@/lib/ports/relational-store"
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
  async getEntitiesByFile(): Promise<EntityDoc[]> {
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
}

export class InMemoryRelationalStore implements IRelationalStore {
  private repos: RepoRecord[] = []
  private deletionLogs: DeletionLogRecord[] = []

  async healthCheck(): Promise<{ status: "up" | "down"; latencyMs?: number }> {
    return { status: "up", latencyMs: 0 }
  }
  async getRepos(orgId: string): Promise<RepoRecord[]> {
    return this.repos.filter((r) => r.organizationId === orgId)
  }
  async createRepo(data: {
    organizationId: string
    name: string
    fullName: string
    provider: string
    providerId: string
    status?: string
    defaultBranch?: string
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
    }
    this.repos.push(rec)
    return rec
  }
  async getDeletionLogs(orgId: string, limit = 50): Promise<DeletionLogRecord[]> {
    return this.deletionLogs.filter((l) => l.organizationId === orgId).slice(0, limit)
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
