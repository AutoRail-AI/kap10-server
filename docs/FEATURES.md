# Unerr Feature Guide

## Audience Segments

| Segment | Profile |
|---|---|
| **Solo Dev** | Individual developer, personal projects, learning |
| **Vibe Coder** | AI-first developer, heavy Cursor/Claude Code user, ships fast |
| **Indie Hacker** | Solo or duo shipping a SaaS, speed over process |
| **Small Startup** | 2-10 engineers, moving fast, light process |
| **Growth Startup** | 10-50 engineers, scaling codebase, need guardrails |
| **Mid Org** | 50-200 engineers, multiple teams, governance matters |
| **Large Org** | 200+ engineers, compliance, audit trails, multi-repo |

Fit ratings: **Best** = high-value daily use, **Good** = solid value, **Okay** = usable but not primary audience, **--** = minimal value.

---

> Complete feature inventory with dual descriptions (plain language + technical) and audience fit matrix.

---

## Part 1: Feature Descriptions

Each feature has two descriptions:
- **Simple** — for anyone: founders, PMs, non-technical stakeholders
- **Technical** — for developers: includes jargon, protocols, and implementation details

### 1. Onboarding & Setup

| # | Feature | Simple | Technical | Status |
|---|---|---|---|---|
| 1.1 | **One-Command Setup** | Run `unerr` once in your project folder. It logs you in, detects your IDE, connects your repo, triggers indexing, and configures your AI agent — zero manual steps. | Single CLI entry point orchestrates device OAuth flow, IDE detection (Cursor/VS Code/Windsurf/Claude Code), git remote introspection, GitHub App installation or local tar upload, Temporal workflow dispatch for indexing, and MCP config file injection into IDE settings. | Shipped |
| 1.2 | **GitHub App Install** | Authorize the Unerr GitHub App to access your repositories. Select which repos to connect — Unerr only reads code, never writes to your repo. | OAuth-based GitHub App installation flow. Stores `installation_id` per org, fetches installation tokens on demand via `@octokit/auth-app`. Read-only permissions (contents, metadata). Webhook events (push, PR) delivered to `/api/webhooks/github`. | Shipped |
| 1.3 | **Local CLI Upload** | For repos not on GitHub (local projects, GitLab, Bitbucket): `unerr init` registers the project, `unerr push` zips and uploads the code. Works with any git repo or plain folder. | `unerr init` registers repo via `POST /api/cli/init`, writes `.unerr/config.json`. `unerr push` creates a `.gitignore`-respecting zip, requests a pre-signed S3/Supabase Storage URL, uploads via PUT, then triggers the indexing Temporal workflow. | Shipped |
| 1.4 | **Ephemeral Sandbox** | Run `unerr --ephemeral` to create a throwaway repo that auto-deletes after 4 hours. Try Unerr on any project with no commitment or cleanup. | Creates a repo record with `ephemeral=true` and `ephemeral_expires_at = NOW() + 4h`. A Temporal cron workflow garbage-collects expired ephemeral repos (deletes graph entities, embeddings, and storage blobs). | Shipped |
| 1.5 | **IDE Auto-Config** | After connecting, Unerr detects your IDE and writes the MCP config file automatically. Your AI agent immediately gains access to your codebase knowledge. | Detects IDE from project markers (`.cursor/`, `.vscode/`, `.windsurf/`). Writes `mcpServers.unerr` entry with streamable-http transport URL + API key into `mcp.json` (Cursor), `settings.json` (VS Code), or prints `claude mcp add` for Claude Code. | Shipped |
| 1.6 | **Git Hook Auto-Verify** | Installs lightweight git hooks that re-check your IDE config whenever you switch branches or pull. Prevents "my agent lost context" after branch changes. | Installs `post-checkout` and `post-merge` git hooks that run `unerr config verify --silent`. Hooks verify MCP server URL, API key presence, and transport config. `--repair` flag auto-fixes drift. | Shipped |

### 2. Code Intelligence (AI Agent Tools via MCP)

Your AI coding agent gets these tools automatically. You don't call them directly — the agent uses them behind the scenes.

