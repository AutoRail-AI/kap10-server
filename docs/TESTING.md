# Testing Guide — unerr Server

> What to test, how to test it, and who tests it (automated vs human).

## Quick Reference

```bash
pnpm test                                    # Run all unit/integration tests
pnpm test path/to/file.test.ts               # Single test file
pnpm test:watch                              # Watch mode
pnpm test:coverage                           # With coverage report
pnpm e2e:headless                            # Playwright E2E (browser)
pnpm e2e:ui                                  # Playwright with UI
```

---

## Phase Dependency Chain

```
Phase 0 (Foundation)
  └─► Phase 1 (GitHub Connect & Indexing)
        └─► Phase 2 (Hosted MCP Server)
              ├─► Phase 3 (Semantic Search)
              │     └─► Phase 4 (Business Justification & Taxonomy)
              │           └─► Phase 5 (Incremental Indexing & GitHub Webhooks)
              │                 └─► Phase 5.5 (Prompt Ledger, Rewind & Local Ingestion)
              │                       └─► Phase 5.6 (CLI-First Zero-Friction Onboarding)
              │                             └─► Phase 6 (Pattern Enforcement & Rules Engine)
              │                                   └─► Phase 7 (PR Review Integration)
              │                                         └─► Phase 10b (Local-First Proxy — Full)
              └─► Phase 10a (Local-First Intelligence Proxy — MVP)
                    └─► Phase 10b (Local-First Proxy — Full)
```

Phase 10a branches from Phase 2 (it only needs the MCP server). Phase 10b depends on both Phase 6 (rules/patterns) and Phase 10a (local CLI). Phase 7 depends on Phase 6. Tests should be run in order during initial setup; in CI all tests run together.

---

## Testing Matrix by Phase

Legend:
- **Auto** = Automated tests (vitest). Can be run by CI or LLM agent.
- **Server** = Requires running dev server + infra (curl smoke tests).
- **Manual** = Requires human interaction (browser clicks, visual verification, external service).
- **E2E** = Playwright browser automation.

---

### Phase 0 — Foundation Wiring

> **Summary:** DI container with 12 ports (hexagonal architecture), health endpoint, auth (Better Auth), proxy route protection, env validation.

| Area | What to Test | Type | Test File / How |
|------|-------------|------|-----------------|
| DI Container | All 12 ports resolve, fresh instances, overrides work | Auto | `lib/di/__tests__/container.test.ts` |
| Port Compliance | Every fake implements its port interface correctly | Auto | `lib/di/__tests__/port-compliance.test.ts` |
| Health endpoint | `/api/health` returns status for all 5 infra services | Auto | `app/api/__tests__/health.test.ts` |
| Auth signup | Email/password registration → auto-org creation | Manual | Browser: `/register` → check org appears in dashboard |
| OAuth login | Google/GitHub login → session → org auto-provision | Manual | Browser: click Google/GitHub → lands on dashboard |
| Email verification | Unverified email/password users redirected to `/verify-email` | Manual | Register with email → check redirect before verifying |
| Proxy route protection | Unauthenticated requests redirect to `/login` | Server | `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/repos` → `307` |
| Env validation | `env.mjs` rejects missing required vars at build time | Auto | `pnpm build` with missing env → should fail |

**Auto test files:** 3
**What an LLM agent can do:** Run all Auto tests, verify build passes. Cannot test OAuth browser flows or email delivery.

---

### Phase 1 — GitHub Connect & Repository Indexing

> **Summary:** Tree-sitter parsing for TypeScript/Python/Go, entity hashing, file scanning, monorepo detection, Temporal workflows for repo indexing, ArangoDB graph storage.
>
> **Depends on:** Phase 0

| Area | What to Test | Type | Test File / How |
|------|-------------|------|-----------------|
| Tree-sitter parsing (TS) | TypeScript files → entities extracted correctly | Auto | `lib/indexer/languages/typescript/__tests__/tree-sitter.test.ts` |
| Tree-sitter parsing (Python) | Python files → entities extracted correctly | Auto | `lib/indexer/languages/python/__tests__/tree-sitter.test.ts` |
| Tree-sitter parsing (Go) | Go files → entities extracted correctly | Auto | `lib/indexer/languages/go/__tests__/tree-sitter.test.ts` |
| Entity hashing | Stable deterministic hashes for entities | Auto | `lib/indexer/__tests__/entity-hash.test.ts` |
| Scanner | File scanning finds correct files, respects ignores | Auto | `lib/indexer/__tests__/scanner.test.ts` |
| Monorepo detection | Detects monorepo roots and workspaces | Auto | `lib/indexer/__tests__/monorepo.test.ts` |
| Temporal activities (heavy) | `prepareWorkspace`, `runSCIP`, `parseRest` | Auto | `lib/temporal/activities/__tests__/indexing-activities.test.ts` |
| Temporal activities (light) | `writeToArango`, `updateRepoError`, `deleteRepoData` | Auto | `lib/temporal/activities/__tests__/indexing-light.test.ts` |
| Index repo workflow | Full workflow orchestration with mocked activities | Auto | `lib/temporal/workflows/__tests__/index-repo-workflow.test.ts` |
| File tree builder | Builds file tree from entity paths | Auto | `lib/utils/file-tree-builder.test.ts` |
| ArangoDB adapter | Entity/edge CRUD with real ArangoDB instance | Server | `lib/adapters/arango-graph-store.integration.test.ts` |
| GitHub App install | Install → callback → installation saved in DB | Manual | Install GitHub App on a test org → check `unerr.github_installations` |
| Repo indexing end-to-end | Connect repo → indexing starts → entities appear | Manual | Dashboard: connect repo → wait for "ready" → check entity counts |
| SCIP indexing | SCIP produces correct cross-references | Manual | Requires `scip-typescript` binary → check ArangoDB edges |
| E2E: Auth flows | Signup, login, org creation | E2E | `e2e/auth-flows.spec.ts` |
| E2E: Health | Health page renders | E2E | `e2e/health.spec.ts` |
| E2E: GitHub connect | GitHub repo connection flow | E2E | `e2e/github-connect.spec.ts` |
| E2E: Repo indexing | Indexing progress display | E2E | `e2e/repo-indexing.spec.ts` |
| E2E: Repo browse | File tree browsing | E2E | `e2e/repo-browse.spec.ts` |

**Auto test files:** 10 | **E2E test files:** 5
**What an LLM agent can do:** Run all 10 Auto test files. Cannot install GitHub Apps or trigger real SCIP indexing.

---

### Phase 2 — Hosted MCP Server

> **Summary:** MCP protocol implementation with 27 tools (20 base + 7 Phase 6), dual-mode auth (JWT + API key), secret scrubbing, rate limiting, workspace overlay for uncommitted changes.
>
> **Depends on:** Phase 1

| Area | What to Test | Type | Test File / How |
|------|-------------|------|-----------------|
| MCP auth (JWT + API key) | Dual-mode authentication, cache, expiry | Auto | `lib/mcp/__tests__/auth.test.ts` |
| MCP tools (structural) | 27 tools: search, inspect, traverse, sync, timeline, rewind, rules, patterns, etc. | Auto | `lib/mcp/tools/__tests__/tools.test.ts` |
| MCP tools (semantic) | Semantic search MCP tools | Auto | `lib/mcp/tools/__tests__/semantic.test.ts` |
| Secret scrubber | PII/secrets stripped from MCP responses | Auto | `lib/mcp/security/__tests__/scrubber.test.ts` |
| Rate limiter | Per-key rate limiting works correctly | Auto | `lib/mcp/security/__tests__/rate-limiter.test.ts` |
| Response formatter | MCP responses formatted per spec | Auto | `lib/mcp/__tests__/formatter.test.ts` |
| API key CRUD | Create, list, revoke API keys via `/api/api-keys` | Auto | Test via route handler import |
| MCP in Cursor | Paste MCP URL + API key into `.cursor/mcp.json` → tools work | Manual | Open Cursor → add MCP config → ask agent to search code |
| MCP in Claude Code | `claude mcp add unerr ...` → OAuth flow → tools work | Manual | Terminal → add MCP → Claude Code agent uses tools |
| OAuth 2.1 DCR flow | Dynamic client registration per MCP spec | Manual | Claude Code auto-registers → check token exchange works |

**Auto test files:** 6
**What an LLM agent can do:** Run all 6 Auto test files. Cannot verify real IDE integrations or OAuth browser flows.

---

### Phase 3 — Semantic Search

> **Summary:** nomic-embed-text embeddings in pgvector, hybrid keyword+semantic search with RRF fusion scoring, embedding generation Temporal activity.
>
> **Depends on:** Phase 2

