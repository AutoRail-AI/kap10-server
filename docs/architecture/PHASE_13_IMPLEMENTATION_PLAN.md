# Phase 13 — Implementation Plan

> Detailed, dependency-ordered task list for implementing all changes described in [PHASE_13_IMMUTABLE_SOURCE_ARTIFACTS.md](./PHASE_13_IMMUTABLE_SOURCE_ARTIFACTS.md) and cross-cutting updates across the architecture docs.
>
> **Status: V1 COMPLETE** — Sprints 1–7 fully implemented (March 2026). V2 (AST-Aware DAG) deferred to Future Enhancements.

**Guiding principles:**
- Each task is a single PR-sized unit of work
- Tasks within a sub-phase are ordered by dependency (top-down)
- No task should break `pnpm build` or existing tests
- Clean-slate implementation — gitserver + worktrees are the only code ingestion path
- Old `git clone --depth 1` and zip-upload paths are replaced outright
- **Leverage open-source platforms via Docker Compose** — don't build from scratch what battle-tested projects already solve
- **Avoid premature optimization** — use existing infrastructure (Supabase Storage) before adding new stateful services
- **Two-phase incremental strategy** — file-level diffing first (V1), AST-aware DAG later (V2)

**Implementation simplifications made during V1:**
- **A-10 (scip-artifact.ts)**: SCIP cache check/upload was folded into `indexing-heavy.ts` instead of creating a separate activity file. The pipeline queries Prisma for existing ScipIndex rows and uploads to Supabase Storage after indexing — all inline.
- **B-06 (partial SCIP merge)**: Deferred to V2. V1 does full SCIP re-index on workspace worktrees but only WRITES the delta to ArangoDB. SCIP runs in 15–45s for most repos, which is acceptable for V1.
- **C-03 (position-adjust.ts)**: Deferred to V2. V1 queries use the nearest indexed commit's entities directly. Position adjustment via parse-diff is only needed when querying at precise line numbers on un-indexed commits, which is a V2 optimization.
- **B-10 (workspace dashboard)**: Deferred. The WorkspaceSync table is populated and queryable, but no frontend page exists yet. Can be built when there's user demand.
- **D-03 (scope stamping in indexing-light)**: Scope stamping is handled in `indexing-heavy.ts` where entities are written to the graph store, not in indexing-light. The `writeEntitiesToGraph` function accepts scopeInfo and stamps it on all entities during upsert.

---

## Open-Source Stack Decisions

| Component | Decision | Why |
|-----------|----------|-----|
| **Internal gitserver** | **Gitea (headless Docker container)** | Single Go binary, ~30 MB image, REST API for creating trees/commits/refs, manages bare repos. Deploy headless: SSH disabled, registration disabled, UI hidden. **Strictly VPC-internal — never exposed to public internet.** |
| **CLI Git operations** | **isomorphic-git** | Pure JS Git implementation. CLI stages, commits, and pushes `.pack` files over HTTP. Solves the Merkle-tree-to-Git-commit bridge problem entirely. **CLI pushes to the Unerr API, which proxies to Gitea — CLI never talks to Gitea directly.** |
| **SCIP artifact storage** | **Supabase Storage** (existing) | Already deployed, already paid for, already backed up. A 20 MB `.scip.gz` download takes < 1s. MinIO is premature optimization — add it only if Supabase becomes a bottleneck. |
| **SCIP indexing** | **scip-typescript**, **scip-python**, **rust-analyzer** | Official Sourcegraph SCIP indexers. Already used. No change. |
| **Diff position adjustment** | **parse-diff** (Node) | Already a dependency. Parses unified diffs into structured hunks for line-number translation. |
| **File watching (CLI)** | **chokidar** | Already in ecosystem. Cross-platform file watching for `--watch` mode. |
| **Incremental strategy** | **File-level hashing (V1)** → AST signature DAG (V2) | V1: if `auth.ts` changed, re-run SCIP on `auth.ts` only. No cross-file dependency tracking. V2 (later): add tree-sitter-graph + object-hash for early cutoff. |

### Security Architecture: Git Proxy Route

The CLI **never talks to Gitea directly**. Gitea stays strictly on the internal Docker network.

```
CLI (unerr sync)                    Unerr API                         Gitea (internal)
     |                                  |                                   |
     |  POST /api/git/{orgId}/{repoId}  |                                   |
     |  (HTTP Git smart protocol)       |                                   |
     |  Authorization: Bearer {apiKey}  |                                   |
     |--------------------------------->|                                   |
     |                                  |  Validate API key (Better Auth)   |
     |                                  |  Check repo ownership             |
     |                                  |  Proxy raw body to Gitea:         |
     |                                  |  POST http://gitea:3000/{org}/{repo}.git/git-receive-pack
     |                                  |---------------------------------->|
     |                                  |  <stream response>                |
     |                                  |<----------------------------------|
     |  <stream response>               |                                   |
     |<---------------------------------|                                   |
```

This means:
- No Gitea user accounts to manage (Unerr API key = auth)
- No Gitea ports exposed to public internet
- No auth sync between Better Auth and Gitea
- Standard Git HTTP smart protocol — isomorphic-git's `push()` works unchanged

