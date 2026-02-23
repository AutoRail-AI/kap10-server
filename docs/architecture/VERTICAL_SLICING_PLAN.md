# kap10 — Vertical Slicing Architecture Plan

> **Each phase ships a single, end-to-end testable feature.**
> No phase depends on future phases to be useful. Every phase produces a working feature a user can interact with.
>
> **Phase 0 implementation tracker:** [PHASE_0_DEEP_DIVE_AND_TRACKER.md](./PHASE_0_DEEP_DIVE_AND_TRACKER.md)

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
       kap10 CLI (Phase 5.5)          │        │                  │                 │
    ┌──────────────┐  Pre-signed URL  │  ┌─────▼──────────────────▼────────┐       │
    │  kap10 push  │─────────────────►│  │ Supabase Storage (cli_uploads)  │       │
    │  (zip upload)│                  │  └─────────────────┬───────────────┘       │
    └──────────────┘                  │                    ▼                        │
                                      │  ┌─────────────────────────────────┐       │
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
| **Supabase Storage** | File uploads (CLI) | Zipped codebase uploads from `kap10 push`; pre-signed URLs for direct client upload; auto-cleaned after indexing *(Phase 5.5)* |

**Supabase: schema approach (mandatory).** All kap10-managed Supabase tables live in PostgreSQL schema **`kap10`** (we use the schema approach, not a table prefix). From now on, every new kap10 table MUST be created in schema `kap10` via Prisma with `@@schema("kap10")`; do not add kap10 app tables to `public`. Prisma: `schemas = ["public", "kap10"]` in the datasource; use `@@schema("kap10")` on every kap10 model and enum. Table names are unprefixed (e.g. `repos`, `deletion_logs`). Better Auth tables stay in `public` (user, session, account, organization, member, invitation, verification); we do not migrate those. This is required when sharing one Supabase project with multiple apps (clear separation, no name clashes, simpler permissions). [Prisma multi-schema](https://www.prisma.io/docs/orm/prisma-schema/data-model/multi-schema).

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

### Separation of Concerns

The system follows a **Ports & Adapters (hexagonal) architecture** — see Cross-Cutting Concern §5 for the full layer map, port definitions, DI container, and swap scenarios. The key principle: **use cases depend on port interfaces, never on concrete adapters.** This means every external technology (ArangoDB, Temporal, Stripe, Langfuse, SCIP, etc.) can be replaced by writing a single new adapter file without touching any business logic.

All LLM calls use **structured output** (`generateObject()` + Zod schemas) — see Cross-Cutting Concern §6. No regex-based parsing of LLM responses anywhere in the codebase.

### Why ArangoDB (not CozoDB)

code-synapse uses CozoDB embedded — perfect for a local CLI sidecar. kap10 is a **multi-tenant cloud service** where:
- Multiple repos per user, multiple users per org
- Concurrent graph queries from MCP connections
- Graph traversals (N-hop callers, impact analysis) are the primary query pattern
- AQL is production-grade with native graph traversals, HNSW vector indices, and multi-model (doc + graph + search) in one engine
- Pool-based multi-tenancy (single database, `org_id` + `repo_id` on every document) — avoids per-database memory overhead at scale
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
kap10_rule_version: "1.0.0"
---

## Pre-flight (before ANY code generation task)
1. Call `sync_local_diff` with a filtered git diff that excludes lockfiles and build artifacts:
   git diff HEAD -- . ':!package-lock.json' ':!pnpm-lock.yaml' ':!yarn.lock'
     ':!Gemfile.lock' ':!poetry.lock' ':!Cargo.lock' ':!go.sum'
     ':!composer.lock' ':!node_modules/' ':!dist/' ':!.next/' ':!build/'
2. Wait for confirmation that the cloud graph is updated

## Post-flight (after ANY code generation task)
1. Call `sync_local_diff` again (same filtered diff) to push the new changes
2. Call `check_patterns` on any newly written code

## Path formatting (IMPORTANT for monorepos)
Always format file paths relative to the ROOT of the git repository when
calling kap10 MCP tools, regardless of your current working directory.
Example: use "packages/frontend/src/auth.ts" not "src/auth.ts".
Run `git rev-parse --show-toplevel` to find the repo root if unsure.
```

> **Rule versioning:** The `kap10_rule_version` field enables automated update PRs. When kap10 ships a new Bootstrap Rule version, the Auto-PR workflow compares the installed version against the latest and opens an update PR if outdated. Semver convention: patch = wording tweaks, minor = new rules/tools added, major = breaking agent workflow changes.

#### `sync_local_diff` MCP Tool

```typescript
// lib/mcp/tools/sync.ts
const SyncLocalDiffTool = {
  name: 'sync_local_diff',
  description: 'Sync uncommitted local changes to kap10 cloud graph',
  inputSchema: z.object({
    diff: z.string().describe('Output of `git diff HEAD` (exclude lockfiles)'),
    branch: z.string().describe('Current git branch name'),
    baseSha: z.string().describe('HEAD commit SHA'),
  }),
  handler: async ({ diff, branch, baseSha }, ctx) => {
    // 0. Acquire Redis distributed lock (prevents concurrent writes to same workspace)
    const lockKey = `kap10:lock:workspace:${ctx.userId}:${ctx.repoId}:${branch}`;
    const lock = await acquireLock(lockKey, { ttl: 30_000, retries: 3, backoff: 200 });

    try {
      // 0.5. Strip lockfile/build artifact hunks before size validation
      const filteredDiff = stripLockfileHunks(diff);
      if (filteredDiff.length > 50 * 1024) {
        throw new DiffTooLargeError('Diff too large after lockfile exclusion. Commit first.');
      }

      // 1. Resolve workspace (per-user, per-repo, per-branch)
      //    Cold-start: if expired, purge stale overlay and rebuild from latest commit
      const workspace = await resolveWorkspace(ctx.userId, ctx.repoId, branch);

      // 2. Parse diff into structured overlay using parse-diff (not custom regex)
      //    parse-diff converts raw git diff → { files, chunks, additions, deletions }
      const overlay = parseDiffToOverlay(filteredDiff, baseSha);

      // 3. Re-index only changed files (incremental, in-memory)
      const delta = await indexOverlay(overlay, workspace.graphSnapshot);

      // 4. Store as ephemeral workspace layer (TTL: 12 hours, sliding window)
      await workspace.applyDelta(delta);

      return { updated: delta.changedEntities.length, workspace: workspace.id };
    } finally {
      await lock.release();
    }
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
- **TTL:** Workspace overlays expire after **12 hours** of inactivity (configurable per-org, range 1–24 h, default 12 h). The extended TTL ensures workspaces survive overnight sessions and timezone gaps. On cold start (first sync after expiry), the stale overlay is purged and rebuilt from the latest indexed commit. The Bootstrap Rule's pre-flight sync refreshes the sliding window.
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

**Problem:** Developers paste `git diff` output containing API keys, connection strings, or tokens into `sync_local_diff`. These must never reach LLM prompts or ArangoDB storage. (Note: lockfile hunks and build artifacts are stripped *before* secret scrubbing — see `sync_local_diff` tool above — reducing the scrubbing surface and avoiding false positives from lockfile hash values.)

**Solution:** TruffleHog's open-source regex ruleset + entropy scrubber on all MCP payloads at the edge, before any processing.

> **Why TruffleHog's ruleset (not a hand-rolled list of 6 patterns):** A custom list inevitably misses vendor-specific formats (Slack tokens, Stripe restricted keys, GCP service account keys, Azure SAS tokens, etc.). TruffleHog's open-source regex library detects **800+ specific vendor key formats**, maintained by a dedicated security team. We compile their patterns into our Node.js scrubber — no need to run the full TruffleHog Go binary.

```typescript
// lib/mcp/security/scrubber.ts
// Import TruffleHog's open-source regex patterns (800+ vendor-specific detectors)
// Source: https://github.com/trufflesecurity/trufflehog/tree/main/pkg/detectors
import { TRUFFLEHOG_PATTERNS } from './trufflehog-patterns';  // Compiled from TruffleHog's detector regexes

// Fallback patterns for edge cases TruffleHog may miss
const ADDITIONAL_PATTERNS = [
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g,       // Private keys (PEM format)
  /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+/g,         // JWTs
];

const ENTROPY_THRESHOLD = 4.5;  // Shannon entropy — high entropy strings are likely secrets

function scrubSecrets(input: string): { cleaned: string; secretsFound: number } {
  let cleaned = input;
  let count = 0;

  const allPatterns = [...TRUFFLEHOG_PATTERNS, ...ADDITIONAL_PATTERNS];
  for (const pattern of allPatterns) {
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

### 7. Data Lifecycle — 24-Hour Deletion SLA

**Problem:** The landing page guarantees that when a user disconnects a repo, all data is permanently purged within 24 hours. Without an explicit mechanism, orphaned graph data, embeddings, and metadata persist indefinitely — violating enterprise security promises.

**Solution:** A `deleteRepoWorkflow` in Temporal, triggered when a user disconnects a repo or uninstalls the GitHub App.

```typescript
// lib/temporal/workflows/delete-repo.ts
export async function deleteRepoWorkflow(input: { orgId: string; repoId: string }): Promise<DeleteResult> {
  const { orgId, repoId } = input;

  // 1. Mark repo as "deleting" in Prisma (prevents new MCP queries)
  await light.markRepoDeleting({ orgId, repoId });

  // 2. Delete all ArangoDB entities, edges, patterns, rules, ledger entries, snapshots
  const graphResult = await heavy.deleteArangoEntities({ orgId, repoId });
  //    Deletes from: functions, classes, files, interfaces, variables,
  //    contains, calls, imports, extends, implements, patterns, rules,
  //    ledger, snapshots, ledger_summaries, snippets (repo-scoped)

  // 3. Delete pgvector embeddings
  const vectorResult = await light.deletePgvectorEmbeddings({ orgId, repoId });

  // 4. Delete Prisma metadata (repo, API keys, workspaces, reviews, snapshots)
  const metaResult = await light.deletePrismaMetadata({ orgId, repoId });

  // 5. Delete any cloned workspace files from disk
  await heavy.deleteWorkspaceFiles({ orgId, repoId });

  // 6. Log deletion for audit trail (kept in Prisma, not in deleted ArangoDB)
  await light.logDeletion({
    orgId, repoId,
    entitiesDeleted: graphResult.count,
    embeddingsDeleted: vectorResult.count,
    completedAt: new Date(),
  });

  return { success: true, entitiesDeleted: graphResult.count };
}
```

**Trigger points:**
- User clicks "Disconnect" on a repo in the dashboard
- GitHub App uninstall webhook received (`installation.deleted` event)
- Org deletion (cascades to all repos)

**SLA enforcement:**
- Temporal schedules the workflow immediately on disconnect
- If any activity fails, Temporal retries with backoff (up to 24 hours)
- A daily audit cron checks for repos in "deleting" state older than 24 hours → alerts ops

```typescript
// lib/temporal/workflows/deletion-audit.ts
export async function deletionAuditWorkflow(): Promise<AuditResult> {
  const staleRepos = await light.getStaleDeleteRequests({ olderThanHours: 24 });
  if (staleRepos.length > 0) {
    await light.sendOpsAlert({
      severity: 'critical',
      message: `${staleRepos.length} repos stuck in deletion > 24h: ${staleRepos.map(r => r.id).join(', ')}`,
    });
    // Retry the deletion workflow for each stale repo
    for (const repo of staleRepos) {
      await light.retryDeleteRepo({ orgId: repo.orgId, repoId: repo.id });
    }
  }
  return { checked: staleRepos.length };
}
```

**New Prisma model:**

```prisma
model DeletionLog {
  id               String   @id @default(uuid())
  organizationId   String   @map("organization_id")
  repoId           String   @map("repo_id")
  requestedAt      DateTime @map("requested_at")
  completedAt      DateTime? @map("completed_at")
  entitiesDeleted  Int      @default(0) @map("entities_deleted")
  embeddingsDeleted Int     @default(0) @map("embeddings_deleted")
  status           String   @default("pending") // pending | in_progress | completed | failed

  @@map("deletion_logs")
}
```

---

## Phase 0 — Foundation Wiring

**Feature:** _"I can sign up and create an organization (or start without GitHub), then connect one or more GitHub accounts to that organization. I see a dashboard where I can manage repositories."_

### What ships
- Auth flow works end-to-end (Better Auth — already scaffolded)
- Personal organization **auto-provisioned on signup** via Better Auth `databaseHooks` (no welcome screen). Users land directly on the dashboard. GitHub callback strictly requires `orgId` in state — never auto-creates organizations.
- **Multiple GitHub connections per organization:** An organization can connect to multiple GitHub accounts and organizations. Each connection is a separate `github_installations` row. Available repos are aggregated across all connections.
- **GitHub connections management:** `/settings/connections` page for viewing, adding, and removing GitHub connections. API: `GET /api/github/connections`, `DELETE /api/github/connections`.
- Dashboard shell: Resend-style fixed header (logo + Docs) + Void Black sidebar (`w-56`, `bg-[#0A0A0F]`, `border-white/10`) with `DashboardNav` (Overview, Repositories, Search) + dynamic Recents section (top 5 recently updated repos) + `UserProfileMenu` (bottom — organization switching, theme toggle, sign out). Active nav items use Electric Cyan 2px left indicator.
- Overview page: Platform Usage stats grid (4 cards pulling real data from relational + graph stores) → CLI Hero terminal (`npx @autorail/kap10 connect`) → Org-scoped repository grid with Add Repo card.
- Repos page: GitHub-style paginated data table (20/page) with search, GitHub account/org filter, sorting, branch info, MCP session count, inline Open button, "Add Org" action.
- `AccountProvider`: dashboard-only context for organization context switching (only loads on authenticated dashboard routes)
- `ThemeProvider` (next-themes): dark/light mode toggle (default: dark)
- **Ports & Adapters foundation:** All 11 port interfaces defined (`lib/ports/`), production adapters wired (`lib/adapters/`), DI container factory (`lib/di/container.ts`) with `createProductionContainer()` + `createTestContainer()`
- ArangoDB connection established + health check (via `ArangoGraphStore` adapter)
- Temporal server running + health check (both task queues registered, via `TemporalWorkflowEngine` adapter)
- Prisma schema initialized with existing Supabase tables (via `PrismaRelationalStore` adapter)
- Redis connected (via `RedisCacheStore` adapter)
- Langfuse initialized via OpenTelemetry (`instrumentation.ts`) + health check (via `LangfuseObservability` adapter)
- Docker Compose updated: `app` + `temporal` + `redis` + `arangodb` + separate worker containers

### Database changes

**Supabase (via Prisma)** — same DB for Better Auth (in `public`) and kap10 app tables in schema **`kap10`** (see Storage & Infrastructure Split).
```prisma
// prisma/schema.prisma
datasource db {
  provider = "postgresql"
  schemas  = ["public", "kap10"]
}

// Better Auth tables stay in public. Kap10 app tables:
// @@schema("kap10") and @@map("repos"), @@map("deletion_logs"), etc.
```

**ArangoDB** — single-database, pool-based multi-tenancy:

> **Why NOT database-per-org:** ArangoDB spawns isolated V8 contexts, memory buffers, and threads per database. At 1,000+ orgs, this OOMs the cluster. Instead, use a single database with `org_id` + `repo_id` on every document/edge, enforced at the query level.

```
kap10_db                              ← single shared database
├── repos             (document)      ← org_id indexed
├── files             (document)      ← org_id + repo_id indexed
├── functions         (document)      ← org_id + repo_id indexed
├── classes           (document)      ← org_id + repo_id indexed
├── interfaces        (document)      ← org_id + repo_id indexed
├── variables         (document)      ← org_id + repo_id indexed
├── patterns          (document)      ← org_id + repo_id indexed
├── rules             (document)      ← org_id indexed (repo_id optional)
├── snippets          (document)      ← org_id nullable (null = community)
├── ledger            (document)      ← org_id + repo_id indexed (append-only)
├── contains          (edge: file → entity)
├── calls             (edge: fn → fn)
├── imports           (edge: file → file)
├── extends           (edge: class → class)
└── implements        (edge: class → interface)
```

**Tenant isolation enforcement:**

```typescript
// lib/adapters/arango-graph-store.ts — every query includes org_id filter
async getEntitiesByFile(orgId: string, repoId: string, filePath: string): Promise<EntityDoc[]> {
  return this.db.query(aql`
    FOR doc IN functions
      FILTER doc.org_id == ${orgId}
      FILTER doc.repo_id == ${repoId}
      FILTER doc.file_path == ${filePath}
      RETURN doc
  `).then(cursor => cursor.all());
}

// Persistent hash index on [org_id, repo_id] for every collection
await collection.ensureIndex({
  type: 'persistent',
  fields: ['org_id', 'repo_id'],
  name: 'idx_tenant',
});
```

**Edge collections** also carry `org_id` + `repo_id` for filtered traversals:

```typescript
// Graph traversals always filter by tenant
async getCallersOf(orgId: string, entityId: string, depth = 1): Promise<EntityDoc[]> {
  return this.db.query(aql`
    FOR v, e IN 1..${depth} INBOUND ${entityId} calls
      FILTER e.org_id == ${orgId}
      RETURN DISTINCT v
  `).then(cursor => cursor.all());
}
```

### New files
```
lib/
  ports/                           ← Abstract interfaces (zero dependencies)
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
    types.ts                       ← Shared domain types (EntityDoc, EdgeDoc, etc.)
  adapters/                        ← Concrete implementations (one per external dep)
    arango-graph-store.ts          ← IGraphStore → ArangoDB (arangojs)
    prisma-relational-store.ts     ← IRelationalStore → Supabase (Prisma)
    vercel-ai-provider.ts          ← ILLMProvider → Vercel AI SDK
    temporal-workflow-engine.ts    ← IWorkflowEngine → Temporal
    github-host.ts                 ← IGitHost → GitHub (Octokit)
    llamaindex-vector-search.ts    ← IVectorSearch → LlamaIndex + pgvector
    stripe-payments.ts             ← IBillingProvider → Stripe
    langfuse-observability.ts      ← IObservability → Langfuse
    redis-cache-store.ts           ← ICacheStore → Redis
    scip-code-intelligence.ts      ← ICodeIntelligence → SCIP indexers
    semgrep-pattern-engine.ts      ← IPatternEngine → Semgrep CLI
  di/
    container.ts                   ← createProductionContainer() + createTestContainer()
  domain/                          ← Pure business logic (zero external imports)
    entity-hashing.ts
    rule-resolution.ts
    snippet-resolution.ts
    taxonomy-classification.ts
    impact-analysis.ts
  temporal/
    client.ts                      ← Temporal client singleton
    workers/
      heavy-compute.ts             ← Worker for heavy-compute-queue
      light-llm.ts                 ← Worker for light-llm-queue
    connection.ts                  ← Temporal connection config
prisma/
  schema.prisma                    ← Prisma schema (Supabase tables + pgvector)
docker-compose.yml                 ← Add arangodb + temporal services
app/
  (dashboard)/
    layout.tsx                     ← Dashboard shell: header + sidebar (nav + recents + user profile) + main content
    page.tsx                       ← Overview: Platform Usage stats + CLI Hero + repo grid
    repos/page.tsx                 ← Repository management: paginated table with search/filter/sort
    settings/page.tsx              ← Org settings (name, members, danger zone)
  api/
    github/callback/route.ts       ← GitHub App callback (attaches installation to existing organization)
    github/connections/route.ts    ← GET (list connections), DELETE (remove connection)
components/
  dashboard/
    dashboard-header.tsx           ← Fixed top bar: logo + Docs link
    dashboard-nav.tsx              ← Sidebar navigation (Overview, Repositories, Search) + Recents
    user-profile-menu.tsx          ← Sidebar bottom: identity/org switcher dropdown
    overview-stats.tsx             ← StatCard component for Platform Usage grid
    cli-hero.tsx                   ← Terminal panel with CLI command + copy
    overview-repo-card.tsx         ← Compact repo card for overview grid
    overview-add-repo-card.tsx     ← Dashed "Connect Repository" card
    repos-list.tsx                 ← Paginated table: search, filter, sort, branch, MCP, actions
    empty-state-repos.tsx          ← Empty state: no repos connected, CTA to connect GitHub
    dashboard-account-provider.tsx ← Dashboard-only AccountProvider wrapper
  providers/
    account-context.tsx            ← AccountProvider (organization context switching)
    index.tsx                      ← Root Providers (ThemeProvider + AuthProvider; no AccountProvider)
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
- `pnpm test` — `createProductionContainer()` returns all 11 adapters with correct interface compliance
- `pnpm test` — `createTestContainer()` returns all in-memory fakes; overrides replace individual adapters
- `pnpm test` — Domain functions (entity hashing, rule resolution) work with zero external dependencies
- `e2e` — Sign up → dashboard (org auto-provisioned) → connect GitHub → select repos via picker → repo list

---

## Phase 1 — GitHub Connect & Repository Indexing

**Feature:** _"I connect my GitHub account, select a repo, and kap10 indexes it. I can see files, functions, and classes in the dashboard."_

### What ships
- GitHub OAuth integration (via Better Auth social provider)
- GitHub App installation flow (repo access permissions)
- **Multiple GitHub connections per organization:** One organization can connect to multiple GitHub accounts and organizations. Each connection is a separate `github_installations` row.
- **GitHub connections management:** `/settings/connections` page + `GET/DELETE /api/github/connections` API. Users can add new GitHub accounts/orgs and remove existing connections.
- "Connect Repository" modal → select from repos across all connected GitHub installations
- Temporal workflow: `indexRepoWorkflow` — prepare workspace → SCIP index → parse → extract → write to ArangoDB
- Dashboard: repo card shows indexing progress (0% → 100%) via Temporal query
- **Auto-provisioned org:** Personal organization created on signup via `databaseHooks`. GitHub callback strictly requires `orgId` in state — never creates organizations.
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
1. **`prepareWorkspace`** (replaces `cloneRepo`) — Full clone (not shallow!) via **`simple-git`** to a **persistent workspace directory** (`/data/workspaces/{orgId}/{repoId}/`), detect language from `package.json`/`go.mod`/etc., then run language-appropriate dependency install (`npm ci`, `go mod download`, `pip install -r requirements.txt`). **Monorepo detection** (see below). This ensures SCIP indexers can resolve the full type graph. Runs on `heavy-compute-queue`.

> **Phase 5.5 forward-compatibility:** `prepareWorkspace` will gain a conditional branch: if `provider === "local_cli"`, download zip from Supabase Storage via `IStorageProvider.downloadFile()` and extract to the persistent workspace directory instead of `git clone`. The rest of the pipeline (SCIP, entity hashing, writeToArango) remains unchanged.

> **Why `simple-git` (not `execAsync('git clone ...')`):** Running raw shell Git commands in Temporal workers is brittle across OS environments and fails silently with massive diffs. `simple-git` provides a promise-based API with proper auth handling, command queuing, and concurrent operation safety.

> **Implementation Gotcha — The `npm install` Bottleneck:** Enterprise monorepos take 3–5 minutes for a fresh `npm install`. For incremental indexing (Phase 5), this is unacceptable for a 1-line code change. The `heavy-compute-queue` Temporal workers **must use persistent volume claims (PVCs)** or aggressive local disk caching. On incremental re-index: `git.pull()` into the existing cloned directory → `npm install` (2 seconds if `package.json` unchanged) → run SCIP on changed files only. Never clone from scratch for incremental updates.
2. **`runSCIP`** — Run the appropriate SCIP indexer per workspace root (see Monorepo Support below). Produces `.scip` protobuf files. For monorepos, runs per sub-package then merges indices via `scip-cli combine`. Runs on `heavy-compute-queue`.
3. **`parseRest`** — For languages without SCIP indexers (or for additional metadata like JSDoc, decorators), fall back to Tree-sitter WASM parsing. This is a **supplement**, not the primary extraction method. Runs on `heavy-compute-queue`.
4. **`writeToArango`** — Parse the SCIP protobuf output, transform into ArangoDB document/edge format, batch insert. Generates **stable entity hashes** (see below). Runs on `light-llm-queue` (network-bound write).

#### Monorepo Support (Enterprise-Critical)

**Problem:** Enterprise users run monorepos (Turborepo, Nx, Yarn Workspaces, pnpm Workspaces). A single `scip-typescript` at the root fails because `tsconfig.json` files are nested in `apps/` and `packages/`. SCIP can't resolve cross-package types without per-package compilation.

**Solution:** Detect workspace structure → run SCIP per sub-package → merge indices.

```typescript
// lib/indexer/monorepo.ts
interface WorkspaceRoot {
  path: string;           // e.g., "packages/auth"
  language: string;       // "typescript" | "python" | "go" | ...
  packageName: string;    // e.g., "@myapp/auth"
}

async function detectWorkspaceRoots(repoPath: string): Promise<WorkspaceRoot[]> {
  // 1. Check for workspace definitions
  const pkg = await readJson(join(repoPath, 'package.json')).catch(() => null);
  const pnpmWorkspace = await readYaml(join(repoPath, 'pnpm-workspace.yaml')).catch(() => null);

  let workspaceGlobs: string[] = [];

  if (pnpmWorkspace?.packages) {
    workspaceGlobs = pnpmWorkspace.packages;          // pnpm workspaces
  } else if (pkg?.workspaces) {
    workspaceGlobs = Array.isArray(pkg.workspaces)
      ? pkg.workspaces                                 // yarn/npm workspaces
      : pkg.workspaces.packages ?? [];
  } else if (await exists(join(repoPath, 'nx.json'))) {
    workspaceGlobs = ['apps/*', 'packages/*', 'libs/*']; // Nx convention
  }

  if (workspaceGlobs.length === 0) {
    // Not a monorepo — single root
    return [{ path: '.', language: detectLanguage(repoPath), packageName: pkg?.name ?? 'root' }];
  }

  // 2. Resolve globs to actual workspace roots
  const roots: WorkspaceRoot[] = [];
  for (const glob of workspaceGlobs) {
    const matches = await fastGlob(join(glob, 'package.json'), { cwd: repoPath });
    for (const match of matches) {
      const wsPath = dirname(match);
      const wsPkg = await readJson(join(repoPath, match));
      roots.push({
        path: wsPath,
        language: detectLanguage(join(repoPath, wsPath)),
        packageName: wsPkg.name ?? wsPath,
      });
    }
  }

  return roots;
}
```

**SCIP indexing for monorepos:**

```typescript
// lib/indexer/scip-runner.ts
async function runSCIPForWorkspace(repoPath: string): Promise<SCIPIndex> {
  const roots = await detectWorkspaceRoots(repoPath);

  if (roots.length === 1) {
    // Simple repo — single SCIP run
    return runSCIPIndexer(repoPath, roots[0]);
  }

  // Monorepo — run SCIP per sub-package, then merge
  const indices: string[] = [];
  for (const root of roots) {
    const indexPath = await runSCIPIndexer(join(repoPath, root.path), root);
    indices.push(indexPath);
  }

  // Merge all .scip files into a single combined index
  // SCIP CLI has built-in merge: `scip combine -o combined.scip file1.scip file2.scip ...`
  const combinedPath = join(repoPath, '.scip', 'combined.scip');
  await execAsync(`scip combine -o ${combinedPath} ${indices.join(' ')}`);

  return parseSCIPProtobuf(combinedPath);
}
```

**Dependency install for monorepos:**
- `pnpm install` / `yarn install` / `npm ci` at root installs all workspace deps (hoisted)
- Each sub-package's `node_modules` is symlinked or hoisted — SCIP can resolve types
- For non-JS monorepos (Go modules, Python), each sub-package installs independently

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

> **Forward-compatibility note:** In the actual Prisma schema, `githubRepoId` is `BigInt?` and `githubFullName` is `String?` (nullable). This is intentional — it allows the `Repo` model to represent non-GitHub repositories (e.g., local CLI uploads in Phase 5.5). In Phase 5.5, the `RepoProvider` enum gains a `local_cli` value, and repos created via `kap10 push` will have `githubRepoId = null` and `githubFullName = null`.

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
    monorepo.ts            ← Workspace root detection (pnpm/yarn/npm/Nx/Turborepo)
    scip-runner.ts         ← Run SCIP indexers per workspace root, merge for monorepos
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
      github/route.ts     ← GitHub push/PR webhooks (validates x-hub-signature-256 before processing)
    repos/
      route.ts            ← GET repos list, POST connect repo
      [repoId]/route.ts   ← GET repo details, DELETE disconnect
  (dashboard)/
    repos/
      [repoId]/
        page.tsx           ← Repo detail: file tree + entity list
        files/page.tsx     ← Browsable file explorer
```

### GitHub Webhook Security

> **Implementation Gotcha:** Since the incremental indexer (Phase 5) and PR reviewer (Phase 7) are triggered by external HTTP POSTs, a malicious actor could spam the webhook endpoint to trigger expensive `heavy-compute` workflows. **All webhook handlers must validate `x-hub-signature-256` before processing.**

```typescript
// app/api/webhooks/github/route.ts
import { Webhooks } from '@octokit/webhooks';

const webhooks = new Webhooks({
  secret: process.env.GITHUB_WEBHOOK_SECRET!,
});

export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get('x-hub-signature-256') ?? '';

  // Cryptographic verification — rejects forged payloads
  if (!(await webhooks.verify(body, signature))) {
    return new Response('Invalid signature', { status: 401 });
  }

  const event = req.headers.get('x-github-event')!;
  const payload = JSON.parse(body);

  // Only then dispatch to Temporal workflows
  await webhooks.receive({ id: req.headers.get('x-github-delivery')!, name: event as any, payload });

  return new Response('OK', { status: 200 });
}
```

### Core engine integration

**Implemented as modular language plugin architecture in `lib/indexer/`:**

```
lib/indexer/
  types.ts                    — Shared types (ParsedEntity, ParsedEdge, LanguagePlugin)
  entity-hash.ts              — SHA-256 stable identity hashing (16-char hex _key)
  scanner.ts                  — File discovery via git ls-files + .gitignore filtering
  monorepo.ts                 — Workspace root detection (pnpm, yarn, npm, nx, lerna)
  languages/
    types.ts                  — LanguagePlugin interface (runSCIP + parseWithTreeSitter)
    registry.ts               — Extension → plugin mapping, lazy initialization
    typescript/               — TypeScript/JavaScript plugin (.ts/.tsx/.js/.jsx)
      index.ts                — Plugin entry point
      scip.ts                 — scip-typescript runner + protobuf decoder
      tree-sitter.ts          — Regex-based fallback parser
    python/                   — Python plugin (.py/.pyi)
    go/                       — Go plugin (.go)
    generic/                  — Fallback: file-level entities only
```

Each language is isolated in its own folder. New languages are added by creating a plugin folder and registering in `registry.ts`.

**Adaptation required:**
- Replace CozoDB writes with ArangoDB batch inserts (single `kap10_db` database, pool-based tenancy)
- Add `repo_id` and `org_id` to all entities and edges for tenant isolation (see Phase 0 ArangoDB schema)
- Replace local file paths with cloned tmp paths
- Remove local LLM dependency (justification comes in Phase 4)

### Test
- `pnpm test` — `prepareWorkspace` clones and installs deps; SCIP runner produces valid protobuf with cross-file edges; transformer creates correct ArangoDB documents; entity hashes are stable across re-runs
- `pnpm test` — Monorepo detection correctly identifies pnpm/yarn/npm/Nx workspace roots; SCIP runs per sub-package and merges indices; cross-package type references resolve correctly in merged index
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

All tools return responses through the **semantic truncation layer** (see Cross-Cutting §2). All incoming payloads pass through the **edge secret scrubber** (see Cross-Cutting §3). All calls pass through the **runaway agent rate limiter** (see below).

### Runaway Agent Protection

**Problem:** AI agents (especially Cursor in Agent Mode) can enter infinite loops where they call `search_code` or `check_patterns` 15+ times per second. This rapidly exhausts database connections and artificially drains the user's LLM budget before the nightly billing sync catches it.

**Solution:** Battle-tested sliding window rate limiter at the MCP transport layer using `@upstash/ratelimit` (works with standard `ioredis` — no Upstash hosting required).

> **Why not custom Redis sorted sets:** Distributed rate-limiting has notorious race conditions with `MULTI/EXEC`. `@upstash/ratelimit` uses mathematically proven sliding window algorithms that handle concurrent requests correctly out of the box.

```typescript
// lib/mcp/security/rate-limiter.ts
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from 'ioredis';

// Works with standard ioredis — no Upstash hosting required
const redis = new Redis(process.env.REDIS_URL!);

const mcpRateLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, '60 s'),  // 60 tool calls per 60-second sliding window
  prefix: 'rate:mcp',
  analytics: true,  // Track rate limit hits for dashboard visibility
});

async function checkRateLimit(userId: string): Promise<{ allowed: boolean; remaining: number }> {
  const { success, remaining, reset } = await mcpRateLimiter.limit(userId);
  return { allowed: success, remaining };
}
```

**Integrated at MCP transport — before tool dispatch:**

```typescript
// lib/mcp/transport.ts
app.post('/api/mcp/:apiKey', async (req, res) => {
  const raw = req.body;
  const scrubbed = scrubMCPPayload(raw);

  // Rate limit check
  const { allowed, remaining } = await checkRateLimit(redis, ctx.userId);
  if (!allowed) {
    return res.json({
      error: {
        code: 429,
        message: 'Rate limit exceeded. You are calling tools too rapidly — this usually means the agent is in a loop. Pause, review your context, and ask the user for clarification before continuing.',
      },
      meta: { retryAfterSeconds: 30, callsPerMinute: RATE_LIMIT.maxCalls },
    });
  }

  const result = await mcpServer.handleRequest(scrubbed);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.json(result);
});
```

**Why 429 in the MCP response (not just HTTP 429):** Agents parse MCP tool results, not HTTP headers. By putting the "you are looping" message directly in the tool response, the agent reads it and can self-correct. A raw HTTP 429 would just cause the MCP client to retry.

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
      content: generateBootstrapRule(),  // Pre-flight/post-flight sync rules (includes kap10_rule_version in frontmatter)
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
      rate-limiter.ts      ← Token bucket rate limiter (Redis sliding window, 60 calls/min)
    tools/
      index.ts             ← Tool registry
      search.ts            ← search_code tool
      inspect.ts           ← get_function, get_class, get_file
      graph.ts             ← get_callers, get_callees, get_imports
      stats.ts             ← get_project_stats
      sync.ts              ← sync_local_diff tool (Redis lock + cold-start + lockfile stripping)
      diff-filter.ts       ← Strip lockfile/build artifact hunks from diffs
    auth.ts                ← API key validation + repo resolution
    formatter.ts           ← Semantic truncation + pagination for LLM consumption
    workspace.ts           ← Workspace resolution (per-user, per-repo, per-branch)
  onboarding/
    auto-pr.ts             ← Create onboarding PR with Bootstrap Rule + MCP config
    bootstrap-rule.ts      ← Generate kap10.mdc content (with kap10_rule_version)
    rule-updater.ts        ← Compare installed vs latest rule version, open update PR
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
  expiresAt   DateTime @map("expires_at")    // TTL: 12 hours from last sync (configurable per-org, 1–24 h)
  createdAt   DateTime @default(now()) @map("created_at")

  @@unique([userId, repoId, branch])
  @@map("workspaces")
}
```

### Test
- `pnpm test` — MCP tool handlers return correct ArangoDB data; API key auth works; secret scrubber catches all patterns; response truncation respects byte limits; workspace resolution creates/reuses correctly; rate limiter blocks at 70 calls/min and returns 429 with self-correction message
- **Manual integration test** — Add MCP URL to Cursor → ask "what functions are in auth.ts?" → get correct answer; paste code with fake API key → verify it's redacted in logs
- `e2e` — Dashboard → repo → "Connect IDE" → copy MCP URL → API key visible; onboarding PR created on GitHub

---

## Phase 2 Enhancement: Hybrid Repo/Workspace UI Hierarchy

> **Status:** Planned (post-Phase 2 core). Builds on existing Phase 2 Shadow Workspace + Phase 5.5 Prompt Ledger.

### What already exists vs. what this adds

| Already shipped (Phase 1-2) | This enhancement adds |
|------------------------------|----------------------|
| Two-step repo picker modal with branch selection | Workspace pills on repo cards showing active sessions |
| Shadow Workspace isolation per user/repo/branch | Workspace Detail View with ledger audit trace |
| Phase 5.5 `ledger` collection (append-only timeline) | Per-workspace error tracking (`Error.workspaceId`) |
| Redis MCP session state (`mcp:session:{sessionId}`) | Active workspace tracking via Redis key scanning |

### Enhanced Dashboard: Repo Card with Workspace Pills

```
┌─────────────────────────────────────────────────────────────┐
│  📦 my-org/backend-api                        ⚙️  ⋯        │
│  main · Last indexed 2h ago · 1,247 entities               │
│                                                             │
│  Active Workspaces:                                         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │ 🟢 main      │ │ 🟢 feat/auth │ │ 🔴 fix/login │        │
│  │ Alice · 3m   │ │ Bob · 12m    │ │ stale · 2h   │        │
│  └──────────────┘ └──────────────┘ └──────────────┘        │
│                                                             │
│  [Connect IDE]  [View Workspaces]  [Re-index]               │
└─────────────────────────────────────────────────────────────┘
```

Workspace pills are populated by scanning Redis keys matching `mcp:session:*` and cross-referencing with the `Workspace` model. A green indicator means an active MCP session exists; red/stale means the session expired but the workspace record persists.

### Active Workspace Tracking

Active workspace detection reuses existing Redis MCP session keys:

```typescript
// lib/use-cases/workspace-activity.ts
async function getActiveWorkspaces(repoId: string, container: Container) {
  const keys = await container.cacheStore.scanKeys(`mcp:session:*`);
  // Filter sessions belonging to this repo, extract workspace metadata
  // Returns: { workspaceId, userId, branch, lastActiveAt, isLive }[]
}
```

### New Route: Workspace Detail View

**Route:** `/dashboard/repos/[repoId]/workspaces/[workspaceId]`

This page provides deep visibility into a single workspace (user + repo + branch combination):

#### Ledger Audit Trace
Reuses Phase 5.5 `ledger` collection. Renders the append-only timeline filtered to this workspace's branch, showing every AI tool call, prompt, and resulting change.

#### Session-Specific Errors
Errors tagged with `workspaceId` allow filtering to workspace-scoped issues (e.g., failed `sync_local_diff`, broken SCIP indexing on a feature branch).

#### Live Diff View
Shows the workspace overlay (uncommitted AI changes) vs. the base commit. Reuses the Shadow Workspace diff mechanism from Phase 2 core.

### Error Model Extension

Add nullable `workspaceId` field to the error tracking model:

```prisma
model Error {
  // ... existing fields ...
  workspaceId String? @map("workspace_id")
  // Composite format: "userId:repoId:branch" — matches Workspace unique constraint
}
```

This enables filtering errors by workspace context without breaking existing error flows (field is nullable).

### New Files

```
app/dashboard/repos/[repoId]/
  workspaces/
    [workspaceId]/
      page.tsx              # Workspace Detail View (server component)
components/dashboard/
  ledger-trace.tsx          # Ledger Audit Trace component (queries Phase 5.5 ledger)
  session-errors.tsx        # Session-scoped error list component
  live-diff.tsx             # Workspace overlay diff viewer
lib/use-cases/
  activity-tracker.ts       # Redis key scanning for active workspace detection
  workspace-resolver.ts     # Resolve workspaceId → workspace metadata + ledger data
```

### Integration Points

- **Phase 2 (Shadow Workspace):** Workspace Detail View renders the same overlay data that MCP tools consume. The `live-diff.tsx` component calls `getWorkspaceOverlay()` from the existing graph store.
- **Phase 5.5 (Prompt Ledger):** `ledger-trace.tsx` queries the `ledger` ArangoDB collection filtered by `branch` field matching the workspace's branch. Reuses existing `get_timeline` MCP tool logic.
- **Redis (MCP Sessions):** Activity tracker scans `mcp:session:*` keys to determine which workspaces have live IDE connections.

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
| **Embedding** | Raw OpenAI API calls + batch management ($$$) | `HuggingFaceEmbedding` via `@xenova/transformers` — **$0 cost**, local CPU, infinite parallelism |
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
│  │ LlamaIndex     │    │ LlamaIndex +    │    │ LlamaIndex         │  │
│  │ Document from   │    │ Transformers.js │    │ PGVectorStore      │  │
│  │ name+sig+body  │    │ (nomic-embed)   │    │ (Supabase pgvector)│  │
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

// IMPORTANT: Prisma owns the schema. Set createTable: false so LlamaIndex
// doesn't fight Prisma over migrations. Prisma pushes the pgvector extension
// and entity_embeddings table; LlamaIndex just reads/writes.
const vectorStore = new PGVectorStore({
  connectionString: process.env.SUPABASE_DB_URL,
  tableName: "entity_embeddings",
  dimensions: 768,     // nomic-embed-text produces 768-dim vectors
  createTable: false,  // Prisma manages schema — see prisma/schema.prisma
});

// LOCAL embeddings via Transformers.js — $0 cost, no API rate limits, infinite parallelism
// Runs inside Temporal light-llm-queue workers (Node.js, no GPU required)
// Save the OpenAI/Anthropic budget for business justification (Phase 4)
import { HuggingFaceEmbedding } from "llamaindex/embeddings/HuggingFaceEmbedding";

const embedModel = new HuggingFaceEmbedding({
  modelType: "nomic-ai/nomic-embed-text-v1.5",  // 768-dim, top-tier quality, runs on CPU
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

### Architecture Health Report (Post-Onboarding)

**Purpose:** After the first full indexing + justification completes, kap10 automatically generates a comprehensive Architecture Health Report. This serves two goals:
1. **Immediate value demonstration** — the user sees that kap10 *actually understands* their codebase before they even start using it with agents
2. **Baseline for improvement** — identifies existing problems that AI agents are notorious for causing (and that kap10 will prevent going forward)

**Triggered:** Automatically after `justifyRepoWorkflow` completes for a newly connected repo.

```typescript
// lib/temporal/workflows/health-report.ts
export async function generateHealthReportWorkflow(input: {
  orgId: string;
  repoId: string;
}): Promise<HealthReport> {
  // 1. Gather data from the completed knowledge graph
  const stats = await light.gatherRepoStats(input);
  const entities = await light.getAllEntities(input);
  const edges = await light.getAllEdges(input);
  const taxonomy = await light.getTaxonomyData(input);

  // 2. Run analysis activities
  const [
    deadCode,
    architectureDrift,
    testingGaps,
    duplicateLogic,
    circularDeps,
    unusedExports,
    complexityHotspots,
  ] = await Promise.all([
    light.detectDeadCode({ entities, edges }),
    light.detectArchitectureDrift({ entities, taxonomy }),
    light.detectTestingGaps({ entities, edges }),
    light.detectDuplicateLogic({ entities }),
    light.detectCircularDeps({ edges }),
    light.detectUnusedExports({ entities, edges }),
    light.detectComplexityHotspots({ entities }),
  ]);

  // 3. LLM-powered synthesis: executive summary + recommendations
  const synthesis = await light.synthesizeReport({
    ...input,
    deadCode, architectureDrift, testingGaps,
    duplicateLogic, circularDeps, unusedExports, complexityHotspots,
    stats, taxonomy,
  });

  // 4. Store report
  await light.storeHealthReport(input, synthesis);

  return synthesis;
}
```

**Report Schema (structured output via `generateObject`):**

```typescript
const HealthReportSchema = z.object({
  executiveSummary: z.string().describe('2-3 sentence overview of codebase health'),
  overallScore: z.number().min(0).max(100).describe('Aggregate health score'),

  sections: z.object({
    deadCode: z.object({
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      count: z.number().describe('Number of dead/unreachable functions, classes, files'),
      topOffenders: z.array(z.object({
        entityId: z.string(),
        name: z.string(),
        filePath: z.string(),
        reason: z.string().describe('Why this is dead code'),
      })).max(10),
      recommendation: z.string(),
    }),

    architectureDrift: z.object({
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      issues: z.array(z.object({
        pattern: z.string().describe('e.g., "Direct DB access in API routes bypassing service layer"'),
        occurrences: z.number(),
        affectedFiles: z.array(z.string()).max(5),
        recommendation: z.string(),
      })).max(10),
    }),

    testingGaps: z.object({
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      untestedVerticals: z.array(z.object({
        featureArea: z.string(),
        entityCount: z.number(),
        testedCount: z.number(),
        coveragePercent: z.number(),
      })).max(10),
      recommendation: z.string(),
    }),

    duplicateLogic: z.object({
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      clusters: z.array(z.object({
        description: z.string().describe('What logic is duplicated'),
        entities: z.array(z.string()).describe('Entity IDs with near-identical logic'),
        recommendation: z.string().describe('How to consolidate'),
      })).max(10),
    }),

    circularDependencies: z.object({
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      cycles: z.array(z.object({
        path: z.array(z.string()).describe('File/module cycle path'),
        recommendation: z.string(),
      })).max(10),
    }),

    unusedExports: z.object({
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      count: z.number(),
      topOffenders: z.array(z.object({
        filePath: z.string(),
        exportName: z.string(),
        reason: z.string(),
      })).max(10),
    }),

    complexityHotspots: z.object({
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      hotspots: z.array(z.object({
        entityId: z.string(),
        name: z.string(),
        filePath: z.string(),
        cyclomaticComplexity: z.number(),
        linesOfCode: z.number(),
        inboundEdges: z.number().describe('How many callers depend on this'),
        recommendation: z.string(),
      })).max(10),
    }),
  }),

  llmRiskAssessment: z.object({
    summary: z.string().describe('How susceptible is this codebase to AI-generated regressions?'),
    risks: z.array(z.object({
      risk: z.string().describe('e.g., "No service layer boundary — AI agents will bypass abstractions"'),
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      mitigation: z.string().describe('What kap10 will do to prevent this'),
    })).max(5),
  }),

  suggestedRules: z.array(z.object({
    title: z.string(),
    description: z.string(),
    type: z.enum(['architectural', 'syntactic', 'convention']),
    enforcement: z.enum(['suggest', 'warn', 'block']),
  })).max(10).describe('Rules that should be created based on the analysis'),
});
```

**Analysis activities (graph-based, not LLM-based where possible):**

| Analysis | Method | What it detects |
|----------|--------|-----------------|
| **Dead Code** | Graph traversal: entities with 0 inbound edges (no callers) and not entry points | Functions/classes that are never called anywhere |
| **Architecture Drift** | Taxonomy analysis: VERTICAL entities directly importing other VERTICAL entities (should go through HORIZONTAL) | Layer violation, missing service boundaries |
| **Testing Gaps** | Cross-reference with test file patterns: entities in VERTICAL features with no corresponding `*.test.*` or `*.spec.*` files | Untested business-critical code |
| **Duplicate Logic** | Embedding cosine similarity: entities with >0.92 similarity in purpose + code structure | Copy-pasted logic that should be a shared utility |
| **Circular Deps** | Graph cycle detection (Tarjan's SCC on import edges) | Module cycles that create fragility |
| **Unused Exports** | Export analysis: exported symbols with 0 external references | API surface bloat |
| **Complexity** | AST metrics: cyclomatic complexity + LOC + fan-in (inbound edges) | High-risk hotspots where AI changes are most dangerous |

**Dashboard:**
- `/dashboard/repos/[repoId]/health` — Full health report with expandable sections, severity badges, and "Create Rule" buttons next to each suggestion
- Report is generated once after initial onboarding, then refreshed after each full re-index
- Users can export as PDF for enterprise compliance documentation

**Auto-seeded rules:** The `suggestedRules` from the report can be one-click promoted to active rules in the Rules Engine (Phase 6), giving users an instant set of guardrails based on their actual codebase's architecture.

### Test
- `pnpm test` — topological sort produces correct level ordering; Vercel AI SDK `generateObject` returns typed taxonomy; feature aggregation groups correctly
- `pnpm test` — Dead code detection finds entities with 0 inbound edges; architecture drift catches VERTICAL→VERTICAL imports; testing gap analysis cross-references test files; health report `generateObject` produces valid typed output with all sections
- **Manual** — MCP `get_business_context` for a login handler → returns "HORIZONTAL / authentication / Consumers: User Management, Checkout, Admin"
- **Manual** — MCP `get_blueprint` → returns features list with entity counts and user flows
- `e2e` — Dashboard → entity detail → justification + classification card; Dashboard → Blueprint → React Flow graph with business swimlanes
- `e2e` — After initial indexing completes → health report auto-generated → `/dashboard/repos/[repoId]/health` shows report with severity badges → "Create Rule" button creates active rule

---

## Phase 5 — Incremental Indexing & GitHub Webhooks

**Feature:** _"When I push to GitHub, kap10 automatically re-indexes only the changed files. My MCP connection always has up-to-date knowledge."_

> **Performance Note:** Incremental indexing reuses the **persistent workspace** from Phase 1 (`/data/workspaces/{orgId}/{repoId}/`). On push webhook: `git pull` into the existing directory → `npm install` (instant if `package.json` unchanged) → SCIP on changed files only. This keeps incremental re-index latency under 30 seconds for typical pushes, even on large monorepos.

### What ships
- GitHub `push` webhook handler (validates `x-hub-signature-256`) → detect changed files → re-index only those
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

## Phase 5.5 — Prompt Ledger, Rewind & Branching

**Feature:** _"Every AI-generated change is tracked with the prompt that caused it. When the AI breaks something, I click 'Rewind' to restore to the last working state — and kap10 automatically creates a rule so the AI never makes that mistake again. After a rewind, all subsequent prompts appear as a new timeline branch."_

This is the **"black box recorder"** for AI-assisted development — the feature that makes the Loop of Death impossible.

### What ships
- **Prompt Ledger:** Append-only timeline tracking `{prompt} → {changes}` for every AI-generated modification
- **Working State Snapshots:** Automatic snapshots when code passes validation (tests pass, no lint errors, user explicitly marks as "working")
- **Rewind MCP Tool:** `revert_to_working_state` — restores specific files/functions to a previous working snapshot
- **Anti-Pattern Rule Synthesis:** After rewind, LLM analyzes the failed changes and generates a rule to prevent the same mistake
- **Timeline Branching:** After a rewind, all subsequent prompts form a new timeline branch (like git branching, but for prompts)
- **Local Sync via CLI:** A lightweight `kap10` CLI that streams ledger entries between the user's local workspace and the cloud
- **Dashboard Timeline:** Visual timeline with working/broken states, branch points, and rewind actions
- **Roll-up on Commit:** When the user commits, all pending ledger entries are rolled up into a single commit-linked summary

### The Prompt Ledger

Every time `sync_local_diff` is called with changes from an AI agent, the ledger captures what prompted those changes:

```typescript
// lib/ledger/schema.ts
const LedgerEntrySchema = z.object({
  id: z.string(),                     // UUID
  orgId: z.string(),
  repoId: z.string(),
  userId: z.string(),
  branch: z.string(),                 // git branch
  timelineBranch: z.number().default(0),  // 0 = main timeline, 1+ = post-rewind branches

  // What caused the change
  prompt: z.string(),                 // The user's prompt to the AI agent
  agentModel: z.string().optional(),  // "claude-3.5-sonnet", "gpt-4o", etc.
  agentTool: z.string().optional(),   // "cursor", "claude-code", "windsurf"
  mcpToolsCalled: z.array(z.string()).optional(),  // Which kap10 tools the agent used

  // What changed
  changes: z.array(z.object({
    filePath: z.string(),
    entityId: z.string().optional(),  // Link to ArangoDB entity if identifiable
    changeType: z.enum(['added', 'modified', 'deleted']),
    diff: z.string(),                 // Unified diff of the change
    linesAdded: z.number(),
    linesRemoved: z.number(),
  })),

  // State
  status: z.enum([
    'pending',           // Change applied, not yet validated
    'working',           // Passed validation (tests/lint/user approval)
    'broken',            // Failed validation
    'reverted',          // Undone via rewind
    'committed',         // Rolled up into a git commit
  ]).default('pending'),

  // Linkage
  parentId: z.string().nullable(),     // Previous ledger entry (linked list)
  rewindTargetId: z.string().nullable(), // If this entry is a rewind, what it reverted to
  commitSha: z.string().nullable(),    // Set when changes are committed
  snapshotId: z.string().nullable(),   // Link to working-state snapshot

  // Metadata
  createdAt: z.date(),
  validatedAt: z.date().nullable(),
  ruleGenerated: z.string().nullable(),  // Rule ID if anti-pattern rule was created from rewind
});
```

### Working State Snapshots

A snapshot captures the content of affected files at a known-good point:

```typescript
// lib/ledger/snapshot.ts
const SnapshotSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  repoId: z.string(),
  userId: z.string(),
  branch: z.string(),
  timelineBranch: z.number(),

  ledgerEntryId: z.string(),         // The ledger entry that was marked "working"
  reason: z.enum([
    'tests_passed',                   // Automated: test suite passed after this change
    'user_marked',                    // User clicked "Mark as Working" in dashboard
    'commit',                         // User committed (implicit working state)
    'session_start',                  // Baseline snapshot at session start
  ]),

  files: z.array(z.object({
    filePath: z.string(),
    content: z.string(),             // Full file content at snapshot time
    entityHashes: z.array(z.string()), // Entity hashes at this point (for entity-level rewind)
  })),

  createdAt: z.date(),
});
```

**When snapshots are taken:**
1. **Session start** — when `sync_local_diff` is first called, snapshot all tracked files
2. **Tests pass** — if the Bootstrap Rule's post-flight `check_patterns` passes, auto-snapshot
3. **User marks working** — explicit "Mark as Working" button in dashboard timeline
4. **Pre-commit** — when the user commits, snapshot before roll-up

### Rewind MCP Tool

```typescript
// lib/mcp/tools/rewind.ts
const RevertToWorkingStateTool = {
  name: 'revert_to_working_state',
  description: 'Restore files to a previous working state when the AI broke something. Returns the file contents at the selected snapshot and generates an anti-pattern rule.',
  inputSchema: z.object({
    snapshotId: z.string().optional().describe('Specific snapshot to revert to. If omitted, uses the most recent working snapshot.'),
    files: z.array(z.string()).optional().describe('Specific files to revert. If omitted, reverts all files changed since the snapshot.'),
    reason: z.string().describe('Why is the rewind needed? Used to generate an anti-pattern rule.'),
  }),
  handler: async ({ snapshotId, files, reason }, ctx) => {
    // 1. Find the target snapshot
    const snapshot = snapshotId
      ? await ledgerStore.getSnapshot(snapshotId)
      : await ledgerStore.getMostRecentWorkingSnapshot(ctx.orgId, ctx.repoId, ctx.userId, ctx.branch);

    if (!snapshot) throw new Error('No working snapshot found. Try committing your known-good state first.');

    // 2. Determine which files to revert
    const filesToRevert = files
      ? snapshot.files.filter(f => files.includes(f.filePath))
      : snapshot.files;

    // 3. Create a rewind ledger entry
    const rewindEntry = await ledgerStore.createEntry({
      ...ctx,
      prompt: `REWIND: ${reason}`,
      changes: filesToRevert.map(f => ({
        filePath: f.filePath,
        changeType: 'modified' as const,
        diff: '[rewind to snapshot]',
        linesAdded: 0,
        linesRemoved: 0,
      })),
      status: 'working',
      rewindTargetId: snapshot.id,
    });

    // 4. Increment timeline branch counter (all future prompts go on new branch)
    await ledgerStore.incrementTimelineBranch(ctx.orgId, ctx.repoId, ctx.userId, ctx.branch);

    // 5. Synthesize anti-pattern rule from the failure
    const rule = await synthesizeAntiPatternRule(reason, snapshot, rewindEntry, ctx);

    // 6. Return file contents for the agent to apply
    return {
      restoredFiles: filesToRevert.map(f => ({ path: f.filePath, content: f.content })),
      newTimelineBranch: rewindEntry.timelineBranch,
      antiPatternRule: rule ? { id: rule.id, title: rule.title, description: rule.description } : null,
      message: `Reverted ${filesToRevert.length} files to snapshot ${snapshot.id}. Timeline branch ${rewindEntry.timelineBranch} created. ${rule ? `Anti-pattern rule "${rule.title}" added.` : ''}`,
    };
  },
};
```

### Anti-Pattern Rule Synthesis

After every rewind, kap10 uses the LLM to analyze what went wrong and generate a rule to prevent recurrence:

```typescript
// lib/ledger/anti-pattern.ts
import { generateObject } from 'ai';

const AntiPatternSchema = z.object({
  title: z.string().describe('Short rule name, e.g. "Do not use Library X for auth"'),
  description: z.string().describe('Why this pattern is harmful and what to do instead'),
  type: z.literal('architectural'),
  scope: z.literal('repo'),
  enforcement: z.enum(['warn', 'block']),
  semgrepRule: z.string().optional().describe('Semgrep YAML pattern to detect this anti-pattern, if applicable'),
});

async function synthesizeAntiPatternRule(
  reason: string,
  snapshot: Snapshot,
  rewindEntry: LedgerEntry,
  ctx: OrgContext,
): Promise<Rule | null> {
  // Get the failed changes (entries between snapshot and rewind)
  const failedEntries = await ledgerStore.getEntriesBetween(snapshot.ledgerEntryId, rewindEntry.id);

  const { object: antiPattern } = await container.llmProvider.generateObject({
    model: 'gpt-4o',
    schema: AntiPatternSchema,
    prompt: `A developer used an AI agent to make changes to their codebase. The changes broke the code and had to be reverted.

## Why the rewind was needed
${reason}

## Failed changes (prompts and diffs)
${failedEntries.map(e => `Prompt: ${e.prompt}\nFiles changed: ${e.changes.map(c => c.filePath).join(', ')}\nDiff:\n${e.changes.map(c => c.diff).join('\n')}`).join('\n---\n')}

## Working state that was restored to
Files: ${snapshot.files.map(f => f.filePath).join(', ')}

Generate a concise architectural rule that would prevent this mistake from happening again. The rule should be actionable and specific.`,
    context: ctx,
  });

  // Save the rule to the Rules Engine (Phase 6)
  return container.graphStore.upsertRule(ctx.orgId, {
    ...antiPattern,
    orgId: ctx.orgId,
    repoId: ctx.repoId,
    createdBy: 'system:rewind',
    status: 'active',
    priority: 10,  // High priority — learned from failure
  });
}
```

### Timeline Branching

After a rewind, the timeline forks. This is conceptually similar to git branching, but for the prompt history:

```
Timeline Branch 0 (main):
  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────────┐
  │ S1  │→ │ S2  │→ │ S3  │→ │ S4  │→ │ REWIND  │
  │ ✓   │  │ ✓   │  │ ✗   │  │ ✗   │  │ → S2    │
  └─────┘  └─────┘  └─────┘  └─────┘  └────┬────┘
                                             │
Timeline Branch 1 (post-rewind):             │
                                        ┌────▼────┐  ┌─────┐  ┌─────┐
                                        │ S5      │→ │ S6  │→ │ S7  │
                                        │ (new)   │  │ ✓   │  │ ✓   │
                                        └─────────┘  └─────┘  └─────┘

Legend: ✓ = working, ✗ = broken, S = step
```

The branching model:
- **Branch 0** is always the main timeline from session start
- When a rewind happens, `timelineBranch` increments by 1
- All subsequent ledger entries get the new branch number
- The dashboard shows branches as parallel lanes, with the rewind point as a merge arrow
- Multiple rewinds create multiple branches (branch 2, 3, etc.)
- On commit, only the entries from the **active** (latest) branch are rolled up

### Roll-Up on Commit

When `sync_local_diff` detects a new commit SHA (different from the last known `baseSha`), it triggers roll-up:

```typescript
// lib/ledger/rollup.ts
async function rollUpOnCommit(ctx: OrgContext, commitSha: string): Promise<void> {
  // Get all uncommitted ledger entries for this user/repo/branch
  const activeTimeline = await ledgerStore.getActiveTimelineBranch(ctx);
  const pendingEntries = await ledgerStore.getUncommittedEntries(ctx, activeTimeline);

  if (pendingEntries.length === 0) return;

  // Mark all entries as committed
  for (const entry of pendingEntries) {
    await ledgerStore.updateEntry(entry.id, {
      status: 'committed',
      commitSha,
    });
  }

  // Create a commit summary in ArangoDB's ledger collection
  await container.graphStore.upsertLedgerSummary(ctx.orgId, {
    commitSha,
    repoId: ctx.repoId,
    userId: ctx.userId,
    branch: ctx.branch,
    entryCount: pendingEntries.length,
    promptSummary: pendingEntries.map(e => e.prompt).join(' → '),
    totalFilesChanged: new Set(pendingEntries.flatMap(e => e.changes.map(c => c.filePath))).size,
    totalLinesAdded: pendingEntries.reduce((sum, e) => sum + e.changes.reduce((s, c) => s + c.linesAdded, 0), 0),
    totalLinesRemoved: pendingEntries.reduce((sum, e) => sum + e.changes.reduce((s, c) => s + c.linesRemoved, 0), 0),
    rewindCount: pendingEntries.filter(e => e.rewindTargetId).length,
    rulesGenerated: pendingEntries.filter(e => e.ruleGenerated).map(e => e.ruleGenerated!),
    createdAt: new Date(),
  });

  // Reset timeline branch to 0 for next session
  await ledgerStore.resetTimelineBranch(ctx);
}
```

### kap10 CLI — Local Workspace Sync

A lightweight CLI tool for real-time ledger streaming between the user's local machine and kap10 cloud. This enables rewind to work even without the agent — the user can rewind from the terminal.

```bash
# Install
npm install -g @autorail/kap10

# Authenticate
kap10 auth login

# --- Local Repo Ingestion (Phase 5.5) ---

# Initialize a local repo for kap10 indexing
kap10 init --org my-org

# Push codebase for indexing (zip + upload + trigger)
kap10 push
kap10 push -m "Added new auth module"

# --- Ledger & Rewind ---

# Start watching (streams changes to ledger in real-time)
kap10 watch --repo owner/repo --branch main

# View timeline
kap10 timeline

# Rewind to last working state
kap10 rewind                          # Latest working snapshot
kap10 rewind --snapshot snap_abc123   # Specific snapshot
kap10 rewind --steps 3               # Go back 3 working states

# Mark current state as working
kap10 mark-working

# View branches
kap10 branches
```

**CLI Architecture:**

```typescript
// packages/cli/src/watch.ts
async function watchMode(config: WatchConfig): Promise<void> {
  const watcher = chokidar.watch(config.repoPath, {
    ignored: ['node_modules', '.git', 'dist'],
    persistent: true,
  });

  let debounceTimer: NodeJS.Timeout;

  watcher.on('change', (filePath) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      // Get current diff
      const diff = await execAsync('git diff HEAD', { cwd: config.repoPath });
      if (!diff.trim()) return;

      // Get the last prompt from the agent's conversation (if available)
      const prompt = await getLastAgentPrompt(config);  // Reads from .cursor/prompts or similar

      // Stream to kap10 cloud
      await kap10Client.syncDiff({
        diff,
        branch: await getCurrentBranch(config.repoPath),
        baseSha: await getHeadSha(config.repoPath),
        prompt: prompt ?? '[manual edit — no agent prompt detected]',
      });
    }, 1000);  // 1s debounce
  });

  // Listen for rewind commands from cloud (triggered via dashboard)
  kap10Client.onRewindEvent(async (event) => {
    for (const file of event.restoredFiles) {
      await writeFile(join(config.repoPath, file.path), file.content);
    }
    console.log(`⏪ Reverted ${event.restoredFiles.length} files to snapshot ${event.snapshotId}`);
    if (event.antiPatternRule) {
      console.log(`🛡️ Anti-pattern rule added: "${event.antiPatternRule.title}"`);
    }
  });
}
```

**How the CLI detects which prompt caused a change:**
1. **Agent-initiated changes:** When the agent calls `sync_local_diff` via MCP, the prompt is already part of the MCP context — the agent sends it as metadata.
2. **CLI watch mode:** The CLI watches for file changes. It tries to extract the prompt from agent logs (`.cursor/prompts/`, Claude Code conversation context, etc.). If no prompt is found, it records the change as `[manual edit]`.
3. **Hybrid:** The Bootstrap Rule instructs the agent to call `sync_local_diff` with the prompt. The CLI is a fallback for changes the agent doesn't report.

### CLI-First Local Ingestion

In addition to the ledger/rewind capabilities above, Phase 5.5 adds **local repo ingestion** — allowing users to index codebases that aren't hosted on GitHub. Users zip and upload their local repo via `kap10 push`, and the same indexing pipeline (SCIP, entity hashing, writeToArango) processes it.

#### New CLI Commands

| Command | Description |
|---------|-------------|
| `kap10 init` | Initialize a local repo for kap10 indexing. Creates `.kap10/config.json` with `repoId`, `orgId`, and API key. Calls `POST /api/cli/init` to register the repo in Supabase with `provider: "local_cli"`. |
| `kap10 push` | Zip the current directory (`.gitignore`-aware via `ignore` + `archiver`), request a pre-signed upload URL from the server, upload directly to Supabase Storage, then call `POST /api/cli/index` to trigger the indexing workflow. |

```bash
# Initialize a local repo
kap10 init --org my-org
# → Creates .kap10/config.json, registers repo in Supabase

