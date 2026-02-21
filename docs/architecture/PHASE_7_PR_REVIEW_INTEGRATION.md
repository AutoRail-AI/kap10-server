# Phase 7 — PR Review Integration (Semgrep-Powered): Deep Dive & Implementation Tracker

> **Phase Feature Statement:** _"kap10 automatically reviews my PRs on GitHub. It runs Semgrep rules from Phase 6 against the diff, identifies impact radius via the knowledge graph, and posts review comments — all deterministic, all explainable, all cheap."_
>
> **Source:** [`VERTICAL_SLICING_PLAN.md`](./VERTICAL_SLICING_PLAN.md) — Phase 7 + Phase 7 Enhancement (Ledger Trace Merging)
>
> **Prerequisites:** [Phase 1 — GitHub Connect & Repo Indexing](./PHASE_1_GITHUB_CONNECT_AND_INDEXING.md) (entities + call graph in ArangoDB, `rules`/`patterns` collections bootstrapped, GitHub App installed, webhook handler), [Phase 2 — Hosted MCP Server](./PHASE_2_HOSTED_MCP_SERVER.md) (MCP tools, OTel spans), [Phase 3 — Semantic Search](./PHASE_3_SEMANTIC_SEARCH.md) (entity embeddings), [Phase 4 — Business Justification & Taxonomy](./PHASE_4_BUSINESS_JUSTIFICATION_AND_TAXONOMY.md) (feature area context), [Phase 5 — Incremental Indexing & GitHub Webhooks](./PHASE_5_INCREMENTAL_INDEXING_AND_GITHUB_WEBHOOKS.md) (push webhook handler, HMAC verification, Redis dedup), [Phase 5.5 — Prompt Ledger, Rewind & Local Ingestion](./PHASE_5.5_PROMPT_LEDGER_REWIND_AND_LOCAL_INGESTION.md) (ledger collection, Ledger Entry/Summary types), [Phase 6 — Pattern Enforcement & Rules Engine](./PHASE_6_PATTERN_ENFORCEMENT_AND_RULES_ENGINE.md) (auto-detected patterns with Semgrep YAML, explicit rules, `IPatternEngine` with real Semgrep CLI)
>
> **Database convention:** All kap10 Supabase tables use PostgreSQL schema `kap10`. ArangoDB collections are org-scoped (`org_{orgId}/`). See [VERTICAL_SLICING_PLAN.md § Storage & Infrastructure Split](./VERTICAL_SLICING_PLAN.md#storage--infrastructure-split).

---

## Table of Contents

- [Part 1: Architectural Deep Dive](#part-1-architectural-deep-dive)
  - [1.1 Core User Flows](#11-core-user-flows)
  - [1.2 System Logic & State Management](#12-system-logic--state-management)
  - [1.3 Reliability & Resilience](#13-reliability--resilience)
  - [1.4 Performance Considerations](#14-performance-considerations)
  - [1.5 Phase Bridge → Phase 8](#15-phase-bridge--phase-8)
- [Part 2: Implementation & Tracing Tracker](#part-2-implementation--tracing-tracker)
  - [2.1 Infrastructure Layer](#21-infrastructure-layer)
  - [2.2 Database & Schema Layer](#22-database--schema-layer)
  - [2.3 Ports & Adapters Layer](#23-ports--adapters-layer)
  - [2.4 Backend / API Layer](#24-backend--api-layer)
  - [2.5 Frontend / UI Layer](#25-frontend--ui-layer)
  - [2.6 Testing & Verification](#26-testing--verification)

---

## Canonical Terminology

> **CRITICAL:** Use these canonical names. See previous phase docs for their respective terminology sections.

| Canonical Term | DB Field (snake_case) | TS Field (camelCase) | Definition | NOT called |
|---|---|---|---|---|
| **PR Review** | `pr_reviews` (Supabase table) | `PrReview` (type) | A single automated review of a pull request. Contains aggregate check counts, status, and the review body posted to GitHub. | ~~code review~~, ~~audit~~, ~~scan result~~ |
| **Review Comment** | `pr_review_comments` (Supabase table) | `PrReviewComment` (type) | An individual finding within a PR Review — a pattern violation, impact warning, missing test, or complexity spike — posted as a line-level comment on GitHub. | ~~finding~~, ~~issue~~, ~~annotation~~ |
| **Check Type** | `check_type` | `checkType` | The category of analysis that produced a Review Comment: `pattern` (Semgrep rule violation), `impact` (high caller count), `test` (missing test companion), `complexity` (cyclomatic complexity spike), `dependency` (new import). | ~~check kind~~, ~~finding type~~ |
| **Impact Radius** | — | `ImpactRadius` (type) | The set of entities that directly call a changed function. Computed via ArangoDB `calls` edge traversal. Quantifies how much existing code is affected by a PR change. | ~~blast radius~~, ~~ripple effect~~, ~~call tree~~ |
| **Review Pipeline** | — | `reviewPrWorkflow` | The four-activity Temporal workflow: `fetchDiff` (light) → `runSemgrep` (heavy) → `analyzeImpact` (light) → `postReview` (light). Triggered by `pull_request` webhook. | ~~review flow~~, ~~review job~~ |
| **Merge Node** | `type: "merge"` in `ledger` | `MergeNode` (type) | A special Ledger Entry created when a PR is merged, linking source branch history to target branch. Contains `sourceBranch`, `targetBranch`, `prNumber`, `mergedBy`, `entryCount`. | ~~merge record~~, ~~branch link~~ |
| **Merge Summary** | `type: "merge_summary"` in `ledger_summaries` | `MergeSummary` (type) | An LLM-generated narrative summary of all AI activity on a feature branch, created on PR merge. Links to the Merge Node. Provides code archaeology context months later. | ~~branch summary~~, ~~merge narrative~~ |
| **Review Configuration** | `review_config` (JSON field on Repo) | `ReviewConfig` (type) | Per-repo settings controlling which checks run, severity thresholds, and whether reviews auto-post or require approval. | ~~review settings~~, ~~review prefs~~ |

---

# Part 1: Architectural Deep Dive

## Why Semgrep for PR Reviews

The auto-generated Semgrep rules from Phase 6 are **deterministic YAML** — no LLM needed at review time:

- **Fast** — Semgrep scans thousands of files in seconds
- **Accurate** — No hallucinations; rules are exact structural matches
- **Explainable** — Every finding links back to the Semgrep rule + evidence from Phase 6's pattern detection
- **Cheap** — Zero LLM cost for pattern checks (LLM only used for impact summary in the optional `analyzeImpact` step and for ledger merge summaries)

This is the key differentiator: kap10's PR reviews are not "yet another AI review bot." They are deterministic enforcement of the repo's own conventions, backed by evidence.

---

## 1.1 Core User Flows

### Flow 1: PR Opened → Automated Review Posted (Primary Flow)

**Actor:** System (automated, triggered by GitHub `pull_request` webhook)
**Precondition:** Repo is in `ready` status (fully indexed). GitHub App is installed with PR permissions. Phase 6 patterns detected and/or rules created. Review is enabled for this repo (default: enabled).
**Outcome:** kap10 posts a review on the PR with line-level comments for pattern violations, impact warnings, missing tests, and complexity spikes.

```
Step  Actor                           System Action                                              Outcome
────  ──────────────────────────────  ───────────────────────────────────────────────────────    ─────────────────────────
1     Developer opens PR on GitHub    GitHub sends POST /api/webhooks/github                      —
                                       Headers: x-github-event: "pull_request"
                                       Payload: { action: "opened", pull_request: {
                                         number, title, html_url, head: { sha, ref },
                                         base: { sha, ref }, diff_url },
                                         installation: { id }, repository: { id, full_name } }

2                                     Webhook handler validates:                                  —
                                       a) HMAC-SHA256 signature (existing)
                                       b) Event type is "pull_request" (new handler)
                                       c) Action is "opened", "synchronize", or "reopened"
                                       d) Deduplicate via Redis (delivery ID, TTL 24h, existing)
                                       e) Resolve orgId from installation.id (existing)
                                       f) Resolve repoId from repository.id (existing)

3                                     Guard checks:                                               —
                                       a) Repo exists and status == "ready"
                                          (reject if not indexed — can't review without graph)
                                       b) PR review is enabled for this repo
                                          (check repo.reviewConfig.enabled, default: true)
                                       c) PR is not a draft (skip draft PRs)
                                       d) PR targets the repo's default branch
                                          (configurable — some teams review all branches)

4                                     Create PrReview record in Supabase:                         Review tracked
                                       { repoId, prNumber, prTitle, prUrl,
                                         status: "pending" }

5                                     Start reviewPrWorkflow (Temporal):                          Workflow started
                                       workflowId: review-{orgId}-{repoId}-{prNumber}-{headSha}
                                       Input: { orgId, repoId, prNumber, installationId,
                                                headSha, baseSha, owner, repo, reviewId }

6                                     Activity: fetchDiff (light-llm-queue)                       Diff fetched
                                       a) Call IGitHost.getDiff(owner, repo, baseSha, headSha)
                                       b) Filter via filterDiff() (reuse from diff-filter.ts):
                                          strip lockfiles, build artifacts, vendor
                                       c) Parse via parseDiffHunks(): extract file paths +
                                          changed line ranges
                                       d) Call IGitHost.getPullRequest() for metadata
                                       e) Update PrReview status: "reviewing"

7                                     Activity: runSemgrep (heavy-compute-queue)                  Findings produced
                                       a) Fetch active rules + pinned patterns for this repo
                                          (from ArangoDB via IGraphStore.queryRules/queryPatterns)
                                       b) Filter to rules with semgrepRule defined
                                       c) Write changed files from workspace to temp dir
                                       d) Write Semgrep config (concatenated YAML rules)
                                       e) Execute via IPatternEngine.scanPatterns(tempDir, config)
                                       f) Map Semgrep findings back to diff line numbers
                                          (only report violations on CHANGED lines,
                                           not pre-existing violations)
                                       g) Return: PatternFinding[]

8                                     Activity: analyzeImpact (light-llm-queue)                   Impact assessed
                                       a) For each changed file, identify affected entities:
                                          parse diff hunks → match to entities by file + line
                                       b) For each affected entity, query ArangoDB:
                                          TRAVERSE 1..1 INBOUND entity calls → callers
                                       c) Count callers per entity → impact radius
                                       d) Check for missing test companions:
                                          for each changed lib/ file, verify __tests__/ exists
                                       e) Optional: ast-grep complexity check on changed functions
                                          (if IPatternEngine.scanWithAstGrep available from Phase 6)
                                       f) Check for new imports not seen in codebase:
                                          compare PR imports against ArangoDB import graph
                                       g) Return: ImpactFinding[], TestFinding[],
                                          ComplexityFinding[], DependencyFinding[]

9                                     Activity: postReview (light-llm-queue)                      Review posted
                                       a) Build markdown comments from all findings
                                          (see § 1.2.4 Comment Format)
                                       b) Build review body summary:
                                          "kap10 found N issues (X warnings, Y info)"
                                       c) Determine review action:
                                          - Any "error" severity → REQUEST_CHANGES
                                          - Only "warning" → COMMENT
                                          - Only "info" or no findings → APPROVE (configurable)
                                       d) Call IGitHost.postReview() with body + comments
                                       e) Update PrReview record:
                                          status: "completed", checksPassed, checksWarned,
                                          checksFailed, reviewBody
                                       f) Create PrReviewComment records for each comment

10    Developer sees review on PR     GitHub shows kap10 review with inline comments              Review visible
                                       Each comment links to the Semgrep rule + pattern
                                       evidence from Phase 6
```

### Flow 2: PR Updated (synchronize) → Re-Review

**Actor:** System (automated, triggered by force-push or new commits on the PR)
**Precondition:** PR already has a previous review from kap10.
**Outcome:** Previous review is superseded. New review posted with updated findings.

```
Step  Actor                           System Action                                              Outcome
────  ──────────────────────────────  ───────────────────────────────────────────────────────    ─────────────────────────
1     Developer pushes new commits    GitHub sends pull_request webhook:                          —
      to PR branch                     action: "synchronize", head.sha changed

2                                     Webhook handler:                                            —
                                       a) Same validation as Flow 1
                                       b) Check if previous review exists for this PR
                                          (query PrReview by repoId + prNumber)

3                                     Create NEW PrReview record:                                 New review tracked
                                       Previous review stays (historical record).
                                       New review references the new headSha.

4                                     Start reviewPrWorkflow with new headSha:                    —
                                       workflowId includes headSha for uniqueness
                                       (different workflow from the original review)

5                                     Same pipeline: fetchDiff → runSemgrep →                     Updated review posted
                                       analyzeImpact → postReview
                                       The new review reflects the current state of the PR
```

**Key design decision:** Each push to the PR branch creates a new PrReview record, not an update to the old one. This preserves history — you can see how the review findings changed across pushes. The GitHub review API creates a new review object anyway, so this maps naturally.

### Flow 3: PR Merged → Ledger Trace Merging (Enhancement)

**Actor:** System (automated, triggered by `pull_request.closed` with `merged: true`)
**Precondition:** PR was merged. Phase 5.5 ledger has entries for the source branch.
**Outcome:** Ledger entries reparented to target branch. Merge Node created. Narrative summary generated.

```
Step  Actor                           System Action                                              Outcome
────  ──────────────────────────────  ───────────────────────────────────────────────────────    ─────────────────────────
1     PR is merged on GitHub          GitHub sends pull_request webhook:                          —
                                       action: "closed", merged: true

2                                     Webhook handler:                                            —
                                       a) Validate as usual
                                       b) Check merged === true (ignore closed-without-merge)
                                       c) Start mergeLedgerWorkflow

3                                     Activity: fetchLedgerEntries (light-llm-queue)              Entries fetched
                                       Query ArangoDB ledger collection:
                                       FOR entry IN ledger
                                         FILTER entry.org_id == @orgId
                                         AND entry.repo_id == @repoId
                                         AND entry.branch == @sourceBranch
                                         SORT entry.created_at ASC
                                         RETURN entry

4                                     Activity: reparentLedgerEntries (light-llm-queue)           Entries reparented
                                       Bulk update all fetched entries:
                                       FOR entry IN @entryIds
                                         UPDATE entry WITH {
                                           branch: @targetBranch,
                                           merged_from: @sourceBranch
                                         } IN ledger
                                       Preserves original timestamps and ordering.

5                                     Activity: createMergeNode (light-llm-queue)                 Merge Node created
                                       Insert special ledger entry:
                                       { type: "merge", org_id, repo_id,
                                         source_branch: "feat/auth",
                                         target_branch: "main",
                                         pr_number: 42, merged_by: "alice",
                                         merged_at: now(), entry_count: 127 }

6                                     Activity: synthesizeLedgerSummary (light-llm-queue)         Narrative generated
                                       a) Build LLM prompt from all reparented entries:
                                          prompts, tool calls, changes, rewind events
                                       b) generateObject() with MergeSummarySchema:
                                          { narrative (2–3 paragraphs), entryCount,
                                            promptCount, toolCallCount }
                                       c) Token budget: 4K input + 800 output (gpt-4o-mini)

7                                     Activity: storeLedgerSummary (light-llm-queue)              Summary persisted
                                       Insert into ledger_summaries:
                                       { type: "merge_summary", repo_id, source_branch,
                                         target_branch, merge_node_key, narrative, ... }
```

**Why this matters for code archaeology:** Six months after a branch is deleted, a developer encounters complex code and asks "why was this done this way?" The Merge Summary provides immediate context — a narrative linking prompts, decisions, and rewind events. Without it, ledger entries referencing a deleted branch are practically invisible.

### Flow 4: Developer Views Review on Dashboard

**Actor:** Developer or tech lead via dashboard
**Precondition:** At least one PR review exists for the repo.
**Outcome:** Review history displayed with status, findings, and links to GitHub PRs.

```
Step  Actor                           System Action                                              Outcome
────  ──────────────────────────────  ───────────────────────────────────────────────────────    ─────────────────────────
1     User navigates to               Load reviews from API:                                      Reviews listed
      /repos/{repoId}/reviews         GET /api/repos/{repoId}/reviews?limit=20&cursor=...
                                       Returns: PrReview[] with aggregate counts

2                                     Each review shows:                                          —
                                       - PR number + title (linked to GitHub)
                                       - Status badge (pending/reviewing/completed/failed)
                                       - Check counts: passed (green), warned (yellow),
                                         failed (red)
                                       - Timestamp
                                       - Head SHA (linked to commit)

3     User clicks a review            Detail view loads:                                          Detail displayed
                                       GET /api/repos/{repoId}/reviews/{reviewId}
                                       a) Review summary (body posted to GitHub)
                                       b) Comments grouped by check type:
                                          - Pattern violations (with Semgrep rule link)
                                          - Impact warnings (with caller count)
                                          - Missing tests (with expected file path)
                                          - Complexity spikes (with metric delta)
                                       c) Per-comment: file path, line number, severity,
                                          message, suggestion, Semgrep rule ID
```

### Flow 5: Tech Lead Configures Review Settings

**Actor:** Tech lead via dashboard
**Precondition:** Repo exists with at least one completed review cycle.
**Outcome:** Review behavior customized per repo.

```
Step  Actor                           System Action                                              Outcome
────  ──────────────────────────────  ───────────────────────────────────────────────────────    ─────────────────────────
1     User navigates to               Load review config:                                         Config displayed
      /repos/{repoId}/settings         { enabled, autoApproveOnClean, targetBranches,
                                          skipDraftPrs, impactThreshold, checksEnabled }

2     User modifies settings          PATCH /api/repos/{repoId}/settings/review                   Config saved
                                       Examples:
                                       - Disable reviews entirely
                                       - Only review PRs targeting main + develop
                                       - Set impact radius threshold to 20 (from default 15)
                                       - Disable complexity checks
                                       - Enable auto-approve when no findings

3                                     Config stored on Repo model (JSON field):                   —
                                       reviewConfig column in kap10.repos table
```

---

## 1.2 System Logic & State Management

### 1.2.1 PR Review State Machine

```
              ┌──────────┐
  webhook →   │ pending  │
              └────┬─────┘
                   │ reviewPrWorkflow starts
                   ▼
              ┌──────────┐
              │reviewing │
              └────┬─────┘
                   │
            ┌──────┴──────┐
            │             │
            ▼             ▼
      ┌───────────┐  ┌────────┐
      │ completed │  │ failed │
      └───────────┘  └────────┘
```

**Transitions:**
- `pending → reviewing`: Workflow starts, `fetchDiff` activity begins
- `reviewing → completed`: `postReview` activity succeeds
- `reviewing → failed`: Any activity fails after all Temporal retries exhausted
- `failed` is terminal — the review can be manually retried from the dashboard, which creates a new PrReview record

### 1.2.2 Supabase Schema — PrReview & PrReviewComment

```sql
-- Migration: Phase 7 PR Reviews
CREATE TABLE kap10.pr_reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id         TEXT NOT NULL REFERENCES kap10.repos(id) ON DELETE CASCADE,
  pr_number       INTEGER NOT NULL,
  pr_title        TEXT,
  pr_url          TEXT,
  head_sha        TEXT NOT NULL,
  base_sha        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'reviewing', 'completed', 'failed')),
  checks_passed   INTEGER NOT NULL DEFAULT 0,
  checks_warned   INTEGER NOT NULL DEFAULT 0,
  checks_failed   INTEGER NOT NULL DEFAULT 0,
  review_body     TEXT,
  github_review_id BIGINT,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_pr_reviews_repo
  ON kap10.pr_reviews (repo_id, created_at DESC);
CREATE INDEX idx_pr_reviews_pr
  ON kap10.pr_reviews (repo_id, pr_number, created_at DESC);

CREATE TABLE kap10.pr_review_comments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id       UUID NOT NULL REFERENCES kap10.pr_reviews(id) ON DELETE CASCADE,
  file_path       TEXT NOT NULL,
  line_number     INTEGER,
  check_type      TEXT NOT NULL
                  CHECK (check_type IN ('pattern', 'impact', 'test', 'complexity', 'dependency')),
  severity        TEXT NOT NULL
                  CHECK (severity IN ('info', 'warning', 'error')),
  message         TEXT NOT NULL,
  suggestion      TEXT,
  semgrep_rule_id TEXT,
  rule_title      TEXT,
  github_comment_id BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pr_review_comments_review
  ON kap10.pr_review_comments (review_id);
```

**Prisma models:**

```
model PrReview {
  id              String    @id @default(uuid())
  repoId          String    @map("repo_id")
  prNumber        Int       @map("pr_number")
  prTitle         String?   @map("pr_title")
  prUrl           String?   @map("pr_url")
  headSha         String    @map("head_sha")
  baseSha         String    @map("base_sha")
  status          String    @default("pending")
  checksPassed    Int       @default(0) @map("checks_passed")
  checksWarned    Int       @default(0) @map("checks_warned")
  checksFailed    Int       @default(0) @map("checks_failed")
  reviewBody      String?   @map("review_body")
  githubReviewId  BigInt?   @map("github_review_id")
  errorMessage    String?   @map("error_message")
  createdAt       DateTime  @default(now()) @map("created_at")
  completedAt     DateTime? @map("completed_at")

  repo            Repo      @relation(fields: [repoId], references: [id], onDelete: Cascade)
  comments        PrReviewComment[]

  @@index([repoId, createdAt(sort: Desc)])
  @@map("pr_reviews")
  @@schema("kap10")
}

model PrReviewComment {
  id              String   @id @default(uuid())
  reviewId        String   @map("review_id")
  filePath        String   @map("file_path")
  lineNumber      Int?     @map("line_number")
  checkType       String   @map("check_type")
  severity        String
  message         String
  suggestion      String?
  semgrepRuleId   String?  @map("semgrep_rule_id")
  ruleTitle       String?  @map("rule_title")
  githubCommentId BigInt?  @map("github_comment_id")
  createdAt       DateTime @default(now()) @map("created_at")

  review          PrReview @relation(fields: [reviewId], references: [id], onDelete: Cascade)

  @@index([reviewId])
  @@map("pr_review_comments")
  @@schema("kap10")
}
```

### 1.2.3 Review Configuration Schema

Stored as a JSON column on the `Repo` model (no separate table — config is always loaded with the repo):

```
ReviewConfig {
  enabled: boolean                    // default: true
  autoApproveOnClean: boolean         // default: false (COMMENT, not APPROVE, when clean)
  targetBranches: string[]            // default: ["main"] — only review PRs targeting these
  skipDraftPrs: boolean               // default: true
  impactThreshold: number             // default: 15 — callers count that triggers impact warning
  complexityThreshold: number         // default: 10 — cyclomatic complexity that triggers warning
  checksEnabled: {
    pattern: boolean                  // default: true
    impact: boolean                   // default: true
    test: boolean                     // default: true
    complexity: boolean               // default: true
    dependency: boolean               // default: true
  }
  ignorePaths: string[]               // default: [] — glob patterns to skip (e.g. "*.test.ts")
}
```

**Migration:** Add `review_config JSONB DEFAULT '{}'::jsonb` column to `kap10.repos` table.

### 1.2.4 Review Comment Format

Each Review Comment posted to GitHub follows a consistent markdown template:

**Pattern violation (Semgrep-backed):**
```markdown
⚠️ **Pattern violation: API routes must use zod validation**

This route handler processes request body without Zod schema validation.

**Convention adherence:** 12/14 routes (86%) in this codebase validate with Zod.

**Example from codebase:**
```ts
const body = RequestSchema.parse(await req.json());
```

<sub>Rule: `kap10.missing-zod-validation` · [View pattern evidence →](https://app.kap10.dev/...)</sub>
```

**Impact radius (graph-backed):**
```markdown
ℹ️ **High impact: `processPayment` has 23 callers**

This function is called by 23 other functions across 8 files. Changes here affect:
- `checkout/handler.ts` → `handleCheckout()`
- `billing/subscription.ts` → `renewSubscription()`
- ... and 21 more

Consider notifying owners of affected modules.

<sub>Check: impact-radius · Threshold: 15 callers</sub>
```

**Missing test:**
```markdown
⚠️ **Missing test companion**

`lib/payments/stripe-client.ts` was modified but has no `__tests__/` companion.
Expected: `lib/payments/__tests__/stripe-client.test.ts`

<sub>Check: test-coverage</sub>
```

**Complexity spike:**
```markdown
⚠️ **Complexity increase: `validateOrder` → cyclomatic complexity 14**

This function's complexity exceeds the threshold (10). Consider extracting helper functions.

<sub>Check: complexity · Threshold: 10</sub>
```

### 1.2.5 Review Checks — What Gets Analyzed

| Check Type | Tool | What It Catches | Severity | Deterministic? |
|---|---|---|---|---|
| **Pattern violation** | Semgrep CLI (Phase 6 auto-generated rules) | New code breaks established conventions | Warning or Error (from rule enforcement level) | Yes — Semgrep YAML, no LLM |
| **Impact radius** | ArangoDB graph traversal (`calls` edges) | Changed function has ≥ N callers (configurable threshold) | Info | Yes — graph query |
| **Missing test** | File tree analysis (fast-glob) | Changed `lib/` module without `__tests__/` companion | Warning | Yes — file existence check |
| **Complexity spike** | ast-grep structural query (Phase 6 `IPatternEngine`) | Function cyclomatic complexity exceeds threshold | Warning | Yes — AST analysis |
| **New dependency** | ArangoDB import graph | New import path not previously seen in codebase | Info | Yes — graph comparison |

**Critical: Only changed lines are flagged.** The `runSemgrep` activity maps Semgrep findings back to diff hunks. A pre-existing violation in an unchanged file is never reported — only violations introduced by the PR are surfaced. This prevents noise and ensures developers see only actionable items.

### 1.2.6 IGitHost Port Extension

The existing `IGitHost` port declares `getPullRequest` and `getDiff` (both stubs). Phase 7 adds review-posting methods:

```
// New methods on IGitHost
postReview(owner, repo, prNumber, review: {
  body: string,
  event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
  comments: Array<{
    path: string,
    line: number,
    body: string,
  }>
}): Promise<{ reviewId: number }>

postReviewComment(owner, repo, prNumber, comment: {
  body: string,
  commitId: string,
  path: string,
  line: number,
}): Promise<{ commentId: number }>
```

The `GitHubHost` adapter implements these via Octokit:
- `getPullRequest` → `octokit.rest.pulls.get()`
- `getDiff` → `octokit.rest.repos.compareCommits()` with `mediaType: { format: 'diff' }`
- `postReview` → `octokit.rest.pulls.createReview()`
- `postReviewComment` → `octokit.rest.pulls.createReviewComment()`

### 1.2.7 Diff-to-Entity Mapping

The `analyzeImpact` activity needs to map PR diff hunks to ArangoDB entities. This reuses the existing `parseDiffHunks()` from `lib/mcp/tools/diff-filter.ts`:

```
For each hunk in parseDiffHunks(diff):
  1. Look up file entity: files collection WHERE file_path == hunk.filePath
  2. Query entities within changed line range:
     FOR entity IN functions UNION classes UNION variables
       FILTER entity.file_path == hunk.filePath
       FILTER entity.start_line <= hunk.endLine
       FILTER entity.end_line >= hunk.startLine
       RETURN entity
  3. For each matched entity:
     a) Query callers: TRAVERSE 1..1 INBOUND entity calls
     b) Count callers → impactRadius
     c) If impactRadius >= threshold → create ImpactFinding
```

### 1.2.8 Merge Ledger Workflow

The `mergeLedgerWorkflow` is a separate Temporal workflow, triggered on `pull_request.closed` with `merged: true`. It runs independently from `reviewPrWorkflow` — both are triggered by the webhook handler but for different events.

**Workflow definition:**
- Input: `{ orgId, repoId, sourceBranch, targetBranch, prNumber, mergedBy }`
- Activities (all on `light-llm-queue`):
  1. `fetchLedgerEntries` — Query ArangoDB for source branch entries
  2. `reparentLedgerEntries` — Bulk update `branch` and add `merged_from` field
  3. `createMergeNode` — Insert Merge Node into `ledger` collection
  4. `synthesizeLedgerSummary` — LLM generates narrative (gpt-4o-mini, 4K in + 800 out)
  5. `storeLedgerSummary` — Persist to `ledger_summaries` collection

**Guard:** If no ledger entries exist for the source branch, skip activities 2–5 (no AI activity on that branch).

---

## 1.3 Reliability & Resilience

### 1.3.1 Failure Scenarios

| # | Failure | Detection | Recovery | Data Risk |
|---|---------|-----------|----------|-----------|
| 1 | **GitHub API rate limit on fetchDiff** | 403 response with `X-RateLimit-Remaining: 0` | Temporal activity retries with backoff matching `X-RateLimit-Reset` header. Max wait: 60s. Installation tokens have 5000 req/hr limit — typically sufficient. | None — review delayed, not lost |
| 2 | **GitHub API rate limit on postReview** | 403 response | Same as #1. Review body + comments are already computed. Only the posting step retries. No re-computation. | None — review delayed |
| 3 | **Semgrep CLI crashes** | Non-zero exit code from `scanPatterns()` | Retry once. If still fails, skip Semgrep check entirely. Post review with only graph-based checks (impact, test, complexity). Log error with file details. | Low — partial review, no Semgrep findings |
| 4 | **ArangoDB down during analyzeImpact** | Query throws `ArangoError` | Retry 3× (200ms, 400ms, 800ms). If all fail, skip impact/dependency checks. Post review with only Semgrep findings. | Low — partial review |
| 5 | **Supabase down during PrReview creation** | Prisma error on insert | Retry 2× (500ms, 1000ms). If fails, workflow cannot start (no reviewId to update). Log error. Review skipped — not posted to GitHub. | Low — no review posted, webhook can be manually replayed |
| 6 | **Large PR (>500 changed files)** | File count check in fetchDiff | Cap at 100 files (most changed, prioritizing `lib/` and `app/` over test files). Log warning: "PR too large — reviewing first 100 files." Include note in review body. | None — partial but useful review |
| 7 | **PR closed before review completes** | Check PR state in postReview before posting | If PR is closed/merged, skip posting. Update PrReview status to `completed` with note: "PR closed before review could be posted." | None — no wasted API call |
| 8 | **Concurrent workflows for same PR** | Temporal workflowId dedup: `review-{orgId}-{repoId}-{prNumber}-{headSha}` | Second webhook for same headSha is rejected (workflow already running). Different headSha (synchronize) creates a separate workflow. | None — dedup by design |
| 9 | **LLM failure during merge summary synthesis** | Temporal activity timeout (30s) | Retry 3×. If all fail, create Merge Node without narrative summary. Summary can be manually triggered from dashboard. | Low — merge node exists, narrative missing |
| 10 | **Source branch has 0 ledger entries** | Empty result from `fetchLedgerEntries` | Skip reparent, merge node, and summary activities. No error — not every branch has AI activity. | None — expected case |
| 11 | **GitHub App permissions insufficient** | 403 response with "Resource not accessible by integration" | Log error. Update PrReview status to `failed` with clear error message. Dashboard shows "GitHub App needs PR write permissions — reinstall from Settings." | None — actionable error message |
| 12 | **Review comment line number out of range** | GitHub API returns 422 "position is not within diff" | Drop the individual comment. Post remaining comments. Log dropped comment. This happens when diff context has shifted between fetch and post. | Low — one comment lost, rest posted |

### 1.3.2 Idempotency

- **Webhook dedup:** Redis `setIfNotExists(deliveryId, TTL 24h)` prevents duplicate processing (inherited from Phase 5).
- **Workflow dedup:** Temporal `workflowId` includes `headSha` — same webhook payload can't start two workflows.
- **PrReview creation:** If a review record already exists for `(repoId, prNumber, headSha)`, skip creation and return existing record.
- **GitHub review posting:** If `postReview` fails after the review was actually created on GitHub (network timeout on response), the `github_review_id` may not be stored. On retry, `postReview` first checks if a kap10 review already exists on the PR (by searching for the kap10 signature in review comments) before creating a new one.

### 1.3.3 Webhook Security

Phase 7 reuses the existing webhook security from Phase 5:
- HMAC-SHA256 verification with constant-time comparison
- Redis delivery ID deduplication (24h TTL)
- Installation ID → orgId resolution via `github_installations` table

No additional webhook security is needed — the same `x-hub-signature-256` header protects all GitHub events.

---

## 1.4 Performance Considerations

### 1.4.1 Latency Budgets

| Operation | Target Latency | Bottleneck | Mitigation |
|---|---|---|---|
| **Webhook → workflow start** | <2s | Supabase PrReview insert + Temporal workflow start | PrReview insert is a single indexed write. Temporal start is fast (<100ms). |
| **fetchDiff** | <5s | GitHub API round-trip + diff parsing | Single API call. `filterDiff` and `parseDiffHunks` are in-memory string operations (<50ms). |
| **runSemgrep** | <30s | Semgrep CLI execution on changed files | Only scan changed files (not entire repo). Cap at 100 files. Semgrep config pre-built. Temp files on RAM disk. |
| **analyzeImpact** | <10s | ArangoDB graph traversal × entities | 1-hop traversal per entity is fast (<50ms each). Batch queries where possible. Cap at 200 entities per PR. |
| **postReview** | <5s | GitHub API for review creation + comments | Single `createReview` call includes all comments inline (batch, not per-comment). GitHub API handles up to 50 inline comments per review. |
| **Total end-to-end** | <60s | Sum of all activities | Typical small-to-medium PR (10–50 files): ~20s. Large PR (100+ files): ~45s. |
| **mergeLedgerWorkflow** | <30s | LLM narrative synthesis | LLM call is the slowest step (~15s). Other activities are fast ArangoDB queries/updates. |

### 1.4.2 Scaling Considerations

**Concurrent reviews:** Multiple PRs opened simultaneously for the same repo should not interfere. Each `reviewPrWorkflow` operates on its own diff and uses its own temp files. The only shared resource is ArangoDB (for rule/pattern queries and impact analysis), which handles concurrent reads well.

**GitHub API limits:** Installation tokens allow 5000 requests/hour. Each review uses ~4 calls (get PR, get diff, post review, possibly compare commits). At 5000/4 = 1250 reviews/hour, this is more than sufficient. If a team somehow hits the limit, Temporal retries with backoff matching the rate limit reset time.

**Semgrep on large diffs:** Even with 100 changed files, Semgrep typically completes in <15s. The rules file is small (auto-generated rules are concise YAML). The bottleneck is parsing, not rule evaluation.

### 1.4.3 Cost Analysis

Phase 7 is designed to be **nearly free** per review:

| Component | Cost per review | Notes |
|---|---|---|
| Semgrep | $0 | CLI runs locally, deterministic YAML |
| ArangoDB queries | $0 (infra cost only) | Graph traversal, no external API calls |
| GitHub API | $0 | Free within rate limits |
| LLM (merge summary only) | ~$0.002 | gpt-4o-mini, 4K input + 800 output, on merge only (not every review) |
| **Total per review** | **~$0** | LLM cost only on merge, not on review |

This is a key competitive advantage: most AI review bots charge per review because they use LLMs. kap10's reviews are deterministic Semgrep + graph queries — the cost is effectively zero.

---

## 1.5 Phase Bridge → Phase 8

Phase 7 establishes the review pipeline that Phase 8 (Usage-Based Billing) measures and monetizes:

### What Phase 8 Inherits

| Phase 7 Artifact | Phase 8 Consumption |
|---|---|
| `PrReview` records with status and check counts | Phase 8's usage dashboard shows "PR reviews this month" as a feature usage metric. Plan tiers gate review count. |
| `reviewPrWorkflow` Temporal workflow | Phase 8's billing metering tags the workflow with `orgId` for usage attribution. The LLM call in `synthesizeLedgerSummary` (merge only) is tracked via Langfuse. |
| Review Configuration (per-repo settings) | Phase 8 gates some config options by plan tier (e.g., auto-approve on clean is Pro+ only). |
| MCP `check_patterns`/`check_rules` from Phase 6 | Phase 8's Langfuse integration tracks LLM tokens consumed by `suggest_approach` (the only LLM-using MCP tool from Phase 6), which is the primary cost driver. |

### What Phase 7 Must NOT Do (Respecting Phase 8 Boundaries)

1. **Must NOT implement billing or usage limits.** Reviews run unconditionally in Phase 7. Plan-based gating of review features is Phase 8.
2. **Must NOT implement Langfuse integration.** Phase 7's review pipeline has no LLM calls (except the optional merge summary, which Phase 8 will tag). Langfuse metering is Phase 8.
3. **Must NOT implement Stripe checkout or subscription management.** Phase 7 reviews are free. Monetization is Phase 8.
4. **Must NOT rate-limit reviews by plan tier.** All indexed repos get reviews. Tier-based limits are Phase 8.

### Schema Forward-Compatibility

- `PrReview` includes `github_review_id` — Phase 8 can link to Stripe invoices or usage records.
- `ReviewConfig` is a JSON field — Phase 8 can add plan-gated fields without a migration.
- `PrReviewComment` includes `semgrep_rule_id` — Phase 8's usage dashboard can show "which rules generated the most findings" analytics.

---

# Part 2: Implementation & Tracing Tracker

> **Dependency graph:** Infrastructure (P7-INFRA) → Database (P7-DB) → Ports & Adapters (P7-ADAPT) → Backend (P7-API) → Frontend (P7-UI). Testing (P7-TEST) runs in parallel with each layer.
>
> **Recommended implementation order:** P7-DB-01 → P7-DB-02 → P7-ADAPT-01 → P7-ADAPT-02 → P7-API-01 → P7-API-02 → P7-API-03 → P7-API-04 → P7-API-05 → P7-API-06 → P7-API-07 → P7-API-08 → P7-API-09 → P7-UI-01 → P7-UI-02 → P7-UI-03 → P7-UI-04

---

## 2.1 Infrastructure Layer

### P7-INFRA-01: GitHub App Permissions Update

- [ ] **Status:** Not started
- **Description:** Ensure the kap10 GitHub App has the required permissions for PR review. The app currently has `contents: read` and `metadata: read` (for cloning and webhooks). Phase 7 needs:
  - `pull_requests: write` — Post reviews and review comments
  - `checks: write` — Optional, for future GitHub Checks API integration
  - Subscribe to `pull_request` webhook events (in addition to existing `installation`, `push`)
- **Files:**
  - GitHub App settings (external — GitHub Developer Settings)
  - Documentation update: `docs/architecture/README.md` (note new permissions)
- **Testing:** App can call `pulls.createReview()` without 403. `pull_request` webhooks arrive at `/api/webhooks/github`.
- **Notes:** Existing installations will need to re-approve permissions. GitHub sends a `new_permissions_accepted` event when users approve.

---

## 2.2 Database & Schema Layer

### P7-DB-01: Supabase Migration — PrReview & PrReviewComment

- [ ] **Status:** Not started
- **Description:** Create the `kap10.pr_reviews` and `kap10.pr_review_comments` tables. Add `review_config` JSON column to `kap10.repos`.
- **Files:**
  - `supabase/migrations/2026XXXX_phase7_pr_reviews.sql` (new)
  - `prisma/schema.prisma` (modify — add `PrReview`, `PrReviewComment` models, add `reviewConfig Json?` to Repo, add `reviews PrReview[]` relation)
- **Testing:** `pnpm migrate` succeeds. `pnpm prisma generate` succeeds. CRUD operations work via Prisma. Cascade delete works (delete repo → delete reviews → delete comments).
- **Notes:** Both models use `@@schema("kap10")` and `@@map(...)`. Run `pnpm prisma generate` after schema change.

### P7-DB-02: Domain Types — PrReview, PrReviewComment, ReviewConfig

- [ ] **Status:** Not started
- **Description:** Add TypeScript domain types for PR review data to `lib/ports/types.ts`.
- **Types:**
  - `PrReviewRecord`: `{ id, repoId, prNumber, prTitle, prUrl, headSha, baseSha, status, checksPassed, checksWarned, checksFailed, reviewBody, githubReviewId, errorMessage, createdAt, completedAt }`
  - `PrReviewCommentRecord`: `{ id, reviewId, filePath, lineNumber, checkType, severity, message, suggestion, semgrepRuleId, ruleTitle, githubCommentId, createdAt }`
  - `ReviewConfig`: `{ enabled, autoApproveOnClean, targetBranches, skipDraftPrs, impactThreshold, complexityThreshold, checksEnabled, ignorePaths }`
  - `ImpactFinding`: `{ entityId, entityName, filePath, line, callerCount, topCallers: {name, filePath}[] }`
  - `PatternFinding`: `{ ruleId, ruleTitle, filePath, line, message, severity, suggestion, adherenceRate }`
  - `TestFinding`: `{ filePath, expectedTestPath, message }`
  - `ComplexityFinding`: `{ entityId, entityName, filePath, line, complexity, threshold }`
  - `DependencyFinding`: `{ filePath, importPath, line, message }`
- **Files:**
  - `lib/ports/types.ts` (modify)
- **Testing:** Types compile. Used by port interfaces and activity implementations.

---

## 2.3 Ports & Adapters Layer

### P7-ADAPT-01: IGitHost Extension — Review Methods

- [ ] **Status:** Not started
- **Description:** Add review-posting methods to the `IGitHost` port and implement in `GitHubHost`. Also implement the existing stub methods (`getPullRequest`, `getDiff`).
- **Methods to implement (existing stubs):**
  - `getPullRequest(owner, repo, prNumber)` → `octokit.rest.pulls.get()`
  - `getDiff(owner, repo, baseSha, headSha)` → `octokit.rest.repos.compareCommits()` with diff media type
- **Methods to add (new):**
  - `postReview(owner, repo, prNumber, review)` → `octokit.rest.pulls.createReview()`
  - `postReviewComment(owner, repo, prNumber, comment)` → `octokit.rest.pulls.createReviewComment()`
  - `getPullRequestFiles(owner, repo, prNumber)` → `octokit.rest.pulls.listFiles()` — paginated file list
- **PullRequest type expansion:** Add `headSha`, `baseSha`, `htmlUrl`, `body`, `draft`, `merged`, `state` to the existing minimal `PullRequest` interface.
- **Files:**
  - `lib/ports/git-host.ts` (modify — add methods, expand PullRequest type)
  - `lib/adapters/github-host.ts` (modify — implement all methods)
  - `lib/di/fakes.ts` (modify — add methods to `FakeGitHost`)
- **Testing:** `getPullRequest` returns PR metadata. `getDiff` returns unified diff. `postReview` creates review on GitHub (integration test with real API, or mock). `FakeGitHost` stores posted reviews for assertion.
- **Blocked by:** P7-INFRA-01

### P7-ADAPT-02: IRelationalStore Extension — PR Review CRUD

- [ ] **Status:** Not started
- **Description:** Add PR review CRUD methods to `IRelationalStore` and implement in `PrismaRelationalStore`.
- **Methods to add:**
  - `createPrReview(data): Promise<PrReviewRecord>`
  - `updatePrReview(id, data): Promise<void>`
  - `getPrReview(id): Promise<PrReviewRecord | null>`
  - `getPrReviewByPrAndSha(repoId, prNumber, headSha): Promise<PrReviewRecord | null>` — for idempotency check
  - `listPrReviews(repoId, opts): Promise<PrReviewRecord[]>` — paginated, sorted by createdAt DESC
  - `createPrReviewComment(data): Promise<PrReviewCommentRecord>`
  - `listPrReviewComments(reviewId): Promise<PrReviewCommentRecord[]>`
  - `updateRepoReviewConfig(repoId, config): Promise<void>`
  - `getRepoReviewConfig(repoId): Promise<ReviewConfig>`
- **Files:**
  - `lib/ports/relational-store.ts` (modify — add methods)
  - `lib/adapters/prisma-relational-store.ts` (modify — implement)
  - `lib/di/fakes.ts` (modify — add to `InMemoryRelationalStore`)
- **Testing:** CRUD operations work. Idempotency check returns existing record. Pagination and sorting correct. ReviewConfig stored and retrieved as JSON.
- **Blocked by:** P7-DB-01

---

## 2.4 Backend / API Layer

### P7-API-01: Webhook Handler — pull_request Event

- [ ] **Status:** Not started
- **Description:** Extend the existing GitHub webhook handler to process `pull_request` events. Handle three actions: `opened`, `synchronize`, `reopened` → trigger review. Handle `closed` with `merged: true` → trigger ledger merge.
- **Implementation:**
  - Add `pull_request` event check alongside existing `installation` check
  - For `opened`/`synchronize`/`reopened`:
    a) Resolve orgId, repoId (existing helper)
    b) Guard checks: repo ready, review enabled, not draft, target branch matches
    c) Create PrReview record
    d) Start `reviewPrWorkflow` via Temporal
  - For `closed` with `merged: true`:
    a) Start `mergeLedgerWorkflow` via Temporal
    b) Independent from review workflow
- **Files:**
  - `app/api/webhooks/github/route.ts` (modify)
  - `lib/github/webhook-handlers/pull-request.ts` (new — extracted handler logic)
- **Testing:** `opened` action triggers `reviewPrWorkflow`. `synchronize` triggers new review. `closed` + `merged` triggers `mergeLedgerWorkflow`. `closed` without merge does nothing. Draft PRs skipped. Non-target branch PRs skipped. Unknown action ignored.
- **Blocked by:** P7-ADAPT-01, P7-ADAPT-02

### P7-API-02: Review Pipeline — Diff Analyzer

- [ ] **Status:** Not started
- **Description:** Build the diff analysis module that maps GitHub diffs to ArangoDB entities. Reuses `filterDiff()` and `parseDiffHunks()` from `lib/mcp/tools/diff-filter.ts`.
- **Responsibilities:**
  - Parse unified diff into per-file changed line ranges
  - Filter out lockfiles, build artifacts, vendor files
  - Map changed lines to ArangoDB entities (file + line range overlap query)
  - Provide the mapping to downstream checks (impact, test, complexity)
- **Files:**
  - `lib/review/diff-analyzer.ts` (new)
- **Testing:** Correctly parses multi-file diffs. Filters lockfiles. Maps changed lines to entities. Handles renames. Handles deleted files.
- **Notes:** Import from `diff-filter.ts` — do not duplicate the filtering/parsing logic.

### P7-API-03: Review Checks — Pattern Check (Semgrep)

- [ ] **Status:** Not started
- **Description:** Run Semgrep rules against changed files in the PR diff. Only report violations on changed lines.
- **Implementation:**
  - Fetch active rules + pinned patterns with `semgrepRule` from ArangoDB
  - Write changed files from persistent workspace to temp directory
  - Concatenate Semgrep YAML rules into single config
  - Execute via `IPatternEngine.scanPatterns(tempDir, configPath)`
  - Map Semgrep findings to diff line numbers
  - Filter: only findings on lines within diff hunks (not pre-existing violations)
  - Return `PatternFinding[]`
- **Files:**
  - `lib/review/checks/pattern-check.ts` (new)
- **Testing:** Finds violations on changed lines. Ignores violations on unchanged lines. No rules → empty findings. Semgrep crash → graceful degradation.
- **Blocked by:** Phase 6 `IPatternEngine` real implementation (P6-ADAPT-02)

### P7-API-04: Review Checks — Impact Analysis

- [ ] **Status:** Not started
- **Description:** For each changed entity, traverse the ArangoDB call graph to find callers. Flag entities with caller count above the configurable threshold.
- **Implementation:**
  - For each entity matched by diff analyzer:
    `FOR caller IN 1..1 INBOUND entity calls RETURN caller`
  - Count callers, collect top 5 for display
  - If callerCount >= `reviewConfig.impactThreshold` (default: 15) → create ImpactFinding
  - Batch queries to avoid N+1: use AQL `FOR entity IN @entityIds ...`
- **Files:**
  - `lib/review/checks/impact-check.ts` (new)
- **Testing:** Correctly counts callers. Threshold filtering works. Entities with 0 callers produce no finding. Batch query handles 100+ entities.
- **Blocked by:** P7-API-02

### P7-API-05: Review Checks — Missing Test

- [ ] **Status:** Not started
- **Description:** Check if changed files under `lib/` (or configurable paths) have corresponding `__tests__/` companion files.
- **Implementation:**
  - For each changed file matching `lib/**/*`:
    Expected test path: `{dir}/__tests__/{filename}.test.{ext}` or `{dir}/__tests__/{filename}.spec.{ext}`
  - Check workspace filesystem for existence
  - If missing → create TestFinding
  - Configurable: `reviewConfig.checksEnabled.test` can disable
- **Files:**
  - `lib/review/checks/test-check.ts` (new)
- **Testing:** Detects missing test companions. Existing test files → no finding. Non-lib files → skipped. Config disable works.

### P7-API-06: Review Checks — Complexity & New Dependency

- [ ] **Status:** Not started
- **Description:** Two lightweight checks: cyclomatic complexity spike (via ast-grep if available) and new import detection (via ArangoDB import graph).
- **Complexity check:**
  - If `IPatternEngine.scanWithAstGrep` is available (Phase 6), analyze changed functions
  - Count branches (if/else, switch, ternary, &&, ||) in changed functions
  - If complexity > threshold → ComplexityFinding
  - If ast-grep not available → skip (no degradation, just no complexity check)
- **New dependency check:**
  - Parse imports from changed files
  - Compare against ArangoDB imports graph for this repo
  - If import path not seen before → DependencyFinding (severity: info)
- **Files:**
  - `lib/review/checks/complexity-check.ts` (new)
  - `lib/review/checks/dependency-check.ts` (new)
- **Testing:** Complexity correctly counted. New imports detected. Existing imports not flagged. ast-grep unavailable → check skipped gracefully.
- **Blocked by:** P7-API-02

### P7-API-07: Comment Builder

- [ ] **Status:** Not started
- **Description:** Build markdown-formatted review comments from all check findings. Follows the templates defined in § 1.2.4.
- **Implementation:**
  - Accept all findings: `PatternFinding[]`, `ImpactFinding[]`, `TestFinding[]`, `ComplexityFinding[]`, `DependencyFinding[]`
  - Generate per-finding markdown using templates
  - Generate review body summary: "kap10 found N issues (X warnings, Y info)"
  - Determine review action: `REQUEST_CHANGES` (any error), `COMMENT` (warnings only), `APPROVE` (if config enables auto-approve)
  - Map findings to GitHub review comment format: `{ path, line, body }`
  - Cap at 50 inline comments per review (GitHub API limit)
- **Files:**
  - `lib/review/comment-builder.ts` (new)
- **Testing:** Correct markdown output for each finding type. Summary counts correct. Review action matches severity. Comments capped at 50. Empty findings → clean review body.

### P7-API-08: reviewPrWorkflow — Temporal Workflow

- [ ] **Status:** Not started
- **Description:** The four-activity Temporal workflow that orchestrates the PR review pipeline.
- **Workflow definition:**
  - Input: `{ orgId, repoId, prNumber, installationId, headSha, baseSha, owner, repo, reviewId }`
  - Activity 1: `fetchDiff` (light-llm-queue, timeout: 30s, retry: 3×)
  - Activity 2: `runSemgrep` (heavy-compute-queue, timeout: 60s, retry: 2×)
  - Activity 3: `analyzeImpact` (light-llm-queue, timeout: 30s, retry: 3×)
  - Activity 4: `postReview` (light-llm-queue, timeout: 30s, retry: 5× with exponential backoff)
  - On success: Update PrReview status to `completed`
  - On failure (all retries exhausted): Update PrReview status to `failed` with error message
- **Activities implementation:**
  - `fetchDiff`: Call `IGitHost.getDiff()`, parse + filter, return parsed hunks
  - `runSemgrep`: Fetch rules/patterns, run Semgrep, map to findings
  - `analyzeImpact`: Run all checks (impact, test, complexity, dependency)
  - `postReview`: Build comments, post to GitHub, store comments in Supabase
- **Files:**
  - `lib/temporal/workflows/review-pr.ts` (new)
  - `lib/temporal/activities/review.ts` (new)
  - `lib/temporal/workflows/index.ts` (modify — export)
  - `lib/temporal/activities/index.ts` (modify — export)
- **Testing:** Full pipeline succeeds with mock data. Partial failure (Semgrep fails) → review posted without pattern findings. GitHub API failure → retries. PrReview status updated correctly on success and failure.
- **Blocked by:** P7-API-02 through P7-API-07, P7-ADAPT-01, P7-ADAPT-02

### P7-API-09: mergeLedgerWorkflow — Temporal Workflow

- [ ] **Status:** Not started
- **Description:** Five-activity Temporal workflow for reparenting ledger entries and generating a narrative summary when a PR is merged.
- **Workflow definition:**
  - Input: `{ orgId, repoId, sourceBranch, targetBranch, prNumber, mergedBy }`
  - Activity 1: `fetchLedgerEntries` (light-llm-queue, timeout: 15s)
  - Activity 2: `reparentLedgerEntries` (light-llm-queue, timeout: 30s)
  - Activity 3: `createMergeNode` (light-llm-queue, timeout: 15s)
  - Activity 4: `synthesizeLedgerSummary` (light-llm-queue, timeout: 60s, retry: 3×)
  - Activity 5: `storeLedgerSummary` (light-llm-queue, timeout: 15s)
  - Guard: If Activity 1 returns 0 entries, skip Activities 2–5
- **Files:**
  - `lib/temporal/workflows/merge-ledger.ts` (new)
  - `lib/temporal/activities/ledger-merge.ts` (new)
  - `lib/use-cases/summarizer.ts` (new — LLM narrative synthesis, reusable)
  - `lib/temporal/workflows/index.ts` (modify — export)
  - `lib/temporal/activities/index.ts` (modify — export)
- **Testing:** Full pipeline: fetch → reparent → merge node → summarize → store. Empty branch → skip. LLM failure → merge node exists, no summary. Reparenting preserves original timestamps. Merge node has correct metadata.
- **Blocked by:** Phase 5.5 ledger implementation (P5.5-ADAPT-01, P5.5-ADAPT-02)

### P7-API-10: REST API Routes for Reviews

- [ ] **Status:** Not started
- **Description:** Dashboard API routes for viewing PR review history and details.
- **Routes:**
  - `GET /api/repos/{repoId}/reviews` — List reviews (paginated, sorted by createdAt DESC)
  - `GET /api/repos/{repoId}/reviews/{reviewId}` — Review detail with comments
  - `POST /api/repos/{repoId}/reviews/{reviewId}/retry` — Manually retry a failed review
  - `GET /api/repos/{repoId}/settings/review` — Get review config
  - `PATCH /api/repos/{repoId}/settings/review` — Update review config
  - `GET /api/repos/{repoId}/history` — Merge history with narrative summaries (ledger merge nodes + summaries)
- **Auth:** Session-based. Org membership required. Config changes require admin/owner role.
- **Files:**
  - `app/api/repos/[repoId]/reviews/route.ts` (new)
  - `app/api/repos/[repoId]/reviews/[reviewId]/route.ts` (new)
  - `app/api/repos/[repoId]/reviews/[reviewId]/retry/route.ts` (new)
  - `app/api/repos/[repoId]/settings/review/route.ts` (new)
  - `app/api/repos/[repoId]/history/route.ts` (new)
- **Testing:** List returns reviews sorted correctly. Detail includes comments. Retry creates new workflow for failed reviews. Config CRUD works. Auth enforced.
- **Blocked by:** P7-ADAPT-02

### P7-API-11: Dashboard Navigation Update

- [ ] **Status:** Not started
- **Description:** Add "Reviews" to the repo sub-navigation in the dashboard.
- **Files:**
  - `components/dashboard/dashboard-nav.tsx` (modify — add nav item)
- **Testing:** Nav item appears. Link navigates to correct page. Active state highlights correctly.

---

## 2.5 Frontend / UI Layer

### P7-UI-01: PR Review History Page

- [ ] **Status:** Not started
- **Description:** Dashboard page at `/repos/[repoId]/reviews` showing the review history for the repo.
- **Design:**
  - Review list with cards:
    - PR number + title (linked to GitHub PR)
    - Status badge: pending (blue), reviewing (yellow), completed (green), failed (red)
    - Check count summary: `3 passed · 2 warnings · 0 errors`
    - Head SHA (short, linked to commit)
    - Timestamp (relative: "2 hours ago")
  - Pagination: Cursor-based infinite scroll
  - Filter: Status, date range
  - Empty state: "No PR reviews yet. Reviews will appear automatically when PRs are opened."
- **Files:**
  - `app/(dashboard)/repos/[repoId]/reviews/page.tsx` (new)
  - `components/repo/review-card.tsx` (new)
  - `components/repo/review-status-badge.tsx` (new)
- **Testing:** Reviews render with correct status badges. GitHub links work. Pagination works. Empty state displayed for new repos.
- **Notes:** Follow design system: `glass-card`, `font-grotesk`, `bg-background`. Status badges use semantic colors: green for completed, yellow for reviewing, red for failed.
- **Blocked by:** P7-API-10

### P7-UI-02: PR Review Detail Page

- [ ] **Status:** Not started
- **Description:** Detail view at `/repos/[repoId]/reviews/[reviewId]` showing the full review with all comments.
- **Design:**
  - Header: PR title, number, GitHub link, review status, timestamp
  - Summary panel: Review body (markdown rendered), check counts
  - Comments grouped by check type (tabs or sections):
    - Pattern violations (with Semgrep rule reference)
    - Impact warnings (with caller list, expandable)
    - Missing tests (with expected file path)
    - Complexity spikes (with metric)
    - New dependencies (with import path)
  - Each comment: file path (linked to GitHub diff line), severity badge, message, suggestion (if any)
  - Retry button (if status == "failed"): Re-triggers the review workflow
- **Files:**
  - `app/(dashboard)/repos/[repoId]/reviews/[reviewId]/page.tsx` (new)
  - `components/repo/review-detail.tsx` (new)
  - `components/repo/review-comment-card.tsx` (new)
  - `components/repo/review-comment-group.tsx` (new)
- **Testing:** Detail page renders. Comments grouped correctly. Severity badges color-coded. Retry button appears for failed reviews. GitHub links open correct diff lines.
- **Blocked by:** P7-UI-01

### P7-UI-03: Review Configuration Settings

- [ ] **Status:** Not started
- **Description:** Settings section within `/repos/[repoId]/settings` (or dedicated page) for configuring PR review behavior.
- **Design:**
  - Toggle: Enable/disable reviews
  - Toggle: Auto-approve when no findings
  - Multi-select: Target branches (default: main)
  - Toggle: Skip draft PRs
  - Number input: Impact threshold (default: 15)
  - Number input: Complexity threshold (default: 10)
  - Check type toggles: Enable/disable each check type independently
  - Text area: Ignore paths (glob patterns, one per line)
  - Save button: Validates and saves config
- **Files:**
  - `app/(dashboard)/repos/[repoId]/settings/review/page.tsx` (new — or section within existing settings page)
  - `components/repo/review-config-form.tsx` (new)
- **Testing:** Config form loads current values. Changes save correctly. Validation prevents invalid values (e.g., negative thresholds). Toggle changes take effect on next review.
- **Blocked by:** P7-API-10

### P7-UI-04: Merge History Page

- [ ] **Status:** Not started
- **Description:** Dashboard page at `/repos/[repoId]/history` showing branch merge history with narrative summaries.
- **Design:**
  - Timeline of merge events:
    - Source branch → target branch
    - PR number (linked to GitHub)
    - Merged by (user avatar + name)
    - Entry count (how many AI interactions on this branch)
    - Narrative summary (expandable, markdown rendered)
    - Timestamp
  - Empty state: "No merge history yet. AI activity narratives will appear after PRs are merged."
- **Files:**
  - `app/(dashboard)/repos/[repoId]/history/page.tsx` (new)
  - `components/repo/merge-history-card.tsx` (new)
  - `components/repo/merge-narrative.tsx` (new)
- **Testing:** Merge events render chronologically. Narratives render as markdown. GitHub PR links work. Empty state displayed correctly.
- **Blocked by:** P7-API-10

---

## 2.6 Testing & Verification

### P7-TEST-01: Webhook Handler — pull_request Event

- [ ] **Status:** Not started
- **Description:** Unit tests for the PR webhook handler logic.
- **Test cases:**
  - `opened` action → creates PrReview + starts reviewPrWorkflow
  - `synchronize` action → creates new PrReview + starts new workflow
  - `reopened` action → same as opened
  - `closed` + `merged: true` → starts mergeLedgerWorkflow
  - `closed` + `merged: false` → no workflow started
  - Draft PR → skipped (if config.skipDraftPrs)
  - Non-target branch → skipped
  - Repo not ready (status != "ready") → skipped with log
  - Review disabled in config → skipped
  - HMAC signature invalid → 401
  - Duplicate delivery ID → ignored
- **Files:**
  - `lib/github/webhook-handlers/__tests__/pull-request.test.ts` (new)
- **Blocked by:** P7-API-01

### P7-TEST-02: Diff Analyzer

- [ ] **Status:** Not started
- **Description:** Unit tests for diff parsing and entity mapping.
- **Test cases:**
  - Multi-file unified diff → correct per-file hunks
  - Lockfiles/build artifacts filtered out
  - Changed lines mapped to correct ArangoDB entities
  - Renamed files handled
  - Deleted files handled (no entity lookup)
  - Binary files skipped
  - Empty diff → empty results
- **Files:**
  - `lib/review/__tests__/diff-analyzer.test.ts` (new)
- **Blocked by:** P7-API-02

### P7-TEST-03: Review Checks — All Types

- [ ] **Status:** Not started
- **Description:** Unit tests for each check type.
- **Pattern check tests:**
  - Violation on changed line → finding
  - Violation on unchanged line → NOT a finding (critical: no pre-existing noise)
  - No Semgrep rules → empty findings
  - Semgrep crash → graceful degradation
- **Impact check tests:**
  - Entity with 20 callers (threshold 15) → finding
  - Entity with 10 callers (threshold 15) → no finding
  - Entity with 0 callers → no finding
  - Batch query handles 100+ entities
- **Test check tests:**
  - Changed lib/ file without __tests__/ companion → finding
  - Changed lib/ file with existing test → no finding
  - Changed app/ file → no finding (test check only for lib/)
- **Complexity check tests:**
  - Function with complexity 14 (threshold 10) → finding
  - Function with complexity 5 → no finding
  - ast-grep unavailable → check skipped gracefully
- **Dependency check tests:**
  - New import path → finding (info)
  - Existing import path → no finding
- **Files:**
  - `lib/review/checks/__tests__/pattern-check.test.ts` (new)
  - `lib/review/checks/__tests__/impact-check.test.ts` (new)
  - `lib/review/checks/__tests__/test-check.test.ts` (new)
  - `lib/review/checks/__tests__/complexity-check.test.ts` (new)
  - `lib/review/checks/__tests__/dependency-check.test.ts` (new)
- **Blocked by:** P7-API-03 through P7-API-06

### P7-TEST-04: Comment Builder

- [ ] **Status:** Not started
- **Description:** Unit tests for markdown comment generation and review action determination.
- **Test cases:**
  - Pattern finding → correct markdown template
  - Impact finding → markdown with caller list
  - Missing test → markdown with expected path
  - Review action: error finding → REQUEST_CHANGES
  - Review action: warning only → COMMENT
  - Review action: no findings + autoApprove → APPROVE
  - Review action: no findings + no autoApprove → COMMENT
  - Cap at 50 comments (excess dropped with note in body)
  - Empty findings → clean summary body
- **Files:**
  - `lib/review/__tests__/comment-builder.test.ts` (new)
- **Blocked by:** P7-API-07

### P7-TEST-05: reviewPrWorkflow End-to-End

- [ ] **Status:** Not started
- **Description:** Integration test for the full four-activity review pipeline.
- **Test cases:**
  - Clean PR (no violations) → review posted with COMMENT action
  - PR with pattern violations → review with inline comments
  - PR with impact warning → review includes impact comment
  - Semgrep failure → review posted without pattern findings (partial)
  - ArangoDB failure in impact → review posted without impact findings (partial)
  - GitHub API rate limit → retries succeed
  - PR closed during review → postReview skipped
  - PrReview status updated to completed/failed correctly
  - PrReviewComment records created for each comment
  - Large PR (100+ files) → capped and reviewed
- **Files:**
  - `lib/temporal/workflows/__tests__/review-pr-workflow.test.ts` (new)
- **Blocked by:** P7-API-08

### P7-TEST-06: mergeLedgerWorkflow

- [ ] **Status:** Not started
- **Description:** Integration test for the ledger merge pipeline.
- **Test cases:**
  - Branch with ledger entries → entries reparented, merge node created, summary generated
  - Branch with 0 entries → all activities skipped, no error
  - LLM failure → merge node exists, no summary (graceful)
  - Reparented entries preserve original timestamps and ordering
  - Merge node has correct metadata (source/target branch, PR number, merged by)
  - Summary has correct counts (entries, prompts, tool calls)
  - Reparented entries have `merged_from` field set
- **Files:**
  - `lib/temporal/workflows/__tests__/merge-ledger-workflow.test.ts` (new)
- **Blocked by:** P7-API-09

### P7-TEST-07: IGitHost Review Methods

- [ ] **Status:** Not started
- **Description:** Test the GitHubHost implementation of PR review methods.
- **Test cases:**
  - `getPullRequest` returns correct metadata
  - `getDiff` returns unified diff format
  - `postReview` creates review with inline comments
  - `postReviewComment` creates single line comment
  - `getPullRequestFiles` returns paginated file list
  - Rate limit response → error with `retryAfter` info
  - 403 permissions error → clear error message
  - `FakeGitHost` stores reviews and comments for assertion
- **Files:**
  - `lib/adapters/__tests__/github-host-review.test.ts` (new)
  - `lib/di/__tests__/port-compliance.test.ts` (modify — extend IGitHost tests)
- **Blocked by:** P7-ADAPT-01

### P7-TEST-08: REST API Routes

- [ ] **Status:** Not started
- **Description:** Integration tests for dashboard API routes.
- **Test cases:**
  - List reviews: paginated, sorted by createdAt DESC
  - Review detail: includes comments grouped by checkType
  - Retry: creates new workflow for failed review, returns 409 for non-failed review
  - Config GET: returns current config (defaults if not set)
  - Config PATCH: validates and updates, returns updated config
  - History: returns merge events with narratives
  - Auth: unauthenticated → 401, non-member → 403
  - Config change requires admin role
- **Files:**
  - `app/api/repos/[repoId]/reviews/__tests__/reviews-api.test.ts` (new)
- **Blocked by:** P7-API-10

### P7-TEST-09: Changed-Lines-Only Filtering

- [ ] **Status:** Not started
- **Description:** Critical test verifying that only violations on changed lines are reported — never pre-existing violations.
- **Test cases:**
  - File with pre-existing violation on line 10, PR changes lines 50–60 → no finding for line 10
  - File with pre-existing violation on line 10, PR changes lines 8–15 → finding for line 10 (it's in the changed range)
  - New file added in PR → all lines are "changed" → all violations reported
  - Deleted file → no findings (file is gone)
  - File with only whitespace changes → no findings (filterDiff strips non-semantic changes)
- **Files:**
  - `lib/review/checks/__tests__/changed-lines-filter.test.ts` (new)
- **Blocked by:** P7-API-03

---

## New Files Summary

```
lib/
  review/
    diff-analyzer.ts                ← Parse diff, map to entities
    comment-builder.ts              ← Build markdown review comments
    checks/
      pattern-check.ts              ← Semgrep rule execution on changed files
      impact-check.ts               ← ArangoDB caller graph traversal
      test-check.ts                 ← Missing test companion detection
      complexity-check.ts           ← ast-grep complexity analysis
      dependency-check.ts           ← New import detection
      __tests__/
        pattern-check.test.ts
        impact-check.test.ts
        test-check.test.ts
        complexity-check.test.ts
        dependency-check.test.ts
        changed-lines-filter.test.ts
    __tests__/
      diff-analyzer.test.ts
      comment-builder.test.ts
  github/
    webhook-handlers/
      pull-request.ts               ← PR webhook event handler
      __tests__/
        pull-request.test.ts
  temporal/
    workflows/
      review-pr.ts                  ← reviewPrWorkflow definition
      merge-ledger.ts               ← mergeLedgerWorkflow definition
      __tests__/
        review-pr-workflow.test.ts
        merge-ledger-workflow.test.ts
    activities/
      review.ts                     ← fetchDiff, runSemgrep, analyzeImpact, postReview
      ledger-merge.ts               ← fetchLedgerEntries, reparentLedgerEntries, createMergeNode
  use-cases/
    summarizer.ts                   ← LLM narrative synthesis (reusable)
app/
  api/
    repos/[repoId]/
      reviews/
        route.ts                    ← GET review list
        [reviewId]/
          route.ts                  ← GET review detail
          retry/route.ts            ← POST retry failed review
      settings/
        review/route.ts             ← GET/PATCH review config
      history/route.ts              ← GET merge history
    repos/[repoId]/reviews/__tests__/
      reviews-api.test.ts
  (dashboard)/
    repos/[repoId]/
      reviews/
        page.tsx                    ← Review history page
        [reviewId]/page.tsx         ← Review detail page
      history/page.tsx              ← Merge history page
      settings/
        review/page.tsx             ← Review config settings
components/repo/
  review-card.tsx                   ← Review list card
  review-status-badge.tsx           ← Status badge component
  review-detail.tsx                 ← Review detail view
  review-comment-card.tsx           ← Single comment card
  review-comment-group.tsx          ← Comments grouped by check type
  review-config-form.tsx            ← Review settings form
  merge-history-card.tsx            ← Merge event card
  merge-narrative.tsx               ← Narrative summary renderer
supabase/migrations/
  2026XXXX_phase7_pr_reviews.sql
```

## Modified Files Summary

```
lib/ports/git-host.ts                       ← Add postReview, postReviewComment, getPullRequestFiles; expand PullRequest type
lib/ports/relational-store.ts               ← Add PR review CRUD methods
lib/ports/types.ts                          ← Add PrReviewRecord, PrReviewCommentRecord, ReviewConfig, finding types
lib/adapters/github-host.ts                 ← Implement getPullRequest, getDiff, postReview, postReviewComment
lib/adapters/prisma-relational-store.ts     ← Implement PR review CRUD
lib/di/fakes.ts                             ← Add review methods to FakeGitHost, InMemoryRelationalStore
lib/di/__tests__/port-compliance.test.ts    ← Extend IGitHost tests
lib/temporal/workflows/index.ts             ← Export reviewPrWorkflow, mergeLedgerWorkflow
lib/temporal/activities/index.ts            ← Export review + ledger-merge activities
app/api/webhooks/github/route.ts            ← Add pull_request event handling
prisma/schema.prisma                        ← Add PrReview, PrReviewComment models; add reviewConfig to Repo
components/dashboard/dashboard-nav.tsx       ← Add Reviews nav item
```

---

## Revision Log

| Date | Author | Changes |
|---|---|---|
| 2026-02-21 | Phase 7 Design | Initial document. 5 user flows (3 core + 2 dashboard), 8 system logic sections, 12 failure scenarios, 7 latency budgets, cost analysis, phase bridge to Phase 8, 40 tracker items across 6 layers. Includes Phase 7 Enhancement (Ledger Trace Merging). |
