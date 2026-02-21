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

## Testing Matrix by Phase

Legend:
- **Auto** = Automated tests (vitest). Can be run by CI or LLM agent.
- **Manual** = Requires human interaction (browser clicks, visual verification, external service).

---

### Phase 0 — Foundation Wiring

| Area | What to Test | Type | Test File / How |
|------|-------------|------|-----------------|
| DI Container | All 11 ports resolve, fresh instances, overrides work | Auto | `lib/di/__tests__/container.test.ts` |
| Port Compliance | Every fake implements its port interface correctly | Auto | `lib/di/__tests__/port-compliance.test.ts` |
| Health endpoint | `/api/health` returns status for all 5 infra services | Auto | `app/api/__tests__/health.test.ts` |
| Auth signup | Email/password registration → auto-org creation | Manual | Browser: `/register` → check org appears in dashboard |
| OAuth login | Google/GitHub login → session → org auto-provision | Manual | Browser: click Google/GitHub → lands on dashboard |
| Email verification | Unverified email/password users redirected to `/verify-email` | Manual | Register with email → check redirect before verifying |
| Proxy route protection | Unauthenticated requests redirect to `/login` | Auto | `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/repos` → `307` |
| Env validation | `env.mjs` rejects missing required vars at build time | Auto | `pnpm build` with missing env → should fail |

**What an LLM agent can do:** Run all Auto tests, verify build passes. Cannot test OAuth browser flows or email delivery.

---

### Phase 1 — GitHub Connect & Repository Indexing

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
| ArangoDB adapter | Entity/edge CRUD with real ArangoDB instance | Auto (integration) | `lib/adapters/arango-graph-store.integration.test.ts` |
| GitHub App install | Install → callback → installation saved in DB | Manual | Install GitHub App on a test org → check `kap10.github_installations` |
| Repo indexing end-to-end | Connect repo → indexing starts → entities appear | Manual | Dashboard: connect repo → wait for "ready" → check entity counts |
| SCIP indexing | SCIP produces correct cross-references | Manual | Requires `scip-typescript` binary → check ArangoDB edges |

**What an LLM agent can do:** Run all 10 Auto test files, verify ArangoDB integration test. Cannot install GitHub Apps or trigger real SCIP indexing.

---

### Phase 2 — Hosted MCP Server

| Area | What to Test | Type | Test File / How |
|------|-------------|------|-----------------|
| MCP auth (JWT + API key) | Dual-mode authentication, cache, expiry | Auto | `lib/mcp/__tests__/auth.test.ts` |
| MCP tools (structural) | 9 tools: search, inspect, list, traverse, etc. | Auto | `lib/mcp/tools/__tests__/tools.test.ts` |
| MCP tools (semantic) | Semantic search MCP tools | Auto | `lib/mcp/tools/__tests__/semantic.test.ts` |
| Secret scrubber | PII/secrets stripped from MCP responses | Auto | `lib/mcp/security/__tests__/scrubber.test.ts` |
| Rate limiter | Per-key rate limiting works correctly | Auto | `lib/mcp/security/__tests__/rate-limiter.test.ts` |
| Response formatter | MCP responses formatted per spec | Auto | `lib/mcp/__tests__/formatter.test.ts` |
| API key CRUD | Create, list, revoke API keys via `/api/api-keys` | Auto | Test via route handler import (see Phase 5.6 pattern) |
| MCP in Cursor | Paste MCP URL + API key into `.cursor/mcp.json` → tools work | Manual | Open Cursor → add MCP config → ask agent to search code |
| MCP in Claude Code | `claude mcp add kap10 ...` → OAuth flow → tools work | Manual | Terminal → add MCP → Claude Code agent uses tools |
| OAuth 2.1 DCR flow | Dynamic client registration per MCP spec | Manual | Claude Code auto-registers → check token exchange works |

**What an LLM agent can do:** Run all 6 Auto test files. Cannot verify real IDE integrations or OAuth browser flows.

---

### Phase 3 — Semantic Search

| Area | What to Test | Type | Test File / How |
|------|-------------|------|-----------------|
| Hybrid search | Keyword + semantic fusion, RRF scoring | Auto | `lib/embeddings/__tests__/hybrid-search.test.ts` |
| Embedding activity | Embedding generation Temporal activity | Auto | `lib/temporal/activities/__tests__/embedding.test.ts` |
| pgvector storage | Embeddings stored and queried correctly | Manual | Requires running PostgreSQL with pgvector extension |
| Search relevance | "Functions that handle auth" returns auth code | Manual | MCP tool call → verify results are semantically relevant |