# Push codebase for indexing
kap10 push
# → Zips repo (respecting .gitignore), uploads via pre-signed URL, triggers indexing

# Push with message (for tracking)
kap10 push -m "Added new auth module"
```

#### Why Pre-Signed Upload (Not Direct POST)

Vercel serverless functions have a **30-second timeout** and **4.5 MB body limit**. Codebases routinely exceed both. The flow is:

1. CLI calls `POST /api/cli/init` → server creates repo row, returns `repoId`
2. CLI calls `POST /api/cli/index` → server generates a **pre-signed upload URL** via `IStorageProvider.generateUploadUrl()` and returns it
3. CLI uploads zip **directly to Supabase Storage** using the pre-signed URL (bypasses Vercel entirely — no timeout, no body limit)
4. CLI calls `POST /api/cli/index` again with `{ uploaded: true }` → server triggers `indexRepoWorkflow` via Temporal

#### New API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/cli/init` | `POST` | Register a local repo. Creates `Repo` row with `provider: "local_cli"`, `githubRepoId: null`. Returns `repoId` + API key. |
| `/api/cli/index` | `POST` | Phase 1: Generate pre-signed upload URL. Phase 2 (after upload): Trigger `indexRepoWorkflow` with `provider: "local_cli"`. |

#### Sync Drift Challenge