### Docker Compose Addition

```yaml
gitea:
  image: gitea/gitea:1.22-rootless
  container_name: unerr-gitserver
  environment:
    - GITEA__server__DISABLE_SSH=true
    - GITEA__server__OFFLINE_MODE=true
    - GITEA__service__DISABLE_REGISTRATION=true
    - GITEA__api__ENABLE_SWAGGER=false
    - GITEA__database__DB_TYPE=sqlite3
    - GITEA__database__PATH=/data/gitea/gitea.db
    - GITEA__repository__ROOT=/data/repos
  volumes:
    - gitserver_data:/data
  profiles: ["worker"]
  networks:
    - internal
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:3000/api/v1/version"]
    interval: 10s
```

No MinIO. No additional stateful services. Gitea + existing Supabase Storage.

---

## Dependency Graph (Sub-Phase Order)

```
Phase 13a: gitserver (Gitea) + SCIP Artifact Pipeline (Supabase Storage)
  |
  +---> Phase 13d: Graph Versioning (scope field on entities)
  |       |
  |       +---> Phase 13c: Branch Tracking + Visible Uploads
  |
  +---> Phase 13b: Workspace Tracking (isomorphic-git + file-level diffing V1)
  |       |
  |       +---> Phase 13c (also depends on 13b for workspace queries)
  |
  +---> Phase 13e: CLI Unification (depends on 13a + 13b)
  |
  +---> Phase 13f (V2): AST-Aware Incremental DAG (deferred — only after V1 is stable)
```

13a is the foundation. 13d (scope field) should land early because 13b and 13c both need scoped entities. 13e is last because it unifies CLI paths that 13a and 13b create. 13f (AST DAG) is explicitly deferred.

---

## Phase 13a: Internal gitserver (Gitea) + SCIP Artifact Pipeline

**Goal:** Deploy Gitea as headless gitserver. Replace ephemeral `git clone --depth 1` with persistent bare repos managed by Gitea + worktree-based indexing. Cache SCIP indexes in Supabase Storage by commit SHA.

### Infrastructure & Schema

| # | Task | Files | Status | Details |
|---|------|-------|--------|---------|
| **A-01** | Create `IInternalGitServer` port interface | `lib/ports/internal-git-server.ts` | ✅ DONE | 8 methods: `ensureCloned`, `syncFromRemote`, `createWorktree`, `removeWorktree`, `diffFiles`, `resolveRef`, `pushWorkspaceRef`, `deleteRef`. Exports `SourceSpec`, `WorktreeHandle`, `GitChangedFile` types. |
| **A-02** | Create `FakeInternalGitServer` for tests | `lib/di/fakes.ts` | ✅ DONE | In-memory Map-based fake with full method coverage including `deleteRef`. Registered in `createTestContainer()`. |
| **A-03** | Create Gitea-backed adapter | `lib/adapters/gitea-git-server.ts` | ✅ DONE | Two I/O channels: Gitea REST API (HTTP) for lifecycle ops + direct git CLI on shared volume for worktree ops. Includes `ensureWebhook` for auto-configuring push webhooks. `deleteRef` uses `git update-ref -d` (idempotent). |
| **A-04** | Register in DI container | `lib/di/container.ts` | ✅ DONE | `internalGitServer` property on Container interface. Lazy-loaded via `require()` in getter. |
| **A-05** | Add Gitea to Docker Compose | `docker-compose.yml` | ✅ DONE | Gitea 1.22-rootless, headless (SSH disabled, registration disabled, install locked), SQLite, repos on persistent `gitea_data` volume. Workers mount same volume. Internal network only. |
| **A-06** | Create `scip-indexes` Supabase Storage bucket | Referenced in code | ✅ DONE | `SCIP_BUCKET = "scip-indexes"` constant used in artifact-eviction.ts. Bucket created operationally. |
| **A-07** | Prisma migration: new tables | `prisma/schema.prisma` | ✅ DONE | 4 models: `ScipIndex`, `BranchRef`, `WorkspaceSync`, `NearestIndexedCommit`. `branchTrackingEnabled` and `workspaceTrackingEnabled` on `Repo`. All with `@@schema("unerr")`, `@map()` snake_case, unique constraints, and indexes. |
| **A-08** | Worktree GC in heavy worker | `lib/temporal/activities/indexing-heavy.ts` | ✅ DONE | `createWorktree` wrapped in `try/finally` with `removeWorktree()`. Belt-and-suspenders: `git worktree remove --force` + `rm -rf`. Workspace cleanup cron in `workspace-cleanup.ts`. |

### Activities & Workflows

