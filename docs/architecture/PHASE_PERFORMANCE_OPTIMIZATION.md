# Performance Optimization — Architecture Doc

> Tracks all UI and backend performance improvements across the platform.

## Status: Active (Ongoing)

---

## 1. Server-Side Deduplication — React `cache()`

**Problem:** Every server component independently called `auth.api.getSession()` and `listOrganizations()`. A single navigation (layout + page + nested components) triggered 2-4 redundant DB/auth calls.

**Solution:** `lib/api/get-active-org.ts` wraps session and org resolution in React's `cache()` function, which deduplicates within a single HTTP request.

```
getSessionCached()  → cache(auth.api.getSession)
getOrgsCached()     → cache(listOrganizations)
getActiveOrgId()    → internally uses getOrgsCached()
```

**Impact:** Eliminates 2-4 redundant calls per navigation. ~100-400ms saved.

**Files:** `lib/api/get-active-org.ts`, 20+ dashboard pages updated.

---

## 2. Cross-Request Caching — `unstable_cache`

**Problem:** Even with per-request deduplication, every new HTTP request re-fetches the same data (org list, repo metadata, project stats). These rarely change but are fetched on every page load.

**Solution:** `lib/api/cached-queries.ts` uses Next.js `unstable_cache` for cross-request caching with TTL-based revalidation.

| Cached Query | TTL | Tag |
|---|---|---|
| `getReposCached(orgId)` | 30s | `repos` |
| `getRepoCached(orgId, repoId)` | 15s | `repo` |
| `getProjectStatsCached(orgId, repoId)` | 60s | `project-stats` |
| `getActiveRulesCached(orgId, repoId)` | 60s | `active-rules` |
| `getPatternsCached(orgId, repoId)` | 60s | `patterns` |

**Impact:** Eliminates redundant DB calls across HTTP requests. Telemetry chips and sidebar recents serve from cache for 30-60s.

**Files:** `lib/api/cached-queries.ts`, `app/(dashboard)/layout.tsx`, `app/(dashboard)/repos/[repoId]/layout.tsx`

---

## 3. Non-Blocking Dashboard Layout — Suspense

**Problem:** Dashboard layout blocked all child pages until the sidebar "recents" DB query completed.

**Solution:** Moved sidebar recents into async `<RecentReposNav>` component wrapped in `<Suspense>`. Layout shell renders immediately, children start rendering in parallel.

**Impact:** ~50-200ms improvement. Children no longer wait for recents query.

**Files:** `app/(dashboard)/layout.tsx`

---

## 4. Granular Suspense in Repo Layout

**Problem:** Repo layout blocked tabs and page content until 4+ parallel DB queries (stats, rules, patterns, snapshot) completed.

**Solution:** Split `RepoHeader` into fast + deferred sections:
- **Immediate:** Breadcrumb, status pill, action buttons, tabs (1 DB call for repo record)
- **Deferred:** Telemetry chips (`<Suspense>` with skeleton), Snapshot badge (separate `<Suspense>`)

**Impact:** ~200-500ms perceived improvement. Tabs and page content render while chips stream in.

**Files:** `app/(dashboard)/repos/[repoId]/layout.tsx`

---

## 5. Heavy Query Removal — Code Tab

**Problem:** Code tab page loaded `getAllEntities()` (10K+ items) and `getAllEdges()` (20K+ items) on every visit, plus ran `detectDeadCode()` computation over the full sets.

**Solution:**
- Entity counts from `projectStats` (already loaded, lightweight)
- Dead code info from `healthReport` (pre-computed in justification pipeline)
- Removed 2 heaviest queries entirely

**Impact:** ~500ms-2s+ per code tab visit. Payload reduced by ~90%.

**Files:** `app/(dashboard)/repos/[repoId]/page.tsx`

---

## 6. SSE for Real-Time Pipeline Events

**Problem:** Active pipeline monitoring required 4 separate polling loops:
- `useRepoStatus` — 8s polling `/api/repos/{id}/status`
- `usePipelineLogs` — 4s polling `/api/repos/{id}/logs`
- Pipeline page — 5s polling `/api/repos/{id}/status` (duplicate!)
- `ActivityFeed` — 5s polling `/api/repos/{id}/activity`

This created constant HTTP traffic even when no data changed.

**Solution:** Server-Sent Events (SSE) endpoint at `/api/repos/{id}/events`:
- Single connection replaces multiple polling loops during active pipeline
- Server-side change detection — only pushes when data actually changes
- Auto-closes when pipeline reaches terminal state (ready/error)
- Client `useRepoEvents` hook handles EventSource lifecycle + reconnection

**Why SSE over WebSockets/gRPC/tRPC:**
- SSE is unidirectional (server→client) which is exactly our use case
- Native browser `EventSource` API with built-in reconnection
- Works with standard Next.js route handlers (no extra infra)
- Already used in MCP transport (`lib/mcp/transport.ts`)

