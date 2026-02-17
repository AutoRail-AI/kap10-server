# kap10 — Vertical Slicing Architecture Plan

> **Each phase ships a single, end-to-end testable feature.**
> No phase depends on future phases to be useful. Every phase produces a working feature a user can interact with.

---

## System Overview

```
Developer's IDE                        kap10 Cloud
┌──────────────┐                      ┌──────────────────────────────────────────────┐
│  Cursor /    │   MCP (HTTP-SSE)     │  Next.js 16 App                             │
│  Claude Code │◄────────────────────►│  ┌───────────┐  ┌────────────────────┐      │
│  Windsurf    │                      │  │ MCP Server │  │ Web Dashboard      │      │
└──────┬───────┘                      │  └─────┬─────┘  └────────┬───────────┘      │
       │                              │        │                  │                  │
       │  sync_local_diff             │  ┌─────▼──────────────────▼───────────┐     │
       │  (uncommitted changes)       │  │        Core Engine                 │     │
       └─────────────────────────────►│  │  (code-synapse processing logic)   │     │
                                      │  └─────┬──────────────────┬───────────┘     │
       GitHub                         │        │                  │                  │
    ┌──────────┐   Webhooks / API     │  ┌─────▼─────┐    ┌──────▼──────────┐      │
    │  Repos   │◄────────────────────►│  │ ArangoDB   │    │ Supabase        │      │
    └──────────┘                      │  │ (Graph DB) │    │ (App + Vectors) │      │
                                      │  └───────────┘    └─────────────────┘      │
                                      │        │                                    │
                                      │  ┌─────▼───────────────────────────┐       │
                                      │  │ Temporal (Workflow Orchestration) │       │
                                      │  │  ├─ heavy-compute-queue          │       │
                                      │  │  └─ light-llm-queue             │       │
                                      │  └─────────────────────────────────┘       │
                                      └──────────────────────────────────────────────┘
```

### Storage & Infrastructure Split

| Store | Role | What lives here |
|-------|------|-----------------|
| **Supabase (Postgres + Prisma)** | App data, auth, billing, pgvector embeddings | Users, orgs, subscriptions, api_keys, usage, notifications, embeddings for semantic search |
| **ArangoDB** | Graph knowledge store | Files, functions, classes, interfaces, relationships (calls, imports, extends, implements), justifications, classifications, features, change ledger |
| **Temporal** | Workflow orchestration | All multi-step pipelines: repo indexing, justification, pattern detection, PR review, incremental re-indexing |
| **Redis** | Cache, rate limits, MCP sessions | Hot query cache, API rate limiting, MCP connection state |

### Why Temporal (not BullMQ)

BullMQ is a job queue — it fires individual jobs. kap10's core pipelines are **multi-step workflows** where:
- A monorepo indexing job (Clone → Install → SCIP → Parse → Extract → Embed → Justify) can run for 30+ minutes
- If the SCIP step OOMs on step 3 of 6, BullMQ restarts from scratch. **Temporal resumes from step 3.**
- Steps have complex dependencies (justification level N depends on level N-1 completing)
- We need **visibility** into exactly where a workflow is (Temporal UI shows this natively)
- Temporal handles retries, timeouts, heartbeats, and cancellation per-activity — no custom retry logic

#### Temporal Worker Task Queue Segregation

Not all activities are equal. SCIP indexing a large monorepo is CPU/memory-heavy; an LLM classification call is network-bound and lightweight. Running both on the same worker pool means a single 8GB SCIP index blocks classification of 500 small files.

