# Feature → Architecture Map

> Reverse mapping from user-facing features to architecture docs, design decisions, and code locations.
> Use this to quickly find where a feature is designed, why it works the way it does, and where to start coding.

---

## How to Read This Doc

Each feature links to:
- **Architecture Doc** — the phase doc(s) that describe the design
- **Design Decisions** — why it was built this way (trade-offs, alternatives rejected)
- **Key Code Paths** — files to open first when working on the feature
- **Data Stores** — which of the four stores (PostgreSQL, ArangoDB, Temporal, Redis) are involved

---

## 1. Onboarding & Setup

### 1.1 One-Command Setup

| | |
|---|---|
| **Architecture Doc** | [PHASE_5.6_CLI_FIRST_ONBOARDING.md](PHASE_5.6_CLI_FIRST_ONBOARDING.md) |
| **Design Decisions** | RFC 8628 Device Authorization chosen over browser-redirect OAuth because CLI environments have no reliable callback URL. Org-level API keys (not repo-level) so a single key grants access to all repos. IDE detection uses env vars + directory markers, not process inspection. Credentials at `~/.unerr/credentials.json` (mode 0o600). |
| **Data Flow** | CLI → `POST /api/cli/device-code` → Redis state (10min TTL) → browser approval at `/cli/authorize` → `POST /api/cli/token` polling → API key issued → MCP config written to IDE |
| **Key Code** | `packages/cli/src/commands/setup.ts`, `packages/cli/src/commands/connect.ts`, `packages/cli/src/commands/auth.ts`, `app/api/cli/device-code/route.ts`, `app/api/cli/token/route.ts`, `app/(dashboard)/cli/authorize/page.tsx` |
| **Data Stores** | Redis (device code state, 10min TTL), PostgreSQL (`unerr.api_keys`) |

### 1.2 GitHub App Install

| | |
|---|---|
| **Architecture Doc** | [PHASE_0_DEEP_DIVE_AND_TRACKER.md](PHASE_0_DEEP_DIVE_AND_TRACKER.md), [PHASE_1_GITHUB_CONNECT_AND_INDEXING.md](PHASE_1_GITHUB_CONNECT_AND_INDEXING.md) |
| **Design Decisions** | GitHub App (not OAuth App) for per-repo permissions and installation tokens that survive user OAuth revocation. Repos NOT auto-imported — user explicitly selects via picker modal to prevent accidental mass-indexing. Installation tokens fetched on-demand (1h TTL), never stored. |
| **Data Flow** | User clicks Install → GitHub OAuth flow → callback at `/api/github/install` → `github_installations` row created → repo picker modal → user selects repos → `POST /api/cli/repos` |
| **Key Code** | `app/api/github/install/route.ts`, `app/api/cli/github/install/route.ts`, `app/api/cli/github/install/poll/route.ts`, `app/api/cli/github/repos/route.ts`, `components/dashboard/repo-picker-modal.tsx` |
| **Data Stores** | PostgreSQL (`unerr.github_installations`, `unerr.repos`), Redis (install state for CLI flow) |

### 1.3 Local CLI Upload

| | |
|---|---|
| **Architecture Doc** | [PHASE_5.5_PROMPT_LEDGER_REWIND_AND_LOCAL_INGESTION.md](PHASE_5.5_PROMPT_LEDGER_REWIND_AND_LOCAL_INGESTION.md) — "Local Repo Ingestion" section |
| **Design Decisions** | `provider: "local_cli"` repos use Supabase Storage upload instead of git clone. `prepareWorkspace` downloads via pre-signed URL. Rest of indexing pipeline is identical to GitHub repos — same SCIP, same embedding, same justification. IStorageProvider port abstracts upload/download. |
| **Data Flow** | `unerr init` → `POST /api/cli/init` → repo record created → `unerr push` → zip upload to Supabase Storage → Temporal `indexRepoWorkflow` |
| **Key Code** | `packages/cli/src/commands/init.ts`, `packages/cli/src/commands/push.ts`, `app/api/cli/init/route.ts`, `app/api/cli/repos/route.ts` |
| **Data Stores** | PostgreSQL (`unerr.repos`), Supabase Storage (`cli_uploads` bucket, 500MB limit) |

### 1.4 Ephemeral Sandbox

| | |
|---|---|
| **Architecture Doc** | [PHASE_5.6_CLI_FIRST_ONBOARDING.md](PHASE_5.6_CLI_FIRST_ONBOARDING.md) |
| **Design Decisions** | `ephemeral=true` flag + `ephemeral_expires_at` on repo record. Temporal cron workflow handles garbage collection. Avoids needing a separate ephemeral storage — same pipeline, just with a TTL. |
| **Key Code** | `packages/cli/src/commands/init.ts` (ephemeral flag), `app/api/cli/init/route.ts` |
| **Data Stores** | PostgreSQL (`unerr.repos` — ephemeral fields), Temporal (GC cron) |

### 1.5 IDE Auto-Config

| | |
|---|---|
| **Architecture Doc** | [PHASE_5.6_CLI_FIRST_ONBOARDING.md](PHASE_5.6_CLI_FIRST_ONBOARDING.md) |
| **Design Decisions** | IDE detection priority: `CURSOR_TRACE_ID` env → `CLAUDE_CODE` env → `.cursor/` dir → `.windsurf/` dir → `TERM_PROGRAM=vscode` → `.vscode/` dir → interactive prompt. Writes to native config format per IDE. |
| **Key Code** | `packages/cli/src/commands/setup.ts`, `packages/cli/src/commands/connect.ts` |
| **Data Stores** | Local filesystem only (IDE config files) |

### 1.6 Git Hook Auto-Verify

| | |
|---|---|
| **Architecture Doc** | [PHASE_5.6_CLI_FIRST_ONBOARDING.md](PHASE_5.6_CLI_FIRST_ONBOARDING.md) |
| **Design Decisions** | `post-checkout` and `post-merge` hooks — lightest touch points that cover branch switches and pulls. `--repair` flag auto-fixes drift without user interaction. |
| **Key Code** | `packages/cli/src/commands/config-verify.ts`, `packages/cli/src/commands/setup.ts` |
| **Data Stores** | Local filesystem (`.git/hooks/`) |

---

## 2. Code Intelligence (MCP Tools)

### 2.1 Semantic Code Search

| | |
|---|---|
| **Architecture Doc** | [PHASE_3_SEMANTIC_SEARCH.md](PHASE_3_SEMANTIC_SEARCH.md) |
| **Design Decisions** | **Hybrid search = pgvector + ArangoDB fulltext + RRF merge.** nomic-embed-text-v1.5 chosen for $0 cost (local CPU inference via `@xenova/transformers`), same model at index + query time. RRF formula: `Σ 1/(k + rank_i)`. Top 20 from each source, merged by `entity_key`. **Two-Step RAG**: return summaries first (~1,500 tokens), agent fetches full bodies on demand — eliminates "lost in the middle" problem. |
| **Data Flow** | Query → [parallel] pgvector cosine (top 20) + ArangoDB fulltext (top 20) → RRF merge → graph enrichment (1-hop callers/callees) → semantic truncation → response |
| **Key Code** | `lib/mcp/tools/` (search tool handler), `lib/adapters/llamaindex-vector-search.ts`, `lib/adapters/arango-graph-store.ts`, `lib/ports/vector-search.ts` |
| **Data Stores** | PostgreSQL (`unerr.entity_embeddings` — pgvector HNSW 768d), ArangoDB (fulltext indexes on entity collections) |

### 2.2 Function/Class Lookup

| | |
|---|---|
| **Architecture Doc** | [PHASE_2_HOSTED_MCP_SERVER.md](PHASE_2_HOSTED_MCP_SERVER.md) — core MCP tool design |
| **Design Decisions** | Entity resolution chain: dirty buffer (Redis, 30s TTL) → workspace overlay (Redis) → committed graph (ArangoDB). Semantic truncation at `MAX_RESPONSE_BYTES = 12,000`. Resolves by `_key`, name, or `(file_path, start_line)`. |
| **Key Code** | `lib/mcp/tools/` (get_function, get_class handlers), `lib/mcp/server.ts`, `lib/adapters/arango-graph-store.ts` |
| **Data Stores** | ArangoDB (`functions`, `classes` collections), Redis (dirty buffer + workspace overlays) |