| # | Feature | Simple | Technical | Status |
|---|---|---|---|---|
| 2.1 | **Semantic Code Search** | Agent searches your entire codebase using natural language. Ask "find the payment retry logic" and it finds the right function even if "retry" isn't in the name. | Hybrid search using Reciprocal Rank Fusion (RRF) across pgvector cosine similarity (nomic-embed-text 768d HNSW index) and ArangoDB fulltext/persistent indexes. Three modes: hybrid, semantic-only, keyword-only. Dirty-buffer and workspace overlay aware. | Shipped |
| 2.2 | **Function/Class Lookup** | Agent fetches the full source code, signature, who calls it, and what it calls — by name or file and line number. No more pasting code into chat. | `get_function` / `get_class` MCP tools. Resolves entity from ArangoDB by `_key`, name, or `(file_path, start_line)`. Returns signature, body, callers/callees via `calls` edge traversal. Applies dirty-buffer overlay (Redis, 30s TTL) then workspace overlay before returning. | Shipped |
| 2.3 | **Call Graph Traversal** | Agent traces "who calls this function?" and "what does this function call?" up to N levels deep. Answers "what breaks if I change this?" | `get_callers` / `get_callees` MCP tools. AQL graph traversal on `calls` edge collection with configurable depth (1-5 hops). Filters by `org_id` tenant index. Returns entity docs with file paths and line numbers. | Shipped |
| 2.4 | **Import Chain Analysis** | Agent maps the full dependency chain of any file — what it imports, what those import, and so on. | `get_imports` MCP tool. AQL traversal on `imports` edge collection (file-to-file edges) with depth 1-5. Returns ordered import chain with file paths. | Shipped |
| 2.5 | **Project Stats** | Agent gets a snapshot: file count, function count, class count, languages, last indexed SHA and timestamp. | `get_project_stats` MCP tool. Aggregates counts from ArangoDB entity collections (`files`, `functions`, `classes`, `interfaces`, `variables`) filtered by `(org_id, repo_id)`. Joins with Prisma `repos` table for status/SHA metadata. | Shipped |
| 2.6 | **Business Context** | Agent sees *why* each piece of code exists — its business purpose, whether it's core feature, shared utility, or infrastructure. | `get_business_context` MCP tool. Fetches justification from ArangoDB `justifications` collection: taxonomy (VERTICAL/HORIZONTAL/UTILITY), feature_tag, business_purpose, confidence score, semantic triples, compliance tags. LLM-generated during justification pipeline. | Shipped |
| 2.7 | **Search by Purpose** | Agent finds code by what it does for the business, not by name. "Find subscription cancellation" works even if the function is called `handleWebhookEvent`. | `search_by_purpose` MCP tool. Cosine similarity search on `justification_embeddings` pgvector table (768d nomic-embed-text). Optional taxonomy filter. Returns entities ranked by business-purpose relevance, not code similarity. | Shipped |
| 2.8 | **Impact Analysis** | Before changing a function, agent checks the blast radius — every function, class, and file that would be affected, N levels deep. | `analyze_impact` MCP tool. N-hop outbound traversal on `calls` + `imports` + `extends` + `implements` edge collections. Returns transitive closure of affected entities with business context enrichment from justifications. | Shipped |
| 2.9 | **Blueprint** | Agent gets a high-level map of your project's features, entry points, health risks, and architecture decisions. Like a senior dev's mental model in one call. | `get_blueprint` MCP tool. Aggregates from ArangoDB: `features_agg` (feature map), `health_reports` (risk summary), `adrs` (architecture decisions). Returns structured JSON with feature-to-entity mappings and taxonomy breakdown. | Shipped |
| 2.10 | **Convention Guide** | Agent receives a style guide built from your repo's actual patterns and enforced rules. New code matches your conventions automatically. | `get_conventions` MCP tool. Merges active `rules` (ArangoDB, filtered by scope/status/priority) with detected `patterns` (filtered by confidence threshold). Formats as structured markdown guide with examples and enforcement levels. | Shipped |
| 2.11 | **Suggest Approach** | Agent gets a recommended implementation strategy based on how similar things were done in your codebase and which rules apply. | `suggest_approach` MCP tool. Combines `get_relevant_rules` (sub-graph traversal for contextual rules), `semantic_search` (similar implementations), and `get_conventions` (applicable patterns) into a ranked suggestion with mandatory constraints highlighted. | Shipped |
| 2.12 | **Find Similar Code** | Agent locates code structurally or semantically similar to a reference entity. Useful for "do it the same way as X." | `find_similar` MCP tool. Computes cosine similarity between the reference entity's embedding and all entity embeddings in the repo via pgvector HNSW index. Returns top-K results with similarity scores and file locations. | Shipped |

### 3. Live Coding Context

| # | Feature | Simple | Technical | Status |
|---|---|---|---|---|
| 3.1 | **Dirty Buffer Sync** | Your unsaved editor changes are visible to the agent within milliseconds. Even before you hit save, code search reflects your latest keystrokes. | `sync_dirty_buffer` MCP tool. Regex-extracts entity signatures from raw buffer text, stores as ephemeral overlay in Redis with 30s TTL. Entity resolution chain: dirty buffer (highest priority) > workspace overlay > committed graph. | Shipped |
| 3.2 | **Local Diff Sync** | Uncommitted changes are synced to the cloud so every agent tool sees your work-in-progress, not just the last commit. | `sync_local_diff` MCP tool. Accepts `git diff` output, strips lockfiles/build artifacts, parses hunks into a workspace overlay stored in Redis. Appends a ledger entry if `prompt` is provided. Auto-marks working if `validation_result` passes. | Shipped |
| 3.3 | **File Watcher** | Run `unerr watch` and forget it. Every file save syncs to the cloud within 2 seconds. The agent stays in sync without manual refresh. | Chokidar-based file watcher respecting `.gitignore`. Debounces changes (configurable, default 2000ms), computes `git diff`, and calls `sync_local_diff` via MCP. Runs config integrity check every 60s and auto-repairs IDE MCP config drift. | Shipped |
| 3.4 | **Local-First Mode** | Download your repo's knowledge graph, run queries locally in under 5ms. Works offline, on planes, no internet needed. | `unerr pull` downloads msgpack-serialized graph snapshot (SHA-256 verified) from Supabase Storage. `unerr serve` loads it into CozoDB (in-memory Datalog graph DB) and starts a stdio MCP server with 9 local tools + 4 cloud-proxy tools. Sub-5ms query latency. | Shipped |

### 4. Prompt Ledger & Rewind

