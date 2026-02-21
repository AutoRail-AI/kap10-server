# Testing Guide — kap10 Server

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
              └─► Phase 3 (Semantic Search)
                    └─► Phase 4 (Business Justification & Taxonomy)
                          └─► Phase 5 (Incremental Indexing & GitHub Webhooks)
                                └─► Phase 5.5 (Prompt Ledger, Rewind & Local Ingestion)
                                      └─► Phase 5.6 (CLI-First Zero-Friction Onboarding)
```

Each phase depends on all prior phases. Tests should be run in order during initial setup; in CI all tests run together.

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
| GitHub App install | Install → callback → installation saved in DB | Manual | Install GitHub App on a test org → check `kap10.github_installations` |
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

> **Summary:** MCP protocol implementation with 20 tools, dual-mode auth (JWT + API key), secret scrubbing, rate limiting, workspace overlay for uncommitted changes.
>
> **Depends on:** Phase 1

| Area | What to Test | Type | Test File / How |
|------|-------------|------|-----------------|
| MCP auth (JWT + API key) | Dual-mode authentication, cache, expiry | Auto | `lib/mcp/__tests__/auth.test.ts` |
| MCP tools (structural) | 20 tools: search, inspect, traverse, sync, timeline, rewind, etc. | Auto | `lib/mcp/tools/__tests__/tools.test.ts` |
| MCP tools (semantic) | Semantic search MCP tools | Auto | `lib/mcp/tools/__tests__/semantic.test.ts` |
| Secret scrubber | PII/secrets stripped from MCP responses | Auto | `lib/mcp/security/__tests__/scrubber.test.ts` |
| Rate limiter | Per-key rate limiting works correctly | Auto | `lib/mcp/security/__tests__/rate-limiter.test.ts` |
| Response formatter | MCP responses formatted per spec | Auto | `lib/mcp/__tests__/formatter.test.ts` |
| API key CRUD | Create, list, revoke API keys via `/api/api-keys` | Auto | Test via route handler import |
| MCP in Cursor | Paste MCP URL + API key into `.cursor/mcp.json` → tools work | Manual | Open Cursor → add MCP config → ask agent to search code |
| MCP in Claude Code | `claude mcp add kap10 ...` → OAuth flow → tools work | Manual | Terminal → add MCP → Claude Code agent uses tools |
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
| Local repo upload | `kap10 push` uploads and indexes local codebase | Manual | CLI: `kap10 push` → verify entities appear in ArangoDB |
| `kap10 watch` | File watcher detects changes, syncs automatically | Manual | CLI: `kap10 watch` → edit files → verify sync |
| Timeline UI | Timeline page shows entries with branch lanes | Manual | Browser: `/repos/{id}/timeline` → verify layout |
| Commits page | AI contribution summaries display correctly | Manual | Browser: `/repos/{id}/commits` → verify summaries |

**Auto test files:** 12
**What an LLM agent can do:** Run all 12 Auto test files. Cannot test real AI interaction, CLI interactive flows, or visual timeline.

---

### Phase 5.6 — CLI-First Zero-Friction Onboarding

> **Summary:** Device authorization flow (RFC 8628), org-level API keys, `kap10 connect` command (auto-detects git remote + IDE, writes MCP config), CLI authorize page, ephemeral sandbox mode, self-healing MCP config, dirty state overlay (real-time uncommitted context via Redis), graph-only upload endpoint.
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
| CLI `auth login` | Device flow opens browser, polls, saves creds | Manual | Terminal: `kap10 auth login --server http://localhost:3000` |
| CLI `connect` | Full golden path: auth → git detect → IDE config | Manual | Terminal: `kap10 connect --server http://localhost:3000` |
| CLI `connect --ephemeral` | Creates ephemeral sandbox with 4h TTL | Manual | Terminal: `kap10 connect --ephemeral` → verify TTL repo |
| CLI `kap10 promote` | Converts ephemeral → permanent | Manual | `kap10 promote` → verify ephemeral flag removed |
| UI connect page | CLI quickstart card shown, manual setup in accordion | Manual | Browser: `/repos/{id}/connect` → verify layout |
| Org-level API key in MCP | Key without repoId works for any repo in org | Manual | Create org key → use with different repos → verify access |
| Self-healing config | Git hooks auto-verify MCP config after checkout | Manual | `git checkout branch` → verify config repaired if broken |

**Auto test files:** 4 (1 file with 20 tests + 3 additional)
**What an LLM agent can do:** Run all automated tests. Cannot test browser approve page, CLI interactive flows, or visual UI layout.

**Test command:** `pnpm test app/api/cli/__tests__/device-auth-flow.test.ts`

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
| **Total (through 5.6)** | **61 files** | **9 specs** | **32 checks** | **~70%** |

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
pnpm test packages/cli/                          # Phase 5.6 + 10a: CLI commands

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
- [ ] **CLI auth**: `kap10 auth login` → browser opens → code shown → authorize → CLI saves key
- [ ] **CLI connect**: `kap10 connect` → detects repo → writes MCP config
- [ ] **Connect page**: `/repos/{id}/connect` → CLI quickstart visible → manual accordion works
- [ ] **Incremental**: Push to GitHub → only changed entities re-indexed within 30s
- [ ] **Timeline**: `/repos/{id}/timeline` → shows ledger entries with status colors
- [ ] **Rewind**: Break something via AI → Rewind → files restored

### Secondary (should pass, non-blocking)

- [ ] **Search**: MCP `search_code` returns relevant results
- [ ] **Semantic**: "Functions that handle auth" returns auth code
- [ ] **Rate limiting**: Rapid API calls get rate-limited
- [ ] **API key revoke**: Revoked key returns 401
- [ ] **Blueprint**: `/repos/{id}/blueprint` → swimlane visualization
- [ ] **Health report**: `/repos/{id}/health` → risk summary
- [ ] **Activity feed**: `/repos/{id}/activity` → index events displayed
- [ ] **CLI push**: `kap10 push` → local repo indexed
- [ ] **CLI watch**: `kap10 watch` → file changes auto-synced
- [ ] **Ephemeral**: `kap10 connect --ephemeral` → sandbox with TTL
- [ ] **Promote**: `kap10 promote` → ephemeral becomes permanent
- [ ] **Circuit breaker**: 4+ broken AI changes → agent halted
- [ ] **Local proxy**: `kap10 pull && kap10 serve` → tools resolve locally

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
const rawKey = "kap10_sk_test_key"
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
# Expected: { access_token: "kap10_sk_...", org_id, org_name, key_already_existed: false }
```

### Phase 5.6 — Context Endpoint

Requires a valid API key (from device flow or dashboard).

```bash
API_KEY="kap10_sk_<your_key>"

# Auth enforcement
curl -s "http://localhost:3000/api/cli/context?remote=github.com/org/repo"
# Expected: {"error":"Missing or invalid Authorization header"}

curl -s "http://localhost:3000/api/cli/context?remote=github.com/org/repo" \
  -H "Authorization: Bearer kap10_sk_invalid"
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

---

## Test Reports

Test reports are stored in `docs/test-reports/` with timestamp suffixes.
Generate a new report after major changes to track regression history.

```bash
ls docs/test-reports/
```