| Area | What to Test | Type | Test File / How |
|------|-------------|------|-----------------|
| Hybrid search | Keyword + semantic fusion, RRF scoring | Auto | `lib/embeddings/__tests__/hybrid-search.test.ts` |
| Embedding activity | Embedding generation Temporal activity | Auto | `lib/temporal/activities/__tests__/embedding.test.ts` |
| Vercel AI provider | LLM adapter for generateObject, streamText, embed | Auto | `lib/adapters/__tests__/vercel-ai-provider.test.ts` |
| pgvector storage | Embeddings stored and queried correctly | Server | Requires running PostgreSQL with pgvector extension |
| Search relevance | "Functions that handle auth" returns auth code | Manual | MCP tool call → verify results are semantically relevant |

**Auto test files:** 3
**What an LLM agent can do:** Run the 3 Auto test files. Cannot judge semantic search quality (subjective).

---

### Phase 4 — Business Justification & Taxonomy

> **Summary:** LLM-powered entity classification (VERTICAL/HORIZONTAL/UTILITY), bi-temporal justification storage, feature aggregation, health reports, domain ontology, drift detection, ADR synthesis, GraphRAG sub-graph extraction, token usage tracking.
>
> **Depends on:** Phase 3

| Area | What to Test | Type | Test File / How |
|------|-------------|------|-----------------|
| Justification schemas | Zod schemas for justification documents | Auto | `lib/justification/__tests__/schemas.test.ts` |
| Model router | Selects correct LLM tier based on entity complexity | Auto | `lib/justification/__tests__/model-router.test.ts` |
| Graph context builder | Builds entity context for LLM prompts | Auto | `lib/justification/__tests__/graph-context-builder.test.ts` |
| Topological sort | Orders entities by dependency for batch justification | Auto | `lib/justification/__tests__/topological-sort.test.ts` |
| Prompt builder | Constructs LLM prompts from entity context | Auto | `lib/justification/__tests__/prompt-builder.test.ts` |
| Post-processor | Validates and normalizes LLM output | Auto | `lib/justification/__tests__/post-processor.test.ts` |
| Drift detector | Detects semantic drift between old and new justifications | Auto | `lib/justification/__tests__/drift-detector.test.ts` |
| Feature aggregator | Groups entities by feature tags | Auto | `lib/justification/__tests__/feature-aggregator.test.ts` |
| Health report builder | Generates repo health report from justifications | Auto | `lib/justification/__tests__/health-report-builder.test.ts` |
| Ontology extractor | Extracts domain ontology from entity names | Auto | `lib/justification/__tests__/ontology-extractor.test.ts` |
| Justification activity | Temporal activity for entity justification | Auto | `lib/temporal/activities/__tests__/justification.test.ts` |
| Justify entity workflow | Full justification workflow orchestration | Auto | `lib/temporal/workflows/__tests__/justify-entity.test.ts` |
| Business MCP tools | get_business_context, search_by_purpose, analyze_impact, get_blueprint | Auto | `lib/mcp/tools/__tests__/business.test.ts` |
| Justification generation | LLM produces valid justification documents | Manual | Trigger justification → verify quality of purpose/taxonomy/tags |
| VERTICAL/HORIZONTAL/UTILITY | Entities classified correctly | Manual | Spot-check 10-20 functions → verify taxonomy makes sense |
| Blueprint Dashboard | Swimlane visualization renders correctly | Manual | Browser: navigate to Blueprint → verify layout, interactions |
| E2E: Entity detail | Entity detail page with justification | E2E | `e2e/entity-detail.spec.ts` |
| E2E: Blueprint | Blueprint visualization | E2E | `e2e/blueprint.spec.ts` |
| E2E: Health report | Health report page | E2E | `e2e/health-report.spec.ts` |

**Auto test files:** 13
**What an LLM agent can do:** Run all 13 Auto test files. Cannot judge LLM output quality or visual layout.

---

### Phase 5 — Incremental Indexing & GitHub Webhooks

> **Summary:** Push-based re-indexing triggered by GitHub webhooks, entity diff (hash comparison), cascade re-justification, AST comparator (filters noise), centrality scoring (hub node detection), signal debouncing (commit storm absorption), branch shadow graphs, semantic drift alerting, blue/green vectoring, semantic fingerprinting (rename detection), quarantine nodes (unparseable files), edge repair, activity feed.
>
> **Depends on:** Phase 4

| Area | What to Test | Type | Test File / How |
|------|-------------|------|-----------------|
| Incremental diff engine | Entity diff: added/modified/deleted detection | Auto | `lib/indexer/__tests__/incremental.test.ts` |
| AST comparator | Filters whitespace/comment-only changes from cascade | Auto | `lib/indexer/__tests__/ast-comparator.test.ts` |
| Centrality scoring | PageRank-style inbound-edge counting, hub detection | Auto | `lib/indexer/__tests__/centrality.test.ts` |
| Edge repair | Detects and repairs broken edges after entity deletion | Auto | `lib/indexer/__tests__/edge-repair.test.ts` |
| Semantic fingerprint | AST-structure-based SHA-256 for rename detection | Auto | `lib/indexer/__tests__/semantic-fingerprint.test.ts` |
| Quarantine nodes | Unparseable files tagged, MCP tools warn agents | Auto | `lib/indexer/__tests__/quarantine.test.ts` |
| Cascade re-justification | Changed entity triggers caller re-justification | Auto | `lib/indexer/__tests__/cascade.test.ts` |
| Branch shadow graph | Delta graph overlay for feature branches | Auto | `lib/indexer/__tests__/branch-overlay.test.ts` |
| Signal debouncing | Rapid push events coalesced into single re-index | Auto | `lib/indexer/__tests__/signal-debounce.test.ts` |
| Prompt drift detection | Identifies AI agent repetition patterns | Auto | `lib/indexer/__tests__/prompt-detector.test.ts` |
| Recent changes MCP tool | get_recent_changes returns index events | Auto | `lib/mcp/tools/__tests__/changes.test.ts` |
| E2E: Activity feed | Activity feed displays indexing events | E2E | `e2e/activity-feed.spec.ts` |
| Webhook handler (push) | `push` event triggers re-index for changed files only | Server | Push to GitHub → verify only changed entities re-indexed |
| Webhook signature | Invalid signatures rejected (401) | Server | Test webhook route with wrong HMAC signature |
| Cascade re-justification | Callers get updated justifications after callee change | Manual | Modify function → verify callers re-justified |
| Activity feed | Indexing events appear in dashboard | Manual | Push to repo → check activity feed shows event |
| Blue/green vectoring | Zero-downtime embedding updates | Manual | Trigger re-index → verify no search downtime |

**Auto test files:** 10 | **E2E test files:** 1
**What an LLM agent can do:** Run all 10 Auto test files. Cannot trigger real GitHub pushes or verify visual dashboard.

---

### Phase 5.5 — Prompt Ledger, Rewind & Local Ingestion

> **Summary:** Append-only prompt ledger (every AI change tracked with prompt), working snapshots (known-good states), timeline branches (fork after rewind), shadow rewind (blast radius preview), anti-pattern rule synthesis (LLM generates "don't do this" rules after rewind), anti-pattern vectorization (proactive codebase scan), circuit breaker (detects AI hallucination loops), local repo ingestion (CLI upload without GitHub), storage provider (12th port).
>
> **Depends on:** Phase 5

| Area | What to Test | Type | Test File / How |
|------|-------------|------|-----------------|
| Ledger CRUD + state machine | Append, update status, validate transitions | Auto | `lib/adapters/__tests__/ledger.test.ts` |
| Ledger pagination | Cursor-based timeline pagination, filters | Auto | `lib/adapters/__tests__/ledger-pagination.test.ts` |
| Sync with ledger | sync_local_diff creates ledger entry with prompt | Auto | `lib/mcp/tools/__tests__/sync-ledger.test.ts` |
| Shadow rewind | Blast radius calculation, safe/conflicted/at-risk files | Auto | `lib/use-cases/__tests__/shadow-rewind.test.ts` |
| Rewind MCP tool | revert_to_working_state: marks entries reverted, increments branch | Auto | `lib/mcp/tools/__tests__/rewind.test.ts` |
| Working snapshot | mark_working creates snapshot, idempotent | Auto | `lib/mcp/tools/__tests__/snapshot.test.ts` |
| Commit roll-up | Ledger summary from multiple entries | Auto | `lib/mcp/tools/__tests__/rollup.test.ts` |
| Anti-pattern synthesis | Rewind → LLM generates anti-pattern rule | Auto | `lib/temporal/activities/__tests__/anti-pattern.test.ts` |
| Circuit breaker | Trips at 4 broken entries in 10 min, cooldown, manual reset | Auto | `lib/mcp/security/__tests__/circuit-breaker.test.ts` |
| CLI init + push | Init creates config, push creates zip | Auto | `packages/cli/src/__tests__/init-push.test.ts` |
| Rewind E2E cycle | Create entries → mark working → break → rewind → verify | Auto | `lib/mcp/tools/__tests__/rewind-e2e.test.ts` |
| Bootstrap rule | Onboarding rule created from repo analysis | Auto | `lib/onboarding/__tests__/bootstrap-rule.test.ts` |
| Ledger entries in ArangoDB | AI changes tracked with prompts | Manual | Make AI change via MCP → verify ledger entry in ArangoDB |
| Full rewind | Break something → click Rewind → verify restoration | Manual | Dashboard: timeline → click Rewind on entry |
| Anti-pattern rule | Rewind generates rule, rule visible in dashboard | Manual | Rewind → verify rule in rules collection |
| Local repo upload | `unerr push` uploads and indexes local codebase | Manual | CLI: `unerr push` → verify entities appear in ArangoDB |
| `unerr watch` | File watcher detects changes, syncs automatically | Manual | CLI: `unerr watch` → edit files → verify sync |
| Timeline UI | Timeline page shows entries with branch lanes | Manual | Browser: `/repos/{id}/timeline` → verify layout |
| Commits page | AI contribution summaries display correctly | Manual | Browser: `/repos/{id}/commits` → verify summaries |