| # | Task | Files | Status | Details |
|---|------|-------|--------|---------|
| **A-09** | Create `ingestSource` activity | `lib/temporal/activities/ingest-source.ts` | ✅ DONE | Runs on `light-llm-queue`. Handles GitHub (`ensureCloned` + `syncFromRemote` with installation token injection) and `local_cli` (resolves HEAD). Returns `{ commitSha, ref }`. Registered in `scripts/temporal-worker-light.ts`. |
| **A-10** | SCIP artifact cache check/upload | `lib/temporal/activities/indexing-heavy.ts` (inline) | ✅ DONE | **Design simplification:** Folded into `indexing-heavy.ts` rather than a separate file. Pipeline queries `ScipIndex` Prisma model for cache hits and uploads artifacts to Supabase Storage `scip-indexes` bucket inline. |
| **A-11** | Worktree-based indexing | `lib/temporal/activities/indexing-heavy.ts` | ✅ DONE | `prepareRepoIntelligenceSpace` creates worktree via `container.internalGitServer.createWorktree()`, scans workspace, returns `{ indexDir, files, isWorktree }`. Worktree cleanup in caller's `finally{}` block. |
| **A-12** | SCIP cache check in pipeline | `lib/temporal/activities/indexing-heavy.ts` | ✅ DONE | Integrated into the worktree-based flow. Queries `ScipIndex` for existing artifact before running SCIP. Cache hit skips SCIP and downloads from Supabase Storage. |
| **A-13** | Rewrite `indexRepoWorkflow` | `lib/temporal/workflows/index-repo.ts` | ✅ DONE | `IndexRepoInput` includes `provider`, `scope`, `commitSha`. Step 0 calls `ingestSource`. Workflow passes scope through to all downstream activities. |
| **A-14** | Git proxy route | `app/api/git/[...slug]/route.ts` | ✅ DONE | Handles `GET/POST` for `info/refs`, `git-receive-pack`, `git-upload-pack`. Validates API key via SHA-256 hash lookup. Checks org + repo ownership. Proxies raw bytes to internal Gitea. Streams response. |
| **A-15** | Update all workflow callers | Route files | ✅ DONE | All 6 `indexRepoWorkflow` call sites pass `scope: "primary"`: `app/api/cli/index/route.ts`, `app/api/repos/[repoId]/route.ts`, `reindex/route.ts`, `retry/route.ts`, `webhooks/github/route.ts` (2 sites). |
| **A-16** | Remove old clone/zip paths | `lib/temporal/activities/indexing-heavy.ts` | ✅ DONE | Old `git clone --depth 1` and zip extraction paths replaced by worktree-based flow. |
| **A-17** | Artifact eviction workflow | `lib/temporal/workflows/evict-artifacts.ts`, `lib/temporal/activities/artifact-eviction.ts` | ✅ DONE | Three-phase workflow: (1) SCIP artifact eviction (per-repo, keeps latest forever, 30-day retention), (2) stale branch ref eviction (ArangoDB + Gitea ref + Prisma), (3) workspace pruning (delegates to `pruneStaleWorkspaces`). Set-based orphan detection for NearestIndexedCommit. Heartbeat timeouts on all activities. |
| **A-18** | Register eviction schedule | `scripts/register-temporal-schedules.ts` | ✅ DONE | `ScheduleClient.create()` for daily 3 AM UTC cron. Idempotent update on re-run. `package.json` script: `pnpm temporal:schedules`. |
| **A-19** | Env vars in `env.mjs` | `env.mjs` | ✅ DONE | `GITEA_URL`, `GITEA_ADMIN_TOKEN`, `GITEA_WEBHOOK_SECRET`, `GITSERVER_DATA_DIR` — all Zod-validated, optional with defaults. |

### Verification (A-series) — ✅ All Passing

- [x] `pnpm build` succeeds
- [x] `docker compose --profile worker up` starts Gitea alongside existing services
- [x] Gitea is NOT accessible from public network (internal Docker network only)
- [x] GitHub repo indexing mirrors to Gitea, creates worktree, indexes via SCIP
- [x] Worktree created in `try{}`, destroyed in `finally{}` — even on activity crash
- [x] Worktree GC cron removes orphaned worktrees older than 2 hours
- [x] SCIP artifact uploaded to Supabase Storage `scip-indexes` bucket
- [x] Re-index of same commit = cache hit (no SCIP re-run)
- [x] Two branches indexed in parallel from same bare clone (concurrent worktrees)
- [x] Git proxy route (`/api/git/...`) authenticates via API key and proxies to Gitea
- [x] `pnpm test` passes (fake gitserver in test container)
- [x] Old `git clone` and zip-extract paths fully removed

---

## Phase 13d: Graph Versioning + Delta Documents

**Goal:** Add `scope` and `commit_sha` fields to ArangoDB entities. Enable branch-aware queries with application-layer fallback.

> Scheduled before 13b/13c because both depend on scoped entities.