### 2.3 Call Graph Traversal

| | |
|---|---|
| **Architecture Doc** | [PHASE_1_GITHUB_CONNECT_AND_INDEXING.md](PHASE_1_GITHUB_CONNECT_AND_INDEXING.md) — graph model, [PHASE_2_HOSTED_MCP_SERVER.md](PHASE_2_HOSTED_MCP_SERVER.md) — tool exposure |
| **Design Decisions** | AQL graph traversal on `calls` edge collection. Depth configurable 1–5 hops. Tenant isolation via `org_id` filter on every query. Edge `_from`/`_to` use `collection/key` format. |
| **Key Code** | `lib/adapters/arango-graph-store.ts` (traversal queries), `lib/mcp/tools/` (get_callers, get_callees) |
| **Data Stores** | ArangoDB (`calls` edge collection, `functions` documents) |

### 2.4 Import Chain Analysis

| | |
|---|---|
| **Architecture Doc** | [PHASE_1_GITHUB_CONNECT_AND_INDEXING.md](PHASE_1_GITHUB_CONNECT_AND_INDEXING.md) |
| **Design Decisions** | `imports` edge collection (file-to-file). Built during SCIP/Tree-sitter indexing. Depth-limited AQL traversal. |
| **Key Code** | `lib/adapters/arango-graph-store.ts`, `lib/mcp/tools/` |
| **Data Stores** | ArangoDB (`imports` edge collection, `files` documents) |

### 2.5 Project Stats

| | |
|---|---|
| **Architecture Doc** | [PHASE_2_HOSTED_MCP_SERVER.md](PHASE_2_HOSTED_MCP_SERVER.md) |
| **Design Decisions** | Aggregates counts from ArangoDB entity collections, joins with Prisma `repos` for status metadata. Lightweight — no graph traversal needed. |
| **Key Code** | `lib/mcp/tools/` (get_project_stats), `lib/adapters/arango-graph-store.ts`, `lib/adapters/prisma-relational-store.ts` |
| **Data Stores** | ArangoDB (count queries), PostgreSQL (`unerr.repos`) |

### 2.6 Business Context

| | |
|---|---|
| **Architecture Doc** | [PHASE_4_BUSINESS_JUSTIFICATION_AND_TAXONOMY.md](PHASE_4_BUSINESS_JUSTIFICATION_AND_TAXONOMY.md) |
| **Design Decisions** | **Unified Justification Model** — one document per entity with ALL fields (purpose, business_value, taxonomy, feature_area, user_flows, design_patterns, tags, confidence). **Topological processing (leaf-to-root)** — callees justified first so callers get context, improving accuracy from ~65% to ~85%. LLM routing: `gpt-4o-mini` for simple entities, `gpt-4o` for complex. Design pattern detection is heuristic (ast-grep), not LLM. |
| **Data Flow** | `embedRepoWorkflow` completes → `justifyRepoWorkflow` → topoSort → detectDesignPatterns (ast-grep) → justifyBatch per level → writeJustifications → embedJustifications |
| **Key Code** | `lib/temporal/activities/adr-generation.ts`, `lib/mcp/tools/` (get_business_context), `lib/adapters/arango-graph-store.ts` |
| **Data Stores** | ArangoDB (`justifications` collection), PostgreSQL (`unerr.justification_embeddings`) |

### 2.7 Search by Purpose

| | |
|---|---|
| **Architecture Doc** | [PHASE_4_BUSINESS_JUSTIFICATION_AND_TAXONOMY.md](PHASE_4_BUSINESS_JUSTIFICATION_AND_TAXONOMY.md), [PHASE_3_SEMANTIC_SEARCH.md](PHASE_3_SEMANTIC_SEARCH.md) |
| **Design Decisions** | Cosine similarity on `justification_embeddings` (separate from entity embeddings). Searches by business intent, not code structure. Optional taxonomy filter (VERTICAL/HORIZONTAL/UTILITY). |
| **Key Code** | `lib/mcp/tools/` (search_by_purpose), `lib/adapters/llamaindex-vector-search.ts` |
| **Data Stores** | PostgreSQL (`unerr.justification_embeddings` — pgvector HNSW 768d) |

### 2.8 Impact Analysis

| | |
|---|---|
| **Architecture Doc** | [PHASE_ADVANCED_CODE_INTELLIGENCE_DISPLAY.md](PHASE_ADVANCED_CODE_INTELLIGENCE_DISPLAY.md) — blast radius design, [PHASE_7_PR_REVIEW_INTEGRATION.md](PHASE_7_PR_REVIEW_INTEGRATION.md) — PR impact |
| **Design Decisions** | N-hop outbound traversal across ALL edge types (`calls` + `imports` + `extends` + `implements`). Transitive closure to API/UI boundary nodes. Business context enrichment from justifications. Hub nodes (≥50 callers) get special handling to prevent thundering herd. |
| **Key Code** | `lib/mcp/tools/` (analyze_impact), `lib/adapters/arango-graph-store.ts` |
| **Data Stores** | ArangoDB (multi-edge traversal), PostgreSQL (justification enrichment) |

### 2.9 Blueprint

| | |
|---|---|
| **Architecture Doc** | [PHASE_4_BUSINESS_JUSTIFICATION_AND_TAXONOMY.md](PHASE_4_BUSINESS_JUSTIFICATION_AND_TAXONOMY.md), [PHASE_POST_ONBOARDING_WOW_EXPERIENCE.md](PHASE_POST_ONBOARDING_WOW_EXPERIENCE.md) |
| **Design Decisions** | Aggregates three ArangoDB collections: `features_agg` (feature map), `health_reports` (risk summary), `adrs` (architecture decisions). Returns structured JSON with feature-to-entity mappings and taxonomy breakdown. VERTICAL swimlanes, HORIZONTAL infrastructure nodes. |
| **Key Code** | `lib/mcp/tools/` (get_blueprint), `lib/adapters/arango-graph-store.ts` |
| **Data Stores** | ArangoDB (`features_agg`, `health_reports`, `adrs`) |

### 2.10 Convention Guide

| | |
|---|---|
| **Architecture Doc** | [PHASE_6_PATTERN_ENFORCEMENT_AND_RULES_ENGINE.md](PHASE_6_PATTERN_ENFORCEMENT_AND_RULES_ENGINE.md) |
| **Design Decisions** | Merges `rules` (explicit) with `patterns` (detected). **JIT Rule Injection** — queries sub-graph surrounding target entities to select only contextually relevant rules, reducing token waste by up to 90%. Rule hierarchy: org → repo → path → branch → workspace. |
| **Key Code** | `lib/mcp/tools/` (get_conventions), `lib/adapters/arango-graph-store.ts` |
| **Data Stores** | ArangoDB (`rules`, `patterns` collections) |

### 2.11 Suggest Approach

| | |
|---|---|
| **Architecture Doc** | [PHASE_6_PATTERN_ENFORCEMENT_AND_RULES_ENGINE.md](PHASE_6_PATTERN_ENFORCEMENT_AND_RULES_ENGINE.md), [PHASE_9_CODE_SNIPPET_LIBRARY.md](PHASE_9_CODE_SNIPPET_LIBRARY.md) |
| **Design Decisions** | Combines three sources: contextual rules (sub-graph traversal), similar implementations (semantic search), and applicable patterns. Rules say "what you must do," snippets show "how we do it here." Mandatory constraints highlighted separately from suggestions. |
| **Key Code** | `lib/mcp/tools/` (suggest_approach), `lib/mcp/tools/review.ts` |
| **Data Stores** | ArangoDB (rules, patterns, snippets), PostgreSQL (embeddings) |

### 2.12 Find Similar Code