**Auto test files:** 12
**What an LLM agent can do:** Run all 12 Auto test files. Cannot test real AI interaction, CLI interactive flows, or visual timeline.

---

### Phase 5.6 — CLI-First Zero-Friction Onboarding

> **Summary:** Device authorization flow (RFC 8628), org-level API keys, `unerr connect` command (auto-detects git remote + IDE, writes MCP config), CLI authorize page, ephemeral sandbox mode, self-healing MCP config, dirty state overlay (real-time uncommitted context via Redis), graph-only upload endpoint.
>
> **Depends on:** Phase 5.5 (advanced features), Phase 2 (core CLI)

| Area | What to Test | Type | Test File / How |
|------|-------------|------|-----------------|
| Device code generation | `POST /api/cli/device-code` returns valid codes | Auto | `app/api/cli/__tests__/device-auth-flow.test.ts` |
| Token polling (pending) | Returns `authorization_pending` before approval | Auto | Same test file |
| Token polling (expired) | Returns `expired_token` for unknown codes | Auto | Same test file |
| Token exchange (approved) | Returns `access_token` + auto-provisions default key | Auto | Same test file |
| Default key idempotency | Second exchange returns `key_already_existed=true` | Auto | Same test file |
| Redis cleanup | Device/user code entries deleted after exchange | Auto | Same test file |
| Full flow integration | device-code → pending → approve → token → cleanup | Auto | Same test file |
| Context: no auth | Rejects unauthenticated requests | Auto | Same test file |
| Context: invalid key | Rejects invalid API keys | Auto | Same test file |
| Context: missing remote | Returns 400 for missing param | Auto | Same test file |
| Context: unparseable remote | Returns 400 for bad URL format | Auto | Same test file |
| Context: not found | Returns 404 for unknown repo | Auto | Same test file |
| Context: HTTPS remote | Finds repo by HTTPS URL | Auto | Same test file |
| Context: SSH remote | Finds repo by SSH URL | Auto | Same test file |
| Context: case-insensitive | Matches repos case-insensitively | Auto | Same test file |
| Context: bare domain | Matches `github.com/org/repo` (no protocol) | Auto | Same test file |
| Dirty buffer sync | Entity extraction, Redis storage with TTL | Auto | `lib/mcp/tools/__tests__/dirty-buffer.test.ts` |
| Config healer | Verify, detect drift, auto-repair, silent mode | Auto | `packages/cli/src/__tests__/config-healer.test.ts` |
| Ephemeral sandbox | connect --ephemeral, promote, TTL | Auto | `packages/cli/src/__tests__/ephemeral.test.ts` |
| Local parse fallback | --local-parse flag falls back to zip when binary missing | Auto | `packages/cli/src/__tests__/local-parse.test.ts` |
| Browser authorize page | Shows code, "Authorize CLI" button works | Manual | Open `/cli/authorize?code=XXXX` → click authorize |
| CLI `auth login` | Device flow opens browser, polls, saves creds | Manual | Terminal: `unerr auth login --server http://localhost:3000` |
| CLI `connect` | Full golden path: auth → git detect → IDE config | Manual | Terminal: `unerr connect --server http://localhost:3000` |
| CLI `connect --ephemeral` | Creates ephemeral sandbox with 4h TTL | Manual | Terminal: `unerr connect --ephemeral` → verify TTL repo |
| CLI `unerr promote` | Converts ephemeral → permanent | Manual | `unerr promote` → verify ephemeral flag removed |
| UI connect page | CLI quickstart card shown, manual setup in accordion | Manual | Browser: `/repos/{id}/connect` → verify layout |
| Org-level API key in MCP | Key without repoId works for any repo in org | Manual | Create org key → use with different repos → verify access |
| Self-healing config | Git hooks auto-verify MCP config after checkout | Manual | `git checkout branch` → verify config repaired if broken |

**Auto test files:** 4 (1 file with 20 tests + 3 additional)
**What an LLM agent can do:** Run all automated tests. Cannot test browser approve page, CLI interactive flows, or visual UI layout.

**Test command:** `pnpm test app/api/cli/__tests__/device-auth-flow.test.ts`

---

### Phase 6 — Pattern Enforcement & Rules Engine

> **Summary:** Pattern detection via ast-grep, deterministic rule enforcement via Semgrep, hierarchical rule resolution (workspace > branch > path > repo > org), hybrid evaluation (syntactic + semantic), JIT rule injection, rule health tracking & decay, time-bound exceptions, blast radius simulation, pattern mining via Louvain community detection, LLM-assisted rule compilation, polyglot mapping, auto-remediation, 7 new MCP tools, 5 Temporal workflows, REST API for rules/patterns CRUD.
>
> **Depends on:** Phase 5.6

| Area | What to Test | Type | Test File / How |
|------|-------------|------|-----------------|
| Rule resolver | Hierarchical scope resolution, dedup, priority sort, cap at 50, Redis caching | Auto | `lib/rules/__tests__/resolver.test.ts` |
| Decay score | Weighted formula (40% override, 30% FP, 20% recency, 10% fix), shouldDeprecate | Auto | `lib/rules/__tests__/decay-score.test.ts` |
| Exception ledger | Create/revoke exceptions, isExempt with TTL, entity-specific exemptions | Auto | `lib/rules/__tests__/exception-ledger.test.ts` |
| Health ledger | Counter increments (triggered, overridden, false_positive, auto_fixed) | Auto | `lib/rules/__tests__/health-ledger.test.ts` |
| Hybrid evaluator | Two-pass evaluation (syntactic Semgrep + semantic ArangoDB enrichment) | Auto | `lib/rules/__tests__/hybrid-evaluator.test.ts` |
| JIT injection | Sub-graph traversal, relevance scoring, depth/topK limits | Auto | `lib/rules/__tests__/jit-injection.test.ts` |
| MCP: get_rules | Returns hierarchically resolved rules with scope/type filters | Auto | `lib/mcp/tools/__tests__/rules-tools.test.ts` |
| MCP: check_rules | Runs Semgrep against code, returns violations with fixes | Auto | `lib/mcp/tools/__tests__/rules-tools.test.ts` |
| MCP: get_relevant_rules | Context-aware rule selection by file/entity | Auto | `lib/mcp/tools/__tests__/rules-tools.test.ts` |
| MCP: draft_architecture_rule | LLM generateObject with Zod schema validation | Auto | `lib/mcp/tools/__tests__/rules-tools.test.ts` |
| MCP: check_patterns | ast-grep scan, adherence rates, evidence | Auto | `lib/mcp/tools/__tests__/patterns-tools.test.ts` |
| MCP: get_conventions | Formatted convention guide from rules + patterns | Auto | `lib/mcp/tools/__tests__/patterns-tools.test.ts` |
| MCP: suggest_approach | Context-aware suggestions with rules/patterns/entities | Auto | `lib/mcp/tools/__tests__/patterns-tools.test.ts` |
| REST: rules CRUD | GET/POST `/api/repos/[repoId]/rules`, PATCH/DELETE `.../[ruleId]` | Server | curl against running dev server |
| REST: patterns | GET `/api/repos/[repoId]/patterns`, PATCH `.../[patternId]` | Server | curl against running dev server |
| REST: org rules | GET/POST `/api/settings/rules` | Server | curl against running dev server |
| REST: exceptions | GET/POST `/api/repos/[repoId]/rules/[ruleId]/exceptions` | Server | curl against running dev server |
| REST: promote pattern | POST `/api/repos/[repoId]/rules/from-pattern` | Server | curl against running dev server |
| Pattern detection workflow | 3-step pipeline: astGrepScan → llmSynthesize → storePatterns | Manual | Trigger re-index → verify patterns appear in ArangoDB |
| Rule deprecation workflow | Auto-archives stale rules based on decay scores | Manual | Create rules with poor health → verify auto-deprecation |
| Blast radius simulation | Dry-run new rule against codebase → impact report | Manual | Create staged rule → verify impact report generated |
| Pattern mining | Louvain community detection on entity graph | Manual | Run mine-patterns workflow → verify mined_patterns collection |
| Pattern library UI | `/repos/{id}/patterns` shows adherence, confidence, evidence | Manual | Browser: navigate to patterns page → verify rendering |
| Rules management UI | `/repos/{id}/rules` lists rules with enforcement badges | Manual | Browser: navigate to rules → verify badges, delete button |
| Rule creation form | `/repos/{id}/rules/new` submits all fields correctly | Manual | Browser: create new rule → verify appears in list |
| Org rules UI | `/settings/rules` shows org-wide rules | Manual | Browser: navigate to settings/rules → verify display |
| Semgrep CLI | Semgrep binary available and executes correctly | Manual | `semgrep --version` → verify installed on worker |
| ast-grep detection | ast-grep finds structural patterns across codebase | Manual | Run check_patterns MCP tool → verify pattern matches |

