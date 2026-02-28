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

**Orchestration:** Temporal workflows. Each stage is a Temporal activity with heartbeats, timeouts, and retry policies. Pipeline progress is tracked in PostgreSQL (`PipelineRun` table) and streamed to the dashboard via SSE.

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

1. **Clone the repository** to `/data/workspaces/{orgId}/{repoId}` using `container.gitHost.cloneRepo()`. For CLI uploads, downloads the zip from Supabase Storage and extracts it.

2. **Get the commit SHA** via `git rev-parse HEAD`. This SHA becomes the repo's `lastIndexedSha` — used for incremental indexing SHA gap detection and displayed in the dashboard.

3. **Scan the intelligence space** via `scanWorkspace()`:
   - Runs `git ls-files --cached --others --exclude-standard` (respects `.gitignore`)
   - Falls back to `find` if git is unavailable
   - Skips known noise: `node_modules`, `.git`, `.next`, `dist`, `vendor`, `__pycache__`, lockfiles, binary files
   - Returns a flat list of `ScannedFile[]` with `relativePath`, `absolutePath`, `extension`

4. **Detect languages** via `detectLanguages()`:
   - Groups files by extension: `.ts`/`.tsx` → typescript, `.py` → python, `.go` → go
   - Sorts by file count (dominant language first)
   - This determines which SCIP indexers and language plugins to run

5. **Detect monorepo roots** via `detectWorkspaceRoots()`:
   - Finds directories with their own `package.json`, `go.mod`, `pyproject.toml`
   - Critical for monorepo support — each root gets its own SCIP indexing pass

### What This Produces

A lightweight result containing the workspace path, detected languages, monorepo roots, and the HEAD commit SHA. Only this small payload crosses the Temporal boundary. The actual intelligence space lives on disk.

### Implementation Status

| Component | Status | Details |
|-----------|--------|---------|
| GitHub clone | Done | Delegates to `gitHost.cloneRepo()` with ref and installationId |
| CLI upload extraction | Done | Downloads zip from Supabase Storage, writes to temp file, calls `unzip` |
| HEAD SHA reading | Done | `execFileSync("git", ["rev-parse", "HEAD"])` with error handling |
| `scanWorkspace()` | Done | Real `git ls-files` integration with `find` fallback, graceful empty for non-existent dirs |
| `detectLanguages()` | Done | Groups by extension, sorts by frequency |
| `detectWorkspaceRoots()` | Done | Reads `package.json`/`go.mod`/`pyproject.toml` |
| Entity hash (`entity-hash.ts`) | Done | SHA-256 over `(repoId, filePath, kind, name, signature)` → 16-char hex |

**Completion: ~95%**

**What's pending:** Nothing critical. The workspace path is hardcoded to `/data/workspaces/${orgId}/${repoId}` which requires the worker to have that mount point — but that's by design (Docker volume).

**Why the pending work matters:** N/A — this stage is effectively complete.

**Progress:** 0% → 25%

---

## 5. Stage 2: SCIP Analysis

**Activity:** `runSCIP` | **Queue:** heavy-compute | **Timeout:** 30 minutes
**Source:** `lib/temporal/activities/indexing-heavy.ts`

### What Is SCIP?

SCIP (Sourcegraph Code Intelligence Protocol) is a compiler-grade code analysis tool. Unlike regex or tree-sitter parsing, SCIP resolves types, follows imports across files, and builds a precise symbol table. It answers questions like "this variable `user` on line 47 — is it the same `User` type defined in `models/user.ts:12`?"

This precision is what makes Unerr's call graph and impact analysis reliable. Regex can guess that `foo()` calls `bar()`. SCIP *knows* it, because it resolves the full symbol path.

### What Happens

1. **Run the SCIP indexer** for each detected language:
   - **TypeScript:** `npx @sourcegraph/scip-typescript index --output index.scip` (10-minute timeout, 100MB output buffer). Falls back gracefully if no `tsconfig.json`.
   - **Python:** `scip-python` (currently a stub — see status below)
   - **Go:** `scip-go` (currently a stub — see status below)

2. **Parse the SCIP output** (protobuf binary) into `ParsedEntity[]` and `ParsedEdge[]`:
   - Entities: functions, classes, interfaces, types, variables — with precise `start_line`, `end_line`, `signature`, `documentation`
   - Edges: `calls` (function → function), `imports` (file → file), `extends` (class → class), `implements` (class → interface)

3. **Fill bodies from source** via `fillBodiesFromSource()`:
   - For entities that have line numbers but no `body` text, reads the source file and slices the relevant lines (capped at `MAX_BODY_LINES = 3000`)
   - Also extracts doc comments (JSDoc, docstrings, Go doc comments)
   - The body text is critical — it's what the LLM reads during justification

4. **Write to ArangoDB** via `writeEntitiesToGraph()`:

   a. **Bootstrap schema** — ensures all 22 document collections, 7 edge collections, and all indexes exist (idempotent via `bootstrapGraphSchema()`)

   b. **Deterministic hashing** — every entity gets a stable `_key` via SHA-256 over `(repoId, file_path, kind, name, signature)` → 16-char hex. Re-indexing the same code produces the same keys → AQL `UPSERT` updates in place.

   c. **Edge hashing** — same principle: SHA-256 over `(from_key, to_key, edge_kind)` → 16-char hex `_key`.

   d. **Auto-generated file entities** — for every `file_path` seen, a file entity is created (or upserted). `contains` edges link files to their child entities.

   e. **Bulk upsert** — `bulkUpsertEntities()` and `bulkUpsertEdges()` write to ArangoDB using `collection.import()` with `onDuplicate: "update"` in batches of 1000.

   f. **Shadow versioning** — if `indexVersion` is set, every entity/edge is stamped with `index_version`. This enables atomic shadow swaps in Stage 4.

### What This Produces

Written to ArangoDB:
- **Entity collections:** `files`, `functions`, `classes`, `interfaces`, `variables`
- **Edge collections:** `contains`, `calls`, `imports`, `extends`, `implements`

Each entity document contains: `_key` (SHA-256 hash), `org_id`, `repo_id`, `kind` (function/class/interface/...), `name`, `file_path`, `start_line`, `end_line`, `signature`, `body` (actual source code, max 3000 lines), `documentation` (doc comments), `language`, optional `index_version`, and timestamps.

### Implementation Status

| Component | Status | Details |
|-----------|--------|---------|
| TypeScript SCIP | Done | Runs `scip-typescript`, hand-written protobuf varint decoder parses `.scip` output into entities+edges |
| Python SCIP | Stub | Runs `scip-python` CLI but **always returns empty arrays**. `TODO: Parse SCIP output using shared decoder` |
| Go SCIP | Stub | Runs `scip-go` CLI but **always returns empty arrays**. `TODO: Parse SCIP output` |
| `fillBodiesFromSource()` | Done | Groups entities by file, reads source, slices lines by `start_line`/`end_line`, extracts doc comments |
| `writeEntitiesToGraph()` | Done | Real ArangoDB bulk upsert via `collection.import()` in batches of 1000 |
| ArangoDB `bulkUpsertEntities` | Done | Groups by kind → `KIND_TO_COLLECTION` mapping, `onDuplicate: "update"` |
| ArangoDB `bulkUpsertEdges` | Done | Groups by kind, qualifies vertex handles to `collection/key` format |

**Completion: ~70%** (TypeScript is fully working; Python and Go always fall through to tree-sitter)

**Open Tasks:**