**Events emitted:**
```
event: status
data: { status, progress, indexingStartedAt, errorMessage, ... }

event: logs
data: { source: "live", logs: [...], count }

event: heartbeat
data: {}
```

**Files:**
- `app/api/repos/[repoId]/events/route.ts` — SSE endpoint
- `hooks/use-repo-events.ts` — EventSource client hook
- `hooks/use-visibility.ts` — Tab visibility detection

---

## 7. Visibility-Aware Polling

**Problem:** All polling hooks ran continuously regardless of whether the user was looking at the tab. Background tabs burned unnecessary HTTP requests.

**Solution:** `useVisibility()` hook using `useSyncExternalStore` + `document.visibilityState`. All polling hooks gate their intervals on tab visibility:
- Hidden tab → polling paused (zero requests)
- Tab returns → polling resumes immediately

**Integrated into:** `useRepoStatus`, `usePipelineLogs`, `McpStatus`, `ActivityFeed`

**Files:** `hooks/use-visibility.ts`

---

## 8. Progressive Polling Backoff

**Problem:** `ActivityFeed` polled every 5s indefinitely, even when no pipeline was running. `McpStatus` polled every 30s forever.

**Solution:**
- `ActivityFeed`: 5s when pipeline active → 30s when idle
- `McpStatus`: Increased from 30s → 60s
- Both pause when tab is hidden (via `useVisibility`)

**Files:** `components/activity/activity-feed.tsx`, `components/repo/mcp-status.tsx`

---

## 9. router.refresh() Elimination

**Problem:** `router.refresh()` after state-changing actions (reindex, stop, retry) triggered a full RSC tree re-fetch, even though local state was already updated.

**Solution:** Removed `router.refresh()` from pipeline actions where client state is sufficient:
- Pipeline page: Local state + SSE picks up status changes (3 calls removed)
- Onboarding console: Local state + SSE (3 calls removed)
- Manage panel: Replaced with `router.push()` to pipeline page (1 call replaced)

**Kept** `router.refresh()` where server re-fetch is necessary:
- Repo list: After create/delete/retry (server needs to re-render list)
- Connections list: After delete (server needs to re-render)
- Auth flows: After login/org-switch (session state change)

**Files:** `app/(dashboard)/repos/[repoId]/pipeline/page.tsx`, `components/repo/repo-onboarding-console.tsx`, `components/repo/repo-manage-panel.tsx`

---

## 10. ArangoDB Query Optimization

**Problem:** `getProjectStats()` made 5 separate COUNT queries (one per entity collection) + 1 language distribution query = 6 round trips to ArangoDB.

**Solution:** Consolidated into a single AQL query that counts all 5 collections + language distribution in one round trip. Each sub-expression still uses the `idx_{coll}_org_repo` persistent index.

```aql
LET f = LENGTH(FOR d IN files FILTER d.org_id == @orgId AND d.repo_id == @repoId RETURN 1)
LET fn = LENGTH(FOR d IN functions FILTER d.org_id == @orgId AND d.repo_id == @repoId RETURN 1)
...
RETURN { files: f, functions: fn, classes: cl, interfaces: ifc, variables: v, langs }
```

**Impact:** 6 queries → 1 query. Combined with 60s cross-request cache, ArangoDB load from stats is near-zero.

**Files:** `lib/adapters/arango-graph-store.ts`

---

## Summary Impact Table

| Optimization | Queries Eliminated | Estimated Impact |
|---|---|---|
| React `cache()` (session/org) | 2-4 per navigation | 100-400ms |
| `unstable_cache` (stats/repos) | Cross-request redundancy | 50-200ms |
| Non-blocking layout | 1 blocking query | 50-200ms |
| Granular repo Suspense | 0 removed, unblocks render | 200-500ms perceived |
| Heavy query removal (code tab) | 2 massive queries | 500ms-2s+ |
| SSE replaces 4 polling loops | Constant traffic eliminated | Network + CPU |
| Visibility-aware polling | All background requests | Bandwidth savings |
| Progressive backoff | Idle polling reduced 6x | Network reduction |
| router.refresh() removal | 7 full RSC re-fetches | 100-300ms each |
| ArangoDB query consolidation | 5 queries → 1 | 10-50ms per call |

---

## New Files

| File | Purpose |
|---|---|
| `lib/api/get-active-org.ts` | Per-request dedup with React `cache()` |
| `lib/api/cached-queries.ts` | Cross-request cache with `unstable_cache` |
| `hooks/use-visibility.ts` | Tab visibility detection |
| `hooks/use-repo-events.ts` | SSE client hook for pipeline events |
| `app/api/repos/[repoId]/events/route.ts` | SSE server endpoint |

## Environment Variables

None required. All optimizations are automatic.