**Auto test files:** 8
**What an LLM agent can do:** Run all 8 Auto test files. Cannot test real Semgrep/ast-grep execution against live codebases, visual UI rendering, or Temporal workflow execution against real infrastructure.

---

### Phase 7 — PR Review Integration

> **Summary:** Automatic PR review via GitHub webhooks. When a PR is opened/synchronized, a four-activity Temporal workflow (`fetchDiff` → `runSemgrep` → `analyzeImpact` → `postReview`) analyzes the diff, computes blast radius via ArangoDB graph traversal, and posts line-level review comments plus a GitHub Check Run. Includes Semantic LGTM auto-approval for low-risk diffs, Auto-ADR generation for significant merges, and ledger merge tracking.
>
> **Depends on:** Phase 6

| Area | What to Test | Type | Test File / How |
|------|-------------|------|-----------------|
| Diff analyzer | Line-in-hunk detection, multi-file diff parsing, entity overlap | Auto | `lib/review/__tests__/diff-analyzer.test.ts` |
| Blast radius | N-hop traversal from changed functions to API boundaries | Auto | `lib/review/__tests__/blast-radius.test.ts` |
| Comment builder | Inline GitHub review comments from findings, severity filtering | Auto | `lib/review/__tests__/comment-builder.test.ts` |
| Check-run builder | GitHub Check Run summary from all finding types, truncation | Auto | `lib/review/__tests__/check-run-builder.test.ts` |
| Semantic LGTM | Low-risk auto-approval gate (HORIZONTAL/UTILITY vs VERTICAL) | Auto | `lib/review/__tests__/semantic-lgtm.test.ts` |
| ADR schema | Zod validation, markdown rendering, filename formatting | Auto | `lib/review/__tests__/adr-schema.test.ts` |
| Complexity check | Cyclomatic complexity detection in changed entities | Auto | `lib/review/checks/__tests__/complexity-check.test.ts` |
| Impact check | Changed entity impact scoring via graph traversal | Auto | `lib/review/checks/__tests__/impact-check.test.ts` |
| Test check | Test coverage detection for changed functions | Auto | `lib/review/checks/__tests__/test-check.test.ts` |
| Webhook handler | PR opened/synchronized triggers review workflow, draft/closed skip | Auto | `lib/github/webhook-handlers/__tests__/pull-request.test.ts` |
| Review activities | fetchDiff, runSemgrep, analyzeImpact, postReview Temporal activities | Auto | `lib/temporal/activities/__tests__/review.test.ts` |
| ADR generation | assessMergeSignificance + generateAdr activities | Auto | `lib/temporal/activities/__tests__/adr-generation.test.ts` |
| Ledger merge | fetchLedgerEntries, reparentLedgerEntries, createMergeNode | Auto | `lib/temporal/activities/__tests__/ledger-merge.test.ts` |
| Review MCP tool | handleReviewPrStatus — "Why did unerr block PR #42?" | Auto | `lib/mcp/tools/__tests__/review.test.ts` |
| Summarizer | LLM narrative synthesis for merge summaries | Auto | `lib/use-cases/__tests__/summarizer.test.ts` |
| REST: reviews CRUD | GET/POST `/api/repos/[repoId]/reviews`, GET `.../[reviewId]` | Server | curl against running dev server |
| REST: review retry | POST `/api/repos/[repoId]/reviews/[reviewId]/retry` | Server | curl against running dev server |
| REST: review settings | GET/PATCH `/api/repos/[repoId]/settings/review` | Server | curl against running dev server |
| REST: merge history | GET `/api/repos/[repoId]/history` | Server | curl against running dev server |
| PR review end-to-end | Open PR → unerr posts review comments + Check Run | Manual | Open PR on connected repo → verify review posted |
| Semantic LGTM | Low-risk PR auto-approved without review | Manual | Open trivial-change PR → verify auto-approval |
| Auto-ADR | Merge significant PR → ADR generated in repo | Manual | Merge large PR → verify ADR commit |
| Review UI | `/repos/{id}/reviews` lists reviews with status badges | Manual | Browser: navigate to reviews page → verify rendering |
| Review detail UI | `/repos/{id}/reviews/{reviewId}` shows findings + comments | Manual | Browser: navigate to review detail → verify layout |

**Auto test files:** 15
**What an LLM agent can do:** Run all 15 Auto test files. Cannot test real GitHub webhook delivery, PR review posting, or visual UI rendering.

---

### Phase 10a — Local-First Intelligence Proxy (MVP)

> **Summary:** Ships a CLI (`@autorail/unerr`) that serves a local MCP server backed by an embedded CozoDB database. 7 of 9 structural tools resolve in <5ms from a local graph snapshot with no network round-trip. `unerr pull` downloads a msgpack snapshot from cloud, `unerr serve` starts the local MCP proxy. 2 tools (`sync_local_diff`, `semantic_search`) proxy transparently to the cloud.
>
> **Depends on:** Phase 2

| Area | What to Test | Type | Test File / How |
|------|-------------|------|-----------------|
| CozoDB adapter | Point lookup, N-hop traversal, health check | Auto | `packages/cli/src/__tests__/local-graph.test.ts` |
| Query router | Local dispatch, cloud dispatch, fallback, `_meta.source` | Auto | `packages/cli/src/__tests__/query-router.test.ts` |
| Graph compactor | Body truncation, `_id` stripping, edge compaction | Auto | `lib/use-cases/__tests__/graph-compactor.test.ts` |
| Graph serializer | Msgpack serialize/deserialize round-trip, version field | Auto | `lib/use-cases/__tests__/graph-serializer.test.ts` |
| Graph export activity | `queryCompactGraph`, `serializeToMsgpack` v1 | Auto | `lib/temporal/activities/__tests__/graph-export.test.ts` |
| Search index | Tokenizer (camelCase, snake_case, kebab-case splitting) | Auto | `packages/cli/src/__tests__/search-index.test.ts` |
| Checksum | SHA-256 computation, determinism, tamper detection | Auto | `packages/cli/src/__tests__/checksum.test.ts` |
| REST: snapshot list | `GET /api/graph-snapshots` → repos with snapshot metadata | Server | curl against running dev server |
| REST: snapshot download | `GET /api/graph-snapshots/[repoId]/download` → pre-signed URL | Server | curl against running dev server |
| REST: snapshot sync | `POST /api/graph-snapshots/[repoId]/sync` → triggers workflow | Server | curl against running dev server |
| `unerr pull` | Download msgpack → verify SHA-256 → bulk-load CozoDB | Manual | Terminal: `unerr pull --repo org/repo` → verify entities loaded |
| `unerr serve` | Local MCP server starts, tools respond via stdio | Manual | Terminal: `unerr serve` → verify tools respond in IDE |
| Latency comparison | Local <5ms vs cloud ~200-300ms for same query | Manual | Measure `get_function` latency local vs cloud |
| Dashboard snapshot status | Badge shows "available"/"generating", "Sync Now" button | Manual | Browser: `/repos/{id}` → verify snapshot status |

**Auto test files:** 7
**What an LLM agent can do:** Run all 7 Auto test files. Cannot test real CLI interactive flows, IDE MCP integration, or latency measurement.

---

### Phase 10b — Local-First Intelligence Proxy (Full)

> **Summary:** Extends Phase 10a CLI with local rule evaluation and predictive pre-fetching. Adds `get_rules` and `check_rules` to local routing (9 local tools, up from 7), syncs rules/patterns in v2 snapshot envelopes, provides tree-sitter-based structural rule evaluation in the CLI, and adds a `POST /api/prefetch` endpoint for predictive context pre-warming.
>
> **Depends on:** Phase 10a, Phase 6