| | |
|---|---|
| **Architecture Doc** | [PHASE_3_SEMANTIC_SEARCH.md](PHASE_3_SEMANTIC_SEARCH.md) |
| **Design Decisions** | Cosine similarity between reference entity's embedding and all entity embeddings via pgvector HNSW. Same embedding model (nomic-embed-text) ensures cosine distance is meaningful. |
| **Key Code** | `lib/mcp/tools/` (find_similar), `lib/adapters/llamaindex-vector-search.ts` |
| **Data Stores** | PostgreSQL (`unerr.entity_embeddings`) |

---

## 3. Live Coding Context

### 3.1 Dirty Buffer Sync

| | |
|---|---|
| **Architecture Doc** | [PHASE_2_HOSTED_MCP_SERVER.md](PHASE_2_HOSTED_MCP_SERVER.md) — overlay design, [VERTICAL_SLICING_PLAN.md](VERTICAL_SLICING_PLAN.md) — Shadow Workspace |
| **Design Decisions** | Entity resolution chain: dirty buffer (highest priority) → workspace overlay → committed graph. Regex-extracts entity signatures from raw buffer text. 30s TTL in Redis — ephemeral by design. |
| **Key Code** | `lib/mcp/tools/dirty-buffer.ts`, `lib/adapters/redis-cache-store.ts` |
| **Data Stores** | Redis (dirty buffer overlays, 30s TTL) |

### 3.2 Local Diff Sync

| | |
|---|---|
| **Architecture Doc** | [PHASE_5.5_PROMPT_LEDGER_REWIND_AND_LOCAL_INGESTION.md](PHASE_5.5_PROMPT_LEDGER_REWIND_AND_LOCAL_INGESTION.md), [VERTICAL_SLICING_PLAN.md](VERTICAL_SLICING_PLAN.md) — Shadow Workspace |
| **Design Decisions** | **Piggybacked on ledger** — no separate `record_prompt` tool needed. Every synced change auto-creates a ledger entry. Agent cannot forget to call it. `prompt` field optional — manual edits recorded as `[manual edit]`. Bootstrap Rule (`.cursor/rules/unerr.mdc`) forces agents to call `sync_local_diff` before/after every operation. Per-user, per-repo, per-branch scope, 12h TTL with sliding window. |
| **Key Code** | `lib/mcp/tools/sync.ts`, `lib/onboarding/bootstrap-rule.ts` |
| **Data Stores** | Redis (workspace overlays), ArangoDB (`ledger` collection) |

### 3.3 File Watcher

| | |
|---|---|
| **Architecture Doc** | [PHASE_5.6_CLI_FIRST_ONBOARDING.md](PHASE_5.6_CLI_FIRST_ONBOARDING.md) |
| **Design Decisions** | Chokidar-based, respects `.gitignore`. 2s debounce default. Runs config integrity check every 60s with auto-repair. Calls `sync_local_diff` via MCP — reuses existing sync infrastructure. |
| **Key Code** | `packages/cli/src/commands/watch.ts` |
| **Data Stores** | Redis (via sync_local_diff) |

### 3.4 Local-First Mode

| | |
|---|---|
| **Architecture Doc** | [PHASE_10a_LOCAL_FIRST_INTELLIGENCE_PROXY.md](PHASE_10a_LOCAL_FIRST_INTELLIGENCE_PROXY.md), [PHASE_10b_LOCAL_FIRST_INTELLIGENCE_PROXY_FULL.md](PHASE_10b_LOCAL_FIRST_INTELLIGENCE_PROXY_FULL.md) |
| **Design Decisions** | **CozoDB (not ArangoDB) for local** — single-tenant, read-only, embeddable Datalog DB. Msgpack snapshot format (SHA-256 verified) from Supabase Storage. 7 structural tools resolve locally (<5ms), LLM/semantic tools proxy to cloud. **Transparency principle**: agent sees identical response shape. v2 snapshots include rules + patterns for local `check_rules`. Semgrep rules still cloud-only (200MB binary too large for CLI). |
| **Data Flow** | `unerr pull` → pre-signed URL from `/api/graph-snapshots/{repoId}/download` → msgpack download → `unerr serve` → CozoDB in-memory → stdio MCP server |
| **Key Code** | `packages/cli/src/commands/pull.ts`, `packages/cli/src/commands/serve.ts`, `app/api/graph-snapshots/[repoId]/download/route.ts` |
| **Data Stores** | Supabase Storage (`graph-snapshots` bucket), CozoDB (local in-memory) |

---

## 4. Prompt Ledger & Rewind

### 4.1 Prompt Timeline

| | |
|---|---|
| **Architecture Doc** | [PHASE_5.5_PROMPT_LEDGER_REWIND_AND_LOCAL_INGESTION.md](PHASE_5.5_PROMPT_LEDGER_REWIND_AND_LOCAL_INGESTION.md) |
| **Design Decisions** | Append-only `ledger` collection in ArangoDB. Composite index on `(org_id, repo_id, user_id, branch, timeline_branch, created_at)`. Status state machine: pending → working/broken → committed/reverted. **Ledger Circuit Breaker**: halts AI loops (>4 consecutive `broken` entries in 10 min). |
| **Key Code** | `lib/mcp/tools/sync.ts` (ledger append), `packages/cli/src/commands/timeline.ts`, `lib/adapters/arango-graph-store.ts` |
| **Data Stores** | ArangoDB (`ledger` collection) |

### 4.2 Mark Working

| | |
|---|---|
| **Architecture Doc** | [PHASE_5.5_PROMPT_LEDGER_REWIND_AND_LOCAL_INGESTION.md](PHASE_5.5_PROMPT_LEDGER_REWIND_AND_LOCAL_INGESTION.md) |
| **Design Decisions** | Creates a `LedgerSnapshot` in PostgreSQL (not ArangoDB) because file content blobs are large JSONB — ArangoDB is optimized for graph traversal, not blob storage. Status transition validated via `validateLedgerTransition` state machine. |
| **Key Code** | `packages/cli/src/commands/mark-working.ts`, `lib/mcp/tools/sync.ts` |
| **Data Stores** | ArangoDB (`ledger` — status update), PostgreSQL (`unerr.ledger_snapshots` — file content blobs) |

### 4.3 Rewind

| | |
|---|---|
| **Architecture Doc** | [PHASE_5.5_PROMPT_LEDGER_REWIND_AND_LOCAL_INGESTION.md](PHASE_5.5_PROMPT_LEDGER_REWIND_AND_LOCAL_INGESTION.md) |
| **Design Decisions** | **Two-phase: shadow rewind → atomic rewind.** Shadow rewind computes blast radius by diffing snapshots, classifies files as `clean_revert`, `manual_conflict`, or `stale_snapshot`. Returns warning if manual changes would be overwritten. `dryRun: true` returns report without applying. On apply: marks intermediate entries as `reverted`, increments `timeline_branch`. |
| **Key Code** | `packages/cli/src/commands/rewind.ts`, `lib/mcp/tools/sync.ts` |
| **Data Stores** | ArangoDB (`ledger`), PostgreSQL (`unerr.ledger_snapshots`) |

### 4.4 Timeline Branches

| | |
|---|---|
| **Architecture Doc** | [PHASE_5.5_PROMPT_LEDGER_REWIND_AND_LOCAL_INGESTION.md](PHASE_5.5_PROMPT_LEDGER_REWIND_AND_LOCAL_INGESTION.md) |
| **Design Decisions** | Integer counter per `(repo_id, branch)`. Conceptually like git branches but for prompt history. `idx_ledger_timeline` index enables efficient branch-scoped queries. |
| **Key Code** | `packages/cli/src/commands/branches.ts`, `packages/cli/src/commands/timeline.ts` |
| **Data Stores** | ArangoDB (`ledger` — `timeline_branch` field) |

### 4.5 AI Commit Summaries

