/**
 * DI container — production and test factories.
 * Phase 0: wires 5 working adapters + 6 stubs.
 */

import type { IPatternEngine } from "@/lib/ports/pattern-engine"

import { ArangoGraphStore } from "@/lib/adapters/arango-graph-store"
import { PrismaRelationalStore } from "@/lib/adapters/prisma-relational-store"
import { VercelAIProvider } from "@/lib/adapters/vercel-ai-provider"
import { TemporalWorkflowEngine } from "@/lib/adapters/temporal-workflow-engine"
import { GitHubHost } from "@/lib/adapters/github-host"
import { LlamaIndexVectorSearch } from "@/lib/adapters/llamaindex-vector-search"
import { StripePayments } from "@/lib/adapters/stripe-payments"
import { LangfuseObservability } from "@/lib/adapters/langfuse-observability"
import { RedisCacheStore } from "@/lib/adapters/redis-cache-store"
import { SCIPCodeIntelligence } from "@/lib/adapters/scip-code-intelligence"
import { SemgrepPatternEngine } from "@/lib/adapters/semgrep-pattern-engine"

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

export function createProductionContainer(): Container {
  return {
    graphStore: new ArangoGraphStore(),
    relationalStore: new PrismaRelationalStore(),
    llmProvider: new VercelAIProvider(),
    workflowEngine: new TemporalWorkflowEngine(),
    gitHost: new GitHubHost(),
    vectorSearch: new LlamaIndexVectorSearch(),
    billingProvider: new StripePayments(),
    observability: new LangfuseObservability(),
    cacheStore: new RedisCacheStore(),
    codeIntelligence: new SCIPCodeIntelligence(),
    patternEngine: new SemgrepPatternEngine(),
  }
}

export function getContainer(): Container {
  if (!productionContainer) {
    productionContainer = createProductionContainer()
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