| Area | What to Test | Type | Test File / How |
|------|-------------|------|-----------------|
| CozoDB rules/patterns | Insert, query, v2 envelope loading, glob filtering | Auto | `packages/cli/src/__tests__/local-graph.test.ts` (extended) |
| Rule evaluator — naming | Regex matching against entity names from CozoDB | Auto | `packages/cli/src/__tests__/rule-evaluator.test.ts` |
| Rule evaluator — structural | Tree-sitter AST matching, graceful degradation | Auto | `packages/cli/src/__tests__/rule-evaluator.test.ts` |
| Rule evaluator — partitioning | Semgrep/LLM rules skipped, `_meta.skippedRules` annotated | Auto | `packages/cli/src/__tests__/rule-evaluator.test.ts` |
| Pre-fetch debounce | 500ms debounce, 2/s rate limit, error silencing | Auto | `packages/cli/src/__tests__/prefetch.test.ts` |
| Snapshot v2 envelope | v2 with rules+patterns, v2 with empty arrays, v1 compat | Auto | `packages/cli/src/__tests__/snapshot-v2.test.ts` |
| Extended routing table | `get_rules`/`check_rules` → local, cloud fallback when empty | Auto | `packages/cli/src/__tests__/query-router.test.ts` (extended) |
| Pre-fetch context use case | N-hop BFS expansion, Redis caching, deduplication | Auto | `lib/use-cases/__tests__/prefetch-context.test.ts` |
| Pre-fetch cache hit | `semantic_search` returns cached results with `_meta.source: "cloud_prefetched"` | Auto | `lib/mcp/tools/__tests__/prefetch-cache.test.ts` |
| v2 graph export | Rules/patterns compact export, enforcement→severity mapping | Auto | `lib/temporal/activities/__tests__/graph-export-v2.test.ts` |
| REST: prefetch | `POST /api/prefetch` → context expansion → Redis cache | Server | curl against running dev server |
| Local rule check latency | `get_rules` <5ms local vs ~200ms cloud | Manual | Measure latency with v2 snapshot loaded |
| Pre-fetch verification | `unerr serve --prefetch` → Redis populated → faster cloud response | Manual | Start serve → navigate → check Redis → verify speedup |
| v2 pull | `unerr pull` with v2 snapshot → rules/patterns loaded | Manual | Terminal: verify rule/pattern counts in pull output |
| Rules synced indicator | Repo page shows "v2 · X rules" badge | Manual | Browser: `/repos/{id}` → verify badge |

**Auto test files:** 8 (7 new files + 1 extended)
**What an LLM agent can do:** Run all 8 Auto test files. Cannot test real CLI MCP integration, latency measurement, or visual UI badges.

---

## Automation Summary

| Phase | Auto Tests | E2E Tests | Manual Tests | Auto Coverage |
|-------|-----------|-----------|-------------|---------------|
| 0 — Foundation | 3 files | — | 4 checks | ~60% |
| 1 — Indexing | 10 files | 5 specs | 3 checks | ~80% |
| 2 — MCP Server | 6 files | — | 3 checks | ~75% |
| 3 — Semantic Search | 3 files | — | 2 checks | ~60% |
| 4 — Taxonomy | 13 files | 3 specs | 3 checks | ~80% |
| 5 — Incremental | 10 files | 1 spec | 4 checks | ~70% |
| 5.5 — Ledger/Rewind | 12 files | — | 6 checks | ~65% |
| 5.6 — CLI Onboarding | 4 files | — | 7 checks | ~60% |
| 6 — Rules Engine | 8 files | — | 10 checks | ~65% |
| 7 — PR Review | 15 files | — | 5 checks | ~75% |
| 10a — Local Proxy MVP | 7 files | — | 4 checks | ~65% |
| 10b — Local Proxy Full | 8 files | — | 4 checks | ~70% |
| **Total (through 10b)** | **99 files** | **9 specs** | **55 checks** | **~70%** |

---

## Running All Automated Tests

```bash
# All tests
pnpm test

# By phase area
pnpm test lib/di/                              # Phase 0: DI container
pnpm test lib/indexer/ lib/temporal/activities/  # Phase 1: Indexing pipeline
pnpm test lib/mcp/                              # Phase 2: MCP server + Phase 5.5 tools
pnpm test lib/embeddings/                       # Phase 3: Semantic search
pnpm test lib/justification/                     # Phase 4: Justification engine
pnpm test lib/temporal/workflows/                # Phase 4+: Workflow orchestration
pnpm test lib/adapters/                          # Phase 4+: Adapter tests
pnpm test lib/indexer/__tests__/incremental      # Phase 5: Incremental indexing
pnpm test lib/indexer/__tests__/cascade          # Phase 5: Cascade re-justification
pnpm test lib/indexer/__tests__/ast-comparator   # Phase 5: AST comparator
pnpm test lib/indexer/__tests__/centrality       # Phase 5: Centrality scoring
pnpm test lib/indexer/__tests__/edge-repair      # Phase 5: Edge repair
pnpm test lib/indexer/__tests__/signal-debounce  # Phase 5: Signal debouncing
pnpm test lib/adapters/__tests__/ledger          # Phase 5.5: Ledger CRUD
pnpm test lib/mcp/tools/__tests__/rewind         # Phase 5.5: Rewind tool
pnpm test lib/mcp/security/__tests__/circuit     # Phase 5.5: Circuit breaker
pnpm test lib/use-cases/__tests__/shadow-rewind  # Phase 5.5: Shadow rewind
pnpm test app/api/cli/                           # Phase 5.6: CLI onboarding
pnpm test packages/cli/                          # Phase 5.6 + 10a + 10b: CLI commands
pnpm test lib/rules/                             # Phase 6: Rule resolver, decay, exceptions, health, hybrid, JIT
pnpm test lib/mcp/tools/__tests__/rules-tools    # Phase 6: Rule MCP tools
pnpm test lib/mcp/tools/__tests__/patterns-tools # Phase 6: Pattern MCP tools
pnpm test lib/review/                            # Phase 7: PR review pipeline
pnpm test lib/review/checks/                     # Phase 7: Review check modules
pnpm test lib/github/webhook-handlers/           # Phase 7: PR webhook handler
pnpm test lib/temporal/activities/__tests__/review           # Phase 7: Review activities
pnpm test lib/temporal/activities/__tests__/adr-generation   # Phase 7: ADR generation
pnpm test lib/temporal/activities/__tests__/ledger-merge     # Phase 7: Ledger merge
pnpm test lib/mcp/tools/__tests__/review         # Phase 7: Review MCP tool
pnpm test lib/use-cases/__tests__/summarizer     # Phase 7: Merge summarizer
pnpm test lib/use-cases/__tests__/graph-compactor            # Phase 10a: Graph compactor
pnpm test lib/use-cases/__tests__/graph-serializer           # Phase 10a: Graph serializer
pnpm test lib/temporal/activities/__tests__/graph-export     # Phase 10a: Graph export
pnpm test lib/use-cases/__tests__/prefetch-context           # Phase 10b: Pre-fetch context
pnpm test lib/mcp/tools/__tests__/prefetch-cache             # Phase 10b: Pre-fetch cache hit
pnpm test lib/temporal/activities/__tests__/graph-export-v2  # Phase 10b: v2 graph export

# Integration tests (require running infra)
pnpm test lib/adapters/arango-graph-store.integration.test.ts

# E2E tests (require running dev server)
pnpm e2e:headless
```

---

## Complete Test File Inventory

### Phase 0 — Foundation
| File | Tests | Area |
|------|-------|------|
| `lib/di/__tests__/container.test.ts` | DI container resolution, overrides | Container |
| `lib/di/__tests__/port-compliance.test.ts` | All 12 fakes implement port interfaces | Ports |
| `app/api/__tests__/health.test.ts` | Health endpoint response | API |

### Phase 1 — Indexing
| File | Tests | Area |
|------|-------|------|
| `lib/indexer/languages/typescript/__tests__/tree-sitter.test.ts` | TS entity extraction | Parser |
| `lib/indexer/languages/python/__tests__/tree-sitter.test.ts` | Python entity extraction | Parser |
| `lib/indexer/languages/go/__tests__/tree-sitter.test.ts` | Go entity extraction | Parser |
| `lib/indexer/__tests__/entity-hash.test.ts` | Deterministic hashing | Indexer |
| `lib/indexer/__tests__/scanner.test.ts` | File scanning, ignores | Indexer |
| `lib/indexer/__tests__/monorepo.test.ts` | Workspace root detection | Indexer |
| `lib/temporal/activities/__tests__/indexing-activities.test.ts` | Heavy activities | Temporal |
| `lib/temporal/activities/__tests__/indexing-light.test.ts` | Light activities | Temporal |
| `lib/temporal/workflows/__tests__/index-repo-workflow.test.ts` | Workflow orchestration | Temporal |
| `lib/utils/file-tree-builder.test.ts` | File tree from paths | Utility |