| # | Feature | Simple | Technical | Status |
|---|---|---|---|---|
| 4.1 | **Prompt Timeline** | Every AI-assisted change is recorded: what prompt was given, which model ran it, what files were touched, and whether it worked. Full audit trail viewable in web dashboard or CLI. | Ledger entries stored in ArangoDB `ledger` collection with composite indexes on `(org_id, repo_id, user_id, branch, timeline_branch, created_at)`. Each entry records: prompt, agent model, file diffs, validation result, status (pending/working/broken/committed/reverted). | Shipped |
| 4.2 | **Mark Working** | After the AI makes a change that works, bookmark it as a "known good" state. Creates a safe checkpoint for future rewinds. | `mark_working` MCP tool. Updates ledger entry status to `working` via validated state machine transition (`validateLedgerTransition`). Creates a `LedgerSnapshot` in PostgreSQL (`unerr.ledger_snapshots`) storing file contents at that point. | Shipped |
| 4.3 | **Rewind** | AI made a mess? Rewind to any working state. Shows blast radius first (safe/conflicting files), then atomically rolls back and starts a new timeline branch. | `revert_to_working_state` MCP tool. Two-phase: (1) shadow rewind computes blast radius by diffing current snapshot vs target snapshot, categorizes files as safe/conflicted/at-risk; (2) atomic rewind marks intermediate entries as `reverted`, increments `timeline_branch`, creates new ledger entry. `dry_run` mode available. | Shipped |
| 4.4 | **Timeline Branches** | When you rewind, a new branch is created in the timeline. View the full tree of attempts — useful for comparing AI approaches. | Timeline branches are integer counters per `(repo_id, branch)`. Rewind increments the counter and all subsequent entries use the new `timeline_branch` value. ArangoDB `idx_ledger_timeline` index enables efficient branch-scoped queries. CLI `unerr branches` renders as formatted table. | Shipped |
| 4.5 | **AI Commit Summaries** | Each git commit gets an auto-generated narrative of what the AI contributed. See what AI did at a glance. | Commit summaries generated by correlating ledger entries with git SHAs via `ledger_summaries` ArangoDB collection (indexed on `commit_sha`). LLM generates narrative from aggregated prompt/diff data per commit. | Shipped |
| 4.6 | **Merge History** | When branches merge, Unerr generates a summary of all AI activity on that branch. Useful in code review to understand the AI's contribution. | Triggered by GitHub `push` webhook on merge commits. Aggregates ledger entries across the merged branch's timeline, counts prompts per model, and generates a narrative summary stored in `ledger_summaries`. | Shipped |

### 5. Health & Quality Analysis

| # | Feature | Simple | Technical | Status |
|---|---|---|---|---|
| 5.1 | **Health Report** | A 0-100 health score across 13 risk categories: dead code, complexity, architecture violations, missing tests, naming, and more. Updated after every indexing run. | LLM-generated report from ArangoDB graph analysis. Stored in `health_reports` collection. Risk categories: dead_code, circular_deps, high_fan_in, high_fan_out, naming_inconsistency, missing_tests, complexity, architecture_violation, api_contract, env_validation, state_lifecycle, idempotency, rate_limiting. | Shipped |
| 5.2 | **Prioritized Issues** | AI-ranked list of what to fix first, grouped by category. Each issue has severity, reasoning, impact, and a copy-pasteable prompt to fix it with your AI agent. | Issues extracted from health report insights. Categories: Dead Code, Architecture, Quality, Complexity, Taxonomy. Each issue includes: severity (high/medium/low), reasoning chain, affected entities, and a pre-built agent prompt that references the correct MCP tools for remediation. | Shipped |
| 5.3 | **Dead Code Detection** | Finds functions and classes nothing calls. Shows entity, file, and line number so you can delete it or investigate. | Graph query on ArangoDB: entities in `functions`/`classes` with zero inbound edges in `calls` collection (fan-in = 0). Excludes entry points (exported, main, test files). Returns entity key, file_path, start_line. | Shipped |
| 5.4 | **Architectural Drift** | Compares your codebase's business intent across indexing runs. Detects when "auth logic" starts drifting into "billing logic." | Cosine similarity comparison between justification embeddings across consecutive indexing runs. Stored in `drift_scores` ArangoDB collection. Flags entities where taxonomy or feature_tag changed significantly (similarity < threshold). | Shipped |
| 5.5 | **Circular Dependency Detection** | Finds cycles in the call graph (A calls B calls C calls A). Shows the full cycle path. | AQL cycle detection query on `calls` edge collection. Uses depth-limited DFS with `org_id` filter. Returns ordered list of entities forming each cycle. | Shipped |
| 5.6 | **High Fan-In/Fan-Out** | Flags "God functions" that everything depends on or that depend on everything. Riskiest functions to change. | Degree centrality computation on `calls` edges. Fan-in = inbound edge count, fan-out = outbound edge count. Flags entities exceeding configurable thresholds (default: fan-in > 10, fan-out > 15). | Shipped |
| 5.7 | **Feature Blueprint** | Auto-discovers business features (e.g., "User Auth", "Payments") with entry points and taxonomy breakdown. | Aggregated from `justifications` collection. Groups entities by `feature_tag`, classifies as VERTICAL (core feature), HORIZONTAL (shared utility), or UTILITY (infrastructure). Entry points identified via high fan-in + exported symbols. Stored in `features_agg`. | Shipped |
| 5.8 | **Architecture Decision Records** | Auto-generates ADRs by analyzing code structure. "Decision: Use repository pattern. Context: 14 files follow this. Evidence: UserRepo, OrderRepo..." | LLM-generated from pattern analysis. Input: detected patterns with high adherence rates + entity graph structure. Output: structured ADR (context, decision, consequences, evidence). Stored in ArangoDB `adrs` collection. | Shipped |
| 5.9 | **Domain Glossary** | Extracts recurring domain terms from variable names, function names, and comments. Useful for onboarding and consistent naming. | NLP extraction from entity names and docstrings. Frequency-weighted, deduplicated by stemming. Stored in `domain_ontologies` ArangoDB collection. Queryable via `/api/repos/[repoId]/glossary`. | Shipped |

