# Phase 13 — Immutable Source Artifacts & Multi-Branch Code Intelligence

> **Phase Feature Statement:** _"Every indexing run produces a commit-keyed SCIP index artifact from a bare Git object store. Workers never talk to external Git hosts. Parallel branch indexing uses git worktrees — not separate clones. Multi-user workspaces are tracked via Merkle-tree change detection and per-user refs, with incremental re-indexing driven by a file-level dependency DAG. Query resolution across un-indexed commits uses git-diff position adjustment — the same technique Sourcegraph uses at scale."_
>
> **Prerequisites:** [Phase 1 — GitHub Connect & Repo Indexing](./PHASE_1_GITHUB_CONNECT_AND_INDEXING.md), [Phase 5 — Incremental Indexing & GitHub Webhooks](./PHASE_5_INCREMENTAL_INDEXING_AND_GITHUB_WEBHOOKS.md), [Phase 5.6 — CLI-First Onboarding](./PHASE_5.6_CLI_FIRST_ONBOARDING.md)
>
> **Status:** V1 IMPLEMENTED (March 2026) — Sprints 1–7 complete. V2 (AST-Aware DAG) deferred to Future Enhancements.

---

## Table of Contents

- [1. Motivation](#1-motivation)
- [2. The Problem: Ephemeral Worker State](#2-the-problem-ephemeral-worker-state)
- [3. Industry Analysis: How the Best Platforms Solve This](#3-industry-analysis-how-the-best-platforms-solve-this)
- [4. Architecture: Bare Git Object Store + SCIP Index Artifacts](#4-architecture-bare-git-object-store--scip-index-artifacts)
  - [4.1 Core Principle: Separate Code Storage from Intelligence Artifacts](#41-core-principle-separate-code-storage-from-intelligence-artifacts)
  - [4.2 Bare Git Object Store (Internal gitserver — Gitea)](#42-bare-git-object-store-internal-gitserver--gitea)
  - [4.3 Git Worktree-Based Parallel Indexing](#43-git-worktree-based-parallel-indexing)
  - [4.4 SCIP Index Artifacts as the Cache Unit](#44-scip-index-artifacts-as-the-cache-unit)
  - [4.5 Unified Ingestion Gateway](#45-unified-ingestion-gateway)
- [5. Multi-User Workspace Tracking](#5-multi-user-workspace-tracking)
  - [5.1 The Core Model: N Users + 1 Primary Branch + M Tracked Branches](#51-the-core-model-n-users--1-primary-branch--m-tracked-branches)
  - [5.2 Merkle-Tree Change Detection (Cursor Pattern)](#52-merkle-tree-change-detection-cursor-pattern)
  - [5.3 Per-User Incremental Sync](#53-per-user-incremental-sync)
  - [5.4 Branch Tracking (Non-Primary Branches)](#54-branch-tracking-non-primary-branches)
- [6. Query Resolution Across Commits (Visible Uploads Algorithm)](#6-query-resolution-across-commits-visible-uploads-algorithm)
  - [6.1 The Problem: Not Every Commit is Indexed](#61-the-problem-not-every-commit-is-indexed)
  - [6.2 Nearest Indexed Commit + Git Diff Adjustment](#62-nearest-indexed-commit--git-diff-adjustment)
  - [6.3 Pre-Computed Commit Graph](#63-pre-computed-commit-graph)
- [7. Incremental Re-Indexing via File-Level Dependency DAG](#7-incremental-re-indexing-via-file-level-dependency-dag)
  - [7.1 The Insight from rust-analyzer and Sorbet](#71-the-insight-from-rust-analyzer-and-sorbet)
  - [7.2 File Dependency DAG Construction](#72-file-dependency-dag-construction)
  - [7.3 Incremental Pipeline: Diff -> Affected Set -> Partial Re-Index -> Merge](#73-incremental-pipeline-diff---affected-set---partial-re-index---merge)
  - [7.4 Early Cutoff: Signature vs Body Changes](#74-early-cutoff-signature-vs-body-changes)
- [8. Graph Versioning and Branch-Aware Queries](#8-graph-versioning-and-branch-aware-queries)
  - [8.1 Why Overlay Queries Are Not Enough](#81-why-overlay-queries-are-not-enough)
  - [8.2 Version-Tagged Entities with Commit Lineage](#82-version-tagged-entities-with-commit-lineage)
  - [8.3 Delta Documents + Atomic Swap](#83-delta-documents--atomic-swap)
- [9. Scaling](#9-scaling)
- [10. Database & Schema Changes](#10-database--schema-changes)
- [11. Implementation Plan](#11-implementation-plan)
- [12. Security Considerations](#12-security-considerations)
- [13. Migration Path](#13-migration-path)
- [14. Phase Bridges](#14-phase-bridges)
- [15. Files Changed](#15-files-changed)
- [16. Verification](#16-verification)

---

## 1. Motivation

Unerr's indexing pipeline has two separate code ingestion paths:

| Path | How code enters | Where it sits during indexing | Problems |
|------|----------------|------------------------------|----------|
| **GitHub App** | `git clone --depth 1` inside heavy worker | Ephemeral local disk | Slow, rate-limited, non-deterministic retries, worker needs Git |
| **CLI Upload** | `unerr push` -> zip -> Supabase Storage | Supabase bucket, extracted on worker | Already artifact-based, but separate code path |

Five concrete problems:

1. **Non-deterministic retries.** Resume from Stage 5 may re-clone a newer commit than Stages 1-4 used.
2. **External dependency during processing.** Workers call GitHub during indexing — rate limits and outages stall the pool.
3. **Cold-start latency.** Every re-index starts with a full `git clone` (~10-60s).
4. **No multi-branch or multi-user support.** Only the default branch is indexed. No workspace tracking.
5. **Two code paths.** GitHub and CLI repos enter differently, doubling error handling surface.

---

## 2. The Problem: Ephemeral Worker State

### Current Architecture

```
GitHub Push Webhook                          CLI `unerr push`
       |                                           |
       v                                           v
  indexRepoWorkflow                           indexRepoWorkflow
       |                                           |
       +-- git clone --depth 1                     +-- download zip from Supabase Storage
       |   (ephemeral, deleted after pipeline)     |   (extracted to /data/repo-indices/...)
       v                                           v
  [SCIP] -> [Tree-sitter] -> [Finalize] -> [Embed] -> [ArangoDB]
```

### Why Tarballs in Object Storage Are Not Enough

The previous iteration of this design proposed immutable `.tar.gz` artifacts in Supabase Storage. This works for baseline snapshots, but breaks down for multi-user workspace tracking:

**SCIP parsers need the full tree.** They cannot parse 2 changed files in isolation — they need the entire codebase on disk for import resolution, type inference, and call-graph construction.

**Delta chains grow unboundedly.** If each user diffs against their last synced state (not `main`), the system must track per-user delta chains and reconstruct full trees from them. This is rebuilding Git's tree mechanics poorly.

**We should use Git where Git excels** — content-addressed storage, delta compression, branch tracking, concurrent state — and build intelligence artifacts on top.

---

## 3. Industry Analysis: How the Best Platforms Solve This

Before designing our solution, we studied how production code intelligence platforms at scale handle multi-branch, multi-user code analysis.

### Sourcegraph: Bare Git + Commit-Keyed SCIP + Visible Uploads

Sourcegraph's `gitserver` is a **stateful, horizontally-sharded service** storing bare Git clones — not Gitea or any forge. Repos are distributed by modular hashing on the repo name. A singleton `repo-updater` service schedules `git fetch` operations respecting code-host rate limits.

For code intelligence, SCIP indexes are uploaded **keyed by `(repo, commit SHA)`**. The system pre-computes a **visible uploads mapping** for every commit in the repo's DAG. When a query arrives for an un-indexed commit, it finds the nearest indexed ancestor and **uses `git diff` to adjust file paths and line ranges**.

*Sources: [Optimizing a code intelligence commit graph](https://sourcegraph.com/blog/optimizing-a-code-intelligence-commit-graph-part-2), [How gitserver works](https://github.com/sourcegraph/handbook/blob/main/content/departments/engineering/teams/source/how-gitserver-works.md)*

### GitHub Code Navigation: Stack Graphs (File-Incremental by Construction)

GitHub's stack graphs achieve **file-level incrementality by construction**. Each source file produces an isolated subgraph with zero knowledge of other files. Per-file partial paths are cached by file content hash. At query time, all per-file graphs for a commit are loaded and merged — partial paths concatenate across file boundaries.

Since each file's graph is keyed by content hash, the same file appearing in multiple branches produces identical partial paths. Branch navigation is just "load the file hashes for this commit's tree, look up cached partial paths, compose."

*Sources: [Stack Graphs: Name Resolution at Scale](https://arxiv.org/abs/2211.01224), [github/stack-graphs](https://github.com/github/stack-graphs)*

### Sourcebot/Zoekt: Delta Shards + Tombstones

Sourcebot uses **Zoekt** (Google's trigram code search engine). When files change, Zoekt produces **delta shards** containing only changed data. Old shards get "tombstones" marking outdated entries. Periodic **vacuuming** removes tombstoned entries. Multi-branch is handled with per-branch index shards (hard limit: 64 branches/tags per repo).

*Sources: [Zoekt architecture](https://deepwiki.com/sourcegraph/zoekt/1.1-architecture), [Sourcebot multi-branch docs](https://docs.sourcebot.dev/docs/features/search/multi-branch-indexing)*

### Greptile: DAG-Based Codebase Graph + NL Translation

Greptile treats codebases as **directed acyclic graphs**, not file trees. Nodes are functions/classes; edges are calls, imports, and references. The indexing pipeline: parse AST -> recursively generate natural-language docstrings per node -> embed. Function-level chunking with NL translation dramatically outperforms raw code embedding for semantic search.

Uses **Hatchet** (durable workflow engine, like Temporal) for indexing orchestration with resumable steps and fair distribution across workers.

*Sources: [Greptile graph-based context](https://www.greptile.com/docs/how-greptile-works/graph-based-codebase-context), [Hatchet case study](https://hatchet.run/customers/greptile)*

### Cursor: Merkle-Tree Change Detection + AST-Aware Chunking

Cursor computes a **Merkle tree** of cryptographic hashes for all files. Only branches where hashes differ are walked — unchanged subtrees are skipped entirely. Changed files are split into **syntactic chunks using tree-sitter** (AST-aware — respects function/class boundaries). Embeddings are cached by chunk content hash in AWS.

Crucially, the Merkle tree is computed from the **filesystem state**, not from Git refs — so uncommitted changes, new files, and unstaged edits are all captured.

*Sources: [Cursor codebase indexing docs](https://docs.cursor.com/context/codebase-indexing), [Cursor x Turbopuffer](https://turbopuffer.com/customers/cursor)*

### CodeRabbit: Stateless, Ephemeral Clones + Vector Knowledge Graph

CodeRabbit does **not maintain a persistent code store**. Each PR review clones into an ephemeral Cloud Run sandbox, constructs a code dependency graph at review time, and disposes of the code after. The persistent store is **LanceDB** — a vector database of learnings, patterns, and dependency graphs (not source code).

*Sources: [CodeRabbit architecture](https://docs.coderabbit.ai/overview/architecture), [LanceDB case study](https://lancedb.com/blog/case-study-coderabbit/)*

### rust-analyzer + Salsa: File-Level Incremental Analysis

The gold standard for incremental code analysis. Uses **Salsa** — a memoized, dependency-tracked computation framework with **red-green marking** and **early cutoff**: if a derived value's inputs changed but its output is identical, downstream dependents skip recomputation.

Core invariant: **"Typing inside a function body never invalidates global derived data."** Only signature changes propagate.

*Sources: [rust-analyzer architecture](https://rust-analyzer.github.io/book/contributing/architecture.html), [Durable Incrementality](https://rust-analyzer.github.io/blog/2023/07/24/durable-incrementality.html)*

### Synthesis: Patterns We Adopt

| Pattern | Source | What We Build |
|---------|--------|---------------|
| Bare git repos + HTTP RPC | Sourcegraph gitserver | Internal `gitserver` service wrapping bare clones |
| Git worktrees for parallelism | Git core | Ephemeral worktrees per branch/commit for SCIP runs |
| Commit-keyed SCIP artifacts | Sourcegraph code intel | `(repo, commit, root)` as cache key for index artifacts |
| Visible uploads + git-diff adjustment | Sourcegraph | Cross-commit query resolution without indexing every commit |
| Merkle-tree change detection | Cursor | CLI workspace sync — detect changed files without full diff |
| File-level dependency DAG | rust-analyzer/Salsa | Incremental re-indexing: only re-parse affected files |
| Delta shards + tombstones | Zoekt/Sourcebot | Incremental graph updates without full replace |
| DAG-based codebase graph | Greptile | Existing entity graph — add versioning |
| AST-aware chunking | Cursor/Windsurf | Existing tree-sitter pipeline — unchanged |

---

## 4. Architecture: Bare Git Object Store + SCIP Index Artifacts

### 4.1 Core Principle: Separate Code Storage from Intelligence Artifacts

```
Code Storage (bare git)              Intelligence Artifacts (SCIP indexes)
+---------------------------+        +----------------------------------+
| Internal gitserver        |        | Artifact Store (Supabase Storage)|
| /repos/{orgId}/{repoId}/ |        | /scip-indexes/{orgId}/{repoId}/ |
|   .git (bare clone)      | -----> |   {commitSha}.scip.gz           |
|   worktrees/ (ephemeral)  | SCIP   |   {commitSha}.meta.json         |
+---------------------------+ index  +----------------------------------+
                                          |
            ArangoDB <--------------------+  (graph entities derived
            pgvector <--------------------+   from SCIP index)
```

**Code storage** is the bare Git repo — a structured, version-controlled, deduplicated object store. It's the *input*.

**Intelligence artifacts** are SCIP indexes, ArangoDB entities, and vector embeddings — the *output*. These are keyed by `(repo, commit, indexerRoot)` and cached independently of the source code.

This separation means:
- Re-indexing the same commit is a cache hit (SCIP artifact already exists)
- Branch analysis doesn't require re-uploading code — just creating a new worktree
- Workers never touch external Git hosts — only the internal bare clone

### 4.2 Bare Git Object Store (Internal gitserver — Gitea)

> **Implementation note:** Despite the original design calling for a custom thin service, V1 uses **Gitea 1.22-rootless** in headless mode — SSH disabled, registration disabled, UI hidden, SQLite backend. This was a pragmatic decision: Gitea provides a battle-tested Git HTTP smart protocol server, mirror API, and REST API in a single 30 MB Go binary. The adapter (`lib/adapters/gitea-git-server.ts`) wraps both Gitea's REST API (for lifecycle) and direct `git` CLI on the shared data volume (for worktrees/diffs). Gitea is strictly VPC-internal — never exposed to the public internet.

```
/data/repos/
  {orgId}/
    {repoId}.git/              <-- bare clone (git clone --bare)
      objects/                 <-- pack files, loose objects (shared across all refs)
      refs/
        heads/
          main                 <-- primary branch (mirrored from GitHub)
        unerr/
          users/
            {userId}/
              workspace        <-- per-user workspace ref
          branches/
            feature/auth       <-- tracked branch ref
            hotfix/urgent      <-- tracked branch ref
      worktrees/               <-- managed by git worktree (ephemeral)
```

**Why Gitea in headless mode (V1 decision):**

The original design proposed a custom bare-git thin service. V1 chose Gitea 1.22-rootless instead for pragmatic reasons:

| Concern | Custom Thin Service | Gitea Headless (V1 choice) |
|---------|--------------------|-----------------------------|
| Git HTTP protocol | Must implement smart protocol from scratch | Battle-tested, RFC-compliant out of the box |
| Mirror API | Must implement `git fetch --prune` orchestration | `POST /repos/mirrors/sync` + automatic scheduling |
| Webhook delivery | Must build from scratch | Built-in webhook engine (Gitea → unerr API) |
| Maintenance | Custom code to maintain | Community-maintained, security patches |
| RAM overhead | ~5 MB | ~50 MB (SQLite backend, no PostgreSQL needed) |
| Trade-off | Leaner but more work | Slightly heavier but production-ready on day 1 |

**The gitserver port exposes 8 operations:**

```typescript
interface IInternalGitServer {
  // Lifecycle
  ensureCloned(orgId: string, repoId: string, cloneUrl: string): Promise<void>
  syncFromRemote(orgId: string, repoId: string): Promise<string>  // returns HEAD sha

  // Worktree management (for parallel indexing)
  createWorktree(orgId: string, repoId: string, ref: string): Promise<{ path: string; commitSha: string }>
  removeWorktree(path: string): Promise<void>

  // Diff + history
  diffFiles(orgId: string, repoId: string, fromSha: string, toSha: string): Promise<ChangedFile[]>
  resolveRef(orgId: string, repoId: string, ref: string): Promise<string>  // ref -> commit sha

  // Per-user workspace
  pushWorkspaceRef(orgId: string, repoId: string, userId: string, commitSha: string): Promise<void>
}
```

**Deployment:** Runs as a sidecar container on the same host/pod as Temporal heavy workers. Repos live on a persistent volume. If the volume is lost, repos are re-cloned from origin (all data is recoverable).

### 4.3 Git Worktree-Based Parallel Indexing

The key insight: **one bare clone, many simultaneous checkouts**.

```bash
# One-time setup (or background sync)
git clone --bare https://github.com/acme/backend.git /data/repos/org1/repo1.git

# Index main (worktree 1)
git -C /data/repos/org1/repo1.git worktree add --detach /tmp/wt-abc123 main
scip-typescript index --cwd /tmp/wt-abc123 --output /artifacts/org1/repo1/abc123.scip
git -C /data/repos/org1/repo1.git worktree remove /tmp/wt-abc123

# Index feature/auth simultaneously (worktree 2, same bare clone)
git -C /data/repos/org1/repo1.git worktree add --detach /tmp/wt-def456 feature/auth
scip-typescript index --cwd /tmp/wt-def456 --output /artifacts/org1/repo1/def456.scip
git -C /data/repos/org1/repo1.git worktree remove /tmp/wt-def456

# Index user workspace simultaneously (worktree 3, same bare clone)
git -C /data/repos/org1/repo1.git worktree add --detach /tmp/wt-ghi789 refs/unerr/users/user-001/workspace
scip-typescript index --cwd /tmp/wt-ghi789 --output /artifacts/org1/repo1/ghi789.scip
git -C /data/repos/org1/repo1.git worktree remove /tmp/wt-ghi789
```

**Properties that matter for a code intelligence pipeline:**

1. **Single object store.** All worktrees share `/data/repos/org1/repo1.git/objects`. No disk duplication. 10 worktrees indexing 10 branches of a 50 MB repo use ~50 MB of git objects (not 500 MB).
2. **Parallel safety.** Multiple worktrees run SCIP indexers simultaneously. Each has its own working directory, HEAD, and index file. Git operations on the shared object store are safe for concurrent reads.
3. **Ephemeral by default.** Worktrees are created before indexing, destroyed after. No stale state accumulates.
4. **No network I/O.** Creating a worktree is a local filesystem operation — sub-second for any repo size.

### 4.4 SCIP Index Artifacts as the Cache Unit

The output of SCIP indexing — not the source code — is the primary cached artifact.

```
supabase-storage/
  scip-indexes/
    {orgId}/
      {repoId}/
        {commitSha}.scip.gz             <-- protobuf SCIP index (gzipped)
        {commitSha}.meta.json           <-- metadata sidecar
        {commitSha}.depgraph.json       <-- file-level dependency DAG (Section 7)
```

**Cache key:** `(orgId, repoId, commitSha, indexerRoot)`

**`{commitSha}.meta.json`:**

```json
{
  "commitSha": "a1b2c3d4e5f6",
  "ref": "refs/heads/main",
  "indexer": "scip-typescript",
  "indexerVersion": "0.5.0",
  "createdAt": "2026-03-06T12:00:00Z",
  "sizeBytes": 2097152,
  "documentCount": 1247,
  "symbolCount": 28543,
  "indexDurationMs": 14200,
  "incrementalBase": null
}
```

**Why SCIP artifacts, not source tarballs, as the cache unit:**

| Concern | Source Tarballs | SCIP Index Artifacts |
|---------|----------------|---------------------|
| Cache hit semantics | Re-index still needed | Skip SCIP entirely — go straight to graph upload |
| Size | 12-40 MB (full repo) | 1-5 MB (just symbols and relationships) |
| Cross-commit reuse | None (different tree = different tarball) | Visible uploads algorithm reuses across commits |
| Incremental update | Impossible (tarball is opaque blob) | SCIP uses string symbol IDs — partial updates work |
| What Sourcegraph caches | SCIP uploads, not source tarballs | Exactly this |

### 4.5 Unified Ingestion Gateway

A Temporal activity (`ingestSource`) running on `light-llm-queue` normalizes all ingestion paths into the bare git object store:

| Source | Gateway Action |
|--------|----------------|
| **GitHub webhook (any branch)** | `git fetch` on the bare clone. Update ref. If primary branch, also upload immutable tarball to Supabase Storage as backup. |
| **CLI `unerr sync` (workspace)** | CLI pushes a pack file to the unerr API. gitserver writes it to the bare clone under `refs/unerr/users/{userId}/workspace`. |
| **CLI `unerr push` (initial)** | Upload zip to Supabase Storage as bootstrap. gitserver does `git clone --bare` from the provided URL or extracts the zip into a bare repo. |
| **Manual re-index** | No fetch needed if HEAD hasn't moved. Create a worktree from the existing bare clone. |

**After ingestion, the indexing workflow receives a `SourceSpec`:**

```typescript
type SourceSpec = {
  orgId: string
  repoId: string
  commitSha: string
  ref: string                    // e.g., "refs/heads/main", "refs/unerr/users/user-001/workspace"
  baseSha?: string               // for incremental: previous indexed commit
  incrementalHint?: {
    changedFiles: string[]       // from git diff or Merkle-tree comparison
  }
}
```

The heavy worker then:
1. Creates a worktree: `gitserver.createWorktree(orgId, repoId, commitSha)`
2. Checks for cached SCIP artifact: `scip-indexes/{orgId}/{repoId}/{commitSha}.scip.gz`
3. If cache miss: runs SCIP + Tree-sitter, uploads artifact
4. If cache hit: skips indexing, proceeds to graph upload
5. Removes worktree: `gitserver.removeWorktree(path)`

---

## 5. Multi-User Workspace Tracking

### 5.1 The Core Model: N Users + 1 Primary Branch + M Tracked Branches

Consider `acme/backend` with `main` indexed and 10 active users:

```
Bare clone: /data/repos/org1/repo1.git
  refs/
    heads/main                                   <-- primary branch (synced from GitHub)
    unerr/
      users/
        user-001/workspace                       <-- Alice (feature/auth locally)
        user-002/workspace                       <-- Bob (main + uncommitted changes)
        user-003/workspace                       <-- Carol (hotfix/urgent locally)
        ...10 users total
      branches/
        feature/auth                             <-- tracked shared branch
        staging                                  <-- tracked shared branch
```

**Storage reality:** All refs share the same pack files. Git's delta compression makes overhead proportional to *changed files*, not total repo size. 10 users with ~50 changed files each over a 50 MB repo adds ~2-5 MB of git object storage.

### 5.2 Merkle-Tree Change Detection (Cursor Pattern)

Instead of requiring `git push` from the CLI (which needs the user to have committed locally), we adopt Cursor's approach: **compute a Merkle tree from the filesystem state**.

```
CLI (unerr sync) workflow:

1. Scan working directory (respecting .gitignore + .unerrignore)
2. Compute SHA-256 hash per file
3. Build Merkle tree: directory hashes = H(sorted child hashes)
4. Send Merkle tree to unerr API (NOT the files — just hashes)
5. Server compares against stored Merkle tree for this user's last sync
6. Server identifies changed subtrees -> requests only changed files
7. CLI uploads only changed files as a pack
8. gitserver commits the pack to refs/unerr/users/{userId}/workspace
```

**Why Merkle tree, not `git push`:**

| Concern | `git push` | Merkle-tree sync |
|---------|-----------|-----------------|
| Requires git commit | Yes (user must commit locally) | No — captures uncommitted changes |
| Detects new untracked files | No (must be staged) | Yes — scans filesystem |
| Upload efficiency | Git protocol negotiation | Only changed files, identified by hash diff |
| Works without git | No | Yes — works on any directory |
| What Cursor uses | N/A | Exactly this |

**Merkle tree wire format:**

```typescript
type MerkleNode = {
  path: string               // relative path from repo root
  hash: string               // SHA-256 of file content (files) or H(sorted children) (dirs)
  type: "file" | "directory"
  size?: number              // bytes, only for files
  children?: MerkleNode[]    // only for directories
}
```

### 5.3 Per-User Incremental Sync

Each user diffs against their **own last synced state**, not against `main`.

```
Timeline for User Alice:

  Sync 1: Alice syncs workspace (Merkle tree M1, produces commit W1 on her ref)
           -> Full index (first sync = no base)
           -> Store: last_synced_sha = W1, last_merkle_root = M1

  Sync 2: Alice changes 3 files
           -> CLI sends Merkle tree M2
           -> Server: diff M1 vs M2 -> 3 files changed
           -> CLI uploads only 3 files
           -> gitserver: commit W2 on Alice's workspace ref
           -> git diff W1..W2 -> 3 changed files
           -> Incremental re-index (Section 7): only re-parse affected files
           -> Store: last_synced_sha = W2, last_merkle_root = M2

  Sync 3: Alice rebases on latest main@M2, changes 1 file
           -> Merkle tree captures all differences (rebase + new change)
           -> Server diffs against M2 (Alice's last state)
           -> Incremental index of affected files only
```

**The diff is always between the user's consecutive syncs — never a growing chain.**

```sql
CREATE TABLE unerr.workspace_syncs (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          TEXT NOT NULL,
  repo_id         TEXT NOT NULL REFERENCES unerr.repos(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL,
  commit_sha      TEXT NOT NULL,
  base_sha        TEXT,
  file_count      INTEGER NOT NULL DEFAULT 0,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 5.4 Branch Tracking (Non-Primary Branches)

Tracked branches are shared branches that the team cares about (e.g., `staging`, `release/v2`, long-lived feature branches).

When a push webhook arrives for a non-default branch:
1. gitserver does `git fetch` — updates the ref in the bare clone
2. Upserts `branch_refs` row with new commit SHA
3. Checks if SCIP artifact exists for new commit SHA (cache hit = skip indexing)
4. If miss, triggers indexing workflow with `incrementalHint` from `git diff`

```sql
CREATE TABLE unerr.branch_refs (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           TEXT NOT NULL,
  repo_id          TEXT NOT NULL REFERENCES unerr.repos(id) ON DELETE CASCADE,
  branch_name      TEXT NOT NULL,
  head_sha         TEXT NOT NULL,
  last_indexed_sha TEXT,
  last_indexed_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(repo_id, branch_name)
);
```

**Branch tracking vs workspace tracking:**

| Aspect | Branch Tracking | Workspace Tracking |
|--------|----------------|-------------------|
| Scope | Shared across team | Per-user |
| Source | GitHub/GitLab webhooks | CLI `unerr sync` |
| Contains | Committed code only | Uncommitted + staged + new files |
| Change detection | `git fetch` + ref comparison | Merkle-tree diff |
| Retention | 30 days after branch deletion | 30 days after last sync |
| Graph namespace | `scope = "branch/{name}"` | `scope = "workspace/{userId}"` |

---

## 6. Query Resolution Across Commits (Visible Uploads Algorithm)

### 6.1 The Problem: Not Every Commit is Indexed

If `main` has 200 commits since the last indexed commit, we don't want to index all 200. But a user browsing code at the latest `main` HEAD should still get precise code intelligence.

### 6.2 Nearest Indexed Commit + Git Diff Adjustment

This is the technique Sourcegraph uses at production scale:

```
User queries: "Find definition of `authenticate()` at main@HEAD (commit C200)"

1. Look up nearest indexed commit:
   C200 has no SCIP index
   C195 has a SCIP index (5 commits behind)

2. Compute git diff C195..C200:
   - src/auth.ts: line 42 moved to line 47 (5 lines inserted above)
   - src/config.ts: unchanged

3. Adjust the query position:
   User asked about line 42 in C200
   git diff says C195:line 37 -> C200:line 42
   So query the C195 SCIP index at line 37

4. Execute query on C195 SCIP index -> find definition

5. Reverse-adjust the result positions back to C200 coordinates
```

**This eliminates the need to index every commit.** We only index:
- Every push to `main` (or every Nth push for high-frequency repos)
- First sync per user workspace
- Incremental updates on subsequent syncs

### 6.3 Pre-Computed Commit Graph

For constant-time lookups, we pre-compute and cache the mapping:

```sql
CREATE TABLE unerr.nearest_indexed_commits (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id     TEXT NOT NULL REFERENCES unerr.repos(id) ON DELETE CASCADE,
  commit_sha  TEXT NOT NULL,
  nearest_sha TEXT NOT NULL,           -- closest commit with a SCIP index
  distance    INTEGER NOT NULL,        -- graph distance (number of commits)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(repo_id, commit_sha)
);
```

When a new SCIP index is uploaded, a background job walks the commit graph and updates `nearest_indexed_commits` for all reachable commits. Sourcegraph optimizes this further with `lsif_nearest_uploads_links` — for linear history segments, a single pointer to the nearest ancestor avoids per-commit storage.

---

## 7. Incremental Re-Indexing via File-Level Dependency DAG

> **V1 Implementation Note:** V1 uses a simplified incremental strategy: **full SCIP re-index + delta-only graph writes**. Instead of partial SCIP indexing on an affected file set (Sections 7.2–7.4), V1 runs a full SCIP index on the workspace/branch worktree, then uses `computeEntityDelta()` to diff the new entities against the existing graph and writes only the changed/added/removed entities. This avoids the complexity of partial SCIP merge and file-level dependency DAG construction while still achieving the key benefit: **minimal graph writes per sync**. The full DAG-based partial re-indexing described below is a V2 optimization.

### 7.1 The Insight from rust-analyzer and Sorbet

Full SCIP re-indexing of a 50 MB TypeScript repo takes 15-60 seconds. But when a user changes 3 files, re-indexing the entire project is wasteful.

rust-analyzer's core invariant: **"Typing inside a function body never invalidates global derived data."** Only signature changes (function parameters, return types, class interfaces) propagate to dependents.

We adopt a simpler version for our pipeline: **file-level dependency tracking with early cutoff**.

### 7.2 File Dependency DAG Construction

During each full SCIP indexing run, we extract a file-level dependency graph from the SCIP index:

```typescript
// Extracted from SCIP Document relationships
type FileDependencyDAG = {
  // file -> set of files it imports from
  imports: Record<string, Set<string>>
  // file -> set of files that import from it
  dependents: Record<string, Set<string>>
  // file -> hash of its exported symbol signatures (not bodies)
  signatureHashes: Record<string, string>
}
```

The DAG is stored alongside the SCIP artifact: `{commitSha}.depgraph.json`.

**Example for a TypeScript project:**

```json
{
  "imports": {
    "src/auth/service.ts": ["src/auth/types.ts", "src/db/client.ts", "src/config.ts"],
    "src/api/routes.ts": ["src/auth/service.ts", "src/middleware.ts"]
  },
  "dependents": {
    "src/auth/types.ts": ["src/auth/service.ts", "src/auth/middleware.ts"],
    "src/auth/service.ts": ["src/api/routes.ts", "src/api/admin.ts"]
  },
  "signatureHashes": {
    "src/auth/service.ts": "sha256:abc123",
    "src/auth/types.ts": "sha256:def456"
  }
}
```

### 7.3 Incremental Pipeline: Diff -> Affected Set -> Partial Re-Index -> Merge

```
Input: changedFiles = ["src/auth/types.ts", "src/utils/format.ts"]

Step 1: Compute affected set
  - src/auth/types.ts changed -> check its dependents:
    - src/auth/service.ts (imports types.ts)
    - src/auth/middleware.ts (imports types.ts)
  - src/utils/format.ts changed -> check its dependents:
    - src/api/response.ts (imports format.ts)

  affectedSet = {
    "src/auth/types.ts",     // directly changed
    "src/utils/format.ts",   // directly changed
    "src/auth/service.ts",   // depends on types.ts
    "src/auth/middleware.ts", // depends on types.ts
    "src/api/response.ts"    // depends on format.ts
  }

Step 2: Create worktree at new commit

Step 3: Run SCIP on affected files only
  scip-typescript index --files src/auth/types.ts src/auth/service.ts ...

Step 4: Merge partial SCIP into base index
  - Replace SCIP Documents for affected files
  - Keep SCIP Documents for unaffected files from base index
  - Upload merged index as new artifact

Step 5: Apply early cutoff (Section 7.4)
```

### 7.4 Early Cutoff: Signature vs Body Changes

After partial re-indexing, compare the **exported symbol signatures** of changed files:

```
Before: src/auth/types.ts exported AuthUser { id: string, email: string }
After:  src/auth/types.ts exported AuthUser { id: string, email: string, role: Role }

Signature CHANGED -> propagate to dependents (service.ts, middleware.ts must also re-index)
```

```
Before: src/utils/format.ts exported formatDate(d: Date): string
After:  src/utils/format.ts exported formatDate(d: Date): string  (body changed, signature same)

Signature UNCHANGED -> early cutoff! Skip dependents of format.ts
```

This reduces the affected set dynamically. In practice, most edits are body changes (implementing logic, fixing bugs), not signature changes (adding parameters, changing types). The early cutoff skips 70-90% of dependent re-indexing.

**Performance impact:**

| Scenario | Full Re-Index | Incremental (no cutoff) | Incremental (with cutoff) |
|----------|--------------|------------------------|--------------------------|
| 3 files changed, body only | 45s | 8s (3 files + dependents) | 2s (3 files only) |
| 1 file changed, signature | 45s | 12s (1 file + all dependents) | 12s (no cutoff possible) |
| 50 files changed (rebase) | 45s | 30s | 15-25s |

---

## 8. Graph Versioning and Branch-Aware Queries

### 8.1 Why Overlay Queries Are Not Enough

The naive approach — storing branch entities as overlays on `main` with `FILTER e.branch_ref == @ref OR e.branch_ref == null` — has three problems:

1. **Query complexity.** Every query needs a fallback chain. Deeply nested graph traversals (entity -> edges -> related entities) require the overlay check at each hop. This compounds query latency.
2. **Consistency.** An entity might exist in the overlay with updated edges pointing to entities that only exist in the base layer. The overlay model doesn't guarantee referential integrity across layers.
3. **No platform does this.** Sourcegraph uses commit-keyed SCIP uploads. GitHub uses content-addressed per-file graphs. Zoekt uses per-branch index shards. None use an overlay pattern on a shared graph.

### 8.2 Version-Tagged Entities with Commit Lineage

We adopt a **scoped entity model** — entities carry a `scope` tag indicating which branch/workspace they belong to:

```typescript
type EntityScope =
  | { type: "primary" }                          // main branch (default, backward-compatible)
  | { type: "branch"; name: string }             // e.g., "feature/auth"
  | { type: "workspace"; userId: string }        // e.g., "user-001"
```

**ArangoDB entity document:**

```json
{
  "_key": "fn-authenticate-abc123",
  "kind": "function",
  "name": "authenticate",
  "file_path": "src/auth/service.ts",
  "repo_id": "repo-001",
  "scope": "primary",
  "commit_sha": "abc123",
  "start_line": 42,
  "end_line": 78
}
```

For a branch variant, the same entity gets a **separate document** with a different scope:

```json
{
  "_key": "fn-authenticate-def456-branch-feature-auth",
  "kind": "function",
  "name": "authenticate",
  "file_path": "src/auth/service.ts",
  "repo_id": "repo-001",
  "scope": "branch:feature/auth",
  "commit_sha": "def456",
  "start_line": 47,
  "end_line": 85
}
```

**Query strategy — scope-first filtering:**

```aql
// Query entities for a specific scope
FOR e IN org_{orgId}_functions
  FILTER e.repo_id == @repoId
  FILTER e.scope == @scope
  RETURN e

// If scope has no result, fall back to primary (done in application layer, not AQL)
```

The fallback logic lives in `arango-graph-store.ts`, not in AQL. This keeps queries simple and lets us add caching at the application layer.

### 8.3 Delta Documents + Atomic Swap

When a branch is re-indexed:

1. **Compute delta:** Compare new SCIP index against the base (primary) SCIP index. Identify added, modified, and deleted entities.
2. **Write delta atomically:** Use ArangoDB's multi-document transaction to:
   - Insert/update branch-scoped entities for additions and modifications
   - Insert tombstone markers for deleted entities (entity exists in primary but not in branch)
   - Delete stale branch-scoped entities from the previous index
3. **Mark as active:** Update `branch_refs.indexed_at` to indicate the branch graph is ready.

**Tombstone document:**

```json
{
  "_key": "tombstone-fn-oldHelper-branch-feature-auth",
  "kind": "tombstone",
  "original_key": "fn-oldHelper-abc123",
  "repo_id": "repo-001",
  "scope": "branch:feature/auth",
  "commit_sha": "def456"
}
```

When querying a branch scope, tombstoned entities are excluded from the primary fallback.

---

## 9. Scaling

### Code Storage (Bare Git Repos)

| Scale | Repos | Avg Bare Clone | Users/Repo | Git Overhead/User | Total Storage |
|-------|-------|---------------|------------|-------------------|---------------|
| Startup | 50 | 15 MB | 3 | ~0.5 MB | ~825 MB |
| Growth | 500 | 20 MB | 5 | ~1 MB | ~12.5 GB |
| Scale | 5,000 | 30 MB | 10 | ~2 MB | ~250 GB |
| Enterprise | 50,000 | 40 MB | 15 | ~3 MB | ~4.25 TB |

### SCIP Index Artifacts (Supabase Storage)

| Scale | Repos | Avg SCIP Index | Indexed Commits/Repo | Total Storage |
|-------|-------|---------------|---------------------|---------------|
| Startup | 50 | 2 MB | 3 | 300 MB |
| Growth | 500 | 3 MB | 5 | 7.5 GB |
| Scale | 5,000 | 4 MB | 8 | 160 GB |
| Enterprise | 50,000 | 5 MB | 10 | 2.5 TB |

SCIP indexes are 5-10x smaller than source tarballs because they contain only symbol information, not file contents.

### Eviction Policy

| Artifact Type | Retention | Reason |
|---------------|-----------|--------|
| SCIP index for latest primary commit | Forever | Always needed for queries |
| SCIP index for older primary commits | 30 days | Kept for visible-uploads resolution |
| SCIP index for workspace commits | 7 days after last sync | Ephemeral by nature |
| SCIP index for tracked branches | 30 days after branch deletion | Clean up stale branches |
| Bare git repo | Forever (gc'd) | Re-clonable from origin if lost |
| Workspace refs | 30 days after last sync | Prune inactive users |

### Worker Parallelism

```
One repo with 10 users + 3 tracked branches:

Without worktrees: 14 separate git clones = 14 * 50 MB = 700 MB disk, 14 * 10s clone time
With worktrees:    1 bare clone + 14 worktrees = 50 MB shared objects + 14 * 50 MB working trees
                   But worktrees are ephemeral — only 3-4 active at a time (worker pool size)
                   Effective: 50 MB persistent + 150-200 MB ephemeral peak
```

---

## 10. Database & Schema Changes

### PostgreSQL (Prisma)

**New table: `unerr.scip_indexes`**

> **V1 simplification:** The schema is leaner than originally designed. Fields like `scope`, `indexer_version`, `document_count`, `symbol_count`, `index_duration_ms`, and `incremental_base` were dropped. Instead, `indexer_root` distinguishes sub-projects (monorepo roots), and `language_stats` (JSON) captures per-language metadata.

```sql
CREATE TABLE unerr.scip_indexes (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          TEXT NOT NULL,
  repo_id         TEXT NOT NULL REFERENCES unerr.repos(id) ON DELETE CASCADE,
  commit_sha      TEXT NOT NULL,
  indexer_root    TEXT NOT NULL DEFAULT '.',
  storage_path    TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL DEFAULT 0,
  language_stats  JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(repo_id, commit_sha, indexer_root)
);

CREATE INDEX idx_scip_indexes_repo ON unerr.scip_indexes(org_id, repo_id);
```

**New table: `unerr.nearest_indexed_commits`**

```sql
CREATE TABLE unerr.nearest_indexed_commits (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      TEXT NOT NULL,
  repo_id     TEXT NOT NULL REFERENCES unerr.repos(id) ON DELETE CASCADE,
  query_sha   TEXT NOT NULL,
  nearest_sha TEXT NOT NULL,
  distance    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(repo_id, query_sha)
);

CREATE INDEX idx_nearest_commits_repo ON unerr.nearest_indexed_commits(org_id, repo_id);
```

**New table: `unerr.branch_refs`**

> **V1 refinement:** Tracks both `head_sha` (latest push) and `last_indexed_sha` (latest successful index) separately, enabling accurate staleness detection.

```sql
CREATE TABLE unerr.branch_refs (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           TEXT NOT NULL,
  repo_id          TEXT NOT NULL REFERENCES unerr.repos(id) ON DELETE CASCADE,
  branch_name      TEXT NOT NULL,
  head_sha         TEXT NOT NULL,
  last_indexed_sha TEXT,
  last_indexed_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(repo_id, branch_name)
);

CREATE INDEX idx_branch_refs_repo ON unerr.branch_refs(org_id, repo_id);
```

**New table: `unerr.workspace_syncs`**

> **V1 simplification:** The Merkle-tree wire format from §5.2 was replaced by isomorphic-git's native `statusMatrix` — there is no `merkle_root_hash` or `workspace_ref` column. Instead, each sync creates a new row (no unique constraint on `user_id`) enabling sync history tracking. `file_count` records the number of files in the workspace at sync time.

```sql
CREATE TABLE unerr.workspace_syncs (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          TEXT NOT NULL,
  repo_id         TEXT NOT NULL REFERENCES unerr.repos(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL,
  commit_sha      TEXT NOT NULL,
  base_sha        TEXT,
  file_count      INTEGER NOT NULL DEFAULT 0,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_workspace_syncs_repo ON unerr.workspace_syncs(org_id, repo_id, user_id);
CREATE INDEX idx_workspace_syncs_latest ON unerr.workspace_syncs(repo_id, user_id, synced_at DESC);
```

**Modified table: `unerr.repos`**

```sql
ALTER TABLE unerr.repos ADD COLUMN branch_tracking_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE unerr.repos ADD COLUMN workspace_tracking_enabled BOOLEAN NOT NULL DEFAULT false;
```

### ArangoDB

**Modified entity documents** — add fields:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `scope` | `string` | `"primary"` | `"primary"`, `"branch:{name}"`, or `"workspace:{userId}"` |
| `commit_sha` | `string \| null` | `null` | Commit SHA from which this entity was extracted |

**New index:** Compound index on `(repo_id, scope)` for scope-filtered queries.

### Supabase Storage

**New bucket: `scip-indexes`** (replaces the previously proposed `source-artifacts` bucket)

- Access: Private (service role only)
- Path pattern: `{orgId}/{repoId}/{commitSha}.scip.gz`
- Metadata sidecar: `{orgId}/{repoId}/{commitSha}.meta.json`
- Dependency graph: `{orgId}/{repoId}/{commitSha}.depgraph.json`

---

## 11. Implementation Plan

> **V1 Status: COMPLETE.** See [PHASE_13_IMPLEMENTATION_PLAN.md](./PHASE_13_IMPLEMENTATION_PLAN.md) for the detailed task-level breakdown with completion status.

### Phase 13a: Internal gitserver + SCIP Artifact Pipeline — ✅ COMPLETE

| Task | Description | Layer | Status |
|------|-------------|-------|--------|
| **GS-01** | `IInternalGitServer` port interface (8 methods including `deleteRef`) | Ports | ✅ |
| **GS-02** | Gitea-backed adapter (`lib/adapters/gitea-git-server.ts`) — REST API + git CLI on shared volume | Adapters | ✅ |
| **GS-03** | Gitea 1.22-rootless in Docker Compose (headless, internal network, persistent volume) | Infrastructure | ✅ |
| **GS-04** | `scip-indexes` Supabase Storage bucket | Infrastructure | ✅ |
| **GS-05** | 4 Prisma models + 2 repo columns | Database | ✅ |
| **GS-06** | `ingestSource` activity (GitHub mirror-sync + CLI HEAD resolution) | `light-llm-queue` | ✅ |
| **GS-07** | Worktree-based indexing with `try/finally` cleanup | `heavy-compute-queue` | ✅ |
| **GS-08** | SCIP artifact cache check/upload (inline in indexing-heavy) | `heavy-compute-queue` | ✅ |
| **GS-09** | `indexRepoWorkflow` with SourceSpec-based input and scope parameter | Workflow | ✅ |
| **GS-10** | Three-phase artifact eviction cron (SCIP + branches + workspaces) | Temporal | ✅ |

### Phase 13b: Multi-User Workspace Tracking — ✅ CORE COMPLETE

| Task | Description | Layer | Status |
|------|-------------|-------|--------|
| **WS-01** | `unerr sync` with isomorphic-git (separate `.unerr/git/` gitdir) | CLI | ✅ |
| **WS-02** | Gitea webhook receiver + `syncWorkspaceWorkflow` trigger | API | ✅ |
| **WS-03** | Per-user incremental workspace workflow (full SCIP + delta-only writes) | Workflow | ✅ |
| **WS-04** | Entity delta computation (`computeEntityDelta`) | Indexer | ✅ |
| **WS-05** | Early cutoff — deferred to V2 (signature hash comparison) | — | ⏳ V2 |
| **WS-06** | Workspace status dashboard | Frontend | ⏳ Deferred |
| **WS-07** | Workspace ref + artifact pruning (Gitea ref deletion + ArangoDB cleanup) | Temporal | ✅ |

### Phase 13c: Branch Tracking + Cross-Commit Queries — ✅ CORE COMPLETE

| Task | Description | Layer | Status |
|------|-------------|-------|--------|
| **BR-01** | Non-default-branch webhook handling (mirror-sync + scoped indexing) | API | ✅ |
| **BR-02** | Visible uploads (nearest indexed commit lookup with git rev-list walk) | Adapters | ✅ |
| **BR-03** | Git-diff position adjustment — deferred to V2 | Adapters | ⏳ V2 |
| **BR-04** | Commit graph pre-computation activity | Temporal | ✅ |
| **BR-05** | Branch picker UI | Frontend | ✅ |
| **BR-06** | MCP tools with `scope`/`branch` parameter + scope-resolver | MCP | ✅ |

### Phase 13d: Graph Versioning + Delta Documents — ✅ COMPLETE

| Task | Description | Layer | Status |
|------|-------------|-------|--------|
| **GV-01** | `scope` + `commit_sha` fields on EntityDoc/EdgeDoc + EntityDelta type | Types | ✅ |
| **GV-02** | `queryEntitiesWithScope` with 4-step merge (scoped → primary → tombstones → merge) | Adapters | ✅ |
| **GV-03** | `computeEntityDelta` (identity-keyed, shallow content comparison) | Indexer | ✅ |
| **GV-04** | `applyBranchDelta` (atomic write of entities + tombstones + edges) | Adapters | ✅ |
| **GV-05** | Tombstone documents with `kind: "tombstone"` + `original_key` | Adapters | ✅ |

### Phase 13e: CLI Unification — ✅ COMPLETE

| Task | Description | Layer | Status |
|------|-------------|-------|--------|
| **CU-01** | `unerr push` bootstraps Gitea repo via API proxy | CLI | ✅ |
| **CU-02** | `unerr sync --watch` with chokidar (2s debounce, graceful shutdown) | CLI | ✅ |
| **CU-03** | Pack-file generation (native isomorphic-git `push()`) | CLI | ✅ |

---

## 12. Security Considerations

| Concern | Mitigation |
|---------|------------|
| **Source code on gitserver disk** | gitserver runs on the same host as Temporal workers (already trusted with source code). Persistent volume is encrypted at rest. No public network exposure. |
| **SCIP indexes in Supabase Storage** | Private bucket, service-role-only access. SCIP indexes contain symbol names and file paths but NOT file contents — lower risk than storing source. |
| **CLI -> gitserver auth** | CLI never talks to gitserver directly. Workspace syncs go through the unerr API, which validates the session token and restricts writes to the user's own ref namespace. |
| **Multi-tenant isolation** | Bare repos namespaced by `{orgId}/{repoId}`. gitserver validates org membership before any operation. Worktrees are ephemeral and per-workflow. |
| **Merkle tree privacy** | Merkle trees contain file paths and content hashes only — no file contents. Used for change detection, never stored long-term. |
| **Secrets in source code** | Secret scanner runs during SCIP indexing (same as today). Flagged in metadata. |
| **Data residency** | gitserver, Supabase, and ArangoDB deployed in the same region. For EU customers, all three run in EU. |

---

## 13. Migration Path

> **V1 status:** Steps 1–8 complete. Step 9 (removing old clone path) pending full production validation.

1. ✅ **Deploy Gitea** (GS-02, GS-03) — Docker Compose, internal network, persistent volume.
2. ✅ **Dual-mode ingestion** (GS-06, GS-07) — `ingestSource` handles both GitHub mirror-sync and CLI HEAD resolution.
3. ✅ **Backfill bare clones** — existing repos mirror-synced to Gitea on next indexing run.
4. ⏳ **Flip the flag** — old ephemeral clone path still present as fallback; to be removed after production soak.
5. ✅ **SCIP artifact caching** (GS-08) — inline cache check/upload in `indexing-heavy.ts`.
6. ✅ **Workspace tracking** (WS-01 through WS-07) — CLI sync + webhook + delta workflow.
7. ✅ **Branch tracking + visible uploads** (BR-01 through BR-06) — scoped indexing + nearest commit lookup.
8. ✅ **Graph versioning** (GV-01 through GV-05) — scope-first queries + tombstones + atomic delta writes.
9. ⏳ **Remove old clone path** — pending production soak period.

**Zero downtime. No data migration.** Bare clones and SCIP artifacts are additive. ArangoDB entities get a new `scope` field defaulting to `"primary"` — all existing queries continue to work.

---

## 14. Phase Bridges

| From This Phase | To | Connection |
|----------------|-----|------------|
| **13a** (gitserver) | **Phase 5** (Incremental) | Incremental indexing uses `gitserver.diffFiles()` instead of `git pull` on ephemeral worker disk |
| **13b** (Workspaces) | **Phase 7** (PR Reviews) | PR review workflow creates a worktree from the PR branch, diffs SCIP index against main |
| **13c** (Visible Uploads) | **Phase 5** (Branch Shadow Graph) | Cross-commit query resolution replaces the planned branch shadow graph |
| **13d** (Graph Versioning) | **Phase 12** (Multiplayer) | Per-user scoped entities feed collision detection (two users modifying the same entity) |
| **13e** (CLI) | **Phase 5.6** (CLI-First) | `unerr sync` with Merkle-tree replaces the current `unerr push` zip upload |
| **13** (overall) | **Phase 15** (Local-First) | Future: SCIP runs locally on user machine, only SCIP index uploaded. gitserver becomes optional for workspace tracking. |

---

## 15. Files Changed

> **Updated March 2026** to reflect actual V1 implementation.

### New Files

```
lib/ports/internal-git-server.ts             -- IInternalGitServer port (8 methods incl. deleteRef)
lib/adapters/gitea-git-server.ts             -- Gitea-backed adapter (REST API + git CLI on shared volume)
lib/temporal/activities/ingest-source.ts     -- Source ingestion activity (GitHub mirror-sync + CLI HEAD)
lib/temporal/activities/workspace-sync.ts    -- workspaceDiff + workspaceReindex activities
lib/temporal/activities/commit-graph.ts      -- preComputeCommitGraph activity
lib/temporal/activities/artifact-eviction.ts -- SCIP + branch ref eviction activities
lib/temporal/workflows/sync-workspace.ts     -- User workspace sync workflow (diff → reindex → delta)
lib/temporal/workflows/evict-artifacts.ts    -- Three-phase eviction cron (SCIP + branches + workspaces)
lib/temporal/workflows/commit-graph-update.ts -- Child workflow for commit graph pre-computation
lib/indexer/incremental-merge.ts             -- computeEntityDelta (identity-keyed, shallow content hash)
lib/indexer/commit-graph.ts                  -- findNearestIndexedCommit + preComputeNearestIndexed
lib/mcp/tools/scope-resolver.ts              -- resolveScope() for MCP tool queries
app/api/git/[...slug]/route.ts               -- Git HTTP smart protocol proxy (API key auth)
app/api/webhooks/gitea/route.ts              -- Gitea webhook receiver (HMAC-SHA256 + workspace sync trigger)
packages/cli/src/commands/sync.ts            -- unerr sync CLI (isomorphic-git, .unerr/git/ gitdir, chokidar watch)
scripts/register-temporal-schedules.ts       -- Temporal ScheduleClient registration (eviction cron)
```

### Modified Files

```
lib/temporal/activities/indexing-heavy.ts     -- Worktree-based indexing + SCIP cache check/upload (inline)
lib/temporal/activities/indexing-light.ts     -- SourceSpec-based input handling
lib/temporal/workflows/index-repo.ts          -- SourceSpec input + scope parameter + commit graph child workflow
lib/adapters/arango-graph-store.ts            -- queryEntitiesWithScope, applyBranchDelta, deleteScopedEntities, tombstones
lib/di/container.ts                           -- Register IInternalGitServer + gitea adapter
lib/di/fakes.ts                               -- FakeInternalGitServer (in-memory ref map + file store)
lib/ports/types.ts                            -- EntityDelta type, scope/commit_sha on EntityDoc/EdgeDoc
prisma/schema.prisma                          -- ScipIndex, BranchRef, WorkspaceSync, NearestIndexedCommit models
packages/cli/src/commands/push.ts             -- Bootstrap Gitea repo via API proxy
docker-compose.yml                            -- Gitea 1.22-rootless service (internal network, persistent volume)
```

### Not Created (V1 Design Simplifications)

```
lib/temporal/activities/scip-artifact.ts      -- Folded inline into indexing-heavy.ts
lib/indexer/dependency-dag.ts                 -- V2 (DAG-based partial re-indexing deferred)
lib/indexer/position-adjust.ts                -- V2 (git-diff position adjustment deferred)
app/(dashboard)/repos/[repoId]/workspaces/    -- Deferred (workspace status dashboard)
```

---

## 16. Verification

> **V1 verification status** — items marked ✅ are implemented and verified. Items marked ⏳ are deferred to V2.

### Phase 13a (gitserver + SCIP Artifacts)

- [x] `pnpm build` succeeds
- [x] GitHub repo indexing mirrors to Gitea bare clone (not ephemeral clone on worker)
- [x] Worktree created for indexing, destroyed after pipeline completes (`try/finally`)
- [x] SCIP index artifact uploaded to `scip-indexes/{orgId}/{repoId}/{sha}.scip.gz`
- [x] Re-index of same commit is a SCIP cache hit (no SCIP re-run, straight to graph upload)
- [x] Gitea is not accessible from public network (Docker internal network only)
- [x] Pipeline retry downloads the same SCIP artifact (deterministic)
- [x] Eviction cron prunes SCIP artifacts older than 30-day retention

### Phase 13b (Workspace Tracking)

- [x] `unerr sync` uses isomorphic-git with separate `.unerr/git/` gitdir
- [x] Workspace sync triggers `syncWorkspaceWorkflow` via Gitea webhook
- [x] Full SCIP re-index + `computeEntityDelta` for delta-only graph writes
- [ ] ⏳ File-level dependency DAG for partial re-indexing (V2)
- [ ] ⏳ Early cutoff via signature hash comparison (V2)
- [x] Per-user workspace refs with no lock contention
- [x] Inactive workspace refs pruned by eviction cron

### Phase 13c (Branch Tracking + Visible Uploads)

- [x] Push to non-default branch triggers mirror-sync + scoped indexing
- [x] Query on un-indexed commit resolves to nearest indexed ancestor (`findNearestIndexedCommit`)
- [ ] ⏳ Git-diff position adjustment for line-accurate cross-commit queries (V2)
- [x] `nearest_indexed_commits` table populated by `preComputeNearestIndexed` after SCIP upload
- [x] MCP tools accept `branch`/`scope` parameter via `resolveScope()`

### Phase 13d (Graph Versioning)

- [x] Branch-scoped entities stored separately from primary entities
- [x] Primary-scope queries return the same results as before (backward compatible)
- [x] `queryEntitiesWithScope` falls back to primary for unmodified entities
- [x] Tombstone documents correctly exclude deleted entities from branch views
- [x] `applyBranchDelta` writes entities + tombstones + edges atomically

### Phase 13e (CLI Unification)

- [x] `unerr push` bootstraps Gitea repo via API proxy
- [x] `unerr sync --watch` detects file changes via chokidar (2s debounce, graceful shutdown)
- [x] CLI communicates through unerr API only (never directly to Gitea)

---

## 17. Implementation Reality Checks

> **V1 status:** All three hurdles were addressed during implementation. Notes below reflect the V1 solutions chosen.

### 17.1 The Merkle-Tree to Git Commit Bridge

**Original concern:** Generating valid Git pack files from the CLI without native Git was difficult.

**V1 solution:** Instead of a custom Merkle-tree protocol, the CLI uses **isomorphic-git** — a pure JavaScript Git implementation. The CLI maintains a separate gitdir at `.unerr/git/` (avoiding conflicts with the user's `.git/`), uses `statusMatrix` to detect changed/staged/untracked files, commits them locally, and pushes via native `isomorphic-git.push()` through the Git HTTP smart protocol proxy (`app/api/git/[...slug]/route.ts`). The proxy validates API keys and forwards to Gitea. This approach gives us real Git commits with zero native dependencies.

### 17.2 ArangoDB Multi-Hop Scope Fallbacks

The graph versioning strategy (Section 8) correctly relies on scope-first queries with application-layer fallback. This works for 1-hop queries ("find the definition of X"), but deep dependency traversals ("find all functions that call a function that calls X") require pulling massive edge sets into memory to resolve scope at each hop.

**The fix:** For traversals deeper than 2 hops, use a **pre-materialized traversal approach**:

1. **Option A: ArangoDB Foxx Microservice** — deploy a custom server-side function that handles scope fallback natively within the database engine, avoiding network round-trips per hop.
2. **Option B: Scope-aware AQL with PRUNE** — use ArangoDB's `PRUNE` clause to short-circuit traversal branches that hit tombstones, keeping the traversal in-database:

```aql
FOR v, e, p IN 1..5 OUTBOUND @startVertex calls
  OPTIONS { uniqueVertices: "path" }
  FILTER v.repo_id == @repoId
  // Prefer scoped entity, fall through to primary
  LET scopedEntity = FIRST(
    FOR s IN org_{orgId}_functions
      FILTER s._key == v._key AND s.scope == @scope
      RETURN s
  )
  LET resolvedEntity = scopedEntity != null ? scopedEntity : v
  PRUNE resolvedEntity.kind == "tombstone"
  FILTER resolvedEntity.kind != "tombstone"
  RETURN resolvedEntity
```

3. **Option C: Materialized branch views** — for frequently-queried branches, pre-compute a merged entity set (primary + branch deltas) and store it as a temporary collection. Query the merged collection directly. Invalidated on next sync.

The right choice depends on query frequency: Option B for ad-hoc queries, Option C for active workspaces with sub-second query requirements.

### 17.3 Detecting Signature vs Body Changes in SCIP

**Original concern:** Early cutoff (Section 7.4) requires knowing if a file's exported signature changed, but SCIP doesn't natively expose an "AST hash of the public signature."

**V1 status: Deferred.** V1 uses `computeEntityDelta()` with shallow content hashing at the entity level (not file-signature level). This catches all changes but doesn't distinguish signature-only vs body-only changes, meaning dependents are always re-evaluated. The full signature-hash early cutoff described below remains the V2 plan:

```typescript
function computeSignatureHash(scipDocument: ScipDocument): string {
  const exportedSymbols = scipDocument.symbols
    .filter(s => s.relationships.some(r => r.isDefinition))
    .map(s => ({
      symbol: s.symbol,
      relationships: s.relationships
        .filter(r => r.isDefinition || r.isReference)
        .sort((a, b) => a.symbol.localeCompare(b.symbol))
    }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
  return sha256(JSON.stringify(exportedSymbols))
}
```

---

## References

- [Sourcegraph: How gitserver works](https://github.com/sourcegraph/handbook/blob/main/content/departments/engineering/teams/source/how-gitserver-works.md)
- [Sourcegraph: Optimizing a code intelligence commit graph](https://sourcegraph.com/blog/optimizing-a-code-intelligence-commit-graph-part-2)
- [Sourcegraph: SCIP Design](https://github.com/sourcegraph/scip/blob/main/DESIGN.md)
- [GitHub: Stack Graphs — Name Resolution at Scale](https://arxiv.org/abs/2211.01224)
- [Zoekt architecture](https://deepwiki.com/sourcegraph/zoekt/1.1-architecture)
- [Sourcebot multi-branch indexing](https://docs.sourcebot.dev/docs/features/search/multi-branch-indexing)
- [Greptile: Graph-based codebase context](https://www.greptile.com/docs/how-greptile-works/graph-based-codebase-context)
- [Cursor: Secure codebase indexing](https://cursor.com/blog/secure-codebase-indexing)
- [Cursor x Turbopuffer](https://turbopuffer.com/customers/cursor)
- [CodeRabbit architecture](https://docs.coderabbit.ai/overview/architecture)
- [rust-analyzer architecture](https://rust-analyzer.github.io/book/contributing/architecture.html)
- [Salsa: Durable Incrementality](https://rust-analyzer.github.io/blog/2023/07/24/durable-incrementality.html)
- [Roslyn Incremental Generators](https://github.com/dotnet/roslyn/blob/main/docs/features/incremental-generators.md)
- [Hatchet x Greptile case study](https://hatchet.run/customers/greptile)
- [Git worktree documentation](https://git-scm.com/docs/git-worktree)