### Phase 2 — MCP Server
| File | Tests | Area |
|------|-------|------|
| `lib/mcp/__tests__/auth.test.ts` | JWT + API key auth | Auth |
| `lib/mcp/tools/__tests__/tools.test.ts` | 20 tool schemas + dispatch | Tools |
| `lib/mcp/tools/__tests__/semantic.test.ts` | Semantic search tools | Tools |
| `lib/mcp/security/__tests__/scrubber.test.ts` | Secret/PII stripping | Security |
| `lib/mcp/security/__tests__/rate-limiter.test.ts` | Rate limiting | Security |
| `lib/mcp/__tests__/formatter.test.ts` | Response formatting | Format |

### Phase 3 — Semantic Search
| File | Tests | Area |
|------|-------|------|
| `lib/embeddings/__tests__/hybrid-search.test.ts` | Keyword + semantic fusion | Search |
| `lib/temporal/activities/__tests__/embedding.test.ts` | Embedding generation | Temporal |
| `lib/adapters/__tests__/vercel-ai-provider.test.ts` | LLM adapter | Adapter |

### Phase 4 — Business Justification
| File | Tests | Area |
|------|-------|------|
| `lib/justification/__tests__/schemas.test.ts` | Zod validation schemas | Schema |
| `lib/justification/__tests__/model-router.test.ts` | LLM tier selection | Router |
| `lib/justification/__tests__/graph-context-builder.test.ts` | Entity context for LLM | Context |
| `lib/justification/__tests__/topological-sort.test.ts` | Dependency ordering | Sort |
| `lib/justification/__tests__/prompt-builder.test.ts` | LLM prompt construction | Prompt |
| `lib/justification/__tests__/post-processor.test.ts` | LLM output normalization | Post |
| `lib/justification/__tests__/drift-detector.test.ts` | Semantic drift detection | Drift |
| `lib/justification/__tests__/feature-aggregator.test.ts` | Feature tag grouping | Feature |
| `lib/justification/__tests__/health-report-builder.test.ts` | Health report generation | Report |
| `lib/justification/__tests__/ontology-extractor.test.ts` | Domain ontology extraction | Ontology |
| `lib/temporal/activities/__tests__/justification.test.ts` | Justification activity | Temporal |
| `lib/temporal/workflows/__tests__/justify-entity.test.ts` | Justify workflow | Temporal |
| `lib/mcp/tools/__tests__/business.test.ts` | Business MCP tools | Tools |

### Phase 5 — Incremental Indexing
| File | Tests | Area |
|------|-------|------|
| `lib/indexer/__tests__/incremental.test.ts` | Entity diff engine | Diff |
| `lib/indexer/__tests__/ast-comparator.test.ts` | Whitespace/comment filtering | AST |
| `lib/indexer/__tests__/centrality.test.ts` | Hub node detection | Graph |
| `lib/indexer/__tests__/edge-repair.test.ts` | Broken edge detection/repair | Graph |
| `lib/indexer/__tests__/semantic-fingerprint.test.ts` | Rename detection via AST hash | Hash |
| `lib/indexer/__tests__/quarantine.test.ts` | Unparseable file handling | Safety |
| `lib/indexer/__tests__/cascade.test.ts` | Cascade re-justification | Cascade |
| `lib/indexer/__tests__/branch-overlay.test.ts` | Branch shadow graph | Branch |
| `lib/indexer/__tests__/signal-debounce.test.ts` | Push signal coalescing | Debounce |
| `lib/indexer/__tests__/prompt-detector.test.ts` | AI repetition detection | Drift |
| `lib/mcp/tools/__tests__/changes.test.ts` | get_recent_changes tool | Tools |

### Phase 5.5 — Prompt Ledger & Rewind
| File | Tests | Area |
|------|-------|------|
| `lib/adapters/__tests__/ledger.test.ts` | Ledger CRUD + state machine | Adapter |
| `lib/adapters/__tests__/ledger-pagination.test.ts` | Timeline cursor pagination | Adapter |
| `lib/mcp/tools/__tests__/sync-ledger.test.ts` | Sync creates ledger entry | Tools |
| `lib/use-cases/__tests__/shadow-rewind.test.ts` | Blast radius calculation | Use case |
| `lib/mcp/tools/__tests__/rewind.test.ts` | Rewind MCP tool | Tools |
| `lib/mcp/tools/__tests__/snapshot.test.ts` | Working snapshot creation | Tools |
| `lib/mcp/tools/__tests__/rollup.test.ts` | Commit roll-up summary | Tools |
| `lib/temporal/activities/__tests__/anti-pattern.test.ts` | Rule synthesis activity | Temporal |
| `lib/mcp/security/__tests__/circuit-breaker.test.ts` | Hallucination loop detection | Security |
| `packages/cli/src/__tests__/init-push.test.ts` | CLI init + push | CLI |
| `lib/mcp/tools/__tests__/rewind-e2e.test.ts` | Full rewind cycle | E2E |
| `lib/onboarding/__tests__/bootstrap-rule.test.ts` | Bootstrap rule generation | Onboard |

### Phase 5.6 — CLI Onboarding
| File | Tests | Area |
|------|-------|------|
| `app/api/cli/__tests__/device-auth-flow.test.ts` | Device auth flow (20 tests) | Auth |
| `lib/mcp/tools/__tests__/dirty-buffer.test.ts` | Dirty state overlay | Tools |
| `packages/cli/src/__tests__/config-healer.test.ts` | MCP config self-healing | CLI |
| `packages/cli/src/__tests__/ephemeral.test.ts` | Ephemeral sandbox mode | CLI |
| `packages/cli/src/__tests__/local-parse.test.ts` | Local AST parse fallback | CLI |

### Phase 6 — Pattern Enforcement & Rules Engine
| File | Tests | Area |
|------|-------|------|
| `lib/rules/__tests__/resolver.test.ts` | Hierarchical scope resolution, dedup, cap | Resolver |
| `lib/rules/__tests__/decay-score.test.ts` | Decay formula, shouldDeprecate | Health |
| `lib/rules/__tests__/exception-ledger.test.ts` | Create/revoke exceptions, isExempt | Exceptions |
| `lib/rules/__tests__/health-ledger.test.ts` | Counter increments, health tracking | Health |
| `lib/rules/__tests__/hybrid-evaluator.test.ts` | Two-pass syntactic + semantic evaluation | Evaluator |
| `lib/rules/__tests__/jit-injection.test.ts` | Sub-graph traversal, relevance scoring | JIT |
| `lib/mcp/tools/__tests__/rules-tools.test.ts` | get_rules, check_rules, get_relevant_rules, draft_architecture_rule | Tools |
| `lib/mcp/tools/__tests__/patterns-tools.test.ts` | check_patterns, get_conventions, suggest_approach | Tools |

### Phase 7 — PR Review Integration
| File | Tests | Area |
|------|-------|------|
| `lib/review/__tests__/diff-analyzer.test.ts` | Line-in-hunk detection, multi-file diffs | Diff |
| `lib/review/__tests__/blast-radius.test.ts` | N-hop traversal to API boundaries | Graph |
| `lib/review/__tests__/comment-builder.test.ts` | Inline review comments, severity filtering | Builder |
| `lib/review/__tests__/check-run-builder.test.ts` | Check Run summary, truncation | Builder |
| `lib/review/__tests__/semantic-lgtm.test.ts` | Low-risk auto-approval gate | LGTM |
| `lib/review/__tests__/adr-schema.test.ts` | ADR Zod schema, markdown rendering | Schema |
| `lib/review/checks/__tests__/complexity-check.test.ts` | Cyclomatic complexity detection | Check |
| `lib/review/checks/__tests__/impact-check.test.ts` | Entity impact scoring | Check |
| `lib/review/checks/__tests__/test-check.test.ts` | Test coverage detection | Check |
| `lib/github/webhook-handlers/__tests__/pull-request.test.ts` | PR webhook → review workflow trigger | Webhook |
| `lib/temporal/activities/__tests__/review.test.ts` | fetchDiff, runSemgrep, analyzeImpact, postReview | Temporal |
| `lib/temporal/activities/__tests__/adr-generation.test.ts` | Merge significance + ADR generation | Temporal |
| `lib/temporal/activities/__tests__/ledger-merge.test.ts` | Ledger reparenting + merge node creation | Temporal |
| `lib/mcp/tools/__tests__/review.test.ts` | handleReviewPrStatus MCP tool | Tools |
| `lib/use-cases/__tests__/summarizer.test.ts` | LLM narrative synthesis for merge summaries | Use case |

