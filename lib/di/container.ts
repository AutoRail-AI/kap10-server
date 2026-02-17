/**
 * DI container — production and test factories.
 * Phase 0: wires 5 working adapters + 6 stubs.
 *
 * Infra dependencies (ArangoDB, Temporal, Redis, Prisma, etc.) are loaded lazily
 * via require() on first property access so the Next.js build never loads or
 * connects to those services. See Temporal, ArangoDB, Supabase docs on
 * connection best practices.
 */

import type { IPatternEngine } from "@/lib/ports/pattern-engine"
import type { IBillingProvider } from "@/lib/ports/billing-provider"
import type { ICacheStore } from "@/lib/ports/cache-store"
import type { ICodeIntelligence } from "@/lib/ports/code-intelligence"
import type { IGitHost } from "@/lib/ports/git-host"
import type { IGraphStore } from "@/lib/ports/graph-store"
import type { ILLMProvider } from "@/lib/ports/llm-provider"
import type { IObservability } from "@/lib/ports/observability"
import type { IRelationalStore } from "@/lib/ports/relational-store"
import type { IVectorSearch } from "@/lib/ports/vector-search"
import type { IWorkflowEngine } from "@/lib/ports/workflow-engine"

import {
  FakeCodeIntelligence,
  FakeGitHost,
  FakePatternEngine,
  InlineWorkflowEngine,
  InMemoryCacheStore,
  InMemoryGraphStore,
  InMemoryObservability,
  InMemoryRelationalStore,
  InMemoryVectorSearch,
  MockLLMProvider,
  NoOpBillingProvider,
} from "@/lib/di/fakes"

import PrismaRelationalStore from "@/lib/adapters/prisma-relational-store"

export interface Container {
  graphStore: IGraphStore
  relationalStore: IRelationalStore
  llmProvider: ILLMProvider
  workflowEngine: IWorkflowEngine
  gitHost: IGitHost
  vectorSearch: IVectorSearch
  billingProvider: IBillingProvider
  observability: IObservability
  cacheStore: ICacheStore
  codeIntelligence: ICodeIntelligence
  patternEngine: IPatternEngine
}

let productionContainer: Container | null = null

/**
 * Create production container with lazy-loaded adapters. No infra modules
 * (arangojs, @temporalio/client, ioredis, etc.) are loaded until the
 * corresponding property is first accessed.
 */
function createLazyProductionContainer(): Container {
  const cache: Partial<Container> = {}
  return {
    get graphStore(): IGraphStore {
      if (!cache.graphStore) {
        const { ArangoGraphStore } = require("../adapters/arango-graph-store") as typeof import("../adapters/arango-graph-store")
        cache.graphStore = new ArangoGraphStore()
      }
      return cache.graphStore
    },
    get relationalStore(): IRelationalStore {
      if (!cache.relationalStore) {
        cache.relationalStore = new PrismaRelationalStore()
      }
      return cache.relationalStore
    },
    get llmProvider(): ILLMProvider {
      if (!cache.llmProvider) {
        const { VercelAIProvider } = require("../adapters/vercel-ai-provider") as typeof import("../adapters/vercel-ai-provider")
        cache.llmProvider = new VercelAIProvider()
      }
      return cache.llmProvider
    },
    get workflowEngine(): IWorkflowEngine {
      if (!cache.workflowEngine) {
        const { TemporalWorkflowEngine } = require("../adapters/temporal-workflow-engine") as typeof import("../adapters/temporal-workflow-engine")
        cache.workflowEngine = new TemporalWorkflowEngine()
      }
      return cache.workflowEngine
    },
    get gitHost(): IGitHost {
      if (!cache.gitHost) {
        const { GitHubHost } = require("../adapters/github-host") as typeof import("../adapters/github-host")
        cache.gitHost = new GitHubHost()
      }
      return cache.gitHost
    },
    get vectorSearch(): IVectorSearch {
      if (!cache.vectorSearch) {
        const { LlamaIndexVectorSearch } = require("../adapters/llamaindex-vector-search") as typeof import("../adapters/llamaindex-vector-search")
        cache.vectorSearch = new LlamaIndexVectorSearch()
      }
      return cache.vectorSearch
    },
    get billingProvider(): IBillingProvider {
      if (!cache.billingProvider) {
        const { StripePayments } = require("../adapters/stripe-payments") as typeof import("../adapters/stripe-payments")
        cache.billingProvider = new StripePayments()
      }
      return cache.billingProvider
    },
    get observability(): IObservability {
      if (!cache.observability) {
        const { LangfuseObservability } = require("../adapters/langfuse-observability") as typeof import("../adapters/langfuse-observability")
        cache.observability = new LangfuseObservability()
      }
      return cache.observability
    },
    get cacheStore(): ICacheStore {
      if (!cache.cacheStore) {
        const { RedisCacheStore } = require("../adapters/redis-cache-store") as typeof import("../adapters/redis-cache-store")
        cache.cacheStore = new RedisCacheStore()
      }
      return cache.cacheStore
    },
    get codeIntelligence(): ICodeIntelligence {
      if (!cache.codeIntelligence) {
        const { SCIPCodeIntelligence } = require("../adapters/scip-code-intelligence") as typeof import("../adapters/scip-code-intelligence")
        cache.codeIntelligence = new SCIPCodeIntelligence()
      }
      return cache.codeIntelligence
    },
    get patternEngine(): IPatternEngine {
      if (!cache.patternEngine) {
        const { SemgrepPatternEngine } = require("../adapters/semgrep-pattern-engine") as typeof import("../adapters/semgrep-pattern-engine")
        cache.patternEngine = new SemgrepPatternEngine()
      }
      return cache.patternEngine
    },
  }
}

export function getContainer(): Container {
  if (!productionContainer) {
    productionContainer = createLazyProductionContainer()
  }
  return productionContainer
}

export function createTestContainer(overrides?: Partial<Container>): Container {
  return {
    graphStore: new InMemoryGraphStore(),
    relationalStore: new InMemoryRelationalStore(),
    llmProvider: new MockLLMProvider(),
    workflowEngine: new InlineWorkflowEngine(),
    gitHost: new FakeGitHost(),
    vectorSearch: new InMemoryVectorSearch(),
    billingProvider: new NoOpBillingProvider(),
    observability: new InMemoryObservability(),
    cacheStore: new InMemoryCacheStore(),
    codeIntelligence: new FakeCodeIntelligence(),
    patternEngine: new FakePatternEngine(),
    ...overrides,
  }
}