| Queue | Activities | Worker Profile | Scaling |
|-------|-----------|----------------|---------|
| `heavy-compute-queue` | `prepareWorkspace`, `runSCIP`, `runSemgrep`, `astGrepScan` | 4 vCPU / 8 GB RAM, max 2 concurrent | Scale to 0 when idle (Temporal's `sticky-queue` keeps context) |
| `light-llm-queue` | `justifyEntity`, `llmSynthesizeRules`, `buildDocuments`, `generateEmbeds`, `classifyEntity` | 0.5 vCPU / 512 MB, max 20 concurrent (network-bound, low CPU) | Always-on pool (cheap, handles bursts) |

```typescript
// lib/temporal/workers/heavy-compute.ts
const worker = await Worker.create({
  taskQueue: 'heavy-compute-queue',
  activities: { prepareWorkspace, runSCIP, runSemgrep, astGrepScan },
  maxConcurrentActivityTaskExecutions: 2, // prevent OOM
});

// lib/temporal/workers/light-llm.ts
const worker = await Worker.create({
  taskQueue: 'light-llm-queue',
  activities: { justifyEntity, llmSynthesizeRules, classifyEntity, buildDocuments, generateEmbeds },
  maxConcurrentActivityTaskExecutions: 20, // network-bound, pile them on
});
```

Workflows use `proxyActivities` with explicit `taskQueue` per activity group:

```typescript
const heavy = proxyActivities<typeof heavyActivities>({
  taskQueue: 'heavy-compute-queue',
  startToCloseTimeout: '30m',
  heartbeatTimeout: '2m',
  retry: { maximumAttempts: 3 },
});

const light = proxyActivities<typeof lightActivities>({
  taskQueue: 'light-llm-queue',
  startToCloseTimeout: '2m',
  retry: { maximumAttempts: 5, backoffCoefficient: 2 },
});
```

### Why ArangoDB (not CozoDB)

code-synapse uses CozoDB embedded — perfect for a local CLI sidecar. kap10 is a **multi-tenant cloud service** where:
- Multiple repos per user, multiple users per org
- Concurrent graph queries from MCP connections
- Graph traversals (N-hop callers, impact analysis) are the primary query pattern
- AQL is production-grade with native graph traversals, HNSW vector indices, and multi-model (doc + graph + search) in one engine
- Scales horizontally (SmartGraphs, sharding) when needed

### Framework Decisions

| Concern | Framework | Why |
|---------|-----------|-----|
| **Workflow orchestration** | Temporal | Durable execution, resume-from-failure, built-in visibility UI, activity-level retries |
| **Code intelligence** | SCIP (Sourcegraph) | Standardized protobuf output for definitions, references, relationships — no custom AST traversal per language |
| **Pattern detection** | ast-grep + Semgrep | Structural search via patterns (not AST visitor code); Semgrep rules are YAML, LLM-generatable |
| **LLM routing** | Vercel AI SDK (`ai`) | Unified API across OpenAI/Anthropic/Google, native Next.js streaming, structured output with Zod |
| **LLM output** | `generateObject()` + Zod | All LLM calls use structured output — no regex parsing, no JSON.parse on free text. Schema = contract |
| **Embeddings & RAG** | LlamaIndex.TS | Handles chunking, embedding, pgvector storage, retrieval — no custom vector pipeline |
| **Database ORM** | Prisma | Type-safe Supabase access, native pgvector support, migration management |
| **LLM observability & billing** | Langfuse (via OpenTelemetry) | Auto-tracks every AI SDK call (tokens, cost, model, latency); Daily Metrics API powers billing; prompt management for iteration |
| **Architecture** | Ports & Adapters (Hexagonal) | Every external dependency behind an interface; swap any technology without touching business logic; testable via in-memory fakes |
| **Dependency injection** | Manual container factory | `createProductionContainer()` / `createTestContainer()` — no DI framework, just a typed object with all adapters |

---

## Cross-Cutting Concerns

These architectural patterns span multiple phases and are referenced throughout.

### 1. The Shadow Workspace — Bridging Local ↔ Cloud

**Problem:** kap10's graph lives in the cloud, but the developer's *current work* is local and uncommitted. The agent sees stale cloud state while the developer is mid-refactor.

**Solution:** The AI agent acts as a courier. A Bootstrap Rule (`.cursor/rules/kap10.mdc` or `CLAUDE.md`) forces the agent to call `sync_local_diff` before and after every significant operation.

#### Bootstrap Rule (distributed via Auto-PR — see Phase 2)

```markdown
# .cursor/rules/kap10.mdc
---
description: kap10 integration rules — always active
globs: ["**/*"]
alwaysApply: true
---

## Pre-flight (before ANY code generation task)
1. Call `sync_local_diff` with the current git diff (`git diff HEAD`)
2. Wait for confirmation that the cloud graph is updated

## Post-flight (after ANY code generation task)
1. Call `sync_local_diff` again to push the new changes
2. Call `check_patterns` on any newly written code
```

#### `sync_local_diff` MCP Tool

```typescript
// lib/mcp/tools/sync.ts
const SyncLocalDiffTool = {
  name: 'sync_local_diff',
  description: 'Sync uncommitted local changes to kap10 cloud graph',
  inputSchema: z.object({
    diff: z.string().describe('Output of `git diff HEAD`'),
    branch: z.string().describe('Current git branch name'),
    baseSha: z.string().describe('HEAD commit SHA'),
  }),
  handler: async ({ diff, branch, baseSha }, ctx) => {
    // 1. Resolve workspace (per-user, per-repo, per-branch)
    const workspace = await resolveWorkspace(ctx.userId, ctx.repoId, branch);

    // 2. Apply diff as overlay on top of last indexed commit
    const overlay = parseDiffToOverlay(diff, baseSha);

    // 3. Re-index only changed files (incremental, in-memory)
    const delta = await indexOverlay(overlay, workspace.graphSnapshot);

    // 4. Store as ephemeral workspace layer (TTL: 1 hour, refreshed on next sync)
    await workspace.applyDelta(delta);

    return { updated: delta.changedEntities.length, workspace: workspace.id };
  },
};
```

#### Workspace Model

Each developer gets an isolated workspace scoped to their repo and branch:

```
Workspaces
└── user_{user_id}
    └── repo_{repo_id}
        ├── main              ← matches last indexed commit
        ├── feature/auth      ← overlay from sync_local_diff
        └── fix/login-bug     ← overlay from sync_local_diff
```

- **Branch auto-detection:** When the agent sends `sync_local_diff` with `branch: "feature/auth"`, kap10 checks if that branch matches a known remote branch. If yes, it layers the diff on top of the latest indexed state for that branch. If no, it layers on top of `main`.
- **TTL:** Workspace overlays expire after 1 hour of inactivity. The Bootstrap Rule's pre-flight sync refreshes it.
- **Conflict resolution:** Cloud graph wins on conflict — the overlay is ephemeral, the indexed state is the source of truth.

### 2. Token Exhaustion — Semantic Truncation & Pagination

**Problem:** An MCP tool returning 200 functions with full bodies will exhaust the agent's context window. The agent freezes or hallucinates.

**Rule:** Never return raw database dumps to the agent. Every MCP response is summarized and paginated.

#### Response Envelope

```typescript
// lib/mcp/formatter.ts
interface MCPResponse<T> {
  data: T;                           // Summarized, never raw
  pagination?: {
    cursor: string;
    hasMore: boolean;
    totalCount: number;
  };
  meta: {
    truncated: boolean;
    originalCount: number;           // How many results existed before truncation
    bytesEstimate: number;           // Estimated token cost
  };
}

const MAX_RESPONSE_BYTES = 12_000;   // ~3,000 tokens — leaves room for agent reasoning

function formatForAgent<T>(results: T[], summarizer: (item: T) => string): MCPResponse<string[]> {
  const summaries = results.map(summarizer);
  let output: string[] = [];
  let bytes = 0;

  for (const s of summaries) {
    if (bytes + s.length > MAX_RESPONSE_BYTES) {
      return {
        data: output,
        pagination: { cursor: encodeCursor(output.length), hasMore: true, totalCount: results.length },
        meta: { truncated: true, originalCount: results.length, bytesEstimate: bytes },
      };
    }
    output.push(s);
    bytes += s.length;
  }

  return {
    data: output,
    meta: { truncated: false, originalCount: results.length, bytesEstimate: bytes },
  };
}
```

#### Summarization Rules

| Entity type | Full return (< 5 results) | Summarized return (≥ 5 results) |
|-------------|--------------------------|--------------------------------|
| Function | Name + full body + callers/callees | Name + signature + one-line purpose (from justification) |
| Class | Full class body + methods + inheritance | Name + method names + justification summary |
| File | Full content | File path + top-level exports + purpose |
| Pattern | Full Semgrep YAML + evidence | Rule name + adherence % + one-line description |

### 3. Edge Secret Scrubbing

**Problem:** Developers paste `git diff` output containing API keys, connection strings, or tokens into `sync_local_diff`. These must never reach LLM prompts or ArangoDB storage.

**Solution:** Regex + entropy scrubber on all MCP payloads at the edge, before any processing.

```typescript
// lib/mcp/security/scrubber.ts
const SECRET_PATTERNS = [
  /(?:api[_-]?key|secret|token|password|auth)\s*[:=]\s*['"]?([A-Za-z0-9+/=_-]{20,})['"]?/gi,
  /(?:AKIA|ASIA)[A-Z0-9]{16}/g,                    // AWS access keys
  /ghp_[A-Za-z0-9]{36}/g,                           // GitHub PATs
  /sk-[A-Za-z0-9]{32,}/g,                           // OpenAI keys
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g,       // Private keys
  /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+/g,         // JWTs
];

const ENTROPY_THRESHOLD = 4.5;  // Shannon entropy — high entropy strings are likely secrets

function scrubSecrets(input: string): { cleaned: string; secretsFound: number } {
  let cleaned = input;
  let count = 0;

  for (const pattern of SECRET_PATTERNS) {
    cleaned = cleaned.replace(pattern, (match) => {
      count++;
      return '[REDACTED]';
    });
  }

  // Entropy-based fallback for unknown secret formats
  cleaned = cleaned.replace(/['"][A-Za-z0-9+/=_-]{32,}['"]/g, (match) => {
    if (shannonEntropy(match) > ENTROPY_THRESHOLD) {
      count++;
      return '"[REDACTED_HIGH_ENTROPY]"';
    }
    return match;
  });

  return { cleaned, secretsFound: count };
}

// Applied at MCP ingress — every tool call passes through this
export function scrubMCPPayload(payload: unknown): unknown {
  if (typeof payload === 'string') return scrubSecrets(payload).cleaned;
  if (typeof payload === 'object' && payload !== null) {
    return Object.fromEntries(
      Object.entries(payload).map(([k, v]) => [k, scrubMCPPayload(v)])
    );
  }
  return payload;
}
```

Integrated at the MCP transport layer — **before** any tool handler executes:

```typescript
// lib/mcp/transport.ts
app.post('/api/mcp/:apiKey', async (req, res) => {
  const raw = req.body;
  const scrubbed = scrubMCPPayload(raw);   // ← edge scrubbing
  const result = await mcpServer.handleRequest(scrubbed);
  res.json(result);
});
```

### 4. LLM Observability & Cost Metering — Langfuse

**Problem:** kap10 makes hundreds of LLM calls per repo (justification, classification, pattern synthesis, impact summaries). Without centralized observability, we can't debug failures, track costs, or bill users accurately.

**Solution:** Langfuse as the single source of truth for all LLM usage. Every AI SDK call flows through OpenTelemetry → Langfuse, which tracks tokens, latency, cost, and model per call. **This LLM cost data becomes the billing meter** — what Langfuse records is what the user pays for.

#### Integration: Vercel AI SDK + OpenTelemetry + Langfuse

```typescript
// instrumentation.ts (Next.js 16 pattern — runs on server startup)
import { LangfuseSpanProcessor, ShouldExportSpan } from '@langfuse/otel';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

const shouldExportSpan: ShouldExportSpan = (span) => {
  // Only export AI SDK spans, not Next.js infra spans
  return span.otelSpan.instrumentationScope.name === 'ai';
};

export const langfuseSpanProcessor = new LangfuseSpanProcessor({ shouldExportSpan });

const tracerProvider = new NodeTracerProvider({
  spanProcessors: [langfuseSpanProcessor],
});

tracerProvider.register();
```

Every Vercel AI SDK call automatically emits telemetry when `experimental_telemetry: { isEnabled: true }` is set:

```typescript
// lib/ai/justify.ts — all AI SDK calls include telemetry + org context
import { generateObject } from 'ai';
import { propagateAttributes } from '@langfuse/tracing';

export async function classifyAndJustifyEntity(entity: Entity, depsContext: string, ctx: OrgContext) {
  return propagateAttributes(
    {
      userId: ctx.userId,
      sessionId: `justification-${ctx.repoId}`,
      tags: [ctx.orgId, ctx.repoId, 'justification'],
      metadata: { orgId: ctx.orgId, repoId: ctx.repoId, entityKind: entity.kind },
    },
    async () => {
      const { object, usage } = await generateObject({
        model: getModel(entity.complexity),
        schema: TaxonomySchema,
        prompt: buildPrompt(entity, depsContext),
        experimental_telemetry: { isEnabled: true },
      });
      return { taxonomy: object, tokensUsed: usage };
    },
  );
}
```

#### What Langfuse tracks (automatically)

| Metric | Source | Used for |
|--------|--------|----------|
| Input tokens | AI SDK telemetry | Cost calculation |
| Output tokens | AI SDK telemetry | Cost calculation |
| Model name | AI SDK telemetry | Per-model cost rates |
| Total cost (USD) | Langfuse model definitions | **Billing meter** |
| Latency | OpenTelemetry spans | Performance monitoring |
| Trace hierarchy | Nested spans | Debugging (which workflow → which activity → which LLM call) |

#### Billing integration: Langfuse Daily Metrics API → Stripe

A nightly Temporal workflow polls Langfuse for per-org cost data and syncs it to our billing system:

```typescript
// lib/billing/langfuse-sync.ts
import { LangfuseClient } from '@langfuse/client';

const langfuse = new LangfuseClient();

async function getOrgLLMCost(orgId: string, from: Date, to: Date): Promise<number> {
  const metrics = await langfuse.api.metrics.metricsDaily({
    traceName: undefined,
    tags: [orgId],     // all traces tagged with orgId
    fromTimestamp: from.toISOString(),
    toTimestamp: to.toISOString(),
  });

  return metrics.data.reduce((sum, day) => sum + day.totalCost, 0);
}
```

#### Langfuse Dashboard value

- **Debug failing justifications:** Trace hierarchy shows exactly which entity → which prompt → which model → what output
- **Cost breakdown by repo:** Filter by `repoId` tag to see which repos are expensive
- **Model comparison:** See cost/quality tradeoff between gpt-4o-mini vs gpt-4o per operation type
- **Prompt iteration:** Version prompts in Langfuse Prompt Management, A/B test prompt versions

### 5. Decoupled Architecture — Ports & Adapters

**Principle:** Every external dependency (database, LLM provider, workflow engine, Git host, billing system, observability) is accessed through an **interface (port)**. The concrete implementation is an **adapter** that can be swapped without touching business logic.

This means: if we need to replace ArangoDB with Neo4j, Temporal with Inngest, or Stripe with Paddle — we write a new adapter, swap the binding in the DI container, and nothing else changes.

#### Layer Map

```
┌───────────────────────────────────────────────────────────────────────┐
│                        Presentation Layer                            │
│   Next.js App Router  │  MCP Transport  │  Webhook Handlers          │
│   (pages, API routes)   (HTTP-SSE)        (GitHub, Stripe)           │
└──────────┬──────────────────┬──────────────────┬──────────────────────┘
           │                  │                  │
┌──────────▼──────────────────▼──────────────────▼──────────────────────┐
│                      Application Layer (Use Cases)                    │
│   IndexRepoUseCase  │  JustifyEntityUseCase  │  SyncBillingUseCase   │
│   ResolveRulesUseCase  │  SearchCodeUseCase  │  ReviewPRUseCase      │
│                                                                       │
│   Use cases depend ONLY on port interfaces — never on adapters.       │
└──────────┬──────────────────┬──────────────────┬──────────────────────┘
           │                  │                  │
┌──────────▼──────────────────▼──────────────────▼──────────────────────┐
│                         Domain Layer (Core Logic)                     │
│   Entity types  │  Taxonomy schemas  │  Rule resolution  │  Hashing  │
│   Business rules  │  Snippet resolution  │  Pattern matching logic   │
│                                                                       │
│   Zero external imports. Pure TypeScript. Fully unit-testable.        │
└──────────────────────────────────────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────────────────────┐
│                         Port Interfaces                              │
│   (Abstract contracts — what the app needs, not how it's done)       │
├──────────────────────────────────────────────────────────────────────┤
│  IGraphStore          │  Graph CRUD, traversals, entity queries      │
│  IRelationalStore     │  User/org/subscription CRUD, pgvector search │
│  ILLMProvider         │  generateObject, streamText, embeddings      │
│  IWorkflowEngine      │  startWorkflow, signalWorkflow, queryState   │
│  IGitHost             │  cloneRepo, getPR, createPR, listFiles       │
│  IVectorSearch        │  embed, search, upsert                       │
│  IBillingProvider     │  createSubscription, reportUsage, checkout    │
│  IObservability       │  trackLLMCall, getCost, getMetrics           │
│  ICacheStore          │  get, set, invalidate, rateLimit             │
│  ICodeIntelligence    │  indexWorkspace, getDefinitions, getReferences│
│  IPatternEngine       │  scanPatterns, matchRule                     │
└──────────────────────────────────────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────────────────────┐
│                         Adapter Layer                                │
│   (Concrete implementations — swappable per deployment)              │
├──────────────────────────────────────────────────────────────────────┤
│  ArangoGraphStore     implements IGraphStore                         │
│  PrismaRelationalStore implements IRelationalStore                   │
│  VercelAIProvider     implements ILLMProvider                        │
│  TemporalWorkflowEngine implements IWorkflowEngine                  │
│  GitHubHost           implements IGitHost                            │
│  LlamaIndexVectorSearch implements IVectorSearch                     │
│  StripePayments       implements IBillingProvider                    │
│  LangfuseObservability implements IObservability                     │
│  RedisCacheStore      implements ICacheStore                         │
│  SCIPCodeIntelligence implements ICodeIntelligence                   │
│  SemgrepPatternEngine implements IPatternEngine                      │
└──────────────────────────────────────────────────────────────────────┘
```

#### Port Definitions

```typescript
// lib/ports/graph-store.ts
export interface IGraphStore {
  // Entity CRUD
  upsertEntity(orgId: string, entity: EntityDoc): Promise<void>;
  getEntity(orgId: string, entityId: string): Promise<EntityDoc | null>;
  deleteEntity(orgId: string, entityId: string): Promise<void>;

  // Relationships
  upsertEdge(orgId: string, edge: EdgeDoc): Promise<void>;
  getCallersOf(orgId: string, entityId: string, depth?: number): Promise<EntityDoc[]>;
  getCalleesOf(orgId: string, entityId: string, depth?: number): Promise<EntityDoc[]>;

  // Traversals
  impactAnalysis(orgId: string, entityId: string, maxDepth: number): Promise<ImpactResult>;
  getEntitiesByFile(orgId: string, filePath: string): Promise<EntityDoc[]>;

  // Rules & Patterns
  upsertRule(orgId: string, rule: RuleDoc): Promise<void>;
  queryRules(orgId: string, filter: RuleFilter): Promise<RuleDoc[]>;
  upsertPattern(orgId: string, pattern: PatternDoc): Promise<void>;
  queryPatterns(orgId: string, filter: PatternFilter): Promise<PatternDoc[]>;

  // Snippets
  upsertSnippet(orgId: string, snippet: SnippetDoc): Promise<void>;
  querySnippets(orgId: string, filter: SnippetFilter): Promise<SnippetDoc[]>;

  // Taxonomy & Features
  getFeatures(orgId: string, repoId: string): Promise<FeatureDoc[]>;
  getBlueprint(orgId: string, repoId: string): Promise<BlueprintData>;

  // Bulk operations
  bulkUpsertEntities(orgId: string, entities: EntityDoc[]): Promise<void>;
  bulkUpsertEdges(orgId: string, edges: EdgeDoc[]): Promise<void>;
}

// lib/ports/llm-provider.ts
export interface ILLMProvider {
  generateObject<T>(params: {
    model: string;
    schema: z.ZodSchema<T>;
    prompt: string;
    context?: OrgContext;
    temperature?: number;
  }): Promise<{ object: T; usage: TokenUsage }>;

  streamText(params: {
    model: string;
    prompt: string;
    context?: OrgContext;
  }): AsyncIterable<string>;

  embed(params: {
    model: string;
    texts: string[];
  }): Promise<number[][]>;
}

// lib/ports/workflow-engine.ts
export interface IWorkflowEngine {
  startWorkflow<T>(params: {
    workflowId: string;
    workflowFn: string;
    args: unknown[];
    taskQueue: 'heavy-compute' | 'light-llm';
  }): Promise<WorkflowHandle<T>>;

  signalWorkflow(workflowId: string, signal: string, data?: unknown): Promise<void>;
  getWorkflowStatus(workflowId: string): Promise<WorkflowStatus>;
  cancelWorkflow(workflowId: string): Promise<void>;
}

// lib/ports/git-host.ts
export interface IGitHost {
  cloneRepo(url: string, destination: string, options?: CloneOptions): Promise<void>;
  getPullRequest(owner: string, repo: string, prNumber: number): Promise<PullRequest>;
  createPullRequest(owner: string, repo: string, params: CreatePRParams): Promise<PullRequest>;
  getDiff(owner: string, repo: string, base: string, head: string): Promise<string>;
  listFiles(owner: string, repo: string, ref?: string): Promise<FileEntry[]>;
  createWebhook(owner: string, repo: string, events: string[], url: string): Promise<void>;
}

// lib/ports/billing-provider.ts
export interface IBillingProvider {
  createCheckoutSession(orgId: string, planId: string): Promise<{ url: string }>;
  createSubscription(orgId: string, planId: string): Promise<Subscription>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  reportUsage(orgId: string, amount: number, description: string): Promise<void>;
  createOnDemandCharge(orgId: string, amountUsd: number): Promise<{ url: string }>;
}

// lib/ports/observability.ts
export interface IObservability {
  getOrgLLMCost(orgId: string, from: Date, to: Date): Promise<number>;
  getCostBreakdown(orgId: string, from: Date, to: Date): Promise<CostBreakdown>;
  getModelUsage(orgId: string, from: Date, to: Date): Promise<ModelUsageEntry[]>;
}
```

#### Dependency Injection

```typescript
// lib/di/container.ts
import type { IGraphStore } from '@/lib/ports/graph-store';
import type { ILLMProvider } from '@/lib/ports/llm-provider';
import type { IWorkflowEngine } from '@/lib/ports/workflow-engine';
import type { IGitHost } from '@/lib/ports/git-host';
import type { IBillingProvider } from '@/lib/ports/billing-provider';
import type { IObservability } from '@/lib/ports/observability';
import type { IRelationalStore } from '@/lib/ports/relational-store';
import type { IVectorSearch } from '@/lib/ports/vector-search';
import type { ICacheStore } from '@/lib/ports/cache-store';
import type { ICodeIntelligence } from '@/lib/ports/code-intelligence';
import type { IPatternEngine } from '@/lib/ports/pattern-engine';

export interface Container {
  graphStore: IGraphStore;
  relationalStore: IRelationalStore;
  llmProvider: ILLMProvider;
  workflowEngine: IWorkflowEngine;
  gitHost: IGitHost;
  vectorSearch: IVectorSearch;
  billingProvider: IBillingProvider;
  observability: IObservability;
  cacheStore: ICacheStore;
  codeIntelligence: ICodeIntelligence;
  patternEngine: IPatternEngine;
}

// Production container — wires all real adapters
export function createProductionContainer(): Container {
  return {
    graphStore: new ArangoGraphStore(config.arangodb),
    relationalStore: new PrismaRelationalStore(prisma),
    llmProvider: new VercelAIProvider(),
    workflowEngine: new TemporalWorkflowEngine(config.temporal),
    gitHost: new GitHubHost(config.github),
    vectorSearch: new LlamaIndexVectorSearch(config.pgvector),
    billingProvider: new StripePayments(config.stripe),
    observability: new LangfuseObservability(config.langfuse),
    cacheStore: new RedisCacheStore(config.redis),
    codeIntelligence: new SCIPCodeIntelligence(),
    patternEngine: new SemgrepPatternEngine(),
  };
}

// Test container — in-memory fakes for unit tests
export function createTestContainer(overrides?: Partial<Container>): Container {
  return {
    graphStore: new InMemoryGraphStore(),
    relationalStore: new InMemoryRelationalStore(),
    llmProvider: new MockLLMProvider(),
    workflowEngine: new InlineWorkflowEngine(),  // Runs synchronously, no Temporal
    gitHost: new FakeGitHost(),
    vectorSearch: new InMemoryVectorSearch(),
    billingProvider: new NoOpBillingProvider(),
    observability: new InMemoryObservability(),
    cacheStore: new InMemoryCacheStore(),
    codeIntelligence: new FakeCodeIntelligence(),
    patternEngine: new FakePatternEngine(),
    ...overrides,
  };
}
```

#### Swap Scenarios

This architecture enables these swaps with a single adapter file change:

| Current | Alternative | What to write | What changes in business logic |
|---------|------------|--------------|-------------------------------|
| ArangoDB | Neo4j | `Neo4jGraphStore implements IGraphStore` | Nothing |
| ArangoDB | TigerGraph | `TigerGraphStore implements IGraphStore` | Nothing |
| Temporal | Inngest | `InngestWorkflowEngine implements IWorkflowEngine` | Nothing |
| Temporal | BullMQ | `BullMQWorkflowEngine implements IWorkflowEngine` | Nothing |
| GitHub | GitLab | `GitLabHost implements IGitHost` | Nothing |
| GitHub | Bitbucket | `BitbucketHost implements IGitHost` | Nothing |
| Stripe | Paddle | `PaddlePayments implements IBillingProvider` | Nothing |
| Langfuse | Helicone | `HeliconeObservability implements IObservability` | Nothing |
| SCIP | Tree-sitter | `TreeSitterCodeIntelligence implements ICodeIntelligence` | Nothing |
| OpenAI | Anthropic-only | Change model string in `VercelAIProvider` | Nothing |
| Supabase | PlanetScale | `PlanetScaleRelationalStore implements IRelationalStore` | Nothing |
| Redis | Dragonfly | `DragonflyCache implements ICacheStore` | Nothing |
| LlamaIndex | Custom pipeline | `CustomVectorSearch implements IVectorSearch` | Nothing |

#### File Structure

```
lib/
  ports/                          # Abstract interfaces — zero dependencies
    graph-store.ts
    relational-store.ts
    llm-provider.ts
    workflow-engine.ts
    git-host.ts
    vector-search.ts
    billing-provider.ts
    observability.ts
    cache-store.ts
    code-intelligence.ts
    pattern-engine.ts
    types.ts                      # Shared domain types (EntityDoc, EdgeDoc, etc.)
  adapters/                       # Concrete implementations
    arango-graph-store.ts
    prisma-relational-store.ts
    vercel-ai-provider.ts
    temporal-workflow-engine.ts
    github-host.ts
    llamaindex-vector-search.ts
    stripe-payments.ts
    langfuse-observability.ts
    redis-cache-store.ts
    scip-code-intelligence.ts
    semgrep-pattern-engine.ts
  di/
    container.ts                  # Production + test container factories
  domain/                         # Pure business logic — no external imports
    entity-hashing.ts
    rule-resolution.ts
    snippet-resolution.ts
    taxonomy-classification.ts
    impact-analysis.ts
  use-cases/                      # Application orchestration — depends on ports only
    index-repo.ts
    justify-entity.ts
    sync-billing.ts
    resolve-rules.ts
    search-code.ts
    review-pr.ts
    detect-patterns.ts
    extract-snippets.ts
```

#### Rules for Developers

1. **Use cases import ports, never adapters.** A use case receives its dependencies via the container, not via direct import.
2. **Domain layer has zero imports** from `lib/adapters/`, `lib/ports/`, or any external package. It's pure TypeScript types, schemas, and business logic functions.
3. **Adapters import their external SDK** (e.g., `arangojs`, `@temporalio/client`, `stripe`) and nothing else from the app except port types.
4. **Tests use `createTestContainer()`** with optional overrides. No mocking frameworks needed — just swap the adapter.
5. **New external dependency = new port + adapter.** Never import an external SDK directly in a use case.

### 6. Structured Output Mandate — No Regex Parsing

**Rule:** Every LLM call that produces data for the system MUST use **Vercel AI SDK's `generateObject()`** with a Zod schema. No `generateText()` + regex/JSON.parse. No string matching on LLM output. No "extract the JSON from the markdown code block." Zero regex-based LLM response parsing anywhere in the codebase.

#### Why

| Approach | Failure Mode | Reliability |
|----------|-------------|-------------|
| `generateText()` + regex | LLM wraps response in markdown, changes field order, adds commentary, uses different quoting — regex breaks | ~70% on first try, brittle across model changes |
| `generateText()` + `JSON.parse()` | LLM adds trailing commas, uses single quotes, includes comments — parse fails | ~85%, still fragile |
| **`generateObject()` + Zod schema** | Provider uses constrained decoding / function calling. Schema IS the contract. Typed output guaranteed. | **~99.9%** — model is constrained to the schema |

#### Pattern: Every LLM Call

```typescript
// ✅ CORRECT — structured output via generateObject
import { generateObject } from 'ai';
import { z } from 'zod';

const JustificationSchema = z.object({
  purpose: z.string().describe('One-sentence explanation of why this entity exists'),
  featureArea: z.string().describe('Business feature this belongs to'),
  type: z.enum(['VERTICAL', 'HORIZONTAL', 'UTILITY']),
  confidence: z.number().min(0).max(1),
  userFlows: z.array(z.object({
    name: z.string(),
    step: z.string(),
  })).optional(),
});

const { object, usage } = await container.llmProvider.generateObject({
  model: 'gpt-4o-mini',
  schema: JustificationSchema,
  prompt: buildJustificationPrompt(entity, context),
  context: orgContext,
});
// object is fully typed as z.infer<typeof JustificationSchema>
// No parsing. No regex. No try/catch around JSON.parse.

// ❌ FORBIDDEN — never do this
const { text } = await generateText({ model, prompt });
const match = text.match(/```json\n([\s\S]*?)\n```/);  // NEVER
const parsed = JSON.parse(match[1]);                      // NEVER
```

#### All LLM Call Sites (with their Zod schemas)

| Phase | Call Site | Zod Schema | Output |
|-------|----------|-----------|--------|
| 4 | `justifyEntity` | `TaxonomySchema` | type, purpose, featureArea, userFlows, confidence |
| 4 | `classifyEntity` | `TaxonomySchema` | VERTICAL/HORIZONTAL/UTILITY classification |
| 5 | `reJustifyEntity` | `TaxonomySchema` | Updated justification after code change |
| 6 | `synthesizeRule` | `SemgrepRuleSchema` | Semgrep YAML rule generated from pattern evidence |
| 6 | `evaluateRuleViolation` | `ViolationSchema` | severity, explanation, suggestedFix |
| 7 | `summarizePRImpact` | `PRReviewSchema` | risk level, affected features, suggestions[] |
| 7 | `generateReviewComment` | `ReviewCommentSchema` | comment body, severity, line reference |
| 9 | `classifySnippetCandidate` | `SnippetCandidateSchema` | isCandidate, category, suggestedTitle, reason |

#### Zod Schema Design Rules

1. **Use `.describe()` on every field.** The description becomes part of the LLM's function schema — better descriptions = better output.
2. **Use `z.enum()` for categorical fields.** Never `z.string()` when the set of valid values is known.
3. **Use `.optional()` for conditionally-present fields.** Add `.describe()` explaining when the field is present vs absent.
4. **Keep schemas flat where possible.** Deeply nested schemas increase LLM error rates. Prefer separate calls over 5+ levels of nesting.
5. **Colocate schemas with their use case.** `lib/ai/taxonomy.ts` exports `TaxonomySchema`, `lib/ai/review.ts` exports `PRReviewSchema`, etc.
6. **Version schemas.** When a schema changes, keep the old version in a `v1/` directory until all stored data is migrated.

#### Integration with ILLMProvider Port

The `ILLMProvider.generateObject()` method enforces structured output at the port level. Every adapter (VercelAI, or a future direct Anthropic adapter) must implement structured output via its native mechanism:

```typescript
// lib/adapters/vercel-ai-provider.ts
import { generateObject as aiGenerateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { propagateAttributes } from '@langfuse/tracing';

export class VercelAIProvider implements ILLMProvider {
  private getModel(modelId: string) {
    if (modelId.startsWith('gpt-')) return openai(modelId);
    if (modelId.startsWith('claude-')) return anthropic(modelId);
    throw new Error(`Unknown model: ${modelId}`);
  }

  async generateObject<T>(params: {
    model: string;
    schema: z.ZodSchema<T>;
    prompt: string;
    context?: OrgContext;
    temperature?: number;
  }): Promise<{ object: T; usage: TokenUsage }> {
    const ctx = params.context;

    const execute = async () => {
      const { object, usage } = await aiGenerateObject({
        model: this.getModel(params.model),
        schema: params.schema,
        prompt: params.prompt,
        temperature: params.temperature,
        experimental_telemetry: { isEnabled: true },
      });
      return { object, usage: { inputTokens: usage.promptTokens, outputTokens: usage.completionTokens } };
    };

    // Wrap with Langfuse context if org context is provided
    if (ctx) {
      return propagateAttributes(
        {
          userId: ctx.userId,
          sessionId: ctx.sessionId,
          tags: [ctx.orgId, ctx.repoId].filter(Boolean) as string[],
          metadata: { orgId: ctx.orgId, repoId: ctx.repoId },
        },
        execute,
      );
    }

    return execute();
  }
}
```

---

## Phase 0 — Foundation Wiring

**Feature:** _"I can sign up, create an org, and see an empty dashboard with a 'Connect Repository' button."_

### What ships
- Auth flow works end-to-end (Better Auth — already scaffolded)
- Org creation with onboarding wizard
- Empty dashboard shell with nav: Repos, Search, Settings
- ArangoDB connection established + health check
- Temporal server running + health check (both task queues registered)
- Prisma schema initialized with existing Supabase tables
- Langfuse initialized via OpenTelemetry (`instrumentation.ts`) + health check
- Docker Compose updated: `app` + `temporal` + `redis` + `arangodb` + separate worker containers

### Database changes

**Supabase (via Prisma)** — map existing Better Auth tables + app tables into Prisma schema:
```prisma
// prisma/schema.prisma
datasource db {
  provider   = "postgresql"
  url        = env("SUPABASE_DB_URL")
  extensions = [pgvector]
}

// Better Auth tables are managed externally — use @@map to reference them
// App tables managed by Prisma migrations
```

**ArangoDB** — create tenant-scoped database:
```
System DB
└── org_{org_id}          ← one ArangoDB database per org
    ├── repos             (document collection)
    ├── files             (document collection)
    ├── functions         (document collection)
    ├── classes           (document collection)
    ├── interfaces        (document collection)
    ├── variables         (document collection)
    ├── contains          (edge collection: file → entity)
    ├── calls             (edge collection: fn → fn)
    ├── imports           (edge collection: file → file)
    ├── extends           (edge collection: class → class)
    └── implements        (edge collection: class → interface)
```

### New files
```
lib/
  db/
    arango.ts              ← ArangoDB client singleton (arangojs)
    arango-schema.ts       ← Collection/index creation per org
    prisma.ts              ← Prisma client singleton
  temporal/
    client.ts              ← Temporal client singleton
    workers/
      heavy-compute.ts     ← Worker for heavy-compute-queue
      light-llm.ts         ← Worker for light-llm-queue
    connection.ts          ← Temporal connection config
prisma/
  schema.prisma            ← Prisma schema (Supabase tables + pgvector)
docker-compose.yml         ← Add arangodb + temporal services
app/
  (dashboard)/
    layout.tsx             ← Authenticated dashboard shell
    page.tsx               ← Repos list (empty state)
    repos/page.tsx         ← Repository management
    settings/page.tsx      ← Org settings
```

### Docker Compose services

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `app` | Node 22 Alpine | 3000 | Next.js dev server |
| `temporal` | `temporalio/auto-setup` | 7233 | Temporal server (dev mode with auto-setup) |
| `temporal-ui` | `temporalio/ui` | 8080 | Temporal Web UI (workflow visibility) |
| `temporal-worker-heavy` | Node 22 Alpine | — | Heavy compute worker (SCIP, Semgrep, ast-grep) |
| `temporal-worker-light` | Node 22 Alpine | — | Light LLM worker (AI SDK calls, embeddings) |
| `arangodb` | `arangodb/arangodb` | 8529 | ArangoDB graph database |
| `redis` | `redis:7-alpine` | 6379 | Cache + rate limits |

### Test
- `pnpm test` — ArangoDB connection health check, Temporal connection health check (both queues), Prisma client connects
- `e2e` — Sign up → create org → see empty dashboard → "Connect Repository" CTA visible

---

## Phase 1 — GitHub Connect & Repository Indexing

**Feature:** _"I connect my GitHub account, select a repo, and kap10 indexes it. I can see files, functions, and classes in the dashboard."_

### What ships
- GitHub OAuth integration (via Better Auth social provider)
- GitHub App installation flow (repo access permissions)
- "Connect Repository" modal → select from GitHub repos
- Temporal workflow: `indexRepoWorkflow` — prepare workspace → SCIP index → parse → extract → write to ArangoDB
- Dashboard: repo card shows indexing progress (0% → 100%) via Temporal query
- After indexing: browsable file tree + entity list

### Processing pipeline — SCIP + Tree-sitter

```
GitHub Webhook / Manual Trigger
        │
        ▼
┌───────────────────────────────────────────────────────────────────────┐
│                    Temporal: indexRepoWorkflow                        │
│                                                                       │
│  ┌──────────────┐    ┌──────────┐    ┌──────────┐    ┌───────────┐  │
│  │ Activity:     │───▶│ Activity: │───▶│ Activity: │───▶│ Activity:  │  │
│  │ prepareWork-  │    │ runSCIP  │    │ parseRest │    │ writeToA-  │  │
│  │ space         │    │          │    │           │    │ rango      │  │
│  │               │    │ scip-ts  │    │ tree-sitter│   │            │  │
│  │ full clone +  │    │ scip-go  │    │ for langs  │   │ batch ins  │  │
│  │ npm install   │    │ scip-py  │    │ SCIP misses│   │ nodes+edges│  │
│  └──────────────┘    └──────────┘    └──────────┘    └───────────┘  │
│                                                                       │
│  [heavy-compute-queue]                                               │
│  Progress reported via Temporal workflow query                        │
└───────────────────────────────────────────────────────────────────────┘
```

#### Why SCIP for graph extraction

code-synapse uses custom Tree-sitter traversals to find "which function calls which function." This requires writing hundreds of lines of AST visitor code **per language**. SCIP (Sourcegraph Code Intelligence Protocol) solves this:

| Aspect | Custom Tree-sitter | SCIP |
|--------|-------------------|------|
| **Definitions & references** | Manual AST walking per language | Standardized protobuf output |
| **Cross-file resolution** | Requires TypeScript Compiler API | Built into SCIP indexers |
| **Language support** | Custom code per language | `scip-typescript`, `scip-go`, `scip-python`, `scip-java`, `scip-rust` — drop-in |
| **Call graph** | Complex scope analysis | Definition → reference edges in the SCIP index |
| **Output** | Custom data structures | Standard `.scip` protobuf → parse once, write to any DB |

#### Critical: The SCIP Shallow Clone Trap

**Problem:** SCIP indexers (especially `scip-typescript`) resolve cross-file references via the project's type system. `scip-typescript` internally runs `tsc` to build the project graph. If `node_modules` is missing, every `import` resolves to `<unknown>` — you get files and top-level symbols, but **zero cross-file edges** (calls, imports, extends). The entire knowledge graph becomes a disconnected island soup.

**Solution:** `prepareWorkspace` does a **full clone + dependency install** before SCIP runs.

**Pipeline detail:**
1. **`prepareWorkspace`** (replaces `cloneRepo`) — Full clone (not shallow!) to `/tmp/{hash}`, detect language from `package.json`/`go.mod`/etc., then run language-appropriate dependency install (`npm ci`, `go mod download`, `pip install -r requirements.txt`). This ensures SCIP indexers can resolve the full type graph. Runs on `heavy-compute-queue`.
2. **`runSCIP`** — Run the appropriate SCIP indexer (e.g. `scip-typescript` for TS/JS projects). Produces a `.scip` protobuf file containing all definitions, references, and relationships with precise source locations. Runs on `heavy-compute-queue`.
3. **`parseRest`** — For languages without SCIP indexers (or for additional metadata like JSDoc, decorators), fall back to Tree-sitter WASM parsing. This is a **supplement**, not the primary extraction method. Runs on `heavy-compute-queue`.
4. **`writeToArango`** — Parse the SCIP protobuf output, transform into ArangoDB document/edge format, batch insert. Generates **stable entity hashes** (see below). Runs on `light-llm-queue` (network-bound write).

#### Stable Entity Hashing

Every entity gets a deterministic `_key` based on its identity, not its content:

```typescript
// lib/indexer/entity-hash.ts
import { createHash } from 'crypto';

/**
 * Stable hash for entity identity. Used to detect renames/deletes in Phase 5.
 * Hash is based on: repo + file path + entity kind + entity name + signature.
 * Content changes DON'T change the hash — only identity changes do.
 */
function entityHash(repoId: string, filePath: string, kind: string, name: string, signature: string): string {
  return createHash('sha256')
    .update(`${repoId}:${filePath}:${kind}:${name}:${signature}`)
    .digest('hex')
    .slice(0, 16);
}
```

**Why this matters:** In Phase 5 (incremental indexing), when a file is modified, we re-index it and compare old vs. new entity hashes. Entities with the same hash → update content in place. Old hashes not present in new set → entity was deleted or renamed → remove from graph + cascade re-justification. New hashes not present in old set → new entity → insert. Without stable hashing, we'd have to tombstone everything and re-insert, losing edge relationships.

### New Supabase tables (via Prisma migration)

```prisma
model Repo {
  id               String   @id @default(uuid())
  organizationId   String   @map("organization_id")
  githubRepoId     BigInt   @map("github_repo_id")
  githubFullName   String   @map("github_full_name")    // "owner/repo"
  defaultBranch    String   @default("main") @map("default_branch")
  lastIndexedAt    DateTime? @map("last_indexed_at")
  lastIndexedSha   String?  @map("last_indexed_sha")    // commit SHA of last full index
  indexStatus      String   @default("pending") @map("index_status")  // pending | indexing | ready | failed
  indexProgress    Int      @default(0) @map("index_progress")        // 0-100
  fileCount        Int      @default(0) @map("file_count")
  functionCount    Int      @default(0) @map("function_count")
  classCount       Int      @default(0) @map("class_count")
  createdAt        DateTime @default(now()) @map("created_at")
  updatedAt        DateTime @updatedAt @map("updated_at")

  apiKeys          ApiKey[]
  embeddings       EntityEmbedding[]
  reviews          PrReview[]

  @@map("repos")
}
```

### Temporal workflows & activities

| Workflow | Activities | Queue | Retry policy |
|----------|-----------|-------|--------------|
| `indexRepoWorkflow` | `prepareWorkspace` → `runSCIP` → `parseRest` → `writeToArango` | Heavy (first 3), Light (write) | Each activity retries 3× with backoff. If `runSCIP` OOMs, workflow resumes from `runSCIP` (not from clone). |

```typescript
// lib/temporal/workflows/index-repo.ts
import { proxyActivities } from '@temporalio/workflow';
import type * as heavyActivities from '../activities/indexing-heavy';
import type * as lightActivities from '../activities/indexing-light';

const heavy = proxyActivities<typeof heavyActivities>({
  taskQueue: 'heavy-compute-queue',
  startToCloseTimeout: '30m',
  heartbeatTimeout: '2m',
  retry: { maximumAttempts: 3 },
});

const light = proxyActivities<typeof lightActivities>({
  taskQueue: 'light-llm-queue',
  startToCloseTimeout: '5m',
  retry: { maximumAttempts: 3 },
});

export async function indexRepoWorkflow(input: IndexRepoInput): Promise<IndexResult> {
  const workspace = await heavy.prepareWorkspace(input);
  const scipIndex = await heavy.runSCIP({ workspacePath: workspace.path, languages: input.languages });
  const extraEntities = await heavy.parseRest({ workspacePath: workspace.path, scipCoverage: scipIndex.coveredFiles });
  const result = await light.writeToArango({
    orgId: input.orgId,
    repoId: input.repoId,
    scipIndex,
    extraEntities,
  });
  return result;
}
```

### New files
```
lib/
  github/
    client.ts              ← GitHub API client (Octokit)
    webhooks.ts            ← Webhook event handlers
  indexer/
    prepare-workspace.ts   ← Full clone + dependency install (npm ci / go mod download / etc.)
    scip-runner.ts         ← Run SCIP indexers, parse protobuf output
    scip-to-arango.ts      ← Transform SCIP definitions/references → ArangoDB nodes/edges
    entity-hash.ts         ← Stable entity hashing for identity tracking
    parser.ts              ← Tree-sitter WASM wrapper (supplement for non-SCIP languages)
    scanner.ts             ← Adapted from code-synapse: fast-glob + gitignore
    writer.ts              ← ArangoDB batch writer
  temporal/
    workflows/
      index-repo.ts        ← indexRepoWorkflow definition
    activities/
      indexing-heavy.ts    ← prepareWorkspace, runSCIP, parseRest (heavy-compute-queue)
      indexing-light.ts    ← writeToArango (light-llm-queue)
app/
  api/
    github/
      callback/route.ts   ← GitHub OAuth callback
      install/route.ts     ← GitHub App installation redirect
    webhooks/
      github/route.ts     ← GitHub push/PR webhooks
    repos/
      route.ts            ← GET repos list, POST connect repo
      [repoId]/route.ts   ← GET repo details, DELETE disconnect
  (dashboard)/
    repos/
      [repoId]/
        page.tsx           ← Repo detail: file tree + entity list
        files/page.tsx     ← Browsable file explorer
```

### Core engine integration

Port these modules from code-synapse (`/Users/jaswanth/IdeaProjects/code-synapse/src/core/`):
- `indexer/scanner.ts` → `lib/indexer/scanner.ts` (file discovery + gitignore — still useful for pre-SCIP filtering)
- `parser/` → `lib/indexer/parser.ts` (tree-sitter WASM — supplementary parsing for non-SCIP languages)

**New (not from code-synapse):**
- `lib/indexer/prepare-workspace.ts` — full clone + dependency install before SCIP
- `lib/indexer/scip-runner.ts` — executes SCIP indexers and parses protobuf output
- `lib/indexer/scip-to-arango.ts` — transforms SCIP graph into ArangoDB collections
- `lib/indexer/entity-hash.ts` — deterministic entity identity hashing

**Adaptation required:**
- Replace CozoDB writes with ArangoDB batch inserts
- Add `repo_id` and `org_id` to all entities for multi-tenancy
- Replace local file paths with cloned tmp paths
- Remove local LLM dependency (justification comes in Phase 4)

### Test
- `pnpm test` — `prepareWorkspace` clones and installs deps; SCIP runner produces valid protobuf with cross-file edges; transformer creates correct ArangoDB documents; entity hashes are stable across re-runs
- `e2e` — Connect GitHub → select repo → see indexing progress (via Temporal query) → browse file tree → see function list with signatures
- **Temporal UI** — Visit `localhost:8080`, see `indexRepoWorkflow` with step-by-step execution history, activities running on `heavy-compute-queue`

---

## Phase 2 — Hosted MCP Server

**Feature:** _"I paste a kap10 MCP URL into Cursor/Claude Code, and my AI agent can search my codebase and inspect functions."_

This is the **core product differentiator** — the hosted MCP endpoint that AI agents connect to.

### What ships
- HTTP+SSE MCP transport endpoint at `/api/mcp/{apiKey}`
- API key provisioning (per-repo, scoped)
- 9 initial MCP tools (read-only, search + inspect + sync)
- Connection instructions in dashboard ("Add to Cursor" copy-paste)
- Auto-PR onboarding (Bootstrap Rule distribution)
- Edge secret scrubbing on all MCP payloads
- Semantic truncation on all MCP responses

### Deployment Constraint: Long-Running Container

**Critical:** MCP over HTTP+SSE requires persistent connections. The server holds an open SSE stream for the duration of the IDE session (minutes to hours). **This cannot run on serverless** (Vercel Functions, AWS Lambda) — those timeout at 10–60 seconds.

**Deployment options:**
- **Fly.io / Railway** — Long-running container with persistent connections, auto-scaling
- **ECS/Fargate** — Container with health checks, ALB with sticky sessions
- **Cloud Run** — With `--session-affinity` and 60-minute timeout configured

The Next.js dashboard can still deploy to Vercel. The MCP server runs as a **separate process** in the same container or a dedicated container:

```
┌────────────────────────┐    ┌──────────────────────┐
│  Vercel (Dashboard)    │    │  Fly.io (MCP Server)  │
│  Next.js SSR/SSG       │    │  Express + SSE         │
│  /dashboard/*           │    │  /api/mcp/:apiKey      │
│  /api/repos/*           │    │  Long-lived connections │
└────────────────────────┘    └──────────────────────┘
```

### MCP tools (Phase 2 set)

| Tool | Description | ArangoDB query pattern |
|------|-------------|----------------------|
| `search_code` | Keyword search across entity names + signatures | `FOR doc IN FULLTEXT(functions, "name", @query)` |
| `get_function` | Get function details + callers + callees | `FOR v, e IN 1..1 ANY @fn calls RETURN v` |
| `get_class` | Get class + methods + inheritance chain | `FOR v IN 1..5 OUTBOUND @cls extends RETURN v` |
| `get_file` | Get file contents + all symbols | `FOR v IN 1..1 OUTBOUND @file contains RETURN v` |
| `get_callers` | Who calls this function? (N-hop) | `FOR v IN 1..@depth INBOUND @fn calls RETURN v` |
| `get_callees` | What does this function call? (N-hop) | `FOR v IN 1..@depth OUTBOUND @fn calls RETURN v` |
| `get_imports` | Module dependency chain | `FOR v IN 1..@depth OUTBOUND @file imports RETURN v` |
| `get_project_stats` | Overview: files, functions, languages | Aggregation query across collections |
| `sync_local_diff` | Sync uncommitted local changes to cloud graph | Parse diff → overlay workspace (see Cross-Cutting §1) |

All tools return responses through the **semantic truncation layer** (see Cross-Cutting §2). All incoming payloads pass through the **edge secret scrubber** (see Cross-Cutting §3).

### MCP transport

```
Client (Cursor)                          kap10 Server (Fly.io)
     │                                        │
     │  GET /api/mcp/{apiKey}                 │
     │  Accept: text/event-stream              │
     │────────────────────────────────────────►│
     │                                        │  Validate API key
     │◄───────────────── SSE connection ──────│  Resolve org + repo + workspace
     │                                        │
     │  POST /api/mcp/{apiKey}                │
     │  { method: "tools/call", ... }         │
     │────────────────────────────────────────►│
     │                                        │  Scrub secrets (edge)
     │                                        │  Route to tool handler
     │◄──────────── SSE event: result ────────│  Query ArangoDB
     │                                        │  Truncate + paginate response
```

### Auto-PR Onboarding

When a user connects a repo, kap10 automatically opens a PR with the Bootstrap Rule and MCP configuration:

```typescript
// lib/onboarding/auto-pr.ts
async function createOnboardingPR(repo: Repo, apiKey: string) {
  const files = [
    {
      path: '.cursor/rules/kap10.mdc',
      content: generateBootstrapRule(),  // Pre-flight/post-flight sync rules
    },
    {
      path: '.cursor/mcp.json',
      content: JSON.stringify({
        mcpServers: {
          kap10: {
            url: `https://mcp.kap10.dev/api/mcp/${apiKey}`,
            transport: 'sse',
          },
        },
      }, null, 2),
    },
  ];

  await octokit.createPullRequest({
    owner: repo.owner,
    repo: repo.name,
    title: 'feat: add kap10 integration',
    body: `## kap10 Integration\n\nThis PR adds:\n- **Bootstrap Rule** (\\`.cursor/rules/kap10.mdc\\`) — ensures your AI agent syncs context before/after code generation\n- **MCP Configuration** (\\`.cursor/mcp.json\\`) — connects your IDE to kap10's knowledge graph\n\nMerge this to enable kap10 for all team members.`,
    branch: 'kap10/onboarding',
    files,
  });
}
```

This PR is opened **once** after the first successful indexing. The user merges it to activate kap10 for all team members.

### New files
```
lib/
  mcp/
    server.ts              ← MCP server factory (per-connection)
    transport.ts           ← HTTP+SSE transport adapter (long-running container)
    security/
      scrubber.ts          ← Edge secret scrubbing (regex + entropy)
    tools/
      index.ts             ← Tool registry
      search.ts            ← search_code tool
      inspect.ts           ← get_function, get_class, get_file
      graph.ts             ← get_callers, get_callees, get_imports
      stats.ts             ← get_project_stats
      sync.ts              ← sync_local_diff tool
    auth.ts                ← API key validation + repo resolution
    formatter.ts           ← Semantic truncation + pagination for LLM consumption
    workspace.ts           ← Workspace resolution (per-user, per-repo, per-branch)
  onboarding/
    auto-pr.ts             ← Create onboarding PR with Bootstrap Rule + MCP config
    bootstrap-rule.ts      ← Generate kap10.mdc content
