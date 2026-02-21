# Phase ∞ — Heavy Worker Performance Rewrite (Cross-Cutting)

> **Architectural Deep Dive & Implementation Tracker**
>
> _"Cross-cutting infrastructure improvement. Not a feature phase — this rewrites performance-critical Temporal activities from TypeScript to Rust. Can be done incrementally alongside any phase after launch."_

---

## Canonical Terminology

| Term | Definition | Boundary |
|------|-----------|----------|
| **Heavy Worker** | A Temporal worker process registered on `heavy-compute-queue` that executes CPU-bound activities: workspace preparation (git clone), SCIP index parsing, and entity extraction. | Currently a Node.js/TypeScript process (`tsx scripts/temporal-worker-heavy.ts`). Phase ∞ replaces its internals with Rust binaries while keeping the Temporal activity contract identical. |
| **Light Worker** | A Temporal worker on `light-llm-queue` handling network-bound activities: ArangoDB writes, LLM calls, embeddings, email, webhooks. | Stays TypeScript permanently. Not touched by Phase ∞. |
| **Rust Activity Binary** | A standalone CLI binary compiled from the `workers/heavy-compute-rust/` crate. Invoked by the TypeScript activity wrapper via `execFileAsync`. Reads input from CLI args or stdin JSON, writes structured JSON to stdout. | Not a Temporal worker itself — it is a tool called by the TypeScript Temporal activity. Temporal SDK integration, heartbeating, and retry semantics remain in TypeScript. |
| **TypeScript Wrapper** | The thin Temporal activity function in TypeScript that invokes the Rust binary, maps its stdout to the activity return type, handles errors, and calls `heartbeat()`. | Wraps exactly one Rust binary invocation per activity. No business logic — just process management. |
| **SCIP Index** | A binary protobuf file (`.scip`) produced by language-specific indexers (`scip-typescript`, `scip-python`, `scip-go`). Contains symbol information, occurrence ranges, and cross-references for an entire codebase. | Phase ∞ does NOT replace the SCIP indexer binaries — those are third-party tools. It replaces the SCIP index *parser* (currently hand-rolled varint decoder in TypeScript) with `prost` + `mmap` in Rust. |
| **Entity Hash** | Deterministic SHA-256 hash of `repoId\0filePath\0kind\0name\0signature`, truncated to 16 hex chars. Used as `_key` in ArangoDB. | Must be byte-identical between TypeScript and Rust implementations. This is the single most critical compatibility constraint — any divergence corrupts the graph. |
| **Bulk Import** | ArangoDB's `POST /_api/import` endpoint accepting JSONL (one JSON document per line). Currently called via `arangojs col.import()` in the light worker. | Phase ∞ moves bulk import to Rust (HTTP/2 multiplexed via `reqwest`), bypassing the light worker for the write path. The light worker's `writeToArango` activity is retired. |
| **Workspace Volume** | Docker volume `workspaces` mounted at `/data/workspaces/{orgId}/{repoId}`. Contains cloned repos and SCIP output files. | Shared between the heavy worker container and the Rust binary. Both read/write to the same filesystem paths. |
| **Streaming Parse** | Processing SCIP index data without loading the entire file into memory. Rust uses `mmap` (memory-mapped I/O) + `prost` streaming decode. | Replaces the TypeScript pattern of `fs.readFileSync()` into a `Buffer` → manual varint walk. Eliminates V8 heap pressure. |

---

## Part 1: Architectural Deep Dive

### 1. Core User Flows

#### Flow 1: Incremental Migration — Swapping One Activity at a Time

```
Actor: Platform engineering team
Trigger: Decision to migrate a specific heavy activity to Rust
```

The migration is designed to be incremental — each of the three heavy activities can be swapped independently without touching the others:

1. **Pre-migration state:** All three activities (`prepareWorkspace`, `runSCIP`, `parseRest`) are pure TypeScript, running in the same Node.js process.

2. **Select activity to migrate.** Priority order based on impact:
   - `runSCIP` first (highest impact — SCIP parsing causes OOM on large repos, hand-rolled varint decoder is incomplete)
   - `prepareWorkspace` second (git clone latency, subprocess spawn overhead)
   - `parseRest` + bulk import third (entity extraction + ArangoDB write consolidation)

3. **Build the Rust binary for that activity:**
   - Implement the equivalent logic in `workers/heavy-compute-rust/src/`
   - Binary accepts CLI args matching the TypeScript input type
   - Binary writes JSON to stdout matching the TypeScript output type
   - Compile to a static binary (`musl` target for Alpine compatibility)

4. **Create the TypeScript wrapper:**
   - Replace the activity body with `execFileAsync('/usr/local/bin/kap10-{activity}', [args...])`
   - Parse stdout as JSON
   - Map Rust process exit codes to Temporal failure types
   - Preserve heartbeat calls (Rust binary writes progress to stderr; wrapper reads and heartbeats)

5. **Update Dockerfile:**
   - Multi-stage build: compile Rust in `rust:1.82-alpine` stage
   - Copy binary to existing `node:22-bookworm-slim` heavy worker image
   - Binary lands at `/usr/local/bin/kap10-{activity}`

6. **Deploy with feature flag:**
   - Environment variable `USE_RUST_{ACTIVITY}=true|false` (default: `false`)
   - TypeScript wrapper checks flag: Rust path if `true`, original TypeScript path if `false`
   - Allows instant rollback without redeployment

7. **Measure and compare:**
   - Run both paths in shadow mode (execute Rust, compare output to TypeScript, log discrepancies)
   - Validate entity hash determinism (critical — Rust must produce identical `_key` values)
   - Compare memory, latency, and error rates via Langfuse + Temporal metrics

8. **Promote:** Set flag to `true` in production. Remove the TypeScript implementation after one release cycle of stable operation.

#### Flow 2: Rust SCIP Parser — The Critical Path

```
Actor: Heavy worker processing a repository with 10,000+ files
Trigger: index-repo workflow reaches the runSCIP step
```

**Current TypeScript path (what breaks):**

1. `runSCIP` activity spawns `npx scip-typescript index` with `NODE_OPTIONS: "--max-old-space-size=4096"`.
2. SCIP binary produces a `.scip` file (can be 100+ MB for large repos).
3. TypeScript reads entire `.scip` file into a Node.js `Buffer` via `readFileSync`.
4. Hand-rolled varint decoder walks the buffer, allocating JS objects for every occurrence and symbol.
5. V8 heap exceeds 4 GB → OOM kill. Activity fails. Temporal retries 3 times. All 3 fail. Workflow fails.

**New Rust path:**

1. TypeScript wrapper calls `execFileAsync('/usr/local/bin/kap10-scip-parse', ['--input', scipPath, '--repo-id', repoId, '--output-format', 'json'])`.
2. Rust binary opens the `.scip` file via `mmap` (zero heap allocation for file I/O).
3. `prost`-generated decoder reads the `Index` protobuf message using the official `scip.proto` schema:
   - Iterates `documents` (field 2) — each `Document` contains a `relative_path` and list of `occurrences`.
   - For each `Occurrence`: extracts `range` (line/col), `symbol` string, `symbol_roles` (definition vs reference).
   - Parses SCIP symbol format to extract entity kind (function, class, method, variable) and fully qualified name.