**What an LLM agent can do:** Run the 2 Auto test files. Cannot judge semantic search quality (subjective).

---

### Phase 4 — Business Justification & Taxonomy

| Area | What to Test | Type | Test File / How |
|------|-------------|------|-----------------|
| Justification generation | LLM produces valid justification documents | Manual | Trigger justification → verify quality of purpose/taxonomy/tags |
| VERTICAL/HORIZONTAL/UTILITY classification | Entities classified correctly | Manual | Spot-check 10-20 functions → verify taxonomy makes sense |
| Blueprint Dashboard | Swimlane visualization renders correctly | Manual | Browser: navigate to Blueprint → verify layout, interactions |
| Justification MCP tool | `get_justification` returns correct data | Auto | Can be tested via MCP tools test suite |

**What an LLM agent can do:** Verify tool responses have correct structure. Cannot judge LLM output quality or visual layout.

---

### Phase 5 — Incremental Indexing & GitHub Webhooks

| Area | What to Test | Type | Test File / How |
|------|-------------|------|-----------------|
| Webhook handler | `push` event triggers re-index for changed files only | Manual | Push to GitHub → verify only changed entities re-indexed |
| Entity diff | Detects added/modified/deleted entities correctly | Auto | Can test entity hash comparison in isolation |
| Cascade re-justification | Changed entity triggers re-justification of callers | Manual | Modify a function → verify callers get updated justifications |
| Webhook signature verification | Invalid signatures rejected | Auto | Test webhook route with wrong signature → 401 |
| Activity feed | Indexing events appear in dashboard | Manual | Push to repo → check activity feed shows event |

**What an LLM agent can do:** Test entity diffing logic and webhook signature verification. Cannot trigger real GitHub pushes.

---

### Phase 5.5 — Prompt Ledger, Rewind & Local Ingestion

| Area | What to Test | Type | Test File / How |
|------|-------------|------|-----------------|
| Bootstrap rule generation | Onboarding rule created from repo analysis | Auto | `lib/onboarding/__tests__/bootstrap-rule.test.ts` |
| Ledger entries | AI changes tracked with prompts | Manual | Make AI change via MCP → verify ledger entry in ArangoDB |
| Rewind | Restore to previous working state | Manual | Break something → click Rewind → verify restoration |
| Anti-pattern rule synthesis | Rewind generates a "don't do this" rule | Manual | Rewind → verify rule appears in rules collection |
| Local repo upload | `kap10 push` uploads and indexes local codebase | Manual | CLI: `kap10 push` → verify entities appear in ArangoDB |

**What an LLM agent can do:** Run bootstrap rule test. Ledger/rewind require real AI interaction.

---

### Phase 5.6 — CLI-First Zero-Friction Onboarding

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
| Browser authorize page | Shows code, "Authorize CLI" button works | Manual | Open `/cli/authorize?code=XXXX` → click authorize |
| CLI `auth login` | Device flow opens browser, polls, saves creds | Manual | Terminal: `kap10 auth login --server http://localhost:3000` |
| CLI `connect` | Full golden path: auth → git detect → IDE config | Manual | Terminal: `kap10 connect --server http://localhost:3000` |
| UI connect page | CLI quickstart card shown, manual setup in accordion | Manual | Browser: `/repos/{id}/connect` → verify layout |
| Org-level API key in MCP | Key without repoId works for any repo in org | Manual | Create org key → use with different repos → verify access |

**What an LLM agent can do:** Run all 20 automated tests (16 for device flow + 4 context variants). Cannot test browser approve page, CLI interactive flows, or visual UI layout.

**Test command:** `pnpm test app/api/cli/__tests__/device-auth-flow.test.ts`

---

### Phase 6 — Pattern Enforcement & Rules Engine