### 6. Rules & Pattern Enforcement

| # | Feature | Simple | Technical | Status |
|---|---|---|---|---|
| 6.1 | **Auto-Detected Patterns** | Unerr discovers conventions your team already follows: naming, error handling, imports, tests. Shows adherence rate and evidence. | Pattern mining via AST analysis during indexing. Types: structural, naming, error_handling, import, testing. Each pattern stores: regex/ast-grep pattern, adherence rate (% of entities matching), confidence score, evidence locations (file + line). Stored in ArangoDB `patterns` collection. | Shipped |
| 6.2 | **Custom Rules** | Define architecture rules with enforcement levels: suggest, warn, or block. Rules use ast-grep for precise structural matching. | Rules stored in ArangoDB `rules` collection. Fields: `pattern` (ast-grep YAML), `semgrep_rule` (Semgrep YAML), `enforcement` (suggest/warn/block), `scope` (org/repo/path/branch/workspace), `type` (architecture/naming/security/performance/style/custom), `priority`. Indexed on `(org_id, repo_id, status, priority)`. | Shipped |
| 6.3 | **Org-Wide Rules** | Rules that apply across every repo in your org. Promote from repo-level to org-level for consistent standards. | Rules with `scope: "org"` apply to all repos under the organization. Managed via `/api/settings/rules`. Rule resolution merges org-level + repo-level rules, with repo-level overrides taking precedence on conflicts. | Shipped |
| 6.4 | **Rule Drafting** | Describe a rule in plain English and Unerr generates the ast-grep pattern and Semgrep YAML. No pattern syntax needed. | `draft_architecture_rule` MCP tool. Sends natural language description to LLM with few-shot examples of ast-grep + Semgrep patterns. Returns structured rule with pattern, test cases, and suggested enforcement level. | Shipped |
| 6.5 | **Pattern-to-Rule Promotion** | One click turns a detected convention into an enforced rule. Goes from "80% of code does this" to "100% must." | `POST /api/repos/[repoId]/rules/from-pattern` converts a `patterns` doc into a `rules` doc, preserving the ast-grep pattern and setting initial enforcement to `suggest`. Adherence rate carries over as baseline. | Shipped |
| 6.6 | **Rule Check** | Agent checks code against all active rules before suggesting it. Returns violations with line numbers and fix suggestions. | `check_rules` MCP tool. Runs Semgrep with active rule YAML configs against provided file path or inline code. Returns violations with: rule_id, line_number, message, severity, auto-fix suggestion. Filters by file scope and enforcement level. | Shipped |
| 6.7 | **Anti-Pattern Detection** | 23 built-in detectors for common code smells: N+1 queries, swallowed errors, missing cleanup, hardcoded secrets, unsafe concurrency. Works out of the box. | Pre-packaged Semgrep + ast-grep rule library covering: N+1 query loops, empty catch blocks, missing `removeEventListener`/`clearInterval`, hardcoded credentials, `console.log` in production, missing `await`, unsafe `Promise.all` without error handling, and 16 more. Applied during `check_patterns` MCP tool and PR review pipeline. | Shipped |

### 7. PR Review Integration

| # | Feature | Simple | Technical | Status |
|---|---|---|---|---|
| 7.1 | **Automated PR Review** | Every GitHub PR gets an automatic architecture review: pattern violations, downstream impact, test gaps, complexity, dependency risks. Results posted as a GitHub check run. | Triggered by GitHub `pull_request` webhook. Temporal workflow runs 5 check types: pattern (Semgrep), impact (graph traversal on changed entities), test (coverage gap detection), complexity (cyclomatic + cognitive), dependency (new imports analysis). Results posted via GitHub Checks API + Review API. | Shipped |
| 7.2 | **Review Dashboard** | Web UI listing all reviews with pass/warn/fail counts and auto-approval status. Click any review for full comment breakdown. | `unerr.pr_reviews` table with `checks_passed/warned/failed` counters. Detail view joins `pr_review_comments` (FK to review). Filterable by status, repo. SSE updates for in-progress reviews. | Shipped |
| 7.3 | **Inline Comments** | Review findings posted as per-file, per-line comments on the GitHub PR with severity, explanation, and suggested fix. | GitHub Pull Request Review Comments API (`POST /repos/{owner}/{repo}/pulls/{pr}/comments`). Each comment maps to a `pr_review_comments` row with `file_path`, `line_number`, `check_type`, `severity`, `message`, `suggestion`, `auto_fix`. | Shipped |
| 7.4 | **Review Config** | Control which branches trigger reviews, set auto-approval thresholds, choose notification preferences. Per-repo from the dashboard. | `review_config` JSONB column on `unerr.repos`. Fields: `target_branches`, `auto_approve_threshold` (max warnings with zero blockers), `notification_channel`, `enabled`. Configurable via `PUT /api/repos/[repoId]/settings/review`. | Shipped |
| 7.5 | **"Debate the Bot"** | Disagree with a review finding? Your AI agent queries the review via MCP and discusses it with you. Contest or accept from your IDE. | `review_pr_status` MCP tool. Fetches review by PR number, returns structured findings with remediation guidance. Agent can discuss individual comments, explain reasoning, or suggest alternative fixes inline in the IDE conversation. | Shipped |