| | |
|---|---|
| **Architecture Doc** | [PHASE_5.5_PROMPT_LEDGER_REWIND_AND_LOCAL_INGESTION.md](PHASE_5.5_PROMPT_LEDGER_REWIND_AND_LOCAL_INGESTION.md) |
| **Design Decisions** | LLM-generated narrative correlating ledger entries with git SHAs. Stored separately in `ledger_summaries` (indexed on `commit_sha`). |
| **Key Code** | `lib/adapters/arango-graph-store.ts` |
| **Data Stores** | ArangoDB (`ledger_summaries`) |

### 4.6 Merge History

| | |
|---|---|
| **Architecture Doc** | [PHASE_7_PR_REVIEW_INTEGRATION.md](PHASE_7_PR_REVIEW_INTEGRATION.md) — Ledger Trace Merging |
| **Design Decisions** | On `pull_request.closed` with `merged: true`, feature branch ledger entries reparented to target branch. Merge Node created. LLM-generated narrative summary for code archaeology. |
| **Key Code** | `app/api/webhooks/github/route.ts`, `lib/adapters/arango-graph-store.ts` |
| **Data Stores** | ArangoDB (`ledger`, `ledger_summaries`) |

---

## 5. Health & Quality Analysis

### 5.1 Health Report

| | |
|---|---|
| **Architecture Doc** | [PHASE_POST_ONBOARDING_WOW_EXPERIENCE.md](PHASE_POST_ONBOARDING_WOW_EXPERIENCE.md), [PHASE_ADVANCED_CODE_INTELLIGENCE_DISPLAY.md](PHASE_ADVANCED_CODE_INTELLIGENCE_DISPLAY.md) |
| **Design Decisions** | 13 risk types, each from a distinct graph analysis. Health grade A–F formula. Generated as a child workflow of `justifyRepoWorkflow` (7 parallel analyses). Updated on every indexing run. InsightCard component with expandable entity lists and "How to Fix" guidance. |
| **13 Risk Types** | `dead_code`, `architectural_violation`, `circular_dependency`, `high_fan_in`, `high_fan_out`, `low_confidence`, `untested_vertical`, `single_entity_feature`, `high_utility_ratio`, `low_quality_justification`, `taxonomy_anomaly`, `confidence_gap`, `missing_justification` |
| **Key Code** | `lib/temporal/activities/adr-generation.ts`, `lib/health/agent-prompt-builder.ts`, `lib/health/issue-templates.ts` |
| **Data Stores** | ArangoDB (`health_reports`) |

### 5.2 Prioritized Issues

| | |
|---|---|
| **Architecture Doc** | [PHASE_POST_ONBOARDING_WOW_EXPERIENCE.md](PHASE_POST_ONBOARDING_WOW_EXPERIENCE.md) |
| **Design Decisions** | AI-ranked by severity × impact. Each issue includes a pre-built agent prompt referencing the correct MCP tools. Categories: Dead Code, Architecture, Quality, Complexity, Taxonomy. "Create Rule" deep-linked from insight query params. |
| **Key Code** | `lib/health/issue-templates.ts`, `lib/health/agent-prompt-builder.ts`, `app/(dashboard)/repos/[repoId]/issues/page.tsx`, `app/api/repos/[repoId]/issues/route.ts`, `components/issues/issues-view.tsx` |
| **Data Stores** | ArangoDB (`health_reports` — issues extracted from insights) |

### 5.3 Dead Code Detection

| | |
|---|---|
| **Architecture Doc** | [PHASE_ADVANCED_CODE_INTELLIGENCE_DISPLAY.md](PHASE_ADVANCED_CODE_INTELLIGENCE_DISPLAY.md) |
| **Design Decisions** | Graph query: entities with zero inbound `calls` edges (fan-in = 0). Excludes entry points (exported, main, test files). |
| **Key Code** | `lib/adapters/arango-graph-store.ts` (dead code query), `lib/health/issue-templates.ts` |
| **Data Stores** | ArangoDB (`functions`, `classes`, `calls` edge collection) |

### 5.4 Architectural Drift

| | |
|---|---|
| **Architecture Doc** | [PHASE_ADVANCED_CODE_INTELLIGENCE_DISPLAY.md](PHASE_ADVANCED_CODE_INTELLIGENCE_DISPLAY.md), [PHASE_4_BUSINESS_JUSTIFICATION_AND_TAXONOMY.md](PHASE_4_BUSINESS_JUSTIFICATION_AND_TAXONOMY.md) |
| **Design Decisions** | Cosine similarity between justification embeddings across consecutive indexing runs. Threshold: similarity < 0.7 flags drift. Entities where taxonomy or feature_tag changed significantly. Cascade re-justification triggered when cosine distance > 0.3 (up to 2 hops, max 50 entities). |
| **Key Code** | `lib/adapters/arango-graph-store.ts`, `lib/temporal/activities/adr-generation.ts` |
| **Data Stores** | ArangoDB (`drift_scores`, `justifications`), PostgreSQL (`unerr.justification_embeddings`) |

### 5.5 Circular Dependency Detection

| | |
|---|---|
| **Architecture Doc** | [PHASE_ADVANCED_CODE_INTELLIGENCE_DISPLAY.md](PHASE_ADVANCED_CODE_INTELLIGENCE_DISPLAY.md) |
| **Design Decisions** | AQL depth-limited DFS cycle detection on `calls` edges. `org_id` filter for tenant isolation. |
| **Key Code** | `lib/adapters/arango-graph-store.ts` |
| **Data Stores** | ArangoDB (`calls` edge collection) |

### 5.6 High Fan-In/Fan-Out & Blast Radius

| | |
|---|---|
| **Architecture Doc** | [PHASE_ADVANCED_CODE_INTELLIGENCE_DISPLAY.md](PHASE_ADVANCED_CODE_INTELLIGENCE_DISPLAY.md), [INDEXING_PIPELINE.md](INDEXING_PIPELINE.md) — Stage 4b |
| **Design Decisions** | **Pre-computed during indexing** (Step 4b `precomputeBlastRadius`): AQL COLLECT on `calls` edges computes `fan_in`, `fan_out` per entity. Risk levels: `"high"` (≥10), `"medium"` (≥5), `"normal"`. Results stored directly on entity documents. Hub nodes (≥50 callers) exempt from cascade re-justification to prevent thundering herd. |
| **Key Code** | `lib/temporal/activities/graph-analysis.ts`, `lib/adapters/arango-graph-store.ts`, `components/code/annotated-code-viewer.tsx` (risk badge) |
| **Data Stores** | ArangoDB (`calls` edges, `fan_in`/`fan_out`/`risk_level` on entity documents) |

### 5.7 Feature Blueprint

| | |
|---|---|
| **Architecture Doc** | [PHASE_4_BUSINESS_JUSTIFICATION_AND_TAXONOMY.md](PHASE_4_BUSINESS_JUSTIFICATION_AND_TAXONOMY.md) |
| **Design Decisions** | Groups entities by `feature_tag` from justifications. VERTICAL = core feature, HORIZONTAL = shared utility, UTILITY = infrastructure. Entry points: high fan-in + exported symbols. Stored in `features_agg` for dashboard rendering. |
| **Key Code** | `lib/temporal/activities/adr-generation.ts`, `lib/adapters/arango-graph-store.ts` |
| **Data Stores** | ArangoDB (`features_agg`, `justifications`) |

### 5.8 Architecture Decision Records

| | |
|---|---|
| **Architecture Doc** | [PHASE_7_PR_REVIEW_INTEGRATION.md](PHASE_7_PR_REVIEW_INTEGRATION.md) — Auto-ADR, [PHASE_ADVANCED_CODE_INTELLIGENCE_DISPLAY.md](PHASE_ADVANCED_CODE_INTELLIGENCE_DISPLAY.md) |
| **Design Decisions** | LLM-generated from pattern analysis. Input: detected patterns with high adherence + entity graph structure. Output: structured ADR (context, decision, consequences, evidence). Auto-ADR triggered when PR introduces significant new graph topology — committed as follow-up PR. |
| **Key Code** | `lib/temporal/activities/adr-generation.ts`, `lib/review/adr-schema.ts`, `lib/review/comment-builder.ts` |
| **Data Stores** | ArangoDB (`adrs`) |

