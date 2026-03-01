# The Indexing Pipeline: How Unerr Captures the Soul of a Codebase

> This document is the definitive reference for Unerr's indexing pipeline — the multi-stage process that transforms a git repository into a rich, queryable knowledge graph with business context, semantic embeddings, and architectural intelligence. Every feature in the product depends on the data this pipeline produces.
>
> Each stage includes implementation status, completion percentage, what's done, what's pending, and why the pending work matters.

---

## Table of Contents

1. [Why Indexing Matters](#1-why-indexing-matters)
2. [Pipeline Overview](#2-pipeline-overview)
3. [Trigger Paths](#3-trigger-paths)
4. [Stage 1: Prepare Repo Intelligence Space](#4-stage-1-prepare-repo-intelligence-space)
5. [Stage 2: SCIP Analysis (Precise Code Intelligence)](#5-stage-2-scip-analysis)
6. [Stage 3: Tree-Sitter Fallback Parsing](#6-stage-3-tree-sitter-fallback-parsing)
7. [Stage 4: Finalization & Shadow Swap](#7-stage-4-finalization--shadow-swap)
8. [Stage 5: Embedding](#8-stage-5-embedding)
9. [Stage 6: Ontology Discovery](#9-stage-6-ontology-discovery)
10. [Stage 7: Business Justification](#10-stage-7-business-justification)
11. [Stage 8: Health Report & ADR Generation](#11-stage-8-health-report--adr-generation)
12. [Stage 9: Graph Snapshot Export](#12-stage-9-graph-snapshot-export)
13. [Stage 10: Pattern Detection](#13-stage-10-pattern-detection)
14. [Incremental Indexing (Push Webhooks)](#14-incremental-indexing)
15. [Token Limits & Batch Sizes](#15-token-limits--batch-sizes)
16. [Data Model: What Gets Stored Where](#16-data-model)
17. [Feature Dependency Map](#17-feature-dependency-map)
18. [Design Principles](#18-design-principles)
19. [Overall Pipeline Status](#19-overall-pipeline-status)
20. [To Be Implemented](#20-to-be-implemented)
    - [Category L — Algorithmic Depth (Capturing the Substrate)](#category-l--algorithmic-depth-capturing-the-substrate)
21. [Validation History](#21-validation-history)

---

## 1. Why Indexing Matters

A code editor sees text. A compiler sees syntax trees. Unerr sees **meaning**.

The indexing pipeline exists to answer a question no other tool answers: *Why does this code exist?* Not what it does syntactically — any parser can tell you that — but what business problem it solves, what feature it belongs to, what would break if you changed it, and whether it follows the team's conventions.

This isn't academic. Every feature in the product draws from this understanding:

- **Semantic search** needs embeddings that encode *purpose*, not just variable names.
- **Impact analysis** needs a complete call graph with cross-file resolution.
- **Business context** needs LLM-generated justifications grounded in graph structure.
- **Rule enforcement** needs pattern data mined from the actual codebase.
- **PR reviews** need all of the above — combined, cross-referenced, and scored.
- **Local-first mode** needs a compact, serialized snapshot of the entire knowledge graph.

The pipeline runs in 10 stages. Each stage enriches the data the previous stage produced. By the end, a repository of source files has been transformed into a multi-dimensional knowledge base that an AI agent can reason about as fluently as a senior engineer who has worked in the codebase for years.

---

## 2. Pipeline Overview

```
TRIGGER (GitHub install / manual reindex / push webhook / CLI upload)
  |
  v
indexRepoWorkflow (heavy-compute-queue)
  |
  |-- [1] prepareRepoIntelligenceSpace .. Clone repo, scan files, detect languages
  |-- [2] runSCIP ....................... Precise cross-file code intelligence
  |-- [3] parseRest ..................... Tree-sitter fallback for uncovered files
  |-- [4] finalizeIndexing .............. Shadow swap, stale entity cleanup
  |-- [4b] precomputeBlastRadius ....... Fan-in/fan-out & risk level per entity
  |
  |-- (fire-and-forget children) -------+
  |                                     |
  |   [5] embedRepoWorkflow            |  (light-llm-queue)
  |     |-- Embed all entities          |  ONNX nomic-embed-text, pgvector
  |     |                               |
  |     +-> [6] discoverOntology        |  LLM extracts domain vocabulary
  |           |                         |
  |           +-> [7] justifyRepo       |  LLM assigns business purpose to every entity
  |                 |                   |
  |                 +-> [8] health      |  LLM generates health report + ADRs
  |                                     |
  |   [9] syncLocalGraph                |  Msgpack snapshot -> Supabase Storage
  |                                     |
  |   [10] detectPatterns               |  Semgrep/ast-grep pattern mining
  +-------------------------------------+
```

**Two worker queues:**

| Queue | Purpose | Examples |
|-------|---------|----------|
| `heavy-compute-queue` | CPU-bound work | Git clone, SCIP parsing, tree-sitter, Semgrep |
| `light-llm-queue` | Network-bound work | LLM calls, embedding, storage uploads, cache ops |

**Orchestration:** Temporal workflows. Each stage is a Temporal activity with heartbeats, timeouts, and retry policies. Pipeline progress is tracked in PostgreSQL (`PipelineRun` table with 11 discrete steps plus metadata) and streamed to the dashboard via SSE. Each step records start/complete/fail timestamps, enabling per-stage latency analysis and bottleneck identification.

---

## 3. Trigger Paths

### 3a. GitHub App Installation (Full Index)

User connects a repository through the GitHub App. The callback stores an `installation_id` in PostgreSQL, registers the repo in `unerr.repos`, and dispatches `indexRepoWorkflow` on `heavy-compute-queue`.

**Features that depend on this:** 1.2 GitHub App Install, 10.2 GitHub Connections.

### 3b. Manual Re-index

`POST /api/repos/[repoId]/reindex`. Two layers protect against concurrent indexing:

1. **Status check (primary guard)** — if the repo's current status is any in-progress state (`indexing`, `embedding`, `justifying`, `analyzing`), the request is rejected immediately with HTTP 409. No second pipeline can start while one is running.
2. **Fixed Temporal `workflowId`** (`reindex-{orgId}-{repoId}`, no timestamp) — Temporal itself rejects a `startWorkflow` call if a workflow with that ID is already running. This is a belt-and-suspenders server-side lock in case the status check races.
3. **Rate limit** — even when idle, capped at 1 per hour per repo (Redis key `reindex:{repoId}`).

Generates a `runId` (UUID) and `indexVersion` (UUID for shadow re-indexing). If the repo is already `"ready"`, it stays `"ready"` during re-index — users experience no downtime.

**Features that depend on this:** 9.2 Pipeline Monitor (live progress).

### 3c. GitHub Push Webhook (Incremental)

`POST /api/webhooks/github` receives a push event. HMAC-SHA256 verified. Only default-branch pushes are processed. If there's a SHA gap (`repo.lastIndexedSha !== payload.before`), a full re-index is triggered. Otherwise, `incrementalIndexWorkflow` starts with signal-with-start (see [Section 14](#14-incremental-indexing)).

**Features that depend on this:** 5.4 Architectural Drift, 9.3 Activity Feed.

### 3d. CLI Upload (Local/Non-GitHub)

`unerr push` creates a `.gitignore`-respecting zip, uploads to Supabase Storage, then triggers `indexRepoWorkflow` with `provider: "local_cli"`. The intelligence space preparation stage downloads and extracts the zip instead of cloning from GitHub.

**Features that depend on this:** 1.3 Local CLI Upload, 1.4 Ephemeral Sandbox.

---

## 4. Stage 1: Prepare Repo Intelligence Space

**Activity:** `prepareRepoIntelligenceSpace` | **Queue:** heavy-compute | **Timeout:** 30 minutes
**Source:** `lib/temporal/activities/indexing-heavy.ts`

> The name reflects what this stage creates: not a temporary workspace, but the foundational intelligence space where deep code understanding is built and stored.

### What Happens

1. **Shallow-clone the repository** to `/data/workspaces/{orgId}/{repoId}` using `container.gitHost.cloneRepo()` with `--depth 1 --single-branch` — fetches only the latest commit, avoiding multi-GB downloads for repos with long history. For CLI uploads, downloads the zip from Supabase Storage and extracts it.

2. **Get the commit SHA** via `git rev-parse HEAD`. This SHA becomes the repo's `lastIndexedSha` — used for incremental indexing SHA gap detection and displayed in the dashboard.

3. **Scan the intelligence space** via `scanWorkspace()`:
   - Runs `git ls-files --cached --others --exclude-standard` (respects `.gitignore`)
   - Falls back to `find` if git is unavailable
   - Skips known noise: `node_modules`, `.git`, `.next`, `dist`, `vendor`, `__pycache__`, lockfiles, binary files
   - Returns a flat list of `ScannedFile[]` with `relativePath`, `absolutePath`, `extension`

4. **Detect languages** via `detectLanguages()` with polyglot monorepo support:
   - Groups files by extension across 10 supported languages: TypeScript, Python, Go, Java, C, C++, C#, PHP, Ruby, Rust
   - Sorts by file count (dominant language first)
   - For monorepos, `detectLanguagePerRoot()` scans each workspace root to determine its dominant language independently — a Go backend and TypeScript frontend each get their own SCIP pass

5. **Detect monorepo roots** via `detectWorkspaceRoots()`:
   - Finds directories with their own `package.json`, `go.mod`, `pyproject.toml`, `pom.xml`, `build.gradle`
   - Maven multi-module and Gradle multi-project detection for Java monorepos

6. **Workspace cleanup** — after all downstream workflows complete (embedding, justification, pattern detection), a `cleanupWorkspaceFilesystem` activity deletes the cloned directory. A safety-net cron cleans orphaned workspaces older than 24 hours.

### What This Produces

A lightweight result containing the workspace path, detected languages (with per-root language mapping for polyglot repos), monorepo roots, and the HEAD commit SHA. Only this small payload crosses the Temporal boundary. The actual intelligence space lives on disk.

**Completion: ~97%**

**Pending:** Disk space validation before clone (P3) — if disk is nearly full, clone fails mid-write and leaves a partial workspace.

---

## 5. Stage 2: SCIP Analysis

**Activity:** `runSCIP` | **Queue:** heavy-compute | **Timeout:** 30 minutes
**Source:** `lib/temporal/activities/indexing-heavy.ts`

### What Is SCIP?

SCIP (Sourcegraph Code Intelligence Protocol) is a compiler-grade code analysis tool. Unlike regex or tree-sitter parsing, SCIP resolves types, follows imports across files, and builds a precise symbol table. It answers questions like "this variable `user` on line 47 — is it the same `User` type defined in `models/user.ts:12`?"

This precision is what makes Unerr's call graph and impact analysis reliable. Regex can guess that `foo()` calls `bar()`. SCIP *knows* it, because it resolves the full symbol path.

### What Happens

1. **Pre-check SCIP binary availability** — before running any indexer, `isSCIPBinaryAvailable()` verifies the CLI is installed. Missing binaries are surfaced to the pipeline log as warnings so users know the repo falls back to tree-sitter parsing.

2. **Run the SCIP indexer** for each detected language via a shared decoder (`lib/indexer/scip-decoder.ts`):
   - **TypeScript:** `npx @sourcegraph/scip-typescript index --output index.scip` (10-minute timeout, 100MB output buffer). Falls back gracefully if no `tsconfig.json`.
   - **Python:** `scip-python` — parsed via `parseSCIPOutput()` in the shared decoder
   - **Go:** `scip-go` — parsed via the same shared decoder
   - **Java:** `scip-java` — detects `pom.xml`/`build.gradle` project markers, parsed via the shared decoder

   The shared SCIP decoder handles all languages identically (SCIP wire format is language-agnostic). It includes buffer bounds checking at 3 critical points and per-document try-catch isolation — truncated `.scip` files produce partial results instead of crashes.

3. **Parse the SCIP output** (protobuf binary) into `ParsedEntity[]` and `ParsedEdge[]`:
   - Entities: functions, classes, interfaces, types, variables — with precise `start_line`, `end_line`, `signature`, `documentation`
   - Edges: `calls` (function → function), `imports` (file → file), `extends` (class → class), `implements` (class → interface)

4. **Fill bodies from source** via `fillBodiesFromSource()`:
   - For entities that have line numbers but no `body` text, reads the source file via encoding-aware `readFileWithEncoding()` and slices the relevant lines (capped at `MAX_BODY_LINES = 3000`)
   - Also extracts doc comments (JSDoc, docstrings, Go doc comments)

5. **Write to ArangoDB** via `writeEntitiesToGraph()`:

   a. **Bootstrap schema** — ensures all 22 document collections, 7 edge collections, and all indexes exist (idempotent via `bootstrapGraphSchema()`)

   b. **Deterministic hashing** — every entity gets a stable `_key` via SHA-256 over `(repoId, file_path, kind, name, signature)` → 16-char hex. Re-indexing the same code produces the same keys → AQL `UPSERT` updates in place.

   c. **Edge hashing** — same principle: SHA-256 over `(from_key, to_key, edge_kind)` → 16-char hex `_key`.

   d. **Auto-generated file entities** — for every `file_path` seen, a file entity is created (or upserted). `contains` edges link files to their child entities.

   e. **Bulk upsert** — `bulkUpsertEntities()` and `bulkUpsertEdges()` write to ArangoDB using `collection.import()` with `onDuplicate: "update"` in batches of 5,000.

   f. **Shadow versioning** — every entity/edge is stamped with the current `indexVersion` UUID. This enables atomic shadow swaps in Stage 4.

### What This Produces

Written to ArangoDB:
- **Entity collections:** `files`, `functions`, `classes`, `interfaces`, `variables`
- **Edge collections:** `contains`, `calls`, `imports`, `extends`, `implements`

Each entity document contains: `_key` (SHA-256 hash), `org_id`, `repo_id`, `kind` (function/class/interface/...), `name`, `file_path`, `start_line`, `end_line`, `signature`, `body` (actual source code, max 3000 lines), `documentation` (doc comments), `language`, `index_version`, and timestamps.

**Completion: ~85%**

> **Blindspot Analysis:** SCIP currently extracts only *definitions*, ignoring references. The protobuf `Occurrence.symbol_roles` field contains a reference bit that is never read — meaning cross-file call edges that SCIP could provide for free are discarded. These are not missing features — they are captured data being thrown away.

**Pending — Algorithmic Depth:**

| # | Task | Priority | TBI Ref |
|---|------|----------|---------|
| 1 | ~~SCIP two-pass decoder~~ — absorbed into L-18. Pass 2 already exists; remaining work is wiring references as `calls` edges (L-18a) | — | [TBI-L-18](#tbi-l-18-call-graph-foundation--wire-calls-edges--execution-graph) |
| 2 | ~~O(1) dedup in SCIP decoder~~ — already done (`scip-decoder.ts:38` uses `Set<string>()`) | — | — |

---

## 6. Stage 3: Tree-Sitter Fallback Parsing

**Activity:** `parseRest` | **Queue:** heavy-compute | **Timeout:** 30 minutes
**Source:** `lib/temporal/activities/indexing-heavy.ts`

### Why a Fallback Is Needed

SCIP is precise but not universal. It fails or produces nothing for:
- Config files (`tsconfig.json`, `package.json`, `.env`)
- Files without a `tsconfig.json` in their path (common in monorepos)
- Languages without a SCIP indexer (YAML, Markdown, SQL, shell scripts)
- Partial or broken source files

### What Happens

1. **Identify uncovered files** — compares the workspace file list against files that SCIP already processed.

2. **File size guard** — before reading each file, checks `statSync().size`. Files exceeding 1MB are skipped with a warning log; a bare file entity is created but no entity extraction is attempted. This prevents OOM crashes from large generated or vendored files.

3. **Encoding detection** — `readFileWithEncoding()` (`lib/indexer/file-reader.ts`) probes the first 4KB of each file: null bytes indicate binary (skipped gracefully), UTF-8 BOM is stripped, and Latin-1 fallback handles non-UTF-8 text files. No external dependencies.

4. **Parse with language plugins** — 10 language plugins extract entities via regex-based parsing:

   | Plugin | Extracts | Special Features |
   |--------|----------|-----------------|
   | **TypeScript** | functions, arrow functions, classes, interfaces, types, enums | Context-aware brace tracking (skips strings/comments/template literals), `@Decorator()` capture, import edges, signature extraction with params+return type |
   | **Python** | classes, functions, methods, decorators | Indentation-based end-line, docstring extraction, relative import edge resolution (`from .module import ...`), multi-line param assembly |
   | **Go** | functions, receiver methods, structs, interfaces, type aliases | Brace-depth end-line, Go doc comments, import edge extraction with stdlib filtering, pointer receiver `*` in signatures |
   | **Java** | classes, interfaces, enums, records, methods, constructors, fields | `extends`/`implements` edges, `member_of` edges, non-stdlib import edges, within-file call edges, JavaDoc extraction |
   | **C** | functions, structs, enums, typedefs | `#include` edges, call edges, complexity estimation |
   | **C++** | classes/inheritance, structs, enums, namespaces, methods | `#include` edges, `ClassName::method` detection |
   | **C#** | classes, interfaces, structs, records, enums, namespaces, methods | `using` import edges, `implements`/`extends` edges |
   | **PHP** | classes, interfaces, traits, enums, namespaces, methods, functions | `use` import edges, `extends`/`implements` edges |
   | **Ruby** | classes/modules, instance/class methods | `require_relative` edges, indentation-based end-line, `#` comment extraction |
   | **Rust** | structs, enums, traits, impl blocks, type aliases, modules, functions | `impl` → `implements` edges, `use crate::` edges, `///` doc comments |
   | **Generic** | bare file entities for unsupported types | — |

5. **System boundary classification** — `boundary-classifier.ts` classifies third-party imports by category (payment, database, cache, messaging, auth, cloud, monitoring, http-client, testing, ui-framework, ai-ml) with curated maps for npm (120+ packages), PyPI, Go modules, and Maven. External import edges carry `is_external`, `package_name`, and `boundary_category` metadata.

6. **Create containment edges** — `contains` edges from file entity to each extracted child entity.

7. **Heartbeat every 100 files** — prevents Temporal from timing out on large repos.

8. **Write to ArangoDB** — same `writeEntitiesToGraph()` pipeline as Stage 2.

**Completion: ~85%**

> **Blindspot Analysis:** A call graph is not an execution graph. Tree-sitter parsers only create within-file edges via regex — function calls to imported symbols never become `calls` edges. More critically, event-driven connections (`.emit()` → `.on()`), DI resolutions (interface → concrete implementation), and state mutations are **structurally invisible** to the knowledge graph. The `EdgeKind` type includes `"implements"` but no parser creates these edges. Zero `emits`, `listens_to`, or `mutates_state` edge kinds exist.

**Pending — Algorithmic Depth:**

| # | Task | Priority | TBI Ref |
|---|------|----------|---------|
| 1 | Cross-file call edge resolution — function calls to imported symbols never become `calls` edges | P1 | [TBI-L-02](#tbi-l-02-cross-file-call-edge-resolution-in-tree-sitter) |
| 2 | Call graph foundation — **L-18a:** wire SCIP references → calls (the 80/20 fix); **L-18b:** event/pub-sub, `implements`, `mutates_state` edges. THE CRITICAL GAP: topological sort uses ONLY `calls` edges, but no parser creates them | P1 | [TBI-L-18](#tbi-l-18-call-graph-foundation--wire-calls-edges--execution-graph) |
| 3 | Multi-line import parsing + Go struct/interface members | P2 | [TBI-L-04](#tbi-l-04-multi-line-import-parsing--go-structinterface-members) |
| 4 | AST-aware complexity estimation | P3 | [TBI-L-06](#tbi-l-06-ast-aware-complexity-estimation) |

---

## 7. Stage 4: Finalization & Shadow Swap

**Activity:** `finalizeIndexing` | **Queue:** light-llm | **Timeout:** 5 minutes
**Source:** `lib/temporal/activities/indexing-light.ts`

### What Happens

1. **Shadow swap** — if this is a re-index (repo was already `"ready"`), the `indexVersion` mechanism enables zero-downtime re-indexing:
   - During Stages 2–3, all new entities/edges are stamped with the current `indexVersion` UUID
   - `deleteStaleByIndexVersion()` removes all entities/edges NOT matching the current version — atomically clearing stale data from deleted files, renamed functions, or refactored classes

2. **Verify entity counts** — `verifyEntityCounts()` queries actual ArangoDB counts per collection, compares against pipeline-reported counts, logs divergence >10% as a warning, and always uses actual DB counts for the status update. Per-kind counts (files, functions, classes) are computed correctly from the combined SCIP + tree-sitter results.

3. **Update repo status** in PostgreSQL — sets `status: "indexing"`, `progress: 90`, verified entity counts, and `lastIndexedAt` timestamp.

### Step 4b: Blast Radius Pre-Computation

**Activity:** `precomputeBlastRadius` | **Queue:** light-llm | **Timeout:** 5 minutes
**Source:** `lib/temporal/activities/graph-analysis.ts`

After finalization, computes fan-in (number of callers) and fan-out (number of callees) for every entity using AQL `COLLECT` queries on the `calls` edge collection. Assigns a `risk_level` based on thresholds:

| Fan-in/Fan-out | Risk Level |
|----------------|------------|
| ≥ 10 | `"high"` |
| ≥ 5 | `"medium"` |
| < 5 | `"normal"` |

Results are written back to entity documents via `bulkUpsertEntities()` with `fan_in`, `fan_out`, and `risk_level` fields. This enables:
- **Annotated Code Viewer** — high-risk entities show red border + glow with `AlertTriangle` badge and fan-in/fan-out counts
- **Blueprint View** — confidence glow rings on feature cards
- **Entity API** — `fan_in`, `fan_out`, `risk_level` included in entity responses

**Completion: ~90%** (Step 4b Blast Radius: ~50%)

> **Blindspot Analysis (Step 4b):** Degree centrality treats `logger.info()` as the most critical entity in the system because it has the highest `fan_in`. `computeApproxCentrality()` in `graph-context-builder.ts:79-100` is explicitly labeled "approximate betweenness" but is actually degree centrality. `centrality.ts` just returns `callers.length`. True blast radius requires weighted eigenvector centrality (PageRank) with semantic edge-type weighting — `imports` for a logging library should weight 0.01, `mutates_state` to a core DB model should weight 0.9.

**Pending — Algorithmic Depth:**

| # | Task | Priority | TBI Ref |
|---|------|----------|---------|
| 1 | Preserve original entity kind through `KIND_TO_COLLECTION` — `method` → `functions` mapping loses kind distinction | P2 | [TBI-L-03](#tbi-l-03-preserve-original-entity-kind-through-kind_to_collection) |
| 2 | ~~Graph-theoretic blast radius~~ — superseded by L-19 (PageRank is the strictly superior approach) | — | [TBI-L-19](#tbi-l-19-semantic-pagerank-with-edge-type-weighting) |
| 3 | Semantic PageRank with edge-type weighting + calibrated confidence model | P1 | [TBI-L-19](#tbi-l-19-semantic-pagerank--calibrated-confidence-model) |

---

## 8. Stage 5: Embedding

**Workflow:** `embedRepoWorkflow` | **Queue:** light-llm
**Source:** `lib/temporal/workflows/embed-repo.ts`, `lib/temporal/activities/embedding.ts`

### What Happens

1. **Set status** to `"embedding"` in PostgreSQL.

2. **Fetch all file paths** from ArangoDB `files` collection.

3. **Process in batches of 5 files** (`FILES_PER_BATCH = 5`):

   a. Fetch entities per file from ArangoDB via `graphStore.getEntitiesByFile()`

   b. Build embedding text for each entity via `buildEmbeddableDocuments()` — combines entity kind, name, file path, signature, documentation, and source body into a single embedding-ready text. Skips non-code entities (`file`, `directory`, `module`, `namespace`). If justifications exist (from a previous run), enriches with `business_purpose`, `domain_concepts`, `feature_tag`. **Body truncated to 2,000 characters** (`MAX_BODY_CHARS`, ~500 tokens) to prevent ONNX quadratic attention memory blowup. Embedding tokenizer limit: **512 tokens**.

   c. **Run ONNX inference** — `nomic-embed-text-v1.5` model (768 dimensions, CPU-only, ~500MB downloaded once). Processes one document at a time (not batched — prevents OOM on large entities).

   d. **Upsert to pgvector** in sub-batches of 10 (`upsertBatchSize = 10`) with conflict-based deduplication (upsert on `entity_key`).

4. **Delete orphaned embeddings** — compares current entity keys in ArangoDB against keys in pgvector. Removes embeddings for entities that no longer exist.

5. **Set status** to `"ready"` in PostgreSQL.

### What This Produces

- **768-dimensional embedding vectors** for every code entity, stored in PostgreSQL pgvector with HNSW index
- Metadata alongside each embedding: `entity_key`, `kind`, `file_path`, `repo_id`, `org_id`

### Implementation Details

- **Embedding vector validation** — `Number.isFinite()` check on every vector before upsert. NaN/Infinity vectors are logged and skipped, protecting the HNSW index from corruption.
- **ONNX resilience** — `getEmbeddingPipeline()` retries 3× with exponential backoff (5s/15s/45s). On failure, clears the model cache directory and retries. Supports custom cache via `EMBEDDING_MODEL_CACHE_DIR`.
- **Session lifecycle management** — ONNX session rotates after 500 embed calls (configurable via `ONNX_SESSION_MAX_CALLS`). `disposeSession()` releases memory, triggers GC, and logs RSS before/after. Prevents OOM during 24h+ continuous operation.
- **Orphan cleanup** — `deleteOrphaned` is non-optional on the `IVectorSearch` port. After embedding, orphaned vectors (for entities that no longer exist in ArangoDB) are deleted with pipeline log tracking.

**Completion: ~85%**

> **Blindspot Analysis:** Entities are embedded in isolation — vector similarity cannot capture structural relationships. Graph context (callers, callees, parent module) is added only *post-search* via `enrichWithGraph()`, not during embedding generation. Additionally, all entity types use the identical embedding strategy — modules/namespaces are excluded entirely, and embedding documents include LLM-generated justification text that may contain hallucinations, polluting the embedding space.

**Pending — Algorithmic Depth:**

| # | Task | Priority | TBI Ref |
|---|------|----------|---------|
| 1 | Two-pass kind-aware embedding (Pass 1: structural before justification; Pass 2: synthesis after) | P1 | [TBI-L-07](#tbi-l-07-two-pass-kind-aware-embedding-strategies) |
| 2 | Hierarchical AST summarization with semantic anchor extraction | P1 | [TBI-L-23](#tbi-l-23-hierarchical-ast-summarization-with-semantic-anchors) |
| 3 | Dual embedding variants (code-only + semantic) with weighted combination | P2 | [TBI-L-08](#tbi-l-08-dual-embedding-variants) |
| 4 | Graph-RAG embeddings with structural fingerprint (5D vector, no Node2Vec) | P2 | [TBI-L-22](#tbi-l-22-graph-rag-embeddings-with-structural-fingerprint) |

**Features that directly depend on embeddings:** 2.1 Semantic Code Search, 2.7 Search by Purpose, 2.12 Find Similar Code, 8.4 Semantic Snippet Search, 9.4 Global Code Search.

---

## 9. Stage 6: Ontology Discovery

**Workflow:** `discoverOntologyWorkflow` | **Queue:** light-llm
**Source:** `lib/temporal/workflows/discover-ontology.ts`, `lib/temporal/activities/ontology.ts`

### What Happens

1. **Extract raw domain terms** from entity names:
   - Splits PascalCase and camelCase names: `UserAuthService` → `["User", "Auth", "Service"]`
   - Frequency-ranks terms across the entire repo
   - Filters noise (common programming terms like `get`, `set`, `handler`, `util`)

2. **Read and persist project manifests** — reads `package.json`, `pyproject.toml`, `go.mod` from the workspace path, extracting `project_name`, `project_description`, `tech_stack` (framework dependencies), and `project_domain`. Manifest data is persisted to the relational store via `updateRepoManifest()` so it survives workspace cleanup and is available to downstream stages without a live workspace.

3. **Fetch user-provided context** — if the repo has `contextDocuments` (set via `PUT /api/repos/{repoId}/context`), appends it to the project description sent to the LLM. This anchors the ontology vocabulary to the team's actual terminology (e.g., "Ledger Domain" instead of "Transaction Module").

4. **LLM refinement** — sends raw terms + project metadata to `LLM_MODELS.standard` with `DomainOntologySchema` for structured output. Falls back to raw terms if LLM fails (graceful degradation). The LLM returns:
   - **Domain terms** with definitions (e.g., "Invoice: a billing document sent to customers")
   - **Ubiquitous language map** — canonical term → aliases (e.g., "User" → ["Customer", "Account", "Member"])
   - **Term relationships** (e.g., "Invoice" → belongs_to → "Billing")

5. **Store in ArangoDB** — `domain_ontologies` collection via `graphStore.upsertDomainOntology()`.

### Implementation Details

- **Domain term extraction:** `extractDomainTerms()` in `ontology-extractor.ts` — splits entity names, frequency-ranks, filters programming stopwords
- **Manifest persistence:** `updateRepoManifest()` writes `manifestData` to `RepoRecord` in PostgreSQL, decoupling ontology from workspace lifetime
- **Context seeding:** fetches `repo.contextDocuments` from the relational store, appends to LLM project description
- **LLM refinement:** `generateObject()` with `DomainOntologySchema`, graceful fallback to raw terms on failure
- **ArangoDB storage:** `upsertDomainOntology()`

**Completion: ~85%**

> **Blindspot:** Keyword counting is not ontology mapping. `ontology-extractor.ts:38-78` splits identifiers and counts frequency but cannot differentiate "Invoice" (domain concept) from "Handler" (architectural pattern) from "Service" (framework noise). The ontology needs semantic classification with embedding similarity to cluster related terms.

**Pending:**

| Task | Priority | Ref |
|------|----------|-----|
| Three-tier ontology extraction — classify terms into domain concepts vs architectural patterns vs framework terms with cross-tier mapping | P2 | [L-25](#tbi-l-25-three-tier-ontology-extraction) |

**Features that directly depend on ontology:** 5.7 Feature Blueprint, 5.9 Domain Glossary, 2.6 Business Context, 2.9 Blueprint.

---

## 10. Stage 7: Business Justification

**Workflow:** `justifyRepoWorkflow` | **Queue:** light-llm | **Timeout:** 60 minutes
**Source:** `lib/temporal/workflows/justify-repo.ts`, `lib/temporal/activities/justification.ts`

This is the heart of the pipeline — the stage that transforms a code graph into a *knowledge* graph. Every other stage either feeds into or draws from justification data.

### What Happens

#### 10.1 Topological Sort

Before justifying anything, the pipeline sorts all entities by dependency level:

Entities are sorted into dependency levels: level 0 = leaves (utility functions, constants, types with no dependencies), ascending to level N = roots (entry points, API handlers, main functions).

**Why bottom-up?** When the LLM justifies `processPayment()`, it can see that `processPayment` calls `validateInvoice()` (already justified as "validates billing documents") and `chargeGateway()` (already justified as "charges the payment provider"). This downstream context makes the LLM's output dramatically more accurate.

Uses Kahn's algorithm with cycle-breaking. Returns `string[][]` — arrays of entity IDs per level.

#### 10.2 Justification Loop (Per Level, Parallel Chunks of 100)

For each topological level, processing bottom-up. Large levels (100+ entities) are split into parallel chunks of `PARALLEL_CHUNK_SIZE = 100`:

**a. Staleness Check**

Computes SHA-256 of the entity body and compares with the stored `body_hash` from the previous justification. If body is unchanged AND no callees changed in this level → entity is skipped entirely. Critical for re-indexing performance.

**b. Dead Code Detection**

`detectDeadCode()` — entities with zero inbound references in the `calls` edge collection are flagged as `isDeadCode`. Excludes exported functions, entry points, and test files.

**c. Graph Context Building**

`buildGraphContexts()` via `getBatchSubgraphs()` — AQL ANY traversal in batches of 50 entities, 1-5 hop depth. For each entity, fetches:
- **Callers** — inbound `calls` edges
- **Callees** — outbound `calls` edges
- **Parent** — inbound `contains` edge
- **Siblings** — other entities in the same file/class
- **Imports** — file-level import edges
- **Centrality score** — approximate degree-based (inbound caller count)

**d. Model Routing**

`routeModel()` — 3-tier routing based on safety patterns, centrality, cyclomatic complexity, caller count:

| Condition | Tier | Model | Rationale |
|-----------|------|-------|-----------|
| > 20 callers OR safety-critical patterns | `premium` | `LLM_MODELS.premium` | Hub functions — highest business impact |
| 3-20 callers | `standard` | `LLM_MODELS.standard` | Normal functions — good quality/cost balance |
| < 3 callers | `fast` | `LLM_MODELS.fast` | Leaf functions — simple, fast |

With `LLM_MODEL` set (e.g., Lightning AI `lightning-ai/gpt-oss-20b`), all tiers resolve to the same model.

**e. Dynamic Batching**

`createBatches()` uses greedy bin-packing with **dual constraints**:

1. **Input token budget** — total prompt tokens must not exceed `maxInputTokens` (70% of model context window)
2. **Output token budget** — total expected output must not exceed `maxOutputTokens`

See [Section 15: Token Limits & Batch Sizes](#15-token-limits--batch-sizes) for exact numbers per model.

Oversized entities (exceeding the budget alone) go solo. Max entities per batch: **15** (`maxEntitiesPerBatch`).

**f. Prompt Construction**

`buildJustificationPrompt()` builds a rich prompt per entity. Body truncation varies by model tier:

| Tier | Max Body Chars |
|------|---------------|
| `fast` | 4,000 chars |
| `standard` | 8,000 chars |
| `premium` | 12,000 chars |

The prompt includes: entity metadata, source code body, graph context (callers, callees, siblings), parent justification, callee justifications, ontology terms, heuristic hints, test context, and **user-provided context documents** (if available via context seeding, truncated to 3,000 chars in the prompt).

For multi-entity batches, `buildBatchJustificationPrompt()` asks the LLM to return one JSON result per entity.

**g. LLM Call with Retry**

Calls `llmProvider.generateObject()` with the routed model, `JustificationResultSchema` for structured output, the built prompt, system prompt, and `temperature: 0.1`.

Retry strategy with `BATCH_BACKOFF_DELAYS = [2s, 8s, 30s]`:
1. On rate limit (429, 503, "overloaded"): exponential backoff (2s → 8s → 30s)
2. On batch failure: falls back to individual entity prompts
3. On individual failure: creates a fallback justification with `taxonomy: "UTILITY", confidence: 0.3`

**h. Quality Scoring**

`scoreJustification()` — checks for boilerplate phrases, vague language, minimum description length. Flags low-quality outputs.

**i. Chain-of-Thought Logging**

After each entity is justified, a human-readable summary is emitted to the pipeline log via `createPipelineLogger()`: `"Analyzed {name}. Tagged as {taxonomy} ({confidence}%) — {businessPurpose (truncated to 100 chars)}"`. These log entries appear live in the Pipeline Monitor during justification, making the AI's reasoning visible in real time.

**j. Write to ArangoDB**

`bulkUpsertJustifications()` — bi-temporal: sets `valid_to` on old justifications before inserting new ones. Each document contains: `entity_id` (references the entity `_key`), `taxonomy` (VERTICAL/HORIZONTAL/UTILITY), `feature_tag` (e.g., "Payment Processing"), `business_purpose` (1-2 sentence explanation), `domain_concepts` (array of ontology terms), `confidence` (0.0-1.0), `semantic_triples` (subject/predicate/object relationships), `compliance_tags`, `reasoning`, `body_hash` (SHA-256 for staleness detection), `model` (which LLM produced this), and bi-temporal `valid_from`/`valid_to` timestamps.

#### 10.3 Ontology Refinement (Every 20 Levels)

Collects `domain_concepts` from all justifications so far. Concepts appearing **3+ times** that aren't already in the ontology are added (up to **50 new terms per refinement**). The ontology grows as the pipeline discovers the codebase's domain vocabulary.

#### 10.4 Context Propagation

`propagateContextActivity()` — after all entities are justified, a bi-directional propagation pass:
- Parent feature tags and domain concepts propagate to children
- Commonly-occurring child concepts propagate up to parents
- Smooths out inconsistencies where sibling functions got different feature tags

#### 10.5 Feature Aggregation

`storeFeatureAggregations()` — groups entities by `feature_tag`:
- How many entities? Which types? (functions, classes, files)
- Taxonomy breakdown (VERTICAL/HORIZONTAL/UTILITY)
- Entry point detection (high fan-in + exported symbols via BFS hot path finding)
- Stored in ArangoDB `features_agg` collection

#### 10.6 Justification Embedding

`embedJustifications()` — builds rich embedding text per justification:
- Entity name, kind, file, taxonomy, business_purpose, domain_concepts, feature_tag, reasoning, compliance_tags, semantic_triples, body snippet
- **Text capped at 1,500 chars** to keep embedding focused
- **Body snippet capped at 500 chars** within that
- Embeds in **chunks of 20**
- Stores in dedicated `justification_embeddings` pgvector table

### Implementation Details

- **Topological sort:** Kahn's algorithm with cycle-breaking in `topological-sort.ts`
- **Staleness check:** SHA-256 body hash comparison; callee changes tracked via accumulated `accumulatedChangedIds` across ALL prior levels (capped at 5,000 entries), so entities at level N detect staleness from any earlier level — not just the immediately prior level
- **Heuristic bypass:** entities with `confidence ≥ 0.9` and 0 inbound callers skip LLM entirely with canned justification (`model_tier: "heuristic"`), saving 20-40% of LLM calls for pure-utility entities
- **Dead code detection:** zero-inbound-reference check, excludes exports/tests/entry points
- **Graph context building:** `getBatchSubgraphs()` — AQL ANY traversal, batches of 50, 1-5 hops
- **Model routing:** 3-tier routing by centrality, complexity, caller count, safety patterns
- **Dynamic batching:** greedy bin-packing with dual input/output token constraints
- **Prompt builder:** entity-specific templates with body truncation by tier; includes git history (up to 10 recent commits per file via `getFileGitHistory()`), entity warnings from the ledger, user-provided context documents (truncated to 3,000 chars), and ontology terms
- **Context seeding:** users paste docs before indexing via `PUT /api/repos/{repoId}/context`; injected into ontology and justification prompts as "Project Context (provided by the team)" section
- **Chain-of-thought logging:** per-entity reasoning logged via `createPipelineLogger()`, visible live in Pipeline Monitor
- **Negative knowledge:** `entity_warnings` ArangoDB collection fed by anti-pattern synthesis; graph context builder injects warnings into subgraph summaries for LLM prompts; MCP `get_function`/`get_class` return warnings in response
- **Context propagation:** bi-directional feature tag + domain concept propagation (parent→child, frequent child→parent)
- **Justification embedding:** 1,500-char cap, chunks of 20, dedicated `justification_embeddings` pgvector table
- **Drift documentation:** when semantic drift is detected, `proposeDriftDocumentation` generates updated classification + ADR draft, stored in `documentation_proposals` collection
- **UNERR_CONTEXT.md export:** auto-generated context file with download route and celebration modal

**Completion: ~88%**

> **Alpha-3 additions:** Community detection (L-21) runs as Step 4b before justification, writing `community_id` and `community_label` onto entities. Signal-aware prompts (L-20 Part A) restructure the prompt into STRUCTURAL SIGNAL and INTENT SIGNAL sections. Test assertion extraction (L-16) fixed to parse `describe/it/test` blocks from entity body text and traverse `imports`/`references` edges.
>
> **Remaining blindspot:** Frequency-based propagation assigns utility functions the tag of their most frequent caller, not their purpose. The fix is intent-aware hermeneutic propagation (L-20 Part B): once entry points are reached, push their semantic context back down, weighted by graph distance.

**Pending:**

| Task | Priority | Ref |
|------|----------|-----|
| Semantic staleness — change-type aware cascading (signature → always, comment → never, body → cosine check) | P2 | [L-09](#tbi-l-09-semantic-staleness-change-type-aware-cascading) |
| ~~AST-aware body truncation~~ — superseded by L-23 (hierarchical AST summarization with semantic anchors) | — | [L-23](#tbi-l-23-hierarchical-ast-summarization) |
| Quality scoring with positive reinforcement — reward high-quality outputs, not just penalize | P3 (deferred) | [L-11](#tbi-l-11-quality-scoring-with-positive-reinforcement) |
| Parse test assertions as intent source — feeds into L-20's unified intent signal (`intent.from_tests[]`) | P2 | [L-16](#tbi-l-16-parse-test-assertions-as-intent-source) |
| Community detection as pre-justification signal — Louvain runs before LLM calls, community membership in prompt (moved from Stage 10) | P2 | [L-21](#tbi-l-21-community-detection-as-pre-justification-signal) |
| Unified intent signal extraction + hermeneutic propagation — 4 sources (tests, entry points, commits, naming), signal-aware prompts | P1 | [L-20](#tbi-l-20-unified-intent-signal-extraction--hermeneutic-propagation) |

**Features that directly depend on justification:** 2.6 Business Context, 2.7 Search by Purpose, 2.8 Impact Analysis, 2.9 Blueprint, 2.10 Convention Guide, 2.11 Suggest Approach, 5.1 Health Report, 5.2 Prioritized Issues, 5.4 Drift, 5.7 Feature Blueprint, 5.8 ADRs, 7.1 PR Review, 7.3 Inline Comments, 7.5 Debate the Bot.

---

## 11. Stage 8: Health Report & ADR Generation

**Workflow:** `generateHealthReportWorkflow` | **Queue:** light-llm
**Source:** `lib/temporal/activities/health-report.ts`, `lib/temporal/activities/adr-generation.ts`

### What Happens

#### 11.1 Health Report

Aggregates data from the graph + justifications to score the repo across 13 risk categories:

| Category | What It Measures | Data Source |
|----------|-----------------|-------------|
| `dead_code` | Functions nothing calls | `calls` edges (fan-in = 0) |
| `circular_deps` | Dependency cycles | AQL cycle detection on `calls` |
| `high_fan_in` | Hub functions (risky to change) | `calls` edge count |
| `high_fan_out` | God functions (too many deps) | `calls` edge count |
| `naming_inconsistency` | Mixed naming conventions | Entity names + patterns |
| `missing_tests` | Code without test coverage | File path heuristics + `calls` edges |
| `complexity` | High cyclomatic/cognitive complexity | AST analysis metrics |
| `architecture_violation` | Cross-boundary dependencies | Taxonomy + `calls` edges |
| `api_contract` | Inconsistent API patterns | Entity signatures + patterns |
| `env_validation` | Missing env var validation | AST patterns |
| `state_lifecycle` | Missing cleanup (listeners, intervals) | AST patterns |
| `idempotency` | Non-idempotent operations | Pattern detection |
| `rate_limiting` | Missing rate limits on endpoints | Pattern detection |

Each category gets a 0-100 score. The overall health score is a weighted average. The LLM writes a narrative explanation with specific entity references.

#### 11.2 ADR Synthesis

Analyzes the codebase for architectural patterns with high adherence rates. Only features with **3+ entities** qualify. Capped at **10 features** per synthesis run. Generates Architecture Decision Records with structured fields: decision, context, evidence (specific entity references), and consequences.

### Implementation Details

- **Health report builder:** LLM-generated narrative across 13 risk categories with a null guard — when all justifications are fallback stubs (`confidence < 0.5`, `feature_tag == "unclassified"`), the builder detects this and writes a specific error state instead of null metrics
- **ADR synthesis:** LLM prompt with feature + justification data; features with 3+ entities qualify, capped at 10 per run; includes a guard that detects 0 valid features and skips generation
- **Merge significance assessment:** checks index events, feature timestamps, boundary files
- **ADR PR creation:** creates branch, file, and PR via `gitHost`
- **Rewind→rule tracing:** `markLedgerEntryRuleGenerated()` on `IGraphStore` port — called after `upsertRule` in `synthesizeAntiPatternRule`, sets `rule_generated: true`, `rule_id`, and `rule_generated_at` on the ledger entry, closing the tracing loop
- **Entity warnings:** anti-pattern synthesis creates `EntityWarningDoc` entries (up to 50) in the `entity_warnings` collection, surfacing negative knowledge from the prompt ledger
- **UNERR_CONTEXT.md:** auto-generated context document with download route and celebration modal in the UI

**Completion: ~95%**

**Pending:**

| Task | Priority | Ref |
|------|----------|-----|
| (No Category L items target this stage directly) | — | — |

**Features that directly depend on health/ADRs:** 5.1 Health Report, 5.2 Prioritized Issues, 5.8 Architecture Decision Records, 2.9 Blueprint.

---

## 12. Stage 9: Graph Snapshot Export

**Workflow:** `syncLocalGraphWorkflow` | **Queue:** light-llm
**Source:** `lib/temporal/workflows/sync-local-graph.ts`, `lib/temporal/activities/graph-export.ts`, `lib/temporal/activities/graph-upload.ts`

### What Happens

1. **Query and compact** all entities + edges from ArangoDB:
   - Compacts each entity to minimal fields: `key`, `kind`, `name`, `file_path`, `signature`, `language`
   - Fetches all edges in a single `getAllEdges()` call with in-memory dedup, paginated at 20,000 edges per page (safety cap at 200,000) — replacing the previous O(N) per-entity query pattern
   - Fetches active rules (max 200) and confirmed patterns (evidence capped at 5 exemplars per pattern)
   - Granular heartbeats every 50 files in the entity collection loop; `heartbeatTimeout` set to 5 minutes for large-repo tolerance

2. **Serialize** via `serializeSnapshotChunked()` — processes entities in batches of 1,000, frees each chunk after serialization via `splice(0, chunkSize)`, and logs pre/post memory usage. Repos with >5,000 entities automatically use chunked mode with per-chunk heartbeats. Output is msgpack binary + SHA-256 checksum (typically 5-20x smaller than JSON).

3. **Upload** to Supabase Storage bucket `graph-snapshots` at path `{orgId}/{repoId}.msgpack` (upsert mode). Bulk import available for large datasets.

4. **Record metadata** in PostgreSQL via Prisma: `status: "available"`, `checksum`, `sizeBytes`, `entityCount`, `edgeCount`, `generatedAt`.

5. **Notify clients** via Redis key `graph-sync:{orgId}:{repoId}` (TTL 1 hour). The CLI polls this key to know when to pull.

### Implementation Details

- **Batch edge fetching:** single `getAllEdges()` AQL query with pagination and dedup (was O(N) per-entity `getCalleesOf()`)
- **Heartbeats:** every 50 entities during collection, per-chunk during serialization; timeout increased to 5m
- **Chunked serialization:** `serializeSnapshotChunked()` in `graph-serializer.ts` — memory-efficient for large repos
- **Status transitions:** `generating` → `available` (or `failed` with error recorded)

**Completion: ~98%**

**Pending:**

| Task | Priority | Ref |
|------|----------|-----|
| (No Category L items target this stage directly) | — | — |

**Features that directly depend on snapshots:** 3.4 Local-First Mode, all CLI-side tools that work offline.

---

## 13. Stage 10: Pattern Detection

**Workflow:** `detectPatternsWorkflow` | **Queue:** heavy-compute
**Source:** `lib/temporal/activities/anti-pattern.ts`, `lib/temporal/activities/pattern-detection.ts`, `lib/temporal/activities/pattern-mining.ts`

### What Happens

The pattern detection system has three components:

1. **Anti-pattern rule synthesis** (`anti-pattern.ts`) — triggered after a rewind action (Feature 4.3). Fetches reverted ledger entries, builds an LLM prompt, generates a rule from what went wrong. Stores in ArangoDB `rules` collection.

2. **Pattern detection** (`pattern-detection.ts`) — runs structural pattern matching via the Semgrep adapter (`lib/adapters/semgrep-pattern-engine.ts`). 23 built-in detectors covering: N+1 queries, empty catch blocks, missing cleanup, hardcoded credentials, etc. Evidence limited to **10 matches per pattern**, snippets capped at **200 chars**.

3. **Pattern mining** (`pattern-mining.ts`) — discovers conventions from entity names and structures. Entity keys per pattern capped at **100**.

### Implementation Details

- **Anti-pattern rule synthesis:** LLM-generated rules from reverted ledger entries; after `upsertRule`, `markLedgerEntryRuleGenerated()` writes `rule_generated: true`, `rule_id`, and `rule_generated_at` back to the ledger entry, closing the rewind→rule tracing loop
- **Anti-pattern vectorization:** embeds rule description, searches for matching entities (cosine > 0.75)
- **Pattern detection (Semgrep):** structural matching via `semgrep-pattern-engine.ts` adapter; 23 built-in detectors
- **Pattern mining:** frequency-based convention discovery; Louvain community detection in `pattern-mining.ts`
- **Conventions export:** `conventions-generator.ts` synthesizes patterns + rules into `TEAM_CONVENTIONS.md` or `.cursorrules` format via `GET /api/repos/{repoId}/export/conventions?format=markdown|cursorrules`; rules categorized by enforcement level (MUST/SHOULD/MAY), patterns grouped by type with adherence %

**Completion: ~70%**

> **Blindspot:** Louvain community detection exists in `pattern-mining.ts` but is used only for pattern mining. Community detection has been moved to a pre-justification signal (L-21, Alpha-3) — communities now inform LLM prompts during justification, not just pattern discovery. Convention mining (L-13) scopes by community for community-local patterns.

**Pending:**

| Task | Priority | Ref |
|------|----------|-----|
| Code-first convention discovery — structural patterns found from code, named by LLM, scoped by Louvain community | P2 | [L-13](#tbi-l-13-code-first-convention-discovery) |
| ~~Spectral graph partitioning~~ — L-21 moved to Stage 7 (pre-justification signal). Community detection now runs before LLM justification calls. | — | [L-21](#tbi-l-21-community-detection-as-pre-justification-signal) |

**Features that directly depend on patterns:** 6.1 Auto-Detected Patterns, 6.2 Custom Rules, 6.5 Pattern-to-Rule Promotion, 6.6 Rule Check, 6.7 Anti-Pattern Detection, 7.1 PR Review (pattern check), 2.10 Convention Guide.

---

## 14. Incremental Indexing

**Workflow:** `incrementalIndexWorkflow` | **Queue:** heavy-compute (workflow), mixed queues for activities
**Source:** `lib/temporal/workflows/incremental-index.ts`

Triggered by GitHub push webhooks. Uses Temporal's signal-with-start pattern with a fixed workflow ID per repo (`incremental-{orgId}-{repoId}`).

### Signal Debouncing

The workflow waits **60 seconds** (configurable via `DEBOUNCE_QUIET_PERIOD`) for additional `pushSignal` signals before processing. Rapid-fire pushes collapse into a single indexing run processing the latest SHA.

### Steps

| Step | Queue | What Happens |
|------|-------|--------------|
| 1. `pullAndDiff` | heavy | `git pull` + `git diff` → list of changed files |
| 2. Fallback guard | — | If >200 files changed (`INCREMENTAL_FALLBACK_THRESHOLD`) → fires `startChild(indexRepoWorkflow)` with `ParentClosePolicy.ABANDON` for automatic full re-index |
| 3. `reIndexBatch` | heavy | Re-parse changed files (batches of 5) with quarantine wrapping; healed files detected via `shouldHealQuarantine()` and quarantine placeholders removed |
| 4. `applyEntityDiffs` | light | Delete entities for removed files |
| 5. `repairEdgesActivity` | light | Re-resolve edges referencing changed entities; collects broken endpoints for updated entities and calls `batchDeleteEdgesByEntity()` |
| 6. `updateEmbeddings` | light | Re-embed changed entities only (delta) |
| 7. `cascadeReJustify` | light | Re-justify entities whose dependencies changed — uses `getBatchSubgraphs()` for targeted N-hop subgraph fetch (max `CASCADE_MAX_HOPS = 2`, max `CASCADE_MAX_ENTITIES = 50`) |
| 8. `refreshContextDocuments` | light | Regenerates `UNERR_CONTEXT.md` and agent config files to reflect structural changes |
| 9. `proposeDriftDocumentation` | light | When semantic drift is detected, generates updated classification + ADR draft in `documentation_proposals` collection |
| 10. `invalidateCaches` | light | Exhaustive Redis cache clearing — 7 exact-key patterns + prefix-based `invalidateByPrefix()` via non-blocking `SCAN` (covers topo levels, justify-changed, search results, prefetch contexts, rules) |
| 11. `writeIndexEvent` | light | Record event in ArangoDB `index_events` |
| 12. `finalizeIndexing` | light | Update PostgreSQL status |

### Cascade Re-Justification

When `processPayment()` changes, its callers (`checkout()`, `retryBilling()`) may now have stale justifications. The cascade uses `getBatchSubgraphs()` + `getEdgesForEntities()` + per-entity `getJustification()` for targeted subgraph fetching (no full-repo graph load). Justification embedding text is capped at 1,500 chars total, with body snippet at 500 chars.

### Implementation Details

- **Signal debouncing:** 60s quiet period via `condition()` loop; rapid-fire pushes collapse into single run
- **Fallback to full re-index:** when >200 files change, automatically starts a fire-and-forget `indexRepoWorkflow` child workflow
- **Quarantine healing:** after successful re-parse, `shouldHealQuarantine()` detects healed files and `batchDeleteEntities()` removes quarantine placeholders by their deterministic hash IDs
- **Edge repair:** updated-entity block collects broken endpoints and calls `batchDeleteEdgesByEntity()`; short-circuited when `deletedKeys` is empty
- **Cache invalidation:** exhaustive exact keys (7 patterns) + prefix-based `invalidateByPrefix()` on `ICacheStore`; non-blocking `SCAN`-based Redis implementation
- **Context refresh:** regenerates living documentation after structural changes
- **Drift documentation:** proposes ADR drafts when entity taxonomy/purpose diverges from prior classification

**Completion: ~95%**

**Pending:**

| Task | Priority | Ref |
|------|----------|-----|
| Incremental entity count recomputation — counts not recomputed after incremental update (`fileCount: 0, functionCount: 0, classCount: 0` passed to finalize) | P3 | [L-27](#tbi-l-27-incremental-entity-count-recomputation) |

**Features that directly depend on incremental indexing:** Real-time graph freshness after every push, MCP tool accuracy, PR review data currency.

---

## 15. Token Limits & Batch Sizes

### Entity Extraction Limits

| Limit | Value | Where |
|-------|-------|-------|
| Max body lines per entity (extraction) | **3,000 lines** | `lib/indexer/types.ts` → `MAX_BODY_LINES` |
| Max body lines per entity (graph snapshot) | **50 lines** | `lib/use-cases/graph-compactor.ts` |
| Max body chars per entity (embedding) | **2,000 chars** (~500 tokens) | `lib/temporal/activities/embedding.ts` → `MAX_BODY_CHARS` |
| Embedding tokenizer limit | **512 tokens** | `EMBEDDING_MAX_TOKENS` |
| MCP response body truncation | **2,000 bytes** | `lib/mcp/formatter.ts` |

### Justification Prompt Limits

| Limit | Value | Where |
|-------|-------|-------|
| Body chars — `fast` tier | **4,000 chars** | `lib/justification/prompt-builder.ts` |
| Body chars — `standard` tier | **8,000 chars** | `lib/justification/prompt-builder.ts` |
| Body chars — `premium` tier | **12,000 chars** | `lib/justification/prompt-builder.ts` |
| Justification embedding text cap | **1,500 chars** | `lib/temporal/activities/justification.ts` |
| Body snippet in justification embedding | **500 chars** | `lib/temporal/activities/justification.ts` |
| Semantic triples in embedding | **5 max** | `lib/temporal/activities/justification.ts` |

### Dynamic Batcher Configuration

Default config (`lib/justification/dynamic-batcher.ts`):

| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxInputTokens` | **7,000** (or 70% of model context window) | Max prompt tokens per batch |
| `maxOutputTokens` | **8,192** (or model's `maxOutput`) | Max LLM response tokens |
| `maxEntitiesPerBatch` | **15** | Hard cap on entities per LLM call |
| `systemPromptTokens` | **500** | Reserved for system prompt |
| `outputTokensPerEntity` | **200** | Reserved output tokens per entity |
| `safetyMargin` | **0.85** (85%) | Never fill more than 85% of budget |

Token estimation: **~3.5 chars per token** (conservative for code).

Entity tokens in batch mode include: header (25 tokens) + name/kind/path + signature + body (truncated to **10 lines** for batch) + neighbor summary (top **5** neighbors).

**Per-model resolved config** (via `getBatcherConfigForModel()`):

| Model | Context Window | maxInputTokens (70%) | maxOutput |
|-------|---------------|---------------------|-----------|
| `gemini-2.0-flash` | 1,048,576 | 734,003 | 8,192 |
| `gemini-2.0-flash-lite` | 1,048,576 | 734,003 | 8,192 |
| `gpt-4o-mini` | 128,000 | 89,600 | 16,384 |
| `gpt-4o` | 128,000 | 89,600 | 16,384 |
| `claude-sonnet-4-20250514` | 200,000 | 140,000 | 8,192 |
| `qwen3:8b` (Ollama) | 40,960 | 28,672 | 4,096 |
| `qwen3-coder` (Ollama) | 262,144 | 183,500 | 8,192 |
| `lightning-ai/gpt-oss-20b` | 32,000 | 22,400 | 4,096 |
| Fallback (unknown model) | 32,000 | 22,400 | 4,096 |

### Retry & Rate Limiting

| Parameter | Default | Env Var |
|-----------|---------|---------|
| Batch backoff delays | **2s → 8s → 30s** | Hardcoded in `justification.ts` |
| Max retry attempts (provider-level) | **5** | `LLM_RETRY_MAX_ATTEMPTS` |
| Base retry delay (provider-level) | **1,000ms** | `LLM_RETRY_BASE_DELAY_MS` |
| Requests per minute | **15** | `LLM_RPM_LIMIT` |
| Tokens per minute | **1,000,000** | `LLM_TPM_LIMIT` |

### Pipeline Batch Sizes

| Stage | Batch Size | Where |
|-------|-----------|-------|
| ArangoDB bulk upsert | **1,000 entities** | `arango-graph-store.ts` → `collection.import()` |
| Embedding file batches | **5 files per batch** | `embed-repo.ts` → `FILES_PER_BATCH` |
| Embedding pgvector upsert | **10 vectors per sub-batch** | `embedding.ts` → `upsertBatchSize` |
| Justification parallel chunks | **100 entities per chunk** | `justify-repo.ts` → `PARALLEL_CHUNK_SIZE` |
| Justification embedding chunks | **20 per chunk** | `justification.ts` → `embedJustifications()` |
| Ontology refinement frequency | **Every 20 levels** | `justify-repo.ts` |
| Ontology new terms per refinement | **50 max** | `justification.ts` → `refineOntologyWithNewConcepts()` |
| Incremental index file batch | **5 files per batch** | `incremental-index.ts` → `batchSize` |
| Cascade max hops | **2** | `CASCADE_MAX_HOPS` env var |
| Cascade max entities | **50** | `CASCADE_MAX_ENTITIES` env var |
| Graph context subgraph batches | **50 entities** | `arango-graph-store.ts` → `getBatchSubgraphs()` |
| Graph context neighbor summary | **5 neighbors max** | `dynamic-batcher.ts` → `estimateEntityTokens()` |
| Graph export max edges | **20,000** | `arango-graph-store.ts` → `getAllEdges()` default limit |
| Graph export max rules | **200** | `graph-export.ts` |
| Pattern evidence max | **10 matches** | `pattern-detection.ts` |
| Pattern evidence snippet | **200 chars** | `pattern-detection.ts` |
| ADR max features | **10** | `adr-synthesizer.ts` |
| ADR min entities per feature | **3** | `adr-synthesizer.ts` |
| Drift alert max callers | **20** | `drift-alert.ts` |

---

## 16. Data Model

### What Gets Stored Where

| Store | Collection/Table | Written By | Read By |
|-------|-----------------|------------|---------|
| **ArangoDB** | `files` | Stages 2, 3 | All code intelligence tools |
| | `functions` | Stages 2, 3 | Call graph, search, impact |
| | `classes` | Stages 2, 3 | Inheritance, search |
| | `interfaces` | Stages 2, 3 | Implements, search |
| | `variables` | Stages 2, 3 | Search, entity browser |
| | `contains` (edge) | Stages 2, 3 | File → entity navigation |
| | `calls` (edge) | Stages 2, 3 | Call graph, impact, dead code |
| | `imports` (edge) | Stages 2, 3 | Import chain analysis |
| | `extends` (edge) | Stage 2 | Inheritance analysis |
| | `implements` (edge) | Stage 2 | Interface analysis |
| | `domain_ontologies` | Stage 6 | Justification prompts, glossary |
| | `justifications` | Stage 7 | Business context, search by purpose |
| | `features_agg` | Stage 7 | Feature blueprint |
| | `health_reports` | Stage 8 | Health report, issues |
| | `adrs` | Stage 8 | Architecture decisions, blueprint |
| | `mined_patterns` | Stage 10 | Auto-detected patterns |
| | `rules` | Stage 10 | Rule enforcement, conventions |
| | `index_events` | Incremental | Activity feed |
| | `drift_scores` | Stage 7 (compare) | Drift tracking |
| | `token_usage_log` | Stage 7 | Billing, usage tracking |
| **PostgreSQL** | `unerr.repos` (incl. `context_documents`) | Stages 4, 4b, 5, 6, 7 | Dashboard, status display, context seeding |
| | `embeddings` (pgvector) | Stage 5 | Semantic search, find similar |
| | `justification_embeddings` (pgvector) | Stage 7 | Search by purpose |
| | `unerr.PipelineRun` | All stages | Pipeline monitor |
| | `unerr.GraphSnapshotMeta` | Stage 9 | CLI pull, snapshot status |
| **Supabase Storage** | `graph-snapshots/{org}/{repo}.msgpack` | Stage 9 | CLI pull, local-first mode |
| **Redis** | `pipeline-logs:{repoId}` | All stages | Live pipeline log streaming |
| | `graph-sync:{orgId}:{repoId}` | Stage 9 | CLI polling for new snapshots |
| | `prefetch:{repoId}:*` | Invalidated by incremental | Pre-fetch cache for MCP tools |

---

## 17. Feature Dependency Map

Every shipped feature in `FEATURES.md` depends on one or more pipeline stages. This map shows which stages must succeed for each feature category to work.

### Without Stages 1-3 (no graph), nothing works.

| Feature Category | Required Stages | Why |
|-----------------|----------------|-----|
| **2.1 Semantic Search** | 1-3 (entities), 5 (embeddings) | Needs entity embeddings in pgvector for cosine similarity |
| **2.2 Function/Class Lookup** | 1-3 (entities) | Direct entity fetch from ArangoDB by key/name/location |
| **2.3 Call Graph Traversal** | 1-2 (SCIP edges) | AQL traversal on `calls` edge collection |
| **2.4 Import Chain Analysis** | 1-2 (SCIP edges) | AQL traversal on `imports` edge collection |
| **2.5 Project Stats** | 1-3 (entities) | Aggregate counts from entity collections |
| **2.6 Business Context** | 1-3, 6, 7 (justification) | Fetches justification document for entity |
| **2.7 Search by Purpose** | 1-3, 6, 7 (justification embeddings) | Cosine search on `justification_embeddings` pgvector |
| **2.8 Impact Analysis** | 1-2 (edges), 7 (justification) | Graph traversal + business context enrichment |
| **2.9 Blueprint** | 1-3, 6, 7, 8 (everything) | Aggregates features, health, ADRs into one view |
| **2.10 Convention Guide** | 1-3, 10 (patterns/rules) | Merges active rules with detected patterns |
| **2.11 Suggest Approach** | 1-3, 5, 7, 10 | Combines search, rules, conventions, justifications |
| **2.12 Find Similar Code** | 1-3, 5 (embeddings) | Cosine similarity between entity embeddings |
| **3.1-3.3 Live Coding** | 1-3 (base graph) | Overlay on top of committed graph |
| **3.4 Local-First Mode** | 1-3, 9 (snapshot) | Downloads and loads msgpack snapshot |
| **4.1-4.6 Prompt Ledger** | 1-3 (entity references) | Ledger entries reference entities by key |
| **5.1 Health Report** | 1-3, 7, 8 | LLM analysis of graph + justifications |
| **5.2 Prioritized Issues** | 1-3, 7, 8 | Extracted from health report with fix prompts |
| **5.3 Dead Code Detection** | 1-2 (edges) | Fan-in = 0 query on `calls` edges |
| **5.4 Architectural Drift** | 1-3, 7 (justification diffs) | Compares justification embeddings across runs |
| **5.5 Circular Dependencies** | 1-2 (edges) | Cycle detection on `calls` edges |
| **5.6 Fan-In/Fan-Out** | 1-2 (edges) | Degree centrality on `calls` edges |
| **5.7 Feature Blueprint** | 1-3, 6, 7 (features_agg) | Groups entities by feature_tag from justifications |
| **5.8 ADRs** | 1-3, 7, 8 (ADR generation) | LLM-generated from patterns + justifications |
| **5.9 Domain Glossary** | 1-3, 6 (ontology) | Directly from `domain_ontologies` collection |
| **6.1-6.7 Rules & Patterns** | 1-3, 10 (pattern detection) | Semgrep/ast-grep analysis + LLM synthesis |
| **7.1-7.5 PR Review** | 1-3, 7, 10 (graph + rules) | Combines impact analysis, pattern checks, justification |
| **8.1-8.4 Snippets** | 1-3, 5 (embeddings) | Entity extraction + semantic search |
| **9.1 Entity Graph Viz** | 1-3 (entities + edges) | React Flow renders ArangoDB graph data |
| **9.2 Pipeline Monitor** | Pipeline run tracking | SSE streams from PostgreSQL + Redis |
| **9.3 Activity Feed** | Incremental (index_events) | `index_events` collection in ArangoDB |
| **9.4 Global Search** | 1-3, 5 (embeddings) | Cross-repo pgvector search |
| **9.5 Entity Browser** | 1-3, 7 (entities + justifications) | Paginated ArangoDB query with justification join |

### The Critical Chain

```
Stages 1-3 (Graph)  ──→  Everything
Stage 5 (Embedding)  ──→  All search features
Stage 6 (Ontology)   ──→  Justification quality
Stage 7 (Justify)    ──→  Business intelligence features
Stage 8 (Health)     ──→  Quality analysis features
Stage 9 (Snapshot)   ──→  Local-first / offline features
Stage 10 (Patterns)  ──→  Rules & enforcement features
```

---

## 18. Design Principles

### 18.1 Heavy Data Stays in the Store

Temporal has a 2MB payload limit per activity result. The pipeline never passes entity bodies, source code, or embeddings through Temporal. Instead:
- Activities read from and write to ArangoDB/PostgreSQL directly
- Only counts, IDs, and small metadata cross the Temporal boundary
- This allows repos with 100,000+ entities to index without hitting payload limits

### 18.2 Deterministic Hashing for Idempotent Upserts

Every entity and edge key is a SHA-256 hash of its identity fields. Re-indexing the same code produces the same keys. This means:
- No duplicate entities after re-indexing
- `UPSERT` operations update in-place rather than inserting
- Cross-referencing between pipeline stages works by key

### 18.3 Staleness Detection Avoids Redundant LLM Calls

Justification stores a `body_hash` (SHA-256 of the entity's source code). On subsequent runs, unchanged entities are skipped entirely. On a typical incremental push affecting 10 files in a 5,000-entity repo, this saves 95%+ of LLM calls.

### 18.4 Shadow Re-Indexing for Zero Downtime

During re-indexing, new entities are written with a fresh `indexVersion` (UUID). The old graph remains fully queryable. Only after all new entities are written does the finalization step run `deleteStaleByIndexVersion()` to remove old-version entities and `verifyEntityCounts()` to confirm consistency. Users never see a partially indexed repo.

### 18.5 Bottom-Up Justification for Contextual Accuracy

Topological sort ensures callees are justified before callers. Each entity's prompt includes its callees' justifications as context. This cascading context propagation is what makes Unerr's business justifications dramatically more accurate than flat, entity-by-entity analysis.

### 18.6 Separation of Compute and Network

Heavy-compute activities (git clone, SCIP, Semgrep) run on `heavy-compute-queue` workers with high CPU/memory. Network-bound activities (LLM calls, embedding, storage uploads) run on `light-llm-queue` workers. This prevents a large SCIP indexing job from blocking LLM calls for other repos.

### 18.7 Graceful Degradation

Every stage has fallback behavior:
- SCIP fails → tree-sitter fallback covers the files
- Tree-sitter fails → file entity still created
- LLM fails → fallback justification with `taxonomy: UTILITY, confidence: 0.3`
- Entity extraction times out → quarantined and recorded, doesn't fail the batch
- >200 files changed in incremental → automatically fires full re-index via `startChild(indexRepoWorkflow)`
- Ontology LLM fails → raw extracted terms used as-is

No single file or entity failure can prevent the pipeline from completing.

---

## 19. Overall Pipeline Status

| Stage | Name | Completion | Remaining Work (Category L Only) |
|-------|------|-----------|----------------------------------|
| 1 | Prepare Repo Intelligence Space | **~97%** | Disk space validation before clone (P3) |
| 2 | SCIP Analysis | **~96%** | ~~SCIP reference→calls wiring (L-18a)~~ done; remaining: event edges (L-18b) |
| 3 | Tree-Sitter Fallback | **~93%** | ~~Cross-file call edges (L-02)~~ done; ~~TS same-file call detection~~ done; remaining: event edges (L-18b); multi-line imports + Go struct members (L-04); AST-aware complexity (L-06, deferred) |
| 4 | Finalization & Shadow Swap | **~90%** | Preserve original entity kind (L-03) |
| 4b | Blast Radius & Community Pre-Computation | **~85%** | ~~Semantic PageRank (L-19 Part A)~~ done; ~~calibrated confidence (L-19 Part B)~~ done; ~~community detection (L-21)~~ done; remaining: temporal confidence dimension |
| 5 | Embedding | **~88%** | Two-pass kind-aware embedding (L-07); dual variants (L-08); Graph-RAG with structural fingerprint (L-22); ~~AST summarization with semantic anchors (L-23)~~ done |
| 6 | Ontology Discovery | **~85%** | Three-tier ontology extraction (L-25) |
| 7 | Business Justification | **~88%** | ~~Unified intent signals (L-20 Part A)~~ done; ~~test assertions as intent source (L-16)~~ done; ~~community detection as pre-justification signal (L-21)~~ done; remaining: hermeneutic propagation with signal weighting (L-20 Part B); semantic staleness (L-09); quality scoring (L-11, deferred) |
| 8 | Health Report & ADRs | **~95%** | — |
| 9 | Graph Snapshot Export | **~98%** | — |
| 10 | Pattern Detection | **~70%** | Code-first convention discovery (L-13); git co-change mining (L-24) |
| 14 | Incremental Indexing | **~95%** | Incremental entity count recomputation for incremental path |

**Weighted overall completion: ~87%** (infrastructure complete; remaining work is algorithmic depth)

> **Assessment:** All hardening (Categories A-K, 48 tasks across Waves 0-8) is complete. The pipeline is production-reliable — clones, parses, embeds, justifies, and exports without silent failures. Of the original 27 Category L items, 5 have been removed/absorbed (L-05 already done, L-10/L-12 superseded, L-26 over-engineered, L-01 absorbed into L-18) and 3 deferred to backlog (L-06, L-11, L-15). The remaining 19 core tasks across 8 Alpha waves transform the pipeline from a "syntax reader" into an "intent-aware intelligence engine" built on **signal convergence** — structural, intent, temporal, and domain signals computed independently and converging into a pre-computed **Entity Profile** per entity. The Entity Profile is the product: what agents consume, what MCP tools return, what makes Unerr distinct.

### Completed Capabilities Summary

**Hardening (17 tasks):** Workspace cleanup, shallow clone, file size guards, encoding detection, SCIP binary surfacing, brace-depth fix, shadow swap cleanup, entity count verification, NaN embedding filter, ONNX resilience + session rotation, cascade subgraph optimization, quarantine healing, cache invalidation, graph export heartbeats + chunked serialization, batch edge fetching, bulk import optimization.

**Correctness (13 tasks):** Python/Go/Java SCIP decoders, Python/Go import edges, 6 new language plugins (C/C++/C#/PHP/Ruby/Rust), shadow swap stamping, orphan embedding cleanup, incremental fallback auto-reindex, edge repair, entity count formulas, `last_indexed_at`, LLM 405 detection, health report guards, snapshot recovery.

**Intelligence (11 tasks):** Context seeding, git history ingestion, decorator extraction, signature extraction, cross-level propagation, heuristic bypass, boundary classifier, negative knowledge indexing, manifest persistence, conventions generator, drift documentation trigger.

**Delivery (7 tasks):** `file_context` MCP tool, unified knowledge doc, incremental context refresh, agent memory sync, per-stage observability, `UNERR_CONTEXT.md` export, confidence heatmap + human override.

### Remaining: Algorithmic Depth (22 Category L Items — 19 Core + 3 Deferred)

See [Section 20](#20-to-be-implemented) for full task descriptions. 5 tasks removed/absorbed from original 27: L-05 (done), L-10 (→L-23), L-12 (→L-19), L-26 (over-engineered), L-01 (→L-18). Key structural changes from enhancement pass: L-21 moved to pre-justification (Alpha-3), L-17 moved to Alpha-5, L-18 split into phased delivery (L-18a unblocks everything).

| Priority | Count | Key Gaps |
|----------|-------|----------|
| **P1** | 6 | Call graph foundation (L-18, phased — L-18a is the 80/20 fix), cross-file call edges (L-02), PageRank + calibrated confidence (L-19), unified intent signals + hermeneutic propagation (L-20), two-pass kind-aware embeddings (L-07), AST summarization with semantic anchors (L-23) |
| **P2** | 13 | Graph-RAG with structural fingerprint (L-22), community detection as pre-justification signal (L-21), three-tier ontology (L-25), git co-change mining + temporal context (L-24), semantic staleness (L-09), test assertions as intent source (L-16), dead code exclusions (L-17), Entity Profile cache + MCP delivery (L-14), rich context assembly (L-27), dual embeddings (L-08), kind preservation (L-03), multi-line imports (L-04), code-first convention discovery (L-13) |
| **P3 (deferred)** | 3 | Adaptive RRF (L-15), AST complexity (L-06), quality scoring (L-11) |

---

## 20. To Be Implemented

> **Categories A through K (48 tasks) are complete.** Their implementations have been absorbed into the stage descriptions in Sections 4–14 above. This section contains Category L — originally 27 algorithmic depth tasks, now 22 (19 core + 3 deferred) after audit: L-05 already done, L-10/L-12 superseded, L-26 over-engineered, L-01 absorbed into L-18.
>
> **Architecture:** The algorithm is built on **signal convergence** — four independent signal families (structural, intent, temporal, domain) computed by separate waves and converging into a unified **Entity Profile** per entity. The Entity Profile is the product: what agents consume, what MCP tools return, what makes Unerr distinct from tools that only parse syntax. Confidence is **calibrated** from observable signals (has tests? has callers? descriptive name?), not LLM self-reported.
>
> **Priority legend:** P1 = blocks correctness for users on any language, P2 = materially degrades quality or coverage, P3 = polish/metrics/tracing (deferred to backlog).

---

---

### Category L — Algorithmic Depth (Capturing the Substrate)

The indexing algorithm must become a proprietary, deeply defensible mechanism that captures the true "soul and substrate" — the deep semantics, intent, and architecture — of any codebase. Syntax is not semantics, and a call graph is not an architecture. These 22 remaining tasks (19 core across 8 Alpha waves + 3 deferred) represent the gap between "syntax reader" and "intent-aware intelligence engine." They are not infrastructure bugs — they are fundamental blind spots where the pipeline misjudges context, miscalculates relevance, or fails to capture semantics.

The tasks are organized around the **signal convergence** model: structural signals (graph position, PageRank, communities), intent signals (tests, docs, commits, entry points), temporal signals (co-change, blame, drift), and domain signals (ontology, conventions, rules) are computed independently and converge into a pre-computed **Entity Profile** — the single artifact agents consume. Each Alpha wave produces one or more signal families, and each task's description specifies which signal it produces and how it feeds into the profile.

Organized into six sub-categories: Call Graph & Execution Graph Completeness, Semantic Graph Analysis, Embedding & Search Intelligence, Justification Quality, Entity Model Fidelity, and Temporal Context & Delivery Layer. Tasks marked ~~strikethrough~~ have been removed, superseded, or absorbed — see notes at each for rationale.

---

#### Sub-category 1: Call Graph & Execution Graph Completeness

---

#### ~~TBI-L-01: SCIP Two-Pass Decoder~~ — ABSORBED into L-18

SCIP `scip-decoder.ts` already has Pass 2 (lines 83-113) creating `references` edges. The remaining work — wiring these as `calls` edges — is a sub-task of L-18's edge kind overhaul, not a standalone task. See L-18 sub-task 8.

---

#### TBI-L-02: Cross-File Call Edge Resolution in Tree-Sitter — ✅ DONE

**Priority: P1**

Tree-sitter parsers only create within-file edges via regex pattern matching. When a function calls an imported symbol (`import { validate } from './validator'; validate(input)`), no `calls` edge is created between the calling function and the imported `validate` function. The import edge exists (file → file), but the function-level call edge does not.

**Implementation (completed):**
1. ✅ Created shared `lib/indexer/cross-file-calls.ts` module with `resolveCrossFileCalls()` — runs as post-processing after all tree-sitter parsing in `parseRest()`.
2. ✅ Resolves import edges to target entities using file entity ID → file path → callable entity lookup. Handles extension-less imports and index file variants.
3. ✅ Scans function/method bodies for `name(` and `new Name(` patterns matching imported symbols.
4. ✅ Added TypeScript same-file call detection (`detectTypeScriptCallEdges()` in `typescript/tree-sitter.ts`) for parity with Python/Go/Java parsers.
5. ✅ Added tests: 8 test cases covering cross-file calls, external import skipping, constructor calls, deduplication.

**Affected files:** `lib/indexer/cross-file-calls.ts` (new), `lib/indexer/languages/typescript/tree-sitter.ts`, `lib/temporal/activities/indexing-heavy.ts`

**Done when:** ✅ Function calls to imported symbols produce `calls` edges. TypeScript has same-file call detection parity with Python/Go. Cross-file resolution runs in `parseRest()` pipeline.

---

#### ~~TBI-L-05: O(1) Dedup in SCIP Decoder~~ — DONE

Already implemented. `scip-decoder.ts:38` uses `seenIds = new Set<string>()` for O(1) dedup.

---

#### TBI-L-18: Call Graph Foundation — Wire Calls Edges + Execution Graph

**Priority: P1** — **THE CRITICAL GAP — THE LOAD-BEARING WALL**

The topological sort (line 121 of `topological-sort.ts`) uses ONLY `calls` edges: `if (edge.kind !== "calls") continue`. But **no parser creates `calls` edges**. SCIP creates `references`. Tree-sitter creates `imports`, `extends`, `implements`, `member_of`. Result: every entity lands on the same topological level. The bottom-up justification — the core differentiator — degenerates into a flat batch. Impact analysis, `get_callers`/`get_callees`, and cascading staleness all return empty.

**Verified:** `EdgeKind` includes `"implements"` but NO parser creates these edges. Zero `emits`, `listens_to`, `mutates_state` edge kinds exist in the codebase. SCIP Pass 2 creates `references` edges, not `calls`.

**Phased approach** — L-18a is the 80/20 fix that unblocks the entire roadmap. L-18b adds depth for event-driven codebases.

**Phase L-18a: Wire Existing References as Calls** ✅ **DONE**:
1. ✅ **(Absorbed from L-01)** Fixed `scip-decoder.ts` Pass 2: replaced broken `refId` computation (which hashed target symbol's kind/name against current file) with containment-based lookup using per-file entity index built in Pass 1. Binary search finds the entity whose `startLine ≤ referenceLine`. Classifies edges as `calls` (function/method targets) or `references` (class/variable/module targets). Deduplicates edges.
2. ✅ **Updated `topologicalSortEntityIds` AND `topologicalSortEntities` to traverse `calls` AND `references` edges.** Also updated `dead-code-detector.ts` to count `references` as inbound edges.
3. ✅ Added tests: SCIP edge classification tests, topological sort multi-level tests (chain, diamond, cycle, self-loop), cross-file call resolution tests.

**Phase L-18b: Event/Plugin Edge Detection** (depth — can ship after L-18a without blocking other waves):
4. Add `emits`, `listens_to`, `mutates_state` to `EdgeKind` type in `lib/indexer/types.ts`.
5. In TypeScript tree-sitter: detect `.emit(`, `.on(`, `.addEventListener(` patterns → create `emits`/`listens_to` edges with the event name as edge metadata.
6. In TypeScript tree-sitter: wire the captured `implements` regex group (group 8, currently extracted but ignored at line 151) to create actual `implements` edges.
7. In Go tree-sitter: detect interface satisfaction patterns → `implements` edges.
8. Add state mutation detection: functions that call `.save()`, `.update()`, `.delete()` on model objects → `mutates_state` edges.
9. **Manifest/config scanning for infrastructure-level event edges:** Parse deployment manifests (`serverless.yml`, CDK constructs, `docker-compose.yml` service dependencies) to discover Lambda triggers, message queue subscriptions, and service-to-service event connections that are invisible in application code. Create `emits`/`listens_to` edges from infrastructure definitions.
10. **Update `topologicalSortEntityIds` to traverse ALL edge kinds, not just `calls`** — broaden the filter to include the new semantic edge kinds with configurable traversal weights.
11. Add ArangoDB edge collections for new edge kinds (or use the existing generic edge collection with kind discrimination).
12. Add tests: EventEmitter-based code → verify `emits`/`listens_to` edges exist and topological sort orders emitters before listeners.

**Affected files:** `lib/indexer/scip-decoder.ts`, `lib/justification/topological-sort.ts`, `lib/indexer/types.ts`, `lib/indexer/languages/typescript/tree-sitter.ts`, `lib/indexer/languages/go/tree-sitter.ts`, `lib/adapters/arango-graph-store.ts`

**Done when (L-18a):** Topological sort produces multiple levels (not a flat batch). `get_callers`/`get_callees` MCP tools return real data. Impact analysis traces actual call chains.

**Done when (L-18b):** Event-driven architectures show connected components in the graph. `implements` edges connect classes to interfaces.

---

#### Sub-category 2: Semantic Graph Analysis

---

#### ~~TBI-L-12: Graph-Theoretic Blast Radius~~ — SUPERSEDED by L-19

L-12 was "anything better than degree centrality." L-19 is "specifically PageRank with edge-type weighting" — a strictly superior approach that solves the same problem. Both modify `centrality.ts` and `graph-context-builder.ts`. Skip the intermediate step.

---

#### TBI-L-19: Semantic PageRank + Calibrated Confidence Model — ✅ DONE (Alpha-2)

**Priority: P1** — **Status: Complete**

Two connected problems: (1) centrality uses degree counting, making `logger.info()` look like the most critical entity, and (2) justification confidence is self-reported by the LLM (meaningless without calibration). Both are fixed by computing observable structural signals.

**Part A: Semantic PageRank** — ✅ Done. Weighted PageRank implemented in `lib/justification/pagerank.ts` using power iteration (no graphology dependency — self-contained ~120 lines). Edge weights per kind: `mutates_state` 0.9, `implements` 0.7, `emits`/`listens_to` 0.6, `calls` 0.5, `references` 0.3, `extends` 0.3, `imports` 0.1, `member_of` 0.05, `contains` 0.0. Convergence: ε=0.0001, max 100 iterations, damping=0.85. Both raw scores and percentile ranks stored on ALL entities via `precomputeBlastRadius`. `computeApproxCentrality()` retained as fallback for entities without pre-computed PageRank.

**Part B: Calibrated Confidence** — ✅ Done. `lib/justification/confidence.ts` computes multi-signal confidence from: structural (callers, callees, PageRank percentile → 0-0.5), intent (docs, tests, descriptive name → 0-0.3), LLM (raw confidence × tier weight → 0-0.2). Composite and breakdown stored as `calibrated_confidence` and `confidence_breakdown` on justification documents. Raw `confidence` preserved for backwards compatibility.

**Remaining:** Temporal confidence dimension (git history age/recency) — deferred to Alpha-3.

**Affected files:** `lib/justification/pagerank.ts` (new), `lib/justification/confidence.ts` (new), `lib/justification/graph-context-builder.ts`, `lib/temporal/activities/graph-analysis.ts`, `lib/temporal/activities/justification.ts`

**Done when:** ~~`logger.info()` ranks lower than `PaymentService.processOrder()` in blast radius.~~ ✅ Achieved — PageRank naturally deprioritizes utility wrappers. ~~Confidence scores have per-dimension breakdown.~~ ✅ Achieved. ~~Agents can distinguish "high confidence because we have tests and callers" from "high confidence because the LLM guessed 0.9."~~ ✅ Achieved via `confidence_breakdown`.

---

#### TBI-L-20: Intent Signal Extraction & Hermeneutic Propagation (Part A ✅ DONE, Part B remaining)

**Priority: P1** — **Status: Part A (signal-aware prompt structure + intent extraction) complete in Alpha-3. Part B (hermeneutic propagation with signal weighting) remaining.**

Current `propagateContextActivity` (3-pass in `context-propagator.ts`) uses **frequency-based aggregation**: dominant child tag by count, top-10 domain concepts by frequency, average confidence. This is mechanical — a utility function used by both Auth and Billing gets the tag of whichever calls it more.

**Verified:** `context-propagator.ts` lines 90-143 (bottom-up) counts tag frequency; lines 149-177 (top-down) only propagates to `"unclassified"`/`"utility"`/`"misc"` children.

**The core insight:** Intent has four independent sources, each with different confidence. The LLM should see ALL of them as structured signals, not have to discover intent from code alone:

| Source | Signal | Confidence | Example |
|--------|--------|------------|---------|
| **Tests** | Test names + assertions | High (human-written intent) | `"should reject expired payment methods"` |
| **Entry points** | URL path, CLI command, CRON schedule | High (business-facing) | `POST /api/checkout` |
| **Commits** | Commit messages for recent changes | Medium (may be vague) | `"fix: handle partial refunds"` |
| **Naming** | Function/class name conventions | Medium (may be misleading) | `validatePaymentCard` → payment validation |

Upgrade to intent-aware hermeneutic circle that propagates ALL intent signals:
- **Pass 1 (Bottom-Up — Mechanism):** "What does this entity DO?" (current behavior, keep)
- **Pass 2 (Top-Down — Intent):** Once entry points are reached, push their intent context BACK DOWN to all descendants, weighted by graph distance. A utility function is now understood as "Validates the Stripe webhook payload before order fulfillment," not just "Validates an object."

**Sub-tasks:**
1. Build `extractIntentSignals(entity, edges, testEntities, commitHistory)` that produces a structured intent object per entity:
   ```typescript
   intent: {
     from_tests: ["should reject expired payment methods", "should apply discount codes"],
     from_entry_points: ["POST /api/checkout", "POST /api/refund"],
     from_commits: ["handle partial refunds for multi-currency orders"],
     from_naming: "validates payment card details before charge",
     synthesized: null  // filled by LLM during justification
   }
   ```
2. In tree-sitter parsers, extract test assertion patterns: `expect(X).toBe(Y)`, `assert X == Y`, `it("description", ...)`, `describe("context", ...)`. Link test entities to entities they test (by import analysis: `import { processPayment } from './payment'` in a `.test.ts` file → link to `processPayment`).
3. Identify entry point entities by file path patterns (`app/api/`, `pages/api/`, `**/cron/**`, `**/cli/**`) and entity naming conventions (`handler`, `route`, `controller`).
4. Structure the justification prompt around signals (see signal-aware prompt format below) so the LLM reasons about signal agreement/disagreement explicitly.
5. In top-down pass: propagate entry point intent context to ALL descendants, not just unclassified ones. Weight propagation by graph distance (closer = stronger inheritance).
6. Store `intent_signals` object alongside existing `propagated_feature_tag` on justification documents. The `synthesized` field is the LLM's reconciliation of all signals.
7. When signals disagree (test says "payment" but naming says "validation"), the LLM produces a `synthesized` intent that explains the relationship: "Validates payment card details as part of the checkout flow."

**Signal-aware prompt structure** (replaces monolithic prompt):
```
STRUCTURAL SIGNAL:
- Callers: CheckoutController.submit, RefundHandler.process
- Callees: StripeAdapter.charge, PaymentValidator.validate
- Centrality: 0.73 (top 5% in this codebase)
- Community: Payment Processing cluster (23 entities)

INTENT SIGNAL:
- Tests: "should reject expired cards", "should handle partial refunds"
- Entry point: Called from POST /api/checkout
- Naming: "processPayment" suggests payment orchestration

TEMPORAL SIGNAL:
- Changed 12 times in last 90 days
- Co-changes with: stripe-adapter.ts (85% co-change rate)

Given these signals, classify this entity:
```

**Affected files:** `lib/justification/context-propagator.ts`, `lib/justification/intent-extractor.ts` (new), `lib/justification/prompt-builder.ts`, `lib/temporal/activities/justification.ts`, `lib/indexer/languages/typescript/tree-sitter.ts`

**Done when:** A utility validation function called by both Auth and Billing has TWO intent annotations: "validates credentials for authentication flow" AND "validates invoice data for billing flow." Justification prompts show structured signals. Intent signals are stored on justification documents.

---

#### TBI-L-21: Community Detection as Pre-Justification Signal ✅ DONE (Alpha-3)

**Priority: P2** — **Status: Complete**

Current feature tags are LLM-guessed (~70% LLM, ~30% heuristic hints from `model-router.ts`). Louvain community detection EXISTS in `pattern-mining.ts` but is used only for pattern mining, NOT for feature/domain discovery.

**Verified:** `graphology-communities-louvain` runs in `pattern-mining.ts:58` but output feeds pattern detection, not justification feature tags.

**Key architectural change:** Move Louvain from post-justification (pattern detection) to **pre-justification**. Community membership is a powerful structural signal that the LLM should see DURING justification, not discover after. "This function is in the same community as PaymentService, CheckoutController, and StripeAdapter" tells the LLM exactly which domain it belongs to — before it even reads the code.

Louvain is sufficient — no need for spectral partitioning (Laplacian eigenvalues) unless Louvain produces clearly wrong partitions at this graph scale (1k-50k entities).

**Sub-tasks:**
1. Extract Louvain community detection into a reusable `detectCommunities()` function (currently embedded in pattern-mining).
2. Run community detection BEFORE justification as a new step in `justify-repo.ts` workflow (after topological sort, before justification loop).
3. Store community assignments in Redis alongside topological levels: `community:{orgId}:{repoId}:{entityId}` → community label.
4. Pass community membership as context to `justifyBatch` — include in the STRUCTURAL SIGNAL section of the prompt: `"Community: Payment Processing cluster (23 entities: PaymentService, CheckoutController, StripeAdapter, ...)"`.
5. After justification: validate LLM-guessed `feature_tag` against community structure. If 8/10 entities in a community have tag "Billing" and 2 have "Authentication", flag the 2 for review or override.

**Affected files:** `lib/temporal/activities/pattern-mining.ts`, `lib/temporal/activities/justification.ts`, `lib/temporal/workflows/justify-repo.ts`, `lib/justification/community-detection.ts` (new, extracted from pattern-mining)

**Done when:** Community labels are computed before justification and appear in justification prompts. Feature tags within a Louvain community are consistent. LLM names the cluster but doesn't determine its membership.

---

#### Sub-category 3: Embedding & Search Intelligence

---

#### TBI-L-07: Kind-Aware Embedding Strategies + Two-Pass Embedding

**Priority: P1**

Two problems: (1) all entity types use identical embedding — modules/namespaces are excluded entirely, and (2) the pipeline runs embed → ontology → justify, so first-time embeddings have NO justification context (`loadJustificationMap()` returns empty on first index). Only re-indexing benefits from justifications in embeddings.

**Verified:** `buildEmbeddableDocuments()` in `embedding.ts` applies the same logic to all kinds. Files/directories/modules/namespaces excluded at line 84.

**Fix: Two-pass embedding** (fixes the ordering problem):
- **Pass 1 (Structural):** Runs after indexing, before justification. Contains: entity name, kind, signature, file path, body (AST-summarized from L-23). Purpose: enable ontology discovery and initial search. This is what currently happens, but with kind-aware strategies.
- **Pass 2 (Synthesis):** Runs after justification. Contains: everything from Pass 1 PLUS business_purpose, feature_tag, domain_concepts, intent signals, structural fingerprint. Purpose: enable intent-aware search.

The bi-temporal `valid_to` pattern already supports this — Pass 1 embeddings get superseded by Pass 2.

**Sub-tasks:**
1. ✅ Define per-kind embedding strategies (Pass 1): `buildKindAwareText()` in `embedding.ts` switches on entity kind — classes emphasize method inventory + extends, interfaces emphasize contracts, modules/namespaces embed export surface.
2. ✅ Re-include modules and namespaces with their custom strategy — exclusion filter narrowed to file/directory only.
3. ✅ Implement Pass 2 embedding trigger: `reEmbedWithJustifications` activity called from justify-repo workflow Step 8b after justifications complete.
4. ✅ Pass 2 enrichment: `buildKindAwareText` includes `Purpose`, `Feature`, `Domain`, and `Community` fields from justification + entity metadata when available.
5. A/B test embedding quality: compare retrieval precision between Pass 1 and Pass 2 on a held-out query set.

**Affected files:** `lib/temporal/activities/embedding.ts`, `lib/temporal/workflows/embed-repo.ts`, `lib/temporal/workflows/justify-repo.ts`

**Done when:** Different entity kinds produce different embedding documents. Modules and namespaces are embedded. First-time embeddings work for search (Pass 1). Post-justification embeddings capture business intent (Pass 2).

---

#### TBI-L-08: Decouple Entity Embeddings from LLM Justification Text

**Priority: P2**

Embedding document includes LLM-generated `business_purpose`, `domain_concepts`, `feature_tag`. If the LLM hallucinates (which happens at ~5-15% rate per entity), the embedding space is polluted — semantically similar entities are pushed apart by divergent hallucinated descriptions.

**Sub-tasks:**
1. Create two embedding variants: **code embedding** (entity text only — name, signature, body, imports) and **semantic embedding** (justification text + code).
2. Store both embeddings in pgvector with a `variant` column.
3. At query time, use weighted combination: `0.7 * code_similarity + 0.3 * semantic_similarity` (tunable).
4. This allows the system to find structurally similar code even when justifications are wrong.

**Affected files:** `lib/temporal/activities/embedding.ts`, `lib/embeddings/hybrid-search.ts`

**Done when:** Two embedding variants exist per entity. Search results are not degraded by LLM hallucinations in justification text.

---

#### TBI-L-14: Entity Profile Cache + MCP Profile Delivery

**Priority: P2**

`semantic_search` returns callers/callees but NOT justification metadata (taxonomy, feature_tag, business_purpose). Only `search_by_purpose` returns justification fields. Current MCP tools make 3-5 database calls per request (entity from ArangoDB, justification from ArangoDB, callers/callees from ArangoDB, embeddings from pgvector).

**The Entity Profile is the product.** Instead of attaching raw justification fields to search results, pre-compute a comprehensive **Entity Profile** per entity and cache it. Every MCP tool returns a projection of this profile — a single cache read instead of N database calls.

```typescript
interface EntityProfile {
  // Identity
  id: string; kind: string; name: string; file_path: string;
  // Structural signal
  callers: string[]; callees: string[]; centrality: number;
  community: string; blast_radius: number;
  // Intent signal
  business_purpose: string; feature_tag: string; taxonomy: string;
  test_coverage: string[];  // assertions describing expected behavior
  // Confidence
  confidence: { composite: number; breakdown: { structural: number; intent: number; temporal: number } };
  // Metadata
  architectural_pattern: string; complexity: number; is_dead_code: boolean;
}
```

**Sub-tasks:**
1. Implement `buildEntityProfile()` function that assembles all signals into a single profile object per entity.
2. After justification completes, bulk-compute profiles for all entities and store in Redis with 24-hour TTL: `profile:{orgId}:{repoId}:{entityId}`.
3. Update all MCP tools (`semantic.ts`, `business.ts`, `inspect.ts`, `file-context.ts`) to read from profile cache. Falls back to direct DB query on cache miss.
4. Profile includes: identity, structural signal (callers, callees, centrality, community, blast_radius), intent signal (business_purpose, feature_tag, taxonomy, test_coverage), confidence (composite + breakdown), and metadata (architectural_pattern, complexity, is_dead_code).
5. Invalidate profile cache when entity or justification changes (hook into incremental indexing).
6. **`refresh_context` MCP tool** — Expose a tool that agents can call mid-session to trigger incremental profile cache refresh for entities they've modified. When an agent changes code during an agentic loop, cached profiles become stale. `refresh_context({ files: ["lib/payment/processor.ts"] })` re-computes profiles for affected entities without requiring a full re-index. This enables agentic workflows where the agent's own changes are immediately reflected in subsequent queries. Lightweight: re-reads the changed files, re-hashes entities, updates affected profiles in cache.

**Affected files:** `lib/mcp/entity-profile.ts` (new), `lib/mcp/tools/semantic.ts`, `lib/mcp/tools/inspect.ts`, `lib/mcp/tools/file-context.ts`, `lib/mcp/tools/refresh-context.ts` (new), `lib/temporal/activities/justification.ts`

**Done when:** All MCP tools return Entity Profiles. Single cache read per entity instead of 3-5 DB calls. Profile includes structural, intent, and confidence signals. Agents can call `refresh_context` to update profiles for files they've modified mid-session.

---

#### TBI-L-15: Adaptive RRF k-Parameter

**Priority: P3**

Fixed k=30 in `reciprocalRankFusion()`. Weights: semantic=0.7, keyword=1.0, justification=0.5.

**Verified:** `hybrid-search.ts` line 243, k=30 hardcoded.

**Sub-tasks:**
1. Make k configurable per query or per result set size.
2. Implement adaptive k based on result set variance: higher k when result sets are highly divergent (reduces impact of outliers), lower k when they agree (amplifies consensus).
3. Evaluate weight tuning: current weights may over-emphasize keyword matches for code search.

**Affected files:** `lib/embeddings/hybrid-search.ts`

**Done when:** RRF k-parameter adapts to query characteristics. Retrieval precision improves on diverse query types.

---

#### TBI-L-22: Graph-RAG Embeddings with Structural Fingerprint

**Priority: P2**

Entities are embedded in ISOLATION. Graph context (callers, callees, parent module) is added only post-search via `enrichWithGraph()` (line 373-413 of `hybrid-search.ts`), NOT during embedding generation. This means vector similarity cannot capture structural relationships.

**Approach: Structural fingerprint, not Node2Vec.** Node2Vec/GraphSAGE require training and add heavy ML infrastructure. For codebase graphs of 1k-50k entities, a computed 5-dimensional structural fingerprint captures the same positional information without any training:

```typescript
structural_fingerprint(entity) = [
  pagerank_score,           // how central (from L-19)
  community_id,             // which cluster (from L-21)
  depth_from_entry_point,   // how deep in the call stack
  fan_in / fan_out ratio,   // consumer (high fan_in) vs provider (high fan_out)
  is_boundary_node,         // touches external dependency? (from boundary-classifier.ts)
]
```

Two functions with identical code but different graph positions (one at the API boundary, one deep in domain logic) are correctly distinguished.

**Sub-tasks:**
1. Compute structural fingerprint per entity after PageRank and community detection complete.
2. Before embedding, concatenate entity text with: (a) 1-hop neighborhood summary (`[CALLERS: foo, bar] [CALLEES: baz, qux]`), (b) structural fingerprint values as text tokens (`[CENTRALITY: 0.73] [COMMUNITY: payment_processing] [DEPTH: 3] [BOUNDARY: true]`).
3. At query time, use structural fingerprint for re-ranking: among semantically similar results, boost entities with similar structural position to the query context.
4. Benchmark: semantically similar entities that are also structurally close should rank higher than structurally distant matches.

**Affected files:** `lib/temporal/activities/embedding.ts`, `lib/embeddings/hybrid-search.ts`, `lib/justification/structural-fingerprint.ts` (new ~30-line module)

**Done when:** Embeddings encode structural position. Two functions with identical code but different graph positions produce different search rankings. No ML training required.

---

#### Sub-category 4: Justification Quality

---

#### TBI-L-09: Semantic Staleness Cascading (Change-Type Aware)

**Priority: P2**

Current staleness detection uses Jaccard set comparison on `domainConcepts` arrays. This is brittle — adding a single new concept to a callee triggers re-justification of all callers, even if the semantic meaning is unchanged.

**Smarter approach: consider WHAT changed, not just whether the embedding moved.** A single cosine threshold misses important cases (signature changes that happen to produce similar embeddings) and triggers false cascades (comment edits).

**Change-type classification:**

| Change Type | Cascade? | Rationale |
|------------|----------|-----------|
| Signature changed (params, return type) | **Always** | Contract change — callers must re-evaluate |
| Semantic anchors changed (decisions, mutations, errors) | **Always** | Business logic changed |
| Body changed, anchors same | **Cosine check** | Internal refactor — cascade only if meaning shifted |
| Comments/whitespace only | **Never** | No semantic change |
| Test assertions changed | **Always** | Intent changed — re-justify to pick up new intent signal |

**Sub-tasks:**
1. Classify change type by comparing old vs new entity: diff signature, semantic anchors (from L-23), body hash, and comment-only changes.
2. Apply cascade rules per change type (see table above).
3. For body-changed-anchors-same case: compute cosine similarity between old and new justification embeddings. If similarity > 0.95, skip cascade.
4. Add a fallback TTL: re-justify entities older than 30 days regardless of body hash match (captures ontology drift).
5. Log cascade decisions with reasons for observability.

**Affected files:** `lib/temporal/activities/justification.ts`, `lib/justification/staleness.ts` (new ~40-line module)

**Done when:** Comment edits never cascade. Signature changes always cascade. Body refactors cascade only when semantic meaning shifts. Cascade decisions are logged with reasons.

---

#### ~~TBI-L-10: AST-Aware Body Truncation~~ — SUPERSEDED by L-23

L-10 was "smarter truncation" — a stepping stone to L-23's full AST-aware hierarchical summarization. Go straight to L-23 to avoid touching `embedding.ts` and `prompt-builder.ts` twice.

---

#### TBI-L-11: Quality Scoring with Positive Reinforcement

**Priority: P3**

Current `scoreJustification()` only penalizes: checks for boilerplate phrases, vague language, minimum description length. It never rewards high-quality outputs. This means the quality score is a penalty counter, not a quality measure.

**Sub-tasks:**
1. Add positive scoring signals: specific domain terminology used, concrete entity references, non-generic business_purpose, semantic_triples with specific subjects/objects.
2. Normalize to 0.0-1.0 scale where 0.5 is neutral, <0.5 is penalized, >0.5 is rewarded.
3. Use quality scores to inform model routing on re-index: entities that scored low should be routed to `premium` tier.

**Affected files:** `lib/temporal/activities/justification.ts`

**Done when:** Quality scores differentiate between genuinely good justifications and merely "not bad" ones. Low-scoring entities are upgraded to premium model on re-index.

---

#### TBI-L-16: Parse Test Assertions as Intent Signal ✅ DONE (Alpha-3)

**Priority: P2** — **Status: Complete**

Test files contain the most intent-rich descriptions of what code is supposed to do. Assertions like `expect(invoice.total).toBe(100)` and test names like `"should reject expired payment methods"` are direct statements of business intent. Currently, test files are indexed but their assertions are not fed into the justification prompt for the entity under test.

**Role in the intent framework:** Test assertions are one of four intent sources (see L-20). This task handles the parser-level extraction; L-20 handles feeding it into the signal-aware prompt structure.

**Sub-tasks:**
1. In tree-sitter parsers, extract test assertion patterns: `expect(X).toBe(Y)`, `assert X == Y`, `it("description", ...)`, `describe("context", ...)`.
2. Link test entities to the entities they test (by import analysis: `import { processPayment } from './payment'` in a `.test.ts` file → link to `processPayment`). Create `tests` edges.
3. Store extracted test descriptions on the tested entity's intent signal (feeds into L-20's `intent.from_tests[]`).
4. In the signal-aware prompt (L-20), test assertions appear under INTENT SIGNAL: `"Tests: should reject expired cards, should handle partial refunds"`.

**Affected files:** `lib/indexer/languages/typescript/tree-sitter.ts`, `lib/indexer/languages/python/tree-sitter.ts`, `lib/justification/intent-extractor.ts` (from L-20)

**Done when:** Test names and key assertions are extracted during parsing, linked to tested entities, and appear as intent signals in justification prompts.

---

#### TBI-L-17: Dead Code Detection Exclusions for Plugin/Event/Config Patterns

**Priority: P2**

`detectDeadCode()` flags entities with zero inbound references in the `calls` edge collection. It excludes exported functions, entry points, and test files. But it does NOT exclude:
- Plugin registrations (`app.use(middleware)`)
- Event handler registrations (`.on('event', handler)`)
- Config/factory exports (`export const config = { ... }`)
- Decorator-registered endpoints (`@Controller`, `@Injectable`)

These are all called via framework indirection, not direct `calls` edges.

**Sub-tasks:**
1. Add exclusion patterns for common framework registration patterns.
2. Cross-reference with L-18: once `emits`/`listens_to` edges exist, event handlers will have inbound references and no longer be falsely flagged.
3. Add a `dead_code_reason` field to explain why an entity was flagged (helps users verify).

**Affected files:** `lib/temporal/activities/justification.ts`

**Done when:** Event handlers, plugin registrations, and config exports are not flagged as dead code.

---

#### TBI-L-23: Hierarchical AST Summarization with Semantic Anchor Extraction — ✅ DONE (Alpha-2)

**Priority: P1** — **Status: Complete**

Instead of capping at N characters (current naive `.slice(0, limit)` at 2000-3000 chars), **extract semantic anchors** — the lines that carry the most meaning — and replace everything else with structural tokens. A 500-line function compresses to ~512 tokens without losing its architectural soul.

Implemented in `lib/justification/ast-summarizer.ts`. Six anchor categories detected via regex: `decision`, `external_call`, `mutation`, `error`, `return`, `assertion`. Non-anchor lines compressed into structural tokens: `[IMPORTS: N lines]`, `[SETUP: N variables]`, `[LOOP: for over items]`, `[TRY_CATCH]`, `[LOG]`, `[... N lines ...]`. Short bodies (<maxChars) returned verbatim with anchors still extracted for metadata.

Wired into:
- `prompt-builder.ts`: `truncateBody()` now delegates to `summarizeBody()` — drop-in replacement for all entity-specific section builders and batch prompts
- `embedding.ts`: `buildEmbeddableDocuments()` uses `summarizeBody()` at 2000 chars instead of naive slice

**Remaining:** Store extracted anchors as entity metadata (`semantic_anchors[]`) for downstream entity profiles (deferred to Alpha-5/L-22).

**Affected files:** `lib/justification/ast-summarizer.ts` (new), `lib/temporal/activities/embedding.ts`, `lib/justification/prompt-builder.ts`

**Done when:** ~~A 500-line payment processing function retains its Stripe-specific error handling, external Stripe calls, and refund logic in the summary.~~ ✅ Achieved. ~~Semantic anchors are tagged by category.~~ ✅ Achieved. ~~Justification quality improves measurably.~~ Pending benchmark on next full re-index.

---

#### TBI-L-25: Semantic Ontology Extraction (Replace Keyword Frequency with Intent Mapping)

**Priority: P2**

Current ontology: PascalCase split → frequency ranking → optional LLM refinement.

**Verified:** `ontology-extractor.ts:38-78` splits identifiers, counts frequency, filters programming stopwords. Cannot differentiate "Invoice" (domain concept) from "Handler" (architectural pattern) from "Service" (framework noise).

**Sub-tasks:**
1. ✅ Classify extracted terms into three tiers: `classifyTerms()` in `ontology-extractor.ts` with curated ARCHITECTURAL_TERMS and FRAMEWORK_TERMS sets, unknown terms default to domain. Stored as `term_tiers` on `DomainOntologyDoc`.
2. Use embedding similarity to cluster terms semantically within each tier (e.g., "Invoice", "Payment", "Billing" → same domain cluster). *(Deferred to Alpha-5)*
3. ✅ Build cross-tier relationships: `buildDomainToArchitectureMap()` scans entity names for co-occurrence of domain + architectural terms. Stored as `domain_to_architecture` on ontology doc.
4. ✅ Feed three-tier ontology into justification prompts as structured `## Domain Signal` section in `prompt-builder.ts` (both single-entity and batch prompts). Falls back to flat term list for old ontologies without `term_tiers`.
5. Weight domain concepts higher than architectural patterns in all downstream uses (embedding, search, feature tags).

**Affected files:** `lib/justification/ontology-extractor.ts`, `lib/temporal/activities/ontology.ts`

**Done when:** Ontology output distinguishes domain concepts from architectural patterns from framework terms. Cross-tier mapping links domain concepts to their implementing architectural patterns. "Invoice" ranks higher than "Handler" in domain importance.

---

#### Sub-category 5: Entity Model Fidelity

---

#### TBI-L-03: Preserve Original Entity Kind Through KIND_TO_COLLECTION

**Priority: P2**

`KIND_TO_COLLECTION` in `arango-graph-store.ts` collapses `method` → `functions`, `type` → `variables`. The original entity `kind` is mapped to a collection name and the original value is lost in the ArangoDB document. Downstream stages cannot distinguish methods from standalone functions, or type aliases from variables.

**Sub-tasks:**
1. Ensure the original `kind` value is preserved as a field on the ArangoDB entity document (it may already be stored — verify).
2. If `kind` is overwritten during collection mapping, add an `original_kind` field that preserves the indexer's classification.
3. Update downstream consumers (justification, embedding, MCP tools) to use `original_kind` when the distinction matters.

**Affected files:** `lib/adapters/arango-graph-store.ts`

**Done when:** A method entity stored in the `functions` collection retains `original_kind: "method"`. Downstream stages can distinguish methods from functions.

---

#### TBI-L-04: Multi-Line Import Parsing + Go Struct/Interface Members

**Priority: P2**

TypeScript tree-sitter parser handles single-line imports but not multi-line imports:
```typescript
import {
  foo,
  bar,
  baz
} from './module'
```
Only the first line is matched. Go parser extracts struct and interface declarations but not their member fields/methods.

**Sub-tasks:**
1. In TypeScript parser: accumulate multi-line import statements before regex matching. Track open `{` and close `}` across lines.
2. In Go parser: extract struct fields as entities with `member_of` edges to the parent struct. Extract interface method signatures.
3. Add tests for multi-line import patterns and Go struct member extraction.

**Affected files:** `lib/indexer/languages/typescript/tree-sitter.ts`, `lib/indexer/languages/go/tree-sitter.ts`

**Done when:** Multi-line TypeScript imports are fully parsed. Go struct fields appear as entities with `member_of` edges.

---

#### TBI-L-06: AST-Aware Complexity Estimation

**Priority: P3**

Current cyclomatic complexity estimation in tree-sitter parsers is a rough heuristic (counting `if`, `for`, `while`, `switch` keywords). Doesn't account for nested conditions, ternary operators, logical operators (`&&`, `||`), or early returns.

**Sub-tasks:**
1. Implement a proper cyclomatic complexity counter that handles nesting depth, ternary chains, and logical operator branching.
2. Add cognitive complexity (Sonar-style) as an additional metric — weights nested conditions higher.
3. Use both metrics in model routing: high cognitive complexity → premium model.

**Affected files:** `lib/indexer/languages/typescript/tree-sitter.ts`, `lib/indexer/languages/python/tree-sitter.ts`, `lib/indexer/languages/go/tree-sitter.ts`

**Done when:** Complexity estimation distinguishes between a function with 5 flat `if` statements and a function with 3 levels of nested conditions.

---

#### Sub-category 6: Temporal Context & Delivery Layer

---

#### TBI-L-13: LLM-Based Rule Synthesis + Semantic Pattern Mining

**Priority: P2**

Current pattern detection is purely structural (Semgrep patterns). It can find "empty catch blocks" but not "all payment handlers must validate currency before processing." Semantic patterns require understanding intent, not just syntax structure.

**Two-phase approach: Code-first discovery + justification-enriched naming.**

Conventions are discoverable from code structure alone — if every API route validates auth before processing, that's a structural pattern. Justifications then CONFIRM and NAME the convention ("authentication-first pattern"), but don't discover it.

**Sub-tasks:**
1. **Phase 1 (Code-first):** After community detection (L-21), analyze entities within each community for structural recurring patterns: similar call sequences, consistent parameter patterns, shared error handling approaches. Use Louvain communities to scope the analysis (conventions are often community-local).
2. **Phase 2 (Justification-enriched):** After justification completes, use justification data to name and describe discovered patterns. Entities with similar `business_purpose` that follow different code structures → candidate for convention violation.
3. Use LLM to synthesize human-readable rules from pattern clusters: "In this codebase, all API route handlers validate authentication before processing. 3 handlers violate this convention."
4. Store synthesized rules in the `rules` collection with `source: "semantic_mining"` and link to the community where the convention was discovered.
5. Expose in Convention Guide (Feature 2.10) with adherence percentage and violating entities.

**Affected files:** `lib/temporal/activities/pattern-detection.ts`, `lib/temporal/activities/justification.ts`

**Done when:** The system discovers conventions from code structure first, then names them using justification data. Rules include community context and adherence metrics.

---

#### TBI-L-24: Temporal Intent Vectors — Git Co-Change Mining with Association Rules

**Priority: P2**

Code that changes together belongs together. Mine the git commit matrix using FP-Growth or association rule learning. If `checkout.ts` and `stripe_adapter.ts` co-change 85% of the time, create a `LOGICALLY_COUPLED` edge. Captures hidden dependencies developers hold in their heads.

**Verified:** Only `gitHost.blame()` exists. Zero commit matrix, co-change analysis, or temporal coupling detection.

Extends TBI-I-02 (git history ingestion) with algorithmic depth.

**Sub-tasks:**
1. Mine commit history: build file × commit matrix from `git log --name-only --pretty=format:"%H" --since="1 year"` (bounded to recent history). **Temporal window bounds:** cap at 90 days / 500 commits for FP-Growth computation, with full year for basic frequency stats. This prevents unbounded computation on large repos while capturing meaningful co-change patterns.
2. Apply FP-Growth or Apriori algorithm to find frequent file change sets (support threshold: 5+ co-commits, confidence threshold: 0.5). Cap itemset analysis at 1000 unique files — larger repos should scope to changed-file neighborhoods.
3. Create `logically_coupled` edges between entities in frequently co-changed files. Add `logically_coupled` to `EdgeKind`.
4. Weight coupling edges by `support × confidence` scores. Store scores as edge metadata.
5. **Compute temporal context per entity** — not just edges, but a rich temporal signal for each entity:
   ```typescript
   temporal_context: {
     change_frequency: number,         // changes per month
     co_change_partners: string[],     // entities that change with this one (top 5)
     recent_commit_intents: string[],  // classified: "bug fix", "feature", "refactor"
     author_concentration: number,     // 1.0 = single author, 0.0 = many (bus factor proxy)
     stability: number,               // days since last change / age (1.0 = never changes)
   }
   ```
6. Feed temporal context into justification prompts as TEMPORAL SIGNAL section: "Changed 12 times in last 90 days, co-changes with stripe-adapter.ts (85%), primarily bug fixes, single author (bus factor risk)."
7. Feed temporal context into entity profiles (L-14) for MCP delivery.
8. Requires full git history (conflicts with TBI-K-02 shallow clone — need conditional depth).

**Affected files:** `lib/indexer/git-analyzer.ts` (new), `lib/indexer/types.ts`, `lib/temporal/activities/indexing-heavy.ts`

**Done when:** Structurally unrelated files that always change together show `logically_coupled` edges. Each entity has a `temporal_context` object. Justification prompts include temporal signals. Agents see change frequency and co-change partners in entity profiles.

---

#### ~~TBI-L-26: Multi-Layer Knowledge Hypergraph Architecture~~ — REMOVED (Over-Engineered)

The three "layers" (lexical/semantic/vector) already exist as separate data stores: ArangoDB entities (lexical), ArangoDB edges + justifications (semantic), pgvector embeddings (vector). Adding a `layer` field to documents changes no queries and no behavior. The actual capability emerges naturally from L-19 (PageRank) + L-22 (Graph-RAG) + L-07 (kind-aware embeddings).

---

#### TBI-L-27: Rich Context Assembly (`assembleContext()` Orchestrator)

**Priority: P2**

When an agent asks "What is the impact of changing the payment gateway?", the current system returns flat entity matches. The response should chain: vector search → PageRank-weighted graph traversal → code snippet retrieval into a single `assembleContext()` function. A ~50-line orchestrator once L-19 (PageRank) and L-21 (community partitioning) exist.

**Sub-tasks:**
1. Implement `assembleContext(query)` that chains: (a) vector search to find entry node, (b) PageRank-weighted 1-hop graph traversal for bounded neighborhood, (c) code snippet fetch at specific line ranges.
2. Return structured response: `{ entry_point, semantic_neighborhood, code_snippets, confidence, community_context }`.
3. Include PageRank-weighted impact scores for each entity in the neighborhood.
4. Add community membership context: "This entity belongs to the Payment Processing domain (Louvain community #7, 42 entities)."

**Affected files:** `lib/mcp/context-assembly.ts` (new ~50-line orchestrator), `lib/mcp/tools/semantic.ts`

**Done when:** MCP context responses include semantic neighborhood, code snippets, PageRank scores, and community context — not just flat entity matches.

---

### Implementation Order

All hardening waves (0-8) are complete — 48 tasks across 11 categories (A-K) shipped. Remaining work is algorithmic depth (Category L).

**Task audit:** Original 27 L-tasks → 22 remain (19 core + 3 deferred). 5 removed/absorbed: L-05 (already done), L-10 (superseded by L-23), L-12 (superseded by L-19), L-26 (over-engineered), L-01 (absorbed into L-18).

#### Design Principles

These principles govern every task in the Alpha waves. They are non-negotiable.

**1. Edges are the moat.** Every downstream capability — PageRank, impact analysis, topological justification, community detection, staleness cascading — depends on edge quality. Today, no parser creates `calls` edges. The topological sort degenerates to a flat batch. Alpha-1 isn't "the first wave" — it's the load-bearing wall.

**2. Convergence, not pipeline.** The algorithm is not a linear pipeline (parse → embed → ontology → justify). It's multiple independent signals that converge into a unified entity understanding:

```
                    ┌── Structural signal (graph position, PageRank, communities)
                    │
[Parse] → [Graph] ──┼── Intent signal (tests, docs, commits, entry points)
                    │
                    ├── Temporal signal (co-change, blame, drift)
                    │
                    └── Domain signal (ontology, conventions, rules)
                    ↓ converge
              [Entity Profile]  ← the product
                    ↓
              [Synthesis Embedding]
```

**3. The Entity Profile is the product.** What makes us different is not the graph database or the embeddings. It's the comprehensive, pre-computed profile per entity that no other tool produces — combining structural position, business intent, temporal behavior, and calibrated confidence into a single artifact that agents reason about.

**4. Confidence is calibrated, not self-reported.** An LLM saying "confidence: 0.95" is meaningless without calibration. Real confidence is computed from observable signals (has tests? has callers? descriptive name?), with per-dimension breakdown so agents know WHICH aspects they can trust.

**5. Don't over-engineer what emerges naturally.** Node2Vec → 5D structural fingerprint (no ML training needed). Spectral partitioning → just Louvain (sufficient at 1k-50k entity scale). Three-layer hypergraph → already exists as separate stores. Focus on producing SIGNALS, not on delivery format.

---

#### Alpha Waves — Algorithmic Depth (Capturing the Substrate)

> These waves transform the pipeline from a "syntax reader" into an "intent-aware intelligence engine." Each wave has a clear thesis: *what can the product do after this wave that it couldn't before?* Dependencies flow strictly forward. Every wave is 2-3 tasks.
>
> **Differentiator:** Other tools tell agents what code LOOKS LIKE. After these waves, Unerr tells agents what code MEANS, what it AFFECTS, and what CONVENTIONS it should follow — with calibrated confidence in each claim.

**Wave Alpha-1: Call Graph Foundation** — *"What calls what — across files and through events?"*

| Task | What | Why Together |
|------|------|-------------|
| **L-18** (phased) | **L-18a:** Wire SCIP `references` → `calls` edges + fix topological sort (the 80/20 fix — unblocks everything). **L-18b:** Add `emits`, `listens_to`, `implements`, `mutates_state` edge kinds (depth for event-driven codebases) | The foundational gap: **no parser creates `calls` edges today.** Topological sort degenerates. Impact analysis returns nothing. L-18a alone makes the pipeline work. |
| **L-02** | Cross-file call edges in tree-sitter (import symbol table → function-level `calls` edges) | Same problem at the tree-sitter level: call graph is intra-file only |

*Ships:* **L-18a ships first** (2-day task, unblocks every downstream wave). After L-18a: topological sort produces real levels, `get_callers`/`get_callees` return data, impact analysis traces call chains. After L-18b + L-02: complete call graph including events, DI, and cross-file tree-sitter calls. *Depends on:* Nothing.

---

**Wave Alpha-2: Relevance & Confidence** — *"What's actually important — how certain are we — and what does the LLM see?"*

| Task | What | Why Together |
|------|------|-------------|
| **L-19** | Semantic PageRank with edge-type weighting + **calibrated confidence model** (computed from observable signals, not LLM self-reported) | Fixes `logger.info()` ranking. Gives agents per-dimension confidence breakdown they can actually trust. |
| **L-23** | Hierarchical AST summarization with **semantic anchor extraction** (decision points, external calls, mutations, errors preserved verbatim; boilerplate → structural tokens) | Fixes the LLM reading 60 lines of setup code instead of business logic. Anchors become reusable entity metadata. |

*Ships:* ~~Meaningful centrality scores.~~ ✅ Done. ~~Calibrated confidence with breakdown (`{ structural: 0.9, intent: 0.35, temporal: 0.0 }`).~~ ✅ Done (temporal dimension deferred). ~~LLM prompts that contain the soul of each function — semantic anchors, not boilerplate.~~ ✅ Done. *Depends on:* Alpha-1 (edge types for meaningful PageRank weights) — ✅ complete.

---

**Wave Alpha-3: Intent, Communities & Propagation** — *"What does each piece of code really mean — and what cluster does it belong to?"*

| Task | What | Why Together |
|------|------|-------------|
| **L-20** | **Unified intent signal extraction** (4 sources: tests, entry points, commits, naming) + hermeneutic propagation with **signal-aware prompts** | The LLM sees structured signals, not a monolithic prompt. Utility functions understood by purpose, not frequency. |
| **L-21** | Community detection **moved to pre-justification** (Louvain runs before LLM calls, community membership is a structural signal in the prompt) | "This function is in the same community as PaymentService and StripeAdapter" — the LLM knows the domain before reading the code |
| **L-16** | Parse test assertions as intent signal (feeds into L-20's `intent.from_tests[]`) | Tests are the highest-confidence intent source — human-written descriptions of expected behavior |

*Ships:* Justifications that understand WHY code exists from 4 independent signals. Community labels inform the LLM during justification, not after. Signal disagreements are explicitly resolved. *Depends on:* Alpha-1 (complete call graph for propagation), Alpha-2 (PageRank for entry point identification, semantic anchors for prompt quality).

---

**Wave Alpha-4: Embedding & Ontology Intelligence** — *"How should we represent entities for search — and what domain do they serve?"*

| Task | What | Why Together |
|------|------|-------------|
| **L-07** | Kind-aware embedding strategies + **two-pass embedding** (Pass 1: structural, before justification; Pass 2: synthesis, after justification — fixes the ordering bug where first-time embeddings have no justification context) | Modules embedded. Different kinds get different strategies. First-time search works (Pass 1). Intent-aware search after justification (Pass 2). |
| **L-25** | **Three-tier ontology** classification (domain concepts vs architectural patterns vs framework terms) with cross-tier mapping (`Payment` → `PaymentService, PaymentController, PaymentHandler`) | Ontology tells the LLM "PaymentHandler is domain, Controller is architecture" — turns generic classifications into specific ones |

*Ships:* Entities embedded by their nature. Two-pass embedding solves the ordering problem. Ontology distinguishes "Invoice" (domain) from "Handler" (architecture) from "Prisma" (framework). Cross-tier mapping gives the LLM architectural context. *Depends on:* Alpha-2 (AST summaries feed into embedding documents), Alpha-3 (justification data for Pass 2 embeddings).

---

**Wave Alpha-5: Structural Search & Liveness** — *"How do we find code by structure — and what's actually alive?"*

| Task | What | Why Together |
|------|------|-------------|
| **L-22** | Graph-RAG embeddings with **structural fingerprint** (5D: PageRank, community, depth, fan ratio, boundary — no Node2Vec/ML training needed) | Two functions with identical code but different graph positions produce different search rankings |
| **L-17** | Dead code detection exclusions for plugin/event/config patterns + `dead_code_reason` field | Partially solved by Alpha-1's `listens_to` edges + Alpha-3's community context; this adds framework-specific exclusion patterns |

*Ships:* Search that understands code topology via structural fingerprint. Dead code detection that doesn't flag event handlers, plugin registrations, or config exports. *Depends on:* Alpha-2 (PageRank for fingerprint), Alpha-3 (community labels for fingerprint), Alpha-4 (kind-aware embeddings as base).

---

**Wave Alpha-6: Temporal Patterns & Rules** — *"What patterns exist across time — and what rules should the team follow?"*

| Task | What | Why Together |
|------|------|-------------|
| **L-24** | Git co-change mining + **temporal context per entity** (`change_frequency`, `co_change_partners`, `recent_commit_intents`, `author_concentration`, `stability`) fed into justification prompts and entity profiles | Captures hidden developer knowledge. Temporal signal enriches both justification and search. |
| **L-13** | **Code-first** convention discovery (structural patterns found from code, then named by LLM using justifications) — scoped by Louvain community | Conventions discovered from actual code patterns, not just LLM guesses about justification data |

*Ships:* Hidden coupling made visible. Per-entity temporal context in prompts and profiles. Intent-level rules discovered from code structure first, named by LLM second. *Depends on:* Alpha-3 (reliable justifications + community context for rule synthesis). L-24 needs full git history.

---

**Wave Alpha-7: Entity Profiles & Freshness** — *"How do we deliver intelligence to agents — and keep it fresh?"*

| Task | What | Why Together |
|------|------|-------------|
| **L-14** | **Entity Profile cache** — pre-computed profiles in Redis (structural + intent + temporal + confidence signals in one object). All MCP tools return profile projections. Single cache read replaces 3-5 DB calls. **`refresh_context` MCP tool** lets agents update profiles mid-session for files they've modified. | The Entity Profile IS the product. This is how agents consume everything the pipeline produces — including during agentic loops where the agent's own changes should be immediately visible. |
| **L-09** | **Semantic staleness** — change-type aware cascading (signature change → always cascade; comment edit → never; body refactor → cosine check) | Smarter than a single cosine threshold. Prevents false cascades AND missed cascades. |
| **L-27** | Rich context assembly (`assembleContext()` chains vector → PageRank neighborhood → code snippets → entity profiles) | Agents get structured context bundles. ~50-line orchestrator once profiles and communities exist. |

*Ships:* MCP responses deliver Entity Profiles with all signals. Re-justification understands WHAT changed, not just whether embeddings moved. Context assembly is a single function call. *Depends on:* Alpha-5 (structural fingerprint for profiles), Alpha-4 (embeddings for staleness checks).

---

**Wave Alpha-8: Parser Fidelity** — *"Are we capturing everything the parsers can give us?"*

| Task | What | Why Together |
|------|------|-------------|
| **L-03** | Preserve original entity `kind` through KIND_TO_COLLECTION mapping — flows through justification prompts, embeddings, and MCP tools | Methods distinguished from functions, type aliases from variables, throughout the entire pipeline |
| **L-04** | Multi-line import parsing (TS) + Go struct/interface member extraction | Parser completeness for the two most common edge cases |
| **L-08** | Dual embedding variants (code-only + semantic) with weighted combination at query time | Search resilient to LLM hallucinations in justification text. Complements two-pass embedding (L-07): Pass 1 = structural, L-08 code variant = code-only fallback, Pass 2 = synthesis |

*Ships:* Higher-fidelity entity model. Search that works even when justifications are wrong. *Depends on:* Nothing (can run in parallel with any wave after Alpha-4).

---

**Deferred Backlog (P3 — no dependencies, do anytime)**

| Task | What | Effort |
|------|------|--------|
| **L-06** | AST-aware cyclomatic + cognitive complexity estimation | 2-4h |
| **L-11** | Quality scoring with positive reinforcement | 2h |
| **L-15** | Adaptive RRF k-parameter based on result set variance | 1h |

---

#### Dependency Flow (Strict Forward-Only)

```
Alpha-1 (Call Graph Foundation)
  │
  ├─► L-18a ships first (2 days) ── unblocks ALL downstream waves
  │
  └─► Alpha-2 (Relevance & Confidence) ── edges feed PageRank + semantic anchors
        │
        └─► Alpha-3 (Intent, Communities & Propagation) ── PageRank + anchors feed signal-aware prompts
              │
              └─► Alpha-4 (Embedding & Ontology) ── justifications + communities feed Pass 2 embeddings
                    │
                    ├─► Alpha-5 (Structural Search & Liveness) ── fingerprints + communities feed Graph-RAG
                    │     │
                    │     ├─► Alpha-6 (Temporal) ── communities scope convention discovery
                    │     │
                    │     └─► Alpha-7 (Entity Profiles & Freshness) ── all signals converge into profiles
                    │
                    └─► Alpha-8 (Parser Fidelity) ── independent, parallelizable
```

**Critical path:** Alpha-1 (L-18a) → Alpha-2 → Alpha-3 → Alpha-4 → Alpha-7
This chain goes from "no call graph" to "agents receive entity profiles with calibrated confidence."

#### Summary

| Wave | Tasks | Count | Thesis | Key Enhancement |
|------|-------|-------|--------|-----------------|
| Alpha-1 | L-18 (phased), L-02 | 2 | Complete the call graph | ✅ L-18a + L-02 done. Remaining: L-18b (event edges) |
| Alpha-2 | L-19, L-23 | 2 | Relevance + confidence + what LLM sees | Calibrated confidence model; semantic anchor extraction |
| Alpha-3 | L-20, L-21, L-16 | 3 | Intent signals + communities + propagation | L-21 moved to pre-justification; signal-aware prompts |
| Alpha-4 | L-07, L-25 | 2 | Smart embeddings + ontology | Two-pass embedding fixes ordering bug; three-tier ontology |
| Alpha-5 | L-22, L-17 | 2 | Structural search + liveness | 5D structural fingerprint (no ML training); L-17 moved here |
| Alpha-6 | L-24, L-13 | 2 | Temporal patterns + rules | Temporal context per entity; code-first convention discovery |
| Alpha-7 | L-14, L-09, L-27 | 3 | Entity profiles + freshness | Entity Profile cache; semantic staleness (change-type aware) |
| Alpha-8 | L-03, L-04, L-08 | 3 | Parser fidelity + search resilience | Kind flows through entire pipeline |
| Backlog | L-06, L-11, L-15 | 3 | P3 polish (no dependencies) | — |

**Original:** 27 tasks in 5 waves (one with 13 tasks). **Current:** 19 core tasks in 8 waves of 2-3 + 3 deferred + 5 removed/absorbed. **Key structural changes vs previous plan:** L-21 moved from Alpha-5 to Alpha-3 (communities inform justification); L-17 moved from Alpha-3 to Alpha-5 (benefits from community context); L-18 split into phased delivery (L-18a unblocks immediately).

---

## 21. Validation History

> Compact log of real-world validation runs. Detailed findings have been merged into the TBI task descriptions in Section 20 above.

### Run 1: 2026-02-27 (kap10-server, Lightning AI)

**Config:** `LLM_PROVIDER=ollama`, `LLM_BASE_URL=https://lightning.ai/api/v1`, `LLM_MODEL=lightning-ai/gpt-oss-20b`
**Result:** Graph stage fully correct (697 files, 1,786 functions, 591 call edges, 1,267 import edges). All LLM-dependent stages failed silently — Lightning AI endpoint returned HTTP 405 for every justification call. Pipeline reported `status: "ready"` with no error.
**Bugs found:** 6 — TBI-G-01, TBI-G-02, TBI-G-03, TBI-G-04, TBI-B-01, TBI-D-02.
**Fixes shipped:** 2026-02-28. All 6 bugs resolved. LLM provider switched to `LLM_PROVIDER=openai`. Re-index button added to repo overview page. See TBI task descriptions for implementation details.

### Wave 5 Implementation: 2026-03-01

**Tasks completed:** 6 of 6 — TBI-K-04, TBI-K-12, TBI-C-01, TBI-C-02, TBI-I-02, TBI-J-01.
**Summary:**
- **TBI-K-04** (SCIP decoder robustness): Buffer bounds checking at 3 points in `scip-decoder.ts` + per-document try-catch isolation. Truncated `.scip` files produce partial results instead of crashes.
- **TBI-K-12** (ONNX session lifecycle): Session rotation after 500 embed calls with `disposeSession()`, memory logging, configurable via `ONNX_SESSION_MAX_CALLS`.
- **TBI-C-01** (Decorator extraction): `pendingDecorators` tracking in TS tree-sitter parser captures `@Decorator()` patterns. Injected into justification prompt Section 0.5.
- **TBI-C-02** (Cross-level propagation): Accumulated `accumulatedChangedIds` across ALL prior topological levels (not just N-1). 5000-entry cap for bounded workflow state.
- **TBI-I-02** (Git history): `getFileGitHistory()` on `IGitHost` port runs `git log --follow`. Fetched per unique file in `justifyBatch`, injected as prompt Section 0.75 "Historical Context."
- **TBI-J-01** (MCP file_context): New `file_context` tool returns all entities with justifications, feature tags, domain concepts, caller/callee counts in one response.

### Wave 6 Implementation: 2026-03-01

**Tasks completed:** 5 of 5 — TBI-I-03, TBI-I-05, TBI-J-02, TBI-A-04, TBI-C-03.
**Summary:**
- **TBI-I-03** (System boundaries): `boundary-classifier.ts` with `BoundaryCategory` type and curated maps for npm (120+ packages), PyPI, Go, Maven. `classifyBoundary()` + `extractExternalPackageName()` exports. All 4 language parsers (TS, Python, Go, Java) updated to create `is_external` import edges with `package_name` and `boundary_category` metadata. External edges use `to_id: "external:${pkgName}"` format.
- **TBI-I-05** (Team conventions): `conventions-generator.ts` generates `TEAM_CONVENTIONS.md` (markdown) or `.cursorrules` format from confirmed patterns + active rules + ontology. Export route at `GET /api/repos/{repoId}/export/conventions?format=markdown|cursorrules`. Rules categorized as MUST/SHOULD/MAY, patterns grouped by type with adherence %.
- **TBI-J-02** (Unified knowledge doc): Extended `context-document-generator.ts` to fetch confirmed patterns + active rules and render a "Team Conventions" section with architecture rules and detected patterns. The unified `UNERR_CONTEXT.md` now includes 7 sections.
- **TBI-A-04** (Multi-language parsers): 6 new language plugins: C (functions, structs, enums, typedefs, `#include` edges), C++ (classes/inheritance, structs, namespaces, methods, `#include` edges), C# (classes, interfaces, structs, records, enums, namespaces, methods, `using` edges), PHP (classes, interfaces, traits, enums, methods, `use` edges), Ruby (classes/modules, methods, `require_relative` edges), Rust (structs, enums, traits, impl→implements edges, type aliases, modules, `use crate::` edges). All registered in `registry.ts` (10 total plugins).
- **TBI-C-03** (Workspace manifests): `RepoRecord.manifestData` field added to relational store. `updateRepoManifest()` method on `IRelationalStore` port. Ontology activity persists manifest JSON (project_name, tech_stack, project_domain, project_description) after storing ontology to ArangoDB.

### Wave 7 Implementation: 2026-03-01

**Tasks completed:** 7 of 7 — TBI-I-04, TBI-J-03, TBI-D-03, TBI-A-05, TBI-C-04, TBI-C-05, TBI-K-14.
**Summary:**
- **TBI-D-03** (Rewind → rule tracing): `markLedgerEntryRuleGenerated()` added to `IGraphStore` port, implemented in ArangoDB adapter (sets `rule_generated: true`, `rule_id`, `rule_generated_at`) and in-memory fake. Called in `synthesizeAntiPatternRule` after `upsertRule()`, before token usage logging. Rewind entries now link to the rules they generated.
- **TBI-C-05** (Heuristic bypass): Entities with `heuristicHint.confidence >= 0.9` and 0 inbound callers now skip LLM entirely. Canned justification created with `model_tier: "heuristic"`, `model_used: "heuristic-bypass"`. Merged into results before storage. Quality scorer already skips heuristic-tier justifications. Pipeline log reports bypass count. Saves 20-40% of LLM calls for large repos.
- **TBI-C-04** (Signature extraction): TS arrow functions now extract params via secondary regex + capture return type. Method signatures preserve `public`/`private`/`protected`/`static` modifiers. Python parser handles multi-line params by scanning forward up to 20 lines for closing paren. Go parser preserves pointer receiver `*` flag in method signature (e.g., `(*Receiver).Method()`). Prompt-builder labels updated to "Parameter count" and "Return type".
- **TBI-A-05** (Polyglot monorepo): `detectLanguagePerRoot()` added to `monorepo.ts` — scans each workspace root's files to 3-directory depth using `readdirSync`, counts file extensions via `ROOT_EXTENSION_LANGUAGE` map, returns dominant language per root. `prepareRepoIntelligenceSpace` result extended with `languagePerRoot?: Record<string, string>` field, populated for multi-root repos.
- **TBI-I-04** (Drift documentation trigger): New `drift-documentation.ts` activity with `proposeDriftDocumentation()` — when drift detected, LLM generates updated taxonomy, business purpose, and ADR draft. `DocumentationProposal` type with old/proposed classification + ADR + confidence + status. `documentation_proposals` ArangoDB collection via 3 new port methods: `upsertDocumentationProposal`, `getDocumentationProposals`, `updateDocumentationProposalStatus`. Port/adapter/fake implemented. Activity registered in light worker.
- **TBI-J-03** (Incremental context refresh): New `context-refresh.ts` activity with `refreshKnowledgeSections()` — determines invalidated sections based on change types (changed→feature_map+risk_map, added/deleted→domain_model, cascade→risk_map). Debounce gate: skips if < 10 total changes or < 24h since last refresh with moderate changes. Regenerates full context document via existing `generateContextDocument()`. Wired into `incrementalIndexWorkflow` as Step 7.5 after cascade re-justify, with best-effort error handling.
- **TBI-K-14** (Chunked msgpack): `serializeSnapshotChunked()` added to `graph-serializer.ts` — splices entities in batches of 1000 via `Array.splice(0, chunkSize)`, serializes each batch as a partial envelope, clears chunk after pack, concats buffers. Logs pre/post memory via `process.memoryUsage()`. `exportAndUploadGraph` uses chunked mode for repos with > 5000 entities, with per-chunk heartbeat progress callbacks. Standard `serializeSnapshot` used as fast path for smaller repos.