### Phase 10a — Local-First Proxy (MVP)
| File | Tests | Area |
|------|-------|------|
| `packages/cli/src/__tests__/search-index.test.ts` | Tokenizer (camelCase, snake_case splitting) | Search |
| `packages/cli/src/__tests__/checksum.test.ts` | SHA-256 computation, tamper detection | Integrity |
| `packages/cli/src/__tests__/query-router.test.ts` | Local/cloud dispatch, fallback, `_meta.source` | Router |
| `lib/temporal/activities/__tests__/graph-export.test.ts` | queryCompactGraph, serializeToMsgpack v1 | Temporal |
| `lib/use-cases/__tests__/graph-compactor.test.ts` | Body truncation, `_id` stripping | Compactor |
| `lib/use-cases/__tests__/graph-serializer.test.ts` | Msgpack round-trip, version field, checksum | Serializer |
| `packages/cli/src/__tests__/local-graph.test.ts` | CozoDB point lookup, N-hop traversal | CozoDB |

### Phase 10b — Local-First Proxy (Full)
| File | Tests | Area |
|------|-------|------|
| `packages/cli/src/__tests__/local-graph.test.ts` | Rules/patterns CRUD, v2 envelope loading (extended) | CozoDB |
| `packages/cli/src/__tests__/rule-evaluator.test.ts` | Naming regex, structural tree-sitter, engine partitioning | Evaluator |
| `packages/cli/src/__tests__/prefetch.test.ts` | Debounce, rate limit, error silencing | Pre-fetch |
| `packages/cli/src/__tests__/snapshot-v2.test.ts` | v2 envelope schema, v1 backward compat | Snapshot |
| `packages/cli/src/__tests__/query-router.test.ts` | get_rules/check_rules routing, cloud fallback (extended) | Router |
| `lib/use-cases/__tests__/prefetch-context.test.ts` | N-hop BFS expansion, Redis caching | Use case |
| `lib/mcp/tools/__tests__/prefetch-cache.test.ts` | Prefetch cache hit/miss in semantic_search | Tools |
| `lib/temporal/activities/__tests__/graph-export-v2.test.ts` | Rules/patterns export, enforcement→severity mapping | Temporal |

### E2E Tests (Playwright)
| File | Tests | Phase |
|------|-------|-------|
| `e2e/auth-flows.spec.ts` | Auth signup/login flows | 1 |
| `e2e/health.spec.ts` | Health page | 1 |
| `e2e/github-connect.spec.ts` | GitHub connection | 1 |
| `e2e/repo-indexing.spec.ts` | Indexing progress | 1 |
| `e2e/repo-browse.spec.ts` | File tree browsing | 1 |
| `e2e/entity-detail.spec.ts` | Entity detail + justification | 4 |
| `e2e/blueprint.spec.ts` | Blueprint visualization | 4 |
| `e2e/health-report.spec.ts` | Health report display | 4 |
| `e2e/activity-feed.spec.ts` | Activity feed | 5 |

### Integration Tests (require running infra)
| File | Tests | Requires |
|------|-------|----------|
| `lib/adapters/arango-graph-store.integration.test.ts` | ArangoDB CRUD | ArangoDB |

---

## Manual Testing Checklist

Use this when preparing a release or after major changes.

### Pre-requisites
```bash
docker compose up -d    # Start infra (Redis, ArangoDB, Temporal, PostgreSQL)
pnpm migrate            # Run migrations
pnpm dev                # Start dev server
```

### Critical Path (must pass before merge)

- [ ] **Auth**: Register → login → see dashboard
- [ ] **GitHub**: Connect GitHub → select repo → indexing starts → completes
- [ ] **MCP (Cursor)**: Paste API key config → agent can search code
- [ ] **MCP (Claude Code)**: `claude mcp add` → OAuth → agent can search code
- [ ] **CLI auth**: `unerr auth login` → browser opens → code shown → authorize → CLI saves key
- [ ] **CLI connect**: `unerr connect` → detects repo → writes MCP config
- [ ] **Connect page**: `/repos/{id}/connect` → CLI quickstart visible → manual accordion works
- [ ] **Incremental**: Push to GitHub → only changed entities re-indexed within 30s
- [ ] **Timeline**: `/repos/{id}/timeline` → shows ledger entries with status colors
- [ ] **Rewind**: Break something via AI → Rewind → files restored

### Secondary (should pass, non-blocking)

- [ ] **Rules**: `/repos/{id}/rules` → list rules with enforcement badges, create/delete works
- [ ] **Patterns**: `/repos/{id}/patterns` → shows detected patterns with adherence rates
- [ ] **Rule creation**: `/repos/{id}/rules/new` → form submits, rule appears in list
- [ ] **Org rules**: `/settings/rules` → org-level rules display
- [ ] **MCP get_rules**: Returns hierarchically resolved rules
- [ ] **MCP check_rules**: Runs Semgrep against code, returns violations
- [ ] **MCP check_patterns**: Detects patterns via ast-grep
- [ ] **MCP get_conventions**: Returns formatted convention guide
- [ ] **Search**: MCP `search_code` returns relevant results
- [ ] **Semantic**: "Functions that handle auth" returns auth code
- [ ] **Rate limiting**: Rapid API calls get rate-limited
- [ ] **API key revoke**: Revoked key returns 401
- [ ] **Blueprint**: `/repos/{id}/blueprint` → swimlane visualization
- [ ] **Health report**: `/repos/{id}/health` → risk summary
- [ ] **Activity feed**: `/repos/{id}/activity` → index events displayed
- [ ] **CLI push**: `unerr push` → local repo indexed
- [ ] **CLI watch**: `unerr watch` → file changes auto-synced
- [ ] **Ephemeral**: `unerr connect --ephemeral` → sandbox with TTL
- [ ] **Promote**: `unerr promote` → ephemeral becomes permanent
- [ ] **Circuit breaker**: 4+ broken AI changes → agent halted
- [ ] **Local proxy**: `unerr pull && unerr serve` → tools resolve locally
- [ ] **PR review**: Open PR on connected repo → unerr posts review comments + Check Run
- [ ] **Semantic LGTM**: Open trivial-change PR → auto-approved without review
- [ ] **Auto-ADR**: Merge significant PR → ADR generated
- [ ] **Reviews UI**: `/repos/{id}/reviews` → list reviews with status badges
- [ ] **Review detail UI**: `/repos/{id}/reviews/{reviewId}` → findings + comments
- [ ] **Local rules**: `unerr pull` v2 → `get_rules` resolves locally in <5ms
- [ ] **Local check_rules**: Structural/naming rules evaluated locally, Semgrep skipped with `_meta`
- [ ] **Pre-fetch**: `unerr serve --prefetch` → Redis populated → semantic_search faster
- [ ] **v2 snapshot**: Repo page shows "v2 · X rules" badge after pull

---

## Writing New Tests

### Pattern: Testing a Route Handler

```typescript
import { describe, expect, it, vi } from "vitest"
import { createTestContainer } from "@/lib/di/container"
import type { Container } from "@/lib/di/container"

let testContainer: Container

vi.mock("@/lib/di/container", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/di/container")>()
  return {
    ...original,
    getContainer: () => testContainer,
  }
})

const { GET } = await import("../route")

describe("GET /api/my-endpoint", () => {
  beforeEach(() => {
    testContainer = createTestContainer()
  })

  it("returns 200 with expected data", async () => {
    // Seed test data into fakes
    await testContainer.relationalStore.createRepo({ ... })

    const req = new Request("http://localhost/api/my-endpoint?param=value")
    const res = await GET(req)
    expect(res.status).toBe(200)

    const data = (await res.json()) as { ... }
    expect(data.field).toBe("expected")
  })
})
```

### Pattern: Testing with Auth

```typescript
// Seed API key into cache for authenticated endpoints
const rawKey = "unerr_sk_test_key"
const { hashApiKey } = await import("@/lib/mcp/auth")
const keyHash = hashApiKey(rawKey)

await testContainer.cacheStore.set(`mcp:apikey:${keyHash}`, {
  id: "key-1",
  orgId: "org-1",
  repoId: null,
  scopes: ["mcp:read"],
}, 300)

const req = new Request("http://localhost/api/endpoint", {
  headers: { Authorization: `Bearer ${rawKey}` },
})
```

### Pattern: Testing Temporal Activities

```typescript
vi.mock("@temporalio/activity", () => ({
  heartbeat: vi.fn(),
}))

vi.mock("@/lib/di/container", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/di/container")>()
  let testContainer: Container | null = null
  return {
    ...original,
    getContainer: () => testContainer ?? original.createTestContainer(),
    __setTestContainer: (c: Container) => { testContainer = c },
    __resetTestContainer: () => { testContainer = null },
  }
})
```

