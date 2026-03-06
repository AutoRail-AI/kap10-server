# Temporal Workflows — Complete Architecture Reference

> Master inventory of every Temporal workflow in the platform. Each workflow includes queue assignment, timeout/retry config, activity call stack, child workflows, signals/queries, external services touched, and API trigger routes.
>
> **Infrastructure files:**
> - Workers: `scripts/temporal-worker-light.ts`, `scripts/temporal-worker-heavy.ts`
> - Barrel export: `lib/temporal/workflows/index.ts`
> - Client adapter: `lib/adapters/temporal-workflow-engine.ts`
> - Shared helper: `lib/temporal/activities/graph-writer.ts`

---

## Table of Contents

1. [Worker Architecture](#1-worker-architecture)
2. [Workflow Dependency Graph](#2-workflow-dependency-graph)
3. [Master Workflow Inventory](#3-master-workflow-inventory)
4. [indexRepoWorkflow](#4-indexrepoworkflow) — Full repo indexing (SCIP + parse)
5. [embedRepoWorkflow](#5-embedrepoworkflow) — Vector embedding pipeline
6. [discoverOntologyWorkflow](#6-discoverontologyworkflow) — Domain ontology discovery
7. [justifyRepoWorkflow](#7-justifyrepoworkflow) — Business justification
8. [justifyEntityWorkflow](#8-justifyentityworkflow) — Single entity justification
9. [generateHealthReportWorkflow](#9-generatehealthreportworkflow) — Health report + ADRs
10. [detectPatternsWorkflow](#10-detectpatternsworkflow) — AST-grep pattern detection
11. [minePatternsWorkflow](#11-minepatternsworkflow) — Louvain community mining
12. [simulateRuleWorkflow](#12-simulateruleworkflow) — Rule blast radius simulation
13. [ruleDeprecationWorkflow](#13-ruledeprecationworkflow) — Rule decay evaluation
14. [incrementalIndexWorkflow](#14-incrementalindexworkflow) — Incremental indexing (webhooks)
15. [reviewPrWorkflow](#15-reviewprworkflow) — PR review
16. [prFollowUpWorkflow](#16-prfollowupworkflow) — PR nudge follow-up
17. [generateAdrWorkflow](#17-generateadrworkflow) — Auto-ADR on merge
18. [mergeLedgerWorkflow](#18-mergeledgerworkflow) — Prompt ledger merge
19. [syncLocalGraphWorkflow](#19-synclocalgraphworkflow) — Graph snapshot export
20. [deleteRepoWorkflow](#20-deleterepoworkflow) — Repo deletion
21. [cleanupWorkspacesWorkflow](#21-cleanupworkspacesworkflow) — Workspace GC (cron)
22. [reconciliationWorkflow](#22-reconciliationworkflow) — Repo reconciliation (cron)
23. [Embedding Pipeline Deep Dive](#23-embedding-pipeline-deep-dive)
24. [API Trigger Routes](#24-api-trigger-routes)
25. [Tuning & Optimization History](#25-tuning--optimization-history)

---

## 1. Worker Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Temporal Server                               │
│                     (namespace: default)                             │
│                                                                      │
│   ┌─────────────────────────┐     ┌───────────────────────────┐     │
│   │    light-llm-queue      │     │   heavy-compute-queue     │     │
│   └────────────┬────────────┘     └─────────────┬─────────────┘     │
└────────────────┼────────────────────────────────┼───────────────────┘
                 │                                │
    ┌────────────▼────────────┐      ┌────────────▼────────────┐
    │  Light Worker (N reps)  │      │  Heavy Worker (N reps)  │
    │  scripts/temporal-       │      │  scripts/temporal-       │
    │    worker-light.ts      │      │    worker-heavy.ts      │
    │                          │      │                          │
    │  Activities:             │      │  Activities:             │
    │  - indexing-light        │      │  - indexing-heavy        │
    │  - embedding             │      │  - incremental           │
    │  - ontology              │      │  - pattern-detection     │
    │  - justification         │      │  - pattern-mining        │
    │  - health-report         │      │  - rule-simulation       │
    │  - incremental           │      │  - review                │
    │  - context-refresh       │      │  - temporal-analysis     │
    │  - drift-alert           │      │  - workspace-cleanup     │
    │  - drift-documentation   │      │                          │
    │  - pattern-detection     │      └──────────────────────────┘
    │  - rule-decay            │
    │  - anti-pattern          │
    │  - review                │
    │  - ledger-merge          │
    │  - adr-generation        │
    │  - graph-analysis        │
    │  - graph-export          │
    │  - graph-upload          │
    │  - workspace-cleanup     │
    │  - onboarding            │
    │  - pipeline-logs         │
    │  - pipeline-run          │
    └──────────────────────────┘
```

Both workers register `lib/temporal/workflows/` as their `workflowsPath`, so **all workflows are bundled into both workers**. Queue assignment happens at the `proxyActivities` level, not the worker level.

Workers are stateless and horizontally scalable — run N replicas on ECS/EKS. Each instance polls the same queue; Temporal distributes work automatically.

---

## 2. Workflow Dependency Graph

```
                          ┌──────────────────┐
                          │  indexRepoWorkflow│  ← API trigger (POST /api/repos)
                          │  heavy + light    │
                          └────────┬──────────┘
                                   │
                    ┌──────────────┼──────────────────┐
                    │              │                    │
                    ▼              ▼                    ▼
          ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐
          │ embedRepo   │  │ syncLocal   │  │ detectPatterns   │
          │ Workflow     │  │ Graph       │  │ Workflow          │
          │ light        │  │ Workflow    │  │ heavy + light    │
          └──────┬──────┘  │ light       │  └──────────────────┘
                 │         └─────────────┘
                 ▼
          ┌─────────────┐
          │ discover    │
          │ Ontology    │
          │ Workflow     │
          │ light       │
          └──────┬──────┘
                 │
                 ▼
          ┌─────────────┐
          │ justifyRepo │
          │ Workflow     │
          │ light       │
          └──────┬──────┘
                 │
                 ▼
          ┌─────────────┐
          │ generate    │
          │ HealthReport│
          │ Workflow     │
          │ light       │
          └─────────────┘

  ┌──────────────────┐      ┌──────────────────┐
  │ incrementalIndex │      │ reviewPr         │  ← GitHub webhook
  │ Workflow          │ ──►  │ Workflow          │
  │ heavy + light    │      │ (default queue)  │
  └──────────────────┘      └───────┬──────────┘
                                    │
                         ┌──────────┼──────────┐
                         ▼          ▼          ▼
                  ┌──────────┐ ┌────────┐ ┌────────────┐
                  │ prFollow │ │ merge  │ │ generateAdr│
                  │ Up       │ │ Ledger │ │ Workflow    │
                  └──────────┘ └────────┘ └────────────┘

  Standalone (cron / on-demand):
  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
  │ cleanupWorkspaces│  │ reconciliation   │  │ deleteRepo       │
  │ (cron: 15min)    │  │ (cron: periodic) │  │ (on DELETE)      │
  └──────────────────┘  └──────────────────┘  └──────────────────┘

  Pattern sub-workflows (triggered from detectPatternsWorkflow or on-demand):
  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
  │ minePatterns     │  │ simulateRule     │  │ ruleDeprecation  │
  │ heavy            │  │ heavy            │  │ light            │
  └──────────────────┘  └──────────────────┘  └──────────────────┘
```

---

## 3. Master Workflow Inventory

| # | Workflow | Source File | Queue(s) | Timeout | Retries | Signals | Queries | Child Workflows |
|---|----------|-------------|----------|---------|---------|---------|---------|-----------------|
| 1 | `indexRepoWorkflow` | `index-repo.ts` | heavy + light | 30m (heavy), 5m (light) | 3 | — | `getProgress` | embed, syncGraph, detectPatterns |
| 2 | `embedRepoWorkflow` | `embed-repo.ts` | light | 60m | 2 | — | `getEmbedProgress` | discoverOntology |
| 3 | `discoverOntologyWorkflow` | `discover-ontology.ts` | light | 15m | 3 | — | — | justifyRepo |
| 4 | `justifyRepoWorkflow` | `justify-repo.ts` | light | 60m | 3 | — | `getJustifyProgress` | generateHealthReport |
| 5 | `justifyEntityWorkflow` | `justify-entity.ts` | light | 10m | 3 | — | — | — |
| 6 | `generateHealthReportWorkflow` | `generate-health-report.ts` | light | 15m | 3 | — | — | — |
| 7 | `detectPatternsWorkflow` | `detect-patterns.ts` | heavy + light | 15m | 2 | — | — | — |
| 8 | `minePatternsWorkflow` | `mine-patterns.ts` | heavy | 30m | 2 | — | — | — |
| 9 | `simulateRuleWorkflow` | `simulate-rule.ts` | heavy | 15m | 2 | — | — | — |
| 10 | `ruleDeprecationWorkflow` | `rule-deprecation.ts` | light | 5m | 2 | — | — | — |
| 11 | `incrementalIndexWorkflow` | `incremental-index.ts` | heavy + light | 30m (heavy), 10m (light) | 3 | `pushSignal` | `getIncrementalProgress` | indexRepo (fallback) |
| 12 | `reviewPrWorkflow` | `review-pr.ts` | (default) | 120s | 3 | — | — | — |
| 13 | `prFollowUpWorkflow` | `pr-follow-up.ts` | (default) | 30s | 3 | — | — | — |
| 14 | `generateAdrWorkflow` | `generate-adr.ts` | (default) | 120s | 3 | — | — | — |
| 15 | `mergeLedgerWorkflow` | `merge-ledger.ts` | (default) | 60s | 3 | — | — | — |
| 16 | `syncLocalGraphWorkflow` | `sync-local-graph.ts` | light | 10m (export), 5m (upload) | 3 | — | — | — |
| 17 | `deleteRepoWorkflow` | `delete-repo.ts` | light | 5m | 3 | — | — | — |
| 18 | `cleanupWorkspacesWorkflow` | `cleanup-workspaces.ts` | (default) | 60s | 3 | — | — | — |
| 19 | `reconciliationWorkflow` | `reconciliation.ts` | light (unused) | 5m | 2 | — | — | — |

> **Note:** `deletion-audit.ts` contains utility functions (not a Temporal workflow). Not exported from the barrel, not registered in any worker.

---

## 4. indexRepoWorkflow

> Full repository indexing: clone, SCIP, parse, graph write, fan out to embed + sync + patterns.

**Source:** `lib/temporal/workflows/index-repo.ts`

```
┌───────────────────────────────────────────────────────────────────────────┐
│  indexRepoWorkflow  (Temporal)                                            │
│  Query: getProgressQuery (number)                                         │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  proxyActivities configs:                                                 │
│  ┌────────────────────────────────────────────────────────────┐           │
│  │ Heavy (indexing-heavy):  queue=heavy-compute  30m  hb=2m  3x │        │
│  │ Light (indexing-light):  queue=light-llm       5m  hb=1m  3x │        │
│  │ Graph Analysis:          queue=light-llm      10m  hb=2m  2x │        │
│  │ Temporal Analysis:       queue=heavy-compute  15m  hb=2m  2x │        │
│  │ Cleanup:                 queue=heavy-compute   2m         1x │        │
│  │ Logs:                    queue=light-llm      30s         2x │        │
│  │ Run:                     queue=light-llm      10s         2x │        │
│  └────────────────────────────────────────────────────────────┘           │
│                                                                           │
│  Step 1 ──► initPipelineRun()                            ──► Postgres    │
│  Step 2 ──► prepareRepoIntelligenceSpace()               ──► Git + FS   │
│             (clone, scan workspace, detect monorepo)                      │
│  Step 3 ──► wipeRepoGraphData()                          ──► ArangoDB   │
│  Step 4 ──► runSCIP()                                    ──► SCIP binary │
│             (heavy-compute: TypeScript, Python, Go, Java, etc.)           │
│  Step 5 ──► parseRest()                                  ──► CPU        │
│             (light: parse files not covered by SCIP)                      │
│  Step 6 ──► finalizeIndexing()                           ──► Postgres   │
│  Step 7 ──► precomputeBlastRadius()                      ──► ArangoDB   │
│  Step 8 ──► computeTemporalAnalysis()                    ──► Git log    │
│             (heavy-compute: git co-change mining)                         │
│                                                                           │
│  Fan-out (3 child workflows, all ABANDON on parent close):               │
│  Step 9a ──► startChild(embedRepoWorkflow)               ──► light-llm  │
│  Step 9b ──► startChild(syncLocalGraphWorkflow)           ──► light-llm  │
│  Step 9c ──► startChild(detectPatternsWorkflow)           ──► heavy      │
│                                                                           │
│  Step 10 ──► completePipelineRun()                       ──► Postgres   │
│                                                                           │
│  On failure:                                                              │
│    updateRepoError() → Postgres                                          │
│    cleanupWorkspaceFilesystem() → FS (best-effort)                       │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

**Input:** `{ orgId, repoId, installationId, cloneUrl, defaultBranch, indexVersion?, runId? }`
**Returns:** `{ entitiesWritten, edgesWritten, fileCount, functionCount, classCount }`

---

## 5. embedRepoWorkflow

> Generate and store vector embeddings for all entities. Detailed deep dive in [Section 23](#23-embedding-pipeline-deep-dive).

**Source:** `lib/temporal/workflows/embed-repo.ts`

```
┌───────────────────────────────────────────────────────────────────────────┐
│  embedRepoWorkflow  (Temporal, light-llm-queue)                           │
│  Timeout: 60min │ Heartbeat: 5min │ Retries: 2                           │
│  Query: getEmbedProgressQuery (number)                                    │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  Step 1 ──► setEmbeddingStatus()                         ──► Postgres    │
│  Step 2 ──► fetchFilePaths()                             ──► ArangoDB    │
│  Step 3 ──► Sliding Window (3 concurrent × 50 files)     ──► Vertex AI   │
│             processAndEmbedBatch() × N batches                            │
│  Step 4 ──► deleteOrphanedEmbeddingsFromGraph()          ──► ArangoDB+PG │
│  Step 5 ──► setReadyStatus()                             ──► Postgres    │
│  Step 6 ──► startChild(discoverOntologyWorkflow)         ──► Temporal    │
│                                                                           │
│  On failure: setEmbedFailedStatus()                      ──► Postgres    │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

**Input:** `{ orgId, repoId, lastIndexedSha?, runId? }`
**Returns:** `{ embeddingsStored, orphansDeleted }`

---

## 6. discoverOntologyWorkflow

> Discover domain ontology from graph entities using LLM, then chain to justification.

**Source:** `lib/temporal/workflows/discover-ontology.ts`

```
┌───────────────────────────────────────────────────────────────────────────┐
│  discoverOntologyWorkflow  (Temporal, light-llm-queue)                    │
│  Timeout: 15min │ Heartbeat: 2min │ Retries: 3                           │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  Step 1 ──► discoverAndStoreOntology()                   ──► LLM + Arango│
│  Step 2 ──► startChild(justifyRepoWorkflow)              ──► Temporal    │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

**Input:** `{ orgId, repoId, runId? }`
**Returns:** `void`

---

## 7. justifyRepoWorkflow

> Business justification for all entities via topological sort + LLM. Most complex workflow.

**Source:** `lib/temporal/workflows/justify-repo.ts`

```
┌───────────────────────────────────────────────────────────────────────────┐
│  justifyRepoWorkflow  (Temporal, light-llm-queue)                         │
│  Timeout: 60min │ Heartbeat: 5min │ Retries: 3                           │
│  Query: getJustifyProgressQuery (number)                                  │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  Step 1 ──► setJustifyingStatus()                        ──► Postgres    │
│  Step 2 ──► fetchEntitiesAndEdges()                      ──► ArangoDB    │
│  Step 3 ──► loadOntology()                               ──► ArangoDB    │
│  Step 4 ──► performTopologicalSort()                     ──► ArangoDB    │
│  Step 5 ──► detectCommunitiesActivity()                  ──► ArangoDB    │
│             (Louvain community detection)                                 │
│  Step 6 ──► getJustificationConcurrency()                ──► Config      │
│                                                                           │
│  Step 7 ──► Level-by-level justification loop:                           │
│    for each topological level:                                            │
│      ├─ fetchTopologicalLevel()                          ──► Redis       │
│      ├─ justifyBatch() × N (sliding window)              ──► LLM        │
│      ├─ storeChangedEntityIds()                          ──► Redis       │
│      └─ refineOntologyWithNewConcepts() (every 20 levels)──► LLM        │
│                                                                           │
│  Step 8 ──► cleanupJustificationCache()                  ──► Redis       │
│  Step 9 ──► propagateContextActivity()                   ──► ArangoDB    │
│  Step 10 ──► storeFeatureAggregations()                  ──► ArangoDB    │
│  Step 11 ──► embedJustifications()                       ──► Vertex AI   │
│  Step 12 ──► reEmbedWithJustifications() (Pass 2)        ──► Vertex AI   │
│  Step 13 ──► warmEntityProfileCache()                    ──► Redis       │
│  Step 14 ──► setJustifyDoneStatus()                      ──► Postgres    │
│  Step 15 ──► startChild(generateHealthReportWorkflow)    ──► Temporal    │
│                                                                           │
│  On failure: setJustifyFailedStatus()                    ──► Postgres    │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

**Input:** `{ orgId, repoId, runId? }`
**Returns:** `{ entitiesJustified, embeddingsStored }`

---

## 8. justifyEntityWorkflow

> Single entity justification with cascade to callers.

**Source:** `lib/temporal/workflows/justify-entity.ts`

```
┌───────────────────────────────────────────────────────────────────────────┐
│  justifyEntityWorkflow  (Temporal, light-llm-queue)                       │
│  Timeout: 10min │ Heartbeat: 2min │ Retries: 3                           │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  Step 1 ──► fetchEntitiesAndEdges()                      ──► ArangoDB    │
│  Step 2 ──► loadOntology()                               ──► ArangoDB    │
│  Step 3 ──► justifyBatch() (single entity)               ──► LLM        │
│  Step 4 ──► embedJustifications()                        ──► Vertex AI   │
│  Step 5 ──► findEntityCallerIds()                        ──► ArangoDB    │
│  Step 6 ──► justifyBatch() (cascade to callers)          ──► LLM        │
│  Step 7 ──► embedJustifications() (cascade)              ──► Vertex AI   │
│  Step 8 ──► storeFeatureAggregations()                   ──► ArangoDB    │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

**Input:** `{ orgId, repoId, entityId }`
**Returns:** `{ justified, cascadeCount }`

---

## 9. generateHealthReportWorkflow

> Aggregate features, build health report, synthesize ADRs.

**Source:** `lib/temporal/workflows/generate-health-report.ts`

```
┌───────────────────────────────────────────────────────────────────────────┐
│  generateHealthReportWorkflow  (Temporal, light-llm-queue)                │
│  Timeout: 15min │ Heartbeat: 2min │ Retries: 3                           │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  Step 1 ──► aggregateAndStoreFeatures()                  ──► ArangoDB    │
│  Step 2 ──► buildAndStoreHealthReport()                  ──► LLM + Arango│
│  Step 3 ──► synthesizeAndStoreADRs()                     ──► LLM + Arango│
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

**Input:** `{ orgId, repoId, runId? }`
**Returns:** `void`

---

## 10. detectPatternsWorkflow

> AST-grep pattern scanning + LLM rule synthesis + semantic mining.

**Source:** `lib/temporal/workflows/detect-patterns.ts`

```
┌───────────────────────────────────────────────────────────────────────────┐
│  detectPatternsWorkflow  (Temporal, heavy-compute + light-llm)            │
│  Timeout: 15min │ Heartbeat: 2min │ Retries: 2                           │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  Step 1 ──► scanSynthesizeAndStore()                     ──► AST-grep    │
│             (heavy: scan, light: LLM synthesize + store)     + LLM       │
│  Step 2 ──► semanticPatternMining()                      ──► LLM        │
│             (best-effort, non-fatal)                                      │
│  Step 3 ──► cleanupWorkspaceFilesystem()                 ──► FS         │
│             (best-effort)                                                 │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

**Input:** `{ orgId, repoId, runId?, workspacePath, languages }`
**Returns:** `{ patternsDetected, rulesGenerated, semanticClusters, semanticRules }`

---

## 11. minePatternsWorkflow

> Louvain community detection on the code graph for pattern mining.

**Source:** `lib/temporal/workflows/mine-patterns.ts`

```
┌───────────────────────────────────────────────────────────────────────────┐
│  minePatternsWorkflow  (Temporal, heavy-compute-queue)                    │
│  Timeout: 30min │ Heartbeat: 5min │ Retries: 2                           │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  Step 1 ──► minePatterns()                               ──► ArangoDB    │
│             (Louvain community detection)                                 │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

**Input:** `{ orgId, repoId, maxEntities? }`
**Returns:** `{ communitiesFound, patternsStored }`

---

## 12. simulateRuleWorkflow

> Simulate blast radius of a proposed ast-grep rule against codebase.

**Source:** `lib/temporal/workflows/simulate-rule.ts`

```
┌───────────────────────────────────────────────────────────────────────────┐
│  simulateRuleWorkflow  (Temporal, heavy-compute-queue)                    │
│  Timeout: 15min │ Heartbeat: 2min │ Retries: 2                           │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  Step 1 ──► simulateRuleBlastRadius()                    ──► AST-grep    │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

**Input:** `{ orgId, repoId, ruleId, workspacePath, astGrepQuery, language }`
**Returns:** `ImpactReportDoc`

---

## 13. ruleDeprecationWorkflow

> Evaluate rule decay scores and deprecate/archive stale rules.

**Source:** `lib/temporal/workflows/rule-deprecation.ts`

```
┌───────────────────────────────────────────────────────────────────────────┐
│  ruleDeprecationWorkflow  (Temporal, light-llm-queue)                     │
│  Timeout: 5min │ Heartbeat: 1min │ Retries: 2                            │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  Step 1 ──► evaluateRuleDecay()                          ──► ArangoDB    │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

**Input:** `{ orgId, threshold? }`
**Returns:** `{ rulesEvaluated, rulesDeprecated, rulesArchived }`

---

## 14. incrementalIndexWorkflow

> Incremental indexing triggered by GitHub push webhooks. Supports signal-based batching.

**Source:** `lib/temporal/workflows/incremental-index.ts`

```
┌───────────────────────────────────────────────────────────────────────────┐
│  incrementalIndexWorkflow  (Temporal, heavy + light)                      │
│  Signal: pushSignal │ Query: getIncrementalProgress                       │
│                                                                           │
│  proxyActivities configs:                                                 │
│  ┌────────────────────────────────────────────────────────────┐           │
│  │ Heavy (incremental):    queue=heavy-compute  30m  hb=2m  3x │        │
│  │ Light (incremental):    queue=light-llm      10m  hb=1m  3x │        │
│  │ Light Write:            queue=light-llm       5m  hb=1m  3x │        │
│  │ Context Refresh:        queue=light-llm       5m  hb=1m  2x │        │
│  │ Logs:                   queue=light-llm       5s         1x │        │
│  └────────────────────────────────────────────────────────────┘           │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  Step 1 ──► pullAndDiff()                                ──► Git + FS    │
│             (heavy: git pull, compute changed files)                      │
│  Step 2 ──► reIndexBatch() × N                           ──► SCIP / CPU  │
│             (heavy: re-index changed files in batches)                    │
│  Step 3 ──► applyEntityDiffs()                           ──► ArangoDB    │
│  Step 4 ──► repairEdgesActivity()                        ──► ArangoDB    │
│  Step 5 ──► updateEmbeddings()                           ──► Vertex AI   │
│  Step 6 ──► cascadeReJustify()                           ──► LLM        │
│  Step 7 ──► refreshKnowledgeSections() (J-03)            ──► LLM        │
│  Step 8 ──► invalidateCaches()                           ──► Redis       │
│  Step 9 ──► finalizeIndexing()                           ──► Postgres    │
│                                                                           │
│  Fallback: startChild(indexRepoWorkflow) if diff too large               │
│  On failure: updateRepoError()                           ──► Postgres    │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

**Input:** `{ orgId, repoId, installationId, cloneUrl, defaultBranch, workspacePath, runId?, initialPush }`
**Returns:** `{ entitiesAdded, entitiesUpdated, entitiesDeleted, edgesRepaired, embeddingsUpdated, cascadeEntities }`

---

## 15. reviewPrWorkflow

> Automated PR review: fetch diff, run checks, post review comment.

**Source:** `lib/temporal/workflows/review-pr.ts`

```
┌───────────────────────────────────────────────────────────────────────────┐
│  reviewPrWorkflow  (Temporal, default queue)                              │
│  Timeout: 120s │ Retries: 3                                              │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  Step 1 ──► fetchDiffAndRunChecks()                      ──► GitHub API  │
│  Step 2 ──► postReviewSelfSufficient()                   ──► GitHub API  │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

**Input:** `{ orgId, repoId, prNumber, installationId, headSha, baseSha, owner, repo, reviewId }`
**Returns:** `void`

---

## 16. prFollowUpWorkflow

> Delayed follow-up nudge on PR if no action taken. Uses Temporal `sleep()` for delay.

**Source:** `lib/temporal/workflows/pr-follow-up.ts`

```
┌───────────────────────────────────────────────────────────────────────────┐
│  prFollowUpWorkflow  (Temporal, default queue)                            │
│  Timeout: 30s │ Retries: 3                                               │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  Step 1 ──► sleep(48h)                                   ──► Temporal    │
│             (configurable via nudgeDelayHours)                             │
│  Step 2 ──► checkAndPostNudge()                          ──► GitHub API  │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

**Input:** `{ orgId, repoId, prNumber, reviewId, owner, repo, headSha, installationId, nudgeDelayHours? }`
**Returns:** `{ action, reason? }`

---

## 17. generateAdrWorkflow

> Auto-generate Architecture Decision Record on PR merge if significant.

**Source:** `lib/temporal/workflows/generate-adr.ts`

```
┌───────────────────────────────────────────────────────────────────────────┐
│  generateAdrWorkflow  (Temporal, default queue)                           │
│  Timeout: 120s │ Retries: 3                                              │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  Step 1 ──► assessMergeSignificance()                    ──► LLM        │
│  Step 2 ──► generateAdr()  (conditional)                 ──► LLM        │
│  Step 3 ──► commitAdrPr()  (conditional)                 ──► GitHub API  │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

**Input:** `{ orgId, repoId, prNumber, prTitle, mergedBy, owner, repo, installationId, headSha }`
**Returns:** `{ adrPrNumber?, adrPrUrl?, skipped?, reason? }`

---

## 18. mergeLedgerWorkflow

> Reparent prompt ledger entries and synthesize merge summary on PR merge.

**Source:** `lib/temporal/workflows/merge-ledger.ts`

```
┌───────────────────────────────────────────────────────────────────────────┐
│  mergeLedgerWorkflow  (Temporal, default queue)                           │
│  Timeout: 60s │ Retries: 3                                               │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  Step 1 ──► fetchLedgerEntries()                         ──► ArangoDB    │
│  Step 2 ──► reparentLedgerEntries()                      ──► ArangoDB    │
│  Step 3 ──► createMergeNode()                            ──► ArangoDB    │
│  Step 4 ──► synthesizeLedgerSummary()  (conditional)     ──► LLM        │
│  Step 5 ──► storeLedgerSummary()       (conditional)     ──► ArangoDB    │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

**Input:** `{ orgId, repoId, sourceBranch, targetBranch, prNumber, mergedBy }`
**Returns:** `void`

---

## 19. syncLocalGraphWorkflow

> Export graph snapshot, compress, upload to Supabase Storage, notify clients.

**Source:** `lib/temporal/workflows/sync-local-graph.ts`

```
┌───────────────────────────────────────────────────────────────────────────┐
│  syncLocalGraphWorkflow  (Temporal, light-llm-queue)                      │
│  Export: 10min hb=5m 3x │ Upload: 5min hb=1m 3x                         │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  Step 1 ──► updateSnapshotStatus("generating")           ──► Postgres    │
│  Step 2 ──► exportAndUploadGraph()                       ──► ArangoDB    │
│             ├─ queryCompactGraphInternal()                    + Supabase  │
│             ├─ serializeSnapshotChunked() (msgpack)          Storage      │
│             ├─ streamGzip() (async, yields to event loop)                 │
│             ├─ computeChecksum() (SHA-256)                                │
│             └─ supabase.storage.upload()                                  │
│  Step 3 ──► notifyConnectedClients()                     ──► Redis       │
│  Step 4 ──► updateSnapshotStatus("available")            ──► Postgres    │
│                                                                           │
│  On failure: updateSnapshotStatus("failed")              ──► Postgres    │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

**Input:** `{ orgId, repoId }`
**Returns:** `{ storagePath, sizeBytes, entityCount, edgeCount, checksum }`

---

## 20. deleteRepoWorkflow

> Delete all repo data from graph store and relational store.

**Source:** `lib/temporal/workflows/delete-repo.ts`

```
┌───────────────────────────────────────────────────────────────────────────┐
│  deleteRepoWorkflow  (Temporal, light-llm-queue)                          │
│  Timeout: 5min │ Retries: 3                                              │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  Step 1 ──► deleteRepoData()                             ──► ArangoDB    │
│             (graph data, embeddings, etc.)                    + Postgres  │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

**Input:** `{ orgId, repoId }`
**Returns:** `void`

---

## 21. cleanupWorkspacesWorkflow

> Cron workflow (every 15 min) to clean up expired workspace directories.

**Source:** `lib/temporal/workflows/cleanup-workspaces.ts`

```
┌───────────────────────────────────────────────────────────────────────────┐
│  cleanupWorkspacesWorkflow  (Temporal, default queue)                      │
│  Timeout: 60s │ Retries: 3                                               │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  Step 1 ──► cleanupExpiredWorkspacesActivity()           ──► Filesystem  │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

**Input:** none
**Returns:** `number` (cleaned count)

---

## 22. reconciliationWorkflow

> Cron workflow to check ready repos against GitHub latest SHA. Currently a placeholder.

**Source:** `lib/temporal/workflows/reconciliation.ts`

```
┌───────────────────────────────────────────────────────────────────────────┐
│  reconciliationWorkflow  (Temporal, light-llm-queue)                      │
│  Timeout: 5min │ Retries: 2 │ STATUS: PLACEHOLDER                       │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  Currently returns empty results.                                         │
│  Intended: check repos, trigger re-index if out of date.                 │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

**Input:** `{ orgId }`
**Returns:** `{ reposChecked, reposTriggered, errors }`

---

## 23. Embedding Pipeline Deep Dive

> Detailed internals of `embedRepoWorkflow` — batch processing, concurrency, Vertex AI integration.
>
> **Source files:** `lib/temporal/workflows/embed-repo.ts`, `lib/temporal/activities/embedding.ts`, `lib/adapters/llamaindex-vector-search.ts`, `lib/utils/stream-compress.ts`

### 23.1 Batch Processing: `processAndEmbedBatch()`

```
processAndEmbedBatch(50 file paths)
│
├─ 1. FETCH ENTITIES                              ──► ArangoDB
│     for each of 50 files (SEQUENTIAL):
│       graphStore.getEntitiesByFile(path)
│     Result: ~2,500 entities
│     ⏱ ~50 files × 50ms = ~2.5s
│
├─ 2. LOAD JUSTIFICATIONS                         ──► ArangoDB
│     graphStore.getJustifications(orgId, repoId)
│     Returns Map<entityId, JustificationDoc>
│     ⏱ ~100ms (empty on first index)
│
├─ 3. BUILD DOCUMENTS                             ──► CPU (pure function)
│     buildEmbeddableDocuments() creates 2 variants per entity:
│       ├─ Semantic: name + sig + doc + body + justification + community + fingerprint
│       └─ Code:    name + sig + doc + body (structural only)
│     + Fallback file-level docs for files with no code entities
│     Result: ~5,000+ docs
│     ⏱ ~50ms
│
└─ 4. EMBED + STORE                               ──► Vertex AI + Postgres
      embedAndStore(docs)
      │
      └─ Sub-batch loop (100 docs each, SEQUENTIAL):
         │
         ├─ a. EMBED 100 texts                    ──► Vertex AI
         │     vectorSearch.embed(texts)
         │     └─ vertexEmbed(texts, "RETRIEVAL_DOCUMENT")
         │         └─ 100 concurrent HTTP calls (semaphore)
         │            ⏱ ~200ms (all 100 fire in parallel)
         │
         ├─ b. VALIDATE vectors
         │     Filter NaN/Infinity → validIndices
         │
         ├─ c. UPSERT 100 rows                    ──► PostgreSQL (pgvector)
         │     vectorSearch.upsert(ids, embeddings, metadata)
         │     └─ Single multi-row INSERT statement
         │        INSERT INTO unerr.entity_embeddings
         │        VALUES (...), (...), ... (100 rows)
         │        ON CONFLICT DO UPDATE
         │        ⏱ ~30ms (one SQL round-trip)
         │
         └─ d. HEARTBEAT + GC
               Report progress + memory stats
```

### 23.2 Concurrency Matrix

```
                    ┌──────────────────────────────────┐
                    │        Vertex AI (Gemini)         │
                    │      gemini-embedding-001         │
                    │         768 dimensions            │
                    └──────────────┬───────────────────┘
                                   │
                          300 concurrent HTTP calls
                          (3 batches × 100 per batch)
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        │                          │                          │
   ┌────┴─────┐             ┌─────┴────┐             ┌──────┴─────┐
   │ Batch A  │             │ Batch B  │             │  Batch C   │
   │ 50 files │             │ 50 files │             │  50 files  │
   │          │             │          │             │            │
   │ sem(100) │             │ sem(100) │             │  sem(100)  │
   │ ┌──────┐ │             │ ┌──────┐ │             │  ┌──────┐  │
   │ │100   │ │             │ │100   │ │             │  │100   │  │
   │ │HTTP  │ │             │ │HTTP  │ │             │  │HTTP  │  │
   │ │calls │ │             │ │calls │ │             │  │calls │  │
   │ └──┬───┘ │             │ └──┬───┘ │             │  └──┬───┘  │
   │    │     │             │    │     │             │     │      │
   │    ▼     │             │    ▼     │             │     ▼      │
   │ pgvector │             │ pgvector │             │  pgvector  │
   │ INSERT   │             │ INSERT   │             │  INSERT    │
   │ 100 rows │             │ 100 rows │             │  100 rows  │
   └──────────┘             └──────────┘             └────────────┘
        │                        │                         │
        └────────────────────────┼─────────────────────────┘
                                 │
                    ┌────────────┴─────────────┐
                    │   PostgreSQL (Supabase)   │
                    │  unerr.entity_embeddings  │
                    │     pgvector + HNSW       │
                    │      Pool: max 5          │
                    └──────────────────────────┘
```

### 23.3 Embedding Time Budget

For a repo with 3,253 files and ~32K entities (~64K embeddings with dual variants):

| Phase | Per Batch | Batches | Raw Total | With 3x Concurrency |
|-------|-----------|---------|-----------|---------------------|
| ArangoDB fetch (50 files, sequential) | 2.5s | 66 | ~165s | ~55s |
| Justification map load | 0.1s | 66 | ~7s | ~2s |
| Build docs (CPU) | 0.05s | 66 | ~3s | ~1s |
| Vertex AI embed (50 sub-batches × 100 concurrent) | 10.0s | 66 | ~660s | ~220s |
| pgvector multi-row INSERT (50 sub-batches) | 1.5s | 66 | ~99s | ~33s |
| Orphan cleanup (sequential) | — | 1 | ~30s | ~30s |
| **Total** | | | | **~340s (~5.7 min)** |

Vertex AI embedding is the dominant cost (~65% of total time). ArangoDB sequential file fetches are second (~16%).

### 23.4 Dual Embedding Variants

Every entity (except `file` and `directory` kinds) produces **two embedding documents**:

| Variant | Entity Key | Includes | Best For |
|---------|-----------|----------|----------|
| **Semantic** | `{entityId}` | name, signature, doc, body, justification, community label, structural fingerprint | Intent queries ("find payment processing") |
| **Code-only** | `{entityId}::code` | name, signature, doc, body (structural only) | "Find similar code" queries |

Files with **no code entities** (config, text, etc.) get a single fallback embedding with key `file:{path}`.

Both variants stored in `unerr.entity_embeddings`, deduplicated via `ON CONFLICT (repo_id, entity_key, model_version)`.

### 23.5 Two-Pass Embedding

| Pass | When | Context Available | Trigger |
|------|------|-------------------|---------|
| **Pass 1** | During `embedRepoWorkflow` (Stage 5) | Structural only (no justification yet) | Automatic after indexing |
| **Pass 2** | After `justifyRepoWorkflow` (Stage 7) | Full: justification + domain + community | `reEmbedWithJustifications()` activity |

Pass 2 overwrites Pass 1 embeddings via the same `ON CONFLICT` upsert. The semantic variant gains business context; the code-only variant remains unchanged.

### 23.6 Embedding Tuning Parameters

| Parameter | Value | Location | Env Override |
|-----------|-------|----------|--------------|
| `FILES_PER_BATCH` | 50 | `embed-repo.ts` | — |
| `CONCURRENT_BATCHES` | 3 | `embed-repo.ts` | — |
| `EMBED_CONCURRENCY` | 100 | `llamaindex-vector-search.ts` | — |
| `EMBED_MAX_RETRIES` | 5 | `llamaindex-vector-search.ts` | — |
| `upsertBatchSize` | 100 | `embedding.ts` | — |
| `EMBEDDING_MODEL_ID` | `gemini-embedding-001` | `config.ts` | `EMBEDDING_MODEL_ID` |
| `EMBEDDING_DIMENSIONS` | 768 | `config.ts` | `EMBEDDING_DIMENSIONS` |
| `GOOGLE_VERTEX_API_KEY` | — | `config.ts` | `GOOGLE_VERTEX_API_KEY` (required) |
| `EMBEDDING_MODEL_VERSION` | `gemini-emb-001-768` | `llamaindex-vector-search.ts` | `EMBEDDING_MODEL_VERSION` |

**Concurrency formula:** Total Vertex AI calls = `CONCURRENT_BATCHES × EMBED_CONCURRENCY` = 3 × 100 = **300 parallel requests**.

**PostgreSQL param limit:** Each row has 9 columns. 100 rows × 9 = 900 params (well under PostgreSQL's 65,535 limit).

---

## 24. API Trigger Routes

These HTTP endpoints start workflows via `container.workflowEngine.startWorkflow()`:

| Route | Method | Workflow(s) Triggered |
|-------|--------|----------------------|
| `app/api/repos/route.ts` | POST | `indexRepoWorkflow` |
| `app/api/repos/[repoId]/resume/route.ts` | POST | `indexRepoWorkflow` (resume) |
| `app/api/repos/[repoId]/retry/route.ts` | POST | `indexRepoWorkflow` (retry) |
| `app/api/repos/[repoId]/reindex/route.ts` | POST | `indexRepoWorkflow` (full reindex) |
| `app/api/repos/[repoId]/route.ts` | DELETE | `deleteRepoWorkflow` |
| `app/api/repos/[repoId]/justify/route.ts` | POST | `justifyRepoWorkflow` |
| `app/api/repos/[repoId]/health/regenerate/route.ts` | POST | `generateHealthReportWorkflow` |
| `app/api/repos/[repoId]/reviews/[reviewId]/retry/route.ts` | POST | `reviewPrWorkflow` |
| `app/api/graph-snapshots/[repoId]/sync/route.ts` | POST | `syncLocalGraphWorkflow` |
| `app/api/webhooks/github/route.ts` | POST | `incrementalIndexWorkflow`, `reviewPrWorkflow` |
| `app/api/cli/index/route.ts` | POST | `indexRepoWorkflow` |
| `app/api/cli/repos/route.ts` | POST | `indexRepoWorkflow` |
| `app/api/cli/graph-upload/route.ts` | POST | `syncLocalGraphWorkflow` |

---

## 25. Tuning & Optimization History

### External Services Summary

| Service | Protocol | Used By | Concurrency |
|---------|----------|---------|-------------|
| **Vertex AI** (Google) | HTTPS | embedding, justification (embed) | 100 per activity, 300 peak |
| **AWS Bedrock** | HTTPS | LLM calls (justification, ontology, health, review, ADR) | Per-activity |
| **ArangoDB** | HTTP | All graph read/write activities | Sequential per file |
| **PostgreSQL** (Supabase) | TCP | Status updates, pgvector, pipeline runs | Pool max 5 |
| **Redis** | TCP | Cache, justification levels, invalidation | Per-activity |
| **GitHub API** | HTTPS | Clone, PR review, ADR commit | Per-activity |
| **Supabase Storage** | HTTPS | Graph snapshot upload | 1 per sync |
| **Temporal** | gRPC | Activity dispatch, heartbeats, signals | Per invocation |

### Optimization History

| Date | Change | Before | After | Impact |
|------|--------|--------|-------|--------|
| 2026-03-05 | Rebalance embed concurrency | 10 batches × 50 = 500 | 3 batches × 100 = 300 | Eliminated 429 throttling storms |
| 2026-03-05 | Increase files per embed batch | 25 files (131 batches) | 50 files (66 batches) | 50% fewer Temporal round-trips |
| 2026-03-05 | Multi-row pgvector INSERT | 100 sequential INSERTs (~1.5s) | 1 multi-row INSERT (~30ms) | 50x faster upserts |
| 2026-03-05 | Streaming gzip for graph export | `gzipAsync()` blocked event loop | `streamGzip()` async iteration | Embedding no longer frozen during compression |

### Graph Export Compression

`streamGzip()` in `lib/utils/stream-compress.ts` uses async iteration to yield to the event loop between 16KB gzip chunks. Adaptive compression: level 1 for buffers >10MB, level 6 for smaller buffers. This prevents blocking embedding batches running on the same light-llm-queue worker.

---

## Notes

- **`deletion-audit.ts`** contains utility functions (`cleanupEphemeralRepo`, `findExpiredEphemeralRepos`, `promoteEphemeralRepo`) but is **not a Temporal workflow**. Not exported from `workflows/index.ts`, not registered in any worker. Functions take `container` as a direct parameter (incompatible with Temporal activity conventions).
- **`graph-writer.ts`** is a shared helper (not an activity) used by both heavy and light activities. Contains the critical `KIND_TO_COLLECTION` mapping for ArangoDB entity routing.
- Workers are **horizontally scalable**. Each instance can run `maxConcurrentActivityTaskExecutions` (default: 100) activities concurrently. Tune this based on your LLM API rate limits and CPU allocation.
