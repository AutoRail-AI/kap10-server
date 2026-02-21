# Phase 5.5 — Prompt Ledger, Rewind & Local Ingestion: Deep Dive & Implementation Tracker

> **Phase Feature Statement:** _"Every AI-generated change is tracked with the prompt that caused it. When the AI breaks something, I click 'Rewind' to restore to the last working state — and kap10 automatically creates a rule so the AI never makes that mistake again. After a rewind, all subsequent prompts appear as a new timeline branch. I can also index local repos that aren't on GitHub."_
>
> **Source:** [`VERTICAL_SLICING_PLAN.md`](./VERTICAL_SLICING_PLAN.md) — Phase 5.5
>
> **Prerequisites:** [Phase 1 — GitHub Connect & Repo Indexing](./PHASE_1_GITHUB_CONNECT_AND_INDEXING.md) (entities + call graph in ArangoDB, stable entity hashing, persistent workspace), [Phase 2 — Hosted MCP Server](./PHASE_2_HOSTED_MCP_SERVER.md) (MCP tools, workspace resolution, `sync_local_diff`, OTel spans), [Phase 3 — Semantic Search](./PHASE_3_SEMANTIC_SEARCH.md) (entity embeddings in pgvector, hybrid search), [Phase 4 — Business Justification & Taxonomy](./PHASE_4_BUSINESS_JUSTIFICATION_AND_TAXONOMY.md) (unified justifications, canonical value seeds), [Phase 5 — Incremental Indexing & GitHub Webhooks](./PHASE_5_INCREMENTAL_INDEXING_AND_GITHUB_WEBHOOKS.md) (push-based re-indexing, entity diff, cascade re-justification)
>
> **Database convention:** All kap10 Supabase tables use PostgreSQL schema `kap10`. ArangoDB collections are org-scoped (`org_{orgId}/`). See [VERTICAL_SLICING_PLAN.md § Storage & Infrastructure Split](./VERTICAL_SLICING_PLAN.md#storage--infrastructure-split).

---

## Table of Contents

- [Part 1: Architectural Deep Dive](#part-1-architectural-deep-dive)
  - [1.1 Core User Flows](#11-core-user-flows)
  - [1.2 System Logic & State Management](#12-system-logic--state-management)
  - [1.3 Reliability & Resilience](#13-reliability--resilience)
  - [1.4 Performance Considerations](#14-performance-considerations)
  - [1.5 Phase Bridge → Phase 6](#15-phase-bridge--phase-6)
- [Part 2: Implementation & Tracing Tracker](#part-2-implementation--tracing-tracker)
  - [2.1 Infrastructure Layer](#21-infrastructure-layer)
  - [2.2 Database & Schema Layer](#22-database--schema-layer)
  - [2.3 Ports & Adapters Layer](#23-ports--adapters-layer)
  - [2.4 Backend / API Layer](#24-backend--api-layer)
  - [2.5 Frontend / UI Layer](#25-frontend--ui-layer)
  - [2.6 Testing & Verification](#26-testing--verification)

---

## Canonical Terminology

> **CRITICAL:** Use these canonical names. See [Phase 4 § Canonical Terminology](./PHASE_4_BUSINESS_JUSTIFICATION_AND_TAXONOMY.md#canonical-terminology) for justification-related terms. See [Phase 5 § Canonical Terminology](./PHASE_5_INCREMENTAL_INDEXING_AND_GITHUB_WEBHOOKS.md#canonical-terminology) for incremental indexing terms.

| Canonical Term | DB Field (snake_case) | TS Field (camelCase) | Definition | NOT called |
|---|---|---|---|---|
| **Ledger Entry** | `ledger` (ArangoDB collection) | `LedgerEntry` (type) | An append-only record capturing `{prompt} → {changes}` for a single AI-generated modification. The atomic unit of the prompt ledger. | ~~log entry~~, ~~audit record~~, ~~change record~~ |
| **Working Snapshot** | `ledger_snapshots` (Supabase table) | `WorkingSnapshot` (type) | A frozen copy of affected file contents at a known-good point (tests pass, user marks working, or session start). Used as the rewind target. | ~~checkpoint~~, ~~save point~~, ~~backup~~ |
| **Timeline Branch** | `timeline_branch` | `timelineBranch` | An integer counter (0 = main timeline). Increments by 1 after each rewind. All subsequent ledger entries receive the new branch number. Conceptually like git branches but for prompt history. | ~~branch~~, ~~fork~~, ~~variant~~ |
| **Rewind** | `rewind_target_id` | `rewindTargetId` | The act of restoring files to a previous Working Snapshot. Creates a new Ledger Entry with status `working` and increments the Timeline Branch counter. | ~~undo~~, ~~rollback~~, ~~restore~~ |
| **Anti-Pattern Rule** | `rule_generated` | `ruleGenerated` | A Phase 6 rule auto-synthesized by the LLM after a Rewind, capturing what went wrong so the AI never makes the same mistake. Stored in the `rules` ArangoDB collection. | ~~lesson~~, ~~learned rule~~, ~~anti-rule~~ |
| **Ledger Summary** | `ledger_summaries` (ArangoDB collection) | `LedgerSummary` (type) | A commit-level roll-up aggregating all Ledger Entries from the active Timeline Branch into a single summary when the user commits. | ~~commit summary~~, ~~roll-up record~~ |
| **Local Repo** | `provider: "local_cli"` | `RepoProvider.local_cli` | A repository not hosted on GitHub, indexed via `kap10 push`. Has `githubRepoId = null` and `githubFullName = null` in Supabase. | ~~offline repo~~, ~~unhosted repo~~, ~~manual repo~~ |
| **Storage Provider** | — | `IStorageProvider` | The 12th hexagonal port. Abstracts pre-signed upload URLs, file download, and file deletion for Supabase Storage. Used by CLI upload and workspace preparation. | ~~file store~~, ~~blob store~~, ~~upload service~~ |
| **Drift Threshold** | — | `DRIFT_THRESHOLD` | The percentage of indexed files with local modifications (default: 20%) that triggers a CLI prompt to run `kap10 push`. | ~~stale threshold~~, ~~change threshold~~ |
| **Shadow Rewind** | — | `SimulateRewindResult` | A dry-run rewind that calculates the exact file-level impact of reverting to a Working Snapshot without actually applying changes. Compares the snapshot's files against the current local state (via MCP) to detect manual changes that would be overwritten. Returns a "Blast Radius Warning" if conflicts exist. | ~~dry run~~, ~~preview rewind~~, ~~rewind simulation~~ |
| **Anti-Pattern Vectorization** | — | `vectorizeAntiPattern` | After a rewind auto-generates a rule, the rule is embedded into the Phase 3 `pgvector` embedding pipeline and a background hybrid search scans the entire codebase for semantic matches to the newly discovered anti-pattern. Results are surfaced as proactive fix suggestions. | ~~pattern scan~~, ~~codebase audit~~, ~~retroactive scan~~ |
| **Ledger Circuit Breaker** | — | `LedgerCircuitBreaker` | An automated safety mechanism that detects AI hallucination loops (>4 consecutive `broken` ledger entries on the same function within 10 minutes). Forcefully injects a `system_halt` response to the agent, halting the loop and surfacing a clear message to the developer. | ~~rate limiter~~, ~~loop detector~~, ~~spam filter~~ |

---

# Part 1: Architectural Deep Dive

## 1.1 Core User Flows

Phase 5.5 has three distinct capability groups, each with its own user flows:
- **A. Prompt Ledger & Rewind** (Flows 1–4): The "black box recorder" for AI-assisted development
- **B. Local Repo Ingestion** (Flow 5): Index codebases not hosted on GitHub
- **C. Dashboard Timeline** (Flow 6): Visual timeline for prompt history and rewind actions

### Flow 1: Agent Makes Changes → Ledger Entry Created (Primary Flow)

**Actor:** AI coding agent (Cursor, Claude Code, Windsurf) via MCP
**Precondition:** Repo is in `ready` status. MCP session active. `sync_local_diff` tool available to the agent. Bootstrap Rule instructs the agent to call `sync_local_diff` with prompt metadata after every change.
**Outcome:** A Ledger Entry is appended to the ArangoDB `ledger` collection linking the user's prompt to the resulting code changes.

```
Step  Actor                           System Action                                             Outcome
────  ──────────────────────────────  ──────────────────────────────────────────────────────    ─────────────────────────
1     User prompts agent:             Agent processes prompt, modifies files                    Files changed locally
      "Add Apple Pay to checkout"

2     Agent calls sync_local_diff     sync tool receives:                                      —
      (as instructed by Bootstrap      { diff, branch, baseSha,
       Rule)                             prompt: "Add Apple Pay to checkout",
                                         agentModel: "claude-sonnet-4-20250514",
                                         agentTool: "cursor",
                                         mcpToolsCalled: ["get_function", "search_code"] }

3                                     sync_local_diff performs its existing logic:              Workspace overlay updated
                                       a) Filter lockfiles/build artifacts
                                       b) Acquire Redis distributed lock
                                       c) Parse diff hunks, update workspace overlay
                                       d) Return affected entities

4                                     NEW: After sync succeeds, append Ledger Entry:           Ledger Entry created
                                       a) Parse diff into per-file changes with line counts
                                       b) Match changed hunks to entity IDs where possible
                                       c) Set status = "pending" (not yet validated)
                                       d) Set parent_id = previous entry for this
                                          user/repo/branch (linked list)
                                       e) timeline_branch = current branch counter
                                       f) Write to ArangoDB `ledger` collection

5                                     Return to agent: existing sync response +                Agent receives confirmation
                                       { ledgerEntryId, timelineBranch }
```

**Key design decision:** Ledger Entry creation is piggybacked onto the existing `sync_local_diff` tool rather than introducing a separate `record_prompt` tool. This guarantees that every synced change has a ledger record — the agent cannot forget to call it. The `sync_local_diff` input schema gains three optional fields (`prompt`, `agentModel`, `agentTool`, `mcpToolsCalled`). If `prompt` is omitted (manual edit, legacy agents), the entry is recorded as `[manual edit — no agent prompt detected]`.

### Flow 2: State Validated → Working Snapshot Created

**Actor:** System (automated) or User (explicit)
**Precondition:** At least one Ledger Entry exists with status `pending`.
**Outcome:** A Working Snapshot is created in Supabase, capturing file contents at the known-good point.

```
Step  Actor                           System Action                                             Outcome
────  ──────────────────────────────  ──────────────────────────────────────────────────────    ─────────────────────────
1a    AUTOMATED: Agent calls           sync_local_diff receives diff with tests passing          —
      sync_local_diff and the          (detected via agent metadata or Bootstrap Rule
      Bootstrap Rule's post-flight      post-flight check_patterns result)
      reports "tests pass"

1b    MANUAL: User clicks "Mark        Dashboard sends POST /api/repos/{repoId}/timeline/        —
      as Working" in timeline           mark-working with { ledgerEntryId }

1c    SESSION START: First             sync_local_diff detects no prior snapshot for              —
      sync_local_diff call in a         this user/repo/branch session
      new session

2                                     Determine snapshot scope:                                  —
                                       a) Collect all files changed in pending entries
                                          since last snapshot
                                       b) Read current file contents from workspace overlay
                                          (or git working tree for session-start snapshots)

3                                     Write Working Snapshot to Supabase:                        Snapshot created
                                       { id, orgId, repoId, userId, branch,
                                         timelineBranch, ledgerEntryId,
                                         reason: "tests_passed" | "user_marked" |
                                                 "session_start",
                                         files: [{ filePath, content, entityHashes }],
                                         createdAt }

4                                     Update Ledger Entry status:                                Entry marked working
                                       entry.status = "working"
                                       entry.snapshot_id = snapshot.id
                                       entry.validated_at = now()

5                                     If reason == "session_start":                              Baseline established
                                       Mark all existing tracked files as baseline
                                       (no diff yet, just recording starting state)
```

**Why Supabase (not ArangoDB) for snapshots:** File content blobs can be large (full file contents). Supabase PostgreSQL handles JSONB storage efficiently and supports `pg_trgm` indexing for content search if needed later. ArangoDB is optimized for graph traversal, not blob storage. The `ledger` collection in ArangoDB stores metadata and diffs; the `ledger_snapshots` table in Supabase stores full file contents.

### Flow 3: Rewind to Working State (The Core Safety Feature)

**Actor:** User (via dashboard, CLI, or agent) or Agent (via MCP tool)
**Precondition:** At least one Working Snapshot exists. Current state is broken (tests fail, lint errors, or user judges the code is wrong).
**Outcome:** Files restored to the Working Snapshot. Timeline Branch incremented. Anti-Pattern Rule synthesized. Anti-pattern vectorized and codebase scanned for similar violations.

```
Step  Actor                           System Action                                             Outcome
────  ──────────────────────────────  ──────────────────────────────────────────────────────    ─────────────────────────
1     User/agent triggers rewind:     Receive rewind request:                                    —
      a) Agent calls                   { snapshotId?, files?, reason, dryRun?: boolean }
         revert_to_working_state
      b) User clicks "Rewind" in
         dashboard timeline
      c) User runs `kap10 rewind`

2                                     Resolve target snapshot:                                   —
                                       a) If snapshotId provided → fetch from Supabase
                                       b) If omitted → most recent snapshot where
                                          status == "working" for this user/repo/branch
                                       c) If no snapshot exists → error:
                                          "No working snapshot found. Mark current
                                           state as working first."

3                                     Determine files to revert:                                 —
                                       a) If specific files[] requested → filter snapshot
                                       b) If omitted → all files in the snapshot
                                       c) Validate all requested files exist in snapshot

3.5                                   SHADOW REWIND (Blast Radius Check):                        Conflict report
                                       a) For each file in the revert set, query current
                                          local state via MCP workspace overlay
                                       b) Compute AST diff between snapshot version and
                                          current local version
                                       c) Classify each file:
                                          - "clean_revert": file matches a known ledger
                                            entry state → safe to revert
                                          - "manual_conflict": file has changes NOT tracked
                                            in any ledger entry → user made manual edits
                                            on top of the AI's code
                                          - "stale_snapshot": snapshot is outdated relative
                                            to current branch HEAD
                                       d) Build blast radius report:
                                          { safeFiles: [...], conflictedFiles: [...],
                                            manualChangesAtRisk: [{filePath, lineRanges}] }
                                       e) If dryRun == true → return report immediately
                                          WITHOUT applying rewind (simulation only)
                                       f) If conflicts exist AND dryRun != true:
                                          Return warning with report + confirmation prompt:
                                          "⚠️ Rewinding will overwrite your manual changes
                                           to auth.ts (lines 42-67) and utils.ts (lines 3-15).
                                           Proceed? Pass { force: true } to confirm."
                                       g) If no conflicts → proceed to step 4

4                                     Create Rewind Ledger Entry:                                Rewind entry appended
                                       { prompt: "REWIND: {reason}",
                                         changes: [per-file {filePath, changeType: "modified",
                                                    diff: "[rewind to snapshot]"}],
                                         status: "working",
                                         rewind_target_id: snapshot.id,
                                         parent_id: latest entry,
                                         blast_radius: { safeFiles, conflictedFiles } }

5                                     Increment Timeline Branch:                                 New branch created
                                       a) Read current max timeline_branch for this
                                          user/repo/branch
                                       b) Set new value = max + 1
                                       c) All subsequent entries will use new branch number

6                                     Mark intermediate entries as "reverted":                   Failed entries marked
                                       All entries between the snapshot's ledger_entry_id
                                       and the rewind entry (exclusive) get
                                       status = "reverted"

7                                     Synthesize Anti-Pattern Rule (async):                      Rule queued
                                       a) Collect all entries being reverted (the "failed"
                                          entries)
                                       b) Extract their prompts and diffs
                                       c) Queue anti-pattern synthesis via light-llm-queue
                                          (not blocking the rewind response)
                                       d) When rule is ready, update rewind entry:
                                          rule_generated = rule.id

7.5                                   ANTI-PATTERN VECTORIZATION (async):                        Proactive scan queued
                                       (runs after rule synthesis completes — chained activity)
                                       a) Embed the newly generated anti-pattern rule's
                                          description + title into pgvector via Phase 3's
                                          nomic-embed-text pipeline
                                       b) Execute hybrid search (keyword + semantic) against
                                          the ENTIRE codebase's entity embeddings
                                       c) For each entity matching the anti-pattern
                                          (cosine similarity > 0.75):
                                          - Create a "proactive_fix" notification:
                                            "You rewound the AI for: {rule.title}.
                                             kap10 found {N} other places with this
                                             same pattern. Review them?"
                                          - Store matches in the rule document:
                                            rule.codebase_matches = [{entityKey, filePath,
                                              entityName, similarity, snippet}]
                                       d) Dashboard surfaces these matches on the Rules page
                                          and in the Activity Feed

8                                     Return restored files:                                     Files delivered
                                       { restoredFiles: [{path, content}],
                                         newTimelineBranch: N,
                                         blastRadius: { safeFiles, conflictedFiles },
                                         antiPatternRule: {id, title} | null,
                                         message: "Reverted N files..." }

9     Agent applies restored files    Agent writes file contents to disk                         Local state restored
      (if triggered via MCP)
      OR CLI writes files locally
      (if triggered via CLI)
      OR Dashboard shows diff
      (if triggered via UI)
```

**Critical invariant:** A Rewind never deletes Ledger Entries. The entries are marked `reverted`, preserving the full audit trail. The Timeline Branch mechanism ensures the post-rewind timeline is separate and clean.

**Shadow Rewind design rationale:** The Shadow Rewind (step 3.5) provides psychological safety. Developers will trust the "Rewind" button because kap10 warns them before destroying manual work. The `dryRun` mode allows agents and the CLI to simulate rewinds non-destructively, which is essential for AI agents that may want to evaluate whether a rewind is safe before committing to it.

### Flow 4: Roll-Up on Commit

**Actor:** System (automated, triggered by commit detection)
**Precondition:** Uncommitted Ledger Entries exist. User commits their code (detected via `sync_local_diff` receiving a new `baseSha`).
**Outcome:** All pending entries on the active Timeline Branch are marked `committed` and a Ledger Summary is created.

```
Step  Actor                           System Action                                             Outcome
────  ──────────────────────────────  ──────────────────────────────────────────────────────    ─────────────────────────
1     User commits code               Next sync_local_diff call detects baseSha changed         —
      (git commit locally)             from last known SHA

2                                     Identify active Timeline Branch:                           —
                                       Query max(timeline_branch) for user/repo/branch

3                                     Get uncommitted entries on active branch:                   —
                                       status IN ("pending", "working") AND
                                       commit_sha IS NULL AND
                                       timeline_branch == active branch

4                                     Mark all as committed:                                      Entries finalized
                                       FOR each entry:
                                         entry.status = "committed"
                                         entry.commit_sha = new baseSha

5                                     Create Ledger Summary in ArangoDB:                          Summary created
                                       { commit_sha, repo_id, user_id, branch,
                                         entry_count, prompt_summary (joined prompts),
                                         total_files_changed, total_lines_added,
                                         total_lines_removed, rewind_count,
                                         rules_generated, created_at }

6                                     Reset Timeline Branch to 0:                                 Clean slate
                                       Next session starts on branch 0
```

### Flow 5: Local Repo Ingestion via CLI

**Actor:** Developer (not using GitHub)
**Precondition:** `@autorail/kap10` installed. User authenticated via `kap10 auth login`.
**Outcome:** Local codebase is indexed into kap10's knowledge graph, queryable via MCP.

```
Step  Actor                           System Action                                             Outcome
────  ──────────────────────────────  ──────────────────────────────────────────────────────    ─────────────────────────
1     User runs:                      CLI sends POST /api/cli/init:                              —
      kap10 init --org my-org          { orgId, repoName (from package.json or dir name),
                                         defaultBranch (from git) }

2                                     Server creates Repo in Supabase:                           Repo registered
                                       { provider: "local_cli",
                                         githubRepoId: null,
                                         githubFullName: null,
                                         status: "pending" }
                                       Returns { repoId, apiKey }

3                                     CLI writes .kap10/config.json:                             Config saved
                                       { repoId, orgId, apiKey, createdAt }
                                       CLI adds .kap10/ to .gitignore if not present

4     User runs:                      CLI performs .gitignore-aware zip:                          Zip created
      kap10 push                       a) Read .gitignore rules + hardcoded exclusions
                                          (node_modules, .git, dist, build, __pycache__)
                                       b) Zip using archiver library
                                       c) Log: "Zipping repo... {size}MB"

5                                     CLI calls POST /api/cli/index:                             Upload URL received
                                       { repoId, phase: "request_upload" }
                                       Server generates pre-signed upload URL via
                                       IStorageProvider.generateUploadUrl():
                                       bucket: "cli_uploads"
                                       path: "{orgId}/{repoId}/{timestamp}.zip"
                                       expiry: 600s (10 minutes)

6                                     CLI uploads zip directly to Supabase Storage                Zip uploaded
                                       via pre-signed URL (bypasses Vercel — no timeout
                                       or body limit). Shows progress bar.

7                                     CLI calls POST /api/cli/index:                             Indexing triggered
                                       { repoId, phase: "trigger_index",
                                         storagePath: "{orgId}/{repoId}/{timestamp}.zip" }
                                       Server triggers indexRepoWorkflow via Temporal
                                       with provider: "local_cli" and storagePath

8                                     indexRepoWorkflow prepareWorkspace activity:                Workspace ready
                                       a) Detects provider == "local_cli"
                                       b) Calls IStorageProvider.downloadFile() for the zip
                                       c) Extracts zip to /data/workspaces/{orgId}/{repoId}/
                                       d) Continues with normal SCIP + entity extraction
                                          (same pipeline as GitHub repos)

9                                     After indexing completes:                                   Cleanup done
                                       a) IStorageProvider.deleteFile() removes the zip
                                       b) Repo status set to "ready"
                                       c) CLI receives webhook/poll notification
```

**Why pre-signed upload:** Vercel serverless functions have a 30-second timeout and 4.5 MB body limit. Codebases routinely exceed both. The pre-signed URL lets the CLI upload directly to Supabase Storage, bypassing Vercel entirely. The server only handles lightweight JSON requests.

**Sync Drift for Local Repos:** Unlike GitHub repos (where webhooks notify of changes), local repos have no push event. The codebase drifts between `kap10 push` invocations. Three mitigation strategies:

| Strategy | Mechanism | When |
|---|---|---|
| **Manual re-push** | User runs `kap10 push` whenever they want the index updated | Always available |
| **Drift detection** | `kap10 watch` tracks local file modifications. If >20% of indexed files have changed (`DRIFT_THRESHOLD`), prompts user to run `kap10 push` | During active development |
| **Incremental push (future)** | Phase 5's incremental indexing extended to accept diffs from CLI | Post-Phase 5.5 enhancement |

### Flow 6: Dashboard Timeline View

**Actor:** Developer viewing prompt history
**Precondition:** At least one Ledger Entry exists for the repo.
**Outcome:** Visual timeline showing prompts, changes, working/broken states, rewind points, and Timeline Branches as parallel lanes.

```
Step  Actor                           System Action                                             Outcome
────  ──────────────────────────────  ──────────────────────────────────────────────────────    ─────────────────────────
1     User navigates to               Page loads, calls GET /api/repos/{repoId}/timeline         —
      /repos/{repoId}/timeline         { branch, userId?, limit: 50, cursor? }

2                                     Server queries ArangoDB ledger collection:                  Entries returned
                                       FOR entry IN ledger
                                         FILTER entry.org_id == @orgId
                                         AND entry.repo_id == @repoId
                                         AND entry.branch == @branch
                                         SORT entry.created_at DESC
                                         LIMIT @limit
                                         RETURN entry

3                                     Server groups entries by timeline_branch:                   Grouped data
                                       Branch 0: [S1✓, S2✓, S3✗, S4✗, REWIND→S2]
                                       Branch 1: [S5, S6✓, S7✓]

4                                     Client renders timeline:                                   Timeline displayed
                                       a) Main lane (branch 0) with status indicators
                                       b) Rewind points shown as branch connectors
                                       c) Post-rewind lanes shown as parallel tracks
                                       d) Each entry shows: prompt excerpt, file count,
                                          line counts, status badge, timestamp
                                       e) Click entry → detail view with full diff

5     User clicks a Ledger Entry      Detail view loads:                                         Detail displayed
                                       a) Full prompt text
                                       b) Per-file diffs (syntax highlighted)
                                       c) Entities affected (linked to graph)
                                       d) Anti-Pattern Rule (if rewind generated one)
                                       e) Working Snapshot link (if one was created)
```

---

## 1.2 System Logic & State Management

### 1.2.1 Ledger Entry State Machine

A Ledger Entry progresses through a strict state machine:

```
                    ┌──────────────────────────────────────────────────┐
                    │                                                  │
                    ▼                                                  │
              ┌──────────┐     validation     ┌──────────┐            │
  created →   │ pending  │ ───────────────→   │ working  │            │
              └──────────┘     passes         └──────────┘            │
                    │                               │                  │
                    │ validation                    │ commit           │
                    │ fails                         │ detected         │
                    ▼                               ▼                  │
              ┌──────────┐                   ┌───────────┐            │
              │  broken  │                   │ committed │            │
              └──────────┘                   └───────────┘            │
                    │                                                  │
                    │ rewind                                           │
                    │ targets this                                     │
                    │ or later entry                                   │
                    ▼                                                  │
              ┌──────────┐                                            │
              │ reverted │ ───────────────────────────────────────────┘
              └──────────┘   (rewind creates new entry on new branch)
```

**Transition rules:**
- `pending → working`: Tests pass, user marks working, or session-start baseline
- `pending → broken`: Tests fail or lint errors detected
- `pending → committed`: User commits before validation (valid — not all workflows validate)
- `working → committed`: Normal commit after validation
- `broken → committed`: User commits despite broken state (their choice — we track it)
- `{pending, working, broken} → reverted`: A Rewind targets a snapshot before this entry
- `reverted`: Terminal state. Never transitions again. Entry preserved for audit.
- `committed`: Terminal state. Linked to a git commit SHA.

### 1.2.2 Timeline Branching Model

```
Timeline Branch 0 (main):
  ┌─────┐    ┌─────┐    ┌─────┐    ┌─────┐    ┌───────────┐
  │ E1  │ →  │ E2  │ →  │ E3  │ →  │ E4  │ →  │  REWIND   │
  │ ✓   │    │ ✓   │    │ ✗   │    │ ✗   │    │  → E2     │
  └─────┘    └─────┘    └─────┘    └─────┘    └─────┬─────┘
                                                     │
Timeline Branch 1 (post-rewind):                     │
                                                ┌────▼────┐    ┌─────┐    ┌─────┐
                                                │ E5      │ →  │ E6  │ →  │ E7  │
                                                │ (new)   │    │ ✓   │    │ ✗   │
                                                └─────────┘    └─────┘    └──┬──┘
                                                                             │
Timeline Branch 2 (second rewind):                                           │
                                                                        ┌────▼────┐    ┌─────┐
                                                                        │ E8      │ →  │ E9  │
                                                                        │ (new)   │    │ ✓   │
                                                                        └─────────┘    └─────┘

Legend: ✓ = working, ✗ = broken, E = entry
```

**Invariants:**
- Branch 0 is always the main timeline from session start
- `timeline_branch` increments monotonically — never decremented (except on commit roll-up reset)
- A Rewind always creates a new entry on the **new** branch (the rewind entry itself has the incremented branch number)
- Entries on reverted branches keep their original `timeline_branch` value (immutable)
- On commit roll-up, only entries from the **active** (highest-numbered) branch are marked `committed`
- After commit, `timeline_branch` resets to 0 for the next session

### 1.2.3 ArangoDB Schema — Ledger Collections

Phase 5.5 utilizes the already-bootstrapped `ledger` document collection (declared in `arango-graph-store.ts` `DOC_COLLECTIONS` but currently empty of implementation). Two additional collections are added:

**`ledger` collection (append-only):**

```json
{
  "_key": "entry_uuid",
  "org_id": "org_123",
  "repo_id": "repo_456",
  "user_id": "user_789",
  "branch": "main",
  "timeline_branch": 0,

  "prompt": "Add Apple Pay to the checkout flow",
  "agent_model": "claude-sonnet-4-20250514",
  "agent_tool": "cursor",
  "mcp_tools_called": ["get_function", "search_code"],

  "changes": [
    {
      "file_path": "src/checkout/payment.ts",
      "entity_id": "fn_abc123",
      "change_type": "modified",
      "diff": "--- a/src/checkout/payment.ts\n+++ b/...",
      "lines_added": 15,
      "lines_removed": 3
    }
  ],

  "status": "working",
  "parent_id": "entry_previous_uuid",
  "rewind_target_id": null,
  "commit_sha": null,
  "snapshot_id": "snap_uuid",
  "validated_at": "2026-02-21T10:30:05Z",
  "rule_generated": null,
  "created_at": "2026-02-21T10:30:00Z"
}
```

**Indexes on `ledger`:**
- `{ org_id, repo_id, user_id, branch, timeline_branch, created_at }` — primary timeline query
- `{ org_id, repo_id, branch, status }` — uncommitted entry lookup
- `{ parent_id }` — linked list traversal

**`ledger_summaries` collection (commit roll-ups):**

```json
{
  "_key": "summary_uuid",
  "commit_sha": "abc123def",
  "org_id": "org_123",
  "repo_id": "repo_456",
  "user_id": "user_789",
  "branch": "main",
  "entry_count": 7,
  "prompt_summary": "Add Apple Pay → Fix import → Update types → REWIND → Add Apple Pay (retry) → Fix tests → Polish UI",
  "total_files_changed": 4,
  "total_lines_added": 89,
  "total_lines_removed": 12,
  "rewind_count": 1,
  "rules_generated": ["rule_uuid_1"],
  "created_at": "2026-02-21T11:45:00Z"
}
```

**Indexes on `ledger_summaries`:**
- `{ org_id, repo_id, branch, created_at }` — commit history query
- `{ commit_sha }` — lookup by commit (unique within org scope)

### 1.2.4 Supabase Schema — Working Snapshots

Working Snapshots live in Supabase because they contain large file content blobs unsuitable for ArangoDB's document model:

```sql
-- Migration: Phase 5.5 Ledger Snapshots
CREATE TABLE kap10.ledger_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          TEXT NOT NULL,
  repo_id         TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  branch          TEXT NOT NULL,
  timeline_branch INTEGER NOT NULL DEFAULT 0,
  ledger_entry_id TEXT NOT NULL,
  reason          TEXT NOT NULL CHECK (reason IN ('tests_passed', 'user_marked', 'commit', 'session_start')),
  files           JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ledger_snapshots_timeline
  ON kap10.ledger_snapshots (org_id, repo_id, user_id, branch, timeline_branch, created_at DESC);

CREATE INDEX idx_ledger_snapshots_entry
  ON kap10.ledger_snapshots (ledger_entry_id);

-- Snapshot retention: auto-delete snapshots older than 30 days
-- (managed by cleanupWorkspacesWorkflow cron, not a DB trigger)
```

**Prisma model addition:**

```prisma
model LedgerSnapshot {
  id              String   @id @default(uuid())
  orgId           String   @map("org_id")
  repoId          String   @map("repo_id")
  userId          String   @map("user_id")
  branch          String
  timelineBranch  Int      @default(0) @map("timeline_branch")
  ledgerEntryId   String   @map("ledger_entry_id")
  reason          String
  files           Json
  createdAt       DateTime @default(now()) @map("created_at")

  @@index([orgId, repoId, userId, branch])
  @@map("ledger_snapshots")
  @@schema("kap10")
}
```

### 1.2.5 Supabase Schema — RepoProvider Enum Extension

```sql
-- Migration: Add local_cli to RepoProvider enum
ALTER TYPE kap10."RepoProvider" ADD VALUE IF NOT EXISTS 'local_cli';
```

The `Repo` model's `githubRepoId` and `githubFullName` fields are already nullable (`BigInt?` and `String?`), intentionally designed for this extension. No Repo model changes needed beyond the enum value.

### 1.2.6 IStorageProvider — 12th Port

Phase 5.5 introduces the 12th hexagonal port:

```
// lib/ports/storage-provider.ts
interface IStorageProvider {
  generateUploadUrl(bucket, path, expiresInSeconds?): Promise<string>
  downloadFile(bucket, path): Promise<Buffer>
  deleteFile(bucket, path): Promise<void>
  healthCheck(): Promise<{ status: "up" | "down", latencyMs: number }>
}
```

**Production adapter:** `SupabaseStorageAdapter` wrapping `@supabase/storage-js`. Bucket: `cli_uploads`. Objects stored at `{orgId}/{repoId}/{timestamp}.zip`. Auto-cleaned after indexing completes.

**Test fake:** `InMemoryStorageProvider` — stores files in a `Map<string, Buffer>`. Returns `data:` URLs for `generateUploadUrl()`. Added to `lib/di/fakes.ts`.

**DI container:** `createProductionContainer()` gains a 12th getter. `createTestContainer()` wires `InMemoryStorageProvider`.

### 1.2.7 Anti-Pattern Rule Synthesis

After every Rewind, the system asynchronously synthesizes a rule to prevent the same mistake:

**Input to LLM:**
1. The rewind `reason` (user-provided explanation of what went wrong)
2. All "failed" Ledger Entries being reverted (their prompts and diffs)
3. The Working Snapshot being restored to (file paths and entity hashes)

**Output shape (Zod-validated):**

```
AntiPatternRule {
  title: string              // Short rule name, e.g. "Do not use Library X for auth"
  description: string        // Why harmful, what to do instead
  type: "architectural"      // Always architectural for rewind-generated rules
  scope: "repo"              // Scoped to this repo
  enforcement: "warn"|"block"
  semgrepRule?: string       // Semgrep YAML if the pattern is statically detectable
}
```

The rule is stored in ArangoDB's `rules` collection (already bootstrapped by Phase 1). When Phase 6 ships, these rules are automatically enforced by the `check_patterns` MCP tool. Until Phase 6, the rules are surfaced in the dashboard Rules tab and returned by `get_conventions` MCP tool.

**Cost control:** Anti-pattern synthesis uses `gpt-4o-mini` (not full `gpt-4o`) and is capped at 2K input + 400 output tokens. The LLM call is queued on `light-llm-queue` and runs asynchronously — the Rewind response returns immediately without waiting for rule generation.

### 1.2.8a Anti-Pattern Vectorization (Proactive Healing)

After anti-pattern rule synthesis completes, a chained activity embeds the rule and proactively scans the codebase for existing violations:

```
Anti-Pattern Vectorization Pipeline:

Input: Newly synthesized AntiPatternRule { title, description, semgrepRule? }
Config: SIMILARITY_THRESHOLD = 0.75, MAX_MATCHES = 20

1. Embed the anti-pattern:
   a) Combine title + description into a single text block
   b) Call Phase 3's nomic-embed-text pipeline to generate embedding vector
   c) Store in pgvector alongside entity embeddings:
      INSERT INTO kap10.rule_embeddings (rule_id, embedding, created_at)

2. Search for existing violations:
   a) Execute Phase 3's hybrid search (keyword + semantic) against
      the repo's entity_embeddings table:
      - Keyword: key terms from the rule title (e.g., "eval", "SQL injection")
      - Semantic: cosine similarity against the rule embedding
   b) Filter results: similarity > SIMILARITY_THRESHOLD
   c) Cap at MAX_MATCHES (20) — prioritize by similarity score
   d) For each match, extract a code snippet (first 10 lines of entity body)

3. Store matches on the rule document:
   rule.codebase_matches = [
     { entityKey, entityName, filePath, startLine, similarity, snippet }
   ]
   rule.scan_status = "complete"
   rule.scan_completed_at = now()

4. Create notification:
   INSERT INTO public.notifications:
     { type: "warning", title: "Anti-pattern found in codebase",
       message: "You rewound the AI for '{rule.title}'. kap10 found
                 {matchCount} other places with this same pattern.",
       link: "/repos/{repoId}/rules/{ruleId}",
       metadata: { ruleId, matchCount } }

5. If semgrepRule is present (static pattern):
   Queue background Semgrep scan on matched files for precise validation:
   a) Run semgrep --config {tempYaml} on each matched file
   b) Promote matches confirmed by Semgrep to "verified" status
   c) Demote unconfirmed matches to "probable" status
```

**Why this matters:** kap10 doesn't just learn from mistakes — it actively hunts them down. The dashboard will show: _"You rewound the AI for a SQL injection vulnerability. kap10 found 3 other places the AI made this exact mistake last week. Would you like to fix them?"_ This transforms anti-pattern rules from passive guards into active codebase healers.

### 1.2.8b Ledger Circuit Breaker (Hallucination Loop Detection)

**Problem:** If an AI agent enters a "hallucination loop" — repeatedly trying to fix a bug, failing, generating a rule, trying again, failing — it can spam the ArangoDB ledger with hundreds of useless branches in minutes, burning the Langfuse/Stripe budget (Phase 8) with each cascade re-justification and anti-pattern synthesis.

**Solution:** Implement an automated multi-agent circuit breaker in the Temporal workflow that manages the Ledger. When the system detects a rapid pattern of consecutive failures on the same function, it forcefully injects a `system_halt` command that the MCP server returns to the agent, breaking the loop.

```
Circuit Breaker Algorithm:

Trigger Point: Inside sync_local_diff, after Ledger Entry creation

Monitoring State (per-function, in Redis):
  Key: kap10:circuit:{orgId}:{repoId}:{entityKey}
  Value: { brokenCount: number, firstBrokenAt: ISO string }
  TTL: 10 minutes (auto-resets)

Detection Logic:
  On each Ledger Entry with status == "broken":
    1. Extract affected entity keys from the entry's changes
    2. For each entity key:
       a) Increment Redis counter: INCR kap10:circuit:{orgId}:{repoId}:{entityKey}
       b) If counter == 1: SET firstBrokenAt = now(), EXPIRE 10min
       c) Read current counter value

    3. If counter >= CIRCUIT_BREAKER_THRESHOLD (default: 4):
       → CIRCUIT BREAKER TRIPPED

  On each Ledger Entry with status == "working" or "committed":
    → Reset counters for all affected entity keys (DEL Redis keys)
    → Agent found a working solution — loop broken naturally

Trip Response:
  When circuit breaker trips:
    1. Return special MCP response to agent:
       {
         content: [{
           type: "text",
           text: "🛑 kap10 Circuit Breaker triggered: You are in an AI hallucination
                  loop on function `{entityName}` ({brokenCount} consecutive failures
                  in {elapsedMinutes} minutes).

                  STOP automated attempts. Recommended actions:
                  1. Read the function's source code manually (get_function tool)
                  2. Write a failing test first before modifying
                  3. Review the anti-pattern rules generated from your previous attempts
                  4. Ask the human developer for guidance

                  Circuit will auto-reset in {remainingMinutes} minutes."
         }],
         _meta: {
           circuitBreaker: {
             tripped: true,
             entityKey: "...",
             entityName: "...",
             brokenCount: 4,
             windowMinutes: 10,
             resetsAt: "ISO timestamp"
           }
         }
       }

    2. Create dashboard notification:
       { type: "error", title: "Circuit Breaker: AI loop on {entityName}",
         message: "{brokenCount} failures in {minutes}min. Agent halted.",
         link: "/repos/{repoId}/timeline" }

    3. Log to Langfuse (Phase 8):
       { event: "circuit_breaker_trip", entityKey, brokenCount, totalTokensWasted }

    4. BLOCK further sync_local_diff calls that modify this entity:
       For the next CIRCUIT_BREAKER_COOLDOWN (default: 5 min),
       if sync_local_diff changes include this entity key,
       return the halt message instead of processing the sync.

  Cooldown Reset:
    After CIRCUIT_BREAKER_COOLDOWN expires:
      Redis key auto-expires (TTL) → circuit resets
      Next sync_local_diff for this entity processes normally

  Manual Override:
    User can call: POST /api/repos/{repoId}/circuit-breaker/reset
    Or CLI: kap10 circuit-reset [--entity <key>]
    This manually DELs the Redis keys, immediately re-enabling the entity.
```

**Configuration:**
- `CIRCUIT_BREAKER_THRESHOLD` env var (default: 4 — consecutive broken entries before trip)
- `CIRCUIT_BREAKER_WINDOW_MINUTES` env var (default: 10 — sliding window for counting failures)
- `CIRCUIT_BREAKER_COOLDOWN_MINUTES` env var (default: 5 — how long entity is blocked after trip)
- `CIRCUIT_BREAKER_ENABLED` env var (default: true — can disable for testing)

**Why Redis (not ArangoDB):** Circuit breaker state is ephemeral — it needs sub-millisecond reads on every `sync_local_diff` call and auto-expiry via TTL. ArangoDB transactions would add unacceptable latency to the sync hot path. Redis atomic `INCR` + `EXPIRE` is the perfect primitive for this.

### 1.2.8 sync_local_diff Extension

The existing `sync_local_diff` MCP tool (`lib/mcp/tools/sync.ts`) gains new optional input fields:

```
// Additional fields on sync_local_diff input schema
{
  // ... existing fields: diff, branch, baseSha ...

  prompt?: string,              // The user's prompt to the AI agent
  agentModel?: string,          // e.g. "claude-sonnet-4-20250514"
  agentTool?: string,           // e.g. "cursor", "claude-code", "windsurf"
  mcpToolsCalled?: string[],    // Which kap10 tools the agent used before this sync
  validationResult?: {          // Post-change validation result
    testsPass: boolean,
    lintPass: boolean,
    checkPatternsPass: boolean,
  }
}
```

**Behavioral changes:**
1. After existing sync logic completes, if `prompt` is present → append Ledger Entry
2. If `validationResult.testsPass && validationResult.lintPass` → auto-create Working Snapshot
3. If `baseSha` changed since last call → trigger commit roll-up
4. Return includes `{ ledgerEntryId, timelineBranch }` in response

This is an additive, backward-compatible change. Agents not sending `prompt` still work — they just get `[manual edit]` ledger entries.

---

## 1.3 Reliability & Resilience

### 1.3.1 Failure Scenarios

| # | Failure | Detection | Recovery | Data Risk |
|---|---------|-----------|----------|-----------|
| 1 | **ArangoDB down during ledger append** | Write throws `ArangoError` | Retry 3× with exponential backoff (200ms, 400ms, 800ms). If all fail, `sync_local_diff` still succeeds (ledger is optional). Log warning. Buffer entry in Redis (`kap10:ledger:buffer:{entryId}`, TTL 1h). Background job retries from buffer. | Low — sync succeeds, ledger entry deferred |
| 2 | **Supabase down during snapshot creation** | Insert throws Prisma error | Retry 2× (500ms, 1000ms). If fails, ledger entry stays `pending` (not marked `working`). Next validation attempt will re-try snapshot creation. | Low — no snapshot created, but entry is safe |
| 3 | **LLM timeout during anti-pattern synthesis** | Temporal activity timeout (30s) | Retry via Temporal's built-in retry policy (3 attempts, backoff). If all fail, rewind entry gets `rule_generated = null`. Rule can be manually triggered from dashboard. | None — rewind already completed |
| 4 | **Concurrent rewinds by same user** | Redis lock `kap10:lock:rewind:{userId}:{repoId}:{branch}` | Second rewind request waits for lock (max 5s). If lock not acquired, return error: "Another rewind is in progress." | None — serialized via lock |
| 5 | **CLI upload interrupted** | Pre-signed URL expires (10 min) | User re-runs `kap10 push`. Server generates a new pre-signed URL. Previous partial upload is orphaned in storage (cleaned by retention policy). | None — re-upload is idempotent |
| 6 | **CLI upload succeeds but trigger fails** | CLI receives error from POST /api/cli/index | CLI retries trigger call 2× (same storagePath). Idempotent — server checks if workflow already running for this repoId before starting. | None — zip exists in storage, workflow can be triggered |
| 7 | **Large snapshot exceeds Supabase row size** | JSONB insert exceeds 1GB Postgres limit | Extremely unlikely (would need 1GB+ of file content). Mitigation: Cap snapshot at 100 files. If more files changed, snapshot only the most recently modified 100. Log warning. | Low — partial snapshot better than none |
| 8 | **Timeline Branch counter corruption** | Counter skips values or goes negative | Branch counter is always `MAX(timeline_branch) + 1` query, never stored as a separate mutable counter. Cannot corrupt — derived from data. | None — mathematically sound |
| 9 | **Orphaned entries after crash** | Entries stuck in `pending` indefinitely | `cleanupWorkspacesWorkflow` (existing 15-min cron) extended to: mark entries older than 24h with status `pending` as `broken` (assumption: validation never came). | Low — conservative timeout |
| 10 | **CLI .kap10/config.json deleted** | `kap10 push` fails with "Not initialized" | User re-runs `kap10 init`. Server detects existing repo by orgId + repoName match and returns existing repoId instead of creating duplicate. | None — idempotent init |

### 1.3.2 Append-Only Guarantee

The `ledger` collection is **append-only by contract**. No ArangoDB method on `IGraphStore` may delete or update the `_key`, `prompt`, `changes`, `parent_id`, or `created_at` fields of an existing ledger entry. The only mutable fields are:
- `status` (state machine transitions only, validated in code)
- `commit_sha` (set once on commit, never changed)
- `snapshot_id` (set once on validation, never changed)
- `validated_at` (set once, never changed)
- `rule_generated` (set once after anti-pattern synthesis, never changed)

This is enforced at the adapter level — the `updateLedgerEntry` method validates that only permitted fields are being changed and that the state transition is valid.

### 1.3.3 Rewind Atomicity

A Rewind must be atomic — either all of these happen or none:
1. Rewind Ledger Entry created
2. Timeline Branch incremented (via new entry's branch number)
3. Intermediate entries marked `reverted`

This is achieved via an ArangoDB transaction (multi-document write within the `ledger` collection). ArangoDB supports ACID transactions within a single collection, which suffices here since all writes are to `ledger`.

---

## 1.4 Performance Considerations

### 1.4.1 Latency Budgets

| Operation | Target Latency | Bottleneck | Mitigation |
|---|---|---|---|
| **Ledger Entry append** | <50ms | ArangoDB single-doc insert | Append-only (no index updates beyond timestamp). Entry created in parallel with sync response — if append is slow, sync response returns first and entry is buffered. |
| **Working Snapshot creation** | <200ms | Supabase JSONB insert | File contents already in memory from sync. Single insert, no joins. Size bounded by number of changed files (typically <20). |
| **Rewind (complete)** | <500ms | ArangoDB transaction (update N entries) + Supabase snapshot read | AQL transaction batches all status updates. Snapshot read is a single indexed query. Anti-pattern synthesis is async (not in critical path). |
| **Timeline query (50 entries)** | <100ms | ArangoDB AQL query + network | Composite index on `{org_id, repo_id, branch, created_at}`. Cursor-based pagination — no OFFSET. |
| **Commit roll-up** | <300ms | ArangoDB batch update + summary insert | Batch update via AQL `FOR entry IN ledger FILTER ... UPDATE entry WITH { status: "committed" }`. Single summary insert. |
| **CLI zip + upload (100MB repo)** | <30s | Network upload speed | Direct-to-storage upload (no Vercel proxy). Pre-signed URL avoids double hop. Progress bar gives user feedback. |
| **CLI init** | <2s | Server round-trip + config write | Lightweight JSON request. Idempotent (re-init returns existing repoId). |

### 1.4.2 Storage Growth

**Ledger entries:** ~1KB per entry (prompt + diff metadata, NOT full file contents). At 50 entries/day per active developer, ~50KB/day. 10 developers × 365 days = ~180MB/year. Trivial for ArangoDB.

**Working Snapshots:** Variable — depends on file sizes. Bounded by `files` array size. Mitigation:
- Cap at 100 files per snapshot (log warning if exceeded)
- Auto-delete snapshots older than 30 days (via `cleanupWorkspacesWorkflow`)
- Store only files that changed since the last snapshot (incremental)

**Ledger Summaries:** ~500 bytes per commit. Even at 20 commits/day × 365 days × 10 developers = ~35MB/year. Negligible.

**CLI uploads:** Zip files auto-deleted after indexing. No long-term storage cost.

### 1.4.3 Concurrency

- **Ledger appends** are non-blocking — each entry has a unique `_key` (UUID). No contention.
- **Rewinds** are serialized per user/repo/branch via Redis lock (prevents conflicting branch operations).
- **Snapshots** have no uniqueness constraint — worst case, two concurrent validations create two snapshots for the same entry. Harmless — rewind uses the most recent one.
- **CLI uploads** are per-repo — no concurrency issue. Multiple users pushing to different repos upload in parallel. Same user pushing to the same repo: second push waits for first indexing to complete (Temporal workflow dedup by `workflowId: index-{orgId}-{repoId}`).

---

## 1.5 Phase Bridge → Phase 6

Phase 5.5 establishes foundational infrastructure that Phase 6 (Pattern Enforcement & Rules Engine) directly consumes:

### What Phase 6 Inherits

| Phase 5.5 Artifact | Phase 6 Consumption |
|---|---|
| `rules` collection entries (from Anti-Pattern Rule synthesis) | Phase 6's `check_patterns` MCP tool queries all active rules including rewind-generated ones. They become first-class citizens alongside ast-grep detected patterns. |
| `ledger` collection (prompt → change history) | Phase 6's pattern detection pipeline uses ledger data to identify recurring AI mistakes (same anti-pattern appearing in multiple sessions → auto-escalate rule priority). |
| `ledger_summaries` (commit-level AI contribution) | Phase 6's architecture health report includes "AI change velocity" metrics derived from summaries. |
| `IStorageProvider` (12th port) | Phase 6 reuses for storing Semgrep YAML rule files and ast-grep pattern libraries. |
| CLI auth + init flow | Phase 6's CLI extensions (`kap10 check`, `kap10 rules`) reuse the same auth and config infrastructure. |

### What Phase 5.5 Must NOT Do (Respecting Phase 6 Boundaries)

1. **Must NOT implement `check_patterns` MCP tool.** Phase 5.5 stores rules in the `rules` collection but does not enforce them. Enforcement is Phase 6's responsibility.
2. **Must NOT run ast-grep or Semgrep.** Anti-pattern rules may include a `semgrepRule` YAML string, but Phase 5.5 never executes it. The rule is stored as data for Phase 6 to consume.
3. **Must NOT implement pattern detection pipeline.** Phase 5.5 only generates rules reactively (from rewinds), never proactively (from codebase analysis).
4. **Must NOT modify the Bootstrap Rule's `check_patterns` call.** Phase 5.5 adds `sync_local_diff` prompt tracking but does not alter how the Bootstrap Rule invokes pattern checking (that's Phase 6).

### Schema Forward-Compatibility

- The `rules` collection schema from Phase 1 already supports `type: "architectural"`, `scope: "repo"`, `enforcement: "warn"|"block"`, and `status: "active"`. Phase 5.5's Anti-Pattern Rules are fully compatible — no schema migration needed.
- Phase 6 will add `type: "syntactic"` and `scope: "workspace"` values, but Phase 5.5 rules won't use them.
- The `semgrepRule` field on Anti-Pattern Rules is nullable and stored as a string. Phase 6 will parse and execute it. Phase 5.5 just stores it as LLM output.

---

# Part 2: Implementation & Tracing Tracker

> **Dependency graph:** Infrastructure (P5.5-INFRA) → Database (P5.5-DB) → Ports & Adapters (P5.5-ADAPT) → Backend (P5.5-API) → Frontend (P5.5-UI). Testing (P5.5-TEST) runs in parallel with each layer.
>
> **Recommended implementation order:** P5.5-DB-01 → P5.5-DB-02 → P5.5-ADAPT-01 → P5.5-ADAPT-02 → P5.5-API-01 → P5.5-API-02 → P5.5-API-03 → P5.5-API-04 → P5.5-API-05 → P5.5-DB-03 → P5.5-ADAPT-03 → P5.5-ADAPT-04 → P5.5-API-06 → P5.5-API-07 → P5.5-API-08 → P5.5-API-09 → P5.5-UI-01 → P5.5-UI-02 → P5.5-UI-03 → P5.5-API-10

---

## 2.1 Infrastructure Layer

### P5.5-INFRA-01: Supabase Storage Bucket

- [x] **Status:** Complete
- **Description:** Create the `cli_uploads` bucket in Supabase Storage for CLI zip uploads. Configure:
  - Bucket type: Private (no public access)
  - Max file size: 500MB
  - Allowed MIME types: `application/zip`, `application/x-zip-compressed`
  - RLS policies: Only authenticated users with matching `orgId` can upload/download
  - Auto-expiry: Objects older than 24h are cleaned by `cleanupWorkspacesWorkflow`
- **Files:**
  - `supabase/migrations/2026XXXX_phase55_cli_uploads_bucket.sql` (new)
- **Testing:** Bucket exists in Supabase dashboard. Pre-signed URL generation works. Upload + download cycle succeeds.
- **Notes:** —

### P5.5-INFRA-02: CLI Package Scaffolding Verification

- [x] **Status:** Complete
- **Description:** The `packages/cli/` directory already exists with auth, pull, and serve commands. Verify existing infrastructure works and extend `package.json` with new dependencies needed for Phase 5.5 commands (`archiver` for zipping, `ignore` for .gitignore parsing, `chokidar` for file watching, `cli-progress` for upload progress bar).
- **Files:**
  - `packages/cli/package.json` (modify — add dependencies)
  - `packages/cli/src/index.ts` (modify — register new commands)
- **Testing:** `pnpm install` succeeds. Existing commands (`auth`, `pull`, `serve`) still work.
- **Notes:** The existing CLI uses CozoDB for local graph store, commander for CLI, and msgpackr for serialization.

---

## 2.2 Database & Schema Layer

### P5.5-DB-01: ArangoDB Ledger Collection Indexes

- [x] **Status:** Complete
- **Description:** The `ledger` collection is already bootstrapped in `DOC_COLLECTIONS` in `arango-graph-store.ts`. Add required composite indexes for timeline queries, uncommitted entry lookup, and linked list traversal. Also bootstrap the `ledger_summaries` collection (add to `DOC_COLLECTIONS`).
- **Files:**
  - `lib/adapters/arango-graph-store.ts` (modify — add `"ledger_summaries"` to `DOC_COLLECTIONS`, add indexes in `bootstrapGraphSchema()`)
- **Testing:** `bootstrapGraphSchema()` creates indexes. AQL queries use indexes (explain plan shows index scan, not full scan).
- **Notes:** Indexes: `ledger: {org_id, repo_id, user_id, branch, timeline_branch, created_at}`, `{org_id, repo_id, branch, status}`, `{parent_id}`. `ledger_summaries: {org_id, repo_id, branch, created_at}`, `{commit_sha}`.

### P5.5-DB-02: Supabase Migration — Ledger Snapshots Table

- [x] **Status:** Complete
- **Description:** Create the `kap10.ledger_snapshots` table and add `local_cli` to the `RepoProvider` enum. Add Prisma model `LedgerSnapshot`.
- **Files:**
  - `supabase/migrations/2026XXXX_phase55_ledger_snapshots.sql` (new)
  - `prisma/schema.prisma` (modify — add `LedgerSnapshot` model, add `local_cli` to `RepoProvider` enum)
- **Testing:** `pnpm migrate` succeeds. `LedgerSnapshot` CRUD operations work via Prisma. `RepoProvider.local_cli` is a valid enum value.
- **Notes:** Run `pnpm prisma generate` after schema change. The `files` field is `Json` type — Prisma handles JSONB serialization.

### P5.5-DB-03: Domain Types — LedgerEntry, WorkingSnapshot, LedgerSummary

- [x] **Status:** Complete
- **Description:** Add TypeScript domain types to `lib/ports/types.ts` for the ledger data model. These are the canonical types used by ports and adapters.
- **Shapes:**
  - `LedgerEntry`: `{ id, orgId, repoId, userId, branch, timelineBranch, prompt, agentModel?, agentTool?, mcpToolsCalled?, changes: LedgerChange[], status, parentId, rewindTargetId, commitSha, snapshotId, validatedAt, ruleGenerated, createdAt }`
  - `LedgerChange`: `{ filePath, entityId?, changeType: "added"|"modified"|"deleted", diff, linesAdded, linesRemoved }`
  - `WorkingSnapshot`: `{ id, orgId, repoId, userId, branch, timelineBranch, ledgerEntryId, reason: "tests_passed"|"user_marked"|"commit"|"session_start", files: SnapshotFile[], createdAt }`
  - `SnapshotFile`: `{ filePath, content, entityHashes: string[] }`
  - `LedgerSummary`: `{ id, commitSha, orgId, repoId, userId, branch, entryCount, promptSummary, totalFilesChanged, totalLinesAdded, totalLinesRemoved, rewindCount, rulesGenerated: string[], createdAt }`
- **Files:**
  - `lib/ports/types.ts` (modify — add types)
- **Testing:** Types compile. Used by port interfaces and adapter implementations.
- **Notes:** Follow existing patterns in `types.ts` (e.g., `EntityDoc`, `EdgeDoc`).

---

## 2.3 Ports & Adapters Layer

### P5.5-ADAPT-01: IGraphStore — Ledger Methods

- [x] **Status:** Complete
- **Description:** Extend the `IGraphStore` port interface with ledger-specific methods. These are append-only operations — no delete methods.
- **Methods to add:**
  - `appendLedgerEntry(orgId, entry): Promise<LedgerEntry>` — Insert a new Ledger Entry. Validates entry shape.
  - `updateLedgerEntryStatus(orgId, entryId, update): Promise<void>` — Update only permitted mutable fields (`status`, `commit_sha`, `snapshot_id`, `validated_at`, `rule_generated`). Validates state machine transitions.
  - `queryLedgerTimeline(orgId, repoId, branch, opts): Promise<LedgerEntry[]>` — Query entries with cursor-based pagination, optional filters by `userId`, `timelineBranch`, `status`.
  - `getUncommittedEntries(orgId, repoId, userId, branch, timelineBranch): Promise<LedgerEntry[]>` — Entries where `status IN ("pending", "working") AND commit_sha IS NULL`.
  - `getMaxTimelineBranch(orgId, repoId, userId, branch): Promise<number>` — Highest `timeline_branch` value.
  - `markEntriesReverted(orgId, entryIds: string[]): Promise<void>` — Batch update status to `reverted` (ArangoDB transaction).
  - `appendLedgerSummary(orgId, summary): Promise<LedgerSummary>` — Insert commit roll-up summary.
  - `queryLedgerSummaries(orgId, repoId, branch, opts): Promise<LedgerSummary[]>` — Paginated summaries.
- **Files:**
  - `lib/ports/graph-store.ts` (modify — add methods to `IGraphStore`)
- **Testing:** Interface compiles. Fake and adapter both implement all methods.
- **Notes:** Existing `IGraphStore` pattern: methods take `orgId` as first arg for tenant scoping. Follow existing naming conventions.
- **Blocked by:** P5.5-DB-03

### P5.5-ADAPT-02: ArangoGraphStore — Ledger Implementation

- [x] **Status:** Complete
- **Description:** Implement the ledger methods in `ArangoGraphStore`. Key considerations:
  - `appendLedgerEntry`: Simple `collection.save()`. Generate UUID `_key`.
  - `updateLedgerEntryStatus`: Validate state transition against state machine before writing. Reject invalid transitions (e.g., `committed → pending`).
  - `queryLedgerTimeline`: AQL with composite index. Cursor-based pagination via `created_at` + `_key` cursor token.
  - `markEntriesReverted`: ArangoDB transaction wrapping batch update + rewind entry insert.
  - All methods scope to `org_{orgId}` database (existing tenant isolation pattern).
- **Files:**
  - `lib/adapters/arango-graph-store.ts` (modify — implement methods)
- **Testing:** Unit tests with real ArangoDB (existing test pattern in `lib/adapters/__tests__/`). Verify state machine enforcement. Verify transaction atomicity for rewind.
- **Notes:** Follow existing adapter patterns: `const db = this.getOrgDb(orgId); const col = db.collection("ledger");`
- **Blocked by:** P5.5-ADAPT-01, P5.5-DB-01

### P5.5-ADAPT-03: IStorageProvider Port + SupabaseStorageAdapter

- [x] **Status:** Complete
- **Description:** Create the 12th hexagonal port `IStorageProvider` and its production adapter.
- **Port interface:**
  - `generateUploadUrl(bucket, path, expiresInSeconds?): Promise<string>`
  - `downloadFile(bucket, path): Promise<Buffer>`
  - `deleteFile(bucket, path): Promise<void>`
  - `healthCheck(): Promise<{ status: "up"|"down", latencyMs: number }>`
- **Production adapter:** `SupabaseStorageAdapter` wrapping `@supabase/storage-js`. Lazy initialization (same `require()` pattern as other adapters).
- **Test fake:** `InMemoryStorageProvider` — `Map<string, Buffer>` backing store. `generateUploadUrl()` returns `data:` URL.
- **Files:**
  - `lib/ports/storage-provider.ts` (new)
  - `lib/adapters/supabase-storage.ts` (new)
  - `lib/di/fakes.ts` (modify — add `InMemoryStorageProvider`)
  - `lib/di/container.ts` (modify — add `storageProvider` getter)
  - `lib/di/__tests__/port-compliance.test.ts` (modify — add 12th port test)
- **Testing:** Port compliance test passes. Fake stores and retrieves files. Production adapter health check returns `up` with valid credentials.
- **Notes:** Follow existing lazy init pattern: `get storageProvider() { const { SupabaseStorageAdapter } = require("../adapters/supabase-storage"); ... }`
- **Blocked by:** P5.5-INFRA-01

### P5.5-ADAPT-04: InMemoryGraphStore — Ledger Fake

- [x] **Status:** Complete
- **Description:** Implement the ledger methods in `InMemoryGraphStore` (the test fake). Use in-memory arrays sorted by `createdAt`. State machine validation must be identical to the production adapter.
- **Files:**
  - `lib/di/fakes.ts` (modify — implement ledger methods on `InMemoryGraphStore`)
- **Testing:** All ledger unit tests pass with both fake and real adapters.
- **Notes:** Reuse the state machine validation logic — extract to a shared `validateLedgerTransition(from, to)` function in `lib/ports/types.ts`.
- **Blocked by:** P5.5-ADAPT-01

---

## 2.4 Backend / API Layer

### P5.5-API-01: sync_local_diff Extension — Prompt Tracking

- [x] **Status:** Complete
- **Description:** Extend the existing `sync_local_diff` MCP tool to accept prompt metadata and append Ledger Entries. This is the primary integration point — no separate "record prompt" tool.
- **Changes:**
  - Add optional input fields: `prompt`, `agentModel`, `agentTool`, `mcpToolsCalled`, `validationResult`
  - After existing sync logic succeeds, call `graphStore.appendLedgerEntry()` with the sync result + prompt metadata
  - If `validationResult` indicates tests/lint pass, auto-create Working Snapshot via `relationalStore.createLedgerSnapshot()`
  - If `baseSha` changed since last call, trigger commit roll-up
  - Add `ledgerEntryId` and `timelineBranch` to response
  - Wrap ledger operations in try/catch — sync must succeed even if ledger fails (log warning, buffer in Redis)
- **Files:**
  - `lib/mcp/tools/sync.ts` (modify)
- **Testing:** Existing sync tests still pass. New tests: prompt metadata appears in ledger entry. Missing prompt defaults to `[manual edit]`. Validation result triggers snapshot. baseSha change triggers roll-up. Ledger failure doesn't break sync.
- **Blocked by:** P5.5-ADAPT-02, P5.5-DB-02

### P5.5-API-02: revert_to_working_state MCP Tool (with Shadow Rewind)

- [x] **Status:** Complete
- **Description:** New MCP tool for rewind functionality with integrated blast radius checking. Accessible to AI agents and CLI.
- **Input schema:**
  - `snapshotId?: string` — Specific snapshot to revert to. If omitted, uses most recent working snapshot.
  - `files?: string[]` — Specific files to revert. If omitted, reverts all files changed since the snapshot.
  - `reason: string` — Why the rewind is needed (used for anti-pattern rule synthesis).
  - `dryRun?: boolean` — If `true`, simulate the rewind and return a blast radius report without applying changes. Default: `false`.
  - `force?: boolean` — If `true`, proceed with rewind even if manual change conflicts are detected. Default: `false`.
- **Handler logic:**
  1. Resolve target snapshot (Supabase query)
  2. Determine files to revert (filter snapshot files)
  3. **Shadow Rewind**: For each file, compare snapshot version against current local state (via workspace overlay). Classify as `clean_revert`, `manual_conflict`, or `stale_snapshot`.
  4. If `dryRun == true` → return blast radius report immediately (no changes applied)
  5. If conflicts exist AND `force != true` → return warning with blast radius report + confirmation prompt
  6. If no conflicts OR `force == true`:
     a. ArangoDB transaction: Create rewind Ledger Entry (with blast_radius metadata) + mark intermediate entries `reverted`
     b. Queue anti-pattern synthesis on `light-llm-queue`
     c. Return `{ restoredFiles, blastRadius, newTimelineBranch, antiPatternRule: null, message }`
- **Scope:** `mcp:sync` (same as `sync_local_diff`)
- **Files:**
  - `lib/mcp/tools/rewind.ts` (new)
  - `lib/use-cases/shadow-rewind.ts` (new — blast radius calculator)
  - `lib/mcp/tools/index.ts` (modify — register tool)
- **Testing:** Rewind with valid snapshot returns file contents. Rewind without snapshot uses most recent. Rewind with specific files filters correctly. No snapshot returns error. Timeline branch increments. Intermediate entries marked reverted. **NEW:** dryRun returns blast radius report only. Conflicted files trigger warning. force=true bypasses warning. Manual changes detected correctly.
- **Blocked by:** P5.5-API-01

### P5.5-API-03: get_timeline MCP Tool

- [x] **Status:** Complete
- **Description:** New MCP tool to query the prompt ledger timeline. Agents use this to understand what changes have been made and their status.
- **Input schema:**
  - `branch?: string` — Git branch to query (default: current workspace branch)
  - `limit?: number` — Max entries to return (default: 20, max: 100)
  - `status?: string` — Filter by status
  - `includeReverted?: boolean` — Include reverted entries (default: false)
- **Response:** Array of `{ id, prompt, agentTool, filesChanged, linesAdded, linesRemoved, status, timelineBranch, createdAt }`
- **Scope:** `mcp:read`
- **Files:**
  - `lib/mcp/tools/timeline.ts` (new)
  - `lib/mcp/tools/index.ts` (modify — register tool)
- **Testing:** Returns entries in chronological order. Respects branch filter. Pagination works. Reverted entries excluded by default, included when requested.
- **Blocked by:** P5.5-ADAPT-02

### P5.5-API-04: mark_working MCP Tool

- [x] **Status:** Complete
- **Description:** New MCP tool for explicitly marking the current state as a Working Snapshot. Used when the agent or user is confident the current state is good.
- **Input schema:**
  - `reason?: string` — Why this state is being marked working (default: "user_marked")
- **Handler logic:**
  1. Find the most recent `pending` Ledger Entry for this user/repo/branch
  2. Create Working Snapshot from current workspace overlay files
  3. Update entry status to `working`
- **Scope:** `mcp:sync`
- **Files:**
  - `lib/mcp/tools/timeline.ts` (same file as get_timeline)
  - `lib/mcp/tools/index.ts` (modify — register tool)
- **Testing:** Creates snapshot. Entry status changes to working. No pending entries returns error.
- **Blocked by:** P5.5-API-01

### P5.5-API-05: Anti-Pattern Rule Synthesis Activity

- [x] **Status:** Complete
- **Description:** Temporal activity that runs on `light-llm-queue` after a rewind. Collects failed entries, builds LLM prompt, validates output via Zod, and stores the rule in ArangoDB's `rules` collection.
- **Activity:** `synthesizeAntiPatternRule(orgId, repoId, rewindEntryId, failedEntryIds, reason)`
- **LLM details:**
  - Model: `gpt-4o-mini` (cost-efficient for rule generation)
  - Token budget: 2K input, 400 output
  - Output validated against `AntiPatternRuleSchema` (Zod)
  - On validation failure: retry once with adjusted prompt. If still fails, log warning and skip rule.
- **Files:**
  - `lib/temporal/activities/anti-pattern.ts` (new)
  - `lib/temporal/activities/index.ts` (modify — export)
- **Testing:** Valid rewind → rule generated with correct shape. LLM failure → graceful degradation (no rule, no crash). Rule stored in `rules` collection with `createdBy: "system:rewind"`, `priority: 10`.
- **Blocked by:** P5.5-ADAPT-02

### P5.5-API-05a: Anti-Pattern Vectorization Activity

- [x] **Status:** Complete
- **Description:** Chained Temporal activity that runs after rule synthesis completes. Embeds the anti-pattern rule and proactively scans the codebase for existing violations.
- **Activity:** `vectorizeAntiPattern(orgId, repoId, ruleId)`
- **Pipeline:**
  1. Fetch rule from ArangoDB `rules` collection
  2. Combine `title + description` into embedding input text
  3. Call Phase 3 nomic-embed-text to generate embedding vector
  4. Store in `kap10.rule_embeddings` pgvector table (new table, same schema as `entity_embeddings`)
  5. Execute hybrid search against repo's `entity_embeddings`: keyword extraction from title + cosine similarity against rule embedding
  6. Filter: similarity > 0.75, cap at 20 matches
  7. For each match: extract entity snippet (first 10 lines of body)
  8. Update rule document: `codebase_matches = [{ entityKey, entityName, filePath, startLine, similarity, snippet }]`, `scan_status = "complete"`
  9. Create notification in `public.notifications` with `type: "warning"` and link to rule detail page
  10. If `semgrepRule` is present on the rule: queue background Semgrep verification on matched files (promote confirmed → "verified", demote unconfirmed → "probable")
- **Files:**
  - `lib/temporal/activities/anti-pattern.ts` (modify — add vectorization activity)
  - `supabase/migrations/2026XXXX_phase55_rule_embeddings.sql` (new — `kap10.rule_embeddings` table)
- **Testing:** Rule embedded successfully. Hybrid search returns matching entities. Matches stored on rule document. Notification created. Zero matches → scan_status still "complete" with empty array. LLM/embedding failure → graceful skip (scan_status = "failed"). Semgrep verification promotes/demotes correctly.
- **Blocked by:** P5.5-API-05, Phase 3 embedding pipeline

### P5.5-API-05b: Ledger Circuit Breaker

- [x] **Status:** Complete
- **Description:** Implement hallucination loop detection in `sync_local_diff`. Uses Redis atomic counters to track consecutive `broken` entries per entity within a sliding window.
- **Behavior:**
  1. On each `broken` ledger entry: increment Redis counter for affected entity keys
  2. If counter >= `CIRCUIT_BREAKER_THRESHOLD` (default: 4) within `CIRCUIT_BREAKER_WINDOW_MINUTES` (default: 10): trip circuit breaker
  3. Trip response: return `system_halt` MCP response with explanation and recommended actions
  4. Block further sync_local_diff calls for affected entity during cooldown
  5. Create dashboard notification and Langfuse event
  6. Auto-reset via Redis TTL, or manual reset via API/CLI
- **Redis keys:** `kap10:circuit:{orgId}:{repoId}:{entityKey}` with `{ brokenCount, firstBrokenAt }`, TTL = window minutes
- **Manual override:** `POST /api/repos/{repoId}/circuit-breaker/reset`, `kap10 circuit-reset`
- **Files:**
  - `lib/mcp/tools/sync.ts` (modify — add circuit breaker check before and after ledger append)
  - `lib/mcp/security/circuit-breaker.ts` (new — circuit breaker logic)
  - `app/api/repos/[repoId]/circuit-breaker/reset/route.ts` (new — manual reset endpoint)
  - `packages/cli/src/commands/circuit-reset.ts` (new — CLI reset command)
- **Testing:** 4 consecutive broken entries on same entity → circuit trips. Working entry resets counter. Cooldown blocks sync for affected entity. Auto-reset after TTL. Manual reset via API. `CIRCUIT_BREAKER_ENABLED=false` → disabled. Non-affected entities not blocked.
- **Blocked by:** P5.5-API-01
- **Notes:** —

### P5.5-API-06: CLI `kap10 init` Command

- [x] **Status:** Complete
- **Description:** Register a local repo for kap10 indexing. Creates `.kap10/config.json` with `repoId`, `orgId`, and API key. Calls `POST /api/cli/init` to register the repo in Supabase with `provider: "local_cli"`.
- **Behavior:**
  1. Read org from `--org` flag (or prompt user)
  2. Detect repo name from `package.json` name field, or directory name as fallback
  3. Detect default branch from `git rev-parse --abbrev-ref HEAD` or default to "main"
  4. Call `POST /api/cli/init` with `{ orgId, repoName, defaultBranch }`
  5. Server creates `Repo` row with `provider: "local_cli"`, returns `{ repoId, apiKey }`
  6. Write `.kap10/config.json` to repo root
  7. Add `.kap10/` to `.gitignore` if not already present
- **Idempotency:** If `.kap10/config.json` exists and `repoId` matches server, skip creation. If server has a repo with matching `orgId + repoName + provider: "local_cli"`, return existing repoId.
- **Files:**
  - `packages/cli/src/commands/init.ts` (new)
  - `app/api/cli/init/route.ts` (new)
- **Testing:** Init creates config file. Re-init is idempotent. `.gitignore` updated. Server creates repo with correct provider. Missing org returns clear error.
- **Blocked by:** P5.5-DB-02, P5.5-INFRA-02

### P5.5-API-07: CLI `kap10 push` Command

- [x] **Status:** Complete
- **Description:** Zip the current directory (.gitignore-aware), upload via pre-signed URL, and trigger indexing.
- **Behavior:**
  1. Read `.kap10/config.json` for `repoId`, `orgId`, `apiKey`
  2. Build zip using `archiver` library, respecting `.gitignore` via `ignore` library + hardcoded exclusions (`node_modules`, `.git`, `dist`, `build`, `__pycache__`, `.kap10`)
  3. Call `POST /api/cli/index` with `{ repoId, phase: "request_upload" }` → receive pre-signed URL
  4. Upload zip directly to Supabase Storage via pre-signed URL with progress bar
  5. Call `POST /api/cli/index` with `{ repoId, phase: "trigger_index", storagePath }` → server triggers `indexRepoWorkflow`
  6. Poll repo status until `ready` (or timeout after 5 minutes)
  7. Optionally accept `-m "message"` flag for tracking
- **Files:**
  - `packages/cli/src/commands/push.ts` (new)
  - `app/api/cli/index/route.ts` (new)
- **Testing:** Zip respects .gitignore. Pre-signed URL upload succeeds. Indexing triggered. Progress bar renders. Timeout handled gracefully. 500MB+ repos handled.
- **Blocked by:** P5.5-ADAPT-03, P5.5-API-06

### P5.5-API-08: CLI `kap10 watch` Command

- [ ] **Status:** Partial — watch command exists but prompt-detector.ts not created
- **Description:** File watcher that streams changes to the kap10 ledger in real-time. Enables rewind from the terminal.
- **Behavior:**
  1. Start `chokidar` watcher on repo path (ignore node_modules, .git, dist)
  2. Debounce changes (1s delay) → compute `git diff HEAD` → stream to ledger via `sync_local_diff` MCP call
  3. Attempt to detect agent prompt from agent logs (`.cursor/prompts/`, Claude Code conversation context, etc.)
  4. If no prompt detected, record as `[manual edit — no agent prompt detected]`
  5. Listen for rewind events from server (WebSocket or SSE) → apply file restores locally
  6. Track drift percentage — if >20% of indexed files have local mods, prompt user to run `kap10 push`
- **Files:**
  - `packages/cli/src/commands/watch.ts` (new)
  - `packages/cli/src/prompt-detector.ts` (new — extract agent prompt from various agent log locations)
- **Testing:** File changes detected and debounced. Diffs streamed to server. Rewind events apply locally. Drift detection triggers at threshold. Graceful shutdown on Ctrl+C.
- **Blocked by:** P5.5-API-01

### P5.5-API-09: CLI Rewind + Timeline Commands

- [x] **Status:** Complete
- **Description:** Terminal commands for rewind and timeline viewing.
- **Commands:**
  - `kap10 rewind` — Rewind to most recent working snapshot
  - `kap10 rewind --snapshot <id>` — Rewind to specific snapshot
  - `kap10 rewind --steps N` — Go back N working states
  - `kap10 timeline` — Show prompt history (formatted table)
  - `kap10 mark-working` — Mark current state as working
  - `kap10 branches` — Show timeline branches
- **Files:**
  - `packages/cli/src/commands/rewind.ts` (new)
  - `packages/cli/src/commands/timeline.ts` (new)
  - `packages/cli/src/commands/mark-working.ts` (new)
  - `packages/cli/src/commands/branches.ts` (new)
- **Testing:** Rewind restores files locally. Timeline shows entries with status indicators. Branches shows fork points.
- **Blocked by:** P5.5-API-02, P5.5-API-03, P5.5-API-04

### P5.5-API-10: prepareWorkspace Extension for Local Repos

- [ ] **Status:** Partial — indexing-heavy.ts not updated for local_cli workspace prep
- **Description:** Extend the `prepareWorkspace` activity in the indexing pipeline to handle `provider: "local_cli"` repos. Instead of `git clone`, download the zip from Supabase Storage and extract it.
- **Behavior:**
  1. Check `provider` field on Repo record
  2. If `provider == "local_cli"`:
     a. Call `IStorageProvider.downloadFile(bucket, storagePath)` to get the zip
     b. Extract zip to `/data/workspaces/{orgId}/{repoId}/`
     c. Continue with normal SCIP + entity extraction pipeline
  3. If `provider == "github"`: Existing `git clone` behavior (unchanged)
  4. After indexing completes (success or failure), call `IStorageProvider.deleteFile()` to clean up
- **Files:**
  - `lib/temporal/activities/indexing-heavy.ts` (modify — add conditional branch in `prepareWorkspace`)
- **Testing:** Local CLI repo downloads zip and extracts. GitHub repo still clones normally. Zip cleaned up after indexing. Missing zip returns clear error.
- **Blocked by:** P5.5-ADAPT-03

---

## 2.5 Frontend / UI Layer

### P5.5-UI-01: Timeline Page

- [x] **Status:** Complete
- **Description:** Visual timeline at `/repos/[repoId]/timeline` showing prompts, changes, working/broken states, rewind points, and Timeline Branches as parallel lanes.
- **Design:**
  - Main layout: Vertical timeline with status-colored nodes (green = working, red = broken, gray = pending, strikethrough = reverted)
  - Branch visualization: Parallel lanes for post-rewind branches, connected by branch arrows
  - Each node shows: Prompt excerpt (40 chars), file count, line count delta, timestamp, status badge
  - Click node → expand to show full prompt + diff preview
  - Rewind button on each "working" node: "Rewind to here"
  - Pagination: Infinite scroll with cursor-based loading
- **API:** `GET /api/repos/{repoId}/timeline?branch=main&limit=50&cursor=...`
- **Files:**
  - `app/(dashboard)/repos/[repoId]/timeline/page.tsx` (new)
  - `components/repo/timeline-view.tsx` (new)
  - `components/repo/timeline-node.tsx` (new)
  - `components/repo/timeline-branch-lane.tsx` (new)
  - `app/api/repos/[repoId]/timeline/route.ts` (new)
- **Testing:** Timeline renders with mock data. Pagination works. Branch lanes display correctly. Rewind button triggers confirmation dialog.
- **Notes:** Follow design system: `bg-background`, `glass-card`, `font-grotesk` for headings. No arbitrary colors.
- **Blocked by:** P5.5-API-03

### P5.5-UI-02: Ledger Entry Detail Page

- [x] **Status:** Complete
- **Description:** Detail view at `/repos/[repoId]/timeline/[entryId]` showing full prompt, per-file diffs, affected entities, and generated anti-pattern rules.
- **Design:**
  - Header: Full prompt text, agent model badge, agent tool badge, timestamp
  - Changes section: Per-file unified diffs with syntax highlighting (use `react-diff-viewer` or similar)
  - Entities section: Linked entity cards (click → navigate to entity in graph)
  - Anti-Pattern Rule section (if rewind entry): Rule title, description, enforcement level
  - Working Snapshot section (if validated): Snapshot ID, reason, file count
- **Files:**
  - `app/(dashboard)/repos/[repoId]/timeline/[entryId]/page.tsx` (new)
  - `components/repo/ledger-entry-detail.tsx` (new)
  - `app/api/repos/[repoId]/timeline/[entryId]/route.ts` (new)
- **Testing:** Detail page renders. Diffs display with syntax highlighting. Entity links navigate correctly. Anti-pattern rule displays for rewind entries.
- **Blocked by:** P5.5-UI-01

### P5.5-UI-03: Commits Page with AI Contribution Summaries

- [x] **Status:** Complete
- **Description:** Commit history at `/repos/[repoId]/commits` showing Ledger Summaries — the AI's contribution per commit.
- **Design:**
  - Commit list: SHA, message, date, author
  - AI contribution badge: Files changed by AI, lines added/removed, rewind count, rules generated
  - Expand commit → show rolled-up prompt chain (e.g., "Add Apple Pay → Fix import → REWIND → Retry → Fix tests")
  - Filter: Branch selector, date range
- **Files:**
  - `app/(dashboard)/repos/[repoId]/commits/page.tsx` (new)
  - `components/repo/commit-summary.tsx` (new)
  - `app/api/repos/[repoId]/commits/route.ts` (new)
- **Testing:** Commit list renders. AI contribution badges show correct counts. Prompt chain expands correctly.
- **Blocked by:** P5.5-API-01

---

## 2.6 Testing & Verification

### P5.5-TEST-01: Ledger Entry CRUD + State Machine

- [x] **Status:** Complete
- **Description:** Unit tests for ledger entry creation, state transitions, and append-only guarantees.
- **Test cases:**
  - Append entry succeeds with valid data
  - Append entry with missing prompt defaults to `[manual edit]`
  - Valid state transitions: `pending → working`, `pending → broken`, `working → committed`, etc.
  - Invalid state transitions rejected: `committed → pending`, `reverted → working`
  - Mutable fields updated correctly (`status`, `commit_sha`, `snapshot_id`, `validated_at`, `rule_generated`)
  - Immutable fields cannot be changed (`_key`, `prompt`, `changes`, `parent_id`, `created_at`)
  - `parent_id` links form a valid chain (no orphans)
- **Files:**
  - `lib/adapters/__tests__/ledger.test.ts` (new)
- **Blocked by:** P5.5-ADAPT-02

### P5.5-TEST-02: Rewind Atomicity + Branch Increment + Shadow Rewind

- [ ] **Status:** Partial — shadow-rewind.test.ts exists but rewind.test.ts missing
- **Description:** Unit tests for the rewind operation's atomicity, timeline branching, and shadow rewind blast radius checking.
- **Test cases:**
  - Rewind creates new entry + marks intermediate entries `reverted` atomically
  - Timeline branch increments by 1 after rewind
  - Multiple rewinds create branches 1, 2, 3...
  - Rewind with specific files only restores those files
  - Rewind without snapshot ID uses most recent working snapshot
  - No working snapshot returns clear error
  - Concurrent rewinds serialized via Redis lock
  - **NEW:** `dryRun: true` → returns blast radius report without applying changes
  - **NEW:** `dryRun: true` → no ledger entries created, no entries marked reverted
  - **NEW:** Manual conflict detected → warning returned with conflicted file details (filePath, lineRanges)
  - **NEW:** Manual conflict + `force: false` (default) → rewind blocked, report returned
  - **NEW:** Manual conflict + `force: true` → rewind proceeds despite conflicts
  - **NEW:** No conflicts → rewind proceeds immediately (no confirmation needed)
  - **NEW:** Blast radius metadata stored on rewind ledger entry
- **Files:**
  - `lib/mcp/tools/__tests__/rewind.test.ts` (new)
  - `lib/use-cases/__tests__/shadow-rewind.test.ts` (new)
- **Blocked by:** P5.5-API-02

### P5.5-TEST-03: Working Snapshot Creation

- [ ] **Status:** Not started — snapshot.test.ts not created
- **Description:** Unit tests for snapshot creation at the four trigger points.
- **Test cases:**
  - `tests_passed` trigger creates snapshot with correct files
  - `user_marked` trigger creates snapshot via `mark_working` tool
  - `session_start` trigger creates baseline snapshot on first sync
  - `commit` trigger creates snapshot before roll-up
  - Snapshot `files` array contains full file content (not diffs)
  - Snapshot `entityHashes` match current entity hashes
  - Cap at 100 files — excess files logged as warning
- **Files:**
  - `lib/mcp/tools/__tests__/snapshot.test.ts` (new)
- **Blocked by:** P5.5-API-01

### P5.5-TEST-04: Commit Roll-Up

- [ ] **Status:** Not started — rollup.test.ts not created
- **Description:** Unit tests for the commit detection and roll-up logic.
- **Test cases:**
  - `baseSha` change triggers roll-up
  - Only active branch entries are committed
  - Reverted entries are NOT committed
  - Ledger Summary contains correct aggregation counts
  - Prompt summary joins prompts in order with " → " separator
  - Timeline branch resets to 0 after commit
  - No uncommitted entries → no roll-up (no empty summary)
- **Files:**
  - `lib/mcp/tools/__tests__/rollup.test.ts` (new)
- **Blocked by:** P5.5-API-01

### P5.5-TEST-05: Anti-Pattern Rule Synthesis

- [ ] **Status:** Not started — anti-pattern.test.ts not created
- **Description:** Unit tests for the LLM-powered rule synthesis activity.
- **Test cases:**
  - Valid rewind → rule generated with Zod-valid shape
  - Rule stored in `rules` collection with `createdBy: "system:rewind"` and `priority: 10`
  - Rule `type` is always `"architectural"`, `scope` is always `"repo"`
  - LLM timeout → graceful degradation (no rule, entry.ruleGenerated stays null)
  - LLM returns invalid shape → retry once, then skip
  - Rule links back to rewind entry via `ruleGenerated` field
- **Files:**
  - `lib/temporal/activities/__tests__/anti-pattern.test.ts` (new)
- **Blocked by:** P5.5-API-05

### P5.5-TEST-05a: Anti-Pattern Vectorization

- [ ] **Status:** Not started — anti-pattern-vectorization.test.ts not created
- **Description:** Unit tests for the anti-pattern vectorization and proactive codebase scanning activity.
- **Test cases:**
  - Rule embedded successfully → embedding stored in `rule_embeddings` table
  - Hybrid search finds matching entities → matches stored on rule document with correct shape
  - Similarity threshold respected → entities below 0.75 excluded
  - Max 20 matches → excess results truncated by similarity score
  - Zero matches → `scan_status: "complete"`, `codebase_matches: []`
  - Notification created with correct type ("warning") and link to rule page
  - Embedding/search failure → `scan_status: "failed"`, no crash, rule synthesis unaffected
  - Semgrep rule present → background verification queued, matches promoted/demoted
  - Semgrep rule absent → skip verification step
  - Multiple rewinds for same pattern → deduplicates rule embeddings (no duplicate vectors)
- **Files:**
  - `lib/temporal/activities/__tests__/anti-pattern-vectorization.test.ts` (new)
- **Blocked by:** P5.5-API-05a

### P5.5-TEST-05b: Ledger Circuit Breaker

- [x] **Status:** Complete
- **Description:** Unit tests for the hallucination loop detection and circuit breaker system.
- **Test cases:**
  - 3 consecutive broken entries on same entity → no trip (below threshold)
  - 4 consecutive broken entries on same entity within 10 min → circuit trips, halt response returned
  - `working` entry between broken entries → counter resets (no trip at 4th overall if working in between)
  - Circuit tripped → subsequent sync_local_diff for affected entity returns halt message
  - Circuit tripped → sync_local_diff for OTHER entities still works (not blocked)
  - Cooldown expires → entity sync re-enabled (Redis TTL)
  - Manual reset via API → immediate re-enable
  - `CIRCUIT_BREAKER_ENABLED=false` → no detection, no trips
  - Dashboard notification created on trip
  - Multiple entities in single sync → only tripped entity blocked, others proceed
  - Counter window: 4 broken entries spread over 20 min → no trip (outside 10 min window)
- **Files:**
  - `lib/mcp/security/__tests__/circuit-breaker.test.ts` (new)
- **Blocked by:** P5.5-API-05b

### P5.5-TEST-06: IStorageProvider Port Compliance

- [ ] **Status:** Partial — port-compliance.test.ts not updated for 12th port (IStorageProvider)
- **Description:** Port compliance test for the 12th port, following existing patterns in `lib/di/__tests__/port-compliance.test.ts`.
- **Test cases:**
  - `InMemoryStorageProvider` implements all `IStorageProvider` methods
  - `generateUploadUrl` returns a URL string
  - `downloadFile` returns the uploaded buffer
  - `deleteFile` removes the file (subsequent download throws)
  - `healthCheck` returns `{ status: "up", latencyMs: number }`
  - DI container resolves `storageProvider` for both production and test containers
- **Files:**
  - `lib/di/__tests__/port-compliance.test.ts` (modify — add 12th port)
- **Blocked by:** P5.5-ADAPT-03

### P5.5-TEST-07: CLI Init + Push Integration

- [ ] **Status:** Not started — init-push.test.ts not created
- **Description:** Integration tests for the CLI local repo ingestion flow.
- **Test cases:**
  - `kap10 init` creates `.kap10/config.json` with correct shape
  - `kap10 init` adds `.kap10/` to `.gitignore`
  - Re-init is idempotent (returns same repoId)
  - `kap10 push` creates zip excluding node_modules, .git, dist
  - `kap10 push` uploads via pre-signed URL
  - `kap10 push` triggers indexing workflow
  - Post-push, repo status transitions to `ready`
  - Missing config → clear error: "Not initialized. Run kap10 init first."
- **Files:**
  - `packages/cli/src/__tests__/init-push.test.ts` (new)
- **Blocked by:** P5.5-API-06, P5.5-API-07

### P5.5-TEST-08: sync_local_diff Backward Compatibility

- [x] **Status:** Complete
- **Description:** Verify that the sync_local_diff extension is backward compatible — existing agents that don't send prompt metadata still work.
- **Test cases:**
  - Sync without `prompt` field → ledger entry created with `[manual edit]` prompt
  - Sync without `validationResult` → no auto-snapshot (entry stays `pending`)
  - Sync without `agentModel`/`agentTool` → fields are null in ledger entry
  - All existing sync tests pass unchanged
  - Sync response includes new `ledgerEntryId` and `timelineBranch` fields
  - Ledger append failure → sync still succeeds (warning logged)
- **Files:**
  - `lib/mcp/tools/__tests__/sync-ledger.test.ts` (new)
- **Blocked by:** P5.5-API-01

### P5.5-TEST-09: Timeline API Pagination

- [ ] **Status:** Not started — ledger-pagination.test.ts not created
- **Description:** Test cursor-based pagination for timeline queries.
- **Test cases:**
  - First page returns `limit` entries + cursor token
  - Second page (with cursor) returns next batch
  - Empty result when no more entries
  - Branch filter works correctly
  - Status filter works correctly
  - `includeReverted: false` excludes reverted entries
  - Large timeline (1000+ entries) paginates without performance degradation (<100ms per page)
- **Files:**
  - `lib/adapters/__tests__/ledger-pagination.test.ts` (new)
- **Blocked by:** P5.5-ADAPT-02

### P5.5-TEST-10: E2E — Full Rewind Cycle

- [ ] **Status:** Not started — rewind-e2e.test.ts not created
- **Description:** End-to-end test for the complete rewind cycle: sync → validate → break → rewind → new branch.
- **Scenario:**
  1. Sync change with prompt "Add feature X" → entry E1 (pending)
  2. Mark working → E1 becomes working, snapshot S1 created
  3. Sync change with prompt "Refactor feature X" → entry E2 (pending)
  4. E2 fails validation → E2 becomes broken
  5. Rewind to S1 → E2 marked reverted, rewind entry E3 created on branch 1
  6. Sync change with prompt "Retry feature X" → entry E4 on branch 1
  7. Mark working → E4 becomes working, snapshot S2 created
  8. Verify timeline shows branch 0 (E1, E2-reverted, E3-rewind) and branch 1 (E4)
  9. Commit → E4 committed, summary created, branch resets to 0
- **Files:**
  - `lib/mcp/tools/__tests__/rewind-e2e.test.ts` (new)
- **Blocked by:** P5.5-API-01, P5.5-API-02, P5.5-API-03, P5.5-API-04

---

## New Files Summary

```
lib/
  ports/
    storage-provider.ts           ← IStorageProvider (12th port)
  adapters/
    supabase-storage.ts           ← SupabaseStorageAdapter
    __tests__/
      ledger.test.ts              ← Ledger CRUD + state machine tests
      ledger-pagination.test.ts   ← Timeline pagination tests
  use-cases/
    shadow-rewind.ts              ← Blast radius calculator for rewind conflict detection
    __tests__/
      shadow-rewind.test.ts       ← Shadow rewind unit tests
  mcp/
    tools/
      rewind.ts                     ← revert_to_working_state MCP tool (with shadow rewind + force)
      timeline.ts                   ← get_timeline, mark_working MCP tools
    security/
      circuit-breaker.ts            ← Ledger Circuit Breaker: hallucination loop detection + halt injection
      __tests__/
        circuit-breaker.test.ts     ← Circuit breaker tests
    __tests__/
      rewind.test.ts              ← Rewind atomicity + branch + shadow rewind tests
      snapshot.test.ts            ← Working snapshot tests
      rollup.test.ts              ← Commit roll-up tests
      sync-ledger.test.ts         ← sync_local_diff backward compat tests
      rewind-e2e.test.ts          ← Full rewind cycle E2E
  temporal/activities/
    anti-pattern.ts               ← Anti-pattern rule synthesis + vectorization activities
    __tests__/
      anti-pattern.test.ts        ← Rule synthesis tests
      anti-pattern-vectorization.test.ts ← Proactive codebase scan tests
packages/cli/src/
  commands/
    init.ts                       ← kap10 init
    push.ts                       ← kap10 push
    watch.ts                      ← kap10 watch
    rewind.ts                     ← kap10 rewind
    timeline.ts                   ← kap10 timeline
    mark-working.ts               ← kap10 mark-working
    branches.ts                   ← kap10 branches
  prompt-detector.ts              ← Agent prompt extraction
  __tests__/
    init-push.test.ts             ← CLI integration tests
  commands/
    circuit-reset.ts              ← kap10 circuit-reset CLI command
app/
  api/
    cli/
      init/route.ts               ← POST /api/cli/init
      index/route.ts              ← POST /api/cli/index
    repos/[repoId]/
      timeline/route.ts           ← GET timeline entries
      timeline/[entryId]/route.ts ← GET single entry
      timeline/mark-working/route.ts ← POST mark working
      commits/route.ts            ← GET commit summaries
      circuit-breaker/reset/route.ts ← POST manual circuit breaker reset
  (dashboard)/repos/[repoId]/
    timeline/
      page.tsx                    ← Timeline page
      [entryId]/page.tsx          ← Entry detail page
    commits/page.tsx              ← Commits page
components/repo/
  timeline-view.tsx               ← Timeline container component
  timeline-node.tsx               ← Single timeline entry node
  timeline-branch-lane.tsx        ← Branch visualization
  ledger-entry-detail.tsx         ← Entry detail view
  commit-summary.tsx              ← Commit AI contribution summary
supabase/migrations/
  2026XXXX_phase55_cli_uploads_bucket.sql
  2026XXXX_phase55_ledger_snapshots.sql
  2026XXXX_phase55_rule_embeddings.sql    ← kap10.rule_embeddings pgvector table for anti-pattern vectorization
```

## Modified Files Summary

```
lib/adapters/arango-graph-store.ts    ← Add ledger_summaries to DOC_COLLECTIONS, indexes, ledger methods
lib/ports/graph-store.ts              ← Add ledger methods to IGraphStore
lib/ports/types.ts                    ← Add LedgerEntry, WorkingSnapshot, LedgerSummary types
lib/di/container.ts                   ← Add 12th getter (storageProvider)
lib/di/fakes.ts                       ← Add InMemoryStorageProvider, ledger methods on InMemoryGraphStore
lib/di/__tests__/port-compliance.test.ts ← Add 12th port test
lib/mcp/tools/sync.ts                 ← Add prompt tracking, ledger append, snapshot auto-creation
lib/mcp/tools/index.ts                ← Register revert_to_working_state, get_timeline, mark_working
lib/temporal/activities/indexing-heavy.ts ← prepareWorkspace branch for local_cli provider
prisma/schema.prisma                  ← Add LedgerSnapshot model, local_cli enum value
packages/cli/package.json             ← Add new dependencies
packages/cli/src/index.ts             ← Register new commands
```

---

## Revision Log

| Date | Author | Changes |
|---|---|---|
| 2026-02-21 | Phase 5.5 Design | Initial document. 6 user flows, 8 system logic sections, 10 failure scenarios, 7 latency budgets, phase bridge to Phase 6, 37 tracker items across 6 layers. |
| 2026-02-21 | — | Added Shadow Rewind (blast radius checking with dryRun/force modes) and Anti-Pattern Vectorization (proactive codebase scanning). New: P5.5-API-05a (vectorization activity), enhanced P5.5-API-02 (shadow rewind), P5.5-TEST-02 expanded, P5.5-TEST-05a added, `shadow-rewind.ts` use-case, `rule_embeddings` migration. Total: **40 tracker items.** |
| 2026-02-21 | — | Added Ledger Circuit Breaker (hallucination loop detection). New: P5.5-API-05b (circuit breaker module), P5.5-TEST-05b (circuit breaker tests), `circuit-breaker.ts` security module, `circuit-reset` CLI command, manual reset API endpoint. Total: **42 tracker items.** |