### Pattern: Testing MCP Tools

```typescript
import { createTestContainer } from "@/lib/di/container"

const ctx = {
  orgId: "org-1",
  userId: "user-1",
  repoId: "repo-1",
  scopes: ["mcp:read", "mcp:sync"],
}

const container = createTestContainer()

// Seed test data
await container.graphStore.bulkUpsertEntities("org-1", [
  { id: "ent-1", org_id: "org-1", repo_id: "repo-1", kind: "function", name: "doStuff", file_path: "src/main.ts" },
])

// Call tool handler
const result = await handleSearchCode({ query: "doStuff" }, ctx, container)
expect(result.isError).toBeFalsy()
```

---

## Live Server Smoke Tests

These curl commands test endpoints against a running dev server (`pnpm dev` on `localhost:3000`).
Run these after any infrastructure, auth, or API changes to validate the server is working.

**Prerequisites:**
```bash
docker compose up -d
pnpm migrate
pnpm dev   # in a separate terminal
```

### Phase 0 — Foundation

```bash
# Health: all 5 infra services should report "up"
curl -s http://localhost:3000/api/health | python3 -m json.tool

# Proxy: protected routes redirect to /login (307)
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/repos       # → 307
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/settings    # → 307

# Proxy: public routes serve directly (200)
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/login       # → 200
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/register    # → 200
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health  # → 200

# Auth: sign-in with bad credentials → 401
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/auth/sign-in/email \
  -H "Content-Type: application/json" -d '{"email":"bad@x.com","password":"wrong"}'  # → 401
```

### Phase 5.6 — Device Auth Flow

```bash
# 1. Generate device code
curl -s -X POST http://localhost:3000/api/cli/device-code | python3 -m json.tool
# Expected: { device_code, user_code (XXXX-XXXX), verification_uri, expires_in: 600, interval: 5 }

# 2. Poll before approval → authorization_pending
curl -s -X POST http://localhost:3000/api/cli/token \
  -H "Content-Type: application/json" \
  -d '{"device_code":"<FROM_STEP_1>","grant_type":"urn:ietf:params:oauth:grant-type:device_code"}'
# Expected: {"error":"authorization_pending"}

# 3. Error cases
curl -s -X POST http://localhost:3000/api/cli/token \
  -H "Content-Type: application/json" \
  -d '{"device_code":"fake","grant_type":"urn:ietf:params:oauth:grant-type:device_code"}'
# Expected: {"error":"expired_token"}

curl -s -X POST http://localhost:3000/api/cli/token \
  -H "Content-Type: application/json" \
  -d '{"device_code":"x","grant_type":"authorization_code"}'
# Expected: {"error":"unsupported_grant_type"}

curl -s -X POST http://localhost:3000/api/cli/token \
  -H "Content-Type: application/json" \
  -d '{"grant_type":"urn:ietf:params:oauth:grant-type:device_code"}'
# Expected: {"error":"invalid_request","error_description":"device_code is required"}

# 4. (Manual) Open browser: http://localhost:3000/cli/authorize?code=<USER_CODE>
#    Click "Authorize CLI"

# 5. Poll after approval → access_token
curl -s -X POST http://localhost:3000/api/cli/token \
  -H "Content-Type: application/json" \
  -d '{"device_code":"<FROM_STEP_1>","grant_type":"urn:ietf:params:oauth:grant-type:device_code"}'
# Expected: { access_token: "unerr_sk_...", org_id, org_name, key_already_existed: false }
```

### Phase 5.6 — Context Endpoint

Requires a valid API key (from device flow or dashboard).

```bash
API_KEY="unerr_sk_<your_key>"

# Auth enforcement
curl -s "http://localhost:3000/api/cli/context?remote=github.com/org/repo"
# Expected: {"error":"Missing or invalid Authorization header"}

curl -s "http://localhost:3000/api/cli/context?remote=github.com/org/repo" \
  -H "Authorization: Bearer unerr_sk_invalid"
# Expected: {"error":"Invalid API key"}

# Validation
curl -s "http://localhost:3000/api/cli/context" \
  -H "Authorization: Bearer $API_KEY"
# Expected: {"error":"remote query parameter is required"}

curl -s "http://localhost:3000/api/cli/context?remote=not-a-url" \
  -H "Authorization: Bearer $API_KEY"
# Expected: {"error":"Could not parse remote URL"}

# Repo lookup
curl -s "http://localhost:3000/api/cli/context?remote=https://github.com/nobody/nonexistent.git" \
  -H "Authorization: Bearer $API_KEY"
# Expected: {"error":"Repository not found"} (404)

# Replace with a repo that exists in your org:
curl -s "http://localhost:3000/api/cli/context?remote=https://github.com/YourOrg/your-repo.git" \
  -H "Authorization: Bearer $API_KEY"
# Expected: { repoId, repoName, status: "ready", indexed: true, defaultBranch }

# Verify all remote formats resolve to the same repo:
curl -s "http://localhost:3000/api/cli/context?remote=git@github.com:YourOrg/your-repo.git" \
  -H "Authorization: Bearer $API_KEY"
curl -s "http://localhost:3000/api/cli/context?remote=github.com/YourOrg/your-repo" \
  -H "Authorization: Bearer $API_KEY"
# Both should return the same repoId
```

### Phase 6 — Rules & Patterns API

Requires a valid API key and a connected repo.

```bash
API_KEY="unerr_sk_<your_key>"
REPO_ID="<your_repo_id>"

# List rules (should return empty or existing rules)
curl -s "http://localhost:3000/api/repos/$REPO_ID/rules" \
  -H "Authorization: Bearer $API_KEY" | python3 -m json.tool

# Create a rule
curl -s -X POST "http://localhost:3000/api/repos/$REPO_ID/rules" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "No console.log",
    "description": "Avoid console.log in production code",
    "type": "style",
    "scope": "repo",
    "enforcement": "warn",
    "priority": 50
  }' | python3 -m json.tool
# Expected: { success: true, data: { rule: { id, title, ... } } }

# List patterns
curl -s "http://localhost:3000/api/repos/$REPO_ID/patterns" \
  -H "Authorization: Bearer $API_KEY" | python3 -m json.tool

# Org-level rules
curl -s "http://localhost:3000/api/settings/rules" \
  -H "Authorization: Bearer $API_KEY" | python3 -m json.tool
```

### Phase 7 — PR Reviews API

Requires a valid API key and a connected repo.

```bash
API_KEY="unerr_sk_<your_key>"
REPO_ID="<your_repo_id>"

# List reviews (should return empty or existing reviews)
curl -s "http://localhost:3000/api/repos/$REPO_ID/reviews" \
  -H "Authorization: Bearer $API_KEY" | python3 -m json.tool

# Get review settings
curl -s "http://localhost:3000/api/repos/$REPO_ID/settings/review" \
  -H "Authorization: Bearer $API_KEY" | python3 -m json.tool

# Get merge history
curl -s "http://localhost:3000/api/repos/$REPO_ID/history" \
  -H "Authorization: Bearer $API_KEY" | python3 -m json.tool
```

### Phase 10a — Graph Snapshots API

```bash
API_KEY="unerr_sk_<your_key>"
REPO_ID="<your_repo_id>"

# List available snapshots
curl -s "http://localhost:3000/api/graph-snapshots" \
  -H "Authorization: Bearer $API_KEY" | python3 -m json.tool

# Download snapshot (returns pre-signed URL)
curl -s "http://localhost:3000/api/graph-snapshots/$REPO_ID/download" \
  -H "Authorization: Bearer $API_KEY" | python3 -m json.tool

# Trigger sync manually
curl -s -X POST "http://localhost:3000/api/graph-snapshots/$REPO_ID/sync" \
  -H "Authorization: Bearer $API_KEY" | python3 -m json.tool
```

### Phase 10b — Pre-fetch API

```bash
API_KEY="unerr_sk_<your_key>"
REPO_ID="<your_repo_id>"

# Fire a pre-fetch request (fire-and-forget, returns 200 immediately)
curl -s -X POST "http://localhost:3000/api/prefetch" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"repoId\": \"$REPO_ID\",
    \"filePath\": \"lib/auth/jwt.ts\",
    \"line\": 42
  }" | python3 -m json.tool
# Expected: { "success": true, "data": { "accepted": true } }

# Missing fields → 400
curl -s -X POST "http://localhost:3000/api/prefetch" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"filePath": "test.ts"}' | python3 -m json.tool
# Expected: { "error": "Invalid body: filePath and repoId are required" }
```

---

## Test Reports

Test reports are stored in `docs/test-reports/` with timestamp suffixes.
Generate a new report after major changes to track regression history.

```bash
ls docs/test-reports/
```