| # | Task | Files | Status | Details |
|---|------|-------|--------|---------|
| **D-01** | Add `scope` and `commit_sha` to entity/edge types | `lib/ports/types.ts` | ✅ DONE | `scope: string` and `commit_sha: string \| null` on `EntityDoc` and `EdgeDoc`. `EntityDelta` type exported with `added`, `modified`, `deletedKeys`, `addedEdges`, `modifiedEdges`, `deletedEdgeKeys`. |
| **D-02** | Add compound index `(repo_id, scope)` to ArangoDB | `lib/adapters/arango-graph-store.ts` | ✅ DONE | Persistent index on `["repo_id", "scope"]` for all entity collections in `bootstrapGraphSchema()`. |
| **D-03** | Stamp `scope` on entities during graph write | `lib/temporal/activities/indexing-heavy.ts` | ✅ DONE | **Implementation note:** Scope stamping happens in `indexing-heavy.ts` via `writeEntitiesToGraph()` which accepts `scopeInfo: { scope, commitSha }`. All entities are stamped before ArangoDB upsert. |
| **D-04** | Scope-first query pattern | `lib/adapters/arango-graph-store.ts` | ✅ DONE | `queryEntitiesWithScope()` method: (1) query scoped entities, (2) query primary entities, (3) fetch tombstones, (4) merge — scoped entities override primary, tombstoned keys excluded. Application-layer fallback. |
| **D-05** | Delta document computation | `lib/indexer/incremental-merge.ts` | ✅ DONE | `computeEntityDelta(baseEntities, branchEntities, baseEdges, branchEdges)` — identity key by entity ID (deterministic hash). Shallow content comparison via signature + line range + body hash. |
| **D-06** | Atomic swap for branch updates | `lib/adapters/arango-graph-store.ts` | ✅ DONE | `applyBranchDelta(orgId, repoId, scope, delta)` — writes branch-scoped entities, creates tombstones for deleted keys, handles edges. Returns `{ entitiesWritten, tombstonesCreated, edgesWritten }`. |
| **D-07** | Tombstone document handling | `lib/adapters/arango-graph-store.ts` | ✅ DONE | Tombstones stored as `kind: "tombstone"` with `original_key`. `queryEntitiesWithScope` fetches tombstones and excludes matching primary entities from merged result. |
| **D-08** | AQL PRUNE for deep traversals | `lib/adapters/arango-graph-store.ts` | ✅ DONE | `PRUNE v.kind == "tombstone"` + `FILTER v.kind != "tombstone"` on all multi-hop traversal queries (blast radius, call chains, batch subgraph). |

### Verification (D-series) — ✅ All Passing

- [x] All entities have `scope` and `commit_sha` fields
- [x] Branch-scoped entities stored separately from primary
- [x] Tombstones correctly exclude deleted entities from branch view
- [x] Atomic swap: no partial state visible during branch update
- [x] Deep traversals (3+ hops) work with scope fallback

---

## Phase 13b: Multi-User Workspace Tracking (V1 — File-Level Diffing)

**Goal:** CLI `unerr sync` using **isomorphic-git** to push to Gitea via the API proxy. Incremental re-indexing uses **file-level diffing only** — no cross-file dependency tracking in V1.

### Why File-Level Diffing First (V1)

Building a true AST-aware incremental computation graph (Salsa-style early cutoff) on day one is a trap:
- Signature hashing edge cases across languages (TypeScript re-exports, Python `__all__`, Go implicit interfaces)
- Cross-file dependency invalidation is notoriously difficult to get right
- SCIP parsers are fast enough (~15-45s for a 50 MB repo) that a little redundant parsing is acceptable

**V1 rule:** If `auth.ts` changed, re-run SCIP on `auth.ts`. Don't check whether its signature changed or whether files that import it need re-indexing. Full SCIP on changed files only.

**V2 (Phase 13f, deferred):** Once the Gitea/worktree pipeline is battle-tested, add tree-sitter-graph + object-hash for true early cutoff.

### CLI (isomorphic-git → API Proxy → Gitea)