### 8. Code Snippet Library

| # | Feature | Simple | Technical | Status |
|---|---|---|---|---|
| 8.1 | **Team Snippets** | Pin the best examples of how your team does things so every AI agent references the same gold-standard code. Stops agents from inventing patterns. | Snippets stored in ArangoDB `snippets` collection with `scope: "team"`. Fields: `code`, `language`, `category`, `tags`, `description`, `source_entity_key`. Retrievable via `get_conventions` and `suggest_approach` MCP tools. Indexed on `(org_id, repo_id)`. | Shipped |
| 8.2 | **Community Snippets** | Curated pattern library maintained by the Unerr team — common auth flows, DB patterns, API designs. Available to all users. | Global `snippets` docs with `scope: "community"` and `org_id: "global"`. Read-only for users. Seeded from curated collection. Included in `get_conventions` results when relevant to the query context. | Shipped |
| 8.3 | **Auto-Extracted Snippets** | During indexing, Unerr identifies well-structured, frequently referenced code and suggests them as snippet candidates. You approve which to pin. | Heuristic scoring during indexing: high fan-in (frequently called) + clean naming + docstring present + low cyclomatic complexity = high snippet candidacy score. Stored in `mined_patterns` with `suggested_as_snippet: true`. User promotes via UI. | Shipped |
| 8.4 | **Semantic Snippet Search** | Agent finds relevant snippets by describing what it needs rather than searching by name. Returns the closest matching snippet. | Embedding-based search on snippet `text_content` via pgvector `rule_embeddings` table (shared embedding space). Cosine similarity with HNSW index. Returns top-K snippets with similarity scores, filtered by language and category. | Shipped |

### 9. Dashboard & Visualization

| # | Feature | Simple | Technical | Status |
|---|---|---|---|---|
| 9.1 | **Entity Graph Visualization** | Interactive, zoomable graph showing how functions, classes, and files relate. Click any node to navigate to its detail page. | React Flow force-directed graph. Nodes from ArangoDB entity collections, edges from `calls`/`imports`/`extends`/`implements`. Fetched via `/api/repos/[repoId]/entities/[entityId]/graph` with configurable depth. Client-side layout with dagre. | Shipped |
| 9.2 | **Pipeline Monitor** | Watch indexing in real-time: step-by-step progress bar with live log streaming. See what's happening and how long each step takes. | SSE endpoint (`/api/repos/[repoId]/events`) streams Temporal workflow status updates. Steps: clone, parse (SCIP), graph upload, embed (nomic-embed-text), justify (LLM). Pipeline logs streamed via `/api/repos/[repoId]/logs` (SSE) and archived as downloadable files. | Shipped |
| 9.3 | **Activity Feed** | Chronological stream of everything that happened: files indexed, entities discovered, edges built, embeddings generated, justifications cascaded. | `index_events` ArangoDB collection (TTL: 90 days). Each event records: `event_type`, `files_changed`, `entities_added/updated/deleted`, `edges_repaired`, `embeddings_updated`, `cascade_count`, `duration_ms`. Paginated via `/api/repos/[repoId]/activity`. | Shipped |
| 9.4 | **Global Code Search** | Search bar in the top nav across ALL connected repos. Type a function name or natural language query and jump to results from any repo. | `/api/search` endpoint. Runs hybrid search (semantic + keyword) across all repos in the org. pgvector query with `org_id` filter (no `repo_id` constraint). Results grouped by repo with entity type, file path, and relevance score. | Shipped |
| 9.5 | **Entity Browser** | Paginated, filterable list of every indexed entity with business justification, taxonomy tag, and confidence score. | Server-side paginated query joining ArangoDB entities with justifications. Filterable by entity type, taxonomy, confidence threshold. Sort by name, type, confidence, or file path. `/api/repos/[repoId]/entities?page=1&limit=50&type=function`. | Shipped |

### 10. Team & Organization

| # | Feature | Simple | Technical | Status |
|---|---|---|---|---|
| 10.1 | **Organization Management** | Auto-created at signup. All repos, members, rules, and API keys belong to your org. Manage from Settings. | Better Auth organization plugin. Org created in `public.organization` table during signup (`"{name}'s organization"`). Multi-tenant isolation via `organization_id` FK on all `unerr.*` tables. Session stores `activeOrganizationId`. | Shipped |
| 10.2 | **GitHub Connections** | Connect multiple GitHub accounts/orgs to one Unerr org. Each gets its own installation and permissions. | `unerr.github_installations` table. One-to-many: one Unerr org can have N GitHub installations. Each stores `installation_id`, `account_login`, `account_type`, `permissions` (JSONB). Token refresh via `@octokit/auth-app` on demand. | Shipped |
| 10.3 | **API Key Management** | Create keys scoped to your org or a specific repo. Configurable permissions: `mcp:read` and `mcp:sync`. Revoke instantly. | `unerr.api_keys` table. Key stored as SHA-256 hash (`key_hash`), prefix retained for display (`key_prefix`). Scopes: `mcp:read` (all read tools), `mcp:sync` (workspace write via `sync_local_diff`). `is_default` flag for auto-provisioned keys. Soft-delete via `revoked_at`. | Shipped |
| 10.4 | **Team Members** | View who's in your org, their role, and join date. Invitations coming soon. | Better Auth `member` table (FK to `user` and `organization`). Roles: `owner`, `admin`, `member`. Listed via Better Auth `organization.listMembers()` API. Invitation flow uses `invitation` table with expiry. | Shipped |
| 10.5 | **Audit Trail** | Every significant action logged with timestamp, user, IP, and metadata. Exportable for compliance. | `public.audit_logs` table. Captures: action, resource, resource_id, user_id, organization_id, ip_address (from `x-forwarded-for`), user_agent, metadata (JSONB). Indexed on `(user_id, created_at)` and `(organization_id, created_at)`. | Shipped |