4. For each symbol definition, creates an `EntityDoc` JSON object. For each cross-reference, creates an `EdgeDoc`.
5. Entity keys are computed using the same SHA-256 algorithm as TypeScript (`entityHash`).
6. Output is streamed to stdout as newline-delimited JSON (NDJSON) — the wrapper reads line by line, never holding the full array in memory.
7. Rust binary reports progress to stderr: `PROGRESS:25`, `PROGRESS:50`, etc. TypeScript wrapper reads stderr and calls `heartbeat()`.

**Memory comparison:**

| Metric | TypeScript (current) | Rust (new) |
|--------|---------------------|------------|
| `.scip` file I/O | `readFileSync` → full Buffer in V8 heap | `mmap` → OS page cache, zero heap |
| Protobuf decode | JS objects per occurrence (GC pressure) | Stack-allocated structs, arena allocator |
| Entity output | In-memory `EntityDoc[]` array | NDJSON streaming to stdout |
| Peak memory (100 MB `.scip`) | ~3.5 GB (OOM risk) | ~200 MB (mmap pages + working set) |

#### Flow 3: Rust Git Clone — Eliminating Subprocess Overhead

```
Actor: Heavy worker preparing a workspace for a new or updated repository
Trigger: index-repo workflow reaches the prepareWorkspace step
```

**Current TypeScript path:**

1. `prepareWorkspace` calls `container.gitHost.cloneRepo()`.
2. `GitHubHost.cloneRepo()` uses `simple-git` which spawns `git` as a subprocess.
3. For large repos: subprocess spawn (~50 ms), git negotiation over HTTPS, data transfer, filesystem write.
4. After clone: `scanWorkspace()` spawns `git ls-files` as another subprocess (50 MB stdout buffer).
5. `detectWorkspaceRoots()` reads YAML/JSON config files from disk.
6. Total: 2 subprocess spawns, all stdout buffered in Node.js memory.

**New Rust path:**

1. TypeScript wrapper calls `execFileAsync('/usr/local/bin/kap10-prepare-workspace', ['--repo-url', url, '--branch', branch, '--workspace-dir', dir, '--output-format', 'json'])`.
2. Rust binary uses `git2` crate (libgit2 bindings):
   - In-process clone — no subprocess spawn.
   - Credential callback injects GitHub App installation token.
   - Progress callback reports to stderr for heartbeating.
3. File listing via `git2::Repository::index()` — iterates the Git index directly, no `git ls-files` subprocess.
4. Language detection and monorepo detection run as pure Rust logic (filesystem reads + YAML/JSON parsing via `serde`).
5. Output: JSON to stdout with `{ workspacePath, languages, workspaceRoots, fileCount }`.

**Latency comparison:**

| Step | TypeScript | Rust | Savings |
|------|-----------|------|---------|
| Git clone (10K files) | ~95 s (subprocess + HTTPS) | ~25 s (in-process libgit2) | ~70 s |
| File listing | ~5 s (git ls-files subprocess) | ~1 s (index iteration) | ~4 s |
| Language detection | ~0.5 s | ~0.1 s | ~0.4 s |
| Monorepo detection | ~0.5 s | ~0.1 s | ~0.4 s |
| **Total** | **~101 s** | **~26 s** | **~75 s (3.9x)** |

#### Flow 4: Consolidated Entity Write — Eliminating the Light Worker Hop

```
Actor: index-repo workflow after entity extraction
Trigger: runSCIP + parseRest complete with entity/edge arrays
```