app/
  api/
    mcp/
      [apiKey]/
        route.ts           ← GET (SSE) + POST (tool calls)
  (dashboard)/
    repos/
      [repoId]/
        connect/page.tsx   ← "Add to your IDE" instructions + API key
```

### Prisma schema additions

```prisma
// Add to existing ApiKey model
model ApiKey {
  // ... existing fields
  repoId     String?  @map("repo_id")
  transport  String   @default("mcp-sse")
  repo       Repo?    @relation(fields: [repoId], references: [id])

  @@map("api_keys")
}

model Workspace {
  id          String   @id @default(uuid())
  userId      String   @map("user_id")
  repoId      String   @map("repo_id")
  branch      String
  baseSha     String?  @map("base_sha")     // commit SHA this overlay is based on
  lastSyncAt  DateTime? @map("last_sync_at")
  expiresAt   DateTime @map("expires_at")    // TTL: 1 hour from last sync
  createdAt   DateTime @default(now()) @map("created_at")

  @@unique([userId, repoId, branch])
  @@map("workspaces")
}
```

### Test
- `pnpm test` — MCP tool handlers return correct ArangoDB data; API key auth works; secret scrubber catches all patterns; response truncation respects byte limits; workspace resolution creates/reuses correctly
- **Manual integration test** — Add MCP URL to Cursor → ask "what functions are in auth.ts?" → get correct answer; paste code with fake API key → verify it's redacted in logs
- `e2e` — Dashboard → repo → "Connect IDE" → copy MCP URL → API key visible; onboarding PR created on GitHub

---

## Phase 3 — Semantic Search (LlamaIndex + Hybrid)

**Feature:** _"I can search my codebase by meaning, not just keywords. 'functions that handle authentication' returns auth middleware, login handlers, session validators."_

### What ships
- Embedding generation during indexing via LlamaIndex.TS
- pgvector storage in Supabase (managed by LlamaIndex PGVectorStore)
- Hybrid search: keyword (ArangoDB fulltext) + semantic (LlamaIndex retrieval) + graph context
- 2 new MCP tools: `semantic_search`, `find_similar`
- Dashboard search bar with results

### Why LlamaIndex.TS (not raw OpenAI + pgvector SQL)

| Aspect | Raw implementation | LlamaIndex.TS |
|--------|-------------------|---------------|
| **Chunking** | Manual text splitting logic | Built-in `SentenceSplitter`, `CodeSplitter` |
| **Embedding** | Raw OpenAI API calls + batch management | `OpenAIEmbedding` with automatic batching |
| **pgvector** | Raw SQL: `SELECT ... ORDER BY embedding <=> $1` | `PGVectorStore` with built-in CRUD, filtering, metadata |
| **Retrieval** | Custom merge/rank logic | `VectorIndexRetriever` + `KeywordTableIndex` composable |
| **Re-ranking** | Manual reciprocal rank fusion | Built-in `SentenceTransformerRerank` or `CohereRerank` |

### Embedding pipeline (via LlamaIndex)

```
Entity extracted (Phase 1)
        │
        ▼