Unlike GitHub repos (where webhooks notify of changes), local repos have no push event. The codebase can drift between `kap10 push` invocations.

**Solutions:**
- **Periodic re-sync:** Users run `kap10 push` whenever they want the index updated (manual trigger, similar to `git push`)
- **20% drift threshold:** If `kap10 watch` detects >20% of indexed files have local modifications, it prompts the user to run `kap10 push` to re-index
- **Incremental push (future):** Phase 5's incremental indexing can be extended to accept diffs from the CLI, but initial implementation is full re-index on each push

#### `IStorageProvider` — 12th Port

Phase 5.5 introduces the **12th port** in the hexagonal architecture:

```typescript
// lib/ports/storage-provider.ts
export interface IStorageProvider {
  /**
   * Generate a pre-signed URL for direct client upload.
   * @param bucket - Storage bucket name (e.g., "cli_uploads")
   * @param path - Object path within the bucket (e.g., "{orgId}/{repoId}/{timestamp}.zip")
   * @param expiresInSeconds - URL validity duration (default: 600 = 10 minutes)
   * @returns Pre-signed upload URL
   */
  generateUploadUrl(bucket: string, path: string, expiresInSeconds?: number): Promise<string>;

  /**
   * Download a file from storage.
   * Used by `prepareWorkspace` to fetch the uploaded zip for local_cli repos.
   */
  downloadFile(bucket: string, path: string): Promise<Buffer>;

  /**
   * Delete a file from storage.
   * Called after successful indexing to clean up the uploaded zip.
   */
  deleteFile(bucket: string, path: string): Promise<void>;

  /** Health check for the storage backend. */
  healthCheck(): Promise<{ status: 'up' | 'down'; latencyMs: number }>;
}
```