### 11. Billing & Usage

| # | Feature | Simple | Technical | Status |
|---|---|---|---|---|
| 11.1 | **Usage-Based Billing** | Pay based on actual LLM cost — shown in real dollars, not opaque credits. Full transparency into what you're paying for. | Langfuse Daily Metrics API integration. Tracks per-org LLM spend (input/output tokens * model pricing). Stored in `public.costs` table. Real-time aggregation via `/api/repos/[repoId]/costs`. Stripe metered billing sync. | Planned |
| 11.2 | **Subscription Plans** | Free ($0.50/mo LLM budget), Pro ($5/mo), Max ($50/mo), Teams Pro, Teams Max. Upgrade/downgrade anytime. | Stripe Subscriptions API (version `2025-02-24.acacia`). `public.subscriptions` table with `stripe_subscription_id`, `plan_id`, `status`. Plan limits enforced at API middleware level. Webhook-driven status sync via `invoice.paid` / `customer.subscription.updated`. | Planned |
| 11.3 | **On-Demand Credits** | Running low? Buy a one-time top-up ($5/$10/$25) without changing your plan. Current billing period only. | Stripe Payment Intents for one-time charges. Credit stored in `on_demand_purchases` table scoped to `(organization_id, period_start, period_end)`. Idempotent via unique `stripe_payment_id`. Added to available budget in real-time budget check. | Planned |
| 11.4 | **Team Cost Pooling** | Team plans share one LLM budget across all members. Dashboard shows per-member usage so you can see who's consuming what. | Aggregates `public.costs` by `user_id` within org. Total pool = plan limit + on-demand credits. Per-member breakdown via `GROUP BY user_id` on costs table. Budget enforcement checks org-level aggregate, not per-member. | Planned |
| 11.5 | **Real-Time Budget Enforcement** | When you hit your limit, LLM features stop. Read-only features keep working. No surprise charges ever. | Pre-flight budget check before every LLM call (indexing, justification, review activities). Compares `SUM(cost)` for current period against `plan_limit + on_demand_credits`. Returns 402 with clear message. Read-only tools (search, graph, timeline) bypass budget check. | Planned |

### 12. Planned Features

| # | Feature | Simple | Technical | Status |
|---|---|---|---|---|
| 12.1 | **VS Code Extension** | Native sidebar panels for Blueprint, Impact Graph, Timeline, and Workspace Diff — no browser needed. Click a graph node to jump to the file. | VS Code Extension API (TreeView, WebviewPanel). Communicates with Unerr API via REST. Blueprint rendered as swimlane WebviewPanel, Impact Graph as force-directed D3 canvas, Timeline as custom TreeView. `vscode.open` for file navigation. | Planned |
| 12.2 | **JetBrains Plugin** | Same native sidebar for IntelliJ, WebStorm, PyCharm. Full feature parity with VS Code. | IntelliJ Platform SDK (ToolWindow, JCEF browser panels). REST API client using OkHttp. Kotlin/JVM implementation. Same API endpoints as VS Code extension. | Planned |
| 12.3 | **Collision Detection** | Real-time alerts when two developers or AI agents edit the same function simultaneously. Prevents conflicts before they happen. | Entity-level activity recording in Redis (sorted set per entity key, scored by timestamp). Heartbeat from `sync_dirty_buffer` / `sync_local_diff`. Collision = two different `user_id` entries for same entity within TTL window. Push notification via SSE. | Planned |
| 12.4 | **Active Sessions** | Dashboard shows who is currently working on the repo and which files they're touching. Team awareness without standups. | Redis hash per repo: `{userId: {files: [...], lastSeen: timestamp, agent: "cursor"}}`. Populated by MCP tool calls (each call updates session). Expired after 5min inactivity. Rendered as presence indicators on repo dashboard. | Planned |
| 12.5 | **Multi-Repo Contracts** | When a function signature changes in Repo A, flags all callers in Repo B and C that would break. Cross-repo impact analysis. | Cross-repo edge collection in ArangoDB linking entities by import path / package name. Impact analysis traversal spans multiple `repo_id` partitions. Triggered on push webhook when exported function signatures change (AST diff). | Planned |
| 12.6 | **PII Detection** | Scans code paths for personal data flowing to logs, analytics, or external APIs without sanitization. Flags GDPR/CCPA risks. | Taint analysis on the call graph. Source: user input fields (form data, request body). Sink: `console.log`, `analytics.track`, external API calls. Propagation: tracks data flow through function parameters and return values. Semgrep taint rules + custom graph traversal. | Planned |
| 12.7 | **Trust Boundary Analysis** | Maps data flow from user input to DB writes and API responses. Flags paths where untrusted data crosses a trust boundary without validation. | Graph-based taint tracking. Trust boundaries defined as: HTTP handler entry, DB query execution, external API call, file write. Flags paths where data crosses a boundary without passing through a validation/sanitization node (identified by pattern matching on function names + AST analysis). | Planned |
| 12.8 | **Cognitive Debt Tracking** | Measures how much AI code gets rewritten by humans (rewind-to-commit ratio). High ratio means AI output isn't sticking. | Metric: `reverted_entries / total_entries` per `(repo_id, branch, time_window)`. Derived from ledger entry status transitions. Dashboard chart shows trend over time. Alert threshold configurable. Correlates with model, prompt length, and rule coverage. | Planned |