┌───────────────────────────────────────────────────────────────────────┐
│                Temporal: embedRepoWorkflow                            │
│                                                                       │
│  ┌────────────────┐    ┌────────────────┐    ┌────────────────────┐  │
│  │ Activity:       │───▶│ Activity:       │───▶│ Activity:          │  │
│  │ buildDocuments  │    │ generateEmbeds  │    │ storeInPGVector    │  │
│  │                 │    │                 │    │                    │  │
│  │ LlamaIndex     │    │ LlamaIndex      │    │ LlamaIndex         │  │
│  │ Document from   │    │ OpenAIEmbedding │    │ PGVectorStore      │  │
│  │ name+sig+body  │    │ (text-embed-3)  │    │ (Supabase pgvector)│  │
│  └────────────────┘    └────────────────┘    └────────────────────┘  │
│                                                                       │
│  [light-llm-queue] — all activities are network-bound                │
└───────────────────────────────────────────────────────────────────────┘
```

```typescript
// lib/embeddings/llamaindex-store.ts
import { PGVectorStore } from "llamaindex/vector-store/PGVectorStore";
import { OpenAIEmbedding } from "llamaindex/embeddings/OpenAIEmbedding";
import { VectorStoreIndex } from "llamaindex";

const vectorStore = new PGVectorStore({
  connectionString: process.env.SUPABASE_DB_URL,
  tableName: "entity_embeddings",
  dimensions: 1536,
});

const embedModel = new OpenAIEmbedding({
  model: "text-embedding-3-small",
});

// Index documents
const index = await VectorStoreIndex.fromVectorStore(vectorStore, { embedModel });

// Query
const retriever = index.asRetriever({ similarityTopK: 20 });
const results = await retriever.retrieve("functions that handle authentication");
```

### Prisma schema additions

```prisma
model EntityEmbedding {
  id          String   @id @default(uuid())
  repoId      String   @map("repo_id")
  entityKey   String   @map("entity_key")       // ArangoDB document _key
  entityType  String   @map("entity_type")       // function | class | interface
  entityName  String   @map("entity_name")
  filePath    String   @map("file_path")
  textContent String   @map("text_content")      // what was embedded
  embedding   Unsupported("vector(1536)")         // pgvector
  createdAt   DateTime @default(now()) @map("created_at")

  repo        Repo     @relation(fields: [repoId], references: [id], onDelete: Cascade)

  @@index([repoId])
  @@map("entity_embeddings")
}
```

> **Note:** LlamaIndex manages the pgvector index creation and querying. Prisma is used for migrations and non-vector CRUD operations on the same table.

### New MCP tools

| Tool | Description |
|------|-------------|
| `semantic_search` | "Find functions related to authentication" → LlamaIndex retrieval + graph enrichment |
| `find_similar` | "Find code similar to this function" → LlamaIndex nearest neighbors |

### Hybrid search algorithm

```
User query: "functions that validate user permissions"
    │
    ├─► Keyword search (ArangoDB fulltext)           → candidates A
    ├─► Semantic search (LlamaIndex PGVectorStore)   → candidates B
    │
    ▼
Merge + de-duplicate (reciprocal rank fusion)
    │
    ▼
For top 20 results, enrich with graph context (ArangoDB):
  - What file is it in?
  - What does it call / who calls it?
  - What class does it belong to?
    │
    ▼
Semantic truncation → Return top 10 with context (respects MAX_RESPONSE_BYTES)
```

### New files
```
lib/
  embeddings/
    llamaindex-store.ts    ← LlamaIndex PGVectorStore + OpenAIEmbedding setup
    hybrid-search.ts       ← Merge keyword (ArangoDB) + semantic (LlamaIndex) + graph results
  mcp/
    tools/
      semantic.ts          ← semantic_search, find_similar tools
  temporal/
    workflows/
      embed-repo.ts        ← embedRepoWorkflow definition
    activities/
      embedding.ts         ← buildDocuments, generateEmbeds, storeInPGVector activities
app/
  api/
    search/route.ts        ← Update: add semantic search mode
  (dashboard)/
    search/page.tsx        ← Full search UI with filters
```

### Temporal workflows

| Workflow | Activities | Queue | What it does |
|----------|-----------|-------|--------------|
| `embedRepoWorkflow` | `buildDocuments` → `generateEmbeds` → `storeInPGVector` | `light-llm-queue` | Batch embed all entities for a repo. Resumes from last embedded batch on failure. |

### Test
- `pnpm test` — LlamaIndex retriever returns relevant results; hybrid merge works correctly
- **Manual** — MCP `semantic_search` "error handling" returns catch blocks, error boundaries, validators
- `e2e` — Dashboard search "authentication" → relevant functions appear with file paths

---

## Phase 4 — Business Justification & Taxonomy Layer (Vercel AI SDK)

**Feature:** _"Every function in my codebase has a plain-English 'why it exists' explanation and a VERTICAL/HORIZONTAL/UTILITY classification. AI agents use this to write code that fits the existing architecture. I can see a Blueprint Dashboard showing my system's business swimlanes."_

This is the **"institutional memory"** — what makes kap10 more than a code search tool.

### What ships
- LLM-powered justification of every entity (purpose, feature area, business value)
- **VERTICAL / HORIZONTAL / UTILITY taxonomy** — every entity classified
- Hierarchical processing: leaf functions → mid-level → entry points
- Powered by Vercel AI SDK with structured output (Zod schemas)
- Justifications + classifications stored in ArangoDB, searchable via MCP
- **Features collection** — business capabilities extracted from classification data
- 4 new MCP tools: `get_business_context`, `search_by_purpose`, `analyze_impact`, `get_blueprint`
- Dashboard: entity detail page shows justification + confidence
- **Blueprint Dashboard** — React Flow visualization of business swimlanes

### Why Vercel AI SDK (not raw OpenAI/Anthropic SDKs)

| Aspect | Raw SDKs | Vercel AI SDK |
|--------|---------|---------------|
| **Provider switching** | Different SDK per provider, different APIs | `generateObject({ model: openai('gpt-4o') })` → `model: anthropic('claude-3.5-haiku')` — one-line swap |
| **Structured output** | Manual JSON parsing + validation | `generateObject({ schema: z.object({...}) })` — Zod schema in, typed object out |
| **Streaming** | Different streaming APIs per provider | Unified `streamText()` / `streamObject()` |
| **Tool calling** | Different tool formats per provider | Unified tool definition format |
| **Cost tracking** | Manual token counting | Built-in `usage` in response |
| **Next.js integration** | Manual route handlers | Native Server Actions + `useChat` hook |

### Entity Taxonomy: VERTICAL / HORIZONTAL / UTILITY

Every entity in the codebase is classified into one of three types:

| Type | Definition | Examples | Extraction Method |
|------|-----------|----------|-------------------|
| **VERTICAL** | Business-specific feature code. Implements a user-facing capability. | `createOrder()`, `validateCheckout()`, `sendInvoiceEmail()` | LLM analyzes entity + callers/callees + file path → extracts `userFlows[]` |
| **HORIZONTAL** | Cross-cutting infrastructure shared by multiple verticals. | `rateLimit()`, `authenticate()`, `logger.info()`, `db.query()` | LLM identifies technology type: auth, logging, caching, etc. |
| **UTILITY** | Pure helpers with no business logic or infrastructure opinion. | `formatDate()`, `slugify()`, `chunk()`, `deepMerge()` | LLM detects: no side effects, no domain terms, generic signature |

#### Taxonomy Schema (Zod)

```typescript
// lib/ai/taxonomy.ts
import { z } from 'zod';

const UserFlowSchema = z.object({
  name: z.string().describe("User flow name, e.g. 'Checkout Flow', 'User Registration'"),
  step: z.string().describe("What step this entity represents in the flow"),
  actors: z.array(z.string()).describe("Who triggers this: 'customer', 'admin', 'system'"),
});

const TaxonomySchema = z.object({
  type: z.enum(['VERTICAL', 'HORIZONTAL', 'UTILITY']),

  // VERTICAL-specific
  userFlows: z.array(UserFlowSchema).optional()
    .describe("Only for VERTICAL: which user-facing flows does this participate in?"),
  featureArea: z.string().optional()
    .describe("Only for VERTICAL: business feature area (e.g. 'Checkout', 'User Management')"),

  // HORIZONTAL-specific
  technologyType: z.string().optional()
    .describe("Only for HORIZONTAL: infrastructure type (e.g. 'authentication', 'caching', 'logging', 'database')"),
  consumers: z.array(z.string()).optional()
    .describe("Only for HORIZONTAL: which feature areas depend on this?"),

  // Common
  purpose: z.string().describe("What this entity does in plain English"),
  businessValue: z.string().describe("Why this code exists — what business need it serves"),
  confidence: z.number().min(0).max(1).describe("How confident are you in this analysis"),
});
```

### Justification + Taxonomy pipeline

```
┌───────────────────────────────────────────────────────────────────────┐
│                 Temporal: justifyRepoWorkflow                         │
│                                                                       │
│  ┌──────────────┐    ┌──────────────────────────────────────────┐    │
│  │ Activity:     │───▶│ Activity: classifyAndJustify (fan-out)   │    │
│  │ topoSort      │    │                                          │    │
│  │               │    │  Level 0: Leaf functions                  │    │
│  │ Build dep     │    │  → AI SDK: generateObject({ model,       │    │
│  │ order from    │    │       schema: TaxonomySchema })           │    │
│  │ call graph    │    │                                          │    │
│  │               │    │  Level 1: Functions calling Level 0      │    │
│  │               │    │  → Same + context from Level 0 results   │    │
│  │               │    │                                          │    │
│  │               │    │  Level N: Entry points                   │    │
│  │               │    │  → Full context chain                    │    │
│  └──────────────┘    └──────────────────────────────────────────┘    │
│                                          │                            │
│  [heavy: topoSort]                       │ [light: classify/justify]  │
│                                          ▼                            │
│                     ┌─────────────────────────────────────────┐      │
│                     │ Activity: writeResults                   │      │
│                     │  → justifications collection             │      │
│                     │  → classifications collection            │      │
│                     │  → features collection (aggregated)      │      │
│                     └─────────────────────────────────────────┘      │
└───────────────────────────────────────────────────────────────────────┘
```

### LLM routing (via Vercel AI SDK)

```typescript
// lib/ai/justify.ts
import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';