| # | Task | Priority | TBI Ref |
|---|------|----------|---------|
| 1 | Python SCIP parsing — `scip-python` binary runs but protobuf output is never decoded. Python repos lose precise cross-file symbol resolution. | P1 | [TBI-A-01](#tbi-a-01-activate-the-python-scip-decoder) |
| 2 | Go SCIP parsing — `scip-go` binary runs but output is discarded. | P1 | [TBI-A-02](#tbi-a-02-activate-the-go-scip-decoder) |
| 3 | Java/C#/Scala/PHP/Ruby/Rust — no SCIP indexers or tree-sitter plugins for these languages | P2 | [TBI-A-03](#tbi-a-03-java-support-via-scip-java), [TBI-A-04](#tbi-a-04-tree-sitter-parsers-for-c-c-c-scala-php-ruby-rust) |
| 4 | Polyglot monorepo — only the primary detected language gets SCIP; other languages fall through | P3 | [TBI-A-05](#tbi-a-05-monorepo-language-detection-for-polyglot-repos) |

**Why this matters:** Without SCIP for Python/Go, call graph, impact analysis, dead code detection, and import chain analysis are all wrong for those languages. Features 2.3, 2.4, 2.8, 5.3, 5.5, 5.6 are degraded.

**Intelligence Enhancements (once edges are written):**

| # | Enhancement | Priority | TBI Ref |
|---|-------------|----------|---------|
| ~~1~~ | ~~Blast radius pre-computation~~ ✅ — `fan_in`, `fan_out`, `risk_level` computed after finalization in Step 4b. High-risk entities (≥10 fan-in/fan-out) flagged with red border + badge in annotated code viewer. | ~~P2~~ | [TBI-H-05](#tbi-h-05-blast-radius-pre-computation-semantic-impact-weights) |
| 2 | Tech-stack & system boundary extraction — identify third-party package imports and outbound HTTP calls; produce a `system_boundaries` collection and "External Systems" layer in Blueprint | P2 | [TBI-I-03](#tbi-i-03-tech-stack--system-boundary-extraction) |

**Progress:** 25% → 50%

---

## 6. Stage 3: Tree-Sitter Fallback Parsing

**Activity:** `parseRest` | **Queue:** heavy-compute | **Timeout:** 30 minutes
**Source:** `lib/temporal/activities/indexing-heavy.ts`

### Why a Fallback Is Needed

SCIP is precise but not universal. It fails or produces nothing for:
- Config files (`tsconfig.json`, `package.json`, `.env`)
- Files without a `tsconfig.json` in their path (common in monorepos)
- Languages without a SCIP indexer (YAML, Markdown, SQL, shell scripts)
- Python and Go files (since SCIP parsing is currently stubbed)
- Partial or broken source files

### What Happens

1. **Identify uncovered files** — compares the workspace file list against files that SCIP already processed.

2. **Create file entities** — every file in the workspace gets a file entity in ArangoDB, regardless of whether we can parse its contents.

3. **Parse with language plugins** — for each uncovered file, the matching language plugin runs:
   - **TypeScript plugin** (`lib/indexer/languages/typescript/tree-sitter.ts`): Regex-based extraction for `export function`, arrow functions, `class`, `interface`, `type`, `enum`. Also extracts import edges for internal imports (`./`, `@/`, `~/`). End-line detection via brace-depth tracking. JSDoc extraction. Cyclomatic complexity estimation.
   - **Python plugin** (`lib/indexer/languages/python/tree-sitter.ts`): Extracts `def`, `class`, decorators, methods. End-line detection via indentation. Docstring extraction. Complexity estimation.
   - **Go plugin** (`lib/indexer/languages/go/tree-sitter.ts`): Extracts `func`, receiver methods, `type struct`, `type interface`. Brace-depth end-line detection. Go doc comment extraction.
   - **Generic plugin**: Creates bare file entities for unsupported file types.

4. **Create containment edges** — `contains` edges from file entity to each extracted child entity.

5. **Heartbeat every 100 files** — prevents Temporal from timing out on large repos.

6. **Write to ArangoDB** — same `writeEntitiesToGraph()` pipeline as Stage 2.

### Implementation Status

| Component | Status | Details |
|-----------|--------|---------|
| TypeScript parser | Done | Regex-based (not tree-sitter WASM — avoids native dependency issues). Extracts functions, classes, interfaces, types, enums, arrow functions, imports. Body capped at `MAX_BODY_LINES = 3000` |
| Python parser | Done (partial) | Extracts classes, functions, methods, decorators, `member_of` edges. **Missing: import edge extraction** — no `import` edges created for Python files |
| Go parser | Done (partial) | Extracts functions, receiver methods, structs, interfaces, type aliases, intra-file call edges. **Missing: import edge extraction** |
| Generic fallback | Done | Creates bare file entities for unsupported file types |
| Heartbeat every 100 files | Done | Prevents Temporal timeout on large repos |

**Completion: ~90%**

**Open Tasks:**

| # | Task | Priority | TBI Ref |
|---|------|----------|---------|
| 1 | Python import edges — `imports` edges not emitted by the Python tree-sitter parser; import chain analysis (Feature 2.4) returns empty for Python repos | P2 | [TBI-B-03](#tbi-b-03-python-and-go-import-edge-extraction-in-tree-sitter) |
| 2 | Go import edges — same gap for Go | P2 | [TBI-B-03](#tbi-b-03-python-and-go-import-edge-extraction-in-tree-sitter) |
| 3 | TypeScript decorator extraction — `@Injectable()`, `@Controller()` not captured; LLM justification lacks framework context | P2 | [TBI-C-01](#tbi-c-01-typescript-decorator-extraction) |
| 4 | Function signature extraction — tree-sitter parsers don't extract parameter types/return types; signature field is a bare name | P3 | [TBI-C-04](#tbi-c-04-function-signature-extraction-in-tree-sitter-fallback) |

**Why this matters:** Import edges are the backbone of impact analysis. Missing decorators reduce justification accuracy for framework-heavy TypeScript repos (NestJS, Angular).

**Progress:** 50% → 75%

---

## 7. Stage 4: Finalization & Shadow Swap

**Activity:** `finalizeIndexing` | **Queue:** light-llm | **Timeout:** 5 minutes
**Source:** `lib/temporal/activities/indexing-light.ts`

### What Happens

1. **Shadow swap** — if this is a re-index (repo was already `"ready"`), the `indexVersion` mechanism enables zero-downtime re-indexing:
   - During Stages 2–3, all new entities/edges were stamped with the current `indexVersion`
   - Now, stale entities from deleted files, renamed functions, or refactored classes are atomically removed

2. **Update repo status** in PostgreSQL — sets `status: "indexing"`, `progress: 90`, and entity counts (`fileCount`, `functionCount`, `classCount`).

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

### Implementation Status

| Component | Status | Details |
|-----------|--------|---------|
| Schema bootstrap | Done | Idempotent `bootstrapGraphSchema()` |
| Repo status update | Done | Via `relationalStore.updateRepoStatus()` |
| Shadow swap | Done (with caveat) | Calls `deleteByIndexVersion(orgId, repoId, "__old__")`. **Caveat:** deletes entities where `index_version == "__old__"` literally, but old entities are never explicitly marked `"__old__"`. The correct approach would be `index_version != currentIndexVersion`. In practice, shadow swap may be a no-op unless old entities happened to have `"__old__"` as their version. |
| Blast radius pre-computation | Done | AQL COLLECT on `calls` edges, fan_in/fan_out thresholds, risk_level written to entity docs |

**Completion: ~80%**

> **Confirmed by real-world data:** All 3,024 entities in the `kap10-server` repo have `index_version: null` — confirming shadow versioning is not being stamped on write. The shadow swap is entirely inoperative. See [Section 21](#21-real-world-validation-repo-diagnostic).

**Open Tasks:**

| # | Task | Priority | TBI Ref |
|---|------|----------|---------|
| 1 | Fix shadow swap logic — entities are never stamped with `index_version` (all null in production). `deleteByIndexVersion("__old__")` is a no-op. Old entities accumulate forever across re-indexes. | P1 | [TBI-B-01](#tbi-b-01-fix-shadow-swap-logic-in-finalization) |
| 2 | `last_indexed_at` never set — PostgreSQL `repos.last_indexed_at` stays `null` even after `index_progress = 100` | P3 | [TBI-G-01](#tbi-g-01-fix-last_indexed_at-never-being-set) |

**Why this matters:** Ghost entities from previous runs pollute semantic search, dead code detection, project stats, and entity browser. Without `last_indexed_at`, the dashboard can't show "last indexed X minutes ago."

**Progress:** 75% → 95%

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

### Implementation Status

| Component | Status | Details |
|-----------|--------|---------|
| File path fetching | Done | Queries `files` collection in ArangoDB |
| Embedding text building | Done | Entity + signature + doc + body + justification enrichment |
| ONNX inference | Done | nomic-embed-text-v1.5, 768d, CPU-only, 512-token limit |
| pgvector upsert | Done | Sub-batches of 10, HNSW index |
| Orphan cleanup | Done (conditional) | Calls `vectorSearch.deleteOrphaned()` **if the adapter implements it**. Silently no-ops otherwise. |
| File-level fallback embedding | Done | Files with no code entities get a fallback doc: `"File: {path}\nName: {filename}"` |
| Status transitions | Done | `embedding` → `ready` in PostgreSQL |

**Completion: ~95%**

**Open Tasks:**

| # | Task | Priority | TBI Ref |
|---|------|----------|---------|
| 1 | Orphan cleanup guarantee — `deleteOrphaned` is optional (guarded by `if (container.vectorSearch.deleteOrphaned)`). If the adapter doesn't implement it, orphan embeddings accumulate silently after re-indexes. | P2 | [TBI-B-02](#tbi-b-02-guarantee-orphan-embedding-cleanup-after-re-index) |

**Why this matters:** Orphaned embeddings mean semantic search (Feature 2.1) returns ghost results for entities that no longer exist in the graph.

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

2. **Read project manifests** — `package.json`, `pyproject.toml`, `go.mod` from the workspace path for:
   - `project_name`, `project_description`
   - `tech_stack` (framework dependencies)

2b. **Fetch user-provided context** — if the repo has `contextDocuments` (set via `PUT /api/repos/{repoId}/context`), appends it to the project description sent to the LLM. This anchors the ontology vocabulary to the team's actual terminology (e.g., "Ledger Domain" instead of "Transaction Module").

3. **LLM refinement** — sends raw terms + project metadata to `LLM_MODELS.standard` with `DomainOntologySchema` for structured output. Falls back to raw terms if LLM fails (graceful degradation). The LLM returns:
   - **Domain terms** with definitions (e.g., "Invoice: a billing document sent to customers")
   - **Ubiquitous language map** — canonical term → aliases (e.g., "User" → ["Customer", "Account", "Member"])
   - **Term relationships** (e.g., "Invoice" → belongs_to → "Billing")

4. **Store in ArangoDB** — `domain_ontologies` collection via `graphStore.upsertDomainOntology()`.

### Implementation Status

| Component | Status | Details |
|-----------|--------|---------|
| Domain term extraction | Done | `extractDomainTerms()` in `ontology-extractor.ts` — splits entity names, frequency-ranks |
| Project manifest reading | Done | Reads `package.json`/`pyproject.toml`/`go.mod` for project context |
| Context seeding integration | Done | Fetches `repo.contextDocuments` from relational store, appends to project description for LLM anchoring |
| LLM-based refinement | Done | `generateObject()` with `DomainOntologySchema`, graceful fallback to raw terms |
| ArangoDB storage | Done | `upsertDomainOntology()` |

**Completion: ~90%**

> **Confirmed by real-world data:** The `kap10-server` repo produced a `domain_ontologies` document with `domain: null`, `subdomain: null`, `entities_count: 0` — an empty shell. The LLM ontology call either failed silently or returned no structured data. See [Section 21](#21-real-world-validation-repo-diagnostic).

**Open Tasks:**

| # | Task | Priority | TBI Ref |
|---|------|----------|---------|
| 1 | Workspace path dependency — ontology reads manifests from `/data/workspaces/{orgId}/{repoId}`. If the workspace is cleaned up before the ontology workflow runs, manifest reading fails silently. Should persist manifest data during Stage 1. | P2 | [TBI-C-03](#tbi-c-03-persist-workspace-manifests-for-ontology-context) |
| 2 | LLM failure transparency — when the LLM ontology call fails (e.g., HTTP 405), the fallback silently writes an empty record with `domain: null`. Failures should be surfaced in the pipeline log with the error code. | P2 | [TBI-G-02](#tbi-g-02-llm-405-detection-and-user-surfacing) |

**Why this matters:** Without manifest data, ontology terms are generic. A null domain/subdomain means the justification stage has no "dictionary" — every feature_tag defaults to `"unclassified"`, collapsing the entire Feature Blueprint.

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

### Implementation Status

| Component | Status | Details |
|-----------|--------|---------|
| Topological sort | Done | Kahn's algorithm with cycle-breaking in `topological-sort.ts` |
| Staleness check | Done | SHA-256 body hash comparison + callee change tracking |
| Dead code detection | Done | Zero-inbound-reference check, excludes exports/tests/entry points |
| Graph context building | Done | `getBatchSubgraphs()` — AQL ANY traversal, batches of 50, 1-5 hops |
| Model routing | Done | 3-tier routing by centrality, complexity, caller count, safety patterns |
| Dynamic batching | Done | Greedy bin-packing with dual input/output token constraints |
| Prompt builder | Done | Entity-specific templates, body truncation by tier |
| LLM call + retry | Done | 3-stage backoff (2s/8s/30s), batch→individual fallback, UTILITY fallback |
| Quality scoring | Done | Boilerplate, vagueness, length checks |
| Chain-of-thought pipeline logging | Done | Per-entity reasoning logged via `createPipelineLogger()` — visible live in Pipeline Monitor |
| Context seeding injection | Done | Fetches `repo.contextDocuments`, passes to `buildJustificationPrompt()` as "Project Context (provided by the team)" section |
| ArangoDB justification upsert | Done | Bi-temporal `valid_to` on old records |
| Ontology refinement | Done | Every 20 levels, 3+ frequency threshold, max 50 new terms |
| Context propagation | Done | Bi-directional feature tag + domain concept propagation |
| Feature aggregation | Done | Entry point detection, hot path BFS, taxonomy breakdown |
| Justification embedding | Done | 1500-char cap, chunks of 20, dedicated pgvector table |

**Completion: ~95%**

> **Confirmed by real-world data:** All 3,024 justifications for `kap10-server` returned `business_purpose: "Classification failed: Method Not Allowed"` with `taxonomy: UTILITY`, `feature_tag: "unclassified"`, `confidence: 0.3`, `model: null`. The Lightning AI endpoint returned HTTP 405 for every LLM call. All downstream stages (ontology, health report, feature aggregation) received garbage input. See [Section 21](#21-real-world-validation-repo-diagnostic).

**Open Tasks:**

| # | Task | Priority | TBI Ref |
|---|------|----------|---------|
| 1 | LLM 405 / endpoint misconfiguration detection — when the LLM returns HTTP 405, the current fallback silently writes stub justifications. This makes the pipeline appear to succeed while producing entirely worthless data. Must surface the error as a pipeline failure. | P1 | [TBI-G-02](#tbi-g-02-llm-405-detection-and-user-surfacing) |
| 2 | Cross-level callee change propagation — `calleeChangedIds` scoped per-level only; callee changes from level N-2 don't propagate to level N. Affects <5% of entities. | P2 | [TBI-C-02](#tbi-c-02-cross-level-callee-context-propagation-in-justification) |
| 3 | Heuristic hint bypass — `computeHeuristicHint()` is computed but never used to skip LLM for pure-utility entities. Could save 20-40% of LLM calls. | P3 | [TBI-C-05](#tbi-c-05-heuristic-bypass-for-pure-utility-entities) |

**Why this matters:** When justification fails entirely (405, quota exhaustion, wrong model), the pipeline must abort with a clear error rather than silently writing 3,024 dummy stubs and marking the repo `"ready"`.

**Features that directly depend on justification:** 2.6 Business Context, 2.7 Search by Purpose, 2.8 Impact Analysis, 2.9 Blueprint, 2.10 Convention Guide, 2.11 Suggest Approach, 5.1 Health Report, 5.2 Prioritized Issues, 5.4 Drift, 5.7 Feature Blueprint, 5.8 ADRs, 7.1 PR Review, 7.3 Inline Comments, 7.5 Debate the Bot.

**Intelligence & UX Enhancements (elevate quality and user trust):**

| # | Enhancement | Priority | TBI Ref |
|---|-------------|----------|---------|
| ~~1~~ | ~~Context seeding~~ ✅ — users paste docs before indexing via `PUT /api/repos/{repoId}/context`. Injected into ontology and justification prompts. UI in onboarding console. | ~~P1~~ | [TBI-H-01](#tbi-h-01-context-seeding--pre-indexing-context-injection) |
| ~~2~~ | ~~Chain of thought streaming~~ ✅ — per-entity reasoning logged to pipeline via `createPipelineLogger()` | ~~P2~~ | [TBI-H-03](#tbi-h-03-llm-chain-of-thought-streaming-to-pipeline-monitor) |
| ~~3~~ | ~~Auto-generate `UNERR_CONTEXT.md`~~ ✅ — generator + download route + celebration modal | ~~P2~~ | [TBI-H-04](#tbi-h-04-auto-generated-unerr_contextmd-export) |
| 4 | Git history ingestion — feed commit messages, PR descriptions, and resolved review comments into the justification prompt for historical context | P1 | [TBI-I-02](#tbi-i-02-temporal-context-ingestion-git-history--pr-descriptions-as-justification-input) |
| 5 | Negative knowledge from ledger — mine reverted AI attempts for anti-patterns and attach warnings to affected entities; warn future agents | P1 | [TBI-I-01](#tbi-i-01-negative-knowledge-indexing-mine-the-prompt-ledger-for-mistakes) |
| 6 | Semantic drift as documentation trigger — when a module changes role, draft an updated justification + ADR proposal for developer review | P2 | [TBI-I-04](#tbi-i-04-semantic-drift-as-auto-documentation-trigger) |

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

### Implementation Status

| Component | Status | Details |
|-----------|--------|---------|
| Feature aggregation | Done | Entry point detection, hot path BFS |
| Health report builder | Done | LLM-generated across 13 risk categories |
| ADR synthesis | Done | LLM prompt with feature + justification data |
| Merge significance assessment | Done | Checks index events, feature timestamps, boundary files |
| ADR PR creation | Done | Creates branch, file, and PR via `gitHost` |
| Rewind entry rule update | Stub | Dead code — assigns `_db` from `require("arangojs")` but never writes back |

**Completion: ~88%**

> **Confirmed by real-world data:** The `kap10-server` health report exists in ArangoDB but has `overall_score: null`, `total_issues: null`. With all justifications being dummy stubs, the health report builder received meaningless input and produced empty metrics. ADR collection has 0 documents. See [Section 21](#21-real-world-validation-repo-diagnostic).

**Open Tasks:**

| # | Task | Priority | TBI Ref |
|---|------|----------|---------|
| 1 | Rewind entry rule_generated update — dead stub in ADR generation activity. `require("arangojs")` assigns `_db` but never writes back. Rules can't be traced to the rewind that created them. | P3 | [TBI-D-03](#tbi-d-03-close-the-rewind--rule-tracing-loop) |
| 2 | Health report null guard — when all justifications are fallback stubs (`confidence < 0.5`, `feature_tag == "unclassified"`), the health report builder should detect this and write a specific error state rather than null metrics. | P2 | [TBI-G-04](#tbi-g-04-health-report-null-guard-when-justifications-are-all-fallback-stubs) |
| 3 | ADR generation guard — same issue: ADR synthesis should detect 0 valid features and skip generation rather than silently producing 0 ADRs. | P2 | [TBI-G-04](#tbi-g-04-health-report-null-guard-when-justifications-are-all-fallback-stubs) |

**Why this matters:** A health report with `null` scores is indistinguishable from a repo that hasn't been analyzed. Users see "ready" status but get no actionable data.

**Features that directly depend on health/ADRs:** 5.1 Health Report, 5.2 Prioritized Issues, 5.8 Architecture Decision Records, 2.9 Blueprint.

---

## 12. Stage 9: Graph Snapshot Export

**Workflow:** `syncLocalGraphWorkflow` | **Queue:** light-llm
**Source:** `lib/temporal/workflows/sync-local-graph.ts`, `lib/temporal/activities/graph-export.ts`, `lib/temporal/activities/graph-upload.ts`

### What Happens

1. **Query and compact** all entities + edges from ArangoDB:
   - Compacts each entity to minimal fields: `key`, `kind`, `name`, `file_path`, `signature`, `language`
   - Fetches call edges per entity via `getCalleesOf()` (one ArangoDB query per entity)
   - Fetches active rules (max 200) and confirmed patterns (evidence capped at 5 exemplars per pattern)
   - All compacted into a single data structure

2. **Serialize** to msgpack binary + SHA-256 checksum. Msgpack is typically 5-20x smaller than JSON.

3. **Upload** to Supabase Storage bucket `graph-snapshots` at path `{orgId}/{repoId}.msgpack` (upsert mode).

4. **Record metadata** in PostgreSQL via Prisma: `status: "available"`, `checksum`, `sizeBytes`, `entityCount`, `edgeCount`, `generatedAt`.

5. **Notify clients** via Redis key `graph-sync:{orgId}:{repoId}` (TTL 1 hour). The CLI polls this key to know when to pull.

### Implementation Status

| Component | Status | Details |
|-----------|--------|---------|
| Entity compaction | Done | Strips to minimal fields |
| Edge fetching | Done (slow) | `getCalleesOf()` per entity — **O(N) ArangoDB queries**. Could use `getAllEdges()` for single query but larger payload. |
| Rule/pattern export | Done | Active rules (max 200), confirmed patterns with evidence |
| Msgpack serialization | Done | Binary + SHA-256 checksum |
| Supabase Storage upload | Done | Upsert mode, real Supabase client |
| PostgreSQL metadata | Done | Prisma `GraphSnapshotMeta.upsert` |
| Redis notification | Done | `graph-sync:{orgId}:{repoId}` with TTL 1h |
| Status transitions | Done | `generating` → `available` |

**Completion: ~90%**

> **Confirmed by real-world data:** The `kap10-server` snapshot has `status: "failed"`, `entity_count: 0`, `edge_count: 0`, `storage_path: null`. The snapshot was started at 20:22 UTC and failed by 20:28 UTC. No msgpack file exists in Supabase Storage. CLI `unerr pull` will fail for this repo. See [Section 21](#21-real-world-validation-repo-diagnostic).

**Open Tasks:**

| # | Task | Priority | TBI Ref |
|---|------|----------|---------|
| 1 | O(N) edge fetching — `getCalleesOf()` per entity is O(N) ArangoDB queries. 5,000-entity repo = 5,000 queries. Should be a single `getAllEdges()` call. | P2 | [TBI-E-01](#tbi-e-01-o1-graph-export--batch-edge-fetching) |
| 2 | Snapshot failure recovery — when the snapshot export fails, status is set to `"failed"` with no retry. The workflow does not re-attempt or surface a recoverable error to the user. | P2 | [TBI-G-03](#tbi-g-03-graph-snapshot-failure-recovery) |

**Why this matters:** Local-first mode (Feature 3.4) is completely broken if the snapshot fails. CLI users cannot pull graph data. There is no automatic retry or user-visible error that prompts re-indexing.

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

### Implementation Status

| Component | Status | Details |
|-----------|--------|---------|
| Anti-pattern rule synthesis | Done | LLM-generated rules from reverted ledger entries |
| Anti-pattern vectorization | Done | Embeds rule description, searches for matching entities (cosine > 0.75) |
| Pattern detection (Semgrep) | Done | Structural matching via `semgrep-pattern-engine.ts` adapter |
| Pattern mining | Done | Frequency-based convention discovery |
| Rule_generated ledger update | Stub | Dead code — `require("arangojs")` assigns `_db` but never uses it |

**Completion: ~75%**

**What's pending:**
1. **Ledger link back** — after generating an anti-pattern rule from a rewind, the rule_generated flag is never written back to the ledger entry. Users can't trace from a rule to the rewind that created it.
2. **Semgrep integration depth** — the Semgrep adapter exists but is a separate adapter behind the `IPatternEngine` port. Full integration with the indexing pipeline (running all 23 built-in rules during every index) depends on the Semgrep binary being available on the worker.

**Why the pending work matters:**
- Without ledger-to-rule tracing, the **anti-pattern detection** (Feature 6.7) learning loop is broken — users create rules via rewind but can't see the connection
- Without guaranteed Semgrep execution during indexing, **rule check** (Feature 6.6) may return incomplete pattern data for repos that haven't been manually scanned

**Features that directly depend on patterns:** 6.1 Auto-Detected Patterns, 6.2 Custom Rules, 6.5 Pattern-to-Rule Promotion, 6.6 Rule Check, 6.7 Anti-Pattern Detection, 7.1 PR Review (pattern check), 2.10 Convention Guide.

**Living Documentation Enhancements (replace .cursorrules and TEAM_CONVENTIONS.md):**

| # | Enhancement | Priority | TBI Ref |
|---|-------------|----------|---------|
| 1 | Idiomatic standard discovery — extend pattern mining to detect framework-specific idioms (React hook patterns, error handling shape, DI conventions, test structure). Synthesize into `TEAM_CONVENTIONS.md` and expose to MCP agents. One-click commit as `.cursor/rules`. | P2 | [TBI-I-05](#tbi-i-05-idiomatic-standard-discovery-auto-generate-cursorrules--team_conventionsmd) |

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
| 2. Fallback guard | — | If >200 files changed (`INCREMENTAL_FALLBACK_THRESHOLD`) → abort, log event |
| 3. `reIndexBatch` | heavy | Re-parse changed files (batches of 5), with quarantine wrapping |
| 4. `applyEntityDiffs` | light | Delete entities for removed files |
| 5. `repairEdgesActivity` | light | Re-resolve edges referencing changed entities |
| 6. `updateEmbeddings` | light | Re-embed changed entities only (delta) |
| 7. `cascadeReJustify` | light | Re-justify entities whose dependencies changed (max `CASCADE_MAX_HOPS = 2`, max `CASCADE_MAX_ENTITIES = 50`) |
| 8. `invalidateCaches` | light | Clear Redis caches for the repo |
| 9. `writeIndexEvent` | light | Record event in ArangoDB `index_events` |
| 10. `finalizeIndexing` | light | Update PostgreSQL status |

### Cascade Re-Justification

When `processPayment()` changes, its callers (`checkout()`, `retryBilling()`) may now have stale justifications. The cascade traverses the call graph outward (configurable depth and max entities) and re-justifies affected entities.

Justification embedding text for cascade re-justification is **capped at 1,500 chars** total, with **body snippet at 500 chars**, matching the full justification embedding format.

### Implementation Status

| Component | Status | Details |
|-----------|--------|---------|
| Signal debouncing | Done | 60s quiet period via `condition()` loop |
| Pull + diff | Done | Via `gitHost.pullLatest()` + `gitHost.diffFiles()` |
| Fallback guard | Done (partial) | Logs `force_push_reindex` event but **does not actually trigger full re-index workflow** |
| `reIndexBatch` | Done | Tree-sitter re-parse, quarantine wrapping, batches of 5 |
| Entity diff deletion | Done | `graphStore.deleteEntitiesByFiles()` |
| Edge repair | Done (with bug) | Deletes edges for deleted entities. **Bug:** updated entity edge check is logically dead — the inner condition `if key in deletedKeys` never fires for updated (non-deleted) entities. Edge re-creation is handled by re-indexing (by design). |
| Embedding update | Done | Delta re-embed for changed entities only |
| Cascade re-justify | Done | Graph traversal + `justifyBatch` |
| Cache invalidation | Done | Redis key deletion for prefetch, entity caches |
| Index event recording | Done | `index_events` ArangoDB collection with TTL 90 days |
| Finalize | Done (with gap) | **Passes `fileCount: 0, functionCount: 0, classCount: 0`** — counts are not recomputed after incremental update |

**Completion: ~85%**

**Open Tasks:**

| # | Task | Priority | TBI Ref |
|---|------|----------|---------|
| 1 | Fallback full re-index trigger — when >200 files change, the workflow logs a `force_push_reindex` event but never starts `indexRepoWorkflow`. Repo is stale until next push. | P2 | [TBI-D-01](#tbi-d-01-auto-trigger-full-re-index-when-incremental-fallback-fires) |
| 2 | Entity count recomputation — finalization passes all-zero counts. Dashboard shows stale file/function/class counts after every incremental push. | P3 | [TBI-D-02](#tbi-d-02-fix-incremental-entity-count-recomputation) |
| 3 | Edge repair dead-code path — updated entity check is logically unreachable. `edgesDeleted` count in index event is inaccurate. | P3 | [TBI-D-04](#tbi-d-04-fix-edge-repair-dead-code-path-for-updated-entities) |

**Why this matters:** Large refactors (>200 files) silently leave the repo stale. Project Stats show wrong numbers after every incremental push.

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

During re-indexing, new entities are written with a fresh `indexVersion`. The old graph remains fully queryable. Only after all new entities are written does the finalization step remove old-version entities. Users never see a partially indexed repo. (Note: shadow swap logic has a known bug — see [Stage 4](#7-stage-4-finalization--shadow-swap).)

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
- >200 files changed in incremental → falls back to full re-index (logged, not yet auto-triggered)
- Ontology LLM fails → raw extracted terms used as-is

No single file or entity failure can prevent the pipeline from completing.

---

## 19. Overall Pipeline Status

| Stage | Name | Completion | Blocking Issues |
|-------|------|-----------|-----------------|
| 1 | Prepare Repo Intelligence Space | **95%** | None |
| 2 | SCIP Analysis | **70%** | Python + Go SCIP parsing are stubs |
| 3 | Tree-Sitter Fallback | **90%** | Python/Go missing import edges |
| 4 | Finalization & Shadow Swap | **90%** | `indexVersion` stamping fixed; old-version cleanup still uses `"__old__"` |
| 5 | Embedding | **95%** | Orphan cleanup is optional/conditional |
| 6 | Ontology Discovery | **90%** | Workspace path dependency after cleanup |
| 7 | Business Justification | **97%** | Fatal LLM error detection added; cross-level callee propagation scoped per-level |
| 8 | Health Report & ADRs | **93%** | Fallback guard added; ledger rule_generated update is dead stub |
| 9 | Graph Snapshot Export | **93%** | Error handling improved; O(N) edge queries (performance) |
| 10 | Pattern Detection | **75%** | Ledger link back is dead stub |
| 14 | Incremental Indexing | **85%** | Fallback doesn't trigger full re-index; zero counts |

**Weighted overall completion: ~91%**

> **Real-world validation (2026-02-27):** The `kap10-server` repo was indexed at the graph level (697 files, 1,786 functions, 591 call edges). LLM stages failed silently due to HTTP 405 from Lightning AI — this was a configuration issue (wrong LLM provider), not a pipeline bug. Six bugs were identified and fixed (2026-02-28): TBI-G-01 (`last_indexed_at`), TBI-G-02 (fatal LLM error detection), TBI-G-03 (snapshot error handling), TBI-G-04 (health report fallback guard), TBI-B-01 (`indexVersion` stamping), TBI-D-02 (count formula). LLM provider switched to `LLM_PROVIDER=openai`. Re-indexing pending to verify all fixes end-to-end.

### Priority Pending Work (by Impact)

| Priority | Issue | Impact | TBI Ref | Affected Features |
|----------|-------|--------|---------|------------------|
| ~~**P1**~~ | ~~LLM 405 silent failure~~ ✅ | ~~Entire LLM tier silently produces garbage~~ | TBI-G-02 | **DONE** — fatal error detection + abort after 5 consecutive failures |
| **P1** | Python + Go SCIP parsing | Cross-file resolution missing for 2 of 3 supported languages | TBI-A-01, TBI-A-02 | 2.3, 2.4, 2.8, 5.3, 5.5, 5.6 |
| ~~**P1**~~ | ~~Shadow swap logic fix~~ ✅ | ~~`index_version: null` on all entities~~ | TBI-B-01 | **DONE** — `indexVersion` passed through to `writeEntitiesToGraph` |
| ~~**P2**~~ | ~~Graph snapshot failure recovery~~ ✅ | ~~Snapshot fails silently~~ | TBI-G-03 | **DONE** — proper error logging + status update guard |
| ~~**P2**~~ | ~~Health report null guard~~ ✅ | ~~All-stub justifications produce null scores~~ | TBI-G-04 | **DONE** — `llm_failure` / `llm_partial_failure` risk detection |
| **P2** | Workspace path for ontology | Manifest reading fails silently after workspace cleanup | TBI-C-03 | 5.7, 5.9, 2.6 |
| **P2** | Python/Go import edge extraction | Import chain analysis empty for Python/Go | TBI-B-03 | 2.4, 2.8 |
| **P2** | Incremental fallback trigger | Large refactors leave repo stale until next push | TBI-D-01 | 2.1-2.12 |
| **P2** | Graph export edge batching | Snapshot generation slow for large repos | TBI-E-01 | 3.4 |
| ~~**P3**~~ | ~~`last_indexed_at` never set~~ ✅ | ~~Dashboard shows no "last indexed" time~~ | TBI-G-01 | **DONE** — set in embedding + justification terminal paths |
| ~~**P3**~~ | ~~Incremental entity count recomputation~~ ✅ | ~~Dashboard shows stale counts~~ | TBI-D-02 | **DONE** — per-kind counts from `writeEntitiesToGraph` (full-index path) |
| **P3** | Orphan embedding cleanup guarantee | Search returns deleted entities | TBI-B-02 | 2.1 |
| **P3** | Ledger rule link back | Rewind → rule tracing broken | TBI-D-03 | 4.3, 6.7 |
| **P3** | Edge repair count accuracy | Activity feed metrics inaccurate | TBI-D-04 | 9.3 |

### Intelligence, UX & Living Documentation Enhancements

| Priority | Enhancement | TBI Ref | Replaces / Unlocks |
|----------|-------------|---------|-------------------|
| **P1** | Negative knowledge from ledger — warn agents about past failures on specific entities | TBI-I-01 | Replaces `MEMORY.md` lessons-learned section |
| **P1** | Git history + PR descriptions as justification input | TBI-I-02 | Replaces `ARCHITECTURE.md` historical intent section |
| ~~**P1**~~ | ~~Context seeding — users inject their docs/vocabulary before justification~~ ✅ | TBI-H-01 | ~~Accurate `feature_tag`, immediate trust~~ **DONE** — context seeding UI + API + prompt injection in ontology + justification |
| ~~**P1**~~ | ~~Confidence heatmap + human-in-the-loop corrections~~ ✅ | TBI-H-02 | **DONE** — heatmap, override API (`POST /entities/{id}/override`), inline correction editor in annotated code viewer |
| **P2** | Tech-stack & system boundary extraction | TBI-I-03 | Replaces architecture diagrams with live graph |
| **P2** | Semantic drift as auto-documentation trigger + ADR proposals | TBI-I-04 | Replaces stale `ARCHITECTURE.md` update process |
| **P2** | Idiomatic standard discovery → `TEAM_CONVENTIONS.md` + `.cursor/rules` | TBI-I-05 | Replaces `.cursorrules` entirely |
| ~~**P2**~~ | ~~LLM chain of thought streaming to pipeline monitor~~ ✅ | TBI-H-03 | ~~"Wow" moment during indexing wait~~ **DONE** — per-entity reasoning logged to pipeline |
| ~~**P2**~~ | ~~Auto-generate `UNERR_CONTEXT.md` artifact~~ ✅ | TBI-H-04 | ~~Bridge for docs-first developers~~ **DONE** — generator + download route + celebration modal |
| ~~**P2**~~ | ~~Blast radius pre-computation~~ ✅ | TBI-H-05 | ~~Risk visibility~~ **DONE** — fan_in/fan_out computed, risk badges in annotated viewer |

### Autonomous Context Delivery (Zero-Config Agent Intelligence)

| Priority | Enhancement | TBI Ref | Replaces / Unlocks |
|----------|-------------|---------|-------------------|
| **P1** | Proactive file-open context injection via MCP — push entity context to agents automatically | TBI-J-01 | Eliminates cold-start problem for IDE agents |
| **P2** | Unified knowledge document generator — one doc replaces MEMORY.md + ARCHITECTURE.md + .cursorrules | TBI-J-02 | Single export artifact for all manual docs |
| **P2** | Incremental context refresh on push — keep knowledge docs fresh without full re-index | TBI-J-03 | Context docs stay current after every push |
| **P3** | Agent memory sync — auto-PR to update CLAUDE.md / .cursorrules / copilot-instructions from graph | TBI-J-04 | IDE agent memory files stay in sync with graph |

---

## 20. To Be Implemented

> This section is the definitive backlog for indexing pipeline improvements. Tasks are grouped by category and broken into atomic, implementable units. Each task includes the affected files, what "done" looks like, and which product features it unlocks.
>
> **Do not start on these tasks without reading the current implementation status in the sections above.** Each task has context from existing bugs and stubs already described in Sections 4–14.
>
> **Priority legend:** P1 = blocks correctness for users on any language, P2 = materially degrades quality or coverage, P3 = polish/metrics/tracing.

---

### Category A — Language Coverage (Extend to Python, Go, Java, and Beyond)

The current pipeline has first-class support only for TypeScript/JavaScript via SCIP. Python and Go have indexer stubs. Java, C, C++, C#, Scala, and PHP have no support at all. This is the highest-leverage area because every downstream stage — embeddings, justification, health reports, pattern detection — is only as good as the graph they receive.

#### TBI-A-01: Activate the Python SCIP Decoder

**Priority: P1**

`lib/indexer/languages/python/index.ts` runs `scip-python` and writes its output to a `.scip` file, but `lib/adapters/scip-code-intelligence.ts` returns an empty array when it encounters a Python SCIP index. The binary protobuf decoder is a TypeScript TODO. SCIP for Python would give exact cross-file symbol resolution — method definitions, class hierarchies, import chains — with zero false positives.

**Sub-tasks:**
1. Read the SCIP protobuf schema (`scip.proto`) — already used for TypeScript. Confirm the Python indexer produces a valid binary `.scip` file on a real repo.
2. Wire the Python SCIP binary path through `runSCIP` in `indexing-heavy.ts` to pass the output file path to the decoder.
3. In `scip-code-intelligence.ts`, implement the SCIP decode path for `.scip` files that originate from `scip-python`. The schema is identical to TypeScript — only the symbol naming convention differs. Map Python symbols (`module.Class#method().`) to Unerr entity kinds and normalize file paths.
4. Add a corpus of Python SCIP test fixtures (a real `.scip` output from a small Python project) under `lib/adapters/__tests__/fixtures/` and assert the decoded entity/edge count matches expectations.
5. Update `runSCIP` in `indexing-heavy.ts` to pass `language: "python"` through to the decoder so the SCIP adapter routes correctly.

**Affected files:** `lib/adapters/scip-code-intelligence.ts`, `lib/indexer/languages/python/index.ts`, `lib/temporal/activities/indexing-heavy.ts`

**Done when:** A Python repo with 50+ files produces non-zero entities and edges from the SCIP path, cross-file call edges resolve, and the unit test passes with the fixture.

**Unlocks:** 2.3 Call Graph, 2.4 Import Chain, 2.8 Impact Analysis, 5.3 Dead Code, 5.5 Circular Deps, 5.6 Fan-In/Out for Python repos.

---

#### TBI-A-02: Activate the Go SCIP Decoder

**Priority: P1**

Mirrors TBI-A-01 but for Go. `lib/indexer/languages/go/index.ts` runs `scip-go`. The SCIP output format is the same protobuf. Go symbol naming uses a different convention (`go module/package.Type#Method`). The decoder path in `scip-code-intelligence.ts` has the same stub.

**Sub-tasks:**
1. Confirm `scip-go` produces a valid `.scip` output on a small Go module (test locally or in CI via a Go fixture repo).
2. Map Go SCIP symbol kinds to Unerr entity kinds: `package` → `file`, `type` → `class`, `func` → `function`, `method` → `function`, `var`/`const` → `variable`.
3. Handle Go-specific edge types: interface satisfaction (`implements` edge), embedded struct fields (`contains` edges between class entities).
4. Normalize Go file paths (Go module paths vs. filesystem paths can diverge — `go.mod` root is the reference point).
5. Add Go SCIP test fixture and assertions. Run the fixture through the full `runSCIP` activity in a test container.

**Affected files:** `lib/adapters/scip-code-intelligence.ts`, `lib/indexer/languages/go/index.ts`, `lib/temporal/activities/indexing-heavy.ts`

**Done when:** A Go repo with 30+ files produces non-zero entities with correct `kind` values, interface implementation edges appear, and the fixture test passes.

**Unlocks:** Same as TBI-A-01 but for Go repos.

---

#### TBI-A-03: Java Support via SCIP-Java

**Priority: P2**

Java is one of the most common enterprise languages. `scip-java` is a production-ready SCIP indexer from Sourcegraph. Adding Java support requires: adding `java` to the language scanner, invoking `scip-java` in `runSCIP`, and decoding its output (same SCIP protobuf format, new symbol naming convention).

**Sub-tasks:**
1. Add `java` to `SUPPORTED_LANGUAGES` in `lib/indexer/scanner.ts`. Add detection heuristics: presence of `pom.xml`, `build.gradle`, `*.java` files.
2. Add `lib/indexer/languages/java/index.ts` — mirrors the Python/Go pattern. Invokes `scip-java index --output scip.scip` in the workspace root.
3. Map Java SCIP symbols to Unerr entity kinds: `class`, `interface`, `enum` → `class`; `method` → `function`; `field` → `variable`.
4. Handle Java package structure in file path normalization (Java uses `/src/main/java/` prefix conventions).
5. Add `java` to the monorepo scanner heuristics (`lib/indexer/monorepo.ts`) to detect Maven multi-module and Gradle multi-project setups.
6. Add SCIP decode path in `scip-code-intelligence.ts` for `language: "java"`.

**Affected files:** `lib/indexer/scanner.ts`, `lib/indexer/monorepo.ts`, `lib/indexer/languages/java/index.ts` (new file), `lib/adapters/scip-code-intelligence.ts`

**Done when:** A Java repo with Maven structure produces entities for all public classes and methods, with `extends`/`implements` edges for class hierarchy.

---

#### TBI-A-04: Tree-Sitter Parsers for C, C++, C#, Scala, PHP, Ruby, Rust

**Priority: P2**

For languages without a production SCIP indexer, tree-sitter is the fallback. The current tree-sitter implementation (`lib/indexer/languages/generic/`) uses regex patterns. Real tree-sitter grammars give structured AST access — correct function/class/method detection without regex fragility.

**Sub-tasks (one per language, can be done independently):**

1. **C/C++** — `lib/indexer/languages/c/index.ts`. Detect: `*.c`, `*.cpp`, `*.h`, `*.hpp`. SCIP alternative exists (`scip-clang`) — prefer that if stable. Otherwise tree-sitter grammar `tree-sitter-cpp`. Entity kinds: `function`, `struct`/`class`, `typedef`.

2. **C#** — `lib/indexer/languages/csharp/index.ts`. SCIP indexer: `scip-dotnet` (experimental). Tree-sitter fallback: `tree-sitter-c-sharp`. Entity kinds: `class`, `interface`, `method`, `property`.

3. **Scala** — `lib/indexer/languages/scala/index.ts`. SCIP indexer: `scip-scala` (via Metals). Tree-sitter fallback: `tree-sitter-scala`. Entity kinds: `class`, `object`, `trait`, `def`.

4. **PHP** — `lib/indexer/languages/php/index.ts`. Tree-sitter: `tree-sitter-php`. Entity kinds: `class`, `function`, `method`, `interface`.

5. **Ruby** — `lib/indexer/languages/ruby/index.ts`. Tree-sitter: `tree-sitter-ruby`. Entity kinds: `class`, `module`, `method`.

6. **Rust** — `lib/indexer/languages/rust/index.ts`. SCIP indexer: `rust-analyzer` produces LSIF/SCIP. Tree-sitter fallback: `tree-sitter-rust`. Entity kinds: `struct`, `enum`, `impl`, `fn`, `trait`.

For each language:
- Add detection heuristics to `lib/indexer/scanner.ts`
- Implement `parseFile(filePath, source)` → `{entities[], edges[]}`
- Add to `parseRest` routing in `indexing-heavy.ts`
- Add unit test with a sample source file

**Done when:** Each language correctly extracts entity names, kinds, and file paths. Cross-file edges are not required at tree-sitter level (SCIP handles that). Tests pass with sample fixtures.

---

#### TBI-A-05: Monorepo Language Detection for Polyglot Repos

**Priority: P3**

`lib/indexer/monorepo.ts` detects sub-package roots but currently only runs SCIP for the primary detected language. In a monorepo with a Go backend and a TypeScript frontend, only one language gets SCIP coverage. The other falls through to tree-sitter.

**Sub-tasks:**
1. In `monorepo.ts`, detect the dominant language per workspace root (not just per repo). A `packages/server/` directory with Go files should use `scip-go`; `packages/web/` with TypeScript files should use `scip-typescript`.
2. In `runSCIP` (`indexing-heavy.ts`), accept `languagePerRoot: Record<string, string>` alongside the existing `languages` array. Run one SCIP indexer per root, each with its appropriate binary.
3. Merge the resulting entities from multiple SCIP runs. De-duplicate on entity key (deterministic hash is already language-agnostic).
4. Update `prepareRepoIntelligenceSpace` to return `languagePerRoot` in its result for passing through to `runSCIP`.

**Affected files:** `lib/indexer/monorepo.ts`, `lib/temporal/activities/indexing-heavy.ts`, `lib/temporal/workflows/index-repo.ts`

**Done when:** A TypeScript + Go monorepo produces SCIP-quality entities for both subtrees.

---

### Category B — Close the Precision Gap

These tasks fix correctness issues where the pipeline produces structurally incomplete or incorrect data that cannot be compensated by downstream stages.

#### TBI-B-01: Fix Shadow Swap Logic in Finalization

**Priority: P1** · **Status: ✅ DONE**

> **Implemented** (2026-02-28): `indexVersion` is now passed from the workflow to both `runSCIP` and `parseRest`, which forward it to `writeEntitiesToGraph`. All entities written to ArangoDB are stamped with the `indexVersion` UUID. The `reindex` API route already generated the `indexVersion` — the fix was wiring it through the activity inputs.
>
> **Files changed:** `lib/temporal/activities/indexing-heavy.ts` (added `indexVersion` to `RunSCIPInput` and `ParseRestInput`, passed to `writeEntitiesToGraph`), `lib/temporal/workflows/index-repo.ts` (passes `indexVersion` to both activity calls).

`finalizeIndexing` in `lib/temporal/activities/indexing-light.ts` is supposed to delete entities from the previous index version and promote the new one. The current implementation calls `deleteByIndexVersion("__old__")` but entities are never stamped with `"__old__"` — they retain their original `indexVersion` UUID. As a result, old entities accumulate across re-indexes, counts grow unboundedly, and stale entities appear in search results.

**Remaining:** The cleanup of old-version entities in `finalizeIndexing` still references `"__old__"` — a follow-up should change it to delete by the `previousIndexVersion` UUID. The entity *stamping* half is now correct.

**Affected files:** `lib/temporal/activities/indexing-heavy.ts`, `lib/temporal/workflows/index-repo.ts`

---

#### TBI-B-02: Guarantee Orphan Embedding Cleanup After Re-Index

**Priority: P2**

When entities are removed during re-indexing (TBI-B-01 deletes old ArangoDB entities), their corresponding rows in the PostgreSQL `embeddings` table are not deleted. These orphan rows pollute semantic search results with entities that no longer exist in the graph.

**Sub-tasks:**
1. In `finalizeIndexing`, after the old-version ArangoDB entities are deleted, collect the deleted entity keys (returned by `deleteByIndexVersion` — currently returns `void`, needs to return `string[]`).
2. Pass the deleted entity key list to a new `cleanupOrphanEmbeddings(entityKeys: string[])` call on the `IVectorSearch` port.
3. Implement `cleanupOrphanEmbeddings` in the Supabase vector store adapter: `DELETE FROM embeddings WHERE entity_id = ANY($1)` and `DELETE FROM justification_embeddings WHERE entity_id = ANY($1)`.
4. Add a test: insert 3 entity embeddings, delete 2 entities, assert only 1 embedding remains.

**Affected files:** `lib/temporal/activities/indexing-light.ts`, `lib/adapters/arango-graph-store.ts`, `lib/ports/graph-store.ts`, `lib/ports/vector-search.ts`

**Done when:** After re-indexing, semantic search never returns entities that don't exist in ArangoDB.

---

#### TBI-B-03: Python and Go Import Edge Extraction in Tree-Sitter

**Priority: P2**

When SCIP is unavailable (currently always for Python/Go), the tree-sitter fallback produces entities but no `imports` edges. Import chain analysis (`2.4 Import Chain Analysis`) returns empty results for Python and Go repos. The tree-sitter parsers already detect `import` statements — they just don't emit edges.

**Sub-tasks:**
1. In `lib/indexer/languages/python/tree-sitter.ts`, after extracting entities, scan parsed `import_statement` and `import_from_statement` nodes. For each imported module, compute the target file path (resolve relative imports via `sys.path` heuristics — best-effort, not exact). Emit an `imports` edge from the source file entity to the target file entity.
2. In `lib/indexer/languages/go/tree-sitter.ts`, scan `import_declaration` nodes. Resolve import paths to file entities within the same workspace. Emit `imports` edges.
3. Add a unit test for each: given a multi-file Python/Go workspace, assert that `imports` edges exist between the correct file entities.
4. Update the integration test in `lib/indexer/__tests__/scanner.test.ts` to assert that Python/Go repos produce at least some `imports` edges when using the tree-sitter path.

**Affected files:** `lib/indexer/languages/python/tree-sitter.ts`, `lib/indexer/languages/go/tree-sitter.ts`, `lib/indexer/__tests__/scanner.test.ts`

**Done when:** A Python repo with `from services import PaymentService` produces an `imports` edge between the two file entities.

---

### Category C — Deepen the Brain

These tasks improve the *quality* of data the pipeline produces, directly impacting justification accuracy, business context richness, and feature completeness.

#### TBI-C-01: TypeScript Decorator Extraction

**Priority: P2**

TypeScript decorators (`@Injectable()`, `@Controller('/api')`, `@Column({ type: 'varchar' })`) carry significant architectural intent — NestJS modules, TypeORM entities, Angular components. Currently, decorators are not extracted as structured metadata on entity documents. The SCIP indexer sees them as calls but doesn't surface them as first-class entity properties.

**Sub-tasks:**
1. In `lib/indexer/languages/typescript/tree-sitter.ts`, after extracting a `class` entity, walk its `decorator` nodes. Extract: decorator name, decorator arguments (stringify). Store as `metadata.decorators: string[]` on the entity document.
2. In `lib/indexer/languages/typescript/scip.ts`, post-process SCIP symbols for decorator occurrences. SCIP records decorator calls as symbol references — map `@Injectable` occurrences back to the class entity they annotate.
3. Update `EntityDoc` type in `lib/ports/types.ts` to include `metadata?: { decorators?: string[]; annotations?: string[] }` (generic enough for Java annotations too).
4. In `lib/justification/prompt-builder.ts`, include decorator metadata in the entity prompt: _"This class is decorated with: @Controller('/payments'), @UseGuards(AuthGuard)"_.
5. In `lib/adapters/arango-graph-store.ts`, ensure `metadata` is written to ArangoDB with the entity.

**Affected files:** `lib/indexer/languages/typescript/tree-sitter.ts`, `lib/indexer/languages/typescript/scip.ts`, `lib/ports/types.ts`, `lib/justification/prompt-builder.ts`, `lib/adapters/arango-graph-store.ts`

**Done when:** A NestJS `@Controller('/payments')` class entity has `metadata.decorators: ["@Controller('/payments')"]` in ArangoDB, and its justification mentions the HTTP route it exposes.

---

#### TBI-C-02: Cross-Level Callee Context Propagation in Justification

**Priority: P2**

The current topological sort processes entities level by level but only passes callee justifications from entities in *already-completed lower levels*. Entities within the same level that call each other don't benefit from sibling context. In large files with tightly-coupled helper functions all at the same topological level, this means each helper is justified without awareness of its siblings.

**Sub-tasks:**
1. In `lib/justification/topological-sort.ts`, add a second pass after level assignment: for entities at the same level, build a dependency sub-graph using only `calls` edges within that level. Run a secondary topological sort within the level.
2. In `lib/temporal/workflows/justify-repo.ts`, process intra-level entities in the sub-sorted order (not all in parallel). Each entity in the sub-sort benefits from already-justified same-level callees.
3. Keep parallelism: entities with no intra-level dependencies still process in parallel. Only entities with intra-level call dependencies serialize.
4. Update the topological sort unit test to assert sub-level ordering for a cycle-free intra-level dependency case.

**Affected files:** `lib/justification/topological-sort.ts`, `lib/temporal/workflows/justify-repo.ts`, `lib/justification/__tests__/topological-sort.test.ts`

**Done when:** In a set of 5 helper functions at the same topological level where `A → B → C`, entity `B` is justified after `A` and its justification references `A`'s context; `C` is justified after `B`.

---

#### TBI-C-03: Persist Workspace Manifests for Ontology Context

**Priority: P2**

`prepareRepoIntelligenceSpace` discovers the repo's language, package manager, and framework (via `package.json`, `go.mod`, `pyproject.toml`, `pom.xml`). This manifest data — `project_name`, `tech_stack`, `framework`, `entry_points` — is currently returned as part of the activity result but not persisted anywhere. The ontology discovery stage (`discoverOntologyWorkflow`) lacks access to it unless the workspace directory still exists (it may not after cleanup). Ontology terms are less accurate without knowing the framework.

**Sub-tasks:**
1. Define a `WorkspaceManifest` type in `lib/ports/types.ts`: `{ projectName: string; techStack: string[]; frameworks: string[]; entryPoints: string[]; packageManager: string; }`.
2. In `prepareRepoIntelligenceSpace`, extract manifest data from discovered config files (already partially done for language detection). Populate a `WorkspaceManifest`.
3. Persist the manifest to ArangoDB: a `workspace_manifests` document collection (or add to the existing `repos` collection in ArangoDB if one exists). Key: `{orgId}-{repoId}`.
4. In `discoverOntologyWorkflow` / `extractOntology` activity, fetch the manifest from ArangoDB at the start. Include `projectName` and `frameworks` in the ontology extraction prompt: _"This is a NestJS API called 'payments-service'. Common terms from the codebase:"_.
5. Add a `getWorkspaceManifest(orgId, repoId)` method to `IGraphStore` port.

**Affected files:** `lib/temporal/activities/indexing-heavy.ts`, `lib/ports/types.ts`, `lib/ports/graph-store.ts`, `lib/adapters/arango-graph-store.ts`, `lib/temporal/activities/ontology.ts`, `lib/temporal/workflows/discover-ontology.ts`

**Done when:** The ontology extraction prompt for a NestJS repo includes the framework name, and the resulting domain terms are more specific to the project than without the manifest.

---

#### TBI-C-04: Function Signature Extraction in Tree-Sitter Fallback

**Priority: P3**

SCIP extracts full function signatures (parameter names, types, return types). The tree-sitter fallback extracts function names but not signatures — the `signature` field on tree-sitter entities is either empty or a bare name. Justification prompts that include the signature give the LLM significantly more context (`processPayment(invoice: Invoice, gateway: PaymentGateway): Promise<Receipt>` vs just `processPayment`).

**Sub-tasks:**
1. In each tree-sitter language parser (`typescript`, `python`, `go`), after detecting a `function_declaration` or `method_definition` node, traverse its `parameters` and `return_type` child nodes to reconstruct the signature string.
2. For TypeScript: extract parameter types from `type_annotation` nodes. For Python: extract type hints from `type` nodes on `parameter` nodes. For Go: extract `parameter_list` and `return_type`.
3. Store the extracted signature in `EntityDoc.signature`. Limit signature length to 500 chars.
4. Add a unit test per language asserting the correct signature is extracted from a sample function.

**Affected files:** `lib/indexer/languages/typescript/tree-sitter.ts`, `lib/indexer/languages/python/tree-sitter.ts`, `lib/indexer/languages/go/tree-sitter.ts`

**Done when:** A Python function `def process_payment(invoice: Invoice, gateway: PaymentGateway) -> Receipt:` produces `signature: "(invoice: Invoice, gateway: PaymentGateway) -> Receipt"` in the entity document.

---

### Category D — Bulletproof the Nervous System

These tasks harden the incremental indexing path and close feedback loops that are currently open.

#### TBI-D-01: Auto-Trigger Full Re-Index When Incremental Fallback Fires

**Priority: P2**

When a push changes more than 200 files (`INCREMENTAL_FALLBACK_THRESHOLD`), the incremental workflow logs a `force_push_reindex` event and aborts — but does not actually trigger a full re-index workflow. The repo is left stale until the next incremental push (if it's small) or until a user manually triggers re-index from the dashboard.

**Sub-tasks:**
1. In `lib/temporal/workflows/incremental-index.ts`, after the fallback guard detects > 200 changed files, call `startChild(indexRepoWorkflow, {...})` with a unique workflow ID (`reindex-fallback-{orgId}-{repoId}-{runId}`), passing the same `orgId`, `repoId`, `installationId`, `cloneUrl`, `defaultBranch` that are already available.
2. Pass `parentClosePolicy: ParentClosePolicy.ABANDON` so the full re-index continues independently if the incremental workflow ends.
3. Update the repo status to `"indexing"` via a light activity before starting the child workflow (so the dashboard shows progress).
4. Update the `force_push_reindex` index event payload to include `childWorkflowId` for tracing.
5. Add a unit test: mock `> 200 files changed`, assert that `startChild(indexRepoWorkflow, ...)` is called.

**Affected files:** `lib/temporal/workflows/incremental-index.ts`, `lib/temporal/workflows/__tests__/incremental-index.test.ts`

**Done when:** A force-push of 500 files results in a new `indexRepoWorkflow` being started automatically. The dashboard shows `status: "indexing"` within seconds of the webhook.

---

#### TBI-D-02: Fix Incremental Entity Count Recomputation

**Priority: P3** · **Status: ✅ DONE (full-index path)**

> **Implemented** (2026-02-28): The full-index workflow now computes correct per-kind counts. `writeEntitiesToGraph` in `graph-writer.ts` already returned `{ fileCount, functionCount, classCount }` — the fix was extending `RunSCIPLightResult` and `ParseRestLightResult` to include these fields and fixing the workflow formula from the wrong `scip.coveredFiles.length + parse.entityCount` to the correct `scip.fileCount + parse.fileCount` (and similarly for functions/classes).
>
> **Files changed:** `lib/temporal/activities/indexing-heavy.ts` (extended result types, return per-kind counts), `lib/temporal/workflows/index-repo.ts` (fixed count formula), `lib/temporal/workflows/__tests__/index-repo-workflow.test.ts` (updated mocks and assertions).
>
> **Remaining:** The incremental indexing path still passes hardcoded zeros — needs `recomputeRepoCounts` AQL query.

**Affected files:** `lib/temporal/activities/indexing-heavy.ts`, `lib/temporal/workflows/index-repo.ts`

---

#### TBI-D-03: Close the Rewind → Rule Tracing Loop

**Priority: P3**

When a user rewinds a ledger entry (Feature 4.3), `anti-pattern.ts` generates an LLM rule from what went wrong and stores it in the `rules` ArangoDB collection. The connection between the generated rule and the originating ledger entry is never written back — the `rule_generated` flag on the ledger entry stays `false`. Users cannot trace from a rule back to the rewind that inspired it.

**Sub-tasks:**
1. In `lib/temporal/activities/anti-pattern.ts`, after `bulkUpsertRules()` succeeds and returns the new rule ID, call `graphStore.markLedgerEntryRuleGenerated(ledgerEntryId, ruleId)`.
2. Add `markLedgerEntryRuleGenerated(ledgerEntryId: string, ruleId: string): Promise<void>` to `IGraphStore` port.
3. Implement in `arango-graph-store.ts`: AQL `UPDATE { rule_id: ruleId, rule_generated: true }` on the ledger entry document.
4. Expose the `rule_id` link in the MCP `timeline` tool response so IDE agents can surface it.
5. Add a unit test: run `anti-pattern` activity, assert the ledger entry's `rule_generated` is `true` and `rule_id` is set.

**Affected files:** `lib/temporal/activities/anti-pattern.ts`, `lib/ports/graph-store.ts`, `lib/adapters/arango-graph-store.ts`, `lib/mcp/tools/timeline.ts`, `lib/temporal/activities/__tests__/anti-pattern.test.ts`

**Done when:** After a rewind, the ledger entry has `rule_generated: true` and `rule_id` pointing to the generated rule. The MCP timeline tool includes the rule link.

---

#### TBI-D-04: Fix Edge Repair Dead-Code Path for Updated Entities

**Priority: P3**

In `lib/indexer/edge-repair.ts`, the logic for re-creating edges on updated (non-deleted) entities has a bug: `if key in deletedKeys` can never be `true` for an updated entity because updated entities are explicitly excluded from `deletedKeys`. The loop body for updating entity edges is unreachable. Edge repair for *updated* files currently relies entirely on re-indexing producing new edges — it does not attempt to repair edges referencing the old entity key.

**Sub-tasks:**
1. Audit the exact flow: trace what happens to edges when a file is updated (not deleted). Confirm that re-indexing the file produces new entities with the same deterministic keys (since the entity hash depends on file path + name, an unchanged function retains its key even if its body changes). If keys are stable, edge repair may not be needed at all for body changes.
2. If the key does not change, the bug is effectively harmless and should be documented as such. Remove the dead code path and add a comment explaining why edge repair is not needed for body changes.
3. If keys can change (e.g., when a function is renamed in a changed file), the edge repair must: (a) identify the old key from the entity diff, (b) delete edges referencing the old key, (c) let re-indexing create edges with the new key.
4. Fix the activity return value — `repairEdgesActivity` currently returns `{ deleted: N, created: 0 }` where `created` is always 0. After the fix, return the correct creation count.
5. Update the activity feed metric for edge repairs (`9.3 Activity Feed`) to use the correct count.

**Affected files:** `lib/indexer/edge-repair.ts`, `lib/temporal/activities/incremental.ts`, `lib/indexer/__tests__/edge-repair.test.ts`

**Done when:** Either (a) the dead code is removed with a clear explanation, or (b) edge repair correctly handles renamed entities and the `created` count is accurate.

---

### Category E — Performance

#### TBI-E-01: O(1) Graph Export — Batch Edge Fetching

**Priority: P2**

`lib/use-cases/graph-serializer.ts` calls `graphStore.getCalleesOf(entityId)` for each entity individually when building the graph snapshot. For a repo with 5,000 entities, this is 5,000 ArangoDB queries serialized in a loop. The `getAllEdges(orgId, repoId, limit: 20000)` method already exists on `IGraphStore` and returns all edges in a single query.

**Sub-tasks:**
1. In `graph-serializer.ts`, before the entity loop, call `graphStore.getAllEdges(orgId, repoId, 20000)` once to fetch all edges into memory.
2. Build an in-memory adjacency map: `calleesMap: Map<entityId, EntityId[]>` keyed on `_from` entity ID.
3. Replace all `getCalleesOf(entityId)` calls inside the entity loop with a lookup into `calleesMap`. If the entity has no entry, it has no callees — return `[]`.
4. Handle the case where a repo has more than 20,000 edges: add a pagination loop (`offset`, `limit`) to `getAllEdges` if the returned count equals the limit, and repeat until exhausted.
5. Add a test: create 100 entities with 200 edges, serialize the graph, assert all edges appear and only 1 (or `ceil(edges/pageSize)`) ArangoDB query is made.
6. Measure snapshot generation time before and after on a 1,000-entity test repo. Target: 10x reduction.

**Affected files:** `lib/use-cases/graph-serializer.ts`, `lib/ports/graph-store.ts`, `lib/adapters/arango-graph-store.ts`, `lib/use-cases/__tests__/graph-serializer.test.ts`

**Done when:** Graph snapshot generation for a 5,000-entity repo completes in under 30 seconds (vs 10+ minutes currently). The `getAllEdges` call appears once in the serializer, not inside a loop.

---

#### TBI-E-02: ArangoDB Bulk Import via `/_api/import` for Large Repos

**Priority: P3**

The current `bulkUpsertEntities` and `bulkUpsertEdges` implementations batch at 1,000 documents via `arangojs collection.import()`. This goes through the standard ArangoDB HTTP API. For repos with 50,000+ entities, this is 50+ round-trips. ArangoDB's `/_api/import?type=auto&complete=true&onDuplicate=update` can accept larger JSONL batches in a single HTTP request and is significantly faster for bulk writes.

**Sub-tasks:**
1. Benchmark current import performance on a 10,000-entity fixture. Record time per batch and total time.
2. In `arango-graph-store.ts`, implement `bulkImportRaw(collection: string, documents: object[])` that calls `/_api/import` directly via `node-fetch` or `undici` with `Content-Type: application/x-ldjson` and JSONL body. Handle conflict resolution via `onDuplicate=update`.
3. Raise the batch size to 5,000 documents (test memory impact — each entity is ~500 bytes so 5,000 = ~2.5MB per batch, well within safe limits).
4. Fall back to the existing `collection.import()` for batches below 1,000 documents (not worth the overhead for small repos).
5. Re-run the benchmark. Target: 3-5x throughput improvement for repos > 10,000 entities.

**Affected files:** `lib/adapters/arango-graph-store.ts`

**Done when:** A 50,000-entity repo writes to ArangoDB in under 60 seconds (vs 5+ minutes currently).

---

#### TBI-C-05: Heuristic Bypass for Pure-Utility Entities

**Priority: P3**

`computeHeuristicHint()` in `lib/justification/prompt-builder.ts` detects pure-utility entities (getters/setters, no callers, trivial names like `getId`, `setName`) and computes a hint for the prompt. However, this hint is only injected into the LLM prompt — it never short-circuits the LLM call entirely. For a 5,000-entity repo, 20-40% of entities may be pure utilities that can be classified as `taxonomy: UTILITY, feature_tag: "infrastructure"` without an LLM call.

**Sub-tasks:**
1. Define a heuristic threshold: an entity is a pure-utility bypass candidate if `computeHeuristicHint()` returns `confidence >= 0.9` AND the entity has 0 callers AND the entity name matches a pure-utility regex (`^(get|set|is|has|to|from)[A-Z]`).
2. In `lib/temporal/activities/justification.ts`, before calling the LLM, check if the entity passes the bypass threshold. If yes, write a synthetic justification document: `taxonomy: "UTILITY"`, `feature_tag: "infrastructure"`, `business_purpose: "{name}: utility accessor"`, `confidence: 0.85` (higher than fallback stubs at 0.3), `model: "heuristic-bypass"`.
3. Track bypass count in the activity return value for observability.
4. Bypass savings should appear in the pipeline log: `"Bypassed 412 pure-utility entities, saved N LLM tokens."`.
5. Add a test: 5 entities with bypass-eligible names and 0 callers → assert LLM is not called, synthetic justifications have `model: "heuristic-bypass"`.

**Affected files:** `lib/temporal/activities/justification.ts`, `lib/justification/prompt-builder.ts`

**Done when:** For a real repo, at least 15% of entities are bypassed. Bypassed justifications have `confidence: 0.85` (distinguishable from fallback stubs at `0.3`).

---

### Category F — Observability & Tracing

#### TBI-F-01: Per-Stage Pipeline Run Step Tracking

**Priority: P3**

`PipelineRun` tracking records start/end times for the whole workflow, but individual stage timings (how long did SCIP take? how long did justification take?) are not persisted. The pipeline log viewer shows them in Redis (transient), but after logs expire (24 hours), historical stage timing data is lost. Root cause analysis for slow indexing requires live monitoring rather than historical comparison.

**Sub-tasks:**
1. Add a `pipeline_run_steps` table (or JSONB column on `PipelineRun`) to store per-step timing: `{ stepName: string; startedAt: Date; completedAt?: Date; durationMs?: number; status: "running" | "completed" | "failed"; entityCount?: number }`.
2. In `lib/temporal/activities/pipeline-run.ts`, extend `updatePipelineStep` to accept `startedAt`/`completedAt` and persist to the new structure.
3. In `indexRepoWorkflow` and `incrementalIndexWorkflow`, record actual timestamps around each `updatePipelineStep` call.
4. Expose per-step timings in the Pipeline Monitor UI (`components/repo/pipeline-stepper.tsx`).
5. Add a Prisma migration for the new column/table.

**Affected files:** `lib/temporal/activities/pipeline-run.ts`, `lib/temporal/workflows/index-repo.ts`, `components/repo/pipeline-stepper.tsx`, `supabase/migrations/` (new migration)

**Done when:** The pipeline monitor shows each stage's duration in milliseconds, and historical runs retain this data beyond 24 hours.

---

### Category G — Operational Resilience (Confirmed by Real-World Diagnostic)

These tasks were identified by running the full pipeline against a real TypeScript repo (`kap10-server`, 697 files). They address gaps that cause the pipeline to report success while silently producing unusable data.

#### TBI-G-01: Fix `last_indexed_at` Never Being Set

**Priority: P3** · **Status: ✅ DONE**

> **Implemented** (2026-02-28): `lastIndexedAt: new Date()` is now set in two terminal success paths:
> 1. `setReadyStatus` in `lib/temporal/activities/embedding.ts` — when embedding completes and repo goes to `"ready"`
> 2. `setJustifyDoneStatus` in `lib/temporal/activities/justification.ts` — when justification completes
>
> The `IRelationalStore.updateRepoStatus()` port was extended with `lastIndexedAt?: Date | null` and `indexingStartedAt?: Date | null` parameters, and the Prisma adapter persists both fields.
>
> **Files changed:** `lib/ports/relational-store.ts`, `lib/adapters/prisma-relational-store.ts`, `lib/temporal/activities/embedding.ts`, `lib/temporal/activities/justification.ts`

---

#### TBI-G-02: LLM 405 Detection and User-Surfacing

**Priority: P1** · **Status: ✅ DONE**

> **Implemented** (2026-02-28): Added `isFatalLLMError()` helper that detects non-retryable HTTP status codes (405, 401, 403, 404) and configuration errors (invalid API key, model not found). A `consecutiveFatalErrors` counter tracks sequential fatal errors — after 5 consecutive fatal errors (configurable via `FATAL_ERROR_THRESHOLD`), the justification batch aborts with a thrown error instead of silently creating stubs. Fatal errors are logged to the pipeline log so they appear in the pipeline monitor UI.
>
> The error detection works at both the single-entity and batch levels. When a batch call fails with a fatal error, it still creates fallback justifications for the batch (preserving partial progress) but increments the counter and aborts when the threshold is reached.
>
> **Files changed:** `lib/temporal/activities/justification.ts` (added `isFatalLLMError()`, `consecutiveFatalErrors` counter, abort logic in both single-entity and batch error handlers)

---

#### TBI-G-03: Graph Snapshot Failure Recovery

**Priority: P2** · **Status: ✅ DONE (error handling)**

> **Implemented** (2026-02-28): `syncLocalGraphWorkflow` now has proper error handling in the catch block. The error message is logged with structured format `[wf:sync-local-graph] [orgId/repoId] Snapshot export failed: {message}`. The `updateSnapshotStatus(status: "failed")` call is wrapped in its own try/catch to prevent masking the original error. The workflow already had `retry: { maximumAttempts: 3 }` on its activity proxy configs.
>
> **Files changed:** `lib/temporal/workflows/sync-local-graph.ts` (improved error logging, wrapped status update in try/catch)
>
> **Remaining:** Dashboard retry-snapshot button and `POST /api/repos/{repoId}/retry-snapshot` route are not yet implemented.

---

#### TBI-G-04: Health Report Null Guard When Justifications Are All Fallback Stubs

**Priority: P2** · **Status: ✅ DONE**

> **Implemented** (2026-02-28): `buildHealthReport` in `lib/justification/health-report-builder.ts` now detects fallback-only justifications at the top of the function. Fallbacks are identified by `confidence <= 0.3 && feature_tag === "unclassified" && taxonomy === "UTILITY"`.
>
> - **100% fallbacks:** Adds an `llm_failure` risk (severity: high) with a descriptive message, returns the report with `justified_entities: 0` and `average_confidence: 0` — skips all LLM analysis.
> - **>80% fallbacks:** Adds an `llm_partial_failure` risk (severity: high) warning that most justifications are stubs, but continues with LLM analysis on the non-fallback entities.
>
> **Files changed:** `lib/justification/health-report-builder.ts`

---


---

### Category H — User Experience & Intelligence Transparency

These tasks transform the indexing pipeline from a "black box background task" into a transparent, interactive, and trust-building feature. They are not correctness fixes — the pipeline produces valid data without them. They are the features that turn first-time users into advocates.

#### TBI-H-01: Context Seeding — Pre-Indexing Context Injection

**Priority: P1** · **Status: ✅ DONE**

> **Implementation verified** (2026-02-28):
> - `prisma/schema.prisma` — `contextDocuments String? @map("context_documents")` on Repo model
> - `supabase/migrations/00004_context_documents.sql` — `ALTER TABLE unerr.repos ADD COLUMN IF NOT EXISTS context_documents TEXT`
> - `lib/ports/relational-store.ts` — `contextDocuments?: string | null` on `RepoRecord`, `updateRepoContextDocuments()` on `IRelationalStore`
> - `lib/adapters/prisma-relational-store.ts` — `updateRepoContextDocuments()` via raw SQL
> - `app/api/repos/[repoId]/context/route.ts` — `PUT` (save context, max 10k chars) and `GET` (retrieve) endpoints
> - `lib/temporal/activities/ontology.ts` — fetches `repo.contextDocuments`, appends to project description for LLM anchoring
> - `lib/temporal/activities/justification.ts` — fetches `repo.contextDocuments`, passes to `buildJustificationPrompt()` via `options.contextDocuments`
> - `lib/justification/prompt-builder.ts` — "Project Context (provided by the team)" section injected into prompt, truncated to 3,000 chars
> - `components/repo/repo-onboarding-console.tsx` — collapsible "Context Seeding" section with textarea, save button, character counter (visible during pending/indexing/embedding states)
>
> **Implementation approach:** Uses a simpler architecture than originally planned. Instead of a structured `ContextManifest` in ArangoDB, stores raw text directly on the repo record in PostgreSQL (`contextDocuments` field, max 10k chars). The raw text is injected into both ontology and justification LLM prompts, letting the LLM extract relevant vocabulary naturally. This avoids the complexity of a separate ingestion pipeline while achieving the same anchoring effect.
>
> **Remaining sub-tasks (enhancements, not blocking):**
> - Multiple context sources (currently single text field)
> - File-path-based context (read `ARCHITECTURE.md` from cloned workspace)
> - URL-based context ingestion
> - Structured `ContextManifest` in ArangoDB for term frequency weighting

~~Currently the pipeline infers business purpose and taxonomy entirely from code structure and entity names.~~ Users can now paste their `ARCHITECTURE.md`, PRD, or project description into the context seeding textarea before or during indexing. The text is stored as `contextDocuments` on the repo and injected into both the ontology extraction and justification prompts, anchoring `feature_tag` and `business_purpose` to the team's actual vocabulary.

**Affected files:** ~~`lib/temporal/activities/context-ingestion.ts`~~ (simplified — no separate activity needed), ~~`lib/temporal/workflows/index-repo.ts`~~ (no workflow changes needed), `lib/temporal/activities/ontology.ts` ✅, `lib/temporal/activities/justification.ts` ✅, `lib/justification/prompt-builder.ts` ✅, ~~`lib/ports/graph-store.ts`~~ (uses relational store instead), `lib/ports/relational-store.ts` ✅, `lib/adapters/prisma-relational-store.ts` ✅, `components/repo/repo-onboarding-console.tsx` ✅, `app/api/repos/[repoId]/context/route.ts` ✅ (new)

**Done when:** ~~A user pastes their `ARCHITECTURE.md` before indexing. The resulting `feature_tag` values in justifications match the terminology from their doc.~~ ✅ Core flow works. Full completion: multiple context sources, file-path-based ingestion, structured manifest.

---

#### TBI-H-02: Confidence Heatmap and Human-in-the-Loop Corrections

**Priority: P1** · **Status: ✅ DONE**

> **Implementation verified** (2026-02-28):
> - `components/code/annotated-code-viewer.tsx` — Confidence bars with gradient colors (emerald ≥80%, amber ≥50%, red <50%), taxonomy-colored left borders, semantic triple display. **Edit icon** on taxonomy badge (visible on hover). **Full inline correction editor**: taxonomy selector (VERTICAL/HORIZONTAL/UTILITY), feature tag input, business purpose textarea, "Apply Correction" button.
> - `components/blueprint/blueprint-view.tsx` — Confidence color coding (emerald/amber/red), taxonomy bar chart, `confidenceGlow()` function for ring/shadow effects on feature cards.
> - `app/api/repos/[repoId]/entities/[entityId]/override/route.ts` — `POST` endpoint accepting `{ taxonomy, featureTag?, businessPurpose? }`. Sets `confidence: 1.0`, `model_used: "human_override"`, `model_tier: "heuristic"`. Uses `bulkUpsertJustifications` to persist.
>
> **Remaining sub-tasks (enhancements, not blocking):**
> - Micro-reindexing on override (re-embed the updated justification)
> - `justification_overrides` audit collection for tracking corrections
> - Cascade propagation to callers ("Propagate to N callers?" flow)
> - Right-click context menu (current implementation uses inline edit icon)

Confidence is visualized in the annotated code viewer and blueprint view. Users can correct the AI's classifications inline via the edit icon on each entity's taxonomy badge. The correction editor allows overriding taxonomy, feature tag, and business purpose. Corrections are saved with `confidence: 1.0` and `model_used: "human_override"`.

**The addition:** A visual confidence heatmap on the Blueprint dashboard and Entity Browser, plus the ability for users to correct the AI's classifications inline.

**Sub-tasks:**

1. ~~**Heatmap on Blueprint/Entity Browser:** Fetch `confidence` alongside entity data. Apply visual encoding: emerald ≥80%, amber 50-80%, red <50%.~~ ✅ Implemented in `annotated-code-viewer.tsx` and `blueprint-view.tsx`

2. ~~**Inline correction editor:** Edit icon on taxonomy badge (hover-visible via `group-hover`). Clicking opens inline editor with taxonomy selector (VERTICAL/HORIZONTAL/UTILITY), feature tag input, business purpose textarea, Apply/Cancel buttons.~~ ✅ Implemented in `annotated-code-viewer.tsx`

3. ~~**Save override via API:** `POST /api/repos/{repoId}/entities/{entityId}/override` with `{ taxonomy, featureTag?, businessPurpose? }`. Sets `confidence: 1.0`, `model_used: "human_override"`, `model_tier: "heuristic"`. Uses `bulkUpsertJustifications` to persist.~~ ✅ Implemented in `app/api/repos/[repoId]/entities/[entityId]/override/route.ts`

4. **Micro-reindexing on override:** After saving, trigger a targeted re-embedding of the updated justification: call `embedJustification(entityId)` as a standalone Temporal activity (not the full re-index). Update the `justification_embeddings` pgvector row. This ensures search-by-purpose immediately reflects the correction.

5. **Propagate corrections:** If the overridden entity has callers, offer: _"Propagate this context to 3 callers?"_ — runs cascade re-justification scoped to direct callers only (1 hop), using the human override as ground-truth context.

6. **Override tracking collection:** ArangoDB `justification_overrides` collection tracks all human corrections for audit, analytics ("what % of justifications do users correct?"), and future fine-tuning.

**Affected files:** ~~`components/entity/entity-browse-view.tsx`~~, `components/blueprint/blueprint-view.tsx` ✅, `components/code/annotated-code-viewer.tsx` ✅, `app/api/repos/[repoId]/entities/[entityId]/override/route.ts` ✅ (new), ~~`lib/temporal/activities/justification.ts`~~, ~~`lib/temporal/activities/embedding.ts`~~, ~~`lib/ports/graph-store.ts`~~

**Done when:** ~~Low-confidence entities glow yellow in the Blueprint view. A user can right-click `PaymentProcessor`, change its `taxonomy` to VERTICAL, and within 10 seconds the justification embedding is updated and search-by-purpose returns it for relevant queries.~~ ✅ Core flow works — confidence glow, inline editor, override API. Full completion: micro-reindexing, cascade propagation, audit collection.

---

#### TBI-H-03: LLM Chain of Thought Streaming to Pipeline Monitor

**Priority: P2** · **Status: ✅ DONE**

> **Implementation verified** (2026-02-28):
> - `lib/temporal/activities/justification.ts:372-380` — per-entity reasoning log: `"Analyzed {name}. Tagged as {taxonomy} ({confidence}%) — {purpose}"` via `pipelineLog.log("info", "Justification", ...)`
> - `lib/temporal/activities/pipeline-logs.ts` — `appendPipelineLog()` + `createPipelineLogger()` infrastructure writes to Redis with 24h TTL
> - `components/repo/pipeline-log-viewer.tsx` — renders live pipeline logs during indexing
>
> **Remaining sub-tasks (UI polish, not blocking):**
> - Color-code taxonomy in log viewer (`VERTICAL` = purple, `HORIZONTAL` = blue, `UTILITY` = gray)
> - Confidence badge next to each log entry
> - "Live justification feed" expandable section in Pipeline Monitor

The Pipeline Monitor currently shows step status: `Clone → Parse → Embed → Justify`. During the Justification phase — which takes 10-60 minutes for large repos — users see a spinner with no insight into what the AI is analyzing. This is the highest-trust moment in the product and currently the most opaque.

**The addition:** Stream snippets of the LLM's reasoning into the pipeline log during Stage 7, making the justification phase a "wow" moment.

**Example log output:**
```
[20:36:42] Analyzing PaymentProcessor.ts...
  → Tagged as VERTICAL — handles external Stripe API calls, 14 callers, used in checkout flow
  → Identified formatCurrency() as HORIZONTAL utility — pure transformation, no side effects
[20:36:43] Analyzing UserAuthService.ts...
  → Tagged as VERTICAL — manages session lifecycle, high centrality (22 callers)
  → 3 callers already analyzed as VERTICAL checkout flow — confirming feature_tag: "Authentication"
```

**Sub-tasks:**

1. ~~In `lib/temporal/activities/justification.ts`, after each successful batch justification, extract a human-readable summary from the LLM result: `"{entityName}: tagged as {taxonomy} — {business_purpose_first_sentence}"`. Cap at 120 chars.~~ ✅

2. ~~Call `logActivities.appendPipelineLog()` with `level: "info"`, `step: "justification"`, and the extracted summary string after each batch. Use the existing pipeline log infrastructure (Redis TTL 24h) — no new infrastructure needed.~~ ✅

3. In `components/repo/pipeline-log-viewer.tsx`, parse log messages from the `justification` step and render them with enhanced formatting:
   - Bold the entity name
   - Color-code the taxonomy (`VERTICAL` = purple, `HORIZONTAL` = blue, `UTILITY` = gray)
   - Show confidence as a small bar or percentage badge next to each entry

4. Add a "Live justification feed" expandable section to the Pipeline Monitor that shows these messages as they stream in (polling the existing `/api/repos/{repoId}/events` SSE endpoint at 2s interval during justification).

5. Limit the number of streamed lines to **50 most recent** (don't flood the UI for large repos — the full log is available on completion).

**Affected files:** `lib/temporal/activities/justification.ts`, `components/repo/pipeline-log-viewer.tsx`, `components/repo/pipeline-stepper.tsx`

**Done when:** During a re-index, the Pipeline Monitor shows a live stream of "Analyzed X: tagged as VERTICAL because..." lines. Users can watch their codebase being understood in real time.

---

#### TBI-H-04: Auto-Generated `UNERR_CONTEXT.md` Export

**Priority: P2** · **Status: ✅ DONE**

> **Implementation verified** (2026-02-28):
> - `lib/justification/context-document-generator.ts:1-174` — `generateContextDocument()` compiles project stats, health report, features, ontology, ADRs, domain glossary, and ubiquitous language into markdown
> - `app/api/repos/[repoId]/export/context/route.ts:1-35` — GET endpoint returns markdown with `Content-Disposition: attachment; filename="UNERR_CONTEXT.md"`
> - `components/repo/repo-onboarding-console.tsx:168-177` — "Download Intelligence Report" button in celebration modal triggers download
>
> **Remaining sub-tasks (enhancements, not blocking):**
> - Auto-commit to repo via GitHub API (`.unerr/UNERR_CONTEXT.md`)
> - Repo setting for auto-commit on/off
> - Store in Supabase Storage with metadata tracking (currently generated on-demand)

At the end of indexing, the pipeline has produced a rich, structured understanding of the codebase — `features_agg`, `health_reports`, `adrs`, `domain_ontologies`, `justifications`. None of this is accessible as a plain markdown file. Developers who prefer tangible artifacts (or need to share context with teammates who don't use Unerr) have no export path.

**The addition:** Compile all pipeline outputs into a beautiful `UNERR_CONTEXT.md` and offer download or direct commit to the repo.

**Sub-tasks:**

1. ~~Create a context document generator. Assemble: header (project name, date, entity counts, health score), domain vocabulary, feature map, ADRs, health summary, code conventions, high-risk nodes.~~ ✅ `lib/justification/context-document-generator.ts`

2. Store the generated markdown in Supabase Storage at `context-docs/{orgId}/{repoId}/UNERR_CONTEXT.md`. Upsert on every re-index.

3. Record metadata in PostgreSQL `unerr.ContextDocMeta`: `{ repoId, generatedAt, sizeBytes, storagePath, checksum }`.

4. ~~Add `GET /api/repos/{repoId}/export/context` route for download.~~ ✅

5. ~~Add a "Download Intelligence Report" button to the celebration modal.~~ ✅ Add a secondary option: "Commit to repo" — uses the GitHub installation token to create/update `.unerr/UNERR_CONTEXT.md` via the GitHub Contents API.

6. Add a repo setting (`UNERR_CONTEXT.md auto-commit: on/off`) that automatically commits the file on each re-index if enabled. Commit message: `chore(unerr): update context document [skip ci]`.

**Affected files:** ~~`lib/justification/context-document-generator.ts`~~ ✅, ~~`app/api/repos/[repoId]/export/context/route.ts`~~ ✅, ~~`components/repo/repo-onboarding-console.tsx`~~ ✅, `components/blueprint/blueprint-view.tsx`

**Done when:** ~~After indexing completes, a download button appears. The downloaded file contains domain vocabulary, feature map, ADRs, health summary, and conventions in readable markdown.~~ ✅ Core flow works. Full completion: auto-commit to repo and Supabase Storage persistence.

---

#### TBI-H-05: Blast Radius Pre-computation (Semantic Impact Weights)

**Priority: P2** · **Status: ✅ DONE**

> **Implementation verified** (2026-02-28):
> - `lib/temporal/activities/graph-analysis.ts:1-101` — `precomputeBlastRadius()` activity: AQL COLLECT on `calls` edges computes `fan_in`, `fan_out` per entity. Risk levels: `"high"` (≥10), `"medium"` (≥5), `"normal"`. Bulk-updates entity documents.
> - `lib/temporal/workflows/index-repo.ts:172-178` — Step 4b calls `precomputeBlastRadius` after finalization, before child workflows.
> - `lib/ports/types.ts:14-19` — `EntityDoc` includes `fan_in?: number`, `fan_out?: number`, `risk_level?: "high" | "medium" | "normal"`.
> - `components/code/annotated-code-viewer.tsx:179-228` — High-risk entities get red border + glow, `AlertTriangle` icon badge showing fan_in/fan_out counts.
>
> **Remaining sub-tasks (enhancements, not blocking):**
> - `transitiveCallerCount` and `blastRadiusScore` (current impl uses simple fan_in/fan_out, not transitive 3-hop traversal)
> - `isChokepoint` boolean flag (current impl uses `risk_level` enum)
> - Entity Browser flame icons (current risk display is in annotated-code-viewer only)
> - Blueprint node sizing by blast radius score
> - MCP `impact` tool pre-computed fallback
> - "High Risk Entities" section on repo overview page

Impact analysis currently runs on-demand via N-hop graph traversal when an MCP tool or PR review requests it. For the Entity Browser and Blueprint view, there is no visual indication of which entities are fragile, high-risk, or architectural chokepoints — users must initiate an explicit impact query to find out.

**The addition:** Pre-compute a "blast radius weight" for every entity at the end of Stage 2 (after edges are written), and persist it as a property on the entity document. Use it as a first-class visual signal throughout the product.

**Sub-tasks:**

1. ~~Create a blast radius activity. For each entity, compute `fanIn`, `fanOut`, risk level. Write back to entity documents.~~ ✅ `lib/temporal/activities/graph-analysis.ts`

2. ~~Add `fan_in`, `fan_out`, `risk_level` to `EntityDoc` type.~~ ✅ `lib/ports/types.ts`

3. ~~In `indexRepoWorkflow`, call as Step 4b after finalization.~~ ✅ `lib/temporal/workflows/index-repo.ts:172-178`

4. ~~Show risk indicators in annotated code viewer: red border + glow for high-risk, AlertTriangle badge with fan_in/fan_out.~~ ✅ `components/code/annotated-code-viewer.tsx`

5. Extend with `transitiveCallerCount`: AQL OUTBOUND traversal depth ≤ 3 hops on `calls` collection — count unique callers reachable. Compute `blastRadiusScore`: `log2(transitiveCallerCount + 1) * (1 + fanOut / 10)`. Add `isChokepoint`: `blastRadiusScore >= 7.0`.

6. **Entity Browser** (`components/entity/entity-browse-view.tsx`): Show a flame icon next to entities where `isChokepoint: true`. Show `blastRadiusScore` as a small bar on hover.

7. **Blueprint view** (`components/blueprint/blueprint-view.tsx`): Scale node size by `blastRadiusScore`. Choke-point nodes get a distinct red-amber border ring.

8. **MCP `impact` tool** (`lib/mcp/tools/inspect.ts`): When blast radius is pre-computed, return instantly without N-hop traversal.

9. Add a "High Risk Entities" section to repo overview page: top 10 entities by `blastRadiusScore`.

**Affected files:** ~~`lib/temporal/activities/graph-analysis.ts`~~ ✅, ~~`lib/temporal/workflows/index-repo.ts`~~ ✅, ~~`lib/ports/types.ts`~~ ✅, ~~`components/code/annotated-code-viewer.tsx`~~ ✅, `lib/adapters/arango-graph-store.ts`, `components/entity/entity-browse-view.tsx`, `components/blueprint/blueprint-view.tsx`, `lib/mcp/tools/inspect.ts`, `app/(dashboard)/repos/[repoId]/page.tsx`

**Done when:** ~~After indexing, risk levels are computed and displayed in the annotated code viewer.~~ ✅ Core flow works. Full completion: transitive blast radius scoring, Entity Browser flame icons, Blueprint node sizing, MCP instant lookup, repo overview high-risk section.

---

---

### Category I — Living Documentation (Replace MEMORY.md, ARCHITECTURE.md, .cursorrules)

These tasks transform the indexing pipeline into the ultimate source of truth for a codebase — eliminating the need for manually maintained documentation files. Each task addresses a specific category of information that developers currently capture in hand-written docs.

#### TBI-I-01: Negative Knowledge Indexing (Mine the Prompt Ledger for Mistakes)

**Priority: P1**

Manual `MEMORY.md` files are largely lists of mistakes and hard-won lessons: *"Don't use `Promise.all` here because of the rate limit."* *"Never touch the billing module without running the full integration suite."* This negative knowledge is the most valuable and least-duplicable content in any engineering org. Currently, when a developer reverts an AI-assisted change or marks a ledger entry as "broken," that signal disappears — it is never written back into the graph as a warning for the next agent or developer.

**The addition:** After any ledger entry is marked as reverted/broken, the pipeline mines it for negative knowledge and attaches anti-patterns and cautions directly to the affected graph nodes.

**Sub-tasks:**

1. In `lib/temporal/activities/anti-pattern.ts`, extend the post-rewind analysis. Currently it generates a rule. Additionally, build a `NegativeKnowledgeNote` object: `{ entityIds: string[]; warning: string; reason: string; revertedAt: Date; ledgerEntryId: string }`.

2. Create a new ArangoDB collection `entity_warnings` (document collection). Each document: `{ entity_id, repo_id, org_id, warning, reason, ledger_entry_id, reverted_at, created_at }`. Multiple warnings can accumulate on a single entity.

3. Add `bulkUpsertEntityWarnings(warnings: EntityWarning[])` to `IGraphStore` port and `arango-graph-store.ts`.

4. In Stage 7 (Business Justification), when building context for an entity via `buildGraphContexts()`, fetch its `entity_warnings` from ArangoDB. Inject them into the justification prompt as a dedicated section: _"⚠️ Past failures on this entity: {warning} — {reason} (reverted {date})."_ The LLM will embed this caution into the `reasoning` field of the justification and raise the `compliance_tags` accordingly.

5. In the MCP `inspect` tool (`lib/mcp/tools/inspect.ts`), when returning entity context to an IDE agent, include `warnings[]` in the response. The agent will see: _"Warning: a previous attempt to optimize `processPayment()` was reverted due to rate limit coupling. Proceed carefully."_

6. In the Entity Browser (`components/entity/entity-browse-view.tsx`), show a ⚠️ badge on entities with active warnings. Clicking the badge shows the warning text, reason, and a link to the original ledger entry.

7. Write a test: create a ledger entry, mark it as reverted, run the anti-pattern activity, assert `entity_warnings` collection has one document for the affected entity and the entity's justification includes the warning text.

**Affected files:** `lib/temporal/activities/anti-pattern.ts`, `lib/ports/graph-store.ts`, `lib/adapters/arango-graph-store.ts`, `lib/temporal/activities/justification.ts`, `lib/justification/graph-context-builder.ts`, `lib/mcp/tools/inspect.ts`, `components/entity/entity-browse-view.tsx`

**Done when:** After reverting an AI suggestion on `PaymentProcessor.ts`, the entity has a warning in `entity_warnings`. The next justification run includes the warning in the LLM prompt. The IDE agent, when asked about `PaymentProcessor`, sees the warning in the MCP response. The Entity Browser shows a ⚠️ badge.

---

#### TBI-I-02: Temporal Context Ingestion (Git History + PR Descriptions as Justification Input)

**Priority: P1**

Stage 7 infers business purpose by reading code structure. It cannot know *why* a function was written that way — the incident that caused it, the trade-off that was made, the PR debate that settled the design. A well-written `ARCHITECTURE.md` captures this historical intent. The pipeline should ingest it directly from the git log.

**The addition:** For every file being justified, fetch its git commit history (last N commits), PR descriptions, and resolved PR comments. Inject into the justification prompt as "Historical context" — the LLM's output then marries current structure with historical intent.

**Sub-tasks:**

1. Add a `getFileGitHistory(repoPath, filePath, maxCommits)` method to `IGitHost` port. Implementation: run `git log --follow --format="%H|%s|%b" -n 20 -- {filePath}` in the cloned workspace. Returns `{ sha, subject, body }[]`.

2. Add a `getPRDescriptions(installationId, repoFullName, commitShas)` method to `IGitHost` port. Implementation: use GitHub's Commits API to find PRs associated with each SHA, then fetch PR body + resolved review comments (capped at 3 PRs, 500 chars per PR body, 3 comments per PR).

3. Create a new Temporal activity `fetchHistoricalContext` in `lib/temporal/activities/historical-context.ts`. For a batch of entities (grouped by file, deduplicated), calls `getFileGitHistory` and `getPRDescriptions`. Returns `Map<filePath, HistoricalContext>` where `HistoricalContext = { commitMessages: string[]; prDescriptions: string[]; reviewNotes: string[] }`.

4. Call `fetchHistoricalContext` as a pre-step in `justifyRepoWorkflow` (before the topological sort loop). Pass the result map into each topological level's context building.

5. In `lib/justification/graph-context-builder.ts`, add `historicalContext?: HistoricalContext` to the entity context object. Cap historical context at **800 chars total** to avoid exceeding token budgets.

6. In `lib/justification/prompt-builder.ts`, inject historical context as a dedicated prompt section: _"Historical context for this file:\n- Commit: 'Fix Stripe timeout handling after incident'\n- PR #402: 'Added exponential backoff to payment retry after production timeout spike'\n- Review: 'Consider using a circuit breaker pattern here instead'"_.

7. Add `historicalContext` to the justification document in ArangoDB so future re-justifications can compare against what was previously captured.

8. For cost control: only fetch historical context for entities with `tier: "premium"` or `tier: "standard"` (those with 3+ callers). Pure utility functions (`tier: "fast"`) skip this step.

**Affected files:** `lib/ports/git-host.ts`, `lib/temporal/activities/historical-context.ts` (new), `lib/temporal/workflows/justify-repo.ts`, `lib/justification/graph-context-builder.ts`, `lib/justification/prompt-builder.ts`

**Done when:** The justification for a function that was added in a PR titled "Fix Stripe timeout after incident" includes a sentence referencing the Stripe timeout incident. Entities justified with historical context have a `historical_anchors: ["PR #402: ..."]` field in their justification document.

---

#### TBI-I-03: Tech-Stack & System Boundary Extraction

**Priority: P2**

Architecture documentation always includes a system boundary diagram: what external services does this system call? What databases? What message queues? This information is currently scattered across entity metadata (Stripe SDK imports appear as `imports` edges to `node_modules/stripe`) but never synthesized into a "System Boundary Map." When an agent asks for the Blueprint, it sees internal entities but has no structured view of the external world the system talks to.

**The addition:** Enhance Stage 3 (tree-sitter parsing) to identify and classify third-party dependencies and external API calls, producing an explicit `system_boundaries` ArangoDB collection.

**Sub-tasks:**

1. In `lib/indexer/languages/typescript/tree-sitter.ts` (and Python, Go equivalents), identify third-party imports by checking if the import path is a bare package name (no `./`, `@/`, `~/` prefix). Cross-reference against `package.json` `dependencies`/`devDependencies` to confirm it's an installed package vs a path alias.

2. Classify third-party packages into boundary categories using a curated map (`lib/indexer/boundary-classifier.ts`):
   - `payment`: `stripe`, `braintree`, `paypal-node-sdk`
   - `database`: `pg`, `mongoose`, `@prisma/client`, `arangojs`
   - `cache`: `ioredis`, `redis`, `memcached`
   - `messaging`: `amqplib`, `kafkajs`, `@aws-sdk/client-sqs`
   - `auth`: `passport`, `better-auth`, `jsonwebtoken`
   - `cloud`: `@aws-sdk/*`, `@google-cloud/*`, `@azure/*`
   - `monitoring`: `@sentry/node`, `pino`, `dd-trace`
   - `http-client`: `axios`, `node-fetch`, `undici`
   - For unknown packages: `third-party`

3. Scan function bodies for HTTP call patterns: `fetch(`, `axios.get(`, `got.post(` with a non-relative URL string. Extract the hostname/domain as an external endpoint label.

4. Write extracted boundaries to a new ArangoDB `system_boundaries` document collection: `{ name, category, package_name, version, files_using: string[], entity_count, first_seen_at }`. One document per unique external service.

5. Create `calls_external` edge collection linking entities to system boundary nodes: `{ _from: "functions/entity_key", _to: "system_boundaries/boundary_key", call_type: "import" | "http" }`.

6. Expose system boundaries in the Blueprint view as a new "External Systems" layer — distinct colored nodes outside the internal graph, with edges showing which internal entities depend on them.

7. Add a `getSystemBoundaries(orgId, repoId)` method to `IGraphStore` port. Expose via `GET /api/repos/{repoId}/boundaries`.

8. In the MCP Blueprint tool, include system boundaries in the response: _"External dependencies: Stripe (payment, 14 entities), Redis (cache, 8 entities), GitHub API (http-client, 3 entities)."_

**Affected files:** `lib/indexer/languages/typescript/tree-sitter.ts`, `lib/indexer/boundary-classifier.ts` (new), `lib/temporal/activities/indexing-heavy.ts`, `lib/ports/graph-store.ts`, `lib/adapters/arango-graph-store.ts`, `components/blueprint/blueprint-view.tsx`, `lib/mcp/tools/graph.ts`, `app/api/repos/[repoId]/boundaries/route.ts` (new)

**Done when:** After indexing `kap10-server`, the `system_boundaries` collection has entries for Stripe, Redis, ArangoDB, GitHub API, and Supabase. The Blueprint view shows these as distinct external nodes. The MCP Blueprint tool lists them in its response.

---

#### TBI-I-04: Semantic Drift as Auto-Documentation Trigger

**Priority: P2**

The pipeline currently detects architectural drift — when a HORIZONTAL utility's semantic meaning shifts toward VERTICAL business logic — and writes it to `drift_scores`. This is flagged as a passive risk. But the real value of detecting drift is not just warning users; it is prompting them to update the system's understanding before the divergence becomes a legacy problem.

**The addition:** When drift is detected above a threshold, the pipeline drafts an updated Business Justification and proposes an ADR revision. It presents this to the developer as an interactive question — "has this module changed its role?"

**Sub-tasks:**

1. In `lib/temporal/activities/drift-alert.ts`, when `drift_score > 0.6` (current threshold for significant drift), mark the entity as `pending_redocumentation: true` in ArangoDB.

2. Create a new Temporal activity `proposeDriftDocumentation` in `lib/temporal/activities/drift-documentation.ts`. For entities flagged with `pending_redocumentation`:
   - Re-run the justification LLM with the entity's *current* code + the *previous* justification as explicit context: _"This entity was previously classified as: {old_business_purpose}. Based on its current implementation, has its role changed?"_
   - If the LLM detects a role change, generate: (a) a revised `business_purpose` draft, (b) a `DriftADR` proposal: _"`SessionManager` now handles billing state in addition to auth. This represents a cross-boundary concern. Recommend: extract billing state into a dedicated `BillingSession` module."_

3. Store the proposal in a new ArangoDB `documentation_proposals` collection: `{ entity_id, old_taxonomy, proposed_taxonomy, old_business_purpose, proposed_business_purpose, adr_draft, confidence, created_at, status: "pending" | "accepted" | "rejected" }`.

4. Surface proposals in the dashboard as a "Documentation Review" notification panel (`components/intelligence/drift-timeline-view.tsx`): _"⚡ 3 modules appear to have changed their role. Review and confirm?"_ Each proposal shows old vs new classification with a diff view. One-click accept (triggers justification update + ADR write) or reject (marks entity as reviewed, suppresses for 30 days).

5. Add `POST /api/repos/{repoId}/documentation-proposals/{proposalId}/accept` and `/reject` routes. Accepting triggers a targeted re-justification activity for that entity.

6. Include `pending_redocumentation` count in the repo overview page as a badge: _"3 modules need documentation review."_

**Affected files:** `lib/temporal/activities/drift-alert.ts`, `lib/temporal/activities/drift-documentation.ts` (new), `lib/ports/graph-store.ts`, `lib/adapters/arango-graph-store.ts`, `components/intelligence/drift-timeline-view.tsx`, `app/api/repos/[repoId]/documentation-proposals/` (new routes), `app/(dashboard)/repos/[repoId]/page.tsx`

**Done when:** When `SessionManager.ts` starts importing from the billing module, the pipeline detects drift, creates a proposal with an ADR draft, and shows a notification in the dashboard. The developer clicks "Accept," the justification updates, and the ADR is written to the `adrs` collection.

---

#### TBI-I-05: Idiomatic Standard Discovery (Auto-Generate .cursorrules / TEAM_CONVENTIONS.md)

**Priority: P2**

Developers maintain `.cursorrules` files to tell AI agents how their specific team structures code — which hooks to use, how they handle errors, how they organize components, what naming conventions they follow. These files are written and forgotten, become stale, and require manual expertise to write well. The pattern detection engine already detects structural patterns — it just doesn't synthesize them into a `TEAM_CONVENTIONS.md` equivalent.

**The addition:** After pattern detection (Stage 10), synthesize detected idioms, rules, and conventions into a structured `TEAM_CONVENTIONS.md` document and expose it as a first-class graph artifact.

**Sub-tasks:**

1. In `lib/temporal/activities/pattern-mining.ts`, after mining frequency-based conventions, add framework-specific idiom detection. Extend `mined_patterns` with an `idiom_type` field:
   - `react-hook-pattern`: how the team structures custom hooks (`use*` functions, dependency arrays, cleanup patterns)
   - `error-handling-pattern`: try/catch shape, error logging style, re-throw convention
   - `di-pattern`: how DI is done (constructor injection vs factory vs container.get)
   - `test-structure`: describe/it nesting depth, mock setup location, assertion style
   - `naming-convention`: camelCase vs PascalCase usage patterns per entity type
   - `import-order`: barrel exports vs direct imports, alias usage

2. After pattern mining completes, call a new `synthesizeTeamConventions` activity (`lib/temporal/activities/team-conventions.ts`). Fetches all `mined_patterns` with adherence > 60% and builds a structured `TeamConventions` object:
   - Per-idiom-type: the dominant pattern, adherence %, exemplar entity keys, counter-examples
   - Converts to both: (a) machine-readable format stored in ArangoDB `team_conventions` collection; (b) `TEAM_CONVENTIONS.md` markdown.

3. The generated `TEAM_CONVENTIONS.md` structure:
   ```
   # Team Conventions — {repo_name}
   *Auto-generated by Unerr on {date}. Last updated by {indexVersion}.*

   ## React Hooks
   - Custom hooks always declare cleanup in the return function (94% adherence, 47/50 hooks)
   - useState before useEffect before custom hooks (88% adherence)

   ## Error Handling
   - catch blocks always call logger.error with context object (91% adherence)
   - Never re-throw raw errors — always wrap in AppError (78% adherence)

   ## Dependency Injection
   - Container pattern via getContainer() — never instantiate adapters directly (96% adherence)
   ```

4. Store `TEAM_CONVENTIONS.md` in Supabase Storage at `context-docs/{orgId}/{repoId}/TEAM_CONVENTIONS.md`. Update on every full re-index.

5. In the MCP `rules` tool (`lib/mcp/tools/rules.ts`), when returning active rules, prepend team convention idioms as high-priority implicit rules. An IDE agent asking "what are the coding standards?" receives the auto-generated conventions without any manual configuration.

6. Add a "Download TEAM_CONVENTIONS.md" button to the repo Settings > Rules page. Add a "Commit to repo as `.cursor/rules`" option that converts the conventions to `.cursorrules` format and commits via the GitHub API.

7. Drift detection for conventions: if adherence to a convention drops below 50% (from a previous 80%), flag it as a "Convention erosion" in the drift dashboard.

**Affected files:** `lib/temporal/activities/pattern-mining.ts`, `lib/temporal/activities/team-conventions.ts` (new), `lib/ports/graph-store.ts`, `lib/adapters/arango-graph-store.ts`, `lib/mcp/tools/rules.ts`, `components/repo/repo-manage-panel.tsx`, `app/(dashboard)/repos/[repoId]/settings/review/page.tsx`

**Done when:** After indexing, `TEAM_CONVENTIONS.md` is written to Supabase Storage with accurate adherence percentages for at least 3 idiom types. The MCP `rules` tool includes convention idioms in its response. The "Commit as `.cursor/rules`" button writes a valid `.cursorrules` file to the repo.

---

### Category J — Autonomous Context Delivery (Zero-Config Agent Intelligence)

These tasks complete the vision: the knowledge graph doesn't just exist — it actively delivers the right context to the right agent at the right time. No manual docs, no `.cursorrules`, no `MEMORY.md` — the graph IS the documentation, and it speaks MCP.

#### TBI-J-01: Proactive File-Open Context Injection via MCP

**Priority: P1** · **Status: ❌ NOT STARTED**

When an IDE agent opens a file, the MCP server should proactively deliver a context bundle for that file — entity purposes, warnings, conventions, blast radius, related ADRs — without the agent having to ask. Currently the agent must explicitly call `inspect` or `search` tools to get context. This creates a cold-start problem: the agent doesn't know what it doesn't know.

**The addition:** A new MCP tool and resource subscription that pushes relevant context when a file is opened or modified in the editor.

**Sub-tasks:**

1. Add a `getFileContext(orgId, repoId, filePath)` method to `IGraphStore` port. Returns a `FileContextBundle`: `{ entities: EntitySummary[], warnings: EntityWarning[], conventions: ConventionRule[], blastRadius: RiskSummary, relatedADRs: ADRSummary[], recentDrift: DriftEntry[] }`. Single AQL query joining across entities, entity_warnings, justifications, and adrs collections.

2. In `lib/mcp/tools/inspect.ts`, add a new `file_context` tool that accepts a file path and returns the full `FileContextBundle` as structured JSON. This is the pull-based fallback.

3. In `lib/mcp/transport.ts`, implement MCP resource subscriptions for file paths. When the IDE client subscribes to `file://{path}`, the server resolves entities in that file and returns the context bundle. On entity changes (re-index, override), push updated context.

4. Format the context bundle as a concise markdown block suitable for system prompt injection:
   ```
   ## Context for src/payments/processor.ts
   **Purpose:** Core payment processing — handles Stripe API calls, retry logic, idempotency.
   **Risk:** HIGH (fan_in=14, fan_out=8) — changes here affect 14 callers.
   **Warnings:** ⚠️ Previous optimization reverted (rate limit coupling).
   **Conventions:** Always wrap errors in AppError (91% adherence). Use PaymentGateway adapter.
   **Related ADR:** ADR-007: Chose idempotency keys over database locks.
   ```

5. Add a `contextBundleSize` metric to track token cost per file (target: < 500 tokens per file).

**Affected files:** `lib/ports/graph-store.ts`, `lib/adapters/arango-graph-store.ts`, `lib/mcp/tools/inspect.ts`, `lib/mcp/transport.ts`

**Done when:** An IDE agent opens `processor.ts` and receives a context bundle including entity purposes, risk level, warnings, and conventions — without calling any tools. The agent's first response about that file is informed by the full graph context.

---

#### TBI-J-02: Unified Knowledge Document Generator (Replace ALL Manual Docs)

**Priority: P2** · **Status: ❌ NOT STARTED**

TBI-H-04 generates `UNERR_CONTEXT.md` (features, health, ADRs). TBI-I-05 generates `TEAM_CONVENTIONS.md` (coding patterns). TBI-I-01 produces `entity_warnings`. These are separate artifacts. The vision is ONE document that replaces MEMORY.md + ARCHITECTURE.md + .cursorrules entirely — a comprehensive, auto-generated knowledge base.

**The addition:** A unified `UNERR_KNOWLEDGE.md` generator that combines all pipeline outputs into a single, versioned document with sections mapping 1:1 to what developers manually write.

**Sub-tasks:**

1. Create `lib/justification/knowledge-document-generator.ts`. Extend `context-document-generator.ts` to include:
   - **Section: System Architecture** — system boundaries (TBI-I-03), external dependencies, data flow
   - **Section: Domain Model** — ontology terms, ubiquitous language, entity taxonomy breakdown
   - **Section: Lessons Learned** — entity warnings from `entity_warnings` (TBI-I-01)
   - **Section: Coding Standards** — team conventions with adherence % (TBI-I-05)
   - **Section: Risk Map** — top 20 high-risk entities with blast radius, drift status
   - **Section: Feature Map** — from `features_agg`, entity lists per feature
   - **Section: Architecture Decisions** — ADRs with evidence and status
   - **Section: Health Report** — current issues, trends, recommended actions

2. Add `GET /api/repos/{repoId}/export/knowledge` route with format options:
   - `?format=markdown` (default) — full `UNERR_KNOWLEDGE.md`
   - `?format=cursorrules` — conventions only, `.cursor/rules` compatible
   - `?format=claude-md` — conventions + architecture, `CLAUDE.md` compatible

3. Add "Export Knowledge Base" dropdown to repo settings: "Download UNERR_KNOWLEDGE.md", "Commit as CLAUDE.md", "Commit as .cursor/rules".

4. Track document versions: `knowledge_doc_versions` with `{ version, generated_at, section_checksums, diff_from_previous }`.

**Affected files:** `lib/justification/knowledge-document-generator.ts` (new), `app/api/repos/[repoId]/export/knowledge/route.ts` (new), `components/repo/repo-manage-panel.tsx`

**Done when:** "Export Knowledge Base" produces a single document with architecture, domain model, lessons learned, coding standards, risk map, features, ADRs, and health — replacing MEMORY.md, ARCHITECTURE.md, and .cursorrules in one artifact.

---

#### TBI-J-03: Incremental Context Refresh on Push

**Priority: P2** · **Status: ❌ NOT STARTED**

Context documents (UNERR_CONTEXT.md, knowledge base) are generated only during full re-index. Incremental indexing (Stage 14) updates entities and edges but does not refresh downstream context artifacts. After 50 incremental pushes, the exported knowledge document is 50 commits stale.

**The addition:** After incremental indexing, selectively refresh affected sections of the knowledge document based on what changed.

**Sub-tasks:**

1. In `lib/temporal/workflows/incremental-index.ts`, after incremental parse + embed, determine which sections are invalidated:
   - Changed entities → refresh "Feature Map" and "Risk Map"
   - New/deleted entities → refresh "Domain Model"
   - Changed blast radius → refresh "Risk Map"
   - New entity warnings → refresh "Lessons Learned"
   - Convention adherence change > 5% → refresh "Coding Standards"

2. Create `refreshKnowledgeSections` light activity: regenerate only invalidated sections and patch the stored document.

3. If auto-commit enabled, commit with: `chore(unerr): refresh context after {N} file changes [skip ci]`.

4. Debounce: accumulate changes, refresh when 10+ files changed or 24 hours elapsed since last refresh.

**Affected files:** `lib/temporal/workflows/incremental-index.ts`, `lib/justification/knowledge-document-generator.ts`, `lib/temporal/activities/context-refresh.ts` (new)

**Done when:** After 10 incremental pushes modifying `PaymentProcessor.ts`, the knowledge document's "Risk Map" reflects updated blast radius without a full re-index.

---

#### TBI-J-04: Agent Memory Sync — Write Graph Learnings to IDE Config Files

**Priority: P3** · **Status: ❌ NOT STARTED**

The graph learns continuously — new patterns, warnings, convention changes, drift. IDE agents have their own memory files (CLAUDE.md, .cursorrules, .github/copilot-instructions.md). Currently these must be manually updated. The graph should push its learnings into the agent's native format automatically.

**The addition:** A scheduled sync that writes graph insights into IDE memory files via GitHub API commits.

**Sub-tasks:**

1. Create `lib/export/agent-memory-sync.ts` with format adapters:
   - `toCLAUDEmd()`: Architecture patterns, key file paths, conventions, warnings
   - `toCursorrules()`: Coding conventions, error handling patterns, naming rules
   - `toCopilotInstructions()`: Project context in GitHub Copilot format

2. Add repo setting: "Agent Memory Sync" with target format selection (CLAUDE.md / .cursorrules / copilot-instructions / all).

3. Create scheduled Temporal workflow `syncAgentMemory` (weekly or on-demand after full re-index):
   - Fetch current graph state (conventions, warnings, ADRs, high-risk entities)
   - Generate target format, diff against current file in repo (GitHub Contents API)
   - If diff > 5 lines, create PR: `chore(unerr): sync agent memory from knowledge graph`
   - PR description includes changelog: "Added 3 warnings, updated 2 conventions, removed 1 stale pattern."

**Affected files:** `lib/export/agent-memory-sync.ts` (new), `lib/temporal/workflows/agent-memory-sync.ts` (new), `app/api/repos/[repoId]/settings/agent-sync/route.ts` (new)

**Done when:** After enabling agent memory sync, a PR is automatically created with an updated `CLAUDE.md` that includes new warnings, updated conventions, and fresh architecture insights from the knowledge graph.

---

### Implementation Order

Tasks are independent within categories but build on each other across categories. Recommended sequencing:

| Wave | Tasks | Rationale |
|------|-------|-----------|
| ~~**Wave 0 (Hotfix)**~~ ✅ | ~~TBI-G-02, TBI-G-01~~ | **DONE** — fatal LLM error detection + `last_indexed_at` fix |
| ~~**Wave 1 (partial)**~~ | ~~TBI-B-01~~ ✅, TBI-A-01, TBI-A-02, ~~TBI-G-04~~ ✅, ~~TBI-D-02~~ ✅, ~~TBI-G-03~~ ✅ | B-01/G-04/D-02/G-03 **DONE**; Python/Go SCIP still pending |
| **Wave 2** | TBI-B-02, TBI-B-03, TBI-D-01 | Orphan cleanup (depends on B-01), Python/Go import edges, incremental fallback |
| **Wave 3** | TBI-I-01, TBI-A-03, TBI-E-01 | Negative knowledge, Java, O(1) snapshot. ~~TBI-H-05, TBI-H-03~~ ✅ already done |
| **Wave 4** | ~~TBI-H-01~~ ✅, ~~TBI-H-02~~ ✅, TBI-I-02, TBI-J-01, TBI-C-01, TBI-C-02 | ~~Context seeding~~ ✅, ~~correction UI~~ ✅, git history, proactive MCP context, decorator extraction, cross-level propagation |
| **Wave 5** | TBI-I-03, TBI-I-05, TBI-J-02, TBI-A-04, TBI-C-03 | System boundaries, team conventions, unified knowledge doc, multi-language tree-sitter, manifests. ~~TBI-H-04~~ ✅ already done |
| **Wave 6** | TBI-I-04, TBI-J-03, TBI-D-03, TBI-A-05, TBI-C-04, TBI-C-05 | Drift-as-doc-trigger, incremental context refresh, rewind tracing, polyglot monorepo, signatures, heuristic bypass |
| **Wave 7** | TBI-J-04, TBI-D-04, TBI-E-02, TBI-F-01 | Agent memory sync, edge repair audit, bulk import, per-stage observability |

Wave 0 is complete. Wave 1 is partially complete (4 of 6 tasks done). Next priority: Python/Go SCIP (TBI-A-01, TBI-A-02).

---

## 21. Validation History

> Compact log of real-world validation runs. Detailed findings have been merged into the TBI task descriptions in Section 20 above.

### Run 1: 2026-02-27 (kap10-server, Lightning AI)

**Config:** `LLM_PROVIDER=ollama`, `LLM_BASE_URL=https://lightning.ai/api/v1`, `LLM_MODEL=lightning-ai/gpt-oss-20b`
**Result:** Graph stage fully correct (697 files, 1,786 functions, 591 call edges, 1,267 import edges). All LLM-dependent stages failed silently — Lightning AI endpoint returned HTTP 405 for every justification call. Pipeline reported `status: "ready"` with no error.
**Bugs found:** 6 — TBI-G-01, TBI-G-02, TBI-G-03, TBI-G-04, TBI-B-01, TBI-D-02.
**Fixes shipped:** 2026-02-28. All 6 bugs resolved. LLM provider switched to `LLM_PROVIDER=openai`. Re-index button added to repo overview page. See TBI task descriptions for implementation details.
