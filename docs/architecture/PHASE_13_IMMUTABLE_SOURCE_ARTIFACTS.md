# Phase 13 — Immutable Source Artifacts: Decoupling Code Storage from Processing

> **Phase Feature Statement:** _"Every indexing run pulls code from the same internal artifact store — whether the repo came from GitHub, GitLab, or a local CLI push. Workers never talk to external Git hosts. Retries produce identical results. Branch and workspace variants are first-class citizens indexed from content-addressed tarballs."_
>
> **Prerequisites:** [Phase 1 — GitHub Connect & Repo Indexing](./PHASE_1_GITHUB_CONNECT_AND_INDEXING.md) (git clone pipeline, entity extraction), [Phase 5 — Incremental Indexing & GitHub Webhooks](./PHASE_5_INCREMENTAL_INDEXING_AND_GITHUB_WEBHOOKS.md) (webhook pipeline, persistent workspace), [Phase 5.6 — CLI-First Onboarding](./PHASE_5.6_CLI_FIRST_ONBOARDING.md) (CLI zip upload to Supabase Storage)
>
> **Status:** Proposed (March 2026)

---

## Table of Contents

- [1. Motivation](#1-motivation)
- [2. The Problem: Ephemeral Worker State](#2-the-problem-ephemeral-worker-state)
- [3. Architecture: Immutable Source Artifacts](#3-architecture-immutable-source-artifacts)
  - [3.1 Artifact Lifecycle](#31-artifact-lifecycle)
  - [3.2 Content-Addressed Storage](#32-content-addressed-storage)
  - [3.3 Unified Ingestion Gateway](#33-unified-ingestion-gateway)
  - [3.4 Worker Artifact Consumption](#34-worker-artifact-consumption)
- [4. Multi-Branch & Workspace Support](#4-multi-branch--workspace-support)
  - [4.1 Branch Variants](#41-branch-variants)
  - [4.2 User Workspaces](#42-user-workspaces)
  - [4.3 Graph Namespacing](#43-graph-namespacing)
- [5. Scaling to Many Repos](#5-scaling-to-many-repos)
  - [5.1 Storage Budget](#51-storage-budget)
  - [5.2 Deduplication via Content Addressing](#52-deduplication-via-content-addressing)
  - [5.3 Eviction Policy](#53-eviction-policy)
- [6. Data Flow: Before vs After](#6-data-flow-before-vs-after)
- [7. Database & Schema Changes](#7-database--schema-changes)
- [8. Implementation Plan](#8-implementation-plan)
- [9. Security Considerations](#9-security-considerations)
- [10. Migration Path](#10-migration-path)
- [11. Phase Bridges](#11-phase-bridges)
- [12. Files Changed](#12-files-changed)
- [13. Verification](#13-verification)

---

## 1. Motivation

Unerr's indexing pipeline currently has two separate code ingestion paths that behave differently:

| Path | How code enters | Where it sits during indexing | Problems |
|------|----------------|------------------------------|----------|
| **GitHub App** | `git clone --depth 1` inside heavy worker | Ephemeral local disk (`/data/repo-indices/{orgId}/{repoId}`) | Slow (~10s per repo), rate-limited by GitHub API, clone failures cascade into pipeline failures, retries re-clone, worker needs Git installed |
| **CLI Upload** | `unerr push` → zip → Supabase Storage | Supabase Storage bucket, then extracted on worker | Already artifact-based, but zip format differs from clone layout, separate code path |

This creates five concrete problems:

1. **Non-deterministic retries.** If a pipeline fails at Stage 5 (embedding) and the user hits "Resume from Embedding," the worker may re-clone a *newer* commit than the one that produced the Stage 1-4 artifacts. The graph now contains entities from commit A with embeddings from commit B.

2. **External dependency during processing.** Heavy workers reach out to GitHub during indexing. If GitHub has a rate limit or outage, all indexing jobs stall. The worker pool is coupled to an external SLA it doesn't control.

3. **Cold-start latency.** Every re-index starts with a full `git clone` even though the code was already cloned during the previous run. Shallow clones still transfer the full tree (~10s for a 50MB repo, ~60s for a 500MB repo).

4. **Branch analysis is impossible.** The current pipeline indexes only the default branch. Analyzing feature branches or user workspaces requires a separate clone per branch, which doesn't scale.

5. **Two code paths.** GitHub repos and CLI repos enter the pipeline differently, requiring separate error handling, testing, and maintenance.

**The solution:** Introduce an **artifact store** — a single Supabase Storage bucket where every code snapshot is stored as a content-addressed tarball *before* any worker touches it. Workers never talk to GitHub. Both GitHub and CLI repos flow through the same artifact pipeline.

---

## 2. The Problem: Ephemeral Worker State

### Current Architecture

```
GitHub Push Webhook                          CLI `unerr push`
       │                                           │
       v                                           v
  indexRepoWorkflow                           indexRepoWorkflow
       │                                           │
       v                                           v
  prepareRepoIntelligenceSpace              prepareRepoIntelligenceSpace
       │                                           │
       ├── git clone --depth 1                     ├── download zip from Supabase Storage
       │   (to /data/repo-indices/...)             │   (to /data/repo-indices/...)
       │   ↑ SLOW, GitHub-dependent                │   ↑ Already artifact-based!
       v                                           v
  [Stage 2: SCIP] → [Stage 3: Tree-sitter] → [Stage 4: Finalize] → ...
```

The CLI path already does the right thing: store first, process later. The GitHub path skips the storage step and goes straight to processing, creating a fragile coupling.

### Why Not Just Cache the Clone?

The current `--depth 1 --single-branch` clone is ephemeral — deleted after `cleanupWorkspaceFilesystem`. You could keep it around, but:

- Stale clones accumulate disk on workers (shared mutable state)
- Any worker in the pool must be able to pick up any job (can't pin to a specific worker's disk)
- Temporal replays would need to re-clone if the original worker died
- Doesn't solve the branch problem at all

---

## 3. Architecture: Immutable Source Artifacts

### 3.1 Artifact Lifecycle

```
┌──────────────────────────────────────────────────────────────────┐
│                    INGESTION GATEWAY (light-llm-queue)            │
│                                                                  │
│   GitHub webhook ─┐                                              │
│   Manual reindex ─┼──→ fetchAndStoreArtifact() ──→ Supabase     │
│   CLI push ───────┘         │                     Storage        │
│                             │                     (artifact      │
│                         content-hash              bucket)        │
│                         the tarball                              │
│                             │                                    │
│                             v                                    │
│                    source_artifacts/                              │
│                    {orgId}/{repoId}/{commitSha}.tar.gz           │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                              │
                              │ artifact URL in workflow input
                              v
┌──────────────────────────────────────────────────────────────────┐
│                    INDEXING PIPELINE (heavy-compute-queue)        │
│                                                                  │
│   prepareRepoIntelligenceSpace()                                 │
│       │                                                          │
│       ├── Download tarball from Supabase Storage (internal LAN)  │
│       ├── Extract to /data/repo-indices/{orgId}/{repoId}/        │
│       ├── Scan, detect languages, detect monorepo roots          │
│       v                                                          │
│   [Stage 2] → [Stage 3] → ... → [Stage 10]                     │
│       │                                                          │
│       └── cleanupWorkspaceFilesystem (unchanged)                 │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Key invariant:** The artifact is stored *before* the indexing workflow starts. The workflow receives an artifact URL, not a GitHub repo URL. If the workflow retries, replays, or resumes from any stage, it re-downloads the *same* artifact — byte-for-byte identical.

### 3.2 Content-Addressed Storage

Artifacts are keyed by commit SHA, not by timestamp or run ID:

```
supabase-storage/
  source-artifacts/
    {orgId}/
      {repoId}/
        {commitSha}.tar.gz          ← full tree snapshot
        {commitSha}.meta.json       ← metadata sidecar
```

**`{commitSha}.meta.json`:**

```json
{
  "commitSha": "a1b2c3d4e5f6...",
  "branch": "main",
  "provider": "github",
  "createdAt": "2026-03-06T12:00:00Z",
  "sizeBytes": 52428800,
  "fileCount": 1247,
  "treeHash": "sha256:abc123...",
  "triggeredBy": "webhook"
}
```

**Why commit SHA as key:**
- Two branches pointing to the same commit share the same artifact (zero duplication)
- Re-index of the same commit is a no-op at the storage layer (idempotent)
- Incremental indexing can reference the parent artifact for diffing
- CLI uploads use a synthetic SHA derived from the content hash of the zip

### 3.3 Unified Ingestion Gateway

A new Temporal activity (`fetchAndStoreArtifact`) runs on `light-llm-queue` *before* the heavy-compute pipeline begins. It normalizes all three ingestion paths into a single artifact:

| Source | Gateway Action |
|--------|---------------|
| **GitHub webhook/reindex** | Use installation token → `GET /repos/{owner}/{repo}/tarball/{ref}` → stream directly to Supabase Storage. No Git needed. GitHub's tarball endpoint returns a `.tar.gz` of the tree at a specific ref — no `.git` directory, no history. |
| **CLI push** | The CLI already uploads a zip. Gateway converts it to the canonical `.tar.gz` format (or accepts it as-is with a format flag in metadata). |
| **GitLab / Bitbucket (future)** | Same pattern: each provider adapter implements `fetchTarball(ref)` behind the `IGitHost` port. |

**Why tarball, not clone:**
- GitHub's tarball API is ~3x faster than `git clone --depth 1` (no Git protocol negotiation, no pack-file decompression)
- No `.git` directory means ~40% smaller storage footprint
- No Git binary required on heavy workers
- Tarball is a pure snapshot — no mutable state, no refs, no HEAD

### 3.4 Worker Artifact Consumption

`prepareRepoIntelligenceSpace` is modified to accept an `artifactUrl` parameter instead of performing `git clone`:

```typescript
// Before (current)
const indexDir = await cloneRepo(orgId, repoId, installationId)

// After (with artifacts)
const artifactUrl = workflowInput.artifactUrl
const indexDir = await downloadAndExtract(artifactUrl, `/data/repo-indices/${orgId}/${repoId}`)
```

The rest of the pipeline (SCIP, Tree-sitter, finalization, embedding, etc.) is completely unchanged — it only cares about files on disk.

---

## 4. Multi-Branch & Workspace Support

The artifact model unlocks multi-branch analysis without architectural changes.

### 4.1 Branch Variants

When a user enables branch tracking for a repo, the ingestion gateway stores one artifact per branch-commit pair:

```
source-artifacts/{orgId}/{repoId}/
  a1b2c3d.tar.gz      ← main @ commit a1b2c3d
  f7e8d9c.tar.gz      ← feature/auth @ commit f7e8d9c
  a1b2c3d.tar.gz      ← staging @ commit a1b2c3d (same commit = same artifact, zero duplication)
```

**Branch → Commit resolution** is stored in a lightweight PostgreSQL table:

```sql
CREATE TABLE unerr.branch_refs (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id     TEXT NOT NULL REFERENCES unerr.repos(id) ON DELETE CASCADE,
  branch_name TEXT NOT NULL,
  commit_sha  TEXT NOT NULL,
  indexed_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(repo_id, branch_name)
);
```

When a push webhook arrives for a non-default branch, the gateway:
1. Stores the tarball artifact (keyed by commit SHA)
2. Upserts the `branch_refs` row
3. Optionally triggers indexing for that branch (configurable per-repo setting)

### 4.2 User Workspaces

A "workspace" is a user's local working tree — potentially with uncommitted changes, experimental branches, or entirely local code that hasn't been pushed.

User workspaces are ingested via `unerr push --workspace`:
1. CLI creates a tarball of the current working tree (including uncommitted changes)
2. SHA is computed from the tarball content itself (no Git commit to reference)
3. Uploaded as `source-artifacts/{orgId}/{repoId}/ws-{userId}-{contentHash}.tar.gz`
4. Indexed as a branch variant with `branch_name = "workspace/{userId}"`

**Workspace artifacts are ephemeral** — they have a 24-hour TTL in storage and are replaced on the next `unerr push --workspace`.

### 4.3 Graph Namespacing

The ArangoDB knowledge graph already namespaces by `orgId/repoId`. Branch variants add a third dimension:

| Dimension | Current | With Branches |
|-----------|---------|---------------|
| **Collection prefix** | `org_{orgId}` | `org_{orgId}` (unchanged) |
| **Entity `repo_id`** | `{repoId}` | `{repoId}` (unchanged) |
| **Entity `branch_ref`** | *(not present)* | `main`, `feature/auth`, `workspace/user123` |
| **Entity `commit_sha`** | *(not present)* | `a1b2c3d...` |

**Default branch (`main`) entities have `branch_ref = null`** — this preserves backward compatibility. All existing queries that don't filter by `branch_ref` continue to work, returning only main-branch entities.

Branch-specific queries add a filter:
```aql
FOR e IN org_{orgId}_functions
  FILTER e.repo_id == @repoId
  FILTER e.branch_ref == @branchRef OR e.branch_ref == null
  RETURN e
```

This **overlay pattern** means branch entities are stored as deltas on top of `main`. If a function wasn't modified on the branch, the main entity is used. Only modified entities get branch-specific records.

---

## 5. Scaling to Many Repos

### 5.1 Storage Budget

Typical repository sizes after tarball compression:

| Repo Size (uncompressed) | Tarball Size | Example |
|--------------------------|-------------|---------|
| 10 MB (small project) | ~3 MB | Solo dev project, <100 files |
| 50 MB (medium project) | ~12 MB | Typical startup codebase |
| 200 MB (large monorepo) | ~40 MB | Enterprise monorepo |
| 1 GB (very large) | ~180 MB | Google-scale monorepo (rare) |

**Storage cost at scale:**

| Scale | Repos | Avg Artifact | Total Storage | Monthly Cost (S3-equivalent) |
|-------|-------|-------------|---------------|------------------------------|
| Startup | 50 | 12 MB | 600 MB | ~$0.01 |
| Growth | 500 | 15 MB | 7.5 GB | ~$0.17 |
| Scale | 5,000 | 20 MB | 100 GB | ~$2.30 |
| Enterprise | 50,000 | 25 MB | 1.25 TB | ~$28.75 |

With branch variants (assume 3 tracked branches per repo, ~30% delta overlap):
multiply by ~2x (not 3x, due to content-addressing deduplication).

### 5.2 Deduplication via Content Addressing

Content addressing provides natural deduplication:

1. **Same commit across branches:** If `main` and `staging` point to the same commit, one artifact serves both. This is extremely common — most branches diverge by only a few commits.

2. **Re-index of unchanged repo:** If a user clicks "Re-index" but the repo hasn't changed (same HEAD SHA), the gateway skips the upload entirely — the artifact already exists.

3. **Shared dependencies in monorepos:** Not applicable at the tarball level (each repo is a separate artifact), but ArangoDB entity deduplication via stable hashing (Phase 1) applies at the graph level.

### 5.3 Eviction Policy

Not all artifacts need to live forever:

| Artifact Type | Retention | Reason |
|---------------|-----------|--------|
| **Latest per default branch** | Forever | Always needed for re-analysis |
| **Latest per tracked branch** | 30 days after branch deletion | Clean up stale feature branches |
| **Workspace artifacts** | 24 hours | Ephemeral by definition |
| **Older commits (superseded)** | 7 days | Kept briefly for incremental diff, then evicted |

A daily cleanup job (Temporal cron workflow) enforces these retention rules.

---

## 6. Data Flow: Before vs After

### Before (Current)

```
GitHub → [git clone on worker] → SCIP/Tree-sitter → ArangoDB
CLI    → [zip → Supabase Storage → extract on worker] → SCIP/Tree-sitter → ArangoDB
                    ↑ Two separate paths, different error modes
```

### After (Immutable Artifacts)

```
GitHub ──┐
CLI ─────┼──→ [Ingestion Gateway] ──→ Supabase Storage (artifact bucket)
GitLab ──┘          │                         │
                    │                         │ artifact URL
                    v                         v
             branch_refs table          [Heavy Worker]
             (PostgreSQL)                     │
                                              ├── Download artifact (internal LAN)
                                              ├── Extract to local disk
                                              ├── SCIP / Tree-sitter
                                              └── → ArangoDB, pgvector, etc.
                    ↑ One path, deterministic, retryable
```

---

## 7. Database & Schema Changes

### PostgreSQL (Prisma)

**New table: `unerr.source_artifacts`**

```sql
CREATE TABLE unerr.source_artifacts (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        TEXT NOT NULL,
  repo_id       TEXT NOT NULL REFERENCES unerr.repos(id) ON DELETE CASCADE,
  commit_sha    TEXT NOT NULL,
  branch_name   TEXT,
  provider      TEXT NOT NULL DEFAULT 'github',
  storage_path  TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL,
  file_count    INTEGER,
  tree_hash     TEXT,
  triggered_by  TEXT NOT NULL DEFAULT 'webhook',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(repo_id, commit_sha)
);

CREATE INDEX idx_source_artifacts_repo ON unerr.source_artifacts(repo_id);
CREATE INDEX idx_source_artifacts_created ON unerr.source_artifacts(created_at);
```

**New table: `unerr.branch_refs`**

```sql
CREATE TABLE unerr.branch_refs (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id     TEXT NOT NULL REFERENCES unerr.repos(id) ON DELETE CASCADE,
  branch_name TEXT NOT NULL,
  commit_sha  TEXT NOT NULL,
  indexed_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(repo_id, branch_name)
);
```

**Modified table: `unerr.repos`**

Add column:
```sql
ALTER TABLE unerr.repos ADD COLUMN branch_tracking_enabled BOOLEAN NOT NULL DEFAULT false;
```

### ArangoDB

**Modified entity documents** — add optional fields:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `branch_ref` | `string \| null` | `null` | Branch name for branch-specific entities. `null` = default branch. |
| `commit_sha` | `string \| null` | `null` | Commit SHA from which this entity was extracted. |

No new collections required. Existing indexes work without modification (entities are already filtered by `repo_id`).

### Supabase Storage

**New bucket: `source-artifacts`**

- Access: Private (service role only)
- Path pattern: `{orgId}/{repoId}/{commitSha}.tar.gz`
- Metadata sidecar: `{orgId}/{repoId}/{commitSha}.meta.json`
- Lifecycle policy: Objects auto-expire based on `x-amz-meta-retention-days` header

---

## 8. Implementation Plan

### Phase 13a: Artifact Store Foundation

| Task | Description | Queue / Layer |
|------|-------------|---------------|
| **SA-01** | Create `source-artifacts` Supabase Storage bucket | Infrastructure |
| **SA-02** | Add `source_artifacts` and `branch_refs` Prisma models + migration | Database |
| **SA-03** | Implement `fetchAndStoreArtifact` activity | `light-llm-queue` |
| **SA-04** | Modify `prepareRepoIntelligenceSpace` to accept `artifactUrl` | `heavy-compute-queue` |
| **SA-05** | Update `indexRepoWorkflow` to call gateway before heavy pipeline | Workflow |
| **SA-06** | Update `IGitHost` port with `fetchTarball(ref): ReadableStream` method | Ports layer |
| **SA-07** | Implement `fetchTarball` in GitHub adapter (uses `/tarball/{ref}` API) | Adapters layer |
| **SA-08** | Unify CLI upload path to use artifact store | CLI |
| **SA-09** | Add artifact eviction cron workflow | Temporal |
| **SA-10** | Update Controls page to show artifact info (commit SHA, size) | Frontend |

### Phase 13b: Multi-Branch Support

| Task | Description | Queue / Layer |
|------|-------------|---------------|
| **BR-01** | Add `branch_ref` and `commit_sha` fields to ArangoDB entity schema | ArangoDB |
| **BR-02** | Implement branch overlay query pattern in `arango-graph-store.ts` | Adapters layer |
| **BR-03** | Handle non-default-branch webhooks in ingestion gateway | API |
| **BR-04** | Add branch picker UI to repo dashboard | Frontend |
| **BR-05** | Update MCP tools to accept optional `branch` parameter | MCP |
| **BR-06** | Implement workspace push (`unerr push --workspace`) | CLI |

### Phase 13c: Incremental Artifacts

| Task | Description | Queue / Layer |
|------|-------------|---------------|
| **IA-01** | Generate delta artifacts (files changed between two SHAs) for incremental indexing | Gateway |
| **IA-02** | Modify `incrementalIndexWorkflow` to use delta artifacts instead of `git pull` | Workflow |
| **IA-03** | Implement artifact diffing (compare two tarballs to produce changed file list) | Library |

---

## 9. Security Considerations

| Concern | Mitigation |
|---------|------------|
| **Customer code in storage** | Supabase Storage bucket is private (service role only). No public URLs. Workers use signed, short-lived download URLs (5-minute expiry). |
| **Secrets in source code** | Artifact upload pipeline runs existing `lib/indexer/secret-scanner.ts` (TruffleHog patterns) *before* storing. Flagged files are quarantined in metadata but still stored (needed for indexing). |
| **Multi-tenant isolation** | Storage paths are prefixed by `orgId`. All access goes through the `IRelationalStore` port which enforces org scoping. Workers cannot access artifacts outside their workflow's org context. |
| **Data residency** | Supabase Storage region matches the PostgreSQL region. For EU customers, both use the EU Supabase project. |
| **Eviction guarantees** | The daily eviction cron is the safety net, but artifacts also carry `x-amz-meta-retention-days` for belt-and-suspenders lifecycle enforcement. |

---

## 10. Migration Path

Migration is backward-compatible and can be rolled out incrementally:

1. **Deploy artifact store** (SA-01, SA-02) — no behavior change yet.
2. **Deploy ingestion gateway** (SA-03, SA-06, SA-07) — new repos use artifacts, existing repos still clone.
3. **Modify `prepareRepoIntelligenceSpace`** (SA-04) — accept both `artifactUrl` (new path) and fallback to `git clone` (old path) via a feature flag.
4. **Flip the flag** — all new indexing runs use artifacts. Old clone path becomes dead code.
5. **Remove clone path** — delete `git clone` code from `prepareRepoIntelligenceSpace`, remove Git dependency from heavy worker Docker image.

**Zero downtime.** No data migration needed — artifacts are additive. The graph data in ArangoDB doesn't change format.

---

## 11. Phase Bridges

| From This Phase | To | Connection |
|----------------|-----|------------|
| **Phase 13a** (Artifacts) | **Phase 5** (Incremental) | Incremental indexing uses delta artifacts instead of `git pull` on worker disk |
| **Phase 13b** (Branches) | **Phase 5** (Branch Shadow Graph) | The `BranchOverlay` concept from Phase 5 is implemented via `branch_ref` entity field |
| **Phase 13b** (Branches) | **Phase 7** (PR Reviews) | PR review workflow can index the PR branch artifact and diff against main-branch graph |
| **Phase 13c** (Incremental Artifacts) | **Phase ∞** (Rust Rewrite) | Rust workers consume the same artifact format — no migration needed when processing moves to Rust |
| **Phase 13a** (Artifacts) | **Phase 10a** (Local-First) | Graph snapshots already in Supabase Storage; artifact store puts source code in the same system, enabling local re-analysis if needed |
| **Phase 13b** (Workspaces) | **Phase 12** (Multiplayer) | Workspace artifacts enable per-developer knowledge graphs, feeding into collision detection |

---

## 12. Files Changed

### New Files

```
lib/temporal/activities/artifact-gateway.ts              — fetchAndStoreArtifact activity
lib/temporal/workflows/evict-artifacts.ts                — Daily artifact eviction cron
prisma/migrations/XXXXX_source_artifacts.sql             — source_artifacts + branch_refs tables
```

### Modified Files

```
lib/ports/git-host.ts                                    — Add fetchTarball() to IGitHost
lib/adapters/github-git-host.ts                          — Implement fetchTarball via GitHub API
lib/temporal/activities/indexing-heavy.ts                 — prepareRepoIntelligenceSpace accepts artifactUrl
lib/temporal/workflows/index-repo.ts                     — Call gateway before heavy pipeline
lib/temporal/workflows/incremental-index.ts              — Use delta artifacts (Phase 13c)
lib/di/fakes.ts                                          — Add fake artifact store for testing
prisma/schema.prisma                                     — Add SourceArtifact + BranchRef models
packages/cli/src/commands/push.ts                        — Unify upload path to artifact store
```

---

## 13. Verification

### Phase 13a

1. `pnpm build` succeeds
2. GitHub repo indexing produces an artifact in `source-artifacts/{orgId}/{repoId}/{sha}.tar.gz` before heavy worker starts
3. CLI `unerr push` produces an artifact in the same bucket with synthetic SHA
4. Heavy worker downloads artifact from Supabase Storage (not from GitHub)
5. Pipeline retry/resume downloads the *same* artifact (verify by SHA)
6. Git is no longer required on heavy worker (remove from Docker image, verify indexing still works)
7. Artifact eviction cron deletes artifacts older than retention policy
8. Rate limiting on GitHub tarball API is handled gracefully (429 → retry with backoff)

### Phase 13b

9. Push to non-default branch creates branch-specific artifact
10. Branch entities in ArangoDB have `branch_ref` set
11. Default-branch queries return the same results as before (backward compatible)
12. Branch picker in UI shows indexed branches
13. MCP tools accept `branch` parameter and return branch-aware results

### Phase 13c

14. Incremental indexing uses delta artifacts (no `git pull` on worker)
15. Delta artifact contains only changed files between two commit SHAs
16. Entity diff computed from delta artifact matches full re-index diff