// Model routing by complexity — one-line provider switch
function getModel(complexity: 'simple' | 'complex' | 'fallback') {
  switch (complexity) {
    case 'simple':   return openai('gpt-4o-mini');
    case 'complex':  return openai('gpt-4o');
    case 'fallback': return anthropic('claude-3-5-haiku-latest');
  }
}

export async function classifyAndJustifyEntity(entity: Entity, depsContext: string) {
  const { object, usage } = await generateObject({
    model: getModel(entity.complexity),
    schema: TaxonomySchema,
    prompt: `Analyze this code entity and classify it.

Entity: ${entity.name} (${entity.kind})
File: ${entity.filePath}
Code:
${entity.code}

Callers: ${entity.callerNames.join(', ')}
Callees: ${entity.calleeNames.join(', ')}

Dependency context (already-classified callees):
${depsContext}

Classify as VERTICAL (business feature), HORIZONTAL (infrastructure), or UTILITY (pure helper).
If VERTICAL, identify which user-facing flows it participates in.
If HORIZONTAL, identify the technology type and which features depend on it.`,
  });

  return { taxonomy: object, tokensUsed: usage };
}
```

| Tier | Model | Use case | Cost |
|------|-------|----------|------|
| **Default** | `openai('gpt-4o-mini')` | Leaf functions, simple utilities | ~$0.15/1M tokens |
| **Quality** | `openai('gpt-4o')` | Entry points, complex business logic, VERTICAL entities | ~$2.50/1M tokens |
| **Fallback** | `anthropic('claude-3-5-haiku-latest')` | If OpenAI unavailable | ~$0.25/1M tokens |

Route by entity complexity: simple signature → Mini, complex with many deps → 4o.

### New ArangoDB collections

```
org_{org_id}/
  ├── justifications      (document collection)
  │   {
  │     _key: "justification_{entity_key}",
  │     entity_key: "fn_abc123",
  │     purpose: "Validates JWT token and extracts user claims",
  │     business_value: "Ensures only authenticated users access protected routes",
  │     confidence: 0.92,
  │     model_used: "gpt-4o-mini",
  │     processing_level: 0,
  │     tokens_used: { input: 1240, output: 85 },
  │     created_at: "2026-02-17T..."
  │   }
  │
  ├── classifications     (document collection)
  │   {
  │     _key: "class_{entity_key}",
  │     entity_key: "fn_abc123",
  │     type: "HORIZONTAL",              -- VERTICAL | HORIZONTAL | UTILITY
  │     feature_area: null,              -- only for VERTICAL
  │     user_flows: null,                -- only for VERTICAL
  │     technology_type: "authentication", -- only for HORIZONTAL
  │     consumers: ["Checkout", "User Management", "Admin Panel"],  -- only for HORIZONTAL
  │   }
  │
  ├── features            (document collection — aggregated from classifications)
  │   {
  │     _key: "feature_checkout",
  │     name: "Checkout",
  │     type: "VERTICAL",
  │     entity_count: 47,
  │     entry_points: ["fn_createOrder", "fn_processPayment", "fn_validateCart"],
  │     user_flows: [
  │       { name: "Checkout Flow", steps: 8, actors: ["customer"] },
  │       { name: "Refund Flow", steps: 5, actors: ["customer", "admin"] }
  │     ],
  │     horizontal_dependencies: ["authentication", "database", "email"],
  │     confidence_avg: 0.87,
  │     updated_at: "2026-02-17T..."
  │   }
  │
  ├── justified_by        (edge: entity → justification)
  ├── classified_as       (edge: entity → classification)
  └── belongs_to_feature  (edge: entity → feature)
```

### Blueprint Dashboard

The features collection powers a **Blueprint Dashboard** — a React Flow graph showing the system's business architecture:

```
┌─────────────────────────────────────────────────────────────┐
│  Blueprint Dashboard                                         │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  VERTICALS (Business Swimlanes)                      │    │
│  │                                                       │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │    │
│  │  │ Checkout  │  │ User Mgmt│  │ Admin Panel      │  │    │
│  │  │ 47 files  │  │ 32 files │  │ 18 files         │  │    │
│  │  │ 8 flows   │  │ 5 flows  │  │ 3 flows          │  │    │
│  │  └─────┬─────┘  └─────┬────┘  └────────┬─────────┘  │    │
│  │        │               │                │             │    │
│  ├────────┼───────────────┼────────────────┼─────────────┤    │
│  │  HORIZONTALS (Infrastructure Layer)                    │    │
│  │                                                       │    │
│  │  ┌───────────┐  ┌─────────┐  ┌────────┐  ┌────────┐│    │
│  │  │   Auth    │  │   DB    │  │ Cache  │  │ Email  ││    │
│  │  │ 12 files  │  │ 8 files │  │ 4 files│  │ 6 files││    │
│  │  └───────────┘  └─────────┘  └────────┘  └────────┘│    │
│  │                                                       │    │
│  ├───────────────────────────────────────────────────────┤    │
│  │  UTILITIES (Helper Layer)                              │    │
│  │  formatDate, slugify, chunk, deepMerge, ...  (28)     │    │
│  └───────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

**Implementation:** React Flow with custom nodes. Verticals are swimlane nodes with entity counts and flow lists. Horizontals are infrastructure nodes with consumer edges pointing up to verticals. Edges represent `belongs_to_feature` relationships.

### New MCP tools

| Tool | Description | Query pattern |
|------|-------------|---------------|
| `get_business_context` | "Why does this function exist?" | Fetch justification + classification + feature for entity |
| `search_by_purpose` | "Find all billing-related code" | `FOR j IN justifications FILTER j.feature_area == "Billing"` |
| `analyze_impact` | "What breaks if I change this?" | `FOR v IN 1..5 INBOUND @fn calls RETURN v` + justification + feature context |
| `get_blueprint` | "Show me the system architecture" | Aggregate features collection → return business swimlanes with entity counts |

### New files
```
lib/
  ai/
    justify.ts             ← Vercel AI SDK: generateObject with TaxonomySchema + model routing
    taxonomy.ts            ← TaxonomySchema, UserFlowSchema Zod definitions
    models.ts              ← Model configuration + routing logic
  justification/
    pipeline.ts            ← Orchestrates hierarchical justification + classification
    topological-sort.ts    ← Build processing order from call graph
    prompt-builder.ts      ← Constructs prompts with dependency context
    store.ts               ← ArangoDB justification + classification + feature CRUD
    feature-aggregator.ts  ← Aggregate classifications into features collection
  temporal/
    workflows/
      justify-repo.ts      ← justifyRepoWorkflow definition
    activities/
      justification.ts     ← topoSort (heavy), classifyAndJustify (light), writeResults (light)
  mcp/
    tools/
      business.ts          ← get_business_context, search_by_purpose, analyze_impact, get_blueprint
app/
  (dashboard)/
    repos/
      [repoId]/
        entities/
          [entityId]/
            page.tsx       ← Entity detail: code + justification + classification + graph
        blueprint/
          page.tsx         ← Blueprint Dashboard (React Flow)
```

### Temporal workflows

| Workflow | Activities | Queue | What it does |
|----------|-----------|-------|--------------|
| `justifyRepoWorkflow` | `topoSort` → `classifyAndJustify` (×N levels) → `writeResults` → `aggregateFeatures` | Heavy (topoSort), Light (rest) | Full hierarchical justification + taxonomy. If level 3 fails due to API rate limit, Temporal retries level 3 — not the entire pipeline. |
| `justifyEntityWorkflow` | `classifyAndJustify` → `writeResult` → `updateFeature` | `light-llm-queue` | Re-justify + re-classify a single entity after code change. |

### Test
- `pnpm test` — topological sort produces correct level ordering; Vercel AI SDK `generateObject` returns typed taxonomy; feature aggregation groups correctly
- **Manual** — MCP `get_business_context` for a login handler → returns "HORIZONTAL / authentication / Consumers: User Management, Checkout, Admin"
- **Manual** — MCP `get_blueprint` → returns features list with entity counts and user flows
- `e2e` — Dashboard → entity detail → justification + classification card; Dashboard → Blueprint → React Flow graph with business swimlanes

---

## Phase 5 — Incremental Indexing & GitHub Webhooks

**Feature:** _"When I push to GitHub, kap10 automatically re-indexes only the changed files. My MCP connection always has up-to-date knowledge."_

### What ships
- GitHub `push` webhook handler → detect changed files → re-index only those
- Temporal workflow: `incrementalIndexWorkflow` — diff-based processing
- Cascade re-justification: if a leaf function changes, re-justify its callers
- **Stable entity hash comparison** for detecting renames/deletes (see Phase 1)
- Dashboard: real-time indexing status feed
- MCP tool: `get_recent_changes`

### Incremental pipeline (Temporal workflow)

```
┌───────────────────────────────────────────────────────────────────────┐
│              Temporal: incrementalIndexWorkflow                        │
│                                                                       │
│  ┌──────────────┐    ┌──────────────────────────┐                    │
│  │ Activity:     │───▶│ Fan-out per changed file: │                    │
│  │ extractDiff   │    │                            │                    │
│  │               │    │  Modified/Added:            │                    │
│  │ From webhook  │    │  ├─ prepareFile             │                    │
│  │ payload:      │    │  ├─ reIndex (SCIP or TS)    │                    │
│  │ added,        │    │  ├─ compareEntityHashes     │                    │
│  │ modified,     │    │  │   ├─ same hash → update  │                    │
│  │ removed       │    │  │   ├─ new hash → insert   │                    │
│  │               │    │  │   └─ old hash gone →      │                    │
│  │               │    │  │       delete + cascade    │                    │
│  └──────────────┘    │  ├─ updateArango            │                    │
│                       │  └─ reEmbed                  │                    │
│                       │                            │                    │
│                       │  Removed:                    │                    │
│                       │  ├─ deleteEntities           │                    │
│                       │  ├─ deleteEdges              │                    │
│                       │  └─ deleteEmbeddings         │                    │
│                       └──────────────┬───────────────┘                    │
│                                      │                                    │
│                                      ▼                                    │
│                          ┌──────────────────┐                            │
│                          │ Activity:          │                            │
│                          │ cascadeReJustify   │                            │
│                          │ (1-2 hop callers)  │                            │
│                          └──────────────────┘                            │
└───────────────────────────────────────────────────────────────────────┘
```

### Entity Hash Comparison (Delete/Rename Detection)

When a file is modified, the incremental indexer:

1. Re-indexes the file → produces new entity set with hashes
2. Loads old entity hashes for that file from ArangoDB
3. Compares:

```typescript
// lib/indexer/incremental.ts
function diffEntitySets(
  oldEntities: Map<string, EntityRecord>,  // hash → entity
  newEntities: Map<string, EntityRecord>,
): { added: EntityRecord[]; updated: EntityRecord[]; deleted: EntityRecord[] } {
  const added: EntityRecord[] = [];
  const updated: EntityRecord[] = [];
  const deleted: EntityRecord[] = [];

  for (const [hash, entity] of newEntities) {
    if (oldEntities.has(hash)) {
      updated.push(entity);  // Same identity, possibly new content
    } else {
      added.push(entity);    // New entity
    }
  }

  for (const [hash, entity] of oldEntities) {
    if (!newEntities.has(hash)) {
      deleted.push(entity);  // Entity removed or renamed
    }
  }

  return { added, updated, deleted };
}
```

For **deleted** entities:
- Remove the entity document from ArangoDB
- Remove all edges (calls, imports, extends, implements) involving this entity
- Remove the embedding from pgvector
- Remove the justification and classification
- **Cascade:** Re-justify all entities that previously called this entity (they now have a broken dependency)

### Cascade re-justification

When function `A` changes:
1. Re-justify `A` itself (via Vercel AI SDK)
2. Find all callers of `A` (1 hop inbound on `calls` edge)
3. If `A`'s justification changed significantly (cosine distance > 0.3), re-justify callers too
4. Cap cascade at 2 hops to prevent runaway costs
5. If `A` was deleted, cascade immediately (callers lost a dependency)

### New files
```
lib/
  indexer/
    incremental.ts         ← Diff-based indexing: detect what changed, entity hash comparison
    cascade.ts             ← Re-justification cascade logic
  github/
    webhook-handlers/
      push.ts              ← Handle push events → trigger incrementalIndexWorkflow
      installation.ts      ← Handle app install/uninstall
  temporal/
    workflows/
      incremental-index.ts ← incrementalIndexWorkflow definition
    activities/
      incremental.ts       ← extractDiff, reIndex, compareEntityHashes, cascadeReJustify activities
app/
  api/
    webhooks/
      github/route.ts      ← Updated: route to specific handlers
  (dashboard)/
    repos/
      [repoId]/
        activity/page.tsx   ← Indexing activity feed (real-time via Temporal queries)
```

### New MCP tools

| Tool | Description |
|------|-------------|
| `get_recent_changes` | "What changed in the last push?" → changed entities with before/after + cascade status |

### Test
- `pnpm test` — incremental indexer correctly diffs using entity hashes; detects renames/deletes; cascade re-justification triggers for changed dependencies
- **Manual** — Push a commit changing 1 file → only that file re-indexed → MCP query reflects new code within 30s; Delete a function → callers get re-justified
- **Manual** — Rename a function → old entity deleted, new entity created, callers re-justified
- **Temporal UI** — `incrementalIndexWorkflow` shows each file processed as a separate activity
- `e2e` — Dashboard activity feed shows "Indexed 3 files from push abc123" with entity diff counts

---

## Phase 6 — Pattern Enforcement & Rules Engine (ast-grep + Semgrep)

**Feature:** _"kap10 learns my codebase patterns AND enforces my team's explicit architectural rules. Agents always know the conventions — even when .cursorrules falls out of context."_

This is the **"AI Tech Lead"** — the feature that justifies the product name.

### What ships
- Pattern detection via **ast-grep** (structural code search) + **Semgrep** (rule-based static analysis)
- LLM auto-generates Semgrep YAML rules from detected patterns (via Vercel AI SDK)
- Pattern rules stored in ArangoDB (auto-detected + user-defined)
- **Rules Engine** — hierarchical architectural & syntactic rules at project and workspace levels
- MCP tools to inject rules into agent context on every query (replaces fragile .cursorrules)
- MCP tool `check_patterns` — AI agent asks "does this code follow conventions?" before writing
- MCP tool `get_conventions` — "what are the patterns in this codebase?"
- Dashboard: pattern library with confidence scores + ability to pin/dismiss

### Why ast-grep + Semgrep (not custom AST traversal)

#### ast-grep — Structural code search

Instead of writing AST visitor code per pattern, write **one-line structural queries**:

```yaml
# "Does this route handler use zod validation?"
# ast-grep pattern:
rule:
  pattern: const $SCHEMA = z.object({ $$$ })
  inside:
    kind: program
    has:
      pattern: export async function $METHOD(request) { $$$ }
```

| Custom Tree-sitter | ast-grep |
|--------------------|----------|
| 50+ lines of AST visitor per pattern | 3-5 line YAML rule |
| Must handle edge cases per language | Tree-sitter-based, handles all syntax variants |
| Hard to maintain, hard to read | Declarative, human-readable patterns |

#### Semgrep — Rule-based enforcement

Once patterns are detected, kap10 auto-generates **Semgrep rules** that can be executed deterministically:

```yaml
# Auto-generated Semgrep rule
rules:
  - id: kap10.missing-rate-limit
    pattern: |
      export async function $HANDLER(request: NextRequest) {
        ...
      }
    pattern-not-inside: |
      const $LIMIT = await rateLimit(...)
      ...
      export async function $HANDLER(request: NextRequest) {
        ...
      }
    message: "API route handler missing rate limiting. All routes in this codebase use rateLimit()."
    severity: WARNING
    languages: [typescript]
```

**The magic:** An LLM (via Vercel AI SDK) analyzes ast-grep detection results and **auto-generates Semgrep YAML rules**. These rules are then executed deterministically — no LLM needed at check time.

### Pattern types

| Pattern | Detection tool | Enforcement tool |
|---------|---------------|-----------------|
| **Structural** — "All API routes use `zod` validation" | ast-grep: find all route handlers, check for zod import | Semgrep: auto-generated rule |
| **Naming** — "React hooks are prefixed `use`" | ast-grep: `pattern: function use$NAME()` | Semgrep: naming convention rule |
| **Architectural** — "Data access goes through `lib/db/`" | ArangoDB import graph analysis | Semgrep: forbidden import pattern |
| **Error handling** — "All async handlers wrap in try/catch" | ast-grep: `pattern: async function $F() { try { $$$ } catch ($E) { $$$ } }` | Semgrep: missing try-catch rule |
| **Testing** — "Every `lib/` module has `__tests__/` companion" | File tree analysis (fast-glob) | Dashboard warning (no Semgrep needed) |

### Pattern detection pipeline

```
┌───────────────────────────────────────────────────────────────────────┐
│              Temporal: detectPatternsWorkflow                          │
│                                                                       │
│  ┌────────────────┐    ┌──────────────────┐    ┌──────────────────┐  │
│  │ Activity:       │───▶│ Activity:         │───▶│ Activity:         │  │
│  │ astGrepScan     │    │ llmSynthesizeRules│    │ storePatterns     │  │
│  │                 │    │                   │    │                   │  │
│  │ Run ast-grep    │    │ Vercel AI SDK:    │    │ Store in ArangoDB │  │
│  │ structural      │    │ generateObject()  │    │ + generated       │  │
│  │ queries across  │    │ → Semgrep YAML    │    │   Semgrep rules   │  │
│  │ codebase        │    │ for each pattern  │    │   as artifacts    │  │
│  └────────────────┘    └──────────────────┘    └──────────────────┘  │
│                                                                       │
│  [heavy: astGrepScan] [light: llmSynthesize] [light: store]         │
└───────────────────────────────────────────────────────────────────────┘
```

