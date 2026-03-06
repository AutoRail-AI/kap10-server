# The Indexing Pipeline: How Unerr Captures the Soul of a Codebase

> This document is the definitive reference for Unerr's indexing pipeline — the multi-stage process that transforms a git repository into a rich, queryable knowledge graph with business context, semantic embeddings, and architectural intelligence. Every feature in the product depends on the data this pipeline produces.
>
> **Architecture:** The pipeline is built on **signal convergence** — four independent signal families (structural, intent, temporal, domain) computed by separate stages and converging into a unified **Entity Profile** per entity. The Entity Profile is the product: what agents consume, what MCP tools return, what makes Unerr distinct from tools that only parse syntax.

---

## Table of Contents

1. [Why Indexing Matters](#1-why-indexing-matters)
2. [Pipeline Overview](#2-pipeline-overview)
3. [Trigger Paths](#3-trigger-paths)
4. [Stage 1: Prepare Repo Intelligence Space](#4-stage-1-prepare-repo-intelligence-space)
5. [Stage 2: SCIP Analysis](#5-stage-2-scip-analysis)
6. [Stage 3: Tree-Sitter Fallback Parsing](#6-stage-3-tree-sitter-fallback-parsing)
7. [Stage 4: Finalization & Shadow Swap](#7-stage-4-finalization--shadow-swap)
8. [Stage 4b: Blast Radius, PageRank & Community Pre-Computation](#8-stage-4b-blast-radius-pagerank--community-pre-computation)
9. [Stage 4c: Temporal Analysis](#9-stage-4c-temporal-analysis)
10. [Stage 5: Embedding (Two-Pass)](#10-stage-5-embedding-two-pass)
11. [Stage 6: Ontology Discovery](#11-stage-6-ontology-discovery)
12. [Stage 7: Business Justification](#12-stage-7-business-justification)
13. [Stage 8: Health Report & ADR Generation](#13-stage-8-health-report--adr-generation)
14. [Stage 9: Graph Snapshot Export](#14-stage-9-graph-snapshot-export)
15. [Stage 10: Pattern Detection & Convention Discovery](#15-stage-10-pattern-detection--convention-discovery)
16. [Incremental Indexing (Push Webhooks)](#16-incremental-indexing)
16b. [Repo Deletion Workflow](#16b-repo-deletion-workflow)
17. [Token Limits & Batch Sizes](#17-token-limits--batch-sizes)
18. [Data Model: What Gets Stored Where](#18-data-model)
19. [Feature Dependency Map](#19-feature-dependency-map)
20. [Design Principles](#20-design-principles)
21. [Overall Pipeline Status](#21-overall-pipeline-status)
22. [Remaining Work](#22-remaining-work)
23. [Validation History](#23-validation-history)

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

The pipeline runs in **12 stages** (Stages 1–4, 4b, 4c, 5–10, plus incremental). Each stage enriches the data the previous stage produced. By the end, a repository of source files has been transformed into a multi-dimensional knowledge base that an AI agent can reason about as fluently as a senior engineer who has worked in the codebase for years.

---

## 2. Pipeline Overview

```
TRIGGER (GitHub install / manual reindex / push webhook / CLI upload)
  |
  v
indexRepoWorkflow (heavy-compute-queue)
  |
  |-- [1]  prepareRepoIntelligenceSpace . Fresh clone (rm stale dir), scan files, detect languages
  |-- [1b] wipeRepoGraphData ........... Clean slate: ArangoDB, Redis, pgvector, Storage, filesystem
  |-- [2]  runSCIP ..................... Precise cross-file code intelligence
  |-- [3]  parseRest ................... Tree-sitter fallback + cross-file call resolution
  |-- [4]  finalizeIndexing ............ Shadow swap, stale entity cleanup
  |-- [4b] precomputeBlastRadius ....... PageRank, communities, structural fingerprint, confidence
  |-- [4c] computeTemporalAnalysis ..... Git co-change mining, temporal context per entity
  |
  |-- (fire-and-forget children) -------+
  |                                     |
  |   [5] embedRepoWorkflow            |  Pass 1: structural embedding (light-llm-queue)
  |     |-- Kind-aware embedding        |  Vertex AI Gemini Embedding 001 (768d), pgvector
  |     |                               |
  |     +-> [6] discoverOntology        |  Three-tier ontology extraction
  |           |                         |
  |           +-> [7] justifyRepo       |  Signal-aware LLM justification + community labels
  |                 |                   |    → Pass 2: synthesis re-embedding
  |                 |                   |    → Entity Profile cache warm
  |                 +-> [8] health      |  LLM generates health report + ADRs
  |                                     |
  |   [9] syncLocalGraph                |  Msgpack snapshot -> Supabase Storage
  |                                     |
  |   [10] detectPatterns               |  ast-grep + LLM rule synthesis + semantic mining
  +-------------------------------------+
```

**Two worker queues:**

| Queue | Purpose | Examples |
|-------|---------|----------|
| `heavy-compute-queue` | CPU-bound work | Git clone, SCIP parsing, tree-sitter, Semgrep, temporal analysis |
| `light-llm-queue` | Network-bound work | LLM calls, embedding, storage uploads, cache ops |

> **Phase 13 Note:** In Phase 13, the `heavy-compute-queue` "Git clone" step changes to **"Git worktree (from bare clone on gitserver volume)"** — eliminating network-dependent clones in favor of instant local worktree checkouts.

**Orchestration:** Temporal workflows. Each stage is a Temporal activity with heartbeats, timeouts, and retry policies. Pipeline progress is tracked in PostgreSQL (`PipelineRun` table with 11 discrete steps plus metadata) and streamed to the dashboard via SSE. Each step records start/complete/fail timestamps, enabling per-stage latency analysis and bottleneck identification. The main `indexRepoWorkflow` tracks per-step wall-clock durations (`stepDurations` record) and computes a **signal quality score** — the ratio of files covered by high-fidelity SCIP vs tree-sitter fallback — emitted in the completion summary alongside total duration and enriched metrics.

**Signal Convergence Model:**

```
                    ┌── Structural signal (graph position, PageRank, communities, fingerprint)
                    │
[Parse] → [Graph] ──┼── Intent signal (tests, docs, commits, entry points, naming)
                    │
                    ├── Temporal signal (co-change, author concentration, stability, drift)
                    │
                    └── Domain signal (ontology, conventions, rules)

                    ↓ converge

              [Entity Profile]  ← the product (cached in Redis, served via MCP)

                    ↓

              [Synthesis Embedding]  ← Pass 2 re-embedding with all signals
```

Each signal is independent. Each has its own confidence dimension. The LLM synthesizes them into a unified justification. The embedding captures the synthesis, not just one signal. Confidence is **calibrated** from observable signals, not LLM self-reported.

---

## 3. Trigger Paths

### 3a. GitHub App Installation (Full Index)

User connects a repository through the GitHub App. The callback stores an `installation_id` in PostgreSQL, registers the repo in `unerr.repos`, and dispatches `indexRepoWorkflow` on `heavy-compute-queue`.

**Features that depend on this:** 1.2 GitHub App Install, 10.2 GitHub Connections.

### 3b. Manual Re-index

`POST /api/repos/[repoId]/reindex`. Two layers protect against concurrent indexing:

1. **Status check (primary guard)** — if the repo's current status is any in-progress state (`indexing`, `embedding`, `justifying`, `analyzing`), the request is rejected immediately with HTTP 409.
2. **Fixed Temporal `workflowId`** (`reindex-{orgId}-{repoId}`, no timestamp) — Temporal itself rejects a `startWorkflow` call if a workflow with that ID is already running.
3. **Rate limit** — capped at 1 per hour per repo (Redis key `reindex:{repoId}`).

Generates a `runId` (UUID) and `indexVersion` (UUID for shadow re-indexing). If the repo is already `"ready"`, it stays `"ready"` during re-index — users experience no downtime.

**Features that depend on this:** 9.2 Pipeline Monitor (live progress).

### 3c. GitHub Push Webhook (Incremental)

`POST /api/webhooks/github` receives a push event. HMAC-SHA256 verified. Only default-branch pushes are processed. If there's a SHA gap (`repo.lastIndexedSha !== payload.before`), a full re-index is triggered. Otherwise, `incrementalIndexWorkflow` starts with signal-with-start (see [Section 16](#16-incremental-indexing)).

**Features that depend on this:** 5.4 Architectural Drift, 9.3 Activity Feed.

### 3d. CLI Upload (Local/Non-GitHub)

`unerr push` creates an ignore-aware zip (respecting `.gitignore` + `.unerrignore` via the shared `createIgnoreFilter()` utility in `packages/cli/src/ignore.ts`), uploads to Supabase Storage, then triggers `indexRepoWorkflow` with `provider: "local_cli"`. The intelligence space preparation stage downloads and extracts the zip instead of cloning from GitHub.

**Features that depend on this:** 1.3 Local CLI Upload, 1.4 Ephemeral Sandbox.

> **Phase 13 Evolution:** All trigger paths above will be unified through the **Ingestion Gateway** (Phase 13). GitHub webhooks trigger a `git fetch` on the internal bare git clone instead of a fresh `git clone --depth 1`. CLI uploads bootstrap the bare clone. A new trigger path — **CLI workspace sync** (`unerr sync`) — uses Merkle-tree change detection to track per-user uncommitted changes. See [PHASE_13_IMMUTABLE_SOURCE_ARTIFACTS.md](./PHASE_13_IMMUTABLE_SOURCE_ARTIFACTS.md) for the full architecture.

---

## 4. Stage 1: Prepare Repo Intelligence Space

**Activity:** `prepareRepoIntelligenceSpace` | **Queue:** heavy-compute | **Timeout:** 30 minutes
**Source:** `lib/temporal/activities/indexing-heavy.ts`

### Input

- `orgId`, `repoId`, `installationId` (or CLI upload reference)
- GitHub credentials or Supabase Storage path

### What Happens

1. **Fresh clone** — removes the existing clone directory (`/data/repo-indices/{orgId}/{repoId}`) if present, then shallow-clones the repository using `container.gitHost.cloneRepo()` with `--depth 1 --single-branch` — fetches only the latest commit. The rm-before-clone ensures deleted files from the repo don't persist across re-index runs. For CLI uploads, downloads the zip from Supabase Storage and extracts it.

2. **Get the commit SHA** via `git rev-parse HEAD`. This SHA becomes the repo's `lastIndexedSha` — used for incremental indexing SHA gap detection.

3. **Scan the intelligence space** via `scanIndexDir()`:
   - Runs `git ls-files --cached --others --exclude-standard` (respects `.gitignore`)
   - Falls back to `find` if git is unavailable
   - All results post-filtered through the **unified ignore system** (`loadIgnoreFilter()` from `lib/indexer/ignore.ts`) which combines three layers:
     - **`ALWAYS_IGNORE`** — 30+ hardcoded directories for all supported ecosystems (Node, Python, Go, Rust, Java, C#, Ruby, PHP, C/C++): `node_modules`, `.git`, `target`, `.gradle`, `obj`, `.bundle`, `__pycache__`, `dist`, `vendor`, `.venv`, etc.
     - **`.gitignore`** — standard gitignore patterns from the repository root
     - **`.unerrignore`** — optional user-defined patterns (gitignore syntax) for excluding test fixtures, generated code, docs, etc. from indexing
   - The filter is **cached per indexDir** — `scanIndexDir`, `parseSCIPOutput`, and `scanWithAstGrep` all share the same cached filter instance within a single indexing run
   - Returns a flat list of `ScannedFile[]` with `relativePath`, `absolutePath`, `extension`

4. **Detect languages** via `detectLanguages()` with polyglot monorepo support:
   - Groups files by extension across 10 supported languages: TypeScript, Python, Go, Java, C, C++, C#, PHP, Ruby, Rust
   - Sorts by file count (dominant language first)
   - For monorepos, `detectLanguagePerRoot()` scans each workspace root to determine its dominant language independently

5. **Detect monorepo roots** via `detectPackageRoots()`:
   - Finds directories with their own `package.json`, `go.mod`, `pyproject.toml`, `pom.xml`, `build.gradle`
   - Maven multi-module and Gradle multi-project detection for Java monorepos

6. **Workspace cleanup** — after all downstream workflows complete, a `cleanupWorkspaceFilesystem` activity deletes the cloned directory. A safety-net cron cleans orphaned workspaces older than 24 hours.

> **Phase 13 Evolution:** Stage 1 replaces `git clone --depth 1` with the internal **gitserver** bare clone + git worktree pattern:
> 1. **gitserver** maintains a persistent bare clone per repo on a shared volume (`/data/repos/{orgId}/{repoId}.git`)
> 2. `git worktree add --detach /tmp/wt-{uuid} {commitSha}` creates an instant, zero-network checkout
> 3. Multiple branches can be indexed **simultaneously** from the same bare clone (parallel worktrees)
> 4. Before running SCIP, the worker checks for a cached SCIP artifact (`scip-indexes/{orgId}/{repoId}/{sha}.scip.gz` in Supabase Storage). Cache hit = skip SCIP entirely, proceed to graph upload.
> 5. Worktree is removed after pipeline completes (`git worktree remove`)
>
> This eliminates GitHub API dependency during indexing, enables deterministic retries (same commit = same worktree), and reduces clone time from 10-60s to sub-second.

### Output

A lightweight result containing:
- Workspace path on disk
- Detected languages (with per-root language mapping for polyglot repos)
- Monorepo roots
- HEAD commit SHA

Only this small payload crosses the Temporal boundary. The actual intelligence space lives on disk.

### Verification

- `ls /data/repo-indices/{orgId}/{repoId}` contains cloned repo files
- `ScannedFile[]` count matches `git ls-files` count
- Languages detected correctly (check `detectLanguages()` output against actual file extensions)
- Pipeline step `prepare_intel_space` shows `completed` in `PipelineRun`

### Stage 1b: Wipe Repo Data (Clean Slate)

**Activity:** `wipeRepoGraphData` | **Queue:** light-llm | **Source:** `lib/temporal/activities/indexing-light.ts`

Runs immediately after Stage 1 to ensure a clean slate before writing new index data. Prevents duplicate entities from accumulating across re-index runs.

**What gets cleaned:**

| Store | What | How |
|-------|------|-----|
| **ArangoDB** | All entities + edges for this repo | `graphStore.deleteRepoData()` across all 22 doc + 8 edge collections |
| **Redis** | Entity profiles, topo levels, pipeline logs, retry/resume keys | Fixed key deletion + `invalidateByPrefix()` + `SCAN`-based pipeline log cleanup |
| **pgvector** | Entity embeddings + justification embeddings | `vectorSearch.deleteAllEmbeddings()` + `deleteJustificationEmbeddings()` |
| **Supabase Storage** | Graph snapshots + pipeline log archives | Removes `{orgId}/{repoId}.msgpack.gz` and all files under `pipeline-logs/{orgId}/{repoId}/` |
| **Filesystem** | Clone directory | `rmSync` on `/data/repo-indices/{orgId}/{repoId}` (also done in Stage 1 before clone) |

All cleanup steps are **non-fatal** — failures are logged but don't abort the pipeline. The PostgreSQL repo record is preserved (this is a re-index, not a delete).

**Note:** The full `deleteRepoData` activity (used by the delete-repo workflow) performs the same cleanup plus deleting the PostgreSQL repo record via CASCADE.

**Completion: ~97%**

---

## 5. Stage 2: SCIP Analysis

**Activity:** `runSCIP` | **Queue:** heavy-compute | **Timeout:** 30 minutes
**Source:** `lib/temporal/activities/indexing-heavy.ts`

### Input

- Workspace path from Stage 1
- Detected languages and monorepo roots

### What Is SCIP?

SCIP (Sourcegraph Code Intelligence Protocol) is a compiler-grade code analysis tool. Unlike regex or tree-sitter parsing, SCIP resolves types, follows imports across files, and builds a precise symbol table. This precision is what makes Unerr's call graph and impact analysis reliable.

### What Happens

1. **Pre-check SCIP binary availability** — `isSCIPBinaryAvailable()` verifies the CLI is installed. Missing binaries surfaced as pipeline log warnings.

2. **Run the SCIP indexer** per language via the shared decoder (`lib/indexer/scip-decoder.ts`):

   | Language | SCIP Binary | Project Marker | Maturity |
   |----------|-------------|----------------|----------|
   | **TypeScript** | `npx @sourcegraph/scip-typescript` | `tsconfig.json` / `jsconfig.json` | Mature (Sourcegraph) |
   | **Python** | `scip-python` | `pyproject.toml` / `setup.py` / `requirements.txt` | Mature (Sourcegraph) |
   | **Go** | `scip-go` | `go.mod` | Mature (Sourcegraph) |
   | **Java** | `scip-java` | `pom.xml` / `build.gradle` | Mature (Sourcegraph) |
   | **C/C++** | `scip-clang` | `compile_commands.json` | Mature (Clang 16, Sourcegraph) |
   | **C#** | `scip-dotnet` | `.sln` / `.csproj` | GA (Roslyn-based, Sourcegraph) |
   | **Rust** | `scip-rust` | `Cargo.toml` | Available (rust-analyzer wrapper) |
   | **Ruby** | `scip-ruby` | `Gemfile` | Partial (Sorbet-based, Sourcegraph) |
   | **PHP** | `scip-php` | `composer.json` | Early (nikic/php-parser, community) |

   All 10 language plugins now have SCIP wiring. If the binary is not installed on the worker, the pipeline falls back to tree-sitter transparently — the binary pre-check surfaces missing binaries as pipeline log warnings.

3. **Parse the SCIP output** (protobuf binary) into `ParsedEntity[]` and `ParsedEdge[]`:

   - **Ignore filtering** — the `isIncluded` filter (from `loadIgnoreFilter()`) is created once in `runSCIP` and threaded through `SCIPOptions` → language plugin → `parseSCIPOutput()`. This filters out dependency type definitions (e.g., `node_modules/.pnpm/@types/*/...`) that SCIP resolves but that inflate entity counts and drop coverage metrics. Without this filter, ~2,400 ghost file entities from `node_modules` type definitions can drop SCIP coverage from ~87% to 47%.

   - **External symbol allowlisting** — `resolveProjectPackageNames()` reads the language-appropriate manifest file (walking up to 10 directories from the `.scip` file) to discover the project's own package name(s). Every SCIP symbol is checked via `isExternalSymbol(symbol, projectPackageNames)`: the SCIP symbol format is `"scheme manager pkg-name pkg-version descriptor..."` and if `pkg-name` is not in the project's own set, the symbol is skipped entirely. This prevents stdlib, standard library types, and all third-party dependency symbols from becoming entities or edges — a much cleaner upstream filter than relying on downstream dedup.

     Supported manifests by language:

     | Language | Manifest | Name extraction |
     |----------|----------|-----------------|
     | TypeScript/JS | `package.json` | `"name"` field |
     | Python | `pyproject.toml` / `setup.cfg` | `[project].name` / `[metadata].name` |
     | Go | `go.mod` | `module` line |
     | Rust | `Cargo.toml` | `[package].name` |
     | Java | `pom.xml` / `build.gradle` | `<artifactId>` / `rootProject.name` |
     | PHP | `composer.json` | `"name"` field |
     | Ruby | `*.gemspec` / `Gemfile` | `.name` / dir name fallback |
     | C# | `*.csproj` | `<AssemblyName>` / `<RootNamespace>` |
     | C/C++ | `CMakeLists.txt` | `project()` name |

   - **Module/namespace entity skip** — Pass 1 explicitly skips entities where `kind === "module"` or `kind === "namespace"`. These are import references, not code definitions — they pollute entity counts, community detection, and embeddings.

   - **Empty-name guard** — `parseSCIPSymbol()` guards all five descriptor suffix cases (`().`, `()`, `#`, `.`, `/`) against empty name strings, returning `null` instead of creating ghost entities.

   - **Two-pass decoder** — Pass 1 builds per-file entity index (definitions), skipping documents whose path fails the ignore filter and external symbol check. Pass 2 classifies edges as `calls` (function/method targets) or `references` (class/variable/module targets) using containment-based lookup with binary search on entity start lines. Deduplicates edges via `edgeDedup` Set keyed on `"${refId}\0${defEntityId}"`. Pass 2 also skips ignored documents and external symbols.

   - **Diagnostic logging** — at startup: document count split (project vs external/skipped), total occurrences, project package names. At completion: entity/edge/file counts plus count of external symbol occurrences skipped.

   - Entities: functions, classes, variables — with precise `start_line`, `end_line`, `signature`
   - Edges: `calls`, `references`

4. **Fill bodies from source** via `fillBodiesFromSource()`:
   - Reads source files via encoding-aware `readFileWithEncoding()` and slices relevant lines (capped at `MAX_BODY_LINES = 3000`)
   - Extracts doc comments (JSDoc, docstrings, Go doc comments)

5. **Compute complexity metrics** via shared `computeComplexity(body, language)`:
   - **Cyclomatic complexity** — branch-point counting with comment/string stripping
   - **Cognitive complexity** — Sonar-style metric weighting nested conditions (`1 + nestingDepth` per nesting level)
   - Language-aware keyword sets for 11 languages (e.g., Go `select`, Python `elif`/`and`/`or`, Rust `match`/`loop`)
   - Both metrics stored on entities: `complexity` and `cognitive_complexity`
   - Complexity is computed in both SCIP (via `fillBodiesFromSource`) and tree-sitter (via `fillEndLinesAndBodies`) paths. The tree-sitter path receives `filePath` as an explicit parameter for language detection.
   - Source: `lib/indexer/complexity.ts`

6. **Write to ArangoDB** via `writeEntitiesToGraph()`:
   - **Bootstrap schema** — ensures all document collections, edge collections, and indexes exist (idempotent)
   - **Deterministic hashing** — SHA-256 over `(repoId, file_path, kind, name, signature)` → 16-char hex `_key`. Re-indexing produces the same keys → `UPSERT` updates in place
   - **Edge hashing** — SHA-256 over `(from_key, to_key, edge_kind)` → 16-char hex `_key`
   - **Auto-generated file entities** — for every `file_path` seen, a file entity is created. `contains` edges link files to children
   - **Bulk upsert** — `bulkUpsertEntities()` and `bulkUpsertEdges()` via `collection.import()` with `onDuplicate: "update"` in batches of 5,000
   - **Shadow versioning** — every entity/edge stamped with current `indexVersion` UUID for atomic shadow swap in Stage 4
   - **Original kind preserved** — `KIND_TO_COLLECTION` routes entities to the correct ArangoDB collection (plural names) but the entity document preserves its original `kind` value (`"method"`, `"type"`, `"struct"`, etc.) for downstream consumers

### Output

Written to ArangoDB:
- **Entity collections:** `files`, `functions`, `classes`, `interfaces`, `variables`
- **Edge collections:** `contains`, `calls`, `references`, `imports`, `extends`, `implements`

Each entity document contains: `_key` (SHA-256 hash), `org_id`, `repo_id`, `kind`, `name`, `file_path`, `start_line`, `end_line`, `signature`, `body`, `documentation`, `language`, `complexity`, `cognitive_complexity`, `index_version`, and timestamps.

### Verification

- Entity counts match expected (compare against `git ls-files | wc -l` for files)
- `calls` edges exist (not just `references`) — query `FOR e IN calls LIMIT 5 RETURN e`
- Topological sort produces multiple levels (not a flat batch)
- Complexity metrics populated — `FOR e IN functions FILTER e.cognitive_complexity != null LIMIT 5 RETURN { name: e.name, cc: e.cognitive_complexity }`

**Completion: ~98%**

**Remaining:** L-18b event/pub-sub edge detection (see [Section 22](#22-remaining-work)). SCIP binaries for C/C++ (`scip-clang`), C# (`scip-dotnet`), Rust (`scip-rust`), Ruby (`scip-ruby`), and PHP (`scip-php`) need to be installed on the heavy-compute worker Docker image.

---

## 6. Stage 3: Tree-Sitter Fallback Parsing

**Activity:** `parseRest` | **Queue:** heavy-compute | **Timeout:** 30 minutes
**Source:** `lib/temporal/activities/indexing-heavy.ts`

### Input

- Workspace path from Stage 1
- List of files NOT covered by SCIP (computed by differencing workspace files against SCIP-processed files)

### Why a Fallback Is Needed

SCIP is precise but not universal. It fails for config files, files without a `tsconfig.json`, languages without a SCIP indexer, and partial/broken source files.

### What Happens

#### Sub-task 3a: Language Plugin Parsing

1. **Identify uncovered files** — compares workspace list against SCIP-processed files.

2. **File size guard** — files exceeding 1MB are skipped; a bare file entity is created.

3. **Encoding detection** — `readFileWithEncoding()` probes first 4KB: null bytes → binary (skipped), UTF-8 BOM stripped, Latin-1 fallback.

4. **Parse with 10 language plugins** — regex-based extraction:

   | Plugin | Extracts | Special Features |
   |--------|----------|-----------------|
   | **TypeScript** | functions, arrow functions, classes, interfaces, types, enums | Context-aware brace tracking, `@Decorator()` capture, multi-line import parsing (accumulates symbols across lines until `} from '...'`), signature extraction with params+return type, same-file call detection (`detectTypeScriptCallEdges()`) |
   | **Python** | classes, functions, methods, decorators | Indentation-based end-line, docstring extraction, relative imports, multi-line param assembly |
   | **Go** | functions, receiver methods, structs, interfaces, type aliases | Brace-depth end-line, Go doc comments, import edges with stdlib filtering, pointer receiver `*` in signatures, struct member extraction (`members: string[]`) |
   | **Java** | classes, interfaces, enums, records, methods, constructors, fields | `extends`/`implements` edges, `member_of` edges, JavaDoc extraction |
   | **C** | functions, structs, enums, typedefs | `#include` edges, call edges |
   | **C++** | classes/inheritance, structs, enums, namespaces, methods | `#include` edges, `ClassName::method` detection |
   | **C#** | classes, interfaces, structs, records, enums, namespaces, methods | `using` edges, `implements`/`extends` edges |
   | **PHP** | classes, interfaces, traits, enums, namespaces, methods, functions | `use` edges, `extends`/`implements` edges |
   | **Ruby** | classes/modules, instance/class methods | `require_relative` edges, indentation-based end-line |
   | **Rust** | structs, enums, traits, impl blocks, type aliases, modules, functions | `impl` → `implements` edges, `use crate::` edges, `///` doc comments |
   | **Generic** | bare file entities for unsupported types | — |

5. **Compute complexity metrics** — same shared `computeComplexity(body, language)` from `lib/indexer/complexity.ts`. Both cyclomatic and cognitive metrics stored on entities.

6. **System boundary classification** — `boundary-classifier.ts` classifies third-party imports by category (payment, database, cache, messaging, auth, cloud, monitoring, etc.) with curated maps for npm (120+ packages), PyPI, Go modules, and Maven. External import edges carry `is_external`, `package_name`, and `boundary_category` metadata.

#### Sub-task 3b: Cross-File Call Edge Resolution

7. **Cross-file call resolution** — `resolveCrossFileCalls()` runs as post-processing after all tree-sitter parsing:
   - Resolves import edges to target entities (file entity ID → file path → callable entity lookup)
   - Handles extension-less imports and index file variants
   - Scans function/method bodies for `name(` and `new Name(` patterns matching imported symbols
   - Creates `calls` edges for resolved matches
   - Source: `lib/indexer/cross-file-calls.ts`

8. **Create containment edges** — `contains` edges from file entity to each extracted child entity.

9. **Heartbeat every 100 files** — prevents Temporal timeout on large repos.

10. **Write to ArangoDB** — same `writeEntitiesToGraph()` pipeline as Stage 2.

### Output

- Additional entities and edges written to ArangoDB (same collections as Stage 2)
- Cross-file `calls` edges from tree-sitter-parsed files
- System boundary metadata on external import edges

### Verification

- Cross-file call edges exist — `FOR e IN calls FILTER e._from LIKE "functions/%" LIMIT 5 RETURN e`
- Boundary classification present — `FOR e IN imports FILTER e.is_external == true LIMIT 5 RETURN { pkg: e.package_name, cat: e.boundary_category }`
- Complexity metrics on tree-sitter entities — `FOR e IN functions FILTER e.complexity != null AND e.repo_id == @repoId LIMIT 5 RETURN { name: e.name, cyclomatic: e.complexity, cognitive: e.cognitive_complexity }`

**Completion: ~97%**

**Remaining:** L-18b event/pub-sub edge detection (see [Section 22](#22-remaining-work))

---

## 7. Stage 4: Finalization & Shadow Swap

**Activity:** `finalizeIndexing` | **Queue:** light-llm | **Timeout:** 5 minutes
**Source:** `lib/temporal/activities/indexing-light.ts`

### Input

- `indexVersion` UUID from workflow start
- `orgId`, `repoId`

### What Happens

1. **Shadow swap** — if this is a re-index:
   - All new entities/edges were stamped with the current `indexVersion` UUID during Stages 2–3
   - `deleteStaleByIndexVersion()` removes all entities/edges NOT matching the current version — atomically clearing stale data

2. **Verify entity counts** — `verifyEntityCounts()` queries actual ArangoDB counts per collection, compares against pipeline-reported counts, logs divergence >10% as a warning.

3. **Update repo status** in PostgreSQL — sets `status: "indexing"`, `progress: 90`, verified entity counts, and `lastIndexedAt` timestamp.

### Output

- Stale entities/edges removed
- Accurate entity counts recorded in PostgreSQL
- Repo status updated

### Verification

- No entities with old `index_version` remain — `FOR e IN functions FILTER e.repo_id == @repoId AND e.index_version != @currentVersion RETURN COUNT(e)` should be 0
- PostgreSQL repo record has updated counts and timestamp

**Completion: ~95%**

---

## 8. Stage 4b: Blast Radius, PageRank & Community Pre-Computation

**Activity:** `precomputeBlastRadius` | **Queue:** light-llm | **Timeout:** 10 minutes
**Source:** `lib/temporal/activities/graph-analysis.ts`

### Input

- `orgId`, `repoId`
- All entities and edges from ArangoDB (written by Stages 2–3)

### What Happens

This stage computes four independent structural signals that feed into justification, embedding, and entity profiles.

**Pipeline Logging:** User-visible log entries emitted at each sub-task (entity/edge load, blast radius, PageRank, structural fingerprint, completion summary) via `createPipelineLogger("graph-analysis")`.

#### Sub-task 4b-1: Fan-In/Fan-Out & Risk Level

Computes fan-in (callers) and fan-out (callees) for every entity using AQL `COLLECT` queries on edge collections. Edge `collection/key` references extracted via `extractEntityId()` helper (eliminates 8+ duplications of the split-parse pattern). Assigns `risk_level`:

| Fan-in/Fan-out | Risk Level |
|----------------|------------|
| ≥ 10 | `"high"` |
| ≥ 5 | `"medium"` |
| < 5 | `"normal"` |

#### Sub-task 4b-2: Semantic PageRank

Weighted PageRank via power iteration (~120 lines, self-contained in `lib/justification/pagerank.ts`). Edge weights per kind:

| Edge Kind | Weight | Rationale |
|-----------|--------|-----------|
| `mutates_state` | 0.9 | Highest impact — side effects |
| `implements` | 0.7 | Contract fulfillment |
| `emits`/`listens_to` | 0.6 | Event coupling |
| `calls` | 0.5 | Direct invocation |
| `references` | 0.3 | Indirect usage |
| `extends` | 0.3 | Inheritance |
| `imports` | 0.1 | File-level dependency |
| `member_of` | 0.05 | Containment |
| `contains` | 0.0 | Structural only |

Convergence: ε=0.0001, max 100 iterations, damping=0.85. Both raw scores and percentile ranks stored on ALL entities.

#### Sub-task 4b-3: Community Detection

Lightweight label-propagation community detection via `detectCommunitiesLightweight()` (inline in `graph-analysis.ts`). Runs **before** justification so community membership informs LLM prompts. Each entity receives:
- `community_id` — numeric community identifier
- `community_label` — human-readable label (derived from dominant entity names in the community)

Community info includes member count and representative entity names for prompt construction.

#### Sub-task 4b-4: Structural Fingerprint (5D)

`computeStructuralFingerprints()` (`lib/justification/structural-fingerprint.ts`) computes a 5-dimensional vector per entity:

| Dimension | What It Captures | Range |
|-----------|-----------------|-------|
| `pagerank_percentile` | Centrality (from PageRank above) | 0-100 |
| `community_id` | Which functional cluster | Integer |
| `depth_from_entry` | Hops from nearest entry point (multi-source BFS) | 0-99 |
| `fan_ratio` | `fan_out / (fan_in + 1)` — >1 = orchestrator, <1 = utility | 0-∞ |
| `is_boundary` | Imports external packages | boolean |

Fingerprint tokens injected into embedding text (Stage 5): `"Centrality: high (P85) | Depth: 2 hops from entry | Role: connector | Boundary: yes | Community: 7"`

### Output

Written to entity documents via `bulkUpsertEntities()`:
- `fan_in`, `fan_out`, `risk_level`
- `pagerank_score`, `pagerank_percentile`
- `community_id`, `community_label`
- `depth_from_entry`, `fan_ratio`, `is_boundary`
- `structural_fingerprint` (composite 5D object)

### Verification

- PageRank populated — `FOR e IN functions FILTER e.pagerank_score != null AND e.repo_id == @repoId LIMIT 5 RETURN { name: e.name, pr: e.pagerank_score, pct: e.pagerank_percentile }`
- Communities assigned — `FOR e IN functions FILTER e.community_id != null LIMIT 5 RETURN { name: e.name, community: e.community_id }`
- `logger.info()` ranks lower than domain functions in PageRank
- Structural fingerprint present — `FOR e IN functions FILTER e.structural_fingerprint != null LIMIT 1 RETURN e.structural_fingerprint`

**Completion: ~95%**

---

## 9. Stage 4c: Temporal Analysis

**Activity:** `computeTemporalAnalysis` | **Queue:** heavy-compute | **Timeout:** 15 minutes
**Source:** `lib/temporal/activities/temporal-analysis.ts`

### Input

- `orgId`, `repoId`, `indexDir` (needs filesystem access for `git log`)

### What Happens

Git history mining to produce temporal signals — the "hidden knowledge layer" that captures developer behavior patterns invisible in static code analysis.

**Pipeline Logging:** User-visible log entries at each sub-task (mining, commit count, co-change, temporal context, completion) via `createPipelineLogger("temporal-analysis")`.

#### Sub-task 4c-1: Mine Commit History

`mineCommitHistory(indexDir, 365, 5000)` — runs `git log --name-only` with ASCII Unit Separator (`\x1f`) field delimiter (safe for commit subjects containing `|`). Parses into `CommitFileEntry[]` (sha, subject, authorEmail, timestamp, files).

#### Sub-task 4c-2: Compute Co-Change Edges

`computeCoChangeEdges(commits, supportThreshold=3, confidenceThreshold=0.3)`:
- Builds `fileToCommits: Map<string, Set<string>>` from commit list
- For files with ≥ 2 commits, computes pairwise co-occurrence
- If unique files > 5000, prunes to files with ≥ 3 commits
- Returns edges with `support` (co-commit count), `confidence` (support / total-A-commits), `jaccard`

#### Sub-task 4c-3: Map to Entity Edges

`mapFileEdgesToEntityEdges(coChangeEdges, entityFileMap, maxEdgesPerPair=5)`:
- Converts file-level co-change to entity-level `logically_coupled` edges
- Creates edges between top entities (by PageRank) in each co-changing file pair
- Entity IDs properly qualified with `KIND_TO_COLL` mapping (`functions/`, `classes/`, etc.) — not defaulted to `functions/`
- Edge metadata (`support`, `confidence`, `jaccard`) preserved on stored edges

**Entity limit:** `getAllEntities` called with 200k limit (default 10k was silently dropping entities on large repos). Logs a warning when limit is hit.

#### Sub-task 4c-4: Compute Temporal Context

`computeTemporalContext(commits, filePath)` per unique file:

| Field | Description |
|-------|-------------|
| `change_frequency` | Total commits touching this file |
| `recent_change_frequency` | Commits in last 90 days |
| `author_count` | Unique authors |
| `author_concentration` | Herfindahl index (0-1, 1=single author) — bus factor proxy |
| `stability_score` | 0-1, higher = less change recently |
| `commit_intents` | Classified via keyword heuristics: bugfix, feature, refactoring, testing, documentation, performance, maintenance |
| `last_changed_at` | ISO timestamp |

### Output

- `logically_coupled` edges in ArangoDB (edge collection) with support/confidence/jaccard metadata
- Temporal context fields on entity documents: `change_frequency`, `recent_change_frequency`, `author_count`, `author_concentration`, `stability_score`, `commit_intents`, `last_changed_at`

### Verification

- Logically coupled edges exist — `FOR e IN logically_coupled LIMIT 5 RETURN { from: e._from, to: e._to, support: e.support }`
- Temporal context on entities — `FOR e IN functions FILTER e.change_frequency != null AND e.repo_id == @repoId LIMIT 5 RETURN { name: e.name, freq: e.change_frequency, stability: e.stability_score, authors: e.author_count }`
- Commit intent classification working — `FOR e IN functions FILTER e.commit_intents != null LIMIT 5 RETURN { name: e.name, intents: e.commit_intents }`

**Completion: 100%**

---

## 10. Stage 5: Embedding (Two-Pass)

**Workflow:** `embedRepoWorkflow` | **Queue:** light-llm
**Source:** `lib/temporal/workflows/embed-repo.ts`, `lib/temporal/activities/embedding.ts`

### Embedding Provider

**Google Vertex AI — Gemini Embedding 001** (managed service, API key auth).

| Property | Value |
|----------|-------|
| Model | `gemini-embedding-001` (configurable via `EMBEDDING_MODEL_ID` env var) |
| Dimensions | **768** (configurable via `EMBEDDING_DIMENSIONS`, model supports up to 3072) |
| Auth | `GOOGLE_VERTEX_API_KEY` — express mode, no service account needed |
| Task types | `RETRIEVAL_DOCUMENT` (index-time), `RETRIEVAL_QUERY` (search-time) |
| Token limit | 8,192 tokens per input text |
| SDK | `@ai-sdk/google-vertex` → `vertex.textEmbeddingModel()` via Vercel AI SDK `embed()` |
| Model version tag | `gemini-emb-001-768` (stored in `model_version` column for blue/green re-embedding) |
| Config | `lib/llm/config.ts` — `EMBEDDING_MODEL_ID`, `EMBEDDING_DIMENSIONS`, `GOOGLE_VERTEX_API_KEY` |

**Previous providers (deprecated):**
- Self-hosted TEI `nomic-embed-text-v1.5` (768d, CPU-only on fly.io) — removed due to 4096 token limit, slow CPU inference, and operational overhead
- AWS Bedrock Cohere Embed v4 (1536d) — removed due to AWS Marketplace `INVALID_PAYMENT_INSTRUMENT` blocking model access

### Cross-Encoder Reranking

**AWS Bedrock — Cohere Rerank 3.5** (managed service, IAM auth).

| Property | Value |
|----------|-------|
| Model | `cohere.rerank-v3-5:0` (configurable via `RERANKER_MODEL_ID` env var) |
| SDK | `@ai-sdk/amazon-bedrock` → `bedrock.reranking()` via Vercel AI SDK `rerank()` |
| Usage | Post-RRF reranking in `hybrid-search.ts` — top 30 candidates re-scored, top `limit` returned |
| Fallback | 3s timeout; on failure, falls back to RRF order with `degraded.reranker` flag |

### Input

- `orgId`, `repoId`
- All entities from ArangoDB (Stages 2-3)
- Structural fingerprint data from Stage 4b

### What Happens

Two-pass embedding solves the ordering problem where first-time embeddings had no justification context. Pass 1 enables search immediately; Pass 2 (triggered after justification in Stage 7) enriches with business intent.

#### Pass 1: Structural Embedding (runs here, before justification)

1. **Set status** to `"embedding"` in PostgreSQL.

2. **Fetch all file paths** from ArangoDB `files` collection.

3. **Process in batches of 50 files** (`FILES_PER_BATCH = 50`), with **3 batches running concurrently** (`CONCURRENT_BATCHES = 3`):

   a. Fetch entities per file via `graphStore.getEntitiesByFile()`

   b. **Kind-aware embedding text** via `buildKindAwareText()` — switches on entity kind using `formatKindLabel()` for accurate labels:
      - **Functions/methods:** name, signature, AST-summarized body (via `summarizeBody()` from `ast-summarizer.ts`)
      - **Classes/structs:** name, method inventory, extends/implements relationships (structs correctly labeled as "Struct", not "Class")
      - **Interfaces:** name, contract signature, implementors
      - **Modules/namespaces:** export surface (re-included — no longer excluded)
      - **Structural fingerprint tokens** appended: `"Centrality: high (P85) | Depth: 2 | Role: connector | Boundary: yes | Community: 7"`

   c. **Dual embedding variants** — `buildEmbeddableDocuments()` generates two variants per entity:
      - **Semantic variant** (default): includes justification, community label, structural fingerprint tokens
      - **Code-only variant** (key suffix `::code`): omits all LLM-derived context, embedding only structural signals
      - Both variants stored separately via entity key / entity key `::code`

   d. **Body truncation** via AST summarization — `summarizeBody()` (`lib/justification/ast-summarizer.ts`) replaces naive `.slice()`. Extracts 6 anchor categories (decision points, external calls, mutations, errors, returns, assertions) verbatim; compresses non-anchor lines into structural tokens: `[IMPORTS: N lines]`, `[SETUP: N variables]`, `[LOOP: for over items]`, `[TRY_CATCH]`, `[LOG]`, `[... N lines ...]`. Body capped at 10,000 characters (Gemini supports 8,192 tokens ≈ ~32k chars).

   e. **Embed via Vertex AI** — `gemini-embedding-001` model (768 dimensions). Each text is embedded as a separate API request (`gemini-embedding-001` accepts 1 text per request on Vertex AI). Requests are parallelized with a **semaphore-based concurrency limiter** (`EMBED_CONCURRENCY = 100`) with exponential backoff on 429/RESOURCE_EXHAUSTED errors (1s → 2s → 4s → 8s → 16s, up to 5 retries). Total concurrent Vertex AI calls = `CONCURRENT_BATCHES × EMBED_CONCURRENCY` = 3 × 100 = 300 (tuned to stay under Vertex AI TPM quota while maximizing throughput).

   f. **Upsert to pgvector** in sub-batches of 100 with conflict-based deduplication.

4. **Delete orphaned embeddings** — includes both `entityId` and `entityId::code` in current key set for dual variant cleanup.

5. **Set status** to `"ready"` in PostgreSQL.

#### Throughput Architecture

```
Workflow level:  66 batches (50 files each) → 3 concurrent activities
                 ↓
Activity level:  ~100 entities per batch → 100-doc embed sub-batches
                 ↓
Adapter level:   100-concurrent semaphore → individual Vertex AI embed() calls
                 ↓
                 Total: 3 × 100 = 300 concurrent Vertex AI calls
                 Result: ~500 embeddings/sec → 2000 entities in ~4s
```

**Why 3 concurrent batches (not 10):** Each `processAndEmbedBatch` activity creates its own semaphore with `EMBED_CONCURRENCY = 100`. The activities don't share rate-limit state since they're separate Temporal invocations on the same worker. With 10 batches × 100 = 1,000 concurrent calls, mass 429 throttling cascades into exponential backoff storms — observed at 14 min for what should take ~3 min. Reducing to 3 × 100 = 300 concurrent calls stays within Vertex AI quota while each batch processes 2x more files (50 vs 25), reducing total Temporal round-trips from 131 to 66.

**Why this approach vs batch API:** Vertex AI's asynchronous Batch Prediction API does not yet support `gemini-embedding-001` (only `text-embedding-005`). When batch API support ships (announced "coming soon" with 50% cost discount), it will be worth switching for repos >10K entities. For current scale (hundreds to low thousands of entities), concurrent real-time calls with semaphore throttling achieves sub-minute embedding times.

**Rate limit resilience:** Vertex AI quotas for `gemini-embedding-001` are token-based (~5M TPM default, scalable to 20M TPM). At 300 concurrent requests averaging 500 tokens each, throughput is ~3M TPM — within default quota with headroom. The semaphore + exponential backoff pattern self-throttles if quota is reached.

#### Pass 2: Synthesis Embedding (runs after justification in Stage 7)

Triggered by `reEmbedWithJustifications` activity as Step 8b in `justify-repo` workflow. Contains everything from Pass 1 PLUS:
- `business_purpose`, `feature_tag`, `domain_concepts` from justification
- `community_label` from community detection
- Intent signals
- Pass 1 embeddings get superseded by Pass 2 via the bi-temporal `valid_to` pattern.

### Output

- **768-dimensional embedding vectors** for every code entity, stored in PostgreSQL pgvector with HNSW index
- **Dual variants**: semantic (with justification context) + code-only (structural signals only)
- Metadata: `entity_key`, `kind`, `file_path`, `repo_id`, `org_id`
- Model version: `gemini-emb-001-768` (enables zero-downtime blue/green re-embedding on model upgrades)

### Implementation Details

- **Embedding vector validation** — `Number.isFinite()` check on every vector. NaN/Infinity vectors logged and skipped.
- **Vertex AI resilience** — Each embed call retries up to 5× with exponential backoff (1s/2s/4s/8s/16s) on 429 or RESOURCE_EXHAUSTED errors. Semaphore limits in-flight requests to 100 per activity to prevent quota exhaustion.
- **Concurrent embedding** — `gemini-embedding-001` on Vertex AI accepts 1 text per request. A semaphore-based concurrency limiter (`createSemaphore(100)`) fires 100 requests in parallel per activity, achieving ~500 embeddings/sec throughput across 3 concurrent activities. No external dependency — semaphore is implemented inline (~15 lines).
- **Search fusion** — in `hybrid-search.ts`, all three legs (semantic, keyword, justification) use entity ID as `entityKey` for consistent RRF merging. Semantic search strips `::code` suffix before RRF. Both variants for same entity contribute to fused score. `SearchResult` type carries `id` field (ArangoDB `_key`) alongside `name`.
- **Adaptive RRF k-parameter** — `computeAdaptiveK()` dynamically adjusts k from inter-source Jaccard similarity of top-10 result sets. High overlap → lower k (amplify consensus). Low overlap → higher k (smooth noise). Range: `[0.5*baseK, 2.0*baseK]`.
- **Cross-encoder reranking** — Cohere Rerank 3.5 on AWS Bedrock re-scores top 30 RRF candidates via `rerank()` from AI SDK. Exact matches (score=1.0) are pinned and excluded from reranking. Falls back to RRF order on reranker failure (3s timeout).

### Verification

- Embeddings stored — `SELECT COUNT(*) FROM unerr.entity_embeddings WHERE repo_id = @repoId`
- Dual variants — `SELECT COUNT(*) FROM unerr.entity_embeddings WHERE entity_key LIKE '%::code' AND repo_id = @repoId`
- Vector dimensions correct — `SELECT vector_dims(embedding) FROM unerr.entity_embeddings LIMIT 1` = 768
- Model version — `SELECT DISTINCT model_version FROM unerr.entity_embeddings WHERE repo_id = @repoId` = `gemini-emb-001-768`
- Search works — call `hybridSearch({ query: "payment processing", orgId, repoId, mode: "hybrid", limit: 10 })`

**Completion: ~95%**

**Features that directly depend on embeddings:** 2.1 Semantic Code Search, 2.7 Search by Purpose, 2.12 Find Similar Code, 8.4 Semantic Snippet Search, 9.4 Global Code Search.

---

## 11. Stage 6: Ontology Discovery

**Workflow:** `discoverOntologyWorkflow` | **Queue:** light-llm
**Source:** `lib/temporal/workflows/discover-ontology.ts`, `lib/temporal/activities/ontology.ts`

### Input

- `orgId`, `repoId`
- All entity names from ArangoDB
- Workspace path (for manifest files)
- Optional user-provided context documents

### What Happens

**Pipeline Logging:** User-visible entries at each sub-task via `createPipelineLogger("ontology")`.

1. **Extract raw domain terms** from entity names:
   - Splits PascalCase and camelCase: `UserAuthService` → `["User", "Auth", "Service"]`
   - Frequency-ranks terms across the entire repo
   - Filters noise (common programming terms)

2. **Three-tier term classification** — `classifyTerms()` categorizes extracted terms into:

   | Tier | Examples | Detection |
   |------|----------|-----------|
   | **Domain concepts** | Invoice, Payment, Order, Patient | Default (not in architectural or framework sets) |
   | **Architectural patterns** | Handler, Controller, Service, Factory, Adapter | Curated `ARCHITECTURAL_TERMS` set |
   | **Framework terms** | Express, Prisma, Redis, React | Curated `FRAMEWORK_TERMS` set |

   Stored as `term_tiers` on `DomainOntologyDoc`.

3. **Cross-tier relationship mapping** — `buildDomainToArchitectureMap()` scans entity names for co-occurrence of domain + architectural terms. Example: `PaymentService`, `PaymentController`, `PaymentHandler` → `Payment → [PaymentService, PaymentController, PaymentHandler]`. Stored as `domain_to_architecture` on ontology doc.

4. **Read and persist project manifests** — reads `package.json`, `pyproject.toml`, `go.mod` from workspace, extracting `project_name`, `project_description`, `tech_stack`, `project_domain`. Persisted via `updateRepoManifest()` so it survives workspace cleanup.

5. **Fetch user-provided context** — if the repo has `contextDocuments`, appends to the LLM prompt to anchor vocabulary.

6. **LLM refinement** — sends raw terms + project metadata + term tiers to `LLM_MODELS.standard` with `DomainOntologySchema`. Falls back to raw terms on LLM failure. Returns:
   - **Domain terms** with definitions
   - **Ubiquitous language map** — canonical term → aliases
   - **Term relationships** (e.g., "Invoice" → belongs_to → "Billing")

7. **Store in ArangoDB** — `domain_ontologies` collection via `graphStore.upsertDomainOntology()`.

### Output

- `DomainOntologyDoc` in ArangoDB containing:
  - `domain_terms` with definitions
  - `term_tiers` (three-tier classification)
  - `domain_to_architecture` (cross-tier mapping)
  - `ubiquitous_language` map
  - `manifest_data` (project metadata)

### Verification

- Ontology stored — `FOR o IN domain_ontologies FILTER o.repo_id == @repoId RETURN o`
- Three-tier classification present — check `term_tiers` field has `domain`, `architectural`, and `framework` keys
- Cross-tier mapping — check `domain_to_architecture` links domain concepts to implementing patterns

**Completion: ~90%**

**Features that directly depend on ontology:** 5.7 Feature Blueprint, 5.9 Domain Glossary, 2.6 Business Context, 2.9 Blueprint.

---

## 12. Stage 7: Business Justification

**Workflow:** `justifyRepoWorkflow` | **Queue:** light-llm | **Timeout:** 60 minutes
**Source:** `lib/temporal/workflows/justify-repo.ts`, `lib/temporal/activities/justification.ts`

This is the heart of the pipeline — the stage that transforms a code graph into a *knowledge* graph. Every other stage either feeds into or draws from justification data.

### Input

- `orgId`, `repoId`
- All entities, edges, and pre-computed signals from Stages 2–4c:
  - Entity graph (entities + edges)
  - PageRank scores, community assignments (Stage 4b)
  - Structural fingerprints (Stage 4b)
  - Temporal context (Stage 4c)
  - Ontology terms (Stage 6)

### What Happens

#### Sub-task 7.1: Topological Sort

Sorts entities by dependency level using Kahn's algorithm with cycle-breaking. Traverses `calls` AND `references` edges (not just `calls`). Level 0 = leaves (utility functions, constants), ascending to level N = roots (entry points, API handlers).

**Why bottom-up?** When the LLM justifies `processPayment()`, it can see that `processPayment` calls `validateInvoice()` (already justified as "validates billing documents"). This cascading context makes output dramatically more accurate.

#### Sub-task 7.2: Dead Code Detection

`detectDeadCode()` — entities with zero inbound references are flagged. Returns `Map<string, string>` (entityId → reason). Exclusion patterns for:
- **Decorator-registered endpoints**: `@Get`, `@Post`, `@Injectable`, `@Controller`, etc.
- **Lifecycle hooks**: React (`componentDidMount`), Angular (`ngOnInit`), Vue (`mounted`), NestJS (`onModuleInit`), generic (`main`, `init`, `bootstrap`)
- **Event handler patterns**: `on[A-Z]*`, `handle[A-Z]*`, `*Listener`, `*Handler`, `*Callback`
- **Config/factory exports**: `*Config`, `*Factory`, `create[A-Z]*`, `use[A-Z]*`, `register[A-Z]*`

Dead code reason shown in justification prompts and health report.

#### Sub-task 7.3: Justification Loop (Per Level, Parallel Chunks of 100)

For each topological level, processing bottom-up:

**a. Staleness Check (Change-Type Aware)**

`checkStaleness(opts: StalenessCheckOptions)` (options-object API with backwards-compatible positional overload) classifies entity changes into 6 types:

| Change Type | Cascade? | Rationale |
|-------------|----------|-----------|
| `signature_changed` | Always | Contract change |
| `anchors_changed` | Always | Business logic changed (semantic anchors) |
| `body_refactor` | Cosine check (< 95%) | May or may not affect intent |
| `comments_only` | Never | Strips comments/whitespace for comparison |
| `test_assertions` | Always | Test intent changed |
| `no_change` | Never | Body hash unchanged |

30-day TTL: re-justifies entities older than 30 days regardless of body hash (captures ontology drift). Fallback justifications detected via exact flag match (`-fallback_justification`) — always re-justified. Returns `staleReasons: Map<string, string>` for observability.

**b. Graph Context Building**

`buildGraphContexts()` via `getBatchSubgraphs()` — AQL ANY traversal in batches of 50 entities, 1-5 hop depth. For each entity, fetches: callers, callees, parent, siblings, imports, centrality score.

**c. Model Routing**

`routeModel()` — 3-tier routing based on safety patterns, centrality, complexity, caller count:

| Condition | Tier | Rationale |
|-----------|------|-----------|
| > 20 callers OR safety-critical patterns OR cognitive_complexity ≥ 15 | `premium` | Hub/complex functions |
| 3-20 callers | `standard` | Normal functions |
| < 3 callers | `fast` | Leaf functions |

**d. Dynamic Batching (via LLM Port Layer)**

Batching is handled by `ILLMProvider.generateBatchObjects()`, not by business logic. The provider delegates to `lib/llm/batch-processor.ts` which:
- Packs items into groups of `LLM_MAX_ITEMS_PER_BATCH` (default: 8)
- Processes batches with `LLM_BATCH_CONCURRENCY` (default: 10) parallel workers
- Re-batches missing items in smaller groups (up to 2 rounds)
- Splits batches in half on parse failures
- Falls back to single-item calls as last resort

Token-budgeted packing for edge cases is still available via `createBatches()` in `dynamic-batcher.ts` (`LLM_BATCH_MAX_INPUT_TOKENS`, default: 5000).

**e. Signal-Aware Prompt Construction**

`buildJustificationPrompt()` constructs prompts organized around four signal families:

```
## Structural Signal
- Callers: CheckoutController.submit, RefundHandler.process
- Callees: StripeAdapter.charge, PaymentValidator.validate
- Centrality: 0.73 (top 5% — PageRank percentile)
- Community: Payment Processing cluster (23 entities)
- Complexity: cyclomatic 12, cognitive 18 (moderate)

## Intent Signal
- Tests: "should reject expired cards", "should handle partial refunds"
- Entry point: Called from POST /api/checkout
- Git history: 5 recent commits (3 bugfix, 2 feature)
- Dead code: NO (has 8 inbound callers)

## Temporal Context
- Change frequency: 47 commits total, 12 in last 90 days
- Stability: 35% (volatile — actively maintained)
- Authors: 3 (small-team ownership)
- Recent intent: bugfix, feature

## Domain Signal
- Ontology: Payment domain → PaymentService (domain), PaymentController (architecture)
- Conventions: [from pattern detection]
- User context: [from context seeding if available]

## Code
[AST-summarized body with semantic anchors preserved]
```

Body truncation varies by tier: fast=4,000 chars, standard=8,000, premium=12,000. Bodies processed through AST summarization (`summarizeBody()`) which preserves semantic anchors and compresses boilerplate.

Additional prompt inputs: callee justifications (for bottom-up context), ontology terms, heuristic hints, entity warnings from the ledger, user-provided context documents (truncated to 3,000 chars).

**f. Heuristic Bypass**

Entities with `heuristicHint.confidence >= 0.9` and 0 inbound callers skip LLM entirely. Canned justification with `model_tier: "heuristic"`. Saves 20-40% of LLM calls for pure-utility entities.

**g. LLM Call (Three-Layer Architecture)**

Business logic calls `container.llmProvider.generateBatchObjects()` per model tier, providing prompt builders and a `matchResult` function. All retry, rate-limiting, and error recovery are handled by the LLM port layer:

- **Per-call**: `RateLimiter` (RPM/TPM sliding window) + `retryWithBackoff` (exponential backoff + jitter on 429)
- **Batch-level**: `batch-processor.ts` handles concurrency, missing-item re-batching, parse-failure splitting, fatal error abort (401/403/405)
- **Business fallback**: Failed items get heuristic fallback (if confidence >= 0.85) or fallback justification (`taxonomy: UTILITY, confidence: 0.3`)

**h. Quality Scoring (Balanced)**

`scoreJustification()` — balanced scoring with 0.5 baseline:

| Signal | Direction | Weight | Examples |
|--------|-----------|--------|----------|
| Generic phrases | Penalty | -0.15 | "handles operations", "manages data" |
| Short purpose | Penalty | -0.1 | < 30 characters |
| Programming terms as concepts | Penalty | -0.08 per | "function", "class", "string" |
| Generic feature tags | Penalty | -0.05 | "utility", "misc", "other" |
| Lazy phrasing | Penalty | -0.08 | "A function that..." |
| Fallback justification | Penalty | → 0 | "classification failed" |
| Missing/short reasoning | Penalty | -0.08 | No evidence |
| Rich domain concepts (3+) | Bonus | +0.1 | Non-programming domain terms |
| Domain terminology (2+ clusters) | Bonus | +0.1 | Matches 12 vocabulary cluster regexes |
| Specific feature tag | Bonus | +0.05 | Not in generic set |
| Rich semantic triples (3+) | Bonus | +0.1 | Meaningful subject/predicate/object |
| Detailed purpose (80+ chars) | Bonus | +0.05 | Substantive description |
| Evidence-rich reasoning | Bonus | +0.1 | CamelCase refs, backticks, quantified evidence |
| Compliance awareness | Bonus | +0.05 | PCI-DSS, GDPR, etc. |
| Architectural pattern | Bonus | +0.05 | gateway, adapter, etc. |

Score clamped to [0, 1]. Flag prefixes: `+` (bonus) / `-` (penalty).

**i. Calibrated Confidence**

`computeCalibratedConfidence()` (`lib/justification/confidence.ts`) replaces LLM self-reported confidence:

| Dimension | Signals | Weight |
|-----------|---------|--------|
| Structural | Has callers? Has callees? PageRank percentile | 0-0.5 |
| Intent | Has docs? Has tests? Descriptive name? | 0-0.3 |
| LLM | Raw confidence × tier weight (premium=0.2, standard=0.15) | 0-0.2 |

Produces: `calibrated_confidence` (composite) + `confidence_breakdown: { structural, intent, llm }`. Agents distinguish "high confidence because we have tests and callers" from "high confidence because the LLM guessed 0.9."

**j. Write to ArangoDB**

`bulkUpsertJustifications()` — bi-temporal: sets `valid_to` on old justifications before inserting new ones. Each document contains: `entity_id`, `taxonomy`, `feature_tag`, `business_purpose`, `domain_concepts`, `confidence`, `calibrated_confidence`, `confidence_breakdown`, `semantic_triples`, `compliance_tags`, `reasoning`, `body_hash`, `model`, `valid_from`, `valid_to`.

#### Sub-task 7.4: Ontology Refinement (Every 20 Levels)

Concepts appearing 3+ times in justifications that aren't in the ontology are added (up to 50 new terms per refinement).

#### Sub-task 7.5: Context Propagation

`propagateContextActivity()` — bi-directional:
- Parent feature tags and domain concepts propagate to children
- Commonly-occurring child concepts propagate up to parents
- Smooths out inconsistencies where sibling functions got different feature tags

#### Sub-task 7.6: Feature Aggregation

`storeFeatureAggregations()` — groups entities by `feature_tag`:
- Per-feature: entity count, type breakdown, taxonomy distribution
- Entry point detection (high fan-in + exported symbols via BFS hot path finding)
- Stored in ArangoDB `features_agg` collection

#### Sub-task 7.7: Justification Embedding

`embedJustifications()` — embedding text per justification (entity name, kind, file, taxonomy, business_purpose, domain_concepts, feature_tag, reasoning, compliance_tags, semantic_triples, body snippet). Text capped at 1,500 chars, body snippet at 500 chars. Embeds in chunks of 20. Stored in `justification_embeddings` pgvector table.

#### Sub-task 7.8: Pass 2 Re-Embedding

`reEmbedWithJustifications` — triggers Pass 2 of the two-pass embedding. Rebuilds all embedding documents with justification context (business_purpose, feature_tag, domain_concepts, community_label) included.

#### Sub-task 7.9: Entity Profile Cache Warm

`warmEntityProfileCache` — pre-computes `EntityProfile` for every entity, combining all signals (structural, intent, temporal, domain) into a single Redis-cached object (24h TTL). Source: `lib/mcp/entity-profile.ts`. All MCP tools read from profile cache instead of 3-5 DB round-trips.

### Output

- **Justification documents** in ArangoDB `justifications` collection (bi-temporal)
- **Feature aggregations** in ArangoDB `features_agg` collection
- **Justification embeddings** in PostgreSQL `justification_embeddings` pgvector table
- **Pass 2 embeddings** in PostgreSQL `embeddings` table (superseding Pass 1)
- **Entity Profiles** in Redis cache (24h TTL)
- **Refined ontology** with new terms discovered during justification

### Verification

- Justifications stored — `FOR j IN justifications FILTER j.repo_id == @repoId AND j.valid_to == null RETURN COUNT(j)`
- Multi-level topological sort — `FOR j IN justifications COLLECT level = j.topo_level INTO g RETURN { level, count: LENGTH(g) }`
- Calibrated confidence — `FOR j IN justifications FILTER j.calibrated_confidence != null LIMIT 5 RETURN { entity: j.entity_id, composite: j.calibrated_confidence, breakdown: j.confidence_breakdown }`
- Quality scores reasonable — `FOR j IN justifications LIMIT 100 RETURN { score: j.quality_score, flags: j.quality_flags }` — most above 0.5
- Entity Profiles cached — check Redis `profile:{orgId}:{repoId}:*` keys exist
- Pass 2 embeddings — `SELECT COUNT(*) FROM embeddings WHERE repo_id = @repoId` should be higher than Pass 1 count (includes justification-enriched versions)

**Completion: ~95%**

**Remaining:** L-20 Part B hermeneutic propagation (see [Section 22](#22-remaining-work))

**Features that directly depend on justification:** 2.6 Business Context, 2.7 Search by Purpose, 2.8 Impact Analysis, 2.9 Blueprint, 2.10 Convention Guide, 2.11 Suggest Approach, 5.1 Health Report, 5.2 Prioritized Issues, 5.4 Drift, 5.7 Feature Blueprint, 5.8 ADRs, 7.1 PR Review, 7.3 Inline Comments, 7.5 Debate the Bot.

---

## 13. Stage 8: Health Report & ADR Generation

**Workflow:** `generateHealthReportWorkflow` | **Queue:** light-llm
**Source:** `lib/temporal/activities/health-report.ts`, `lib/temporal/activities/adr-generation.ts`

### Input

- `orgId`, `repoId`
- All entities, edges, and justifications from ArangoDB
- Complexity metrics (cyclomatic + cognitive) from Stages 2-3

### What Happens

#### Sub-task 8.1: Health Report

Aggregates data from graph + justifications to score the repo across 13 risk categories:

| Category | What It Measures | Data Source |
|----------|-----------------|-------------|
| `dead_code` | Functions nothing calls | `calls` edges (fan-in = 0) + dead code exclusion patterns |
| `circular_deps` | Dependency cycles | AQL cycle detection |
| `high_fan_in` | Hub functions (risky to change) | PageRank + `calls` edge count |
| `high_fan_out` | God functions (too many deps) | `calls` edge count |
| `naming_inconsistency` | Mixed naming conventions | Entity names + patterns |
| `missing_tests` | Code without test coverage | File path heuristics + `calls` edges |
| `complexity` | High cyclomatic/cognitive complexity | `complexity` and `cognitive_complexity` entity fields |
| `architecture_violation` | Cross-boundary dependencies | Taxonomy + `calls` edges |
| `api_contract` | Inconsistent API patterns | Entity signatures + patterns |
| `env_validation` | Missing env var validation | AST patterns |
| `state_lifecycle` | Missing cleanup | AST patterns |
| `idempotency` | Non-idempotent operations | Pattern detection |
| `rate_limiting` | Missing rate limits | Pattern detection |

Each category gets a 0-100 score. Overall health score is a weighted average. The LLM writes a narrative explanation with specific entity references. Null guard: when all justifications are fallback stubs, writes specific error state instead of null metrics.

#### Sub-task 8.2: ADR Synthesis

Analyzes codebase for architectural patterns with high adherence rates. Features with 3+ entities qualify, capped at 10 per run. Generates Architecture Decision Records with: decision, context, evidence (specific entity references), consequences. Guard detects 0 valid features and skips generation.

### Output

- **Health report** in ArangoDB `health_reports` collection
- **ADRs** in ArangoDB `adrs` collection
- **Entity warnings** in ArangoDB `entity_warnings` collection (up to 50 per synthesis)

### Verification

- Health report stored — `FOR h IN health_reports FILTER h.repo_id == @repoId SORT h.created_at DESC LIMIT 1 RETURN h`
- 13 risk categories present with scores 0-100
- ADRs generated — `FOR a IN adrs FILTER a.repo_id == @repoId RETURN COUNT(a)`

**Completion: ~95%**

**Features that directly depend on health/ADRs:** 5.1 Health Report, 5.2 Prioritized Issues, 5.8 Architecture Decision Records, 2.9 Blueprint.

---

## 14. Stage 9: Graph Snapshot Export

**Workflow:** `syncLocalGraphWorkflow` | **Queue:** light-llm
**Source:** `lib/temporal/workflows/sync-local-graph.ts`, `lib/temporal/activities/graph-export.ts`

**Design constraint:** The entire query→serialize→compress→upload pipeline runs inside a **single activity** (`exportAndUploadGraph`) so the large buffer (often 50-60MB raw) **never crosses Temporal's 4MB gRPC boundary**. Only lightweight metadata (path, size, checksum, counts) is returned to the workflow.

> **Note:** `graph-upload.ts` contains legacy split activities (`uploadToStorage`, `updateSnapshotStatus`, `notifyConnectedClients`) from the original multi-activity design. These are **deprecated** — `exportAndUploadGraph` subsumes all of them. The legacy activities are retained only for backward compatibility with in-flight workflows.

### Input

- `orgId`, `repoId`
- All entities, edges, rules, patterns from ArangoDB

### What Happens

1. **Query and compact** all entities + edges from ArangoDB (`queryCompactGraphInternal`):
   - Fetches file paths, then entities per file with **cross-file deduplication** via `entityKeySet` Set — prevents duplicate entities when the same entity appears in multiple file-entity queries
   - Adds file entities separately with another dedup check against the same `entityKeySet`
   - Compacts each entity to minimal fields: `key`, `kind`, `name`, `file_path`, `signature`, `language`
   - Fetches all edges in a single `getAllEdges()` call with **in-memory dedup** (`edgeSet` keyed on `"${fromKey}-${kind}-${toKey}"`), paginated at 20,000 edges per page (safety cap at 200,000)
   - Fetches active rules (max 200) and confirmed patterns (evidence capped at 5 exemplars per pattern)
   - Granular heartbeats every 50 files

2. **Serialize** via `serializeSnapshotChunked()` — processes entities in batches of 1,000, frees each chunk after serialization. Repos with >5,000 entities automatically use chunked mode. Output: msgpack binary + SHA-256 checksum (5-20x smaller than JSON). After serialization, the compacted arrays are freed (`entities.length = 0`) and GC is triggered.

3. **Stream-compress** via `streamGzip()` (`lib/utils/stream-compress.ts`) — the serialized msgpack buffer (typically ~60MB) is piped through `Readable.from(buffer).pipe(createGzip())` with async iteration. Gzip processes in 16KB internal chunks, yielding to the event loop between each chunk so embedding batches running concurrently on the same worker are never blocked. Adaptive compression level: level 1 for buffers >10MB (3-5x faster, ~5% worse ratio on binary msgpack), level 6 for smaller buffers. Typical compression ratio: ~95% (60MB → 3.2MB).

4. **Upload** compressed snapshot to Supabase Storage bucket `graph-snapshots` at path `{orgId}/{repoId}.msgpack.gz`.

5. **Record metadata** in PostgreSQL via Prisma upsert (keyed on `repoId`): `status: "available"`, `checksum`, `sizeBytes`, `entityCount`, `edgeCount`, `generatedAt`.

6. **Notify clients** via Redis key `graph-sync:{orgId}:{repoId}` (TTL 1 hour).

### Output

- Msgpack snapshot in Supabase Storage
- Metadata in PostgreSQL `GraphSnapshotMeta` table
- Redis notification for CLI clients

### Verification

- Snapshot exists in Supabase Storage — check bucket path
- Metadata recorded — query `GraphSnapshotMeta` for repo
- `entityCount` and `edgeCount` match ArangoDB actual counts

**Completion: ~98%**

**Features that directly depend on snapshots:** 3.4 Local-First Mode, all CLI-side tools that work offline.

---

## 15. Stage 10: Pattern Detection & Convention Discovery

**Workflow:** `detectPatternsWorkflow` | **Queue:** heavy-compute
**Source:** `lib/temporal/activities/anti-pattern.ts`, `lib/temporal/activities/pattern-detection.ts`, `lib/temporal/activities/pattern-mining.ts`

### Input

- `orgId`, `repoId`
- Workspace path (for ast-grep/Semgrep scanning)
- All entities, edges, community assignments, justifications from ArangoDB

### What Happens

**Pipeline Logging:** User-visible entries at each phase (scan start, pattern count, synthesis, completion) via `createPipelineLogger("pattern-detection")`.

The pattern detection system has four components:

#### Sub-task 10.1: Anti-Pattern Rule Synthesis

Triggered after a rewind action (Feature 4.3). Fetches reverted ledger entries, builds an LLM prompt, generates a rule. Stores in ArangoDB `rules` collection. After `upsertRule`, `markLedgerEntryRuleGenerated()` closes the rewind→rule tracing loop.

#### Sub-task 10.2: Structural Pattern Detection (ast-grep)

Runs structural pattern matching via the Semgrep adapter (`lib/adapters/semgrep-pattern-engine.ts`). 23 built-in detectors: N+1 queries, empty catch blocks, missing cleanup, hardcoded credentials, etc. Evidence limited to 10 matches per pattern, snippets capped at 200 chars. Both `scanPatterns` (Semgrep CLI, runs with `--no-git-ignore`) and `scanWithAstGrep` (native AST walking) post-filter results through the unified ignore system (`loadIgnoreFilter` + `ALWAYS_IGNORE`) to exclude matches in dependency directories and user-ignored paths.

#### Sub-task 10.3: LLM-Enhanced Rule Synthesis

`llmSynthesizeRules` uses `container.llmProvider.generateObject` with `LLM_MODELS.fast` to synthesize rules from detected patterns with business context (fetched from justifications). Patterns with `matchCount >= 3` qualify. Patterns batched in groups of 5. Heuristic fallback on LLM failure ensures no regression.

#### Sub-task 10.4: Semantic Pattern Mining (Community-Scoped)

`semanticPatternMining` discovers structural conventions within Louvain communities:
1. Groups entities by `community_id`
2. For communities with 5+ callable entities: builds intra-community call graph
3. Extracts call sequence motifs (paths of length 2-3)
4. Hashes motifs → finds repeated structural patterns
5. For clusters with adherence >= 60%: sends to LLM for convention naming
6. Results stored as `MinedPatternDoc` (source: `"semantic_mining"`, community_id) + `RuleDoc`

#### Sub-task 10.5: Conventions Export

`conventions-generator.ts` synthesizes patterns + rules into `TEAM_CONVENTIONS.md` or `.cursorrules` format via `GET /api/repos/{repoId}/export/conventions?format=markdown|cursorrules`. Rules categorized by enforcement level (MUST/SHOULD/MAY), patterns grouped by type with adherence %.

### Output

- **Rules** in ArangoDB `rules` collection
- **Mined patterns** in ArangoDB `mined_patterns` collection (with community_id for scoped patterns)
- **Entity warnings** in ArangoDB `entity_warnings` collection
- **Conventions export** via API route

### Verification

- Patterns detected — `FOR p IN mined_patterns FILTER p.repo_id == @repoId RETURN COUNT(p)`
- LLM-synthesized rules — `FOR r IN rules FILTER r.repo_id == @repoId AND r.source == "llm_synthesis" RETURN COUNT(r)`
- Community-scoped patterns — `FOR p IN mined_patterns FILTER p.community_id != null RETURN COUNT(p)`
- Conventions export — `GET /api/repos/{repoId}/export/conventions?format=markdown`

**Completion: ~90%**

**Features that directly depend on patterns:** 6.1 Auto-Detected Patterns, 6.2 Custom Rules, 6.5 Pattern-to-Rule Promotion, 6.6 Rule Check, 6.7 Anti-Pattern Detection, 7.1 PR Review (pattern check), 2.10 Convention Guide.

---

## 16. Incremental Indexing

**Workflow:** `incrementalIndexWorkflow` | **Queue:** heavy-compute (workflow), mixed queues for activities
**Source:** `lib/temporal/workflows/incremental-index.ts`

Triggered by GitHub push webhooks. Uses Temporal's signal-with-start pattern with a fixed workflow ID per repo (`incremental-{orgId}-{repoId}`). The incremental workflow has full pipeline logging parity with `indexRepoWorkflow` — a `wfLog` helper emits structured logs to both the Temporal worker console and Redis pipeline logs for every step, including a completion summary with duration and entity counts.

### Signal Debouncing

The workflow waits **60 seconds** for additional `pushSignal` signals before processing. Rapid-fire pushes collapse into a single indexing run.

### Steps

| Step | Queue | What Happens |
|------|-------|--------------|
| 1. `pullAndDiff` | heavy | `git pull` + `git diff` → list of changed files |
| 2. Fallback guard | — | If >200 files changed → fires `startChild(indexRepoWorkflow)` for automatic full re-index |
| 3. `reIndexBatch` | heavy | Re-parse changed files (batches of 5) with quarantine wrapping |
| 4. `applyEntityDiffs` | light | Delete entities for removed files |
| 5. `repairEdgesActivity` | light | Re-resolve edges referencing changed entities |
| 6. `updateEmbeddings` | light | Re-embed changed entities only (delta) |
| 7. `cascadeReJustify` | light | Re-justify entities whose dependencies changed (max 2 hops, max 50 entities) — uses change-type aware staleness |
| 7.5 `refreshContextDocuments` | light | Regenerates `UNERR_CONTEXT.md` and agent configs |
| 8. `proposeDriftDocumentation` | light | When semantic drift detected, generates updated classification + ADR draft |
| 9. `invalidateCaches` | light | Exhaustive Redis clearing — 7 exact-key patterns + prefix-based `invalidateByPrefix()` (covers topo levels, justify-changed, search results, prefetch contexts, rules, **entity profiles**) |
| 10. `writeIndexEvent` | light | Record event in ArangoDB `index_events` |
| 11. `finalizeIndexing` | light | Update PostgreSQL status |

### MCP Integration

- **`refresh_context` MCP tool** — agents call `refresh_context({ files: [...] })` mid-session to re-compute entity profiles for modified files without waiting for full re-index
- **`assemble_context` MCP tool** — rich context assembly via `assembleContext()` chains: vector search → graph traversal → entity profile lookup → code snippets → community context

### Verification

- Incremental runs logged — `FOR e IN index_events FILTER e.repo_id == @repoId SORT e.created_at DESC LIMIT 5 RETURN e`
- Changed entities re-justified — check `justifications` for updated `valid_from` timestamps
- Cache invalidated — Redis keys for repo should be cleared
- Entity profiles refreshed — check Redis `profile:{orgId}:{repoId}:*` for updated timestamps

**Completion: ~95%**

**Features that directly depend on incremental indexing:** Real-time graph freshness after every push, MCP tool accuracy, PR review data currency.

> **Phase 13 Evolution:** Incremental indexing is upgraded with three techniques from Phase 13:
> 1. **File-Level Dependency DAG:** Instead of re-indexing all changed files + their callers blindly, the pipeline extracts a dependency DAG from the SCIP index. Only files that *import from* the changed file are re-indexed — not the entire repo.
> 2. **Early Cutoff (Salsa Pattern):** If a changed file's exported *signature hash* is identical before and after the change (body-only edit), dependent files are skipped entirely. This eliminates 70-90% of unnecessary re-indexing for typical edits.
> 3. **Visible Uploads Algorithm:** For commits between indexed SHAs, the system uses `git diff` to adjust file paths and line numbers instead of re-indexing. Queries on un-indexed commits resolve to the nearest SCIP index artifact.
> 4. **Webhook path:** Push webhooks now trigger `git fetch` on the bare clone (not a new ephemeral clone), followed by worktree creation for the new HEAD.
>
> See [PHASE_13_IMMUTABLE_SOURCE_ARTIFACTS.md §7](./PHASE_13_IMMUTABLE_SOURCE_ARTIFACTS.md#7-incremental-re-indexing-via-file-level-dependency-dag) for full details.

---

## 16b. Repo Deletion Workflow

**Workflow:** `deleteRepoWorkflow` | **Queue:** light-llm-queue | **Timeout:** 5 minutes | **Retries:** 3
**Source:** `lib/temporal/workflows/delete-repo.ts`, `lib/temporal/activities/indexing-light.ts` (`deleteRepoData`)
**Workflow ID:** `delete-{orgId}-{repoId}`

### What Happens

Triggered via the repo settings UI or API. Delegates to the `deleteRepoData` activity which performs a complete 5-step teardown:

| Step | Store | What | How |
|------|-------|------|-----|
| 1 | **ArangoDB** | All entities + edges across 22 doc + 8 edge collections | `graphStore.deleteRepoData(orgId, repoId)` |
| 2 | **Redis** | Entity profiles, topo levels, pipeline logs, sync/retry/resume keys | Fixed key deletion + `invalidateByPrefix()` for key families + `SCAN`-based pipeline log cleanup |
| 3 | **Supabase Storage** | Graph snapshot (`{orgId}/{repoId}.msgpack.gz`) + pipeline log archives | `storage.remove()` on snapshot file + recursive listing/deletion under `pipeline-logs/{orgId}/{repoId}/` |
| 4 | **Filesystem** | Clone directory `/data/repo-indices/{orgId}/{repoId}` | `rmSync` (recursive, force) |
| 5 | **PostgreSQL** | Repo record + all dependent data | `relationalStore.deleteRepo(repoId)` — CASCADE FKs auto-remove: `pipeline_runs`, `api_keys`, `entity_embeddings`, `justification_embeddings`, `rule_embeddings`, `ledger_snapshots`, `workspaces`, `graph_snapshot_meta` |

All steps except the final PostgreSQL delete are **non-fatal** — failures are logged but don't abort the workflow. The PostgreSQL CASCADE delete is the authoritative final step.

### Distinction from `wipeRepoGraphData`

| | `wipeRepoGraphData` (re-index) | `deleteRepoData` (delete) |
|---|---|---|
| **Purpose** | Clean slate before re-index | Permanent repo removal |
| **Stores cleaned** | ArangoDB, Redis, pgvector, Storage, Filesystem | Same + PostgreSQL repo record |
| **Preserves repo record** | Yes | No (CASCADE delete) |
| **Called from** | `indexRepoWorkflow` Step 1b | `deleteRepoWorkflow` |

---

## 17. Token Limits & Batch Sizes

### Entity Extraction Limits

| Limit | Value | Where |
|-------|-------|-------|
| Max body lines per entity (extraction) | **3,000 lines** | `lib/indexer/types.ts` → `MAX_BODY_LINES` |
| Max body lines per entity (graph snapshot) | **50 lines** | `lib/use-cases/graph-compactor.ts` |
| Max body chars per entity (embedding) | **10,000 chars** (~2,500 tokens) | `lib/temporal/activities/embedding.ts` → `MAX_BODY_CHARS` |
| Embedding model token limit | **8,192 tokens** | Gemini Embedding 001 model limit |
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
| ArangoDB bulk upsert | **1,000 entities** | `arango-graph-store.ts` |
| Embedding file batches | **50 files per batch** (3 concurrent) | `embed-repo.ts` |
| Embedding pgvector upsert | **100 vectors per sub-batch** | `embedding.ts` |
| Embedding API concurrency | **100 parallel requests** per activity (semaphore) | `llamaindex-vector-search.ts` |
| Justification parallel chunks | **100 entities per chunk** | `justify-repo.ts` |
| Justification embedding chunks | **20 per chunk** | `justification.ts` |
| Ontology refinement frequency | **Every 20 levels** | `justify-repo.ts` |
| Ontology new terms per refinement | **50 max** | `justification.ts` |
| Incremental index file batch | **5 files per batch** | `incremental-index.ts` |
| Cascade max hops | **2** | `CASCADE_MAX_HOPS` env var |
| Cascade max entities | **50** | `CASCADE_MAX_ENTITIES` env var |
| Graph context subgraph batches | **50 entities** | `arango-graph-store.ts` |
| Graph context neighbor summary | **5 neighbors max** | `dynamic-batcher.ts` |
| Graph export max edges | **20,000** | `arango-graph-store.ts` |
| Graph export max rules | **200** | `graph-export.ts` |
| Pattern evidence max | **10 matches** | `pattern-detection.ts` |
| Pattern evidence snippet | **200 chars** | `pattern-detection.ts` |
| ADR max features | **10** | `adr-synthesizer.ts` |
| ADR min entities per feature | **3** | `adr-synthesizer.ts` |
| Drift alert max callers | **20** | `drift-alert.ts` |
| Temporal analysis max commits | **5,000** | `git-analyzer.ts` |
| Temporal analysis max days | **365** | `git-analyzer.ts` |
| Co-change support threshold | **3** | `git-analyzer.ts` |
| Co-change confidence threshold | **0.3** | `git-analyzer.ts` |
| Co-change max edges per file pair | **5** | `git-analyzer.ts` |

---

## 18. Data Model

### What Gets Stored Where

| Store | Collection/Table | Written By | Read By |
|-------|-----------------|------------|---------|
| **ArangoDB** | `files` | Stages 2, 3 | All code intelligence tools |
| | `functions` | Stages 2, 3, 4b, 4c | Call graph, search, impact, profiles |
| | `classes` | Stages 2, 3, 4b, 4c | Inheritance, search |
| | `interfaces` | Stages 2, 3 | Implements, search |
| | `variables` | Stages 2, 3 | Search, entity browser |
| | `contains` (edge) | Stages 2, 3 | File → entity navigation |
| | `calls` (edge) | Stages 2, 3 | Call graph, impact, dead code, topological sort |
| | `references` (edge) | Stage 2 | Cross-file references, topological sort |
| | `imports` (edge) | Stages 2, 3 | Import chain analysis |
| | `extends` (edge) | Stage 2 | Inheritance analysis |
| | `implements` (edge) | Stage 2 | Interface analysis |
| | `logically_coupled` (edge) | Stage 4c | Co-change analysis, hidden coupling |
| | `domain_ontologies` | Stage 6 | Justification prompts, glossary |
| | `justifications` | Stage 7 | Business context, search by purpose |
| | `features_agg` | Stage 7 | Feature blueprint |
| | `health_reports` | Stage 8 | Health report, issues |
| | `adrs` | Stage 8 | Architecture decisions, blueprint |
| | `mined_patterns` | Stage 10 | Auto-detected patterns |
| | `rules` | Stage 10 | Rule enforcement, conventions |
| | `index_events` | Incremental | Activity feed |
| | `drift_scores` | Stage 7 (compare) | Drift tracking |
| | `documentation_proposals` | Incremental | Drift documentation |
| | `entity_warnings` | Stage 8, 10 | Negative knowledge in prompts |
| | `token_usage_log` | Stage 7 | Billing, usage tracking |
| **PostgreSQL** | `unerr.repos` (incl. `context_documents`, `manifestData`) | Stages 4, 4b, 5, 6, 7 | Dashboard, status, context seeding |
| | `embeddings` (pgvector) | Stage 5 (Pass 1 + Pass 2) | Semantic search, find similar |
| | `justification_embeddings` (pgvector) | Stage 7 | Search by purpose |
| | `unerr.PipelineRun` | All stages | Pipeline monitor |
| | `unerr.GraphSnapshotMeta` | Stage 9 | CLI pull, snapshot status |
| **Supabase Storage** | `graph-snapshots/{org}/{repo}.msgpack` | Stage 9 | CLI pull, local-first mode |
| **Redis** | `pipeline-logs:{repoId}` | All stages | Live pipeline log streaming |
| | `graph-sync:{orgId}:{repoId}` | Stage 9 | CLI polling for new snapshots |
| | `prefetch:{repoId}:*` | Invalidated by incremental | Pre-fetch cache for MCP tools |
| | `profile:{orgId}:{repoId}:{entityKey}` | Stage 7 (profile warm) | MCP tools (entity profiles) |

### Entity Document Schema (ArangoDB)

```typescript
interface EntityDoc {
  _key: string                    // SHA-256 hash (deterministic)
  org_id: string
  repo_id: string
  kind: string                    // Original kind preserved (method, type, struct, etc.)
  name: string
  file_path: string
  start_line: number
  end_line: number
  signature?: string
  body?: string                   // Source code (max 3000 lines)
  documentation?: string          // Doc comments
  language: string
  members?: string[]              // Go struct members, class method list
  complexity?: number             // Cyclomatic complexity
  cognitive_complexity?: number   // Sonar-style cognitive complexity
  index_version: string           // UUID for shadow swap

  // Stage 4b: Structural signals
  fan_in?: number
  fan_out?: number
  risk_level?: string
  pagerank_score?: number
  pagerank_percentile?: number
  community_id?: number
  community_label?: string
  depth_from_entry?: number
  fan_ratio?: number
  is_boundary?: boolean
  structural_fingerprint?: StructuralFingerprint

  // Stage 4c: Temporal signals
  change_frequency?: number
  recent_change_frequency?: number
  author_count?: number
  author_concentration?: number
  stability_score?: number
  commit_intents?: string[]
  last_changed_at?: string

  created_at: string
  updated_at: string
}
```

---

## 19. Feature Dependency Map

Every shipped feature depends on one or more pipeline stages.

### Without Stages 1-3 (no graph), nothing works.

| Feature Category | Required Stages | Why |
|-----------------|----------------|-----|
| **2.1 Semantic Search** | 1-3, 5 | Entity embeddings in pgvector |
| **2.2 Function/Class Lookup** | 1-3 | Direct entity fetch from ArangoDB |
| **2.3 Call Graph Traversal** | 1-2 | AQL traversal on `calls` edges |
| **2.4 Import Chain Analysis** | 1-2 | AQL traversal on `imports` edges |
| **2.5 Project Stats** | 1-3 | Aggregate counts |
| **2.6 Business Context** | 1-3, 6, 7 | Justification + entity profile |
| **2.7 Search by Purpose** | 1-3, 6, 7 | Cosine search on justification embeddings |
| **2.8 Impact Analysis** | 1-2, 4b, 7 | PageRank + graph traversal + justification |
| **2.9 Blueprint** | 1-3, 6, 7, 8 | Aggregates features, health, ADRs |
| **2.10 Convention Guide** | 1-3, 10 | Rules + detected patterns |
| **2.11 Suggest Approach** | 1-3, 5, 7, 10 | Search + rules + justifications |
| **2.12 Find Similar Code** | 1-3, 5 | Cosine similarity (dual variant fusion) |
| **3.1-3.3 Live Coding** | 1-3 | Overlay on committed graph |
| **3.4 Local-First Mode** | 1-3, 9 | Downloads msgpack snapshot |
| **4.1-4.6 Prompt Ledger** | 1-3 | Ledger entries reference entities |
| **5.1 Health Report** | 1-3, 7, 8 | LLM analysis of graph + justifications |
| **5.2 Prioritized Issues** | 1-3, 7, 8 | Extracted from health report |
| **5.3 Dead Code Detection** | 1-2, 7 | Fan-in = 0 with exclusion patterns |
| **5.4 Architectural Drift** | 1-3, 7 | Justification embedding comparison |
| **5.5 Circular Dependencies** | 1-2 | Cycle detection on `calls` edges |
| **5.6 Fan-In/Fan-Out** | 1-2, 4b | PageRank + degree centrality |
| **5.7 Feature Blueprint** | 1-3, 6, 7 | Feature aggregations from justifications |
| **5.8 ADRs** | 1-3, 7, 8 | LLM-generated from patterns + justifications |
| **5.9 Domain Glossary** | 1-3, 6 | Three-tier ontology |
| **6.1-6.7 Rules & Patterns** | 1-3, 10 | ast-grep + LLM synthesis + semantic mining |
| **7.1-7.5 PR Review** | 1-3, 7, 10 | Impact + pattern checks + justification |
| **8.1-8.4 Snippets** | 1-3, 5 | Entity extraction + semantic search |
| **9.1 Entity Graph Viz** | 1-3 | React Flow renders graph |
| **9.2 Pipeline Monitor** | All | SSE streams from PostgreSQL + Redis |
| **9.3 Activity Feed** | Incremental | `index_events` collection |
| **9.4 Global Search** | 1-3, 5 | Cross-repo pgvector search |
| **9.5 Entity Browser** | 1-3, 7 | Entities + justifications + profiles |

### The Critical Chain

```
Stages 1-3 (Graph)   ──→  Everything
Stage 4b (PageRank)   ──→  Meaningful centrality, communities, fingerprints
Stage 4c (Temporal)   ──→  Hidden coupling, developer behavior patterns
Stage 5 (Embedding)   ──→  All search features
Stage 6 (Ontology)    ──→  Three-tier domain classification
Stage 7 (Justify)     ──→  Business intelligence features + Entity Profiles
Stage 8 (Health)      ──→  Quality analysis features
Stage 9 (Snapshot)    ──→  Local-first / offline features
Stage 10 (Patterns)   ──→  Rules & enforcement features
```

---

## 20. Design Principles

### 20.1 Signal Convergence, Not Linear Pipeline

The algorithm is not a linear pipeline (parse → embed → ontology → justify). It computes four independent signal families that converge into a unified Entity Profile:

- **Structural signal** — graph position, PageRank, communities, structural fingerprint (Stage 4b)
- **Intent signal** — tests, docs, commits, entry points, naming (Stages 2-3, 7)
- **Temporal signal** — co-change, author concentration, stability, commit intents (Stage 4c)
- **Domain signal** — ontology terms, conventions, rules (Stages 6, 10)

Each signal is independent. Each has its own confidence dimension. The LLM synthesizes them. The embedding captures the synthesis.

### 20.2 The Entity Profile Is the Product

What makes Unerr different is the comprehensive, pre-computed profile per entity that no other tool produces — combining structural position, business intent, temporal behavior, and calibrated confidence into a single artifact that agents reason about. The profile is cached in Redis and served via MCP tools.

### 20.3 Confidence Is Calibrated, Not Self-Reported

An LLM saying "confidence: 0.95" is meaningless without calibration. Real confidence is computed from observable signals (has tests? has callers? descriptive name?), with per-dimension breakdown (`{ structural: 0.9, intent: 0.35, llm: 0.15 }`) so agents know WHICH aspects they can trust.

### 20.4 Heavy Data Stays in the Store

Temporal has a 2MB payload limit per activity result. The pipeline never passes entity bodies, source code, or embeddings through Temporal. Activities read from and write to ArangoDB/PostgreSQL directly. Only counts, IDs, and small metadata cross the Temporal boundary.

### 20.5 Deterministic Hashing for Idempotent Upserts

Every entity and edge key is a SHA-256 hash of its identity fields. Re-indexing the same code produces the same keys. `UPSERT` operations update in-place. Cross-referencing between stages works by key.

### 20.6 Staleness Detection Avoids Redundant LLM Calls

Change-type aware staleness: signature changes always cascade, comment edits never cascade, body refactors check cosine similarity. 30-day TTL catches ontology drift. On a typical incremental push affecting 10 files in a 5,000-entity repo, this saves 95%+ of LLM calls.

### 20.7 Shadow Re-Indexing for Zero Downtime

During re-indexing, new entities are written with a fresh `indexVersion` UUID. The old graph remains fully queryable. Only after all new entities are written does finalization remove old-version entities.

### 20.8 Bottom-Up Justification for Contextual Accuracy

Topological sort ensures callees are justified before callers. Each entity's prompt includes callee justifications as context. This cascading context propagation is what makes justifications dramatically more accurate than flat analysis.

### 20.9 Separation of Compute and Network

Heavy-compute activities (git clone, SCIP, Semgrep, temporal analysis) run on `heavy-compute-queue`. Network-bound activities (LLM calls, embedding, storage uploads) run on `light-llm-queue`.

### 20.10 Pipeline Observability at Every Stage

Every activity emits two levels of logging:
- **System logs** — structured JSON via `logger.child()` for operational monitoring (entity counts, durations, error details)
- **Pipeline logs** — user-visible entries via `createPipelineLogger()` (phase, step label, human message) written to Redis and displayed in the Pipeline Monitor UI via SSE

All 12 stages emit pipeline logs. Phase types: `indexing`, `embedding`, `ontology`, `justifying`, `graph-sync`, `graph-analysis`, `temporal-analysis`, `pattern-detection`. Each heartbeat-aware activity sends progress updates that appear in real-time.

**Workflow-level observability:**
- **Duration tracking** — both `indexRepoWorkflow` and `incrementalIndexWorkflow` track per-step wall-clock durations in a `stepDurations` record, formatted as human-readable strings (`12.4s`, `2m 34s`) in completion logs.
- **Signal quality score** — the full index workflow computes and emits the SCIP vs tree-sitter coverage percentage, giving immediate visibility into index fidelity.
- **Error path telemetry** — both workflows log elapsed time on failure (`Indexing workflow failed after 1m 12s`), enabling SLA tracking.
- **Consistent log format** — all workflows use the `[timestamp] [LEVEL] [wf:name] [orgId/repoId] message {extra}` format, with structured metadata available in the Redis pipeline log entries.

**Error handling discipline:**
- Every activity has a top-level try/catch that logs to both system logger and pipeline logger before rethrowing — ensuring failures are visible in both operational monitoring and the user-facing Pipeline Monitor.
- Non-fatal catch blocks (e.g., context refresh, workspace cleanup, LLM synthesis fallback) log the error message instead of swallowing silently.
- Child workflow launches handle "already started" / "already exists" errors gracefully with WARN-level logging.

### 20.11 Graceful Degradation

Every stage has fallback behavior:
- SCIP fails → tree-sitter fallback covers the files
- Tree-sitter fails → file entity still created
- LLM fails → fallback justification with `taxonomy: UTILITY, confidence: 0.3`
- Entity extraction times out → quarantined, doesn't fail the batch
- >200 files changed in incremental → automatically fires full re-index
- Ontology LLM fails → raw extracted terms used as-is
- Profile cache miss → falls back to direct DB queries

No single file or entity failure can prevent the pipeline from completing.

### 20.12 Unified Ignore System

All file filtering throughout the entire pipeline is centralized in **`lib/indexer/ignore.ts`** — a single source of truth.

**Three layers, one filter function:**

| Layer | Source | Purpose |
|-------|--------|---------|
| `ALWAYS_IGNORE` (Set) | Hardcoded in `ignore.ts` | 30+ directories for all 10 supported language ecosystems (Node, Python, Go, Rust, Java, C#, Ruby, PHP, C/C++) |
| `.gitignore` | Repository root | Standard gitignore patterns |
| `.unerrignore` | Repository root | User-defined exclusions (test fixtures, generated code, docs) using gitignore syntax |

**Two consumption patterns:**

1. **`loadIgnoreFilter(indexDir)`** — returns a cached `(relativePath: string) => boolean` predicate for file-level filtering. Used by `scanIndexDir`, `parseSCIPOutput`, `scanPatterns`, `scanWithAstGrep`.
2. **`ALWAYS_IGNORE.has(entry.name)`** — O(1) directory name check for fast skipping in recursive directory walkers. Used by `monorepo.ts`, `semgrep-pattern-engine.ts`, `rule-simulation.ts`, `diff-filter.ts`.

**Design rationale:**
- **Cache per indexDir** — scanner, SCIP decoder, and Semgrep all hit the same repo root; avoid re-reading `.gitignore`/`.unerrignore` files.
- **Lazy `require("ignore")`** — per the project's lazy initialization rules, no top-level import of the `ignore` npm package.
- **`.unerrignore` loaded after `.gitignore`** — patterns stack, so `.unerrignore` can override `.gitignore` with negation (`!important-file.log`).
- **`ALWAYS_IGNORE_GLOBS`** — separated from the Set for patterns requiring glob matching (e.g., `*.egg-info/`) that can't be matched via `Set.has()`.
- **`clearIgnoreCache()`** — exported for test isolation.

**CLI mirror:** `packages/cli/src/ignore.ts` provides `createIgnoreFilter(cwd)` with the same `ALWAYS_IGNORE` list plus `.unerr` (CLI-specific). The CLI is explicitly documented to keep its list in sync with the server.

**Consumers (exhaustive):**

| File | What it uses | Context |
|------|-------------|---------|
| `lib/indexer/scanner.ts` | `loadIgnoreFilter` | File discovery for all indexing |
| `lib/indexer/scip-decoder.ts` | `isIncluded` param + `ALWAYS_IGNORE` fallback | SCIP protobuf document filtering |
| `lib/indexer/monorepo.ts` | `ALWAYS_IGNORE` | Language detection per workspace root |
| `lib/temporal/activities/indexing-heavy.ts` | `loadIgnoreFilter` | Creates filter, passes to all SCIP plugins |
| `lib/adapters/scip-code-intelligence.ts` | `loadIgnoreFilter` | Port adapter for code intelligence |
| `lib/adapters/semgrep-pattern-engine.ts` | `ALWAYS_IGNORE` + `loadIgnoreFilter` | Two-tier: fast dir skip + full file filter |
| `lib/temporal/activities/rule-simulation.ts` | `ALWAYS_IGNORE` | Blast radius file counting |
| `lib/mcp/tools/diff-filter.ts` | `ALWAYS_IGNORE` | PR diff hunk stripping |
| `packages/cli/src/commands/push.ts` | `createIgnoreFilter` | Zip archive creation |
| `packages/cli/src/commands/watch.ts` | `createIgnoreFilter` | Chokidar file watcher |
| `packages/cli/src/commands/setup.ts` | `createIgnoreFilter` | Onboarding zip upload |

### 20.13 RepoId Namespace Isolation

Every data artifact in the system is scoped to a `repoId`, ensuring zero cross-repo data leakage:

| Store | Isolation mechanism |
|-------|-------------------|
| **ArangoDB** | `repo_id` field on every entity and edge document; all queries filter by `repo_id`; `deleteRepoData` sweeps all 30 collections |
| **Entity hashing** | `entityHash(repoId, file_path, kind, name, signature)` — `repoId` is part of the SHA-256 input, so identical code in two repos produces different entity keys |
| **Redis** | All cache keys namespaced: `profile:{orgId}:{repoId}:*`, `topo:{orgId}:{repoId}:*`, `graph-sync:{orgId}:{repoId}`, etc. |
| **pgvector** | `repo_id` column on `entity_embeddings` and `justification_embeddings`; `deleteAllEmbeddings(repoId)` and `deleteOrphaned(repoId)` filter by it |
| **Supabase Storage** | Path-based isolation: `{orgId}/{repoId}.msgpack.gz` for snapshots, `{orgId}/{repoId}/` prefix for pipeline logs |
| **Filesystem** | Clone directory: `/data/repo-indices/{orgId}/{repoId}` |
| **PostgreSQL** | `repo_id` FK on `pipeline_runs`, `api_keys`, `entity_embeddings`, `workspaces`, `graph_snapshot_meta`, etc. — CASCADE delete ensures no orphans |

The `wipeRepoGraphData` activity (pre-reindex) and `deleteRepoData` activity (repo deletion) both traverse all stores using this namespace pattern, ensuring complete cleanup.

---

## 21. Overall Pipeline Status

| Stage | Name | Completion | Key Capabilities |
|-------|------|-----------|------------------|
| 1 | Prepare Repo Intelligence Space | **~97%** | Clone, scan, language detection, polyglot monorepo support |
| 2 | SCIP Analysis | **~98%** | Two-pass decoder, calls+references edges, complexity metrics, SCIP wiring for all 10 languages |
| 3 | Tree-Sitter Fallback | **~97%** | 10 language plugins, cross-file call resolution, boundary classification |
| 4 | Finalization & Shadow Swap | **~95%** | Shadow swap, entity count verification |
| 4b | Blast Radius, PageRank & Communities | **~95%** | Semantic PageRank, Louvain communities, 5D structural fingerprint, calibrated confidence |
| 4c | Temporal Analysis | **100%** | Git co-change mining, temporal context per entity, logically_coupled edges |
| 5 | Embedding (Two-Pass) | **~95%** | Kind-aware strategies, dual variants, AST summarization, structural fingerprint tokens, adaptive RRF |
| 6 | Ontology Discovery | **~90%** | Three-tier classification, cross-tier mapping, manifest persistence |
| 7 | Business Justification | **~95%** | Signal-aware prompts, calibrated confidence, quality scoring, community labels, entity profiles |
| 8 | Health Report & ADRs | **~95%** | 13 risk categories, ADR synthesis, entity warnings |
| 9 | Graph Snapshot Export | **~98%** | Chunked serialization, msgpack compression |
| 10 | Pattern Detection | **~90%** | LLM rule synthesis, semantic pattern mining, community-scoped conventions |
| — | Incremental Indexing | **~95%** | Change-type staleness, drift documentation, context refresh, profile invalidation |

**Weighted overall completion: ~95%**

> **Assessment:** All hardening (Categories A-K, 48 tasks across Waves 0-8) is complete. The pipeline is production-reliable. Of the original 27 Category L algorithmic depth items, 22 core tasks across 8 Alpha waves + Backlog are complete. 5 tasks were removed/absorbed (L-05 already done, L-10/L-12 superseded, L-26 over-engineered, L-01 absorbed into L-18). The pipeline has been transformed from a "syntax reader" into an **intent-aware intelligence engine** built on **signal convergence** — structural, intent, temporal, and domain signals computed independently and converging into a pre-computed **Entity Profile** per entity. Only 2 sub-items remain: L-18b (event/pub-sub edges) and L-20 Part B (hermeneutic propagation with signal weighting).

### Completed Capabilities Summary

**Hardening (17 tasks):** Workspace cleanup, shallow clone, file size guards, encoding detection, SCIP binary surfacing, brace-depth fix, shadow swap cleanup, entity count verification, NaN embedding filter, ONNX resilience + session rotation, cascade subgraph optimization, quarantine healing, cache invalidation, graph export heartbeats + chunked serialization, batch edge fetching, bulk import optimization.

**Correctness (13 tasks):** Python/Go/Java SCIP decoders, Python/Go import edges, 6 new language plugins (C/C++/C#/PHP/Ruby/Rust), shadow swap stamping, orphan embedding cleanup, incremental fallback auto-reindex, edge repair, entity count formulas, `last_indexed_at`, LLM 405 detection, health report guards, snapshot recovery.

**Intelligence (11 tasks):** Context seeding, git history ingestion, decorator extraction, signature extraction, cross-level propagation, heuristic bypass, boundary classifier, negative knowledge indexing, manifest persistence, conventions generator, drift documentation trigger.

**Delivery (7 tasks):** `file_context` MCP tool, unified knowledge doc, incremental context refresh, agent memory sync, per-stage observability, `UNERR_CONTEXT.md` export, confidence heatmap + human override.

**Algorithmic Depth (22 tasks across 8 Alpha waves + Backlog):**

| Wave | Tasks | Status | What It Added |
|------|-------|--------|---------------|
| Alpha-1 | L-18a, L-02 | Done | Call graph foundation — SCIP refs→calls, cross-file tree-sitter calls, topological sort works |
| Alpha-2 | L-19, L-23 | Done | Semantic PageRank, calibrated confidence model, AST summarization with semantic anchors |
| Alpha-3 | L-20 Part A, L-21, L-16 | Done | Signal-aware prompts, community detection pre-justification, test assertion intent extraction |
| Alpha-4 | L-07, L-25 | Done | Two-pass kind-aware embedding, three-tier ontology classification |
| Alpha-5 | L-22, L-17 | Done | 5D structural fingerprint, dead code exclusion patterns (decorators, lifecycle, events, config) |
| Alpha-6 | L-24, L-13 | Done | Git co-change mining, temporal context per entity, LLM rule synthesis, semantic pattern mining |
| Alpha-7 | L-14, L-09, L-27 | Done | Entity Profile cache, semantic staleness (change-type aware), rich context assembly MCP tool |
| Alpha-8 | L-03, L-04, L-08 | Done | Kind preservation (verified), multi-line imports + Go members, dual embedding variants |
| Backlog | L-06, L-11, L-15 | Done | Shared complexity module (11 languages), balanced quality scoring, adaptive RRF k-parameter |

---

## 22. Remaining Work

Only **2 sub-items** remain from the original algorithmic depth roadmap:

### L-18b: Event/Plugin Edge Detection

**Priority: P2** — Adds depth for event-driven codebases, does not block other features.

**What:**
- Add `emits`, `listens_to`, `mutates_state` to `EdgeKind` type
- In TypeScript tree-sitter: detect `.emit(`, `.on(`, `.addEventListener(` patterns → create `emits`/`listens_to` edges
- Wire the captured `implements` regex group (currently extracted but ignored) to create `implements` edges
- In Go tree-sitter: detect interface satisfaction patterns → `implements` edges
- State mutation detection: `.save()`, `.update()`, `.delete()` on model objects → `mutates_state` edges
- Manifest/config scanning: parse `serverless.yml`, CDK constructs, `docker-compose.yml` for infrastructure-level event connections
- Update topological sort to traverse ALL edge kinds with configurable weights

**Source files to modify:** `lib/indexer/types.ts`, `lib/indexer/languages/typescript/tree-sitter.ts`, `lib/indexer/languages/go/tree-sitter.ts`, `lib/adapters/arango-graph-store.ts`, `lib/justification/topological-sort.ts`

**Done when:** Event-driven architectures show connected components in the graph. `implements` edges connect classes to interfaces. Infrastructure event connections visible.

---

### L-20 Part B: Hermeneutic Propagation with Signal Weighting

**Priority: P2** — Improves justification accuracy for utility functions.

**What:**
Current `propagateContextActivity` uses frequency-based aggregation (dominant child tag by count). A utility function used by both Auth and Billing gets the tag of whichever calls it more.

The fix: once entry points are reached, push their intent context BACK DOWN to all descendants, weighted by graph distance:
- Closer callers = stronger inheritance
- Utility function gets TWO intent annotations: "validates credentials for authentication flow" AND "validates invoice data for billing flow"
- Signal disagreements explicitly resolved in the `synthesized` intent field

**Source files to modify:** `lib/justification/context-propagator.ts`, `lib/justification/prompt-builder.ts`, `lib/temporal/activities/justification.ts`

**Done when:** A utility validation function called by both Auth and Billing has TWO intent annotations. Propagation is weighted by graph distance, not frequency.

---

## 23. Validation History

> Compact log of real-world validation runs.

### Run 1: 2026-02-27 (kap10-server, Lightning AI)

**Config:** `LLM_PROVIDER=ollama`, `LLM_BASE_URL=https://lightning.ai/api/v1`, `LLM_MODEL=lightning-ai/gpt-oss-20b`
**Result:** Graph stage fully correct (697 files, 1,786 functions, 591 call edges, 1,267 import edges). All LLM-dependent stages failed silently — Lightning AI endpoint returned HTTP 405.
**Bugs found:** 6 — TBI-G-01 through G-04, TBI-B-01, TBI-D-02.
**Fixes shipped:** 2026-02-28. All 6 resolved. LLM provider switched to `LLM_PROVIDER=openai`.

### Wave 5 Implementation: 2026-03-01

**Tasks completed:** 6 of 6 — TBI-K-04 (SCIP decoder robustness), TBI-K-12 (ONNX session lifecycle), TBI-C-01 (decorator extraction), TBI-C-02 (cross-level propagation), TBI-I-02 (git history), TBI-J-01 (MCP file_context).

### Wave 6 Implementation: 2026-03-01

**Tasks completed:** 5 of 5 — TBI-I-03 (system boundaries), TBI-I-05 (team conventions), TBI-J-02 (unified knowledge doc), TBI-A-04 (6 new language plugins), TBI-C-03 (workspace manifests).

### Wave 7 Implementation: 2026-03-01

**Tasks completed:** 7 of 7 — TBI-D-03 (rewind→rule tracing), TBI-C-05 (heuristic bypass), TBI-C-04 (signature extraction), TBI-A-05 (polyglot monorepo), TBI-I-04 (drift documentation), TBI-J-03 (incremental context refresh), TBI-K-14 (chunked msgpack).

### Alpha Waves: 2026-03-01 through 2026-03-02

All 8 Alpha waves + Backlog completed:
- **Alpha-1:** Call graph foundation (L-18a + L-02) — SCIP refs→calls, cross-file tree-sitter calls
- **Alpha-2:** Relevance & confidence (L-19 + L-23) — PageRank, calibrated confidence, AST summarization
- **Alpha-3:** Intent & communities (L-20 Part A + L-21 + L-16) — signal-aware prompts, community pre-justification, test intent
- **Alpha-4:** Embedding & ontology (L-07 + L-25) — two-pass embedding, three-tier ontology
- **Alpha-5:** Structural search & liveness (L-22 + L-17) — structural fingerprint, dead code exclusions
- **Alpha-6:** Temporal patterns & rules (L-24 + L-13) — git co-change mining, LLM rule synthesis, semantic mining
- **Alpha-7:** Entity profiles & freshness (L-14 + L-09 + L-27) — profile cache, semantic staleness, context assembly
- **Alpha-8:** Parser fidelity (L-03 + L-04 + L-08) — kind preservation, multi-line imports, dual embeddings
- **Backlog:** Polish (L-06 + L-11 + L-15) — shared complexity, balanced quality scoring, adaptive RRF

### Signal Chain Hardening: 2026-03-02

Full audit of all 4 signal families (structural, intent, temporal, domain) across 20+ files. Three priority tiers addressed:

**P0 — Critical bug fixes (6):**
- Hybrid search RRF fusion broken — keyword leg used `r.name` as entityKey, semantic legs used entity IDs. Added `id` to `SearchResult`, all legs now merge by entity ID.
- Git log pipe delimiter corruption — commit subjects with `|` silently truncated. Changed to ASCII Unit Separator (`\x1f`).
- Temporal analysis bare entity keys — `qualifyVertexHandle` defaulted all entities to `functions/`. Built `KIND_TO_COLL` mapping for proper `collection/key` format.
- Temporal analysis 10k entity limit — `getAllEntities` silently dropped entities on large repos. Raised to 200k with warning.
- Co-change edge metadata discarded — support/confidence/jaccard now preserved on stored edges.
- Staleness fallback flag mismatch — `Array.includes("fallback_justification")` never matched stored flag `"-fallback_justification"`. Fixed to exact match.

**P1 — Pipeline logging (4 activities):**
- Added `createPipelineLogger` to `graph-analysis.ts`, `temporal-analysis.ts`, `ontology.ts`, `pattern-detection.ts`
- Added `"graph-analysis"` and `"temporal-analysis"` to pipeline log phase union type
- All 12 stages now emit user-visible pipeline logs

**P2 — Signal quality polish (5):**
- AST summarizer `otherCount` double-count corrected
- Embedding `buildKindAwareText` struct mislabel fixed (was hardcoded "Class")
- `extractEntityId` helper eliminates 8 duplications in `graph-analysis.ts`
- `checkStaleness` refactored from 7-parameter function to `StalenessCheckOptions` interface (backwards-compatible overload)
- `jaccardSimilarity` unnecessary `Array.from()` eliminated

**Test results:** 221 signal chain tests pass, 0 regressions, 0 new TypeScript errors.

### Signal Chain Hardening Round 2: 2026-03-02

Second comprehensive audit of all 4 signal families. Brought grades from B/B+ to A-tier.

**HIGH — Graph analysis correctness (2):**
- Early return in `graph-analysis.ts` skipped PageRank + structural fingerprint for repos with no callable entities (e.g., CSS-only, config-only repos). Restructured flow: blast radius is conditional on callable entities, but PageRank/fingerprint/community detection always runs for ALL entities.
- No error handling around DB calls — `getAllEntities`/`getAllEdges`/`bulkUpsertEntities` failures crashed activity silently. Added try/catch with system + pipeline logging.

**MEDIUM — Performance & correctness (4):**
- `computeTemporalContext` O(N*M) scanning — iterating all commits per file. Added `buildFileCommitIndex()` for O(1) lookup per file.
- RRF exact-match boost overwrote accumulated score with `1.0`, potentially lowering highly-ranked entities. Changed to `Math.max(score, 1.0)`.
- Justification leg returned taxonomy as `entityType` — misleading for graph enrichment. Changed to `"unknown"` with RRF metadata merge preferring non-unknown types from keyword/semantic legs.
- Fragile LLM `patternId` matching in rule synthesis — prompt asked LLM to return pattern title, but LLM variations caused mismatches. Changed to numeric `patternIndex` for deterministic matching.

**MEDIUM — Dead code & structure (2):**
- `computeStructuralFingerprints()` was dead code (duplicate of graph-analysis inline logic). Removed along with duplicate BFS function. Kept `buildFingerprintFromEntity` and `fingerprintToTokens` (used by embedding + prompt).
- Merged dual adjacency-building loops in graph-analysis into a single pass.

**Test results:** 219 signal chain tests pass (6 fewer from removed dead code tests), 0 regressions, 0 new TypeScript errors.

### Signal Chain Hardening Round 3: 2026-03-02

Third comprehensive audit — 4 parallel deep-dive reviews across all signal families. Focused on production correctness, edge-case resilience, and enterprise-grade logging. Brought overall grade from B+ to A.

**HIGH — Correctness bugs (7):**
- `pagerank.ts`: N=1 entity caused `0/0 = NaN` percentile. Added single-entity guard before the percentile loop.
- `justification.ts`: `justifyBatch()` referenced undeclared `log` variable. Added `const log = logger.child(...)` at function entry.
- `justification.ts`: `consecutiveFatalErrors += batch.entities.length` inflated error count, causing premature circuit-break after a single batch failure. Changed to `+= 1`.
- `context-assembly.ts`: Vector search returns `entityId::code` variant IDs that don't match graph store keys. Added `CODE_VARIANT_SUFFIX` stripping before graph lookup.
- `incremental.ts`: `updateEmbeddings` had no NaN/Infinity guard — corrupt vectors could poison pgvector. Added validation + sub-batching (batch size 50) matching the full pipeline.
- `ontology.ts`: Static `import { getContainer }` violated lazy-init rule (connects to DI at module load in Temporal worker sandbox). Changed to `lazyContainer()` helper with `require()` inside function body. Also lazified `DomainOntologySchema` require.
- `git-analyzer.ts`: Record separator `"SEP"` could collide with commit subjects. Changed to `"\x1e"` (ASCII Record Separator) + `"\x1f"` (Field Separator) for robust parsing.

**HIGH — Silent failures (2):**
- `pattern-detection.ts`: `astGrepScan` catch block swallowed errors silently. Added `logger.warn` with pattern ID, language, and error message.
- `pattern-detection.ts`: LLM-hallucinated `patternIndex` fell back to `batch[0]` (wrong pattern). Changed to `continue` to skip unmatched indices.

**MEDIUM — Performance (2):**
- `justification.ts`: 4 sequential ArangoDB fetches (entities, edges, ontology, previous justifications). Parallelized with `Promise.all` — ~4x faster setup phase.
- `pattern-detection.ts`: O(N) `.find()` in semantic mining entity lookup. Added `entityById` Map for O(1) access.

**MEDIUM — Correctness & consistency (6):**
- `structural-fingerprint.ts`: Exported `DISCONNECTED_DEPTH = 99` constant; `graph-analysis.ts` now imports it instead of using magic number.
- `prompt-builder.ts`: `import { summarizeBody }` was at file bottom (line 812) — moved to top with other imports for readability.
- `ontology.ts`: Angular framework detection mapped `angular` → `"Angular"` but package name is `@angular/core`. Fixed key in `knownFrameworks` map.
- `pattern-detection.ts`: `require("node:crypto")` called inside `storePatterns` loop body. Hoisted to single call before loop.
- `pattern-detection.ts`: Adherence ratio could exceed 1.0 when entity counted in multiple motifs. Clamped with `Math.min(count / total, 1.0)`.
- `git-analyzer.ts`: All test data updated from `SEP` prefix to `\x1e` record separator.

**Test results:** 369 signal chain tests pass, 0 regressions, 0 new TypeScript errors.

### Signal Chain Hardening Round 4: 2026-03-04

Fourth comprehensive audit — 4 parallel Opus deep-dives across all signal families. Focused on structured logging consistency, crash safety, performance hot paths, and test coverage gaps. Brought overall grade from A- to A.

**HIGH — Logging infrastructure (6):**
- `justification.ts`: Replaced 4 `console.warn` calls with structured `log.warn()` (entity name, error details in JSON).
- `incremental.ts`: Replaced 2 `console.error` calls with structured `logger.child()` warnings. Added `logger` + `createPipelineLogger` imports (file previously had zero observability).
- `pattern-detection.ts`: `scanSynthesizeAndStore` had no system logger — added `logger.child()` at entry and error path. Fixed `astGrepScan` catch using redundant `require("@/lib/utils/logger")` when `logger` was already imported. Fixed `semanticPatternMining` same redundant require. Added error binding to empty catch in convention synthesis.

**HIGH — Crash safety (3):**
- `context-assembly.ts`: `embed([query])[0]!` non-null assertion crashes if embed returns empty. Added null guard with graceful empty-result return.
- `hybrid-search.ts`: Same `embeddings[0]!` crash in semantic leg and justification leg. Added null guards returning empty arrays.

**HIGH — Dead code removal (1):**
- `justification.ts`: `_batchSuccess` variable written at 3 locations but never read. Removed entirely.

**MEDIUM — Performance (4):**
- `justification.ts`: `tierEntities.find()` O(N) linear scan called per entity per batch → built `tierEntityMap` (Map) for O(1) lookups. Updated `retrySingleEntity` signature to accept Map.
- `pattern-detection.ts`: `storePatterns` did N sequential `await` for rule upserts → batched with `Promise.all`.
- `ontology.ts`: `readFileSync` blocked event loop in async Temporal activity → changed to async `readFile` from `node:fs/promises`.
- `health-report-builder.ts`: DFS cycle detection used `stack.indexOf()` O(V) per back-edge → added `stackPos` Map for O(1) position lookup.

**MEDIUM — Silent failures fixed (4):**
- `ontology.ts`: Empty `catch {}` on context document fetch → added `log.debug()` with error details.
- `embedding.ts`: `loadJustificationMap` silently swallowed all errors → added `log.warn()` distinguishing DB timeouts from no-data.
- `incremental.ts`: Silent catch on quarantine healing → added `logger.warn()`.
- `structural-fingerprint.ts`: Dead `?? 0` fallback on `pagerank_percentile` (null case already returns null) → removed unreachable code.

**MEDIUM — Test coverage (8 new tests):**
- `structural-fingerprint.test.ts`: Added boundary-value tests for centrality buckets at exactly P25/P75/P95, fan_ratio boundaries (0.5/2.0/2.1), partial metadata defaults, and falsy-but-valid `pagerank_percentile: 0`. Used `DISCONNECTED_DEPTH` constant instead of magic `99`.
- `git-analyzer.test.ts`: Added `buildFileCommitIndex` tests (empty, single, multi-commit accumulation) and `computeTemporalContext` with pre-built index parameter.

**LOW — Polish (6):**
- `hybrid-search.ts`: Imported `CODE_VARIANT_SUFFIX` from `embedding.ts` instead of duplicating. Removed duplicate `"that"` in stop words.
- `graph-analysis.ts`: Computed `communityCount` once instead of twice. Removed unnecessary `as Record<string, unknown>` cast (EntityDoc has index signature).
- `structural-fingerprint.ts`: Removed unnecessary `as Record<string, unknown>` cast; used typed property access with `as number | undefined` narrowing.
- `context-assembly.ts`: Converted unnecessary `require("./entity-profile")` to normal import (no circular dependency).
- `git-analyzer.ts`: Removed redundant `new Set(Array.from(set))` → `new Set(set)`.

**Test results:** 627 signal chain tests pass (+258 from new coverage), 0 regressions, 0 new TypeScript errors.

### Pipeline Observability & Hardening: 2026-03-02

Four-pass comprehensive audit of all signals, workflows, activities, and logging infrastructure. Elevated the pipeline from "functional" to "measurable and transparent" — enterprise-grade observability.

**P0 — Bug fix (1):**
- `typescript/tree-sitter.ts`: `fillEndLinesAndBodies` referenced `opts.filePath` from outer function scope (module-level function, not a closure). `ReferenceError` at runtime meant all TypeScript entities were missing complexity scores. Fixed by passing `filePath` as explicit parameter.

**P1 — Error handling (3):**
- `temporal-analysis.ts`: Wrapped entire `computeTemporalAnalysis` body in try/catch with structured logging to both system logger and pipeline logger before rethrow.
- `pattern-detection.ts`: Added top-level try/catch in `scanSynthesizeAndStore` with pipeline log on error. Added logging to `llmSynthesizeRules` bare catch blocks (previously silently fell back to heuristics).
- `detect-patterns.ts` workflow: Replaced two silent `catch {}` blocks with structured `console.log` messages for semantic mining and workspace cleanup failures.

**P1 — Logging & bugs (5):**
- `incremental-index.ts`: Added `wfLog` helper and `logActivities` proxy (pipeline logging parity with `index-repo.ts`). Added step-level logging for all 10 steps. Fixed `workflow_id: ""` bug (now uses captured `wfId`). Fixed silent `catch {}` on context refresh. Removed dead `_driftActivities` proxy. Passed `runId` to fallback `indexRepoWorkflow` child. Wrapped fallback `startChild` with "already started" handling.
- `cross-file-calls.ts`: Added structured logging (import resolution stats, call edges created). Renamed unused `_repoId` to `repoId` for logger context.
- `sync-local-graph.ts`: Replaced raw `console.error` with structured `[timestamp] [LEVEL] [wf:name] [orgId/repoId]` format.
- `embed-repo.ts`: Added `updatePipelineStep(embed, "failed")` on error when `runId` present. Removed unused `workflowInfo` import.
- `index-repo.ts`: Added per-step duration tracking (`stepDurations` record with `formatMs` helper). Added signal quality score (SCIP vs tree-sitter coverage %). Enriched completion summary with all metrics. Added elapsed time on error path. Simplified redundant `Math.max` in quality score computation.

**P2 — Code quality (3):**
- `workspace-cleanup.ts`: Replaced `console.error`/`console.log` with structured `logger.child()`.
- `logger.ts`: Tightened `[key: string]: any` to `[key: string]: unknown` in `LogContext`.
- `indexing-heavy.ts`: Removed unused `readFileSync` import.

**Files changed:** 13. **Zero linter errors introduced.** All changes verified across 4 audit passes with no remaining P0 or P1 issues.

### SCIP Coverage Expansion: 2026-03-02

Wired SCIP indexers for all 6 previously-stub languages (C, C++, C#, Rust, Ruby, PHP), bringing all 10 language plugins to Tier 1 SCIP support when the binary is available on the worker.

**New SCIP integrations (6):**
- **C/C++** via `scip-clang` (Clang 16, Sourcegraph) — shared `runSCIPClang()` in `lib/indexer/languages/c/scip.ts`, requires `compile_commands.json`
- **C#** via `scip-dotnet` (Roslyn, Sourcegraph) — `runSCIPDotnet()` in `lib/indexer/languages/csharp/scip.ts`, requires `.sln` or `.csproj`
- **Rust** via `scip-rust` (rust-analyzer wrapper) — `runSCIPRust()` in `lib/indexer/languages/rust/scip.ts`, requires `Cargo.toml`
- **Ruby** via `scip-ruby` (Sorbet-based, Sourcegraph) — `runSCIPRuby()` in `lib/indexer/languages/ruby/scip.ts`, requires `Gemfile`
- **PHP** via `scip-php` (nikic/php-parser, community) — `runSCIPPhp()` in `lib/indexer/languages/php/scip.ts`, requires `composer.json`

**Updated files (7):**
- 5 new `scip.ts` files (C shares with C++)
- 6 updated `index.ts` plugin files (C, C++, C#, Rust, Ruby, PHP)
- `indexing-heavy.ts`: SCIP binary pre-check map expanded from 3 to 10 entries (all languages)

**Design:** Each integration follows the proven pattern: check project marker → run CLI with 10-minute timeout → parse via shared `parseSCIPOutput()` decoder → clean up output → fall back to tree-sitter on failure. No new dependencies — workers just need the SCIP binaries on their PATH.