### 5.9 Domain Glossary

| | |
|---|---|
| **Architecture Doc** | [PHASE_POST_ONBOARDING_WOW_EXPERIENCE.md](PHASE_POST_ONBOARDING_WOW_EXPERIENCE.md) |
| **Design Decisions** | NLP extraction from entity names and docstrings. Frequency-weighted, deduplicated by stemming. |
| **Key Code** | `lib/adapters/arango-graph-store.ts` |
| **Data Stores** | ArangoDB (`domain_ontologies`) |

---

## 6. Rules & Pattern Enforcement

### 6.1 Auto-Detected Patterns

| | |
|---|---|
| **Architecture Doc** | [PHASE_6_PATTERN_ENFORCEMENT_AND_RULES_ENGINE.md](PHASE_6_PATTERN_ENFORCEMENT_AND_RULES_ENGINE.md) |
| **Design Decisions** | **LLM involved once (synthesis), never at enforcement.** ast-grep detects patterns during indexing. Only patterns with adherence ≥ 0.8 get Semgrep rules. **Subgraph Pattern Mining**: Louvain community detection finds implicit topological conventions. Types: structural, naming, error_handling, import, testing. |
| **Detection Pipeline** | `indexRepoWorkflow` completes → `detectPatternsWorkflow` → astGrepScan (heavy) → llmSynthesizeRules (light, adherence ≥ 0.8 only) → storePatterns (light) |
| **Key Code** | `lib/temporal/activities/indexing-heavy.ts`, `lib/adapters/arango-graph-store.ts` |
| **Data Stores** | ArangoDB (`patterns`, `mined_patterns`) |

### 6.2 Custom Rules

| | |
|---|---|
| **Architecture Doc** | [PHASE_6_PATTERN_ENFORCEMENT_AND_RULES_ENGINE.md](PHASE_6_PATTERN_ENFORCEMENT_AND_RULES_ENGINE.md) |
| **Design Decisions** | Fields: `pattern` (ast-grep YAML), `semgrep_rule` (Semgrep YAML), `enforcement` (suggest/warn/block), `scope`, `type`, `priority`. **Hybrid Rule Evaluation (two-pass)**: Pass 1 = Semgrep structural match, Pass 2 = Phase 4 feature_area/business_value enrichment to reduce false positives. **Polyglot Semantic Mapping**: one rule, many languages via `LanguageImplementation` edges. |
| **Key Code** | `lib/adapters/arango-graph-store.ts` |
| **Data Stores** | ArangoDB (`rules` collection, indexed on `(org_id, repo_id, status, priority)`) |

### 6.3 Org-Wide Rules

| | |
|---|---|
| **Architecture Doc** | [PHASE_6_PATTERN_ENFORCEMENT_AND_RULES_ENGINE.md](PHASE_6_PATTERN_ENFORCEMENT_AND_RULES_ENGINE.md) |
| **Design Decisions** | `scope: "org"` rules apply to all repos. Rule resolution merges org + repo level, repo-level overrides on conflicts. Time-bound Rule Exceptions available (TTL-limited exemptions). |
| **Key Code** | `lib/adapters/arango-graph-store.ts` |
| **Data Stores** | ArangoDB (`rules`) |

### 6.4 Rule Drafting

| | |
|---|---|
| **Architecture Doc** | [PHASE_6_PATTERN_ENFORCEMENT_AND_RULES_ENGINE.md](PHASE_6_PATTERN_ENFORCEMENT_AND_RULES_ENGINE.md) |
| **Design Decisions** | Natural language → LLM with few-shot examples → ast-grep + Semgrep YAML. Returns structured rule with test cases and suggested enforcement. |
| **Key Code** | `lib/mcp/tools/` (draft_architecture_rule) |
| **Data Stores** | ArangoDB (`rules` — on save) |

### 6.5 Pattern-to-Rule Promotion

| | |
|---|---|
| **Architecture Doc** | [PHASE_6_PATTERN_ENFORCEMENT_AND_RULES_ENGINE.md](PHASE_6_PATTERN_ENFORCEMENT_AND_RULES_ENGINE.md) |
| **Design Decisions** | Converts `patterns` doc → `rules` doc. Preserves ast-grep pattern, sets initial enforcement to `suggest`. Patterns with adherence ≥ 0.9 auto-promoted. User-pinned patterns promoted explicitly. Blast Radius Simulation available before enforcement. |
| **Key Code** | `lib/adapters/arango-graph-store.ts` |
| **Data Stores** | ArangoDB (`patterns` → `rules`) |

### 6.6 Rule Check

| | |
|---|---|
| **Architecture Doc** | [PHASE_6_PATTERN_ENFORCEMENT_AND_RULES_ENGINE.md](PHASE_6_PATTERN_ENFORCEMENT_AND_RULES_ENGINE.md), [PHASE_10b_LOCAL_FIRST_INTELLIGENCE_PROXY_FULL.md](PHASE_10b_LOCAL_FIRST_INTELLIGENCE_PROXY_FULL.md) — local rule checking |
| **Design Decisions** | Runs Semgrep against active rule YAML configs. Returns violations with auto-fix suggestions. **Auto-Remediation**: ast-grep `fix:` YAML directives generate exact structural diffs. In local-first mode, `structural` and `naming` rules resolve locally (CozoDB + regex); `semgrep` and `llm` rules fall through to cloud. |
| **Key Code** | `lib/mcp/tools/` (check_rules), `packages/cli/src/commands/serve.ts` (local) |
| **Data Stores** | ArangoDB (`rules`), CozoDB (local structural rules) |

### 6.7 Anti-Pattern Detection

| | |
|---|---|
| **Architecture Doc** | [PHASE_6_PATTERN_ENFORCEMENT_AND_RULES_ENGINE.md](PHASE_6_PATTERN_ENFORCEMENT_AND_RULES_ENGINE.md), [PHASE_ADVANCED_CODE_INTELLIGENCE_DISPLAY.md](PHASE_ADVANCED_CODE_INTELLIGENCE_DISPLAY.md) |
| **Design Decisions** | 23 pre-packaged ast-grep + Semgrep rules. Categories: TypeScript patterns (`no-any`, `async-no-floating`, `error-catch-unknown`), anti-patterns (`n-plus-one-prisma`, `error-swallowing-*`, `connection-pool-*`), scale patterns (`destructive-column-drop`, `flaky-date-now`). Zero LLM cost at enforcement time. |
| **Key Code** | `.cursor/patterns/` (ast-grep YAML rules), `lib/temporal/activities/indexing-heavy.ts` |
| **Data Stores** | ArangoDB (`rules`, `rule_health`) |

---

## 7. PR Review Integration

### 7.1 Automated PR Review

| | |
|---|---|
| **Architecture Doc** | [PHASE_7_PR_REVIEW_INTEGRATION.md](PHASE_7_PR_REVIEW_INTEGRATION.md) |
| **Design Decisions** | Triggered by `pull_request` webhook (`opened`/`synchronize`/`reopened`). **Only changed lines reviewed** — prevents noise from old debt. Review hierarchy: `error` → REQUEST_CHANGES, `warn` → COMMENT, `info` → APPROVE. Each PR push creates a NEW `PrReview` record (not update). Semgrep runs on temp dir with only changed files. **Semantic LGTM**: auto-approve if diff only touches HORIZONTAL/UTILITY entities. **Nudge & Assist**: 48h `workflow.sleep()` re-comments on stalled PRs. |
| **Pipeline** | GitHub webhook → `reviewPrWorkflow` (Temporal) → fetchDiff (light) → runSemgrep (heavy) → analyzeImpact (light, ArangoDB 1-hop) → postReview (light, GitHub API) |
| **Key Code** | `app/api/webhooks/github/route.ts`, `lib/temporal/activities/review.ts`, `lib/review/comment-builder.ts`, `lib/review/adr-schema.ts` |
| **Data Stores** | PostgreSQL (`unerr.pr_reviews`, `unerr.pr_review_comments`), ArangoDB (graph traversal for impact), Temporal (workflow orchestration) |