```typescript
// lib/patterns/ast-grep-scanner.ts
import { lang, parse } from '@ast-grep/napi';

// Find all Next.js API route handlers
const routeHandlers = parse(lang.TypeScript, sourceCode).root().findAll({
  rule: {
    pattern: 'export async function $METHOD($$$PARAMS) { $$$BODY }',
    inside: { kind: 'program' },
  },
});

// Check which ones use rateLimit
const withRateLimit = routeHandlers.filter(node =>
  node.findAll({ rule: { pattern: 'rateLimit($$$)' } }).length > 0
);

const adherenceRate = withRateLimit.length / routeHandlers.length;
// → 12/14 = 0.857 → high confidence pattern
```

```typescript
// lib/patterns/rule-generator.ts
import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

const SemgrepRuleSchema = z.object({
  id: z.string(),
  pattern: z.string(),
  patternNotInside: z.string().optional(),
  message: z.string(),
  severity: z.enum(['ERROR', 'WARNING', 'INFO']),
  languages: z.array(z.string()),
});

// LLM generates Semgrep rule from ast-grep detection results
const { object: rule } = await generateObject({
  model: openai('gpt-4o'),
  schema: SemgrepRuleSchema,
  prompt: `Given this detected codebase pattern:
    - 12 out of 14 API route handlers use rateLimit() middleware
    - Example with pattern: ${exampleCode}
    - Example without pattern: ${counterExample}
    Generate a Semgrep rule that catches violations.`,
});
```

### Rules Engine — Hierarchical Architectural & Syntactic Rules

#### The Problem with .cursorrules

Cursor rules (`.cursorrules`, `.cursor/rules/*.mdc`) are static files that get loaded into the agent's context window. They work great initially, but:

1. **Context rot:** As the conversation grows, rules get pushed out of the context window. The agent "forgets" your conventions mid-session.
2. **One-size-fits-all:** The entire rules file is loaded regardless of what the agent is working on. Irrelevant rules waste context tokens.
3. **No team coordination:** Individual `.cursorrules` files aren't shared across the team. Everyone's AI writes code differently.
4. **No hierarchy:** Can't have org-wide rules + repo-specific overrides + personal preferences layered correctly.

#### The Solution: kap10 Rules Engine

Rules are stored in ArangoDB, organized hierarchically, and **injected via MCP on every query** — the agent asks kap10 "what rules apply here?" and gets only the relevant subset for the current file/context. Rules never fall out of context because they're fetched fresh on every tool call.

```
Rule Hierarchy (most specific wins on conflict):
┌─────────────────────────────────────────────┐
│  Org-level rules                             │
│  "All repos use ESM imports, never CommonJS" │
│  ├── Repo-level rules (project)              │
│  │   "This repo uses Prisma, never raw SQL"  │
│  │   ├── Path-scoped rules                   │
│  │   │   "Files in app/api/ must use zod"    │
│  │   └── Branch-scoped rules                 │
│  │       "feature/* branches need tests"     │
│  └── Workspace-level rules (personal)        │
│      "I prefer early returns over nested if" │
│      "Use named exports, not default"        │
└─────────────────────────────────────────────┘
```

#### Rule Types

| Type | Scope | Created by | Examples |
|------|-------|-----------|----------|
| **Architectural** | Org / Repo | Tech lead, architect | "All API routes go through `lib/api/`, never direct DB access from route handlers", "Use repository pattern for data access" |
| **Syntactic** | Org / Repo / Path | Team leads | "React components use named exports", "Prefer `const` arrow functions for components", "Error messages must be user-facing strings, not raw errors" |
| **Convention** | Repo / Path | Auto-detected (Phase 6) + human-pinned | "All hooks are prefixed `use`", "Test files are colocated in `__tests__/`" |
| **Styling** | Workspace (personal) | Individual developer | "I prefer early returns", "Use explicit type annotations on function signatures", "Prefer `map/filter` over `for` loops" |
| **Team standard** | Org | Engineering manager | "All PRs must have a description >50 chars", "No `any` type in TypeScript", "All API responses follow the envelope pattern `{ data, error, meta }`" |

#### Rule Schema

```typescript
// lib/rules/schema.ts
import { z } from 'zod';

const RuleSchema = z.object({
  id: z.string(),
  title: z.string().describe("Short name: 'No raw SQL in route handlers'"),
  description: z.string().describe("Full explanation with rationale"),
  type: z.enum(['architectural', 'syntactic', 'convention', 'styling', 'team_standard']),
  scope: z.enum(['org', 'repo', 'path', 'branch', 'workspace']),

  // Targeting — which files/contexts does this rule apply to?
  pathGlob: z.string().optional().describe("Glob pattern: 'app/api/**/*.ts', '**/components/**'"),
  fileTypes: z.array(z.string()).optional().describe("File extensions: ['ts', 'tsx']"),
  entityKinds: z.array(z.string()).optional().describe("Entity types: ['function', 'class']"),

  // Enforcement
  enforcement: z.enum(['suggest', 'warn', 'block']).default('warn'),
  semgrepRule: z.string().optional().describe("Optional Semgrep YAML for automated checking"),
  example: z.string().optional().describe("Code example showing the correct pattern"),
  counterExample: z.string().optional().describe("Code example showing the violation"),

  // Ownership
  createdBy: z.string().describe("userId or 'auto-detected'"),
  orgId: z.string(),
  repoId: z.string().optional(),     // null = org-wide
  branch: z.string().optional(),     // null = all branches
  workspaceUserId: z.string().optional(), // null = shared, set = personal

  priority: z.number().default(0).describe("Higher number = higher priority on conflict"),
  status: z.enum(['active', 'draft', 'archived']).default('active'),
});
```

#### Rule Resolution — What the Agent Sees

When the agent calls any MCP tool (or the Bootstrap Rule forces a pre-flight `get_rules` call), kap10 resolves the applicable rules:

```typescript
// lib/rules/resolver.ts
async function resolveRules(ctx: {
  orgId: string;
  repoId: string;
  branch: string;
  userId: string;
  filePath?: string;        // current file the agent is working on
  entityKind?: string;      // function, class, etc.
}): Promise<Rule[]> {
  // 1. Fetch all potentially applicable rules
  const candidates = await arangoDB.query(aql`
    FOR rule IN rules
      FILTER rule.org_id == ${ctx.orgId}
      FILTER rule.status == 'active'
      FILTER rule.repo_id == null OR rule.repo_id == ${ctx.repoId}
      FILTER rule.branch == null OR rule.branch == ${ctx.branch}
      FILTER rule.workspace_user_id == null OR rule.workspace_user_id == ${ctx.userId}
      RETURN rule
  `);

  // 2. Filter by path glob (if filePath provided)
  let applicable = candidates;
  if (ctx.filePath) {
    applicable = candidates.filter(rule =>
      !rule.pathGlob || minimatch(ctx.filePath, rule.pathGlob)
    );
  }

  // 3. Filter by entity kind
  if (ctx.entityKind) {
    applicable = applicable.filter(rule =>
      !rule.entityKinds || rule.entityKinds.includes(ctx.entityKind)
    );
  }

  // 4. Sort by specificity (workspace > branch > path > repo > org) then priority
  applicable.sort((a, b) => {
    const scopeOrder = { workspace: 5, branch: 4, path: 3, repo: 2, org: 1 };
    const scopeDiff = (scopeOrder[b.scope] || 0) - (scopeOrder[a.scope] || 0);
    return scopeDiff !== 0 ? scopeDiff : b.priority - a.priority;
  });

  // 5. Deduplicate — most specific rule wins on conflict (same title)
  const seen = new Set<string>();
  return applicable.filter(rule => {
    if (seen.has(rule.title)) return false;
    seen.add(rule.title);
    return true;
  });
}
```

#### MCP Integration — Rules Injected on Every Call

The Bootstrap Rule (`.cursor/rules/kap10.mdc`) ensures the agent fetches rules before writing code:

```markdown
## Pre-flight (before ANY code generation task)
1. Call `sync_local_diff` with the current git diff
2. Call `get_rules` for the file you're about to modify
3. Follow ALL returned rules — they override any conflicting .cursorrules
```

The `get_rules` MCP tool returns a compact, context-efficient rule summary:

```typescript
// Example MCP response for get_rules({ filePath: "app/api/billing/route.ts" })
{
  "data": [
    {
      "title": "API routes must use zod validation",
      "enforcement": "block",
      "description": "All request bodies validated with z.object() before processing",
      "example": "const body = RequestSchema.parse(await req.json());"
    },
    {
      "title": "No raw SQL in route handlers",
      "enforcement": "warn",
      "description": "Use Prisma client, never raw queries. Data access through lib/db/."
    },
    {
      "title": "Rate limiting on all public endpoints",
      "enforcement": "warn",
      "description": "Wrap handler with rateLimit() middleware",
      "example": "const limit = await rateLimit(req); if (!limit.success) return NextResponse.json({ error: 'Rate limited' }, { status: 429 });"
    }
  ],
  "meta": { "totalRules": 3, "scope": "repo + org" }
}
```

### New ArangoDB collections

```
org_{org_id}/
  ├── patterns            (document collection)
  │   {
  │     _key: "pattern_{hash}",
  │     type: "structural",
  │     rule: "All API routes use zod request validation",
  │     evidence: ["app/api/auth/route.ts:15", "app/api/billing/route.ts:8", ...],
  │     evidence_count: 12,
  │     total_instances: 14,
  │     adherence_rate: 0.857,
  │     confidence: 0.91,
  │     status: "active",                 -- active | dismissed | pinned
  │     source: "auto-detected",          -- auto-detected | user-defined
  │     semgrep_rule: "rules:\n  - id: ...",  -- generated Semgrep YAML
  │     ast_grep_query: "pattern: ...",   -- original detection query
  │     created_at: "2026-02-17T..."
  │   }
  │
  └── rules               (document collection)
      {
        _key: "rule_{uuid}",
        title: "API routes must use zod validation",
        description: "All request bodies validated with z.object()...",
        type: "architectural",            -- architectural | syntactic | convention | styling | team_standard
        scope: "repo",                    -- org | repo | path | branch | workspace
        org_id: "org_abc",
        repo_id: "repo_xyz",             -- null = org-wide
        branch: null,                     -- null = all branches
        workspace_user_id: null,          -- null = shared, set = personal
        path_glob: "app/api/**/*.ts",     -- null = all files
        file_types: ["ts", "tsx"],
        entity_kinds: null,
        enforcement: "block",             -- suggest | warn | block
        semgrep_rule: "rules:\n  ...",    -- optional auto-enforcement
        example: "const body = Schema.parse(...);\n...",
        counter_example: "const body = req.body;\n...",
        priority: 10,
        status: "active",
        created_by: "user_123",
        created_at: "2026-02-17T...",
        updated_at: "2026-02-17T..."
      }
```

### New MCP tools

| Tool | Description |
|------|-------------|
| `check_patterns` | Agent sends proposed code → kap10 runs Semgrep rules against it → returns violations with examples |
| `get_conventions` | "What are the coding conventions?" → returns active patterns with examples |
| `suggest_approach` | "I need to add a new API route" → returns template based on existing patterns |
| `get_rules` | **Fetch all applicable rules for the current file/context.** Returns hierarchically resolved rules (org → repo → path → workspace). Called in pre-flight by Bootstrap Rule. |
| `check_rules` | Agent sends proposed code → kap10 checks against applicable rules (both explicit rules AND auto-detected patterns) → returns violations sorted by enforcement level |

### New files
```
lib/
  patterns/
    ast-grep-scanner.ts    ← ast-grep structural queries: detect recurring patterns
    rule-generator.ts      ← Vercel AI SDK: LLM generates Semgrep YAML from detected patterns
    semgrep-runner.ts      ← Execute Semgrep rules against code snippets
    checker.ts             ← Orchestrates: receive code → run Semgrep → return violations
    store.ts               ← ArangoDB pattern CRUD
  rules/
    schema.ts              ← RuleSchema Zod definition
    resolver.ts            ← Hierarchical rule resolution (org → repo → path → workspace)
    store.ts               ← ArangoDB rules CRUD
    seed.ts                ← Convert auto-detected patterns (confidence > 0.9) into explicit rules
  temporal/
    workflows/
      detect-patterns.ts   ← detectPatternsWorkflow definition
    activities/
      patterns.ts          ← astGrepScan (heavy), llmSynthesizeRules (light), storePatterns (light)
  mcp/
    tools/
      patterns.ts          ← check_patterns, get_conventions, suggest_approach
      rules.ts             ← get_rules, check_rules
app/
  api/
    patterns/
      route.ts             ← GET patterns, POST user-defined pattern
      [patternId]/route.ts ← PATCH (pin/dismiss), DELETE
    rules/
      route.ts             ← GET rules (filtered by scope), POST create rule
      [ruleId]/route.ts    ← PATCH (update/archive), DELETE
  (dashboard)/
    repos/
      [repoId]/
        patterns/page.tsx   ← Pattern library: list, pin, dismiss, add custom
        rules/page.tsx      ← Rules management: create, edit, organize by scope
        rules/new/page.tsx  ← Rule creation wizard (type, scope, targeting, examples)
    settings/
      rules/page.tsx       ← Org-level rules management
```

### Temporal workflows

| Workflow | Activities | Queue | What it does |
|----------|-----------|-------|--------------|
| `detectPatternsWorkflow` | `astGrepScan` → `llmSynthesizeRules` → `storePatterns` | Heavy (scan), Light (synthesize + store) | Full pattern analysis for a repo. LLM step can fail/retry without re-scanning. |

### Test
- `pnpm test` — ast-grep scanner finds "all routes use rateLimit" when 90%+ do; Semgrep rule catches violations
- **Manual** — MCP `check_patterns` with code missing rate limiting → returns Semgrep violation with example from existing code
- `e2e` — Dashboard patterns page shows auto-detected patterns with adherence % and generated Semgrep rules

---

## Phase 7 — PR Review Integration (Semgrep-powered)

**Feature:** _"kap10 automatically reviews my PRs on GitHub. It runs Semgrep rules from Phase 6 against the diff, identifies impact radius, and posts review comments."_

### What ships
- GitHub `pull_request` webhook → trigger automated review via Temporal
- **Semgrep CLI** runs against PR diff using auto-generated rules from Phase 6
- Impact analysis via ArangoDB graph traversal
- Post review comments via GitHub API (as kap10 bot)
- Dashboard: PR review history with status
- Configurable review rules per repo

### Why Semgrep for PR reviews

The auto-generated Semgrep rules from Phase 6 are **deterministic YAML** — no LLM needed at review time. This means:
- **Fast**: Semgrep scans thousands of files in seconds
- **Accurate**: No hallucinations — rules are exact structural matches
- **Explainable**: Every finding links back to the Semgrep rule + evidence from Phase 6
- **Cheap**: No API calls for pattern checks (LLM only used for impact summary)

### Review pipeline (Temporal workflow)

```
┌───────────────────────────────────────────────────────────────────────┐
│                 Temporal: reviewPrWorkflow                             │
│                                                                       │
│  ┌────────────┐    ┌────────────────┐    ┌───────────────────────┐   │
│  │ Activity:   │───▶│ Activity:       │───▶│ Activity:              │   │
│  │ fetchDiff   │    │ runSemgrep     │    │ analyzeImpact          │   │
│  │             │    │                │    │                         │   │
│  │ GitHub API: │    │ Semgrep CLI    │    │ ArangoDB graph:         │   │
│  │ get PR diff │    │ against diff   │    │ callers of changed fns  │   │
│  │ + changed   │    │ using repo's   │    │ + missing test check    │   │
│  │ files       │    │ auto-generated │    │ + complexity delta      │   │
│  │             │    │ rules          │    │                         │   │
│  └────────────┘    └────────────────┘    └───────────┬───────────┘   │
│                                                       │               │
│  [light: fetch]    [heavy: semgrep]      [light: analyze]            │
│                                           ┌───────────▼───────────┐   │
│                                           │ Activity:              │   │
│                                           │ postReview             │   │
│                                           │                         │   │
│                                           │ Build markdown comments │   │
│                                           │ Post to GitHub PR API   │   │
│                                           └─────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────┘
```

### Review checks

| Check | Tool | What it catches | Severity |
|-------|------|----------------|----------|
| **Pattern violation** | Semgrep (auto-generated rules) | New code breaks established conventions | Warning |
| **Impact radius** | ArangoDB graph traversal | Changed function is called by 15+ other functions | Info |
| **Missing test** | File tree analysis | New `lib/` module without `__tests__/` companion | Warning |
| **Complexity spike** | ast-grep structural query | Function cyclomatic complexity > threshold | Warning |
| **New dependency** | ArangoDB import graph | New import not seen before in codebase | Info |

### New files
```
lib/
  review/
    pipeline.ts            ← Orchestrates PR review
    diff-analyzer.ts       ← Parse GitHub diff, map to entities
    semgrep-reviewer.ts    ← Run Semgrep CLI against PR diff with repo's auto-generated rules
    checks/
      impact-check.ts      ← ArangoDB graph traversal: who calls changed functions
      test-check.ts        ← Verify test coverage for changes
      complexity-check.ts  ← ast-grep: complexity analysis on changed functions
    comment-builder.ts     ← Format review comments (markdown)
    github-reviewer.ts     ← Post comments via GitHub API
  github/
    webhook-handlers/
      pull-request.ts      ← Handle PR events → trigger reviewPrWorkflow
  temporal/
    workflows/
      review-pr.ts         ← reviewPrWorkflow definition
    activities/
      review.ts            ← fetchDiff (light), runSemgrep (heavy), analyzeImpact (light), postReview (light)
app/
  api/
    reviews/
      route.ts             ← GET review history
      [reviewId]/route.ts  ← GET review detail
  (dashboard)/
    repos/
      [repoId]/
        reviews/page.tsx    ← PR review history
        reviews/[reviewId]/page.tsx  ← Review detail with comments
```