| # | Task | Files | Status | Details |
|---|------|-------|--------|---------|
| **B-01** | Add `isomorphic-git` to CLI | `packages/cli/package.json` | ✅ DONE | `isomorphic-git: ^1.37.2`. Zero native deps. |
| **B-02** | Create `unerr sync` command | `packages/cli/src/commands/sync.ts` | ✅ DONE | Uses separate `.unerr/git/` gitdir (never touches user's `.git`). Flow: collectSyncFiles → stage → statusMatrix → commit → push to `refs/unerr/ws/{keyId}` via API proxy. `deriveKeyId()` from API key SHA-256. Auth via `onAuth` callback. Progress reporting. |
| **B-03** | `unerr sync --watch` | `packages/cli/src/commands/sync.ts` | ✅ DONE | chokidar file watcher with 2s debounce. Respects `.unerrignore`. Graceful shutdown on SIGINT/SIGTERM. Mutex prevents concurrent syncs with pending queue. |

### API

| # | Task | Files | Status | Details |
|---|------|-------|--------|---------|
| **B-04** | Gitea webhook receiver | `app/api/webhooks/gitea/route.ts` | ✅ DONE | Validates `X-Gitea-Signature` via HMAC-SHA256. Parses push payload for `refs/unerr/ws/{keyId}`. Creates `WorkspaceSync` row. Triggers `syncWorkspaceWorkflow`. Counts changed files from commit metadata. |

### Incremental Indexing (V1 — File-Level Only)

| # | Task | Files | Status | Details |
|---|------|-------|--------|---------|
| **B-05** | File-level incremental re-indexing | `lib/indexer/incremental-merge.ts` | ✅ DONE | `computeEntityDelta()` computes added/modified/deleted entities. V1 strategy: full SCIP re-index on worktree, but only delta is written to ArangoDB. |
| **B-06** | Partial SCIP merge | — | ⏳ DEFERRED (V2) | V1 does full SCIP re-index (15–45s) and delta-writes. Partial SCIP merge (running SCIP on only changed files and merging Documents) deferred to V2 when performance data justifies the complexity. |

### Workspace Sync Workflow

| # | Task | Files | Status | Details |
|---|------|-------|--------|---------|
| **B-07** | `syncWorkspaceWorkflow` | `lib/temporal/workflows/sync-workspace.ts` | ✅ DONE | V1 simplified flow: (1) diff files via `workspaceDiff`, (2) `workspaceReindex` — creates worktree, runs full SCIP + tree-sitter, computes entity delta against primary, applies via `applyBranchDelta` (scope = `workspace:{keyId}`), cleans up worktree in `finally`. 20–60s typical. |
| **B-08** | Workspace sync activities | `lib/temporal/activities/workspace-sync.ts` | ✅ DONE | `workspaceDiff` (git diff on shared volume) and `workspaceReindex` (full worktree index → delta compute → scope-write). Heartbeat at every phase. Reuses scanner, language plugins, SCIP decoder. Deduplicates entities by ID. |
| **B-09** | Workspace ref + artifact pruning | `lib/temporal/activities/workspace-cleanup.ts`, `lib/temporal/activities/artifact-eviction.ts` | ✅ DONE | `pruneStaleWorkspaces`: 3-step cleanup — ArangoDB scoped entities → Gitea ref deletion → Prisma WorkspaceSync row deletion. `evictArtifactsWorkflow` orchestrates all three eviction phases. |

### Frontend

| # | Task | Files | Status | Details |
|---|------|-------|--------|---------|
| **B-10** | Workspace status dashboard | — | ⏳ DEFERRED | WorkspaceSync table is populated and queryable. Frontend page deferred until user demand warrants it. |

### Verification (B-series) — ✅ All Core Passing

- [x] `unerr sync` pushes to Unerr API proxy (NOT directly to Gitea)
- [x] API proxy validates API key, proxies to internal Gitea
- [x] Gitea internal webhook triggers `syncWorkspaceWorkflow`
- [x] Second sync efficiently transfers only changed objects (Git pack protocol)
- [x] Incremental re-index: full SCIP but delta-only writes (V1)
- [x] 10 concurrent users: each gets own ref in Gitea, no contention
- [x] `--watch` mode detects file changes and syncs incrementally
- [x] Inactive workspaces pruned after 48 hours (configurable)

---

## Phase 13c: Branch Tracking + Cross-Commit Queries

**Goal:** Index non-default branches. Resolve queries on un-indexed commits via nearest indexed ancestor + git-diff position adjustment.

| # | Task | Files | Status | Details |
|---|------|-------|--------|---------|
| **C-01** | Handle non-default branch pushes | GitHub webhook handler | ✅ DONE | On push to non-default branch: `ingestSource` mirrors to Gitea, `indexRepoWorkflow` triggered with `scope: "branch:{name}"`. |
| **C-02** | Nearest indexed commit lookup | `lib/indexer/commit-graph.ts` | ✅ DONE | `findNearestIndexedCommit()`: (1) check Prisma cache, (2) check self, (3) walk `git rev-list --first-parent` in batches of 50, up to 500 ancestors. Batch-queries ScipIndex for hits. Caches results. |
| **C-03** | Git-diff position adjustment | — | ⏳ DEFERRED (V2) | V1 uses nearest indexed commit entities directly. Position adjustment via parse-diff deferred until precise line-number queries on un-indexed commits become a user need. |
| **C-04** | Commit graph pre-computation activity | `lib/temporal/activities/commit-graph.ts` | ✅ DONE | `preComputeCommitGraph()` calls `preComputeNearestIndexed()` — walks descendants from indexed commit, caches distance for each. Only updates if new distance is smaller. Registered on `light-llm-queue`. |
| **C-05** | `commitGraphUpdateWorkflow` | `lib/temporal/workflows/commit-graph-update.ts` | ✅ DONE | Triggered as child workflow after SCIP upload. Calls `preComputeCommitGraph` activity. Includes pipeline logging. |
| **C-06** | Branch picker UI | `components/repo/repo-tabs.tsx`, sub-tab nav | ✅ DONE | Branch picker integrated into repo tabs for switching scope across entity/pattern/glossary views. |
| **C-07** | MCP scope parameter | `lib/mcp/tools/scope-resolver.ts` + all MCP tools | ✅ DONE | `resolveScope()` centralizes: explicit `scope` → `branch` shorthand → workspace from auth context → "primary". All code intelligence MCP tools route through `queryEntitiesWithScope`. |
| **C-08** | Visible uploads in MCP query path | `lib/mcp/tools/scope-resolver.ts` | ✅ DONE (V1) | V1: uses `findNearestIndexedCommit` for scope resolution. Queries nearest indexed commit's entities. V2 will add position adjustment. |

### Verification (C-series) — ✅ Core Passing

- [x] Push to non-default branch triggers Gitea mirror-sync + indexing
- [x] Query on un-indexed commit resolves to nearest indexed ancestor
- [ ] Position adjustment (via parse-diff) produces correct line numbers — **V2**
- [x] `nearest_indexed_commits` populated after SCIP upload
- [x] Branch picker shows indexed branches
- [x] MCP tools accept `branch`/`scope` parameter
- [x] Cross-commit query returns results from nearest indexed commit

---

## Phase 13e: CLI Unification

**Goal:** `unerr push` bootstraps a repo in Gitea via the API proxy (replaces zip upload). `unerr sync` is the primary ongoing sync mechanism. Both use isomorphic-git.

| # | Task | Files | Status | Details |
|---|------|-------|--------|---------|
| **E-01** | Rewrite `unerr push` for Gitea | `packages/cli/src/commands/push.ts` | ✅ DONE | Push triggers `indexRepoWorkflow` with `scope: "primary"`. Repo created in Gitea on first push. |
| **E-02** | Pack-file optimization | `packages/cli/src/commands/sync.ts` | ✅ DONE | isomorphic-git's `push()` handles pack-file generation natively. Progress callback via `onProgress`. |

### Verification (E-series) — ✅ All Passing

- [x] `unerr push` creates repo in Gitea via API proxy (no zip in Supabase Storage)
- [x] `unerr sync` works after initial `push`
- [x] `--watch` mode: continuous sync with error recovery
- [x] CLI only talks to Unerr API — never directly to Gitea

---

## Phase 13f (V2, Deferred): AST-Aware Incremental DAG

**Goal:** After the V1 pipeline is stable and battle-tested, add cross-file dependency tracking for true early cutoff. **Do not start this until Phase 13a-13e are fully verified.**

| # | Task | Files | Details | Depends On |
|---|------|-------|---------|------------|
| **F-01** | Add `tree-sitter-graph` DSL for import/export extraction | `lib/indexer/dependency-dag.ts` (new), `lib/indexer/graphs/*.scm` (new) | Write tree-sitter-graph `.scm` query files for TypeScript, Python, Go to declaratively extract import paths and exported symbol signatures. `extractDependencyDAG(scipIndex): FileDependencyDAG`. Store as `{commitSha}.depgraph.json`. | B-06 |
| **F-02** | Implement signature hash with `object-hash` | `lib/indexer/dependency-dag.ts` | `computeSignatureHash(scipDocument): string`. Use `object-hash` to deterministically hash the sorted exported symbol definitions from SCIP. | F-01 |
| **F-03** | Implement DAG-based affected-set computation | `lib/indexer/dependency-dag.ts` | `computeAffectedSet(dag, changedFiles): string[]`. Traverse `dependents` map from changed files. | F-01 |
| **F-04** | Implement early cutoff | `lib/indexer/dependency-dag.ts` | `applyEarlyCutoff(oldDAG, newPartialSCIP, affectedSet): string[]`. Compare old vs new signature hashes. If unchanged, prune dependents from affected set. 70-90% reduction in re-indexed files. | F-02, F-03 |
| **F-05** | Upgrade `syncWorkspaceWorkflow` to use DAG | `lib/temporal/workflows/sync-workspace.ts` | Replace V1's "re-index changed files only" with DAG-aware: compute affected set → partial SCIP → early cutoff → merge. | F-03, F-04 |

### NPM Dependencies (V2 only)

| Package | Where | Purpose |
|---------|-------|---------|
| `tree-sitter-graph` | root | DSL for declarative import/export graph extraction |
| `object-hash` | root | Deterministic hashing of AST signature nodes |

---

## Cross-Cutting Changes (from Architecture Doc Updates)

| # | Task | Files | Status | Details |
|---|------|-------|--------|---------|
| **X-01** | Rewrite workflow callers for SourceSpec | All trigger points | ✅ DONE | All 6 call sites pass `provider`, `scope: "primary"`, and other required fields. |
| **X-02** | Rewrite incremental indexing for visible uploads | `lib/temporal/workflows/incremental-index.ts` | ✅ DONE | Uses `gitserver.diffFiles()` for incremental detection. |
| **X-03** | MCP branch-aware queries | MCP tools + `scope-resolver.ts` | ✅ DONE | `resolveScope()` centralizes scope resolution. All tools accept `scope`/`branch`. |
| **X-04** | Phase 12 collision detection for scope | Scoped AQL queries | ✅ DONE | `queryEntitiesWithScope` enables entity-level collision detection via scoped queries. |
| **X-05** | Register new activities in workers | Worker scripts | ✅ DONE | Light: `ingest-source`, `commit-graph`, `artifact-eviction`, `workspace-cleanup`. Heavy: `workspace-sync`. All spread into `activities` objects. |

---

## Implementation Order (Sprint-Level)

### Sprint 1: Foundation (A-01 through A-08, A-19) — ✅ COMPLETE
Port interface, fake, Gitea adapter, DI registration, Docker Compose (Gitea only), Supabase Storage bucket, Prisma migration, worktree GC, env vars.

**Exit criteria:** ✅ `pnpm build` passes, `pnpm test` passes with fake gitserver, `docker compose --profile worker up` starts Gitea, Gitea health check passes, worktree GC cron runs.

### Sprint 2: Core Pipeline (A-09 through A-16, D-01 through D-03) — ✅ COMPLETE
Ingest source activity, SCIP artifact caching (inline in indexing-heavy), worktree-based indexing, Git proxy route, workflow rewrite, remove old clone/zip paths, scope field on entities.

**Exit criteria:** ✅ GitHub repo mirrors to Gitea, indexes via worktree, SCIP cached in Supabase Storage. Git proxy route authenticates and proxies. Old clone/zip paths deleted. Entities have scope field.

### Sprint 3: Graph Versioning (D-04 through D-08) — ✅ COMPLETE
Scope-first queries, delta documents, tombstones, atomic swap, PRUNE traversals.

**Exit criteria:** ✅ Branch-scoped entities queryable with primary fallback.

### Sprint 4: Workspace Tracking V1 (B-01 through B-05) — ✅ COMPLETE
isomorphic-git CLI, `unerr sync` pushing via API proxy, Gitea webhook receiver, file-level incremental re-indexing.

**Exit criteria:** ✅ `unerr sync` pushes via API proxy to internal Gitea. Full SCIP re-index with delta-only writes (V1 simplification — partial SCIP merge deferred).

### Sprint 5: Workspace Workflow + Branch Tracking (B-07 through B-09, C-01 through C-05) — ✅ COMPLETE
Workspace sync workflow, branch webhook handling, visible uploads, commit graph pre-computation.

**Exit criteria:** ✅ Multi-user workspace tracking functional. Branch pushes trigger incremental indexing. Cross-commit queries work.

### Sprint 6: Frontend + MCP + CLI Unification (C-06 through C-08, E-01, E-02, X-01 through X-05) — ✅ COMPLETE
Branch picker UI, MCP scope parameter, CLI rewrite, cross-cutting registration.

**Exit criteria:** ✅ Phase 13 V1 feature set complete. All core verification checklists pass.

### Sprint 7: Eviction + Hardening (A-17, A-18, B-09) — ✅ COMPLETE
Artifact eviction from Supabase Storage, stale ref pruning in Gitea, workspace cleanup, heartbeat timeouts, Temporal schedule registration.

**Exit criteria:** ✅ Eviction runs on daily schedule (3 AM UTC). Three-phase eviction: SCIP artifacts → branch refs → workspace pruning. Set-based orphan detection. Heartbeats on all long-running activities.

---

## Future Enhancements (Post-V1)

The following items are explicitly deferred until V1 is stable and real-world performance data justifies the investment.

### V2: AST-Aware Incremental DAG (formerly Sprint 8: F-01 through F-05)

**Prerequisite:** V1 must be stable and battle-tested. Only start when real-world data shows redundant re-indexing is a measurable bottleneck (>30% of indexing time wasted on unchanged files).

| # | Task | Files | Details |
|---|------|-------|---------|
| **F-01** | `tree-sitter-graph` DSL for import/export extraction | `lib/indexer/dependency-dag.ts`, `lib/indexer/graphs/*.scm` | Tree-sitter-graph `.scm` query files for TypeScript, Python, Go. `extractDependencyDAG(scipIndex): FileDependencyDAG`. |
| **F-02** | Signature hash with `object-hash` | `lib/indexer/dependency-dag.ts` | `computeSignatureHash(scipDocument): string`. Deterministic hash of exported symbols. |
| **F-03** | DAG-based affected-set computation | `lib/indexer/dependency-dag.ts` | `computeAffectedSet(dag, changedFiles): string[]`. Traverse `dependents` map. |
| **F-04** | Early cutoff | `lib/indexer/dependency-dag.ts` | Compare old vs new signature hashes. If unchanged, prune dependents. 70-90% reduction. |
| **F-05** | Upgrade `syncWorkspaceWorkflow` to use DAG | `lib/temporal/workflows/sync-workspace.ts` | Replace V1's "full SCIP + delta write" with DAG-aware affected set + early cutoff. |

**NPM Dependencies (V2 only):** `tree-sitter-graph`, `object-hash`

### Deferred V1 Items

| Item | Reason for Deferral | Can Build When |
|------|---------------------|----------------|
| **B-06** (Partial SCIP merge) | Full SCIP re-index (15–45s) is acceptable for V1. Partial merge adds complexity for marginal gain. | Performance data shows SCIP is the bottleneck. |
| **B-10** (Workspace dashboard) | Backend data (WorkspaceSync table) is fully populated. No frontend page yet. | User demand for workspace visibility. |
| **C-03** (Position adjustment) | V1 queries use nearest indexed commit directly. Position adjustment only matters for precise line-number queries on un-indexed commits. | Users query specific lines on commits between indexes. |

---

## NPM Dependencies Added (V1)

| Package | Where | Purpose | Status |
|---------|-------|---------|--------|
| `isomorphic-git` | `packages/cli` | Pure JS Git — stage, commit, push `.pack` files via API proxy | ✅ Installed |
| `chokidar` | `packages/cli` | File watching for `--watch` mode | ✅ Installed |

No `@aws-sdk/client-s3`, no `object-hash`, no `tree-sitter-graph` — those are V2 only.

---

## Risk Mitigation

| Risk | Mitigation | Status |
|------|------------|--------|
| Gitea API limitations for programmatic tree/commit creation | isomorphic-git pushes directly via Git HTTP smart protocol — bypasses REST API entirely. | ✅ Resolved |
| **Orphaned worktrees from OOM kills** | `try/finally` on every worktree use. Belt-and-suspenders: `git worktree remove --force` + `rm -rf`. Workspace cleanup cron. | ✅ Resolved |
| **Gitea exposed to public internet** | Git proxy route (`/api/git/...`) is the only public entry. Gitea on Docker internal network, no port bindings. API key auth. | ✅ Resolved |
| SCIP partial indexing (`--files` flag) not supported | V1: full SCIP re-index on worktree, delta-only writes to ArangoDB. V2: partial SCIP merge. | ✅ V1 Resolved |
| ArangoDB transaction size limits for large delta swaps | `applyBranchDelta` batches operations. Each entity written individually with error handling. | ✅ Resolved |
| isomorphic-git performance for very large repos (100k+ files) | isomorphic-git handles repos up to ~100k files. For larger: native `git` binary as fallback. | Monitoring |
| Supabase Storage latency for SCIP artifacts | < 1s for 20 MB file. No MinIO needed yet. | Monitoring |
| `nearest_indexed_commits` table grows unbounded | `evictStaleScipArtifacts` cleans orphaned NearestIndexedCommit rows via set-based detection. | ✅ Resolved |

---

## File Inventory (Actual)

### New Files (15)

```
lib/ports/internal-git-server.ts              -- IInternalGitServer port (8 methods)
lib/adapters/gitea-git-server.ts              -- Gitea REST API + git CLI adapter
lib/temporal/activities/ingest-source.ts      -- Source ingestion (Gitea mirror-sync)
lib/temporal/activities/workspace-sync.ts     -- Workspace sync activities (diff + reindex)
lib/temporal/activities/commit-graph.ts       -- Commit graph pre-computation
lib/temporal/activities/artifact-eviction.ts  -- SCIP artifact + branch ref eviction
lib/temporal/workflows/sync-workspace.ts      -- User workspace sync workflow
lib/temporal/workflows/evict-artifacts.ts     -- Artifact + ref eviction cron
lib/temporal/workflows/commit-graph-update.ts -- Commit graph update workflow
lib/indexer/incremental-merge.ts              -- Entity delta computation
lib/indexer/commit-graph.ts                   -- Visible uploads (nearest indexed commit)
lib/mcp/tools/scope-resolver.ts              -- MCP scope resolution (C-07/C-08)
app/api/git/[...slug]/route.ts              -- Next.js Git proxy route (CLI → Gitea)
app/api/webhooks/gitea/route.ts              -- Gitea internal push webhook receiver
packages/cli/src/commands/sync.ts             -- unerr sync (isomorphic-git)
scripts/register-temporal-schedules.ts        -- Temporal schedule registration
```

### Modified Files (16)

```
lib/ports/types.ts                            -- scope + commit_sha on EntityDoc/EdgeDoc, EntityDelta
lib/ports/graph-store.ts                      -- queryEntitiesWithScope, applyBranchDelta, etc.
lib/ports/storage-provider.ts                 -- listFiles method
lib/adapters/arango-graph-store.ts            -- scope queries, delta docs, tombstones, PRUNE
lib/adapters/supabase-storage.ts              -- listFiles implementation
lib/temporal/activities/indexing-heavy.ts      -- worktree + try/finally GC, scope stamping, SCIP cache inline
lib/temporal/activities/workspace-cleanup.ts   -- Gitea ref deletion in pruneStaleWorkspaces
lib/temporal/workflows/index-repo.ts          -- SourceSpec-based input, scope parameter
lib/temporal/workflows/incremental-index.ts   -- gitserver.diffFiles() integration
lib/di/container.ts                           -- IInternalGitServer registration
lib/di/fakes.ts                               -- FakeInternalGitServer + deleteRef + listFiles
prisma/schema.prisma                          -- 4 new models + 2 repo columns
packages/cli/src/commands/push.ts             -- scope: "primary" on workflow trigger
docker-compose.yml                            -- Gitea service (internal network only)
env.mjs                                       -- Gitea env vars (no MinIO)
scripts/temporal-worker-light.ts              -- register eviction + commit-graph activities
```

---

## Task Completion Summary

| Sub-Phase | Tasks | Done | Deferred | Status |
|-----------|-------|------|----------|--------|
| 13a (Gitea + SCIP) | 19 | 19 | 0 | ✅ Complete |
| 13d (graph versioning) | 8 | 8 | 0 | ✅ Complete |
| 13b (workspace V1) | 10 | 8 | 2 | ✅ Core Complete |
| 13c (branch + visible uploads) | 8 | 7 | 1 | ✅ Core Complete |
| 13e (CLI unification) | 2 | 2 | 0 | ✅ Complete |
| Cross-cutting | 5 | 5 | 0 | ✅ Complete |
| **V1 Total** | **52** | **49** | **3** | **✅ V1 Complete** |
| 13f (V2 DAG — future) | 5 | 0 | 5 | ⏳ Future |

**3 deferred items** (B-06 partial SCIP merge, B-10 workspace dashboard, C-03 position adjustment) are non-blocking V1 simplifications with clear triggers for when to build them.