### 7.2 Review Dashboard

| | |
|---|---|
| **Architecture Doc** | [PHASE_7_PR_REVIEW_INTEGRATION.md](PHASE_7_PR_REVIEW_INTEGRATION.md) |
| **Key Code** | `app/(dashboard)/repos/[repoId]/page.tsx`, `app/api/repos/[repoId]/events/route.ts` |
| **Data Stores** | PostgreSQL (`unerr.pr_reviews` with `checks_passed/warned/failed` counters, joined with `pr_review_comments`) |

### 7.3 Inline Comments

| | |
|---|---|
| **Architecture Doc** | [PHASE_7_PR_REVIEW_INTEGRATION.md](PHASE_7_PR_REVIEW_INTEGRATION.md) |
| **Design Decisions** | GitHub Pull Request Review Comments API. Each comment maps to `pr_review_comments` row with `file_path`, `line_number`, `check_type`, `severity`, `message`, `suggestion`, `auto_fix`. `BLOCKER` violations include `suggestion` blocks — one-click apply via GitHub's suggestion feature. |
| **Key Code** | `lib/review/comment-builder.ts`, `lib/temporal/activities/review.ts` |
| **Data Stores** | PostgreSQL (`unerr.pr_review_comments`) |

### 7.4 Review Config

| | |
|---|---|
| **Architecture Doc** | [PHASE_7_PR_REVIEW_INTEGRATION.md](PHASE_7_PR_REVIEW_INTEGRATION.md) |
| **Design Decisions** | `review_config` JSONB on `unerr.repos`. Fields: `target_branches`, `auto_approve_threshold`, `notification_channel`, `enabled`. Per-repo configuration. |
| **Key Code** | `lib/adapters/prisma-relational-store.ts` |
| **Data Stores** | PostgreSQL (`unerr.repos` — `review_config` JSONB column) |

### 7.5 "Debate the Bot"

| | |
|---|---|
| **Architecture Doc** | [PHASE_7_PR_REVIEW_INTEGRATION.md](PHASE_7_PR_REVIEW_INTEGRATION.md) |
| **Design Decisions** | `review_pr_status` MCP tool fetches review by PR number. Agent can discuss individual comments. Enables contest/accept flow from IDE without leaving the conversation. |
| **Key Code** | `lib/mcp/tools/review.ts` |
| **Data Stores** | PostgreSQL (`unerr.pr_reviews`, `unerr.pr_review_comments`) |

---

## 8. Code Snippet Library

### 8.1–8.4 Snippets (Team, Community, Auto-Extracted, Semantic Search)

| | |
|---|---|
| **Architecture Doc** | [PHASE_9_CODE_SNIPPET_LIBRARY.md](PHASE_9_CODE_SNIPPET_LIBRARY.md) |
| **Design Decisions** | **Priority ordering: team → auto_extracted → community → semantic similarity.** Rules and snippets are complementary: rules = "what you must do", snippets = "how we do it here." Snippet embedding in `rule_embeddings` (shared embedding space). Team pinning requires Teams/Enterprise plan. Auto-extraction heuristic: high fan-in + clean naming + docstring + low complexity. Community snippets are `org_id: "global"`, read-only. Snippets are NOT enforced — injected as examples only. |
| **Key Code** | `lib/mcp/tools/` (get_conventions, suggest_approach), `lib/adapters/arango-graph-store.ts` |
| **Data Stores** | ArangoDB (`snippets`, `mined_patterns`), PostgreSQL (`unerr.rule_embeddings`) |

---

## 9. Dashboard & Visualization

### 9.1 Annotated Code Viewer

| | |
|---|---|
| **Architecture Doc** | [PHASE_POST_ONBOARDING_WOW_EXPERIENCE.md](PHASE_POST_ONBOARDING_WOW_EXPERIENCE.md) — Phase 2.5, [PHASE_ADVANCED_CODE_INTELLIGENCE_DISPLAY.md](PHASE_ADVANCED_CODE_INTELLIGENCE_DISPLAY.md) — blast radius visualization |
| **Design Decisions** | **Business purpose leads before code** — designed for both developers and non-developers. Entity cards show taxonomy (human-readable: "Core Business"/"Shared Logic"/"Helper"), confidence with word labels, business purpose as hero text, then code signature. File tree uses IDE-like sorting (folders first, alphabetical). `?enrich=true` API parameter batch-fetches justifications per file. Progressive disclosure: reasoning and semantic triples hidden behind expandable section. |
| **Key Code** | `components/code/annotated-code-viewer.tsx`, `app/(dashboard)/repos/[repoId]/code/page.tsx`, `app/api/repos/[repoId]/entities/route.ts` (enrich param), `lib/utils/file-tree-builder.ts` (sortTree) |
| **Data Stores** | ArangoDB (entity collections + `justifications` collection) |

### 9.2 Pipeline Monitor & Unified Activity Tab

| | |
|---|---|
| **Architecture Doc** | [PHASE_1_GITHUB_CONNECT_AND_INDEXING.md](PHASE_1_GITHUB_CONNECT_AND_INDEXING.md) — progress tracking via Temporal query, [PHASE_POST_ONBOARDING_WOW_EXPERIENCE.md](PHASE_POST_ONBOARDING_WOW_EXPERIENCE.md) — Phase 2.6 |
| **Design Decisions** | **5 tabs consolidated into 1 "Activity" tab** (removed Timeline, Commits, History, Pipeline — all overlapped). Activity page has section switcher: Pipeline Runs / Index Events / Logs. Pipeline runs table with clickable run IDs that open detail page in new tab (`/repos/{repoId}/activity/{runId}`). Run detail page shows status, meta grid, per-step visualization, result metrics, and run-specific logs. SSE endpoint streams Temporal workflow status. **Run ID tracking**: Every pipeline execution gets a UUID (`PipelineRun` record in PostgreSQL). Per-step status tracked via `PipelineRun.steps` JSON column. Run-bound Redis log keys: `unerr:pipeline-logs:{repoId}:{runId}`. |
| **Key Code** | `app/(dashboard)/repos/[repoId]/activity/page.tsx`, `app/(dashboard)/repos/[repoId]/activity/[runId]/page.tsx`, `components/repo/pipeline-history-table.tsx`, `components/repo/pipeline-log-viewer.tsx`, `app/api/repos/[repoId]/events/route.ts`, `app/api/repos/[repoId]/logs/route.ts`, `app/api/repos/[repoId]/runs/route.ts`, `app/api/repos/[repoId]/runs/[runId]/route.ts`, `lib/temporal/activities/pipeline-logs.ts`, `lib/temporal/activities/pipeline-run.ts` |
| **Data Stores** | Temporal (workflow state + queries), PostgreSQL (`unerr.repos` — status, `unerr.pipeline_runs` — run history + per-step tracking), Redis (pipeline logs) |

### 9.3 Activity Feed

| | |
|---|---|
| **Architecture Doc** | [PHASE_5_INCREMENTAL_INDEXING_AND_GITHUB_WEBHOOKS.md](PHASE_5_INCREMENTAL_INDEXING_AND_GITHUB_WEBHOOKS.md) |
| **Design Decisions** | `index_events` ArangoDB collection with 90-day TTL. Each event records: `event_type`, `files_changed`, `entities_added/updated/deleted`, `duration_ms`. Events now include optional `run_id` field for cross-referencing with PostgreSQL `pipeline_runs` records. Displayed as "Index Events" section within the unified Activity tab. |
| **Key Code** | `lib/adapters/arango-graph-store.ts`, `components/activity/activity-feed.tsx` |
| **Data Stores** | ArangoDB (`index_events` — TTL 90 days) |

### 9.4 Global Code Search