### Prisma schema additions

```prisma
model PrReview {
  id            String   @id @default(uuid())
  repoId        String   @map("repo_id")
  prNumber      Int      @map("pr_number")
  prTitle       String?  @map("pr_title")
  prUrl         String?  @map("pr_url")
  status        String   @default("pending") @map("status")      // pending | reviewing | completed | failed
  checksPassed  Int      @default(0) @map("checks_passed")
  checksWarned  Int      @default(0) @map("checks_warned")
  checksFailed  Int      @default(0) @map("checks_failed")
  reviewBody    String?  @map("review_body")
  createdAt     DateTime @default(now()) @map("created_at")

  repo          Repo     @relation(fields: [repoId], references: [id], onDelete: Cascade)
  comments      PrReviewComment[]

  @@map("pr_reviews")
}

model PrReviewComment {
  id          String   @id @default(uuid())
  reviewId    String   @map("review_id")
  filePath    String   @map("file_path")
  lineNumber  Int?     @map("line_number")
  checkType   String   @map("check_type")       // pattern | impact | test | complexity
  severity    String                              // info | warning | error
  message     String
  suggestion  String?
  semgrepRule String?  @map("semgrep_rule")       // which Semgrep rule triggered this
  createdAt   DateTime @default(now()) @map("created_at")

  review      PrReview @relation(fields: [reviewId], references: [id], onDelete: Cascade)

  @@map("pr_review_comments")
}
```

### Temporal workflows

| Workflow | Activities | Queue | What it does |
|----------|-----------|-------|--------------|
| `reviewPrWorkflow` | `fetchDiff` → `runSemgrep` → `analyzeImpact` → `postReview` | Mixed (see pipeline diagram) | Full PR review. If GitHub API rate-limits on `postReview`, Temporal retries just that step. |

### Test
- `pnpm test` — Semgrep runner catches violations from auto-generated rules; diff analyzer maps changed lines to entities
- **Manual** — Open PR that adds API route without rate limiting → kap10 posts Semgrep-backed review comment
- **Temporal UI** — `reviewPrWorkflow` shows each check as a separate activity with timing
- `e2e` — Dashboard reviews page shows completed review with Semgrep findings

---

## Phase 8 — Usage-Based Billing & Limits (Langfuse-Powered)

**Feature:** _"I can see my kap10 usage, manage my subscription, and buy more usage when I hit my monthly limit. Langfuse tracks every LLM call — that's what I pay for. Teams can add members and share a usage pool."_

### Billing Philosophy

**No repo limits. No seat-gating on individual plans. LLM cost is the meter.**

Developers already pay for Claude ($20/mo), Cursor ($20/mo), or both. kap10 is an add-on to that stack — pricing must feel like a no-brainer, not another $100/mo line item. We charge **roughly half** of what Claude Code charges for comparable tiers.

| Principle | Implementation |
|-----------|----------------|
| **LLM cost = usage** | Langfuse tracks every LLM call (tokens, model, cost in USD). This is the single billing dimension — no abstract "usage units." Users understand exactly what they're paying for. |
| **Monthly allowance + on-demand** | Each plan includes a monthly LLM cost budget (in USD). When exhausted, the user can buy on-demand credits or upgrade. No hard cutoff — just a speed bump. |
| **Langfuse as source of truth** | A nightly Temporal workflow polls Langfuse Daily Metrics API per org → syncs to our billing system. Langfuse dashboards give users real-time cost visibility. |
| **Max plan is hidden** | Not shown in pricing UI until we have enough customers to justify the tier. Coded and functional, gated by a feature flag. |
| **Teams are separate** | Teams Pro and Teams Max are distinct plans with per-seat pricing + shared cost pool. |

### What ships
- Langfuse integration: all LLM calls tagged with `orgId`, `repoId`, `userId` for per-org cost tracking
- Nightly `syncBillingWorkflow`: Langfuse Daily Metrics API → Prisma usage records → Stripe metered billing
- Plan tiers: Free, Pro, Max (hidden), Teams Pro, Teams Max, Enterprise (contact sales)
- Stripe billing: subscriptions + metered usage + on-demand top-ups
- Usage dashboard pulling from Langfuse (real-time cost bar, per-repo breakdown, per-model breakdown)
- Plan upgrade/downgrade flow
- On-demand credit purchase when monthly limit hit
- Rate limiting on MCP endpoint by plan

### How LLM Cost Becomes the Billing Meter

```
Every AI SDK call (Phase 4–7)
        │
        ▼
  experimental_telemetry: { isEnabled: true }
  + propagateAttributes({ tags: [orgId], userId, ... })
        │
        ▼
  OpenTelemetry → LangfuseSpanProcessor
        │
        ▼
  Langfuse stores: model, tokens, cost (USD), orgId tag, timestamp
        │
        ▼
  Nightly Temporal: syncBillingWorkflow
  ├─ GET /api/public/metrics/daily?tags=[orgId]&from=...&to=...
  ├─ Sum totalCost per org for the billing period
  ├─ Write UsageSnapshot to Prisma
  ├─ Check against plan limit
  └─ Report overage to Stripe metered billing
```

**Why Langfuse, not our own metering?**
- Langfuse already has every LLM call with exact token counts and model-specific pricing
- No risk of metering drift — what Langfuse records is what happened
- Users can inspect their own Langfuse dashboard to verify costs (transparency)
- Langfuse handles model pricing updates (new models, price changes) via model definitions
- We don't need to maintain a parallel cost-calculation system

### Plan Tiers

#### Individual Plans

| | Free | Pro ($10/mo) | Max ($50/mo) |
|---|------|-------------|-------------|
| **Monthly LLM budget** | $0.50 | $5.00 | $25.00 |
| **Repos** | Unlimited | Unlimited | Unlimited |
| **Indexing** | Manual only | Auto on push | Auto on push |
| **Justifications** | Basic (Mini only) | Full (4o routing) | Full (4o routing) |
| **Pattern enforcement** | View only | Auto-detect + custom | Auto-detect + custom |
| **PR reviews** | — | Included | Included + priority queue |
| **On-demand top-up** | — | $5 per $5 LLM credit | $5 per $5 LLM credit |
| **Langfuse dashboard** | Read-only | Full | Full |
| **Max plan visibility** | — | — | Hidden (feature flag) |

> **What does $5/mo of LLM budget buy?** At current gpt-4o-mini rates (~$0.15/1M input tokens):
> - ~500 entity justifications
> - ~50 PR reviews
> - ~10 full pattern scans
> - ~2,000 MCP queries with context enrichment
>
> Heavy users (large monorepos, frequent pushes) will naturally consume more and upgrade.

#### Team Plans

| | Teams Pro ($8/seat/mo) | Teams Max ($40/seat/mo) |
|---|----------------------|------------------------|
| **Monthly LLM budget** | $4/seat (pooled) | $20/seat (pooled) |
| **Min seats** | 3 | 3 |
| **Repos** | Unlimited | Unlimited |
| **Shared cost pool** | Yes — all seats contribute to one pool | Yes |
| **Admin dashboard** | Langfuse usage per member, audit log | Langfuse usage per member, audit log |
| **On-demand top-up** | $5 per $5 LLM credit | $5 per $5 LLM credit |
| **SSO** | — | SAML/OIDC |

#### Enterprise (Contact Sales)

- Custom LLM budget allocation
- Dedicated infrastructure (isolated ArangoDB + Temporal + Langfuse project)
- SAML/OIDC SSO
- SLA + priority support
- Custom model routing (bring your own LLM keys — cost tracked via Langfuse regardless)
- On-prem / VPC deployment option

### On-Demand Credits

When a user/team exhausts their monthly LLM budget:

```
┌─────────────────────────────────────────────────────────┐
│  ⚠ You've used $5.00 / $5.00 LLM budget this month     │
│                                                          │
│  ┌──────────────────┐  ┌──────────────────────────────┐│
│  │  Buy $5 credit   │  │  Upgrade to Max ($50/mo)     ││
│  │  $5 one-time     │  │  $25/mo LLM budget           ││
│  └──────────────────┘  └──────────────────────────────┘│
│                                                          │
│  Or wait for monthly reset on Mar 1.                    │
│  MCP queries will return 429 until resolved.            │
└─────────────────────────────────────────────────────────┘
```

**Behavior when limit hit:**
- MCP tool calls return `429 Too Many Requests` with a message: `"Monthly LLM budget reached. Buy more at https://app.kap10.dev/billing or upgrade your plan."`
- Dashboard shows a cost bar with upgrade/top-up CTAs
- Webhooks (push, PR) are **queued** (not dropped) — they'll process when budget is available
- On-demand purchases are **instant** — Stripe processes, credits unlock within seconds

### Billing Sync Workflow (Temporal)

```typescript
// lib/temporal/workflows/sync-billing.ts
export async function syncBillingWorkflow(): Promise<SyncResult> {
  // Runs nightly at 00:05 UTC via Temporal cron schedule
  const orgs = await light.getAllActiveOrgs();

  for (const org of orgs) {
    const cost = await light.getLangfuseCost({
      orgId: org.id,
      from: org.currentPeriodStart,
      to: new Date(),
    });

    await light.writeUsageSnapshot({
      orgId: org.id,
      totalCostUsd: cost,
      snapshotAt: new Date(),
    });

    // Check if over limit
    const plan = await light.getOrgPlan(org.id);
    const budget = plan.monthlyLlmBudget + (await light.getOnDemandBalance(org.id));

    if (cost > budget) {
      await light.markOrgOverLimit(org.id);
    }

    // Report overage to Stripe (for on-demand billing)
    if (cost > plan.monthlyLlmBudget) {
      const overage = cost - plan.monthlyLlmBudget;
      await light.reportStripeOverage(org.id, overage);
    }
  }
}
```

```typescript
// lib/billing/langfuse-sync.ts
import { LangfuseClient } from '@langfuse/client';

const langfuse = new LangfuseClient();

export async function getLangfuseCost(orgId: string, from: Date, to: Date): Promise<number> {
  const metrics = await langfuse.api.metrics.metricsDaily({
    tags: [orgId],                          // all traces tagged with orgId
    fromTimestamp: from.toISOString(),
    toTimestamp: to.toISOString(),
  });

  return metrics.data.reduce((sum, day) => sum + day.totalCost, 0);
}
```

### Real-Time Budget Check (pre-flight)

The nightly sync sets the baseline, but we also do a **fast pre-flight check** before expensive operations:

```typescript
// lib/billing/enforce.ts
async function checkBudget(orgId: string): Promise<void> {
  const snapshot = await prisma.usageSnapshot.findFirst({
    where: { organizationId: orgId },
    orderBy: { snapshotAt: 'desc' },
  });

  if (!snapshot) return; // No data yet, allow

  const plan = await getOrgPlan(orgId);
  const budget = plan.monthlyLlmBudget + (await getOnDemandBalance(orgId));

  // Use last snapshot + 10% buffer (nightly sync may be stale)
  if (snapshot.totalCostUsd > budget * 0.9) {
    // Near limit — do a live Langfuse check
    const liveCost = await getLangfuseCost(orgId, plan.currentPeriodStart, new Date());
    if (liveCost >= budget) {
      throw new BudgetExceeded(orgId, liveCost, budget);
    }
  }
}
```

This is called before `justifyEntity`, `llmSynthesizeRules`, `reviewPr`, and other LLM-heavy operations. Cheap operations (graph queries, MCP reads) are **not budget-gated** — they don't consume LLM tokens.

### Prisma schema additions

```prisma
model Subscription {
  id                  String   @id @default(uuid())
  organizationId      String   @unique @map("organization_id")
  planId              String   @map("plan_id")           // free | pro | max | teams_pro | teams_max | enterprise
  stripeCustomerId    String?  @map("stripe_customer_id")
  stripeSubscriptionId String? @map("stripe_subscription_id")
  stripeItemId        String?  @map("stripe_item_id")    // for metered overage reporting
  seats               Int      @default(1)
  monthlyLlmBudget    Float    @default(0.50) @map("monthly_llm_budget")  // USD
  status              String   @default("active")         // active | past_due | canceled | over_limit
  currentPeriodStart  DateTime @map("current_period_start")
  currentPeriodEnd    DateTime @map("current_period_end")
  createdAt           DateTime @default(now()) @map("created_at")
  updatedAt           DateTime @updatedAt @map("updated_at")

  @@map("subscriptions")
}

model UsageSnapshot {
  id              String   @id @default(uuid())
  organizationId  String   @map("organization_id")
  totalCostUsd    Float    @map("total_cost_usd")        // from Langfuse Daily Metrics API
  snapshotAt      DateTime @map("snapshot_at")
  createdAt       DateTime @default(now()) @map("created_at")

  @@index([organizationId, snapshotAt])
  @@map("usage_snapshots")
}

model OnDemandPurchase {
  id              String   @id @default(uuid())
  organizationId  String   @map("organization_id")
  creditUsd       Float    @map("credit_usd")             // $5, $10, $25, etc.
  amountCents     Int      @map("amount_cents")
  stripePaymentId String?  @map("stripe_payment_id")
  periodStart     DateTime @map("period_start")           // applies to current billing period
  periodEnd       DateTime @map("period_end")
  createdAt       DateTime @default(now()) @map("created_at")

  @@index([organizationId, periodStart])
  @@map("on_demand_purchases")
}
```

### New files
```
lib/
  billing/
    plans.ts               ← Plan definitions, LLM budgets, feature flags (Max hidden)
    langfuse-sync.ts       ← Langfuse Daily Metrics API client: get per-org LLM cost
    enforce.ts             ← Pre-flight budget check before LLM operations
    stripe.ts              ← Stripe subscription + metered billing + on-demand purchases
    on-demand.ts           ← On-demand credit purchase flow
  usage/
    dashboard.ts           ← Aggregate usage stats (from Langfuse + Prisma snapshots)
    breakdown.ts           ← Per-repo, per-model, per-operation cost breakdown
  temporal/
    workflows/
      sync-billing.ts      ← Nightly syncBillingWorkflow: Langfuse → Prisma → Stripe
    activities/
      billing.ts           ← getLangfuseCost, writeUsageSnapshot, reportStripeOverage
app/
  api/
    billing/
      route.ts             ← GET current plan + usage, POST upgrade/downgrade
      checkout/route.ts    ← POST create Stripe checkout session
      webhook/route.ts     ← Stripe webhook handler (subscription events)
      top-up/route.ts      ← POST buy on-demand credits
  (dashboard)/
    billing/page.tsx        ← Plan selector + cost bar + on-demand purchase
    usage/page.tsx          ← Detailed cost breakdown (from Langfuse: per-repo, per-model, per-day)
    team/
      page.tsx             ← Team management (Teams plans only): invite, remove, cost per member
```

### Temporal workflows

| Workflow | Schedule | What it does |
|----------|----------|--------------|
| `syncBillingWorkflow` | Cron: `0 5 0 * * *` (nightly 00:05 UTC) | Poll Langfuse per org → write snapshots → check limits → report Stripe overage |

### Test
- `pnpm test` — Langfuse sync correctly aggregates cost per org; budget enforcement returns 429 at boundary; on-demand purchase increases available budget; team pool aggregation works
- `pnpm test` — Max plan not visible when feature flag is off; visible when flag is on
- `pnpm test` — Pre-flight budget check uses cached snapshot for fast path, falls back to live Langfuse for near-limit orgs
- `e2e` — Free user hits $0.50 LLM budget → sees upgrade/top-up modal → purchases $5 credit → continues working
- `e2e` — Pro user → Stripe checkout → subscription active → Langfuse tracks cost → approaches limit → top-up flow
- `e2e` — Usage dashboard shows per-repo and per-model cost breakdown matching Langfuse data

---

## Phase 9 — Code Snippet Library (Post-Launch)

> **Status:** Post-launch feature. Build after Phases 0–8 are shipped and stable.
>
> **Core Insight:** LLMs produce dramatically better code when given reference snippets — working examples of the exact patterns, UI components, user flows, and architectural decisions the team actually uses. Without this, agents hallucinate their own patterns. With it, agents become extensions of the team's coding philosophy.

### Problem

1. **No exemplar injection** — Agents generate code from their training data, not your team's conventions. Even with rules (Phase 6), agents lack concrete *examples* of what good code looks like in your codebase.
2. **Knowledge silos** — Senior developers carry patterns in their heads. When they leave, the patterns leave. Junior developers reinvent solutions that already exist somewhere in the repo.
3. **Community patterns are scattered** — Open-source best practices live in blog posts, GitHub gists, and Stack Overflow. There's no structured way to curate and inject them into agent context.

### Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                      Snippet Library                             │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  Community   │  │  Team /     │  │  Auto-Extracted         │  │
│  │  Snippets    │  │  Enterprise │  │  (from indexed repos)   │  │
│  │  (public)    │  │  Snippets   │  │                         │  │
│  └──────┬───────┘  └──────┬──────┘  └───────────┬─────────────┘  │
│         │                 │                     │                │
│         └────────┬────────┴─────────────────────┘                │
│                  ▼                                               │
│         ┌──────────────────┐                                    │
│         │  Snippet Store   │  ArangoDB `snippets` collection    │
│         │  + Embeddings    │  pgvector for semantic search      │
│         └────────┬─────────┘                                    │
│                  │                                               │
│         ┌────────▼─────────┐                                    │
│         │  MCP Tools       │                                    │
│         │  get_snippets    │  Injected into agent context       │
│         │  search_snippets │  on every relevant tool call       │
│         └──────────────────┘                                    │
└──────────────────────────────────────────────────────────────────┘
```

### Snippet Sources

| Source | Scope | How it works |
|--------|-------|-------------|
| **Community** (public) | All users | Curated by autorail team + community PRs. Categorized by framework, pattern type, language. Think "verified recipes." |
| **Team / Enterprise** | Org-scoped | Snippets from the team's own repos. Senior devs pin exemplar implementations. Auto-suggested when Phase 6 detects a recurring pattern. |
| **Auto-Extracted** | Repo-scoped | kap10 identifies high-quality implementations during indexing (Phase 1/5) — functions with good test coverage, well-documented modules, frequently-referenced utilities — and suggests them as snippet candidates. |

### Snippet Schema

```typescript
const SnippetSchema = z.object({
  id: z.string(),
  title: z.string(),                    // "React Query mutation with optimistic update"
  description: z.string(),              // What this snippet demonstrates
  category: z.enum([
    'ui_component',                     // React/Vue/Svelte component patterns
    'user_flow',                        // Multi-step interaction patterns
    'api_pattern',                      // REST/GraphQL/tRPC endpoint patterns
    'data_model',                       // Schema/model/migration patterns
    'testing',                          // Test structure and assertion patterns
    'architecture',                     // Module organization, DI, layering
    'error_handling',                   // Error boundary, retry, fallback patterns
    'performance',                      // Caching, lazy loading, optimization
    'security',                         // Auth, validation, sanitization
    'devops',                           // CI/CD, Docker, deployment
  ]),
  language: z.string(),                 // "typescript", "python", "go"
  framework: z.string().optional(),     // "next.js", "fastapi", "gin"
  code: z.string(),                     // The actual snippet code
  context: z.string().optional(),       // When/why to use this snippet
  tags: z.array(z.string()),            // Searchable tags
  source: z.enum(['community', 'team', 'auto_extracted']),
  orgId: z.string().nullable(),         // null = community (public)
  repoId: z.string().nullable(),        // null = org-wide or community
  entityRef: z.string().optional(),     // Link to source entity (auto-extracted)
  upvotes: z.number().default(0),       // Community voting
  verified: z.boolean().default(false), // Reviewed by autorail team or org admin
  createdBy: z.string(),
  version: z.number().default(1),       // Snippet versioning
  status: z.enum(['active', 'draft', 'deprecated']).default('active'),
});
```

### MCP Tools

```typescript
// get_snippets — Fetch relevant snippets for the current coding context
// Automatically called by Bootstrap Rule when agent starts working on a file
{
  name: 'get_snippets',
  description: 'Get reference code snippets relevant to the current file and task',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Current file being edited' },
      taskDescription: { type: 'string', description: 'What the agent is trying to do' },
      category: { type: 'string', description: 'Optional category filter' },
      limit: { type: 'number', default: 3, description: 'Max snippets to return' },
    },
    required: ['filePath'],
  },
}

// search_snippets — Semantic search across snippet library
{
  name: 'search_snippets',
  description: 'Search for code snippets by description or pattern',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Natural language search query' },
      category: { type: 'string' },
      framework: { type: 'string' },
      language: { type: 'string' },
      source: { type: 'string', enum: ['community', 'team', 'auto_extracted', 'all'] },
      limit: { type: 'number', default: 5 },
    },
    required: ['query'],
  },
}

// pin_snippet — Save a code region as a team snippet (team/enterprise only)
{
  name: 'pin_snippet',
  description: 'Pin a code implementation as a reference snippet for the team',
  inputSchema: {
    type: 'object',
    properties: {
      entityId: { type: 'string', description: 'Entity to pin as snippet' },
      title: { type: 'string' },
      category: { type: 'string' },
      description: { type: 'string' },
    },
    required: ['entityId', 'title', 'category'],
  },
}
```

### Snippet Resolution Logic

When `get_snippets` is called, the resolver prioritizes by relevance:

1. **Team snippets matching the file's entity kind + framework** — highest priority (your team's way of doing things)
2. **Auto-extracted snippets from the same repo** — repo-specific patterns already proven in this codebase
3. **Community snippets matching language + framework + category** — fallback to curated best practices
4. **Semantic similarity** — pgvector cosine distance on snippet embeddings vs. task description embedding

Snippets are injected after rules (Phase 6) in the MCP response, so the agent sees: rules first (constraints), then snippets (examples). Rules say "what you must do," snippets show "how we do it here."

### Auto-Extraction Pipeline

During Phase 1/5 indexing, a background Temporal workflow identifies snippet candidates:

```typescript
// Criteria for auto-extraction suggestion
const isSnippetCandidate = (entity: Entity): boolean => {
  return (
    entity.testCoverage > 0.8 &&             // Well-tested
    entity.inboundEdges > 3 &&               // Frequently referenced
    entity.docstring !== null &&              // Documented
    entity.complexity === 'low' &&            // Not overly complex
    entity.linesOfCode < 100                  // Concise enough to be useful
  );
};
```

Candidates are surfaced in the dashboard as "Suggested Snippets" — team leads can review and promote them with one click.

### Community Snippet Platform

- **Public snippet registry** hosted by autorail — curated, versioned, categorized
- **Contribution flow:** Fork → PR → review by autorail team → merge to community library
- **Quality gates:** Must include description, context, at least one tag, and pass lint
- **Versioning:** Snippets track framework versions (e.g., "Next.js 15+ App Router" vs "Next.js 14 Pages Router")
- **Voting:** Community upvotes surface the most useful patterns; downvoted snippets auto-archived after threshold

### ArangoDB Collection

```javascript
// snippets collection
{
  _key: "snippet_uuid",
  title: "React Query mutation with optimistic update",
  description: "Pattern for mutations with instant UI feedback and rollback on error",
  category: "ui_component",
  language: "typescript",
  framework: "react",
  code: "...",
  context: "Use when mutating server state that should reflect immediately in the UI",
  tags: ["react-query", "optimistic-update", "mutation"],
  source: "team",
  org_id: "org_123",
  repo_id: null,
  entity_ref: "entities/fn_useOptimisticMutation",
  upvotes: 12,
  verified: true,
  created_by: "user_456",
  version: 2,
  status: "active",
  embedding_id: "emb_snippet_uuid"  // FK to pgvector embedding
}
```

### Dashboard Pages

- `/dashboard/snippets` — Browse & search snippet library (community + team)
- `/dashboard/snippets/suggestions` — Review auto-extracted snippet candidates (team/enterprise)
- `/dashboard/snippets/new` — Create a new snippet manually
- `/dashboard/snippets/[id]` — View/edit snippet with syntax-highlighted preview

### Plan Gating

| Feature | Free | Pro | Max | Teams | Enterprise |
|---------|------|-----|-----|-------|------------|
| Community snippets (read) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Community snippets (contribute) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Auto-extracted suggestions | — | ✓ | ✓ | ✓ | ✓ |
| Team snippet library | — | — | — | ✓ | ✓ |
| Pin snippets from codebase | — | — | — | ✓ | ✓ |
| Custom snippet categories | — | — | — | — | ✓ |
| Cross-repo snippet sharing | — | — | — | — | ✓ |

### New Files

```
lib/snippets/
  schema.ts              # SnippetSchema + types
  store.ts               # ArangoDB CRUD for snippets collection
  resolver.ts            # get_snippets resolution logic (priority + semantic search)
  extractor.ts           # Auto-extraction pipeline (snippet candidate detection)
  embedder.ts            # Embed snippet code + description into pgvector
lib/mcp/tools/
  snippets.ts            # get_snippets, search_snippets, pin_snippet MCP tools
app/dashboard/snippets/
  page.tsx               # Snippet library browser
  suggestions/page.tsx   # Auto-extracted candidate review
  new/page.tsx           # Manual snippet creation
  [id]/page.tsx          # Snippet detail/edit
```

### Acceptance Tests

- `pnpm test` — Snippet resolver returns team snippets before community snippets for same category
- `pnpm test` — Auto-extraction identifies entities meeting all quality criteria
- `pnpm test` — `get_snippets` MCP tool returns max `limit` snippets with correct priority ordering
- `pnpm test` — Semantic search returns relevant snippets by cosine similarity
- `pnpm test` — Team snippets only visible to members of that org
- `pnpm test` — Community snippet upvote/downvote updates count correctly
- `e2e` — User browses snippet library → searches by framework → views snippet → copies code
- `e2e` — Team lead reviews auto-extracted suggestion → promotes to team snippet → appears in `get_snippets` for teammates

---

## Phase Summary & Dependencies

```
Phase 0: Foundation Wiring (Prisma + ArangoDB + Temporal + Redis + Langfuse)
    │
    ▼
Phase 1: GitHub Connect & Repo Indexing (SCIP + prepareWorkspace + entity hashing)
    │
    ├──────────────────┐
    ▼                  ▼
Phase 2: MCP Server    Phase 3: Semantic Search (LlamaIndex.TS)
(+ Shadow Workspace    │
 + Auto-PR             │
 + Secret Scrubbing    │
 + Truncation)         │
    │                  │
    └────────┬─────────┘
             ▼
Phase 4: Business Justification + Taxonomy (Vercel AI SDK)
(+ VERTICAL/HORIZONTAL/UTILITY classification
 + Features collection
 + Blueprint Dashboard)
    │
    ▼
Phase 5: Incremental Indexing (entity hash diff + cascade re-justify)
    │
    ├──────────────────┐
    ▼                  ▼
Phase 6: Patterns +    Phase 7: PR Review
Rules Engine           (Semgrep CLI on diff)
(ast-grep + Semgrep    │
 + hierarchical rules) │
    │                  │
    └────────┬─────────┘
             ▼
Phase 8: Billing & Limits (Langfuse → Stripe)
             │
      ═══════╧════════  LAUNCH  ═══════════
             │
             ▼
Phase 9: Code Snippet Library (post-launch)
(community + team + auto-extracted snippets)
```

### Estimated scope per phase

| Phase | New files | Modified files | New DB tables/collections | New MCP tools | Temporal workflows |
|-------|-----------|---------------|--------------------------|---------------|-------------------|
| 0 | ~12 | ~4 | ArangoDB schema + Prisma init | 0 | 0 |
| 1 | ~16 | ~3 | 1 Prisma + 11 ArangoDB | 0 | 1 (`indexRepo`) |
| 2 | ~14 | ~2 | 1 Prisma (Workspace) | 9 | 0 |
| 3 | ~8 | ~3 | 1 Prisma | 2 | 1 (`embedRepo`) |
| 4 | ~12 | ~2 | 4 ArangoDB + 2 edge | 4 | 2 (`justifyRepo`, `justifyEntity`) |
| 5 | ~8 | ~4 | 0 | 1 | 1 (`incrementalIndex`) |
| 6 | ~18 | ~4 | 2 ArangoDB (`patterns` + `rules`) | 5 (+`get_rules`, `check_rules`) | 1 (`detectPatterns`) |
| 7 | ~12 | ~3 | 2 Prisma | 0 | 1 (`reviewPr`) |
| 8 | ~12 | ~6 | 3 Prisma | 0 | 1 (`syncBilling`) |
| 9 *(post-launch)* | ~14 | ~4 | 1 ArangoDB (`snippets`) + pgvector embeddings | 3 (`get_snippets`, `search_snippets`, `pin_snippet`) | 1 (`extractSnippets`) |

---

## Tech Stack (complete)

### Core Infrastructure

| Package | Purpose | Phase |
|---------|---------|-------|
| `@temporalio/client` + `@temporalio/worker` + `@temporalio/workflow` | Durable workflow orchestration (dual task queues) | 0 |
| `arangojs` | ArangoDB graph database driver | 0 |
| `prisma` + `@prisma/client` | Type-safe Supabase ORM with pgvector | 0 |

### Code Intelligence

| Package | Purpose | Phase |
|---------|---------|-------|
| `scip-typescript` / `scip-python` / etc. | SCIP code intelligence indexers (run as CLI, require full workspace with deps) | 1 |
| `web-tree-sitter` | Supplementary parsing for non-SCIP languages | 1 |
| `@ast-grep/napi` | Structural code search (pattern detection) | 6 |
| `semgrep` (CLI) | Rule-based static analysis (pattern enforcement + PR review) | 6, 7 |

### AI, Search & Observability

| Package | Purpose | Phase |
|---------|---------|-------|
| `ai` + `@ai-sdk/openai` + `@ai-sdk/anthropic` | Unified LLM routing (Vercel AI SDK) | 4 |
| `llamaindex` | Embedding pipeline + pgvector retrieval + RAG | 3 |
| `@langfuse/tracing` + `@langfuse/otel` + `@langfuse/client` | LLM observability, cost tracking, billing metering (via OpenTelemetry) | 0 (init), 4+ (all LLM calls) |
| `@opentelemetry/sdk-node` + `@opentelemetry/sdk-trace-node` | OpenTelemetry SDK — bridges Vercel AI SDK telemetry to Langfuse | 0 |

### GitHub & Infra

| Package | Purpose | Phase |
|---------|---------|-------|
| `@octokit/rest` + `@octokit/webhooks` | GitHub API + webhook handling + Auto-PR | 1, 2 |
| `@modelcontextprotocol/sdk` | MCP server implementation | 2 |

### Visualization

| Package | Purpose | Phase |
|---------|---------|-------|
| `@xyflow/react` (React Flow) | Blueprint Dashboard — business swimlane visualization | 4 |

### Snippet Library (Post-Launch)

| Package | Purpose | Phase |
|---------|---------|-------|
| `llamaindex` (reuse from Phase 3) | Snippet embedding + semantic search via pgvector | 9 |

---

## Testing Strategy

Each phase has three test levels:

| Level | Tool | What it covers |
|-------|------|---------------|
| **Unit** | Vitest | Individual functions: parsers, formatters, query builders, AI SDK mock calls, secret scrubber, entity hasher |
| **Integration** | Vitest + testcontainers | Full pipelines: SCIP → ArangoDB → query → result; Temporal workflow replay tests; MCP tool chain with truncation |
| **E2E** | Playwright | User flows: dashboard interactions, connection flows, Blueprint Dashboard |

### Temporal-specific testing

```typescript
// Temporal workflow replay tests — deterministic, no external calls
import { TestWorkflowEnvironment } from '@temporalio/testing';

const env = await TestWorkflowEnvironment.createLocal();
const result = await env.client.workflow.execute(indexRepoWorkflow, {
  taskQueue: 'test',
  args: [{ orgId: 'test', repoId: 'test', url: 'https://github.com/test/repo' }],
});
expect(result.fileCount).toBeGreaterThan(0);
```

**Test databases:** Each test run spins up fresh ArangoDB + Temporal (via testcontainers or Docker) to avoid state pollution.

---

## Framework Decision Summary

| Before | After (v3 — this doc) | Impact |
|--------|----------------------|--------|
| BullMQ + Redis workers | **Temporal** (dual task queues: heavy-compute + light-llm) | Durable execution, resume-from-failure, visual debugging, no custom retry/timeout logic, right-sized workers per activity type |
| Shallow clone → SCIP | **Full clone + npm install → SCIP** (`prepareWorkspace`) | SCIP gets full type graph, cross-file edges actually resolve, not just disconnected islands |
| Custom Tree-sitter AST traversal per language | **SCIP indexers** | Drop-in language support (TS, Go, Python, Java, Rust), standardized graph output, no per-language AST code |
| Custom AST visitors for pattern detection | **ast-grep** | 3-line YAML patterns instead of 50-line visitors; 80% dev time reduction in Phase 6 |
| Raw pattern checking | **Semgrep** | Deterministic YAML rule execution; LLM generates rules once, Semgrep enforces forever; blazing fast PR reviews |
| Raw OpenAI SDK + manual routing | **Vercel AI SDK** | One-line provider switching, native Zod structured output, built-in streaming + Next.js integration |
| Raw pgvector SQL + OpenAI embeddings | **LlamaIndex.TS** | Built-in chunking, embedding, PGVectorStore, retrieval + re-ranking — no custom vector pipeline |
| Raw Supabase client | **Prisma** | Type-safe queries, migration management, native pgvector support |
| Simple justification only | **VERTICAL/HORIZONTAL/UTILITY taxonomy** + features collection + Blueprint Dashboard | Structural understanding of the codebase as business swimlanes, not just a bag of functions |
| No local state bridging | **Shadow Workspace** (sync_local_diff + Bootstrap Rule + Auto-PR) | Agents see current work, not just last commit; frictionless onboarding via PR |
| Raw MCP responses | **Semantic truncation + pagination** | Prevents agent context exhaustion; every response fits within token budget |
| No input sanitization | **Edge secret scrubbing** (regex + entropy) | Secrets in git diffs never reach LLM prompts or graph storage |
| Content-based entity tracking | **Stable entity hashing** (identity-based) | Correct delete/rename detection in incremental indexing; preserves edge relationships |
| Manual token counting for billing | **Langfuse** (OpenTelemetry + Daily Metrics API) | Every LLM call auto-tracked with exact cost; Langfuse becomes the billing meter; users see real-time cost breakdown per repo/model; no parallel metering system needed |
| Abstract "usage units" billing | **LLM cost in USD** as the billing dimension | Users understand exactly what they pay for; no confusing unit conversions; Langfuse is the single source of truth |
| Static `.cursorrules` files | **Hierarchical Rules Engine** (org → repo → path → branch → workspace) | Rules never fall out of context — injected via MCP on every tool call; team-wide enforcement without cursor rules context rot |
| No exemplar code injection | **Code Snippet Library** (community + team + auto-extracted) | Agents produce code matching team conventions; knowledge transfer survives developer turnover; community curates best practices |

---

*kap10 — The AI Tech Lead. Institutional memory, rules, and proven patterns for your codebase.*