---

## Part 2: Audience Fit Matrix

Fit ratings: **Best** = high-value daily use, **Good** = solid value, **Okay** = usable but not primary, **--** = minimal value.

### 1. Onboarding & Setup

| # | Feature | Solo Dev | Vibe Coder | Indie Hacker | Small Startup | Growth Startup | Mid Org | Large Org |
|---|---|---|---|---|---|---|---|---|
| 1.1 | One-Command Setup | Best | Best | Best | Best | Good | Okay | Okay |
| 1.2 | GitHub App Install | Best | Good | Best | Best | Best | Best | Best |
| 1.3 | Local CLI Upload | Good | Best | Good | Good | Good | Good | Good |
| 1.4 | Ephemeral Sandbox | Good | Best | Good | Okay | -- | -- | -- |
| 1.5 | IDE Auto-Config | Best | Best | Best | Best | Good | Good | Good |
| 1.6 | Git Hook Auto-Verify | Good | Good | Good | Best | Best | Best | Best |

### 2. Code Intelligence (AI Agent Tools)

| # | Feature | Solo Dev | Vibe Coder | Indie Hacker | Small Startup | Growth Startup | Mid Org | Large Org |
|---|---|---|---|---|---|---|---|---|
| 2.1 | Semantic Code Search | Best | Best | Best | Best | Best | Best | Best |
| 2.2 | Function/Class Lookup | Good | Best | Best | Best | Best | Best | Best |
| 2.3 | Call Graph Traversal | Good | Good | Good | Best | Best | Best | Best |
| 2.4 | Import Chain Analysis | Okay | Good | Good | Best | Best | Best | Best |
| 2.5 | Project Stats | Good | Good | Good | Best | Best | Best | Best |
| 2.6 | Business Context | Okay | Okay | Good | Good | Best | Best | Best |
| 2.7 | Search by Purpose | Okay | Good | Good | Good | Best | Best | Best |
| 2.8 | Impact Analysis | Good | Best | Best | Best | Best | Best | Best |
| 2.9 | Blueprint | Okay | Good | Good | Best | Best | Best | Best |
| 2.10 | Convention Guide | Good | Good | Good | Best | Best | Best | Best |
| 2.11 | Suggest Approach | Good | Best | Best | Best | Best | Best | Best |
| 2.12 | Find Similar Code | Good | Best | Good | Good | Best | Best | Best |

### 3. Live Coding Context

| # | Feature | Solo Dev | Vibe Coder | Indie Hacker | Small Startup | Growth Startup | Mid Org | Large Org |
|---|---|---|---|---|---|---|---|---|
| 3.1 | Dirty Buffer Sync | Good | Best | Best | Best | Good | Good | Good |
| 3.2 | Local Diff Sync | Good | Best | Best | Best | Best | Best | Best |
| 3.3 | File Watcher | Good | Best | Best | Best | Good | Good | Good |
| 3.4 | Local-First Mode | Best | Best | Best | Best | Good | Good | Good |

### 4. Prompt Ledger & Rewind

| # | Feature | Solo Dev | Vibe Coder | Indie Hacker | Small Startup | Growth Startup | Mid Org | Large Org |
|---|---|---|---|---|---|---|---|---|
| 4.1 | Prompt Timeline | Good | Best | Best | Best | Best | Best | Best |
| 4.2 | Mark Working | Good | Best | Best | Best | Best | Best | Best |
| 4.3 | Rewind | Good | Best | Best | Best | Best | Best | Best |
| 4.4 | Timeline Branches | Okay | Best | Good | Good | Best | Best | Best |
| 4.5 | AI Commit Summaries | Okay | Good | Good | Good | Best | Best | Best |
| 4.6 | Merge History | Okay | Good | Good | Good | Best | Best | Best |

### 5. Health & Quality Analysis

| # | Feature | Solo Dev | Vibe Coder | Indie Hacker | Small Startup | Growth Startup | Mid Org | Large Org |
|---|---|---|---|---|---|---|---|---|
| 5.1 | Health Report | Good | Good | Best | Best | Best | Best | Best |
| 5.2 | Prioritized Issues | Good | Best | Best | Best | Best | Best | Best |
| 5.3 | Dead Code Detection | Good | Good | Best | Best | Best | Best | Best |
| 5.4 | Architectural Drift | Okay | Okay | Good | Good | Best | Best | Best |
| 5.5 | Circular Dependency Detection | Okay | Good | Good | Best | Best | Best | Best |
| 5.6 | High Fan-In/Fan-Out | Okay | Good | Good | Best | Best | Best | Best |
| 5.7 | Feature Blueprint | Okay | Good | Good | Best | Best | Best | Best |
| 5.8 | Architecture Decision Records | Okay | Okay | Good | Good | Best | Best | Best |
| 5.9 | Domain Glossary | Okay | Okay | Good | Good | Best | Best | Best |

### 6. Rules & Pattern Enforcement