| | |
|---|---|
| **Architecture Doc** | [PHASE_3_SEMANTIC_SEARCH.md](PHASE_3_SEMANTIC_SEARCH.md) |
| **Design Decisions** | Same hybrid search as MCP tool but with `org_id` filter only (no `repo_id` constraint). Results grouped by repo. |
| **Key Code** | `lib/adapters/llamaindex-vector-search.ts` |
| **Data Stores** | PostgreSQL (`unerr.entity_embeddings`), ArangoDB (fulltext indexes) |

### 9.5 Entity Browser & Overview Tab

| | |
|---|---|
| **Architecture Doc** | [PHASE_POST_ONBOARDING_WOW_EXPERIENCE.md](PHASE_POST_ONBOARDING_WOW_EXPERIENCE.md) |
| **Design Decisions** | "Issues" tab renamed to **"Overview"** (Home icon) — serves as the primary repo landing page. Shows hero stats (health grade, entities, features, insights), top insights, domain intelligence + language distribution side-by-side, quick navigation links, and Issues as a subsection. Code explorer moved to dedicated Code tab with annotated viewer. |
| **Key Code** | `app/(dashboard)/repos/[repoId]/page.tsx`, `app/api/repos/[repoId]/overview/route.ts`, `components/repo/repo-tabs.tsx`, `lib/adapters/arango-graph-store.ts` |
| **Data Stores** | ArangoDB (entity collections + `justifications` + `health_reports` + `domain_ontology`) |

### 9.6 Context Seeding

| | |
|---|---|
| **Architecture Doc** | [INDEXING_PIPELINE.md](INDEXING_PIPELINE.md) — TBI-H-01 |
| **Design Decisions** | Simple approach: raw text stored as `contextDocuments` on repo record (PostgreSQL, max 10k chars) rather than structured `ContextManifest` in ArangoDB. Injected into both ontology and justification LLM prompts to anchor vocabulary. Truncated to 3,000 chars in prompt. UI available during pending/indexing/embedding states. |
| **Data Flow** | User pastes text in onboarding console → `PUT /api/repos/{repoId}/context` → stored in `unerr.repos.context_documents` → fetched by ontology + justification activities → injected into LLM prompts |
| **Key Code** | `app/api/repos/[repoId]/context/route.ts`, `lib/temporal/activities/ontology.ts`, `lib/temporal/activities/justification.ts`, `lib/justification/prompt-builder.ts`, `components/repo/repo-onboarding-console.tsx` |
| **Data Stores** | PostgreSQL (`unerr.repos.context_documents`) |

### 9.7 UNERR_CONTEXT.md Export

| | |
|---|---|
| **Architecture Doc** | [INDEXING_PIPELINE.md](INDEXING_PIPELINE.md) — TBI-H-04 |
| **Design Decisions** | Generated on-demand (not stored) via `generateContextDocument()`. Compiles project stats, health report, features, ADRs, ontology, domain glossary, and ubiquitous language into structured markdown. Download via `GET /api/repos/{repoId}/export/context` with `Content-Disposition: attachment`. Available from overview page and celebration modal. |
| **Key Code** | `lib/justification/context-document-generator.ts`, `app/api/repos/[repoId]/export/context/route.ts`, `app/(dashboard)/repos/[repoId]/page.tsx`, `components/repo/repo-onboarding-console.tsx` |
| **Data Stores** | ArangoDB (reads `features_agg`, `health_reports`, `adrs`, `domain_ontologies`) |

### 9.8 Human-in-the-Loop Corrections

| | |
|---|---|
| **Architecture Doc** | [INDEXING_PIPELINE.md](INDEXING_PIPELINE.md) — TBI-H-02 |
| **Design Decisions** | Inline correction editor in annotated code viewer (not a separate modal). Override sets `confidence: 1.0`, `model_used: "human_override"`, `model_tier: "heuristic"`. Uses existing `bulkUpsertJustifications` for persistence. Confidence heatmap: emerald ≥80%, amber ≥50%, red <50% with glow rings on blueprint feature cards. |
| **Data Flow** | User clicks edit icon → fills taxonomy/feature_tag/purpose → `POST /api/repos/{repoId}/entities/{entityId}/override` → `bulkUpsertJustifications()` in ArangoDB |
| **Key Code** | `app/api/repos/[repoId]/entities/[entityId]/override/route.ts`, `components/code/annotated-code-viewer.tsx`, `components/blueprint/blueprint-view.tsx` |
| **Data Stores** | ArangoDB (`justifications`) |

---

## 10. Team & Organization

### 10.1 Organization Management

| | |
|---|---|
| **Architecture Doc** | [PHASE_0_DEEP_DIVE_AND_TRACKER.md](PHASE_0_DEEP_DIVE_AND_TRACKER.md) |
| **Design Decisions** | **Auto-org provisioning** via Better Auth `databaseHooks.user.create.after` — inserts `organization` + `member` using `generateId()`. Every user gets `"{name}'s organization"`. ArangoDB bootstrap decoupled from signup (triggered on first repo connect, not at signup — prevents failures from ArangoDB downtime). **Unerr org ≠ GitHub org** — independent entities. |
| **Key Code** | `lib/auth/auth.ts`, `lib/auth/better-auth.cli.ts`, `app/(dashboard)/settings/page.tsx` |
| **Data Stores** | PostgreSQL (`public.organization`, `public.member`) |

### 10.2 GitHub Connections

| | |
|---|---|
| **Architecture Doc** | [PHASE_1_GITHUB_CONNECT_AND_INDEXING.md](PHASE_1_GITHUB_CONNECT_AND_INDEXING.md) |
| **Design Decisions** | One-to-many: one unerr org can have N GitHub installations. Stores `installation_id`, `account_login`, `account_type`, `permissions` (JSONB). Token refresh on demand. |
| **Key Code** | `lib/adapters/prisma-relational-store.ts`, `app/api/github/install/route.ts` |
| **Data Stores** | PostgreSQL (`unerr.github_installations`) |

### 10.3 API Key Management

| | |
|---|---|
| **Architecture Doc** | [PHASE_2_HOSTED_MCP_SERVER.md](PHASE_2_HOSTED_MCP_SERVER.md) — dual auth design, [PHASE_5.6_CLI_FIRST_ONBOARDING.md](PHASE_5.6_CLI_FIRST_ONBOARDING.md) — org-level keys |
| **Design Decisions** | SHA-256 hash stored in DB, raw key shown once. `unerr_sk_` prefix enables GitHub secret scanning auto-revocation. Scopes: `mcp:read`, `mcp:sync`. `is_default` flag for auto-provisioned keys. Soft-delete via `revoked_at`. |
| **Key Code** | `app/(dashboard)/settings/page.tsx`, `lib/mcp/auth.ts` |
| **Data Stores** | PostgreSQL (`unerr.api_keys`) |

### 10.4 Team Members

| | |
|---|---|
| **Architecture Doc** | [PHASE_0_DEEP_DIVE_AND_TRACKER.md](PHASE_0_DEEP_DIVE_AND_TRACKER.md) |
| **Key Code** | `lib/auth/auth.ts` (Better Auth organization plugin) |
| **Data Stores** | PostgreSQL (`public.member`, `public.invitation`) |

### 10.5 Audit Trail

| | |
|---|---|
| **Architecture Doc** | [PHASE_0_DEEP_DIVE_AND_TRACKER.md](PHASE_0_DEEP_DIVE_AND_TRACKER.md) |
| **Key Code** | `lib/adapters/prisma-relational-store.ts` |
| **Data Stores** | PostgreSQL (`public.audit_logs`) |

---

## 11. Billing & Usage

### 11.1–11.5 Billing (Usage-Based, Plans, Credits, Pooling, Budget Enforcement)