**Current path (what's inefficient):**

1. `runSCIP` returns `{ entities, edges, coveredFiles }` — serialized through Temporal's workflow state.
2. `parseRest` returns `{ extraEntities, extraEdges }` — also serialized through workflow state.
3. Workflow merges arrays in-memory: `allEntities = [...scip.entities, ...rest.extraEntities]`.
4. Workflow sends `allEntities` + `allEdges` to `lightActivities.writeToArango()` — another Temporal serialization hop across queues.
5. Light worker deserializes, calls `bulkUpsertEntities` + `bulkUpsertEdges` on `IGraphStore`.

For a repo with 50K entities: the entity data is serialized/deserialized **4 times** (runSCIP output → workflow state → writeToArango input → light worker). Each serialization allocates a full copy in the V8 heap.

**New Rust path:**

1. Rust SCIP parser writes entities directly to ArangoDB during parsing (streaming write).
2. Rust entity extractor (parseRest equivalent) also writes directly to ArangoDB during extraction.
3. No entity data flows through Temporal workflow state — the workflow only receives a summary: `{ entityCount, edgeCount, errorCount }`.
4. ArangoDB writes use HTTP/2 multiplexed connections via `reqwest`, sending batches of 1,000 documents in parallel streams.

**Serialization reduction:**

| Step | Current (TypeScript) | New (Rust) |
|------|---------------------|------------|
| SCIP parse → workflow | Full entity array serialized | Summary object only |
| Workflow → light worker | Full entity array re-serialized | Eliminated (Rust wrote directly) |
| Light worker → ArangoDB | HTTP/1.1 sequential batches | HTTP/2 multiplexed parallel streams |
| **Total serialization passes** | **4** | **0** (entities never leave Rust) |

---

### 2. System Logic & State Management

#### Architecture: Binary Sidecar Pattern

Phase ∞ does NOT replace the Temporal heavy worker process. It adds Rust binaries as sidecars called from within the existing TypeScript activity functions:

```
┌───────────────────────────────────────────────────────────────┐
│  Heavy Worker Container (node:22-bookworm-slim)                │
│                                                                │
│  ┌─────────────────────────────────────────────────────┐      │
│  │  Node.js Process (tsx scripts/temporal-worker-heavy) │      │
│  │                                                      │      │
│  │  ┌─────────────────────────────────────────────────┐ │      │
│  │  │ Activity: prepareWorkspace                      │ │      │
│  │  │  if USE_RUST_PREPARE:                           │ │      │
│  │  │    execFileAsync("kap10-prepare-workspace"...)   │─┼──►  │
│  │  │  else:                                          │ │   Rust│
│  │  │    original TypeScript impl                     │ │   bins│
│  │  └─────────────────────────────────────────────────┘ │      │
│  │  ┌─────────────────────────────────────────────────┐ │      │
│  │  │ Activity: runSCIP                               │ │      │
│  │  │  if USE_RUST_SCIP:                              │ │      │
│  │  │    execFileAsync("kap10-scip-parse"...)          │─┼──►  │
│  │  │  else:                                          │ │   /usr│
│  │  │    original TypeScript impl                     │ │   /lo-│
│  │  └─────────────────────────────────────────────────┘ │   cal/│
│  │  ┌─────────────────────────────────────────────────┐ │   bin/│
│  │  │ Activity: parseRest                             │ │      │
│  │  │  if USE_RUST_PARSE_REST:                        │ │      │
│  │  │    execFileAsync("kap10-parse-rest"...)          │─┼──►  │
│  │  │  else:                                          │ │      │
│  │  │    original TypeScript impl                     │ │      │
│  │  └─────────────────────────────────────────────────┘ │      │
│  └─────────────────────────────────────────────────────┘      │
└───────────────────────────────────────────────────────────────┘
```

**Why not a standalone Rust Temporal worker?**

The Temporal Rust SDK (`temporal-sdk-core`) is production-ready and could register activities directly on `heavy-compute-queue`. However:

1. **Incremental migration is safer.** The sidecar pattern allows one activity at a time with instant rollback via env flags.
2. **Temporal workflow determinism.** If the workflow calls activities by name, a Rust worker registering the same activity names would cause non-deterministic replay if both workers are running simultaneously during migration.
3. **Heartbeat integration.** The TypeScript wrapper handles `heartbeat()` calls using the well-tested `@temporalio/activity` SDK. Reproducing heartbeat semantics in Rust adds risk for no performance gain (heartbeating is I/O-bound).
4. **Observability integration.** Existing Langfuse tracing, structured logging, and error mapping flow through the TypeScript layer. The Rust binary is a black box that produces structured output — the wrapper handles telemetry.

**Future state:** Once all three activities are stable on Rust, the migration to a standalone Rust Temporal worker becomes a follow-up optimization (eliminating the `execFileAsync` overhead of ~50 ms per invocation). This is Phase ∞+1 — not in scope.

#### Rust Binary Interface Contract

Each Rust binary follows a strict contract:

**Input:** CLI arguments + optional stdin JSON for large payloads.

```
kap10-scip-parse \
  --input /data/workspaces/{orgId}/{repoId}/index.scip \
  --repo-id {repoId} \
  --workspace-dir /data/workspaces/{orgId}/{repoId} \
  --arango-url http://arangodb:8529 \
  --arango-db kap10 \
  --arango-auth {base64 user:pass} \
  --batch-size 1000 \
  --output-format summary
```

**Output (stdout):** JSON conforming to the TypeScript activity return type.

```json
{
  "entityCount": 12450,
  "edgeCount": 34200,
  "coveredFiles": ["lib/auth/jwt.ts", "lib/auth/session.ts", "..."],
  "errors": [],
  "peakMemoryMb": 187,
  "durationMs": 11500
}
```

When `--output-format json` is used (for shadow mode comparison), stdout contains the full entity/edge arrays as NDJSON — one JSON object per line. This mode is used only during migration validation, never in production.

**Progress (stderr):** Machine-readable progress lines interleaved with human-readable log lines.

```
PROGRESS:10 Parsing SCIP index...
PROGRESS:25 Decoded 3,000 documents
PROGRESS:50 Extracted 6,000 entities
PROGRESS:75 Writing batch 4/8 to ArangoDB
PROGRESS:90 Writing batch 8/8 to ArangoDB
PROGRESS:100 Complete
```

The TypeScript wrapper reads stderr line by line, parses `PROGRESS:N` prefixes, and calls `heartbeat(N + "% complete")`.

**Exit codes:**

| Code | Meaning | TypeScript mapping |
|------|---------|-------------------|
| 0 | Success | Parse stdout JSON as activity result |
| 1 | Input validation error | Throw `ApplicationFailure.nonRetryable()` |
| 2 | SCIP parse error | Throw `ApplicationFailure.retryable()` |
| 3 | ArangoDB connection error | Throw `ApplicationFailure.retryable()` |
| 4 | Filesystem error (permissions, disk full) | Throw `ApplicationFailure.nonRetryable()` |
| 137 | OOM killed (SIGKILL) | Throw `ApplicationFailure.retryable()` with reduced batch size hint |

#### Entity Hash Compatibility

The single most critical compatibility constraint. The Rust entity hash must produce **byte-identical** output to:

```typescript
// lib/indexer/entity-hash.ts
function entityHash(repoId, filePath, kind, name, signature?): string {
  const input = [repoId, filePath, kind, name, signature ?? ""].join("\0")
  return createHash("sha256").update(input).digest("hex").slice(0, 16)
}
```

Rust equivalent:

```
fn entity_hash(repo_id: &str, file_path: &str, kind: &str, name: &str, signature: Option<&str>) -> String {
    use sha2::{Sha256, Digest};
    let input = format!("{}\0{}\0{}\0{}\0{}", repo_id, file_path, kind, name, signature.unwrap_or(""));
    let digest = Sha256::digest(input.as_bytes());
    hex::encode(&digest[..8])  // 8 bytes = 16 hex chars
}
```

**Validation strategy:** A dedicated test generates 10,000 entity hashes from both implementations with identical inputs and asserts byte-for-byte equality. This test runs in CI on every Rust binary change.

Edge hash follows the same pattern:

```
fn edge_hash(from_id: &str, to_id: &str, kind: &str) -> String {
    let input = format!("{}\0{}\0{}", from_id, to_id, kind);
    // same SHA-256 + truncate logic
}
```

#### KIND_TO_COLLECTION Mapping

The Rust binary writes directly to ArangoDB, so it must know the singular→plural mapping:

```
file      → files
function  → functions
class     → classes
method    → methods
variable  → variables
interface → interfaces
type      → types
module    → modules
```

This mapping is hardcoded in both `arango-graph-store.ts:68` and `indexing-light.ts:6`. The Rust implementation must be kept in sync. A shared JSON config file or a validation test comparing all three sources prevents drift.

#### Workflow Changes

The `index-repo` workflow (`lib/temporal/workflows/index-repo.ts`) currently orchestrates:

```
Step 1: prepareWorkspace  → { workspacePath, languages, workspaceRoots }
Step 2: runSCIP           → { entities, edges, coveredFiles }
Step 3: parseRest         → { extraEntities, extraEdges }
    [merge arrays in workflow]
Step 4: writeToArango     → void
Step 5: embedRepo (child workflow)
Step 6: syncLocalGraph (child workflow)
```

**After Phase ∞:**

```
Step 1: prepareWorkspace  → { workspacePath, languages, workspaceRoots, fileCount }
Step 2: runSCIP           → { entityCount, edgeCount, coveredFiles }
    (Rust writes directly to ArangoDB — no entity array in workflow state)
Step 3: parseRest         → { entityCount, edgeCount }
    (Rust writes directly to ArangoDB — no entity array in workflow state)
Step 4: writeToArango     → REMOVED (Rust handled it in steps 2+3)
Step 5: embedRepo (child workflow)
Step 6: syncLocalGraph (child workflow)
```

**Workflow state reduction:** From potentially 50,000+ entity objects in workflow state to 3 small summary objects (~200 bytes each). This eliminates workflow replay failures caused by large state payloads.

**Backward compatibility during migration:** When only `runSCIP` is migrated to Rust but `parseRest` is still TypeScript:
- `runSCIP` (Rust) writes its entities directly to ArangoDB, returns summary.
- `parseRest` (TypeScript) still returns full entity arrays.
- `writeToArango` (light worker) only receives `parseRest` entities (reduced payload).
- This hybrid state is safe because ArangoDB `import({ onDuplicate: "update" })` is idempotent — duplicate writes from different paths don't conflict.

---

### 3. Reliability & Resilience

#### Failure Mode: Rust Binary Crashes (SIGSEGV, SIGABRT)

**Impact:** `execFileAsync` rejects with a non-zero exit code. Activity fails.

**Mitigation:**
1. TypeScript wrapper catches the error, logs the exit code and stderr output.
2. Maps to `ApplicationFailure.retryable()` — Temporal retries (max 3 attempts).
3. If crash is reproducible (all 3 retries fail), the feature flag allows instant rollback to TypeScript path.
4. Rust binary is compiled with `panic = "abort"` (no unwinding) and `RUST_BACKTRACE=1` for diagnosable crash dumps in stderr.

#### Failure Mode: Entity Hash Mismatch Between TypeScript and Rust

**Impact:** Catastrophic — entities written by Rust have different `_key` values than those written by TypeScript. ArangoDB creates duplicates instead of updates. Graph queries return wrong results. Incremental indexing breaks.

**Mitigation:**
1. **Hash compatibility test in CI:** 10,000 entity hashes compared between TypeScript and Rust. Any mismatch fails the build.
2. **Shadow mode validation:** Before enabling Rust in production, run both paths and compare full entity output. Log any discrepancies. Only promote when 0 discrepancies across 100+ repos.
3. **Deterministic input normalization:** Both implementations use UTF-8 encoding, NUL byte (`\0`) as delimiter, and empty string for missing `signature`. No locale-dependent operations.
4. **Single source of truth for the algorithm:** The hash algorithm specification lives in `lib/indexer/entity-hash.ts` with a doc comment marking it as the canonical reference. Rust implementation references this file.

#### Failure Mode: ArangoDB Bulk Write Partial Failure (Rust Direct Write)

**Impact:** Some entities written, some not. Partial graph state.

**Mitigation:**
1. ArangoDB `POST /_api/import` returns per-document error details. Rust binary collects failed documents and retries once with exponential backoff.
2. If retry fails, binary exits with code 3 (ArangoDB error). TypeScript wrapper maps to retryable failure. Temporal retries the entire activity.
3. `onDuplicate: "update"` ensures that re-running the activity after a partial failure is safe — already-written entities are updated (idempotent), not duplicated.
4. The Rust binary writes entities in batches of 1,000. If one batch fails, previous batches are already committed (ArangoDB import is not transactional across batches). This is acceptable because the entire pipeline is idempotent at the entity level.

#### Failure Mode: Rust Binary Not Found in Container

**Impact:** `execFileAsync` throws `ENOENT`. Activity fails immediately.

**Mitigation:**
1. Dockerfile build step verifies binary exists and is executable (`RUN /usr/local/bin/kap10-scip-parse --version`).
2. Container health check includes binary existence verification.
3. Feature flag defaults to `false` (TypeScript path) — binary absence only matters when flag is explicitly enabled.
4. TypeScript wrapper checks `fs.existsSync(binaryPath)` before `execFileAsync`. If missing and flag is `true`, throws `ApplicationFailure.nonRetryable("Rust binary not found — check Dockerfile build")`.

#### Failure Mode: Workspace Volume Not Mounted

**Impact:** Rust binary cannot read `.scip` files or cloned repos. Activity fails.

**Mitigation:**
1. Rust binary validates input paths exist before processing. Returns exit code 4 (filesystem error) with descriptive stderr message.
2. Docker compose configuration mounts `workspaces:/data/workspaces` — same as current TypeScript worker.
3. TypeScript wrapper pre-validates workspace path existence before invoking Rust binary.

#### Failure Mode: Memory Limit Exceeded (Container OOM Kill)

**Impact:** Container killed by Docker/Kubernetes OOM killer. All in-flight activities on that worker fail.

**Mitigation:**
1. Rust binary tracks its own memory usage via `jemalloc` stats. If approaching 80% of a configurable limit (`--max-memory-mb`), it flushes pending writes and exits gracefully with a "memory pressure" warning.
2. Container memory limit can be reduced from 8 GB (current, needed for Node.js) to 2 GB (sufficient for Rust). This is a 4x cost reduction.
3. The `mmap` approach for SCIP parsing means the OS handles memory pressure by evicting mapped pages — the process itself doesn't allocate heap for file I/O.

#### Rollback Strategy

| Scenario | Action | Downtime |
|----------|--------|----------|
| Rust binary produces wrong output | Set `USE_RUST_{ACTIVITY}=false` | Zero — next activity invocation uses TypeScript |
| Rust binary crashes consistently | Set `USE_RUST_{ACTIVITY}=false` | Zero — in-flight activity retries via Temporal |
| Entity hash mismatch discovered | Disable flag + run full re-index for affected repos | Hours (re-index time) |
| All Rust activities unstable | Set all 3 flags to `false` | Zero — full TypeScript fallback |

---

### 4. Performance Considerations

#### Benchmark Targets

| Metric | Current (TypeScript) | Target (Rust) | Minimum acceptable |
|--------|---------------------|---------------|-------------------|
| Clone + scan (10K files) | ~101 s | ~26 s | < 40 s |
| SCIP parse (100 MB index) | OOM crash | ~12 s, 200 MB peak | < 30 s, < 500 MB |
| Bulk insert (50K entities) | ~45 s (with GC pauses) | ~9 s | < 20 s |
| Peak memory (large monorepo) | ~2 GB (OOM risk) | ~200 MB | < 1 GB |
| End-to-end indexing (10K files) | ~5 min (if no OOM) | ~1.5 min | < 3 min |
| Worker instance cost | r6g.xlarge ($0.201/hr) | r6g.medium ($0.050/hr) | r6g.large ($0.101/hr) |

#### Rust Binary Compilation Targets

```
Primary:   x86_64-unknown-linux-musl   (Alpine/Docker, static linking)
Secondary: aarch64-unknown-linux-musl   (ARM64/Graviton, static linking)
Dev:       {host triple}                (developer machine, dynamic linking)
```

Static `musl` linking ensures the binary has zero runtime dependencies — no glibc version issues, no shared library conflicts. Binary size: ~5–8 MB per tool.

#### ArangoDB HTTP/2 vs HTTP/1.1

Current `arangojs` uses HTTP/1.1 with connection pooling. Sequential batch writes:

```
Batch 1 ──────► ArangoDB ──────► Response 1
                                  Batch 2 ──────► ArangoDB ──────► Response 2
                                                                    Batch 3 ...
```

Rust `reqwest` with HTTP/2 multiplexing:

```
Batch 1 ──────►
Batch 2 ──────► ArangoDB ──────► Response 1, 2, 3 (multiplexed)
Batch 3 ──────►
```

**Estimated speedup:** 3–5x for bulk imports (50 batches of 1,000 entities). HTTP/2 multiplexing eliminates head-of-line blocking and reduces TCP connection overhead.

**Requirement:** ArangoDB must be configured with HTTP/2 enabled (default since ArangoDB 3.12). Verify with `curl --http2 https://arangodb:8529/_api/version`.

#### SCIP Parsing: mmap vs Read

| Approach | Heap allocation | Page faults | Throughput |
|----------|----------------|-------------|------------|
| `readFileSync` (current TS) | Full file size | 0 (one read) | ~50 MB/s (limited by V8 GC) |
| `mmap` (Rust) | Zero (OS pages) | Lazy, on access | ~500 MB/s (limited by SSD I/O) |
| `mmap` + `prost` (zero-copy) | Near zero | Lazy | ~400 MB/s (decode overhead) |

For a 100 MB SCIP index, the current TypeScript path allocates ~100 MB on the V8 heap just for the raw buffer, then ~3x more for decoded objects (~400 MB total). Rust `mmap` + `prost` allocates only working-set memory (~50 MB for the decode state machine).

#### Temporal Activity Timeout Adjustment

Current timeout: `startToCloseTimeout: "30m"`. With Rust, activities complete 3–8x faster. However, do NOT reduce the timeout prematurely:

1. **During migration:** Keep 30 min timeout. Rust may encounter unexpected edge cases that take longer.
2. **After stabilization:** Reduce to `startToCloseTimeout: "10m"` for Rust-enabled activities. This catches hangs faster.
3. **Heartbeat timeout** stays at `"2m"` — Rust binary reports progress at least every 60 s.

#### Workspace Filesystem Cleanup

The current `cleanup-workspaces` workflow only deletes ArangoDB overlay entities and Prisma workspace records. Cloned repos on disk at `/data/workspaces/` accumulate forever.

Phase ∞ adds filesystem cleanup to the Rust `prepareWorkspace` binary:
- Before cloning, check if workspace directory exists and is stale (last modified > 7 days).
- After successful indexing, optionally clean up the `.scip` output files (large, not needed after parsing).
- A new `kap10-workspace-gc` binary runs as a cron-scheduled Temporal activity, removing workspace directories for repos that no longer exist in the relational store.

---

### 5. Phase Bridge

#### What Phase ∞ Inherits from All Previous Phases

| From Phase | What | How Phase ∞ uses it |
|------------|------|---------------------|
| **Phase 0** (Foundation) | Temporal infrastructure, ArangoDB schema, DI container | Rust binaries talk to same ArangoDB instance, called from same Temporal activities |
| **Phase 1** (Repo Indexing) | `prepareWorkspace`, `runSCIP`, `parseRest` activity contracts, `entityHash`, `edgeHash`, KIND_TO_COLLECTION | These are the exact contracts Rust must satisfy. Hash algorithm must be byte-identical. |
| **Phase 5** (Incremental Indexing) | Entity hash diff for incremental updates | Rust must produce identical entity hashes so incremental diff detects unchanged entities correctly |
| **Phase 3** (Semantic Search) | Embedding pipeline (light worker) | Unchanged — embeddings are network-bound (LLM calls), stay in TypeScript |

#### What Phase ∞ Establishes

1. **Rust binary sidecar pattern.** Future performance-critical features (e.g., real-time AST diffing, large-scale pattern matching) can follow the same pattern: Rust binary invoked from TypeScript wrapper via `execFileAsync`.
2. **Cross-language hash compatibility tests.** The entity hash compatibility suite is reusable for any future scenario where Rust and TypeScript must agree on deterministic output.
3. **Multi-stage Docker builds with Rust.** The Dockerfile pattern (compile in `rust:alpine`, copy binary to `node:bookworm-slim`) is reusable for any future Rust tooling.
4. **Feature flag migration pattern.** The `USE_RUST_{X}` flag pattern with shadow mode validation is reusable for any future incremental migration.

#### Boundary Constraints

- **Temporal workflows stay TypeScript.** Workflow definitions require deterministic replay via the JavaScript SDK. Only activities are candidates for Rust.
- **Light worker stays TypeScript.** All network-bound activities (LLM, embedding, ArangoDB writes from non-Rust paths, email, webhooks) remain in Node.js.
- **MCP server stays TypeScript.** Request/response handling is network-bound. No performance benefit from Rust.
- **Dashboard stays TypeScript.** Next.js frontend. No rewrite needed.
- **SCIP indexer binaries stay third-party.** `scip-typescript`, `scip-python`, `scip-go` are upstream tools. Phase ∞ only replaces the output *parser*, not the indexer itself.

---

## Part 2: Implementation & Tracing Tracker

### Layer: Infrastructure (INFRA)

- [ ] **INFRA-01: Initialize `workers/heavy-compute-rust/` Rust crate**
  - `cargo init --name kap10-heavy-worker workers/heavy-compute-rust`
  - Configure `Cargo.toml`: edition 2021, `[profile.release]` with `opt-level = 3`, `lto = true`, `panic = "abort"`, `strip = true`
  - Add `.cargo/config.toml` with musl cross-compilation targets
  - Add `rust-toolchain.toml` pinning stable channel (e.g., `1.82.0`)
  - **Test:** `cargo build --release --target x86_64-unknown-linux-musl` succeeds; binary is statically linked (`ldd` returns "not a dynamic executable")
  - **Notes:** Crate workspace lives outside the Node.js source tree. Not managed by pnpm.

- [ ] **INFRA-02: Add Rust crate dependencies**
  - `git2` (libgit2 bindings) — git clone, pull, index iteration
  - `prost` + `prost-build` — protobuf decoding from `.proto` schema
  - `tokio` (rt-multi-thread) — async runtime for HTTP/2 bulk writes
  - `reqwest` (with `http2` feature) — ArangoDB HTTP client
  - `serde` + `serde_json` — JSON serialization
  - `memmap2` — memory-mapped file I/O for SCIP indexes
  - `sha2` + `hex` — entity hash computation
  - `clap` — CLI argument parsing
  - `tracing` + `tracing-subscriber` — structured logging
  - `jemallocator` — memory allocator with stats (optional, for memory tracking)
  - **Test:** All dependencies resolve; `cargo check` passes
  - **Notes:** Pin major versions in `Cargo.toml` for reproducible builds

- [ ] **INFRA-03: Obtain and compile `scip.proto` schema**
  - Download official `scip.proto` from `sourcegraph/scip` repository
  - Place at `workers/heavy-compute-rust/proto/scip.proto`
  - Configure `prost-build` in `build.rs` to generate Rust types from the proto
  - **Test:** `cargo build` generates `scip.rs` with `Index`, `Document`, `Occurrence`, `Symbol` types
  - **Notes:** The proto schema is the authoritative definition — replaces the hand-rolled TypeScript varint decoder entirely

- [ ] **INFRA-04: Add feature flag environment variables**
  - `USE_RUST_PREPARE=true|false` (default: `false`)
  - `USE_RUST_SCIP=true|false` (default: `false`)
  - `USE_RUST_PARSE_REST=true|false` (default: `false`)
  - Add to `env.mjs` with Zod validation (optional string, `.refine()` for boolean parse)
  - **Test:** Flags parsed correctly; default to `false` when absent
  - **Notes:** Keep defaults `false` until each binary is validated in staging

- [ ] **INFRA-05: Add worker-tuning environment variables**
  - `WORKSPACE_BASE_PATH` (default: `/data/workspaces`) — replaces hardcoded path
  - `HEAVY_WORKER_CONCURRENCY` (default: `2`) — max concurrent activities per worker
  - `SCIP_PARSE_MAX_MEMORY_MB` (default: `1024`) — memory limit for Rust SCIP parser
  - `BULK_IMPORT_BATCH_SIZE` (default: `1000`) — ArangoDB batch size
  - Add to `env.mjs`
  - **Test:** Variables validated and accessible; defaults applied when absent
  - **Notes:** These apply to both TypeScript and Rust paths

- [ ] **INFRA-06: Update `Dockerfile.heavy-worker` for Rust binaries**
  - Add multi-stage build: `FROM rust:1.82-alpine AS rust-builder`
  - Copy `workers/heavy-compute-rust/` source
  - `cargo build --release --target x86_64-unknown-linux-musl`
  - Copy binaries to `/usr/local/bin/` in the final Node.js stage
  - Verify binaries are executable: `RUN kap10-scip-parse --version`
  - **Test:** Docker build succeeds; binary runs in container; static binary confirmed
  - **Notes:** ARM64 variant uses `aarch64-unknown-linux-musl` target. CI builds both architectures.

- [ ] **INFRA-07: Add CI pipeline for Rust crate**
  - GitHub Actions workflow: `cargo clippy`, `cargo test`, `cargo build --release`
  - Cross-compilation for both x86_64 and aarch64 musl targets
  - Entity hash compatibility test (Rust vs TypeScript) runs in CI
  - Cache `~/.cargo/registry` and `target/` between builds
  - **Test:** CI green on PR; clippy passes with zero warnings; all tests pass
  - **Notes:** Separate workflow from the existing Node.js CI. Triggered on changes to `workers/heavy-compute-rust/`

---

### Layer: Rust Binary Implementation (RUST)

- [ ] **RUST-01: Implement `entity_hash` module**
  - Port `entityHash(repoId, filePath, kind, name, signature?)` to Rust
  - Port `edgeHash(fromId, toId, kind)` to Rust
  - Use `sha2::Sha256` + `hex::encode`
  - NUL byte delimiter, empty string for missing signature, first 16 hex chars
  - **Test:** 10,000 hashes compared against TypeScript output — zero mismatches. Include edge cases: empty strings, Unicode file paths, NUL bytes in names (should not occur but must not panic)
  - **Notes:** This module is the single most critical compatibility piece. Test exhaustively.

- [ ] **RUST-02: Implement SCIP protobuf decoder**
  - `prost`-generated types from `scip.proto`
  - `scip::Index` → iterate `documents` → for each `Document`, extract `relative_path` and `occurrences`
  - `scip::Occurrence` → extract `range` (line/col), `symbol`, `symbol_roles`
  - Parse SCIP symbol string format to determine entity kind + name
  - Handle all symbol roles: definition, reference, implementation, type definition
  - **Test:** Parse a known `.scip` file (generated from the kap10-server codebase itself); verify entity/edge counts match TypeScript output; verify all entity types extracted correctly
  - **Notes:** Must handle field 7 (`enclosing_range`) which TypeScript skips — this enables parent-child relationships for methods within classes

- [ ] **RUST-03: Implement `mmap` file reader**
  - `memmap2::Mmap` for `.scip` file I/O
  - Validate file exists and is readable before mapping
  - Handle files > 4 GB (use 64-bit offsets)
  - Graceful error on permission denied, file not found, corrupted file
  - **Test:** Read a 100 MB test file via mmap; verify zero heap allocation for file I/O; verify error handling for missing/corrupted files
  - **Notes:** `mmap` on Linux requires the file to remain unchanged during processing. The SCIP indexer has already completed at this point, so this is safe.

- [ ] **RUST-04: Implement ArangoDB bulk import client**
  - `reqwest::Client` with HTTP/2 enabled
  - `POST /_api/import?collection={name}&type=documents&onDuplicate=update`
  - Request body: NDJSON (one JSON line per document)
  - Parallel streams: up to 4 concurrent batch uploads (configurable)
  - Parse response: count `created`, `updated`, `errors`; log per-document errors
  - Retry failed batches once with exponential backoff (1s, 2s)
  - Authentication: Basic auth via `--arango-auth` CLI arg (base64-encoded)
  - **Test:** Write 10,000 test documents to a test collection; verify all created; verify onDuplicate=update works; verify HTTP/2 negotiation; verify error handling for connection refused
  - **Notes:** Test against a real ArangoDB instance (Docker). Mock HTTP for unit tests.

- [ ] **RUST-05: Implement `kap10-scip-parse` binary**
  - CLI args: `--input`, `--repo-id`, `--workspace-dir`, `--arango-url`, `--arango-db`, `--arango-auth`, `--batch-size`, `--output-format` (`summary` | `json`)
  - Pipeline: open `.scip` via mmap → decode with prost → extract entities/edges → compute hashes → write to ArangoDB in streaming batches → report summary to stdout
  - Progress reporting to stderr: `PROGRESS:N` at 10% intervals
  - Memory tracking: log peak RSS at completion
  - **Test:** End-to-end test: generate `.scip` from a test repo → parse with Rust binary → verify entities in ArangoDB match TypeScript output
  - **Notes:** This is the first binary to ship. Highest impact, highest risk.

- [ ] **RUST-06: Implement `kap10-prepare-workspace` binary**
  - CLI args: `--repo-url`, `--branch`, `--workspace-dir`, `--github-token`, `--output-format`
  - Pipeline: clone or pull via `git2` → scan index for files → detect languages → detect monorepo roots → output JSON
  - `git2` credential callback: inject GitHub token as `x-access-token:{token}`
  - Progress reporting: clone progress via `git2::RemoteCallbacks::transfer_progress`
  - If workspace exists and is fresh (same branch, last pull < 5 min): skip clone, just scan
  - **Test:** Clone a public repo; verify file list matches `git ls-files` output; verify monorepo detection matches TypeScript output; verify credential injection works with private repos
  - **Notes:** Depends on RUST-01 for entity hashing (file entities created during scan)

- [ ] **RUST-07: Implement `kap10-parse-rest` binary**
  - CLI args: `--workspace-dir`, `--repo-id`, `--covered-files` (JSON array or file path), `--arango-url`, `--arango-db`, `--arango-auth`, `--batch-size`, `--output-format`
  - Pipeline: scan workspace → filter out SCIP-covered files → for uncovered files: read content → extract entities via tree-sitter grammars → compute hashes → write to ArangoDB
  - Use actual `tree-sitter` crate with language grammars (not regex) for entity extraction:
    - `tree-sitter-typescript` for `.ts`/`.tsx`/`.js`/`.jsx`
    - `tree-sitter-python` for `.py`
    - `tree-sitter-go` for `.go`
    - Generic line-count + file entity for all other extensions
  - **Test:** Parse a multi-language repo; verify entity types extracted correctly; verify uncovered-file filtering works; verify tree-sitter produces more accurate results than regex
  - **Notes:** Tree-sitter parsing in Rust is significantly more accurate than the current regex-based "parseWithTreeSitter" functions in TypeScript

- [ ] **RUST-08: Implement `kap10-workspace-gc` binary**
  - CLI args: `--base-path`, `--max-age-days`, `--dry-run`, `--output-format`
  - Pipeline: walk `/data/workspaces/` → for each `{orgId}/{repoId}/` directory, check last modified time → remove directories older than `max-age-days`
  - Dry-run mode lists directories that would be removed without deleting
  - **Test:** Create test directories with various ages; verify correct directories removed; verify dry-run doesn't delete; verify error handling for permissions
  - **Notes:** Addresses the missing filesystem cleanup in `cleanup-workspaces` workflow

---

### Layer: TypeScript Wrappers (WRAP)

- [ ] **WRAP-01: Create TypeScript wrapper for `kap10-scip-parse`**
  - In `lib/temporal/activities/indexing-heavy.ts`, add Rust path to `runSCIP`
  - Check `USE_RUST_SCIP` env flag
  - Build CLI args from activity input
  - `execFileAsync` with 10-minute timeout
  - Read stderr for `PROGRESS:N` lines → `heartbeat()`
  - Parse stdout JSON as activity return type
  - Map exit codes to Temporal failure types
  - **Test:** Mock `execFileAsync` → verify correct args passed; verify heartbeat called on progress lines; verify error mapping for each exit code
  - **Notes:** Original TypeScript implementation remains in the `else` branch — not deleted until post-stabilization

- [ ] **WRAP-02: Create TypeScript wrapper for `kap10-prepare-workspace`**
  - Same pattern as WRAP-01, in `prepareWorkspace` activity
  - Check `USE_RUST_PREPARE` env flag
  - Pass GitHub token via `--github-token` arg (sourced from `container.gitHost`)
  - **Test:** Verify correct args; verify token passing; verify error mapping
  - **Notes:** Requires `IGitHost` to expose the installation token — may need a new port method `getInstallationToken(repoId)`

- [ ] **WRAP-03: Create TypeScript wrapper for `kap10-parse-rest`**
  - Same pattern as WRAP-01, in `parseRest` activity
  - Check `USE_RUST_PARSE_REST` env flag
  - Pass `coveredFiles` as a temp JSON file (too large for CLI args)
  - **Test:** Verify correct args; verify temp file created and cleaned up; verify error mapping
  - **Notes:** Temp file at `/tmp/kap10-covered-{uuid}.json`, deleted in `finally` block

- [ ] **WRAP-04: Create shadow mode comparison utility**
  - When `SHADOW_MODE_SCIP=true`: run both TypeScript and Rust paths, compare outputs
  - Comparison: entity count match, edge count match, entity hash set intersection (should be 100%)
  - Log discrepancies to observability (Langfuse trace) with full diff details
  - Shadow mode adds latency (runs both paths) — only for staging validation
  - **Test:** With identical inputs, shadow mode reports 0 discrepancies; with intentionally different outputs, shadow mode logs the diff
  - **Notes:** One shadow mode env var per binary: `SHADOW_MODE_SCIP`, `SHADOW_MODE_PREPARE`, `SHADOW_MODE_PARSE_REST`

- [ ] **WRAP-05: Update `index-repo` workflow for summary-only returns**
  - When Rust activities are enabled, step 2 and 3 return summaries (not full entity arrays)
  - Remove the in-workflow array merge (`allEntities = [...]`) when using Rust path
  - Remove the `writeToArango` step when all Rust activities are enabled (they write directly)
  - Maintain backward compatibility: if any activity is still TypeScript, keep the old merge+write path
  - **Test:** Workflow completes successfully in all flag combinations (all TS, all Rust, mixed); entity counts match across configurations
  - **Notes:** Use a helper function `isRustEnabled(activity)` to check flags

---

### Layer: Database & Adapters (DB)

- [ ] **DB-01: Extract `WORKSPACE_BASE_PATH` to environment variable**
  - Replace hardcoded `/data/workspaces/{orgId}/{repoId}` in `indexing-heavy.ts:30` with `process.env.WORKSPACE_BASE_PATH`
  - Add to `env.mjs` with default `/data/workspaces`
  - Pass to Rust binaries via `--workspace-dir` arg
  - **Test:** Activity uses env var; default works; custom path works
  - **Notes:** Both TypeScript and Rust paths must use the same base path

- [ ] **DB-02: Add `IGitHost.getInstallationToken(repoId)` method**
  - New method on `IGitHost` port returning the GitHub App installation token
  - Needed for Rust binary to authenticate git clone without going through `simple-git`
  - Implementation in `GitHubHost` adapter: use existing Octokit auth flow
  - Token has 1-hour TTL — wrapper must fetch fresh token before each Rust invocation
  - **Test:** Token returned and valid; token used by Rust binary for clone; expired token triggers refresh
  - **Notes:** Token is passed as a CLI arg to the Rust binary. Sensitive — never log it.

- [ ] **DB-03: Create entity hash compatibility test suite**
  - Generate 10,000 test vectors: random repoIds, filePaths (including Unicode, deep nesting), kinds, names, signatures
  - Run through TypeScript `entityHash()` and `edgeHash()` functions
  - Export as JSON file: `workers/heavy-compute-rust/tests/hash-vectors.json`
  - Rust test reads the JSON file and verifies all 10,000 hashes match
  - **Test:** Zero mismatches across all vectors; includes edge cases (empty strings, max-length paths, emoji in names)
  - **Notes:** Regenerate vectors and re-run on every change to either hash implementation

- [ ] **DB-04: Create KIND_TO_COLLECTION validation test**
  - Extract the mapping from `arango-graph-store.ts`, `indexing-light.ts`, and the Rust `arango.rs` module
  - Test that all three are identical
  - Run in CI
  - **Test:** All three sources produce the same mapping; test fails if any source adds/removes a mapping without updating the others
  - **Notes:** Consider extracting the mapping to a shared JSON file that all three implementations read

---

### Layer: Testing (TEST)

- [ ] **TEST-01: Entity hash cross-language compatibility**
  - 10,000 test vectors (see DB-03)
  - Run in CI on every Rust or TypeScript hash change
  - Fail build on any mismatch
  - **Notes:** This is the most critical test in Phase ∞

- [ ] **TEST-02: SCIP parser output comparison**
  - Generate `.scip` files from 3 test repos (small/medium/large)
  - Parse with both TypeScript and Rust
  - Compare: entity count, edge count, entity key set, entity type distribution
  - Allow Rust to produce MORE entities (it handles proto fields that TypeScript skips) but never FEWER
  - **Notes:** Uses real `.scip` files committed to test fixtures

- [ ] **TEST-03: ArangoDB bulk import correctness**
  - Write 50,000 entities to a test ArangoDB instance via Rust binary
  - Read back via `arangojs` and verify document contents
  - Test `onDuplicate: "update"` by writing overlapping batches
  - Test partial failure recovery (kill ArangoDB mid-write, restart, re-run)
  - **Notes:** Integration test requiring Docker ArangoDB

- [ ] **TEST-04: Git clone equivalence**
  - Clone a test repo with both `simple-git` (TypeScript) and `git2` (Rust)
  - Compare: file list, file contents (SHA of each file), branch state
  - Test with GitHub token auth (private repo)
  - Test incremental pull (existing workspace + new commits)
  - **Notes:** Uses a dedicated test GitHub repo

- [ ] **TEST-05: Tree-sitter vs regex parser comparison**
  - Parse a multi-language test repo with both TypeScript regex parsers and Rust tree-sitter parsers
  - Compare entity extraction: Rust should find >= TypeScript entities (tree-sitter is more accurate)
  - Log entities found by Rust but missed by regex (expected) and vice versa (investigate)
  - **Notes:** Tree-sitter catches nested functions, decorated classes, complex generics that regex misses

- [ ] **TEST-06: Shadow mode end-to-end**
  - Enable all shadow mode flags on a staging environment
  - Run `index-repo` workflow for 10 repos spanning small (100 files), medium (2K files), and large (10K files)
  - Verify 0 entity hash discrepancies
  - Verify entity count within 5% (Rust may find more due to better parsing)
  - Log performance comparison (latency, memory)
  - **Notes:** This is the gate for promoting Rust to production

- [ ] **TEST-07: Memory profiling — Rust SCIP parser**
  - Parse a 100 MB `.scip` file with Rust binary under `valgrind --tool=massif` (or `/proc/self/status` tracking)
  - Verify peak RSS < 500 MB (target: 200 MB)
  - Verify no memory leaks (all allocations freed at exit)
  - Compare to TypeScript: run same `.scip` file with Node.js `--max-old-space-size=4096` and measure peak heap
  - **Notes:** Run in CI as a benchmark (non-blocking, log results)

- [ ] **TEST-08: Feature flag rollback**
  - Enable Rust path → run indexing → verify success
  - Disable Rust path → run indexing on same repo → verify TypeScript path still works
  - Verify ArangoDB state is consistent across both runs (idempotent writes)
  - **Notes:** Validates that flag toggling is safe and stateless

- [ ] **TEST-09: Concurrent activity execution**
  - Run 5 concurrent `runSCIP` activities on different repos
  - Verify no file locking conflicts (each repo has its own workspace directory)
  - Verify ArangoDB writes don't interfere across repos (different `_key` prefixes)
  - Verify total memory stays within container limit (5 × 200 MB < 2 GB)
  - **Notes:** Simulates production concurrency on a single worker instance

- [ ] **TEST-10: Dockerfile build verification**
  - Build `Dockerfile.heavy-worker` with Rust stage
  - Verify all 3 binaries exist at `/usr/local/bin/kap10-*`
  - Verify binaries are executable and return `--version` output
  - Verify binaries are statically linked (no shared library dependencies)
  - Run a smoke test inside the container: parse a bundled test `.scip` file
  - **Notes:** Runs in CI on every Dockerfile or Rust source change

- [ ] **TEST-11: Workflow compatibility — all flag combinations**
  - Test `index-repo` workflow with all 8 flag combinations (3 binary flags × on/off):
    - All TypeScript (baseline)
    - Only SCIP Rust
    - Only Prepare Rust
    - Only ParseRest Rust
    - SCIP + Prepare Rust
    - SCIP + ParseRest Rust
    - Prepare + ParseRest Rust
    - All Rust
  - Verify workflow completes successfully in all 8 configurations
  - Verify final ArangoDB state is identical across all 8 runs
  - **Notes:** This is the definitive compatibility test. Run against a real test repo.

- [ ] **TEST-12: Performance regression detection**
  - Benchmark suite tracking: clone time, SCIP parse time, bulk insert time, peak memory, total workflow time
  - Run on every PR to `workers/heavy-compute-rust/`
  - Alert if any metric regresses by > 10% from baseline
  - Store historical benchmark data for trend analysis
  - **Notes:** Use `criterion` crate for Rust microbenchmarks; Temporal workflow timing for macro benchmarks

---

### Implementation Priority & Dependencies

```
INFRA-01 ── INFRA-02 ── INFRA-03 ──┐
                                    ├── RUST-01 ── RUST-02 ── RUST-05 ── WRAP-01
                                    │              RUST-03 ──┘
INFRA-04 ── INFRA-05 ──────────────┤
                                    ├── RUST-04 ──────────── RUST-05, RUST-07
DB-01 ─────────────────────────────┤
DB-02 ─────────────────────────────┤── RUST-06 ── WRAP-02
DB-03 ── TEST-01                   │
                                    ├── RUST-07 ── WRAP-03
                                    │
INFRA-06 ── depends on all RUST-*  │
INFRA-07 ── depends on INFRA-01    │
                                    │
WRAP-04 ── depends on WRAP-01..03  │
WRAP-05 ── depends on WRAP-01..03  │
                                    │
RUST-08 ── standalone (no deps)    │
DB-04 ── depends on RUST-04        │

TEST-* items depend on their corresponding implementation items.
```

**Recommended implementation order:**

1. **Foundation** (INFRA-01–03, DB-01, DB-03) — Rust crate, proto schema, hash tests
2. **Entity hash** (RUST-01, TEST-01) — most critical compatibility piece, validate immediately
3. **SCIP parser** (RUST-02, RUST-03, RUST-04) — core modules
4. **First binary** (RUST-05, WRAP-01, INFRA-04) — `kap10-scip-parse` with feature flag
5. **Shadow validation** (WRAP-04, TEST-02, TEST-06) — compare Rust vs TypeScript output
6. **Docker integration** (INFRA-06, INFRA-07, TEST-10) — build and deploy
7. **Second binary** (RUST-06, DB-02, WRAP-02) — `kap10-prepare-workspace`
8. **Third binary** (RUST-07, WRAP-03) — `kap10-parse-rest` with real tree-sitter
9. **Workflow update** (WRAP-05, TEST-11) — summary-only returns, remove writeToArango hop
10. **Workspace GC** (RUST-08) — filesystem cleanup
11. **Performance tuning** (INFRA-05, TEST-07, TEST-09, TEST-12) — benchmarks and concurrency tests
12. **Stabilization** (TEST-08, DB-04) — rollback testing, mapping validation