| # | Feature | Solo Dev | Vibe Coder | Indie Hacker | Small Startup | Growth Startup | Mid Org | Large Org |
|---|---|---|---|---|---|---|---|---|
| 6.1 | Auto-Detected Patterns | Good | Good | Best | Best | Best | Best | Best |
| 6.2 | Custom Rules | Okay | Good | Good | Best | Best | Best | Best |
| 6.3 | Org-Wide Rules | -- | -- | Okay | Good | Best | Best | Best |
| 6.4 | Rule Drafting | Good | Good | Good | Best | Best | Best | Best |
| 6.5 | Pattern-to-Rule Promotion | Okay | Good | Good | Best | Best | Best | Best |
| 6.6 | Rule Check | Good | Good | Good | Best | Best | Best | Best |
| 6.7 | Anti-Pattern Detection | Good | Good | Best | Best | Best | Best | Best |

### 7. PR Review Integration

| # | Feature | Solo Dev | Vibe Coder | Indie Hacker | Small Startup | Growth Startup | Mid Org | Large Org |
|---|---|---|---|---|---|---|---|---|
| 7.1 | Automated PR Review | Okay | Good | Good | Best | Best | Best | Best |
| 7.2 | Review Dashboard | Okay | Good | Good | Best | Best | Best | Best |
| 7.3 | Inline Comments | Okay | Good | Good | Best | Best | Best | Best |
| 7.4 | Review Config | Okay | Okay | Good | Best | Best | Best | Best |
| 7.5 | "Debate the Bot" | Okay | Good | Good | Best | Best | Best | Best |

### 8. Code Snippet Library

| # | Feature | Solo Dev | Vibe Coder | Indie Hacker | Small Startup | Growth Startup | Mid Org | Large Org |
|---|---|---|---|---|---|---|---|---|
| 8.1 | Team Snippets | Okay | Good | Good | Best | Best | Best | Best |
| 8.2 | Community Snippets | Good | Good | Good | Good | Good | Good | Good |
| 8.3 | Auto-Extracted Snippets | Good | Good | Good | Best | Best | Best | Best |
| 8.4 | Semantic Snippet Search | Good | Best | Good | Good | Best | Best | Best |

### 9. Dashboard & Visualization

| # | Feature | Solo Dev | Vibe Coder | Indie Hacker | Small Startup | Growth Startup | Mid Org | Large Org |
|---|---|---|---|---|---|---|---|---|
| 9.1 | Entity Graph Visualization | Good | Good | Good | Best | Best | Best | Best |
| 9.2 | Pipeline Monitor | Good | Good | Good | Best | Best | Best | Best |
| 9.3 | Activity Feed | Okay | Okay | Good | Good | Best | Best | Best |
| 9.4 | Global Code Search | Good | Good | Good | Best | Best | Best | Best |
| 9.5 | Entity Browser | Good | Good | Good | Best | Best | Best | Best |

### 10. Team & Organization

| # | Feature | Solo Dev | Vibe Coder | Indie Hacker | Small Startup | Growth Startup | Mid Org | Large Org |
|---|---|---|---|---|---|---|---|---|
| 10.1 | Organization Management | Good | Good | Good | Best | Best | Best | Best |
| 10.2 | GitHub Connections | Okay | Okay | Good | Best | Best | Best | Best |
| 10.3 | API Key Management | Good | Good | Good | Best | Best | Best | Best |
| 10.4 | Team Members | -- | -- | Okay | Good | Best | Best | Best |
| 10.5 | Audit Trail | -- | -- | Okay | Good | Best | Best | Best |

### 11. Billing & Usage

| # | Feature | Solo Dev | Vibe Coder | Indie Hacker | Small Startup | Growth Startup | Mid Org | Large Org |
|---|---|---|---|---|---|---|---|---|
| 11.1 | Usage-Based Billing | Good | Good | Best | Best | Best | Best | Best |
| 11.2 | Subscription Plans | Best | Good | Best | Best | Best | Best | Best |
| 11.3 | On-Demand Credits | Good | Good | Best | Best | Best | Good | Good |
| 11.4 | Team Cost Pooling | -- | -- | -- | Good | Best | Best | Best |
| 11.5 | Real-Time Budget Enforcement | Best | Best | Best | Best | Best | Best | Best |

---

## Segment Summary

| Segment | Top Value Propositions |
|---|---|
| **Solo Dev** | One-command setup, local-first mode, semantic search, free tier — get AI agent superpowers on personal projects with zero friction |
| **Vibe Coder** | Dirty buffer sync, prompt ledger + rewind, impact analysis, ephemeral sandbox, convention guide — ship faster with an AI agent that truly understands your code |
| **Indie Hacker** | Health report, prioritized issues with fix prompts, auto-detected patterns, dead code cleanup — keep your solo codebase clean as it grows without hiring |
| **Small Startup** | All of Indie Hacker + PR reviews, team snippets, org-wide rules, API key management — lightweight governance that doesn't slow the team down |
| **Growth Startup** | All of Small Startup + blueprint, ADRs, drift detection, collision detection, team cost pooling — maintain architecture quality as the team scales from 10 to 50 |
| **Mid Org** | All of Growth + org-wide governance, audit trail, multi-repo contracts, native IDE extensions — enterprise-grade code intelligence without enterprise-grade overhead |
| **Large Org** | All of Mid Org + PII detection, trust boundary analysis, compliance audit, JetBrains plugin — security, compliance, and cross-team coordination at scale |