| | |
|---|---|
| **Architecture Doc** | [PHASE_8_USAGE_BASED_BILLING_AND_LIMITS.md](PHASE_8_USAGE_BASED_BILLING_AND_LIMITS.md) |
| **Design Decisions** | **Langfuse as billing source of truth** — auto-tracks every AI SDK call. Budget check is a pre-flight, not a meter. **Lazy Free plan** provisioned on first dashboard/MCP load. **Structural queries are free** — only LLM operations count. On-demand credit = one-time Stripe payment intent (not subscription). Team cost pool = `perSeatBudget × seats`. Nightly Temporal cron (`syncBillingWorkflow`) syncs Langfuse Daily Metrics API. **Phase 8 is the GA gate.** |
| **Key Code** | `lib/adapters/prisma-relational-store.ts` |
| **Data Stores** | PostgreSQL (`public.subscriptions`, `public.costs`, `public.usage`), Temporal (billing sync cron) |

---

## 12. Planned Features

### 12.1 VS Code Extension

| | |
|---|---|
| **Architecture Doc** | [PHASE_11_NATIVE_IDE_INTEGRATIONS.md](PHASE_11_NATIVE_IDE_INTEGRATIONS.md) |
| **Design Decisions** | `@unerr/ui` shared React component library (no Next.js deps). `_meta.renderHint` in MCP responses dispatches to panels. Credential sharing with CLI via `~/.unerr/credentials.json`. Force-directed graph (d3-force or Cytoscape). Click-to-navigate via `vscode.workspace.openTextDocument`. |

### 12.2 JetBrains Plugin

| | |
|---|---|
| **Architecture Doc** | [PHASE_11_NATIVE_IDE_INTEGRATIONS.md](PHASE_11_NATIVE_IDE_INTEGRATIONS.md) |
| **Design Decisions** | JCEF-based panels rendering the same `@unerr/ui` React components. Kotlin/JVM implementation. Same API endpoints as VS Code extension. |

### 12.3 Collision Detection

| | |
|---|---|
| **Architecture Doc** | [PHASE_12_MULTIPLAYER_COLLABORATION_AND_COLLISION_DETECTION.md](PHASE_12_MULTIPLAYER_COLLABORATION_AND_COLLISION_DETECTION.md) |
| **Design Decisions** | **Entity-level granularity (not line-level).** Collisions are warnings, never locks. `_meta.collision` appended to MCP responses. **Three-tier durability**: Redis heartbeat (60s TTL) → ArangoDB `entity_activity` (30min TTL) → PostgreSQL `notifications` (permanent). Redis pub/sub broadcast: `unerr:collab:{orgId}:{repoId}`. Activity recorder budget: <15ms. |

### 12.4 Active Sessions

| | |
|---|---|
| **Architecture Doc** | [PHASE_12_MULTIPLAYER_COLLABORATION_AND_COLLISION_DETECTION.md](PHASE_12_MULTIPLAYER_COLLABORATION_AND_COLLISION_DETECTION.md) |
| **Design Decisions** | Redis hash per repo with 5min inactivity expiry. Populated by MCP tool call side-effects. SSE stream at `/api/repos/:repoId/presence`. |

### 12.5–12.8 Advanced Planned (Multi-Repo Contracts, PII, Trust Boundaries, Cognitive Debt)

| | |
|---|---|
| **Architecture Doc** | [PHASE_ADVANCED_CODE_INTELLIGENCE_DISPLAY.md](PHASE_ADVANCED_CODE_INTELLIGENCE_DISPLAY.md), [PHASE_12_MULTIPLAYER_COLLABORATION_AND_COLLISION_DETECTION.md](PHASE_12_MULTIPLAYER_COLLABORATION_AND_COLLISION_DETECTION.md) |
| **Design Decisions** | Multi-repo: cross-repo edge collection in ArangoDB. PII/Trust Boundary: taint analysis on call graph (Source → Sink validation). Cognitive Debt: rewind-to-commit ratio from ledger status transitions. |

---

## Cross-Cutting Architecture

These design decisions affect multiple features:

### Hexagonal Architecture (Ports & Adapters)

| | |
|---|---|
| **Architecture Doc** | [VERTICAL_SLICING_PLAN.md](VERTICAL_SLICING_PLAN.md) |
| **Affects** | Every feature — all external dependencies behind 11 port interfaces |
| **Key Code** | `lib/ports/` (11 interfaces), `lib/di/container.ts` (DI wiring), `lib/di/fakes.ts` (11 in-memory test fakes) |
| **Why** | Adapters swappable without touching business logic. Test container with fakes enables 909 tests without external services. |

### Lazy Initialization

| | |
|---|---|
| **Architecture Doc** | [PHASE_0_DEEP_DIVE_AND_TRACKER.md](PHASE_0_DEEP_DIVE_AND_TRACKER.md) |
| **Affects** | Build reliability — Next.js build never connects to external services |
| **Key Code** | `lib/di/container.ts` (`require()` inside getters), `lib/db/prisma.ts`, `lib/db/supabase.ts`, `lib/adapters/redis-cache-store.ts` |
| **Pattern** | `let instance = null; function get() { if (!instance) instance = new Client(); return instance; }` + Proxy wrapper |

### Tenant Isolation

| | |
|---|---|
| **Architecture Doc** | [VERTICAL_SLICING_PLAN.md](VERTICAL_SLICING_PLAN.md), [ARANGODB_SCHEMA.md](ARANGODB_SCHEMA.md) |
| **Affects** | Every data query — cross-tenant leakage architecturally impossible |
| **Pattern** | Every ArangoDB collection has persistent index on `["org_id", "repo_id"]`. All AQL queries filter by `org_id`. pgvector queries include `org_id + repo_id` WHERE clause. |

### Semantic Truncation

| | |
|---|---|
| **Architecture Doc** | [PHASE_2_HOSTED_MCP_SERVER.md](PHASE_2_HOSTED_MCP_SERVER.md) |
| **Affects** | Every MCP tool response |
| **Pattern** | `MAX_RESPONSE_BYTES = 12,000` (~3,000 tokens). Summaries returned first, full bodies on demand. Prevents agent context overflow. |

### Two Worker Queues

| | |
|---|---|
| **Architecture Doc** | [VERTICAL_SLICING_PLAN.md](VERTICAL_SLICING_PLAN.md), [PHASE_1_GITHUB_CONNECT_AND_INDEXING.md](PHASE_1_GITHUB_CONNECT_AND_INDEXING.md) |
| **Affects** | All Temporal workflows |
| **Design** | `heavy-compute-queue` (4 vCPU/8GB, max 2 concurrent — SCIP, git clone, Semgrep) and `light-llm-queue` (0.5 vCPU/512MB, max 20 concurrent — LLM, ArangoDB writes, webhooks). Segregates CPU-bound from network-bound. |

### Bootstrap Rule / Shadow Workspace

| | |
|---|---|
| **Architecture Doc** | [VERTICAL_SLICING_PLAN.md](VERTICAL_SLICING_PLAN.md), [PHASE_5.5_PROMPT_LEDGER_REWIND_AND_LOCAL_INGESTION.md](PHASE_5.5_PROMPT_LEDGER_REWIND_AND_LOCAL_INGESTION.md) |
| **Affects** | Live coding context, prompt ledger, MCP tool accuracy |
| **Key Code** | `lib/onboarding/bootstrap-rule.ts` |
| **Design** | `.cursor/rules/unerr.mdc` forces agents to call `sync_local_diff` before/after every operation. Per-user, per-repo, per-branch scope. 12h TTL with sliding window. |

### Performance Rewrite (Rust Sidecar)

| | |
|---|---|
| **Architecture Doc** | [PHASE_INFINITY_HEAVY_WORKER_PERFORMANCE_REWRITE.md](PHASE_INFINITY_HEAVY_WORKER_PERFORMANCE_REWRITE.md) |
| **Affects** | Indexing performance (SCIP, git clone, Tree-sitter) |
| **Design** | Binary Sidecar Pattern: Rust binaries called via `execFileAsync` from TypeScript Temporal activities. Feature flag rollout (`USE_RUST_{ACTIVITY}`). Entity hash must be byte-identical (SHA-256 of `repoId\0filePath\0kind\0name\0signature`). Target: SCIP memory 3.5GB → 200MB. |