| Area | What to Test | Type | Test File / How |
|------|-------------|------|-----------------|
| Pattern detection | ast-grep finds patterns in codebase | Manual | Run pattern detection workflow → verify patterns found |
| Rule CRUD | Create/read/update/delete rules via API | Auto | Test route handlers directly |
| Rule hierarchy | Org → repo → path → branch → workspace precedence | Auto | Test rule resolution logic with in-memory fakes |
| Adherence scoring | Pattern adherence rates calculated correctly | Manual | Need real codebase data to verify scores |
| Rule enforcement | Agent warned/blocked when violating rules | Manual | MCP tool call with violating code → verify response |
| Pattern promotion | Promote detected pattern to explicit rule | Manual | Dashboard: click promote → verify rule created |

**What an LLM agent can do:** Test rule CRUD and hierarchy resolution. Cannot judge pattern detection quality.

---

### Phase 10a — Local-First Intelligence Proxy

| Area | What to Test | Type | Test File / How |
|------|-------------|------|-----------------|
| Graph export | ArangoDB → msgpack snapshot | Auto | `lib/temporal/activities/__tests__/graph-export.test.ts` |
| Sync workflow | Full sync-local-graph workflow | Auto | `lib/temporal/workflows/__tests__/sync-local-graph.test.ts` |
| Query router | Dispatches tools to local vs cloud | Auto | `packages/cli/src/__tests__/query-router.test.ts` |
| Search index | Local text search index | Auto | `packages/cli/src/__tests__/search-index.test.ts` |
| Checksum | Snapshot integrity verification | Auto | `packages/cli/src/__tests__/checksum.test.ts` |
| Graph compactor | Compacts graph for local storage | Auto | `lib/use-cases/__tests__/graph-compactor.test.ts` |
| Graph serializer | Serializes graph to msgpack format | Auto | `lib/use-cases/__tests__/graph-serializer.test.ts` |
| `kap10 pull` | Downloads snapshot, imports into CozoDB | Manual | Terminal: `kap10 pull` → verify local DB populated |
| `kap10 serve` | Starts local MCP proxy, tools resolve locally | Manual | Terminal: `kap10 serve` → connect IDE → verify sub-5ms |
| Cloud fallback | Unresolvable queries proxy to cloud | Manual | Query a tool that's cloud-only → verify it falls through |
| File tree builder | Builds file tree from entities | Auto | `lib/utils/file-tree-builder.test.ts` |

**What an LLM agent can do:** Run all 7 Auto test files. Cannot test real CozoDB import, MCP proxy startup, or latency measurements.

---

## Automation Summary

| Phase | Auto Tests | Manual Tests | Auto Coverage |
|-------|-----------|-------------|---------------|
| 0 — Foundation | 3 files | 4 checks | ~60% |
| 1 — Indexing | 10 files | 3 checks | ~80% |
| 2 — MCP Server | 6 files | 3 checks | ~75% |
| 3 — Semantic Search | 2 files | 2 checks | ~50% |
| 4 — Taxonomy | 1 tool test | 3 checks | ~25% |
| 5 — Incremental | 2 tests possible | 3 checks | ~40% |
| 5.5 — Ledger/Rewind | 1 file | 4 checks | ~20% |
| 5.6 — CLI Onboarding | 1 file (20 tests) | 5 checks | ~80% |
| 6 — Rules Engine | 2 tests possible | 4 checks | ~33% |
| 10a — Local Proxy | 7 files | 3 checks | ~70% |
| **Total** | **32 files** | **34 checks** | **~55%** |

---

## Running All Automated Tests

```bash
# All tests
pnpm test

# By phase area
pnpm test lib/di/                              # Phase 0: DI container
pnpm test lib/indexer/ lib/temporal/activities/  # Phase 1: Indexing pipeline
pnpm test lib/mcp/                              # Phase 2: MCP server
pnpm test lib/embeddings/                       # Phase 3: Semantic search
pnpm test app/api/cli/                           # Phase 5.6: CLI onboarding
pnpm test packages/cli/                          # Phase 10a: Local proxy CLI
pnpm test lib/use-cases/                         # Phase 10a: Graph serialization

# Integration tests (require running infra)
pnpm test lib/adapters/arango-graph-store.integration.test.ts
```

---

## Manual Testing Checklist

Use this when preparing a release or after major changes.

### Pre-requisites
```bash
docker compose up -d    # Start infra
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

### Secondary (should pass, non-blocking)

- [ ] **Search**: MCP `search_code` returns relevant results
- [ ] **Semantic**: "Functions that handle auth" returns auth code
- [ ] **Rate limiting**: Rapid API calls get rate-limited
- [ ] **API key revoke**: Revoked key returns 401
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