**Production adapter:** `SupabaseStorageAdapter` (`lib/adapters/supabase-storage.ts`) — wraps `@supabase/storage-js`. Bucket: `cli_uploads` (created via Supabase dashboard or migration script). Objects stored at path `{orgId}/{repoId}/{timestamp}.zip`. Auto-cleaned after indexing completes.

**Test fake:** `InMemoryStorageProvider` — stores files in a `Map<string, Buffer>`. Returns `data:` URLs for `generateUploadUrl()`. Added to `lib/di/fakes.ts`.

**DI Container:** `createProductionContainer()` gains a 12th getter for `storageProvider`. `createTestContainer()` wires `InMemoryStorageProvider`.

### ArangoDB Collections

The ledger uses ArangoDB for append-only storage (it's fast at inserts and AQL can efficiently query sorted timelines):

```javascript
// ledger collection (append-only)
{
  _key: "entry_uuid",
  org_id: "org_123",
  repo_id: "repo_456",
  user_id: "user_789",
  branch: "main",
  timeline_branch: 0,
  prompt: "Add Apple Pay to the checkout flow",
  agent_model: "claude-3.5-sonnet",
  changes: [
    { file_path: "src/checkout/payment.ts", change_type: "modified", diff: "...", lines_added: 15, lines_removed: 3 }
  ],
  status: "working",
  parent_id: "entry_previous_uuid",
  rewind_target_id: null,
  commit_sha: null,
  snapshot_id: "snap_uuid",
  created_at: "2026-02-17T10:30:00Z"
}

// snapshots collection
{
  _key: "snap_uuid",
  org_id: "org_123",
  repo_id: "repo_456",
  user_id: "user_789",
  branch: "main",
  timeline_branch: 0,
  ledger_entry_id: "entry_uuid",
  reason: "tests_passed",
  files: [
    { file_path: "src/checkout/payment.ts", content: "...", entity_hashes: ["abc123", "def456"] }
  ],
  created_at: "2026-02-17T10:30:05Z"
}

// ledger_summaries collection (commit roll-ups)
{
  _key: "summary_uuid",
  commit_sha: "abc123def",
  org_id: "org_123",
  repo_id: "repo_456",
  user_id: "user_789",
  branch: "main",
  entry_count: 7,
  prompt_summary: "Add Apple Pay → Fix import → Update types → REWIND → Add Apple Pay (retry) → Fix tests → Polish UI",
  total_files_changed: 4,
  total_lines_added: 89,
  total_lines_removed: 12,
  rewind_count: 1,
  rules_generated: ["rule_uuid_1"],
  created_at: "2026-02-17T11:45:00Z"
}
```

### New MCP Tools

| Tool | Description |
|------|-------------|
| `revert_to_working_state` | Restore files to a previous working snapshot. Generates anti-pattern rule. Creates new timeline branch. |
| `get_timeline` | "What changes has the AI made in this session?" → Ledger entries with prompts, diffs, status, branches |
| `mark_working` | Explicitly mark the current state as a working snapshot (user-initiated via agent or dashboard) |

### Dashboard Pages

- `/dashboard/repos/[repoId]/timeline` — Visual timeline showing prompts, changes, working/broken states, rewind points, and branches as parallel lanes
- `/dashboard/repos/[repoId]/timeline/[entryId]` — Detail view of a specific change: prompt, diff, files affected, rules generated
- `/dashboard/repos/[repoId]/commits` — Commit history with rolled-up ledger summaries showing the AI's contribution per commit

### New Files

```
lib/
  ledger/
    schema.ts              ← LedgerEntry, Snapshot, LedgerSummary Zod schemas
    store.ts               ← ArangoDB CRUD: append entries, query timelines, manage branches
    snapshot.ts            ← Working state snapshot creation + retrieval
    rollup.ts              ← Commit roll-up logic (mark committed, create summary)
    anti-pattern.ts        ← LLM-powered anti-pattern rule synthesis after rewind
  ports/
    storage-provider.ts    ← IStorageProvider interface (12th port) — pre-signed upload, download, delete
  adapters/
    supabase-storage.ts    ← SupabaseStorageAdapter implements IStorageProvider (bucket: cli_uploads)
  mcp/tools/
    rewind.ts              ← revert_to_working_state MCP tool
    timeline.ts            ← get_timeline, mark_working MCP tools
packages/
  cli/                     ← @autorail/kap10 npm package (separate package in monorepo)
    src/
      index.ts             ← CLI entry point (commander.js)
      commands/
        init.ts            ← kap10 init — register local repo, create .kap10/config.json
        push.ts            ← kap10 push — zip + pre-signed upload + trigger indexing
        watch.ts           ← kap10 watch — file watcher + ledger streaming
        rewind.ts          ← kap10 rewind — restore from terminal
        timeline.ts        ← kap10 timeline — view prompt history
        mark-working.ts    ← kap10 mark-working — explicit snapshot
        branches.ts        ← kap10 branches — view timeline branches
        auth.ts            ← kap10 auth login/logout
      client.ts            ← HTTP client for kap10 API
      prompt-detector.ts   ← Extract agent prompt from Cursor/Claude Code/Windsurf logs
app/
  api/
    cli/
      init/route.ts        ← POST /api/cli/init — register local repo (provider: local_cli)
      index/route.ts       ← POST /api/cli/index — pre-signed URL generation + trigger indexing
  (dashboard)/
    repos/
      [repoId]/
        timeline/
          page.tsx         ← Visual timeline with branches
          [entryId]/page.tsx ← Ledger entry detail
        commits/page.tsx   ← Commit history with AI contribution summaries
```

### Prisma Schema Additions

```prisma
// Snapshot storage in Postgres (file contents can be large)
model LedgerSnapshot {
  id             String   @id @default(uuid())
  orgId          String   @map("org_id")
  repoId         String   @map("repo_id")
  userId         String   @map("user_id")
  branch         String
  timelineBranch Int      @default(0) @map("timeline_branch")
  ledgerEntryId  String   @map("ledger_entry_id")
  reason         String   // tests_passed | user_marked | commit | session_start
  files          Json     // Array of { filePath, content, entityHashes }
  createdAt      DateTime @default(now()) @map("created_at")

  @@index([orgId, repoId, userId, branch])
  @@map("ledger_snapshots")
}
```

> **Note:** Ledger entries and summaries live in ArangoDB (fast appends, AQL timeline queries). Snapshots live in Postgres/Prisma (large file content blobs, better for JSONB storage).

### Test

- `pnpm test` — Ledger entry creation is append-only; snapshot captures correct file content; rewind restores to exact snapshot state; timeline branch increments after rewind; roll-up correctly marks entries as committed and creates summary; anti-pattern rule synthesis produces valid Semgrep YAML
- `pnpm test` — `revert_to_working_state` MCP tool returns file contents, creates new branch, generates rule; `get_timeline` returns entries in chronological order with branch info
- `e2e` — Dashboard timeline shows prompt → change → working/broken flow; Rewind button restores files; post-rewind prompts appear on new branch lane; commit roll-up shows AI contribution summary
- `e2e` — CLI: `kap10 watch` detects file changes → streams to cloud → `kap10 timeline` shows entries → `kap10 rewind` restores files locally

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

## Phase 7 Enhancement: Ledger Trace Merging on PR Merge

> **Status:** Planned (post-Phase 7 core). Requires Phase 5.5 Prompt Ledger and Phase 7 PR Review.

### The Problem

When a feature branch is merged and deleted, the AI context for that branch — every prompt, tool call, decision, and working-state snapshot — becomes orphaned. Six months later, when someone asks "why was this implemented this way?", the institutional memory is gone. The ledger entries still exist in ArangoDB, but they reference a branch that no longer exists and are disconnected from the merge target's history.

### Solution: `mergeLedgerWorkflow`

A new Temporal workflow triggered automatically when a PR is merged. It reparents ledger entries from the source branch to the target branch and synthesizes a narrative summary of the AI session.

#### Workflow Activities

| # | Activity | Queue | What it does |
|---|----------|-------|--------------|
| 1 | `fetchLedgerEntries` | `light-llm-queue` | Query ArangoDB `ledger` collection for all entries where `branch == sourceBranch` and `repoId == repoId`. Returns ordered timeline. |
| 2 | `reparentLedgerEntries` | `light-llm-queue` | Bulk update: set `branch = targetBranch` and `mergedFrom = sourceBranch` on all fetched entries. Preserves original timestamps and ordering. |
| 3 | `createMergeNode` | `light-llm-queue` | Insert a special ledger entry with `type: "merge"` that links the two branch histories. Contains: `sourceBranch`, `targetBranch`, `prNumber`, `mergedAt`, `mergedBy`, `entryCount`. |
| 4 | `synthesizeLedgerSummary` | `light-llm-queue` | LLM generates a narrative summary of the AI session on this branch. Input: all ledger entries (prompts, tool calls, changes). Output: 2-3 paragraph narrative covering what was built, key decisions, and gotchas. Uses `generateObject()` with Zod schema. |
| 5 | `storeLedgerSummary` | `light-llm-queue` | Persist the narrative summary to `ledger_summaries` collection with `type: "merge_summary"`, linked to the merge node. |

#### Trigger

```typescript
// Webhook handler: pull_request event
if (action === "closed" && payload.pull_request.merged === true) {
  await workflowEngine.startWorkflow("mergeLedgerWorkflow", {
    repoId,
    sourceBranch: payload.pull_request.head.ref,
    targetBranch: payload.pull_request.base.ref,
    prNumber: payload.pull_request.number,
    mergedBy: payload.pull_request.merged_by.login,
  });
}
```

#### ArangoDB Additions

**Merge node in `ledger` collection:**
```json
{
  "_key": "merge_feat-auth_main_1708300000",
  "type": "merge",
  "repoId": "repo_123",
  "sourceBranch": "feat/auth",
  "targetBranch": "main",
  "prNumber": 42,
  "mergedBy": "alice",
  "mergedAt": "2026-02-18T12:00:00Z",
  "entryCount": 127,
  "org_id": "org_abc"
}
```

**Enhanced `ledger_summaries` collection:**
```json
{
  "_key": "summary_merge_feat-auth_main",
  "type": "merge_summary",
  "repoId": "repo_123",
  "sourceBranch": "feat/auth",
  "targetBranch": "main",
  "mergeNodeKey": "merge_feat-auth_main_1708300000",
  "narrative": "Over 3 days, the AI assistant helped implement JWT-based authentication...",
  "entryCount": 127,
  "promptCount": 43,
  "toolCallCount": 84,
  "generatedAt": "2026-02-18T12:00:05Z",
  "org_id": "org_abc"
}
```

### New Files

```
lib/temporal/workflows/
  merge-ledger.ts             # mergeLedgerWorkflow definition
lib/temporal/activities/
  ledger-merge.ts             # fetchLedgerEntries, reparentLedgerEntries, createMergeNode
  ledger-summary.ts           # storeLedgerSummary activity
lib/use-cases/
  summarizer.ts               # LLM-based ledger narrative synthesis (used by synthesizeLedgerSummary)
app/dashboard/repos/[repoId]/
  history/
    page.tsx                  # Branch merge history view with narrative summaries
```

### Why This Matters

**Code archaeology 6 months post-merge:** When a developer encounters a complex piece of code and asks "why was this done this way?", the merge summary provides immediate context. The narrative links back to specific prompts and decisions. Without this, the ledger entries exist but are disconnected fragments referencing a deleted branch — practically invisible.

**Compliance and audit:** For regulated industries, the merge summary provides a complete chain of custody: who prompted what, when, and what the AI produced. The merge node links pre-merge and post-merge history into a single queryable timeline.

### Integration Points

- **Phase 7 (PR Review):** `mergeLedgerWorkflow` is triggered *after* `reviewPrWorkflow` completes — specifically on the `pull_request.closed` webhook with `merged: true`. Both workflows operate on the same repo but are independent (no shared state).
- **Phase 5.5 (Prompt Ledger):** Consumes the `ledger` collection populated by Phase 5.5's append-only timeline. The `fetchLedgerEntries` activity uses the same query patterns as the existing `get_timeline` MCP tool.
- **Phase 2 Enhancement (Workspace UI):** The merge history page (`history/page.tsx`) links to workspace detail views for branches that were active before merging.

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

## Post-Launch Roadmap (Phases 10-12)

> **Status:** None of these phases block the Phase 8 launch gate. They represent the long-term product vision and can be prioritized independently after launch. Phase ∞ is a cross-cutting infrastructure improvement that benefits all phases.

---

### Phase 10 — Local-First Intelligence Proxy

**Feature:** _"90% of my queries resolve instantly from a local graph — no network round-trip. The cloud only handles LLM operations and semantic search. My IDE feels native-fast."_

> **Delivery:** Phase 10 ships in two increments. **10a (MVP)** can start immediately after Phase 2 — it routes only the 9 Phase 2 MCP tools. **10b (Full)** lands after Phase 6, adding rules and justification routing. This lets users benefit from local-speed graph queries months before launch.

#### Two-Increment Delivery

| Increment | Depends on | Local tools | Cloud tools | What it adds |
|-----------|-----------|-------------|-------------|--------------|
| **10a (MVP)** | Phase 2 | `get_function`, `get_callers`, `get_callees`, `get_imports`, `get_file_entities`, `search_code`, `get_class` | `sync_local_diff`, `get_project_stats` | CLI as MCP proxy, CozoDB embedded graph, `kap10 pull`, `syncLocalGraphWorkflow`, hybrid query router (structural tools only) |
| **10b (Full)** | Phase 6 | All 10a tools + `get_rules`, `check_rules` | All 10a cloud tools + `semantic_search`, `find_similar`, `justify_entity`, `generate_health_report` | Rules/patterns synced to local CozoDB, predictive context pre-fetching, full tool routing table |

**Why ship MVP early:** The 7 structural tools (`get_function`, `get_callers`, `get_callees`, `get_imports`, `get_file_entities`, `search_code`, `get_class`) account for ~70% of agent tool calls in typical coding sessions. Moving these to local CozoDB eliminates network round-trips for the majority of queries immediately after Phase 2, without waiting for rules (Phase 6) or justification (Phase 4).

#### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  IDE (VS Code / JetBrains / Cursor)                             │
│    └─► MCP Client                                               │
└────────┬────────────────────────────────────────────────────────┘
         │ stdio / SSE
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  kap10 CLI (Local MCP Proxy)                                    │
│  ┌──────────────────┐  ┌──────────────────────────────────┐     │
│  │ CozoDB Embedded  │  │ Hybrid Query Router              │     │
│  │ (local graph)    │  │                                  │     │
│  │                  │  │  10a (MVP — after Phase 2):      │     │
│  │ 70-90% of       │  │  ├─ get_function    → LOCAL      │     │
│  │ queries resolve  │  │  ├─ get_callers     → LOCAL      │     │
│  │ here             │  │  ├─ get_callees     → LOCAL      │     │
│  │                  │  │  ├─ get_imports     → LOCAL      │     │
│  │                  │  │  ├─ get_file_entities→ LOCAL     │     │
│  │                  │  │  ├─ search_code     → LOCAL      │     │
│  │                  │  │  ├─ get_class       → LOCAL      │     │
│  │                  │  │  ├─ sync_local_diff → CLOUD      │     │
│  │                  │  │  └─ get_project_stats→ CLOUD     │     │
│  │                  │  │                                  │     │
│  │                  │  │  10b (Full — after Phase 6):     │     │
│  │                  │  │  ├─ get_rules       → LOCAL      │     │
│  │                  │  │  ├─ check_rules     → LOCAL      │     │
│  │                  │  │  ├─ semantic_search → CLOUD      │     │
│  │                  │  │  ├─ find_similar    → CLOUD      │     │
│  │                  │  │  ├─ justify_entity  → CLOUD      │     │
│  │                  │  │  └─ generate_health_report→CLOUD │     │
│  │                  │  │                                  │     │
│  └──────────────────┘  └──────────────────────────────────┘     │
│           │                          │                           │
│           │ cache miss               │ LLM / semantic ops       │
│           ▼                          ▼                           │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Cloud Fallback (kap10 API)                 │    │
│  │  ArangoDB · pgvector · Vercel AI SDK · Langfuse         │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

#### What Ships

- **CLI as MCP server:** `kap10` CLI binary acts as a local MCP server (stdio transport). IDEs connect to the local CLI instead of the cloud endpoint. *(10a)*
- **Embedded CozoDB graph:** A local, embedded graph database that stores a compacted copy of the repo's knowledge graph. Handles structural queries (functions, callers, callees, imports) with zero network latency. *(10a)*
- **Cloud → local sync:** Nightly Temporal workflow (`syncLocalGraphWorkflow`) pushes a compacted graph snapshot from ArangoDB to the local CozoDB instance via the CLI's `kap10 pull` command. *(10a)*
- **Hybrid query routing:** Each MCP tool is annotated as `local` or `cloud`. The router dispatches accordingly. 10a routes 7 structural tools locally; 10b adds rules + patterns. *(10a scaffold, 10b completes)*
- **Rules & patterns in local graph:** `syncLocalGraphWorkflow` extended to include `rules` and `patterns` ArangoDB collections in the CozoDB snapshot. *(10b)*
- **Predictive context pre-fetching:** LSP cursor tracking sends the user's active file/symbol to the cloud. The cloud pre-fetches likely queries and pushes results to Redis pre-cache. *(10b)*

#### CozoDB vs Alternatives

| Criteria | CozoDB | DuckDB | Local ArangoDB |
|----------|--------|--------|----------------|
| **Embedded (no server)** | Yes (single file) | Yes | No (requires server process) |
| **Graph queries (N-hop traversal)** | Native Datalog | Requires recursive CTEs | Native AQL |
| **Binary size** | ~8 MB | ~30 MB | ~200 MB |
| **Memory footprint** | ~20 MB idle | ~50 MB idle | ~200 MB idle |
| **Schema flexibility** | Schemaless relations | Strict SQL schema | Schemaless JSON |
| **Rust interop** | Native Rust | C FFI | HTTP only |
| **Node.js binding** | `cozo-node` (NAPI) | `duckdb-async` | `arangojs` (HTTP) |

CozoDB wins because: (1) native graph traversal in Datalog — no recursive CTEs; (2) smallest footprint for an embedded graph store; (3) Rust-native with first-class Node.js bindings via NAPI.

#### `syncLocalGraphWorkflow`

```
Nightly Temporal workflow (light-llm-queue):
  1. queryCompactGraph     — Export entities + edges for repo (exclude raw content, keep signatures + relationships)
  2. serializeToMsgpack    — Compact binary format (~10x smaller than JSON)
  3. uploadToStorage       — Push to Supabase Storage (pre-signed URL, 24h expiry)
  4. notifyClient          — Post event to Redis pub/sub channel for connected CLIs
```

#### `kap10 pull` CLI Command

```bash
kap10 pull                    # Pull latest graph snapshot for all configured repos
kap10 pull --repo org/repo    # Pull specific repo
kap10 pull --force            # Force full re-sync (ignore local version)
```

Downloads the msgpack snapshot from Supabase Storage, deserializes, and loads into local CozoDB.

#### Predictive Context Pre-Fetching

```
IDE (LSP)                     kap10 CLI                    Cloud
   │                              │                          │
   │ textDocument/didOpen         │                          │
   │ cursor: auth.ts:42           │                          │
   │──────────────────────────────►                          │
   │                              │  POST /api/prefetch      │
   │                              │  { file: "auth.ts",      │
   │                              │    symbol: "validateJWT", │
   │                              │    repoId: "..." }       │
   │                              │─────────────────────────►│
   │                              │                          │
   │                              │     Pre-fetch callers,   │
   │                              │     callees, related     │
   │                              │     entities → Redis     │
   │                              │◄─────────────────────────│
   │                              │                          │
   │ (later) get_callers          │                          │
   │──────────────────────────────►                          │
   │                              │ CozoDB hit (local) ✓     │
   │◄──────────────────────────────                          │
   │  < 5ms response                                        │
```

#### New Files

```
packages/cli/src/
  mcp-proxy.ts                # Local MCP server (stdio transport, hybrid router)
  local-graph.ts              # CozoDB embedded graph client (NAPI binding)
  sync.ts                     # kap10 pull implementation (download + deserialize + load)
  prefetch.ts                 # LSP cursor tracking → cloud prefetch requests
  query-router.ts             # Routes MCP tool calls to local CozoDB or cloud API
  cozo-schema.ts              # CozoDB relation definitions (mirrors ArangoDB collections)
lib/temporal/workflows/
  sync-local-graph.ts         # syncLocalGraphWorkflow (nightly compaction + upload)
lib/temporal/activities/
  graph-export.ts             # queryCompactGraph, serializeToMsgpack
  graph-upload.ts             # uploadToStorage, notifyClient
app/api/prefetch/route.ts     # Prefetch endpoint (receives cursor context, pre-warms Redis)
lib/use-cases/
  prefetch-context.ts         # Predictive pre-fetching logic (N-hop expansion from cursor)
  graph-compactor.ts          # Compact graph for local sync (strip content, keep structure)
```

#### Tech Stack Additions

| Package | Purpose |
|---------|---------|
| `cozo-node` | CozoDB embedded graph database (NAPI binding for Node.js) |
| `@vscode/languageserver-protocol` | LSP types for cursor tracking events |
| `msgpackr` | Fast MessagePack serialization for compact graph snapshots |

---

### Phase 11 — Native IDE Integrations

**Feature:** _"I can see my codebase's architecture, impact graphs, and AI session timelines directly in my IDE — not just in a browser dashboard."_

#### Architecture

```
┌───────────────────────────────────────────────────────────────┐
│  VS Code Extension                                            │
│  ┌─────────────────────────────────────────────────┐          │
│  │ WebView Panel (React)                           │          │
│  │  ├─ @kap10/ui components (Blueprint, Impact,    │          │
│  │  │   Timeline, Diff)                            │          │
│  │  └─ @vscode/webview-ui-toolkit for native look  │          │
│  └─────────────────────────────────────────────────┘          │
│           │ postMessage API                                   │
│           ▼                                                   │
│  ┌─────────────────────────────────────────────────┐          │
│  │ Extension Host                                  │          │
│  │  ├─ kap10 API client (auth, data fetching)      │          │
│  │  ├─ MCP tool invocation (show_blueprint, etc.)  │          │
│  │  └─ Collision warning decoration provider       │          │
│  └─────────────────────────────────────────────────┘          │
└───────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────┐
│  JetBrains Plugin (Kotlin)                                    │
│  ┌─────────────────────────────────────────────────┐          │
│  │ JCEF Browser Panel                              │          │
│  │  ├─ Same @kap10/ui React components             │          │
│  │  └─ Rendered via Chromium Embedded Framework     │          │
│  └─────────────────────────────────────────────────┘          │
│           │ CefMessageRouter (JS ↔ Kotlin bridge)             │
│           ▼                                                   │
│  ┌─────────────────────────────────────────────────┐          │
│  │ Plugin Services (Kotlin)                        │          │
│  │  ├─ kap10 API client                            │          │
│  │  ├─ Tool window registration                    │          │
│  │  └─ Editor gutter collision markers             │          │
│  └─────────────────────────────────────────────────┘          │
└───────────────────────────────────────────────────────────────┘
```

#### What Ships

- **VS Code extension:** Native extension with WebView panels rendering React components. Blueprint Dashboard, Impact Graph, AI Timeline, and Live Diff — all inside VS Code.
- **JetBrains plugin:** Kotlin plugin using JCEF (Chromium Embedded Framework) to render the same React components. Tool windows for IntelliJ IDEA, WebStorm, PyCharm, GoLand.
- **`@kap10/ui` shared component package:** Dashboard visualization components extracted into a standalone React package with no Next.js dependencies. Consumed by the web dashboard, VS Code extension, and JetBrains plugin.
- **New MCP tools for IDE rendering:**
  - `show_blueprint` — Returns Blueprint Dashboard data for the current repo/feature
  - `show_impact_graph` — Returns N-hop dependency graph for a given entity
  - `show_timeline` — Returns Prompt Ledger timeline for a workspace
  - `show_diff` — Returns workspace overlay diff

#### VS Code Extension Architecture

```typescript
// packages/vscode-extension/src/extension.ts
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  // Register WebView panel provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'kap10.blueprintView',
      new BlueprintViewProvider(context.extensionUri)
    )
  );

  // Register MCP tool-triggered commands
  context.subscriptions.push(
    vscode.commands.registerCommand('kap10.showBlueprint', (data) => {
      BlueprintPanel.createOrShow(context.extensionUri, data);
    })
  );
}
```

#### JetBrains JCEF Integration

```kotlin
// packages/jetbrains-plugin/src/main/kotlin/com/kap10/plugin/BlueprintToolWindow.kt
class BlueprintToolWindow : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val browser = JBCefBrowser()
        browser.loadHTML(getReactAppHtml()) // @kap10/ui bundle

        // Bridge: Kotlin → JS
        val query = CefMessageRouter.create()
        query.addHandler(Kap10DataHandler(project), true)
        browser.jbCefClient.addMessageRouter(query)

        toolWindow.component.add(browser.component)
    }
}
```

#### `@kap10/ui` Package

Extract existing dashboard visualization components into a standalone package:

```
packages/ui/
  src/
    BlueprintDashboard.tsx    # Swimlane visualization (React Flow)
    ImpactGraph.tsx           # Force-directed dependency graph (Cytoscape)
    LedgerTimeline.tsx        # Prompt Ledger timeline view
    DiffViewer.tsx            # Workspace overlay diff
    index.ts                  # Public API
  package.json                # No Next.js deps, peer deps on React 19
  vite.config.ts              # Build as ES module library
```

#### New Files

```
packages/vscode-extension/
  src/
    extension.ts              # VS Code extension entry point
    blueprint-panel.ts        # Blueprint Dashboard WebView panel
    impact-panel.ts           # Impact Graph WebView panel
    timeline-panel.ts         # AI Timeline WebView panel
    diff-panel.ts             # Live Diff WebView panel
    api-client.ts             # kap10 API client for extension host
    collision-decorator.ts    # Editor decoration for collision warnings
  package.json                # VS Code extension manifest
packages/jetbrains-plugin/
  src/main/kotlin/com/kap10/plugin/
    BlueprintToolWindow.kt    # JCEF Blueprint Dashboard panel
    ImpactToolWindow.kt       # JCEF Impact Graph panel
    TimelineToolWindow.kt     # JCEF AI Timeline panel
    CollisionAnnotator.kt     # Editor gutter collision markers
    Kap10DataHandler.kt       # CefMessageRouter data handler
  build.gradle.kts            # IntelliJ Platform plugin config
packages/ui/
  src/
    BlueprintDashboard.tsx    # Extracted Blueprint component
    ImpactGraph.tsx           # Extracted Impact Graph component
    LedgerTimeline.tsx        # Extracted Timeline component
    DiffViewer.tsx            # Extracted Diff component
    index.ts                  # Package exports
  vite.config.ts              # Library build config
  package.json                # Standalone React package
lib/mcp/tools/
  show-blueprint.ts           # MCP tool: show_blueprint
  show-impact-graph.ts        # MCP tool: show_impact_graph
  show-timeline.ts            # MCP tool: show_timeline
  show-diff.ts                # MCP tool: show_diff
```

#### Tech Stack Additions

| Package | Purpose |
|---------|---------|
| `@vscode/webview-ui-toolkit` | VS Code-native UI components for WebView panels |
| `vite` | Build `@kap10/ui` as ES module library (no Next.js bundler dependency) |

---

### Phase 12 — Multiplayer Collaboration & Collision Detection

**Feature:** _"When two agents (or developers) are editing the same function, I get a real-time warning before conflicts happen — not after a merge conflict."_

#### Architecture

```
┌───────────────────────────────────────────────────────────────┐
│  Agent A (Alice's Cursor)      Agent B (Bob's VS Code)        │
│  MCP session: sess_A           MCP session: sess_B            │
│       │                              │                        │
│       │ edit_function("validateJWT") │                        │
│       │──────────────────────────────┼───────────────────────►│
│       │                              │                        │
│       │                              │  get_function("auth")  │
│       │◄─────────────────────────────┼────────────────────────│
│       │                              │                        │
└───────┼──────────────────────────────┼────────────────────────┘
        │                              │
        ▼                              ▼
┌───────────────────────────────────────────────────────────────┐
│  kap10 Cloud                                                  │
│  ┌──────────────────────────────────────────────┐             │
│  │ Entity Activity Tracker                      │             │
│  │  ├─ entity_activity collection (ArangoDB)    │             │
│  │  │   TTL: 30 min                             │             │
│  │  ├─ On tool call: record entity + session    │             │
│  │  └─ On tool response: check for collisions   │             │
│  └──────────────────────────────────────────────┘             │
│           │ collision detected                                │
│           ▼                                                   │
│  ┌──────────────────────────────────────────────┐             │
│  │ Real-Time Broadcast                          │             │
│  │  ├─ WebSocket server (ws)                    │             │
│  │  ├─ OR LiveKit Data Channels                 │             │
│  │  └─ Push collision warnings to both sessions │             │
│  └──────────────────────────────────────────────┘             │
└───────────────────────────────────────────────────────────────┘
```

#### What Ships

- **Real-time sync layer:** WebSocket or LiveKit-based broadcast of workspace activity across connected sessions.
- **Entity-level collision detection:** When two sessions touch the same entity (function, class, file) within a TTL window, both receive collision warnings.
- **IDE notifications:** VS Code and JetBrains extensions show collision warnings as editor decorations and notifications.
- **Dashboard presence indicators:** ActiveSessions panel on repo cards showing who's working on what.

#### LiveKit vs Raw WebSockets

| Criteria | LiveKit Data Channels | Raw WebSockets (`ws`) |
|----------|----------------------|----------------------|
| **Setup complexity** | Moderate (LiveKit server + client SDK) | Low (single `ws` server) |
| **Scaling** | Built-in room-based routing, horizontal scaling | Manual pub/sub (Redis) for multi-instance |
| **Auth** | JWT-based room tokens | Custom auth middleware |
| **Reconnection** | Automatic with state recovery | Manual implementation |
| **Future use** | Voice/video pair programming (Phase 13+) | WebSocket only |
| **Cost** | LiveKit Cloud or self-hosted | Free (self-hosted only) |

**Recommendation:** Start with raw WebSockets (`ws`) for simplicity. Migrate to LiveKit when voice/video collaboration is on the roadmap.

#### `entity_activity` ArangoDB Collection

```json
{
  "_key": "activity_sess_A_fn_validateJWT",
  "sessionId": "sess_A",
  "userId": "user_alice",
  "entityKey": "fn_validateJWT",
  "entityType": "function",
  "entityName": "validateJWT",
  "filePath": "lib/auth/jwt.ts",
  "action": "edit",
  "repoId": "repo_123",
  "branch": "feat/auth",
  "timestamp": "2026-02-18T12:05:00Z",
  "org_id": "org_abc",
  "ttl": 1800
}
```

TTL index on `timestamp` ensures automatic cleanup after 30 minutes of inactivity.

#### Collision Metadata in MCP Tool Responses

When the collision detector finds overlapping activity, the MCP tool response includes collision metadata in the `_meta` field:

```json
{
  "content": [{ "type": "text", "text": "function validateJWT(...) { ... }" }],
  "_meta": {
    "collision": {
      "detected": true,
      "entities": [
        {
          "entityKey": "fn_validateJWT",
          "entityName": "validateJWT",
          "otherSessions": [
            {
              "userId": "user_bob",
              "userName": "Bob",
              "branch": "fix/jwt-expiry",
              "lastAction": "edit",
              "lastActiveAt": "2026-02-18T12:03:00Z"
            }
          ]
        }
      ],
      "warning": "⚠️ Bob is also editing validateJWT on branch fix/jwt-expiry (last active 2 min ago). Coordinate to avoid conflicts."
    }
  }
}
```

#### IDE Extension Collision Warnings

**VS Code:**
```typescript
// Editor decoration on collision-affected lines
const collisionDecorationType = vscode.window.createTextEditorDecorationType({
  gutterIconPath: collisionIconPath,
  gutterIconSize: '80%',
  overviewRulerColor: '#E34234',
  after: {
    contentText: ' ⚠️ Bob is editing this function',
    color: '#E34234',
    fontStyle: 'italic',
  },
});
```

**JetBrains:**
```kotlin
// Gutter icon + tooltip on collision-affected lines
class CollisionAnnotator : ExternalAnnotator<CollisionData, CollisionResult>() {
    override fun doAnnotate(data: CollisionData): CollisionResult {
        return checkCollisions(data.entityKeys)
    }
    override fun apply(file: PsiFile, result: CollisionResult, holder: AnnotationHolder) {
        result.collisions.forEach { collision ->
            holder.newAnnotation(HighlightSeverity.WARNING, collision.warning)
                .gutterIconRenderer(CollisionGutterIcon(collision))
                .create()
        }
    }
}
```

#### Dashboard Presence Component

```
┌─────────────────────────────────────────────────────────────┐
│  Active Sessions — my-org/backend-api                       │
│                                                             │
│  ┌─────────┐  ┌─────────┐                                  │
│  │ 🟢 Alice │  │ 🟢 Bob  │                                  │
│  │ main     │  │ fix/jwt │                                  │
│  │ Cursor   │  │ VS Code │                                  │
│  │ 3m ago   │  │ 1m ago  │                                  │
│  └─────────┘  └─────────┘                                  │
│                                                             │
│  ⚠️ Collision: Alice & Bob both touching validateJWT        │
└─────────────────────────────────────────────────────────────┘
```

#### New Files

```
lib/use-cases/
  collision-detector.ts       # Entity-level collision detection logic
  activity-recorder.ts        # Record entity access in entity_activity collection
lib/adapters/
  websocket-server.ts         # WebSocket broadcast server for real-time collision warnings
lib/mcp/middleware/
  collision-middleware.ts      # MCP middleware: check collisions before tool response
app/api/ws/route.ts           # WebSocket upgrade endpoint
components/dashboard/
  active-sessions.tsx          # Dashboard presence panel component
  collision-badge.tsx          # Collision warning badge for repo cards
packages/vscode-extension/src/
  collision-decorator.ts       # (also listed in Phase 11 — extended with real-time updates)
packages/jetbrains-plugin/src/main/kotlin/com/kap10/plugin/
  CollisionAnnotator.kt       # (also listed in Phase 11 — extended with real-time updates)
```

#### Tech Stack Additions

| Package | Purpose |
|---------|---------|
| `livekit-server-sdk` | LiveKit server SDK for real-time data channels (future migration target) |
| `ws` | WebSocket server for real-time collision broadcast (initial implementation) |

---

### Phase ∞ — Heavy Worker Performance Rewrite (Cross-Cutting)

> **Cross-cutting infrastructure improvement.** Not a feature phase — this rewrites performance-critical Temporal activities from TypeScript to Rust. Can be done incrementally alongside any phase after launch.

#### Current Bottleneck Analysis

The `heavy-compute-queue` Temporal worker runs CPU-bound operations in Node.js:

| Operation | Current impl | Problem |
|-----------|-------------|---------|
| `prepareWorkspace` | `simple-git` (Node.js) → `npm install` → `scip-typescript` | Node.js GC pauses during large clones; `simple-git` spawns `git` subprocesses; peak memory ~2 GB for large monorepos |
| Bulk entity insert | `arangojs` HTTP client, sequential batches | Node.js event loop blocked during JSON serialization of 50,000+ entities; GC pressure from large object graphs |
| SCIP index parsing | `protobufjs` in Node.js | 100 MB SCIP index files cause V8 heap exhaustion (OOM) on repos with 10,000+ files |

**Symptoms:** Worker OOM kills on repos > 5,000 files; 45-second GC pauses during bulk insert; Temporal activity timeouts on monorepos.

#### Rust vs Go

| Criteria | Rust | Go |
|----------|------|-----|
| **Memory safety** | Compile-time (no GC) | GC (but better than Node.js) |
| **Git library** | `libgit2` via `git2` crate (zero-copy) | `go-git` (pure Go, copies) |
| **Protobuf (SCIP)** | `prost` (zero-copy decode) | `protobuf` (standard) |
| **HTTP/2 client** | `reqwest` + `hyper` (async) | `net/http` (built-in) |
| **Binary size** | ~5 MB (static) | ~8 MB (static) |
| **Peak memory (10K files)** | ~200 MB | ~800 MB |
| **Deployment** | Single static binary | Single static binary |

**Decision:** Rust. The zero-copy protobuf decoding and libgit2 integration eliminate the two biggest bottlenecks (SCIP parsing OOM and Git subprocess spawns).

#### What Gets Rewritten

| Component | Current (TypeScript) | Rewritten (Rust) | Speedup |
|-----------|---------------------|-------------------|---------|
| `prepareWorkspace` | `simple-git` → subprocess → `npm install` | `libgit2` (in-process) → direct clone | ~3.75x (no subprocess spawn, zero-copy) |
| Bulk entity insert | `arangojs` sequential HTTP/1.1 batches | `reqwest` HTTP/2 multiplexed, parallel streams | ~5x (no GC, HTTP/2 mux) |
| SCIP index parsing | `protobufjs` (V8 heap) | `prost` (zero-copy mmap) | ~8x (no GC, mmap) |

#### What Stays in TypeScript

| Component | Why it stays |
|-----------|-------------|
| Temporal workflow definitions | Deterministic replay requires JS SDK; workflows are lightweight orchestration |
| LLM calls (Vercel AI SDK) | Network-bound, not CPU-bound; AI SDK has best-in-class streaming |
| Dashboard (Next.js) | Frontend framework; no performance concern |
| MCP server | Network-bound; Node.js is fine for request/response |
| Light worker activities | LLM, email, webhooks — all network-bound |

#### TypeScript Wrapper Pattern

The Rust binaries are invoked from Temporal activities via `execFileAsync`:

```typescript
// lib/temporal/activities/prepare-workspace.ts
import { execFileAsync } from 'node:child_process';

export async function prepareWorkspace(input: PrepareWorkspaceInput): Promise<PrepareWorkspaceOutput> {
  const { stdout } = await execFileAsync(
    '/usr/local/bin/kap10-prepare-workspace',
    [
      '--repo-url', input.repoUrl,
      '--branch', input.branch,
      '--workspace-dir', input.workspaceDir,
      '--output-format', 'json',
    ],
    { timeout: 300_000 } // 5 minutes
  );
  return JSON.parse(stdout) as PrepareWorkspaceOutput;
}
```

This pattern means:
- Zero changes to Temporal workflow definitions
- Rust binary handles all CPU/memory-intensive work
- TypeScript wrapper handles Temporal SDK integration, error mapping, and logging
- Gradual migration: swap one activity at a time, deploy, measure

#### Performance Estimates

| Metric | Current (Node.js) | After (Rust) | Improvement |
|--------|-------------------|--------------|-------------|
| Clone + install (10K files) | ~120s | ~32s | 3.75x |
| SCIP parse (100 MB index) | OOM crash | ~12s, 200 MB peak | ∞ → works |
| Bulk insert (50K entities) | ~45s (with GC pauses) | ~9s | 5x |
| Peak memory (large monorepo) | ~2 GB (OOM risk) | ~200 MB | 10x reduction |
| Worker instance cost | r6g.xlarge ($0.201/hr) | r6g.medium ($0.050/hr) | 4x cost reduction (~80%) |

#### New Files

```
workers/heavy-compute-rust/
  src/
    main.rs                   # CLI entry point (kap10-prepare-workspace, kap10-bulk-insert)
    git.rs                    # libgit2 clone/pull with auth
    scip.rs                   # Zero-copy SCIP index parser (prost + mmap)
    arango.rs                 # HTTP/2 bulk insert client (reqwest)
    workspace.rs              # Workspace preparation orchestration
  Cargo.toml                  # Rust dependencies
  Dockerfile                  # Multi-stage build (rust:alpine → scratch)
```

#### Rust Crate Dependencies

| Crate | Purpose |
|-------|---------|
| `git2` | libgit2 bindings — in-process Git operations (clone, pull, diff) |
| `tokio` | Async runtime for parallel I/O (HTTP/2 bulk insert, concurrent file ops) |
| `serde` + `serde_json` | JSON serialization for ArangoDB documents and CLI output |
| `reqwest` | HTTP/2 client for ArangoDB bulk import API |
| `prost` | Zero-copy protobuf decoding for SCIP index files |
| `memmap2` | Memory-mapped file I/O for large SCIP indexes (no heap allocation) |

---

## Phase Summary & Dependencies

```
Phase 0: Foundation Wiring
(Prisma + ArangoDB + Temporal + Redis + Langfuse + Ports/Adapters + DI Container)
    │
    ▼
Phase 1: GitHub Connect & Repo Indexing
(SCIP + prepareWorkspace + entity hashing + monorepo support)
    │
    ├──────────────────┐
    ▼                  ▼
Phase 2: MCP Server    Phase 3: Semantic Search (LlamaIndex.TS)
(+ Shadow Workspace    │
 + Auto-PR             │
 + Secret Scrubbing    │
 + Rate Limiter        │
 + Truncation)         │
 + ENHANCEMENT:        │
   Hybrid Repo/        │
   Workspace UI        │
    │                  │
    ├─── Phase 10a ────┘─────────────────────────────────────┐
    │    (MVP: Local-First Proxy — 7 structural tools        │
    │     CozoDB, kap10 pull, syncLocalGraph, query router)  │
    │                                                        │
    └────────┬───────────────────────────────────────────     │
             ▼                                               │
Phase 4: Business Justification + Taxonomy (Vercel AI SDK)   │
(+ VERTICAL/HORIZONTAL/UTILITY classification                │
 + Features collection + Blueprint Dashboard                 │
 + Architecture Health Report)                               │
    │                                                        │
    ▼                                                        │
Phase 5: Incremental Indexing (entity hash diff + cascade)   │
    │                                                        │
    ▼                                                        │
Phase 5.5: Prompt Ledger + Rewind + Branching                │
(+ append-only timeline + working-state snapshots            │
 + anti-pattern rule synthesis + kap10 CLI                   │
 + commit roll-up                                            │
 + CLI-first local ingestion via IStorageProvider)           │
    │                                                        │
    ▼                                                        │
Phase 5.6: CLI-First Zero-Friction Onboarding                │
(+ RFC 8628 device auth + org-level API keys                 │
 + kap10 connect command + auto IDE config                   │
 + default key auto-provisioning)                            │
    │                                                        │
    ├──────────────────┐                                     │
    ▼                  ▼                                     │
Phase 6: Patterns +    Phase 7: PR Review                    │
Rules Engine           (Semgrep CLI on diff)                 │
(ast-grep + Semgrep    + ENHANCEMENT:                        │
 + hierarchical rules)   Ledger Merging                      │
    │                    on PR Merge                         │
    │                  │                                     │
    ├─── Phase 10b ────┘─────────────────────────────────────┘
    │    (Full: + get_rules, check_rules → LOCAL
    │     + rules/patterns in CozoDB sync
    │     + predictive context pre-fetching)
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
             │
             ├─────────────────────────────────────────┐
             ▼                                         ▼
Phase 11: Native IDE Integrations        Phase 12: Multiplayer
(VS Code, JetBrains, @kap10/ui,         Collaboration &
 4 new MCP tools — leverages             Collision Detection
 Phase 10 local proxy as transport)      (entity_activity,
                                          real-time broadcast)

      ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·
      Phase ∞: Heavy Worker Performance Rewrite (cross-cutting)
      (Rust binaries: libgit2 + prost + reqwest — replaces
       Node.js CPU-bound Temporal activities incrementally)
```

**Cross-Cutting (all phases):** Structured output mandate (§6), 24-hour deletion SLA (§7), pool-based multi-tenancy

### Estimated scope per phase

| Phase | New files | Modified files | New DB tables/collections | New MCP tools | Temporal workflows |
|-------|-----------|---------------|--------------------------|---------------|-------------------|
| 0 | ~30 | ~4 | ArangoDB schema (single DB, pool tenancy) + Prisma init + DeletionLog | 0 | 0 |
| 1 | ~18 | ~3 | 1 Prisma + 11 ArangoDB + monorepo detection | 0 | 1 (`indexRepo`) |
| 2 | ~16 | ~2 | 1 Prisma (Workspace) | 9 | 0 |
| 2 *(enhancement)* | ~6 | ~2 | 1 Prisma (`Error.workspaceId`) | 0 | 0 |
| 3 | ~8 | ~3 | 1 Prisma | 2 | 1 (`embedRepo`) |
| 4 | ~16 | ~3 | 4 ArangoDB + 2 edge | 4 | 3 (`justifyRepo`, `justifyEntity`, `healthReport`) |
| 5 | ~8 | ~4 | 0 | 1 | 1 (`incrementalIndex`) |
| 5.5 | ~26 | ~6 | 3 ArangoDB (`ledger`, `snapshots`, `ledger_summaries`) + 1 Prisma (`LedgerSnapshot`) + 1 Supabase Storage bucket (`cli_uploads`) | 3 (`revert_to_working_state`, `get_timeline`, `mark_working`) | 0 |
| 6 | ~18 | ~4 | 2 ArangoDB (`patterns` + `rules`) | 5 (+`get_rules`, `check_rules`) | 1 (`detectPatterns`) |
| 7 | ~12 | ~3 | 2 Prisma | 0 | 1 (`reviewPr`) |
| 7 *(enhancement)* | ~6 | ~1 | 1 ArangoDB (merge node type in `ledger`) | 0 | 1 (`mergeLedger`) |
| 8 | ~12 | ~6 | 3 Prisma | 0 | 1 (`syncBilling`) |
| | | | **═══ LAUNCH ═══** | | |
| 9 *(post-launch)* | ~14 | ~4 | 1 ArangoDB (`snippets`) + pgvector embeddings | 3 (`get_snippets`, `search_snippets`, `pin_snippet`) | 1 (`extractSnippets`) |
| 10a *(after Phase 2)* | ~8 | ~2 | CozoDB embedded (local) | 0 | 1 (`syncLocalGraph`) |
| 10b *(after Phase 6)* | ~4 | ~3 | CozoDB rules/patterns sync | 0 | 0 (extends `syncLocalGraph`) |
| 11 *(post-launch)* | ~18 (3 packages) | ~3 | 0 | 4 (`show_blueprint`, `show_impact_graph`, `show_timeline`, `show_diff`) | 0 |
| 12 *(post-launch)* | ~10 | ~2 | 2 ArangoDB (`entity_activity` + enhanced `ledger`) | 0 | 0 |
| ∞ *(infra)* | ~6 Rust + ~2 TS wrappers | ~2 | 0 | 0 | 0 |
| — *(cross-cutting)* | ~6 | ~2 | — | — | 2 (`deleteRepo`, `deletionAudit`) |

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
| `scip` (CLI) | SCIP index merging for monorepos (`scip combine`) | 1 |
| `web-tree-sitter` | Supplementary parsing for non-SCIP languages | 1 |
| `@ast-grep/napi` | Structural code search (pattern detection) | 6 |
| `semgrep` (CLI) | Rule-based static analysis (pattern enforcement + PR review) | 6, 7 |

### AI, Search & Observability

| Package | Purpose | Phase |
|---------|---------|-------|
| `ai` + `@ai-sdk/openai` + `@ai-sdk/anthropic` | Unified LLM routing (Vercel AI SDK) — all calls via `generateObject()` + Zod | 4 |
| `llamaindex` | Embedding pipeline + pgvector retrieval + RAG | 3 |
| `@xenova/transformers` | Local embedding models (nomic-embed-text) — $0 cost, no API rate limits, runs on CPU in Temporal workers | 3 |
| `@langfuse/tracing` + `@langfuse/otel` + `@langfuse/client` | LLM observability, cost tracking, billing metering (via OpenTelemetry) | 0 (init), 4+ (all LLM calls) |
| `@opentelemetry/sdk-node` + `@opentelemetry/sdk-trace-node` | OpenTelemetry SDK — bridges Vercel AI SDK telemetry to Langfuse | 0 |

### Git, GitHub & Infra

| Package | Purpose | Phase |
|---------|---------|-------|
| `simple-git` | Promise-based Git operations in Temporal workers (clone, pull, diff) — no shell commands | 1, 5 |
| `parse-diff` | Structured parsing of raw `git diff` output into typed JSON (files, chunks, additions, deletions) | 5, 5.5 |
| `@octokit/rest` + `@octokit/webhooks` | GitHub API + webhook handling (with `x-hub-signature-256` validation) + Auto-PR | 1, 2 |
| `@modelcontextprotocol/sdk` | MCP server implementation | 2 |
| `@upstash/ratelimit` | Battle-tested Redis sliding window rate limiter (works with standard `ioredis`) | 2 |

### CLI & Local Sync

| Package | Purpose | Phase |
|---------|---------|-------|
| `commander` | CLI framework for `@autorail/kap10` | 5.5 |
| `chokidar` | File watcher for CLI watch mode (ledger streaming) | 5.5 |
| `archiver` | ZIP creation for `kap10 push` (`.gitignore`-aware codebase packaging) | 5.5 |
| `ignore` | `.gitignore`-aware file filtering for `kap10 push` (excludes `node_modules`, build artifacts, etc.) | 5.5 |
| `@supabase/storage-js` | Supabase Storage client for `SupabaseStorageAdapter` (pre-signed URLs, file download/delete) | 5.5 |

### Visualization

| Package | Purpose | Phase |
|---------|---------|-------|
| `@xyflow/react` (React Flow) | Blueprint Dashboard — structured business swimlane visualization | 4 |
| `cytoscape` + `react-cytoscapejs` | Force-directed dependency graph visualization for impact analysis (N-hop callers/callees, 500+ node organic graphs) | 4, 7 |

> **React Flow vs Cytoscape:** React Flow excels at structured, swimlane-style layouts (Blueprint Dashboard). But when a user clicks "Analyze Impact" and gets a 500-node organic dependency graph, React Flow is too rigid and slow. Cytoscape.js specializes in force-directed layouts with built-in graph theory algorithms (shortest path, betweenness centrality, community detection) that run directly in the browser.

### Snippet Library (Post-Launch)

| Package | Purpose | Phase |
|---------|---------|-------|
| `llamaindex` (reuse from Phase 3) | Snippet embedding + semantic search via pgvector | 9 |

### Local-First & Collaboration (Post-Launch)

| Package | Purpose | Phase |
|---------|---------|-------|
| `cozo-node` | CozoDB embedded graph database (NAPI binding) — local-first structural queries | 10 |
| `@vscode/languageserver-protocol` | LSP types for cursor tracking events (predictive pre-fetching) | 10 |
| `msgpackr` | Fast MessagePack serialization for compact graph snapshots (cloud → local sync) | 10 |
| `@vscode/webview-ui-toolkit` | VS Code-native UI components for WebView panels | 11 |
| `vite` | Build `@kap10/ui` as standalone ES module library (no Next.js bundler dependency) | 11 |
| `livekit-server-sdk` | LiveKit server SDK for real-time data channels (future migration target for multiplayer) | 12 |
| `ws` | WebSocket server for real-time collision broadcast (initial multiplayer implementation) | 12 |

### Performance (Infrastructure Rewrite)

| Crate (Rust) | Purpose | Phase |
|--------------|---------|-------|
| `git2` | libgit2 bindings — in-process Git operations replacing `simple-git` subprocess spawns | ∞ |
| `tokio` | Async runtime for parallel I/O (HTTP/2 bulk insert, concurrent file ops) | ∞ |
| `serde` + `serde_json` | JSON serialization for ArangoDB documents and CLI output | ∞ |
| `reqwest` | HTTP/2 client for ArangoDB bulk import API (replaces `arangojs` sequential batches) | ∞ |
| `prost` | Zero-copy protobuf decoding for SCIP index files (eliminates V8 OOM) | ∞ |
| `memmap2` | Memory-mapped file I/O for large SCIP indexes (no heap allocation) | ∞ |

---

## Testing Strategy

Each phase has three test levels:

| Level | Tool | What it covers |
|-------|------|---------------|
| **Unit** | Vitest + `createTestContainer()` | Individual functions with in-memory fakes: parsers, formatters, query builders, AI SDK mock calls, secret scrubber, entity hasher, rule resolution, snippet resolution |
| **Integration** | Vitest + testcontainers | Full pipelines: SCIP → ArangoDB → query → result; Temporal workflow replay tests; MCP tool chain with truncation |
| **E2E** | Playwright | User flows: dashboard interactions, connection flows, Blueprint Dashboard |

### Port/Adapter testing

The hexagonal architecture (Cross-Cutting Concern §5) makes unit testing trivial — use `createTestContainer()` with in-memory fakes instead of mocking frameworks:

```typescript
// Unit test — no external dependencies, no Docker, no mocking library
import { createTestContainer } from '@/lib/di/container';
import { IndexRepoUseCase } from '@/lib/use-cases/index-repo';

const container = createTestContainer({
  // Override specific adapters if needed
  codeIntelligence: new FakeCodeIntelligence({ entities: mockEntities }),
});

const useCase = new IndexRepoUseCase(container);
const result = await useCase.execute({ orgId: 'test', repoUrl: 'https://...' });

expect(result.entityCount).toBe(mockEntities.length);
// In-memory graph store can be inspected directly
expect(container.graphStore.getEntity('test', 'fn_main')).toBeDefined();
```

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
| Raw pgvector SQL + OpenAI embeddings ($$) | **LlamaIndex.TS + local `@xenova/transformers`** | $0 embedding cost, no API rate limits, infinite parallelism; LlamaIndex handles chunking, PGVectorStore, retrieval + re-ranking |
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
| Direct SDK imports in business logic | **Ports & Adapters** (hexagonal architecture) | Every external dependency behind an interface; swap ArangoDB→Neo4j, Temporal→Inngest, Stripe→Paddle with a single adapter file; business logic has zero external imports |
| Manual DI / global singletons | **Container factory** (`createProductionContainer` / `createTestContainer`) | Typed dependency graph; tests use in-memory fakes without mocking frameworks; new dependency = new port + adapter, nothing else changes |
| `generateText()` + regex/JSON.parse | **`generateObject()` + Zod schemas** (structured output mandate) | ~99.9% reliability vs ~70% with regex; provider uses constrained decoding; typed output guaranteed; zero LLM response parsing code |
| Database-per-org ArangoDB | **Single database, pool-based multi-tenancy** (`org_id` + `repo_id` on every doc/edge) | No per-database memory overhead; scales to 10,000+ orgs; tenant isolation enforced at query level with persistent indexes |
| Single-root SCIP indexing | **Monorepo detection + per-package SCIP + `scip combine`** | Enterprise monorepos (Nx, Turborepo, pnpm workspaces) index correctly; cross-package type references resolve |
| No tool call rate limiting | **Token bucket rate limiter** (Redis sliding window, 60 calls/min) | Prevents runaway agents from draining DB connections and inflating LLM costs; 429 response tells agent to stop looping |
| No change tracking | **Prompt Ledger** (append-only timeline + working-state snapshots + branching) | Every AI change linked to its prompt; rewind to any working state; anti-pattern rules auto-generated from failures; commit roll-up shows AI contribution |
| No local workspace sync for ledger | **kap10 CLI** (`@autorail/kap10` — watch, rewind, timeline, mark-working) | Users can rewind from terminal; file changes streamed to cloud in real-time; works alongside agent-based sync |
| No data deletion mechanism | **24-hour deletion SLA** (`deleteRepoWorkflow` + `deletionAuditWorkflow`) | Enterprise compliance; all repo data (graph, embeddings, metadata) purged within 24h of disconnect; audit trail for compliance |
| No initial value demonstration | **Architecture Health Report** (auto-generated after first indexing) | Dead code, architecture drift, testing gaps, circular deps, complexity hotspots, LLM risk assessment — proves kap10 works before user writes a single prompt |
| `execAsync('git clone/pull/diff')` | **`simple-git`** + **`parse-diff`** | Promise-based Git with auth/queuing/concurrency safety; structured diff parsing into typed JSON — no brittle shell commands |
| Custom Redis `MULTI/EXEC` rate limiter | **`@upstash/ratelimit`** | Mathematically proven sliding window; no race conditions; works with standard `ioredis` |
| Hand-rolled 6-regex secret scrubber | **TruffleHog regex ruleset** (800+ vendor patterns) + entropy fallback | Catches Slack, Stripe, GCP, Azure, and hundreds more vendor-specific key formats; maintained by security team |
| React Flow only for all graphs | **React Flow** (structured swimlanes) + **Cytoscape.js** (force-directed dependency graphs) | React Flow for Blueprint Dashboard; Cytoscape for organic N-hop impact analysis graphs with 500+ nodes |

---

*kap10 — The AI Tech Lead. Institutional memory, rewind, rules, and proven patterns for your codebase.*
