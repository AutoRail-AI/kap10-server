# Phase 9 — Code Snippet Library: Deep Dive & Implementation Tracker

> **Phase Feature Statement:** _"My AI agent produces dramatically better code because it sees working examples of how my team actually writes code — not hallucinated patterns from its training data. Senior developers pin exemplar implementations, and every teammate's agent benefits."_
>
> **Source:** [`VERTICAL_SLICING_PLAN.md`](./VERTICAL_SLICING_PLAN.md) — Phase 9
>
> **Prerequisites:** [Phase 8 — Usage-Based Billing & Limits](./PHASE_8_USAGE_BASED_BILLING_AND_LIMITS.md) (billing, plan feature gating, Langfuse cost tracking); [Phase 3 — Semantic Search](./PHASE_3_SEMANTIC_SEARCH.md) (pgvector embedding pipeline, `IVectorSearch`); [Phase 6 — Pattern Enforcement & Rules Engine](./PHASE_6_PATTERN_ENFORCEMENT_AND_RULES_ENGINE.md) (pattern detection for auto-extraction candidates)
>
> **What this is NOT:** Phase 9 does not replace rules (Phase 6). Rules say "what you must do"; snippets show "how we do it here." Snippets are exemplar code injected into agent context — they are not enforced or validated. Phase 9 does not implement a full public marketplace — the community library is a curated read-only registry managed by the unerr team.
>
> **Delivery position:** Post-launch feature. Ships after Phase 8 (GA) is stable. See [dependency graph](./VERTICAL_SLICING_PLAN.md#phase-summary--dependencies).

---

## Table of Contents

- [Part 1: Architectural Deep Dive](#part-1-architectural-deep-dive)
  - [1.1 Canonical Terminology](#11-canonical-terminology)
  - [1.2 Core User Flows](#12-core-user-flows)
  - [1.3 System Logic & State Management](#13-system-logic--state-management)
  - [1.4 Reliability & Resilience](#14-reliability--resilience)
  - [1.5 Performance Considerations](#15-performance-considerations)
  - [1.6 Phase Bridge → Phase 10b & Beyond](#16-phase-bridge--phase-10b--beyond)
- [Part 2: Implementation & Tracing Tracker](#part-2-implementation--tracing-tracker)
  - [2.1 Infrastructure Layer](#21-infrastructure-layer)
  - [2.2 Database & Schema Layer](#22-database--schema-layer)
  - [2.3 Ports & Adapters Layer](#23-ports--adapters-layer)
  - [2.4 Backend / API Layer](#24-backend--api-layer)
  - [2.5 Frontend / UI Layer](#25-frontend--ui-layer)
  - [2.6 Testing & Verification](#26-testing--verification)

---

# Part 1: Architectural Deep Dive

## 1.1 Canonical Terminology

| Canonical term | DB / TS field | NOT called |
|---|---|---|
| **Snippet** | ArangoDB `snippets` collection; TS `SnippetDoc` | "template", "boilerplate", "recipe", "example" |
| **Community snippet** | `snippet.source = "community"`, `org_id = null` | "public snippet", "global snippet", "marketplace item" |
| **Team snippet** | `snippet.source = "team"`, `org_id = <org>` | "private snippet", "org snippet", "shared snippet" |
| **Auto-extracted snippet** | `snippet.source = "auto_extracted"`, created by system during indexing | "suggested snippet", "detected snippet" |
| **Snippet category** | `snippet.category`: `ui_component`, `api_pattern`, `data_model`, `testing`, `architecture`, `error_handling`, `performance`, `security`, `devops`, `user_flow` | "type", "kind", "class" |
| **Pin** | Action of promoting a code entity to a team snippet via `pin_snippet` MCP tool | "save", "bookmark", "star" |
| **Exemplar** | A snippet that is linked to a specific entity in the knowledge graph via `entity_ref` | "reference implementation", "canonical example" |
| **Snippet embedding** | pgvector row in `unerr.snippet_embeddings` — vector representation of snippet `title + description + code` | "snippet vector", "code embedding" |
| **Snippet resolution** | Priority-ordered selection: team → auto-extracted → community → semantic similarity | "snippet ranking", "snippet matching" |

---

## 1.2 Core User Flows

Phase 9 has six actor journeys. Three are user-initiated (browse, pin, create), two are agent-initiated (get, search), and one is system-initiated (auto-extraction).

### Flow 1: Agent Retrieves Contextual Snippets — `get_snippets`

**Actor:** AI agent via MCP client
**Precondition:** Agent is working on a file; snippet library has relevant entries
**Outcome:** Agent receives up to 3 prioritized code snippets as working examples

```
Step  Actor Action                           System Action                                                      Latency
────  ─────────────────────────────────────  ─────────────────────────────────────────────────────────────────   ──────────
1     Agent calls MCP tool:                  MCP server receives tool call                                      ~1ms
      get_snippets({
        filePath: "lib/auth/jwt.ts",
        taskDescription: "add JWT refresh",
        category: "security",
        limit: 3
      })

2                                            Snippet resolution pipeline:                                        ~50-150ms

      Step A: Team snippets (highest priority)                                                                  ~10ms
        AQL: FOR s IN snippets
               FILTER s.org_id == @orgId
               AND s.source == "team"
               AND s.status == "active"
               AND (s.category == @category OR @category == null)
               AND (s.language == @language OR s.language == null)
               SORT s.upvotes DESC
               LIMIT @limit
               RETURN s

      Step B: Auto-extracted from same repo                                                                     ~10ms
        AQL: FOR s IN snippets
               FILTER s.org_id == @orgId
               AND s.repo_id == @repoId
               AND s.source == "auto_extracted"
               AND s.status == "active"
               AND (s.category == @category OR @category == null)
               SORT s.confidence DESC
               LIMIT @limit
               RETURN s

      Step C: Community snippets                                                                                ~10ms
        AQL: FOR s IN snippets
               FILTER s.org_id == null
               AND s.source == "community"
               AND s.status == "active"
               AND (s.category == @category OR @category == null)
               AND (s.language == @language OR s.language == null)
               AND (s.framework == @framework OR @framework == null)
               SORT s.upvotes DESC
               LIMIT @limit
               RETURN s

      Step D: Semantic similarity (fill remaining slots)                                                        ~80ms
        → Embed taskDescription via IVectorSearch.embedQuery()
        → Search unerr.snippet_embeddings with cosine distance
        → Filter: orgId (team + community) AND category match
        → Return top N to fill remaining slots up to limit

      Step E: Merge and deduplicate                                                                             ~1ms
        → Priority order: team → auto_extracted → community → semantic
        → Deduplicate by snippet._key
        → Truncate to limit (default 3)

3     Agent receives snippets                Response formatted:                                                 ~1ms
                                             {
                                               snippets: [
                                                 { title, category, code, context,
                                                   source, language, framework,
                                                   _meta: { priority: 1, matchType: "team" } },
                                                 ...
                                               ],
                                               _meta: {
                                                 totalCandidates: 12,
                                                 returned: 3,
                                                 sources: { team: 1, auto_extracted: 1, semantic: 1 }
                                               }
                                             }
```

**Integration with Bootstrap Rule:** The Bootstrap Rule (Phase 2 onboarding) instructs agents to call `get_snippets` at the start of any implementation task. The agent receives rules (constraints) first via `get_rules`, then snippets (examples) second via `get_snippets`. This ordering is deliberate — rules define the "what," snippets show the "how."

### Flow 2: Developer Pins an Entity as Team Snippet — `pin_snippet`

**Actor:** Developer (via agent or dashboard)
**Precondition:** Entity exists in the knowledge graph; developer has Team/Enterprise plan
**Outcome:** Entity's code saved as a team snippet, embedded for semantic search

```
Step  Actor Action                           System Action                                                      State Change
────  ─────────────────────────────────────  ─────────────────────────────────────────────────────────────────   ──────────────────────────────
1     Agent calls MCP tool:                  MCP server receives tool call                                      None
      pin_snippet({
        entityId: "fn_useOptimisticMutation",
        title: "React Query optimistic mutation",
        category: "ui_component",
        description: "Pattern for mutations
          with instant UI feedback and
          rollback on error"
      })

2                                            Validate plan: org must have team/enterprise plan                   None
                                             → If Free/Pro: return error
                                               "Pinning snippets requires a Teams or
                                                Enterprise plan."

3                                            Fetch entity from graph store:                                      None
                                             → IGraphStore.getEntity(orgId, entityId)
                                             → If not found: return error
                                               "Entity not found in knowledge graph."

4                                            Create snippet from entity:                                        ArangoDB snippets:
                                             → snippet = {                                                       new document
                                                 _key: generateKey(),
                                                 title: input.title,
                                                 description: input.description,
                                                 category: input.category,
                                                 language: entity.language,
                                                 framework: null (user can set later),
                                                 code: entity.body,
                                                 context: "Pinned from " + entity.file_path
                                                          + ":" + entity.start_line,
                                                 tags: [entity.kind, entity.name],
                                                 source: "team",
                                                 org_id: ctx.orgId,
                                                 repo_id: entity.repo_id,
                                                 entity_ref: entityId,
                                                 upvotes: 0,
                                                 verified: false,
                                                 created_by: ctx.userId,
                                                 version: 1,
                                                 status: "active"
                                               }
                                             → IGraphStore.upsertSnippet(orgId, snippet)

5                                            Embed snippet for semantic search:                                  unerr.snippet_embeddings:
                                             → text = title + "\n" + description                                 new row
                                                      + "\n" + code
                                             → embedding = IVectorSearch.embed([text])
                                             → IVectorSearch.upsert(
                                                 [snippet._key],
                                                 [embedding],
                                                 [{ orgId, repoId, source: "team",
                                                    entityType: "snippet" }]
                                               )

6     Agent receives confirmation            Response:                                                           None
                                             { success: true, snippetId: "snip_abc",
                                               _meta: { source: "team", embedded: true } }
```

**Why pin through the agent?** Developers work in IDEs. When they encounter a well-written function while reading code (via `get_function`), they can immediately pin it as a snippet without leaving the agent conversation. The `pin_snippet` tool bridges the graph (Phase 1 entities) with the snippet library (Phase 9).

### Flow 3: Developer Creates a Manual Snippet via Dashboard

**Actor:** Developer or team lead on the dashboard
**Precondition:** User authenticated; Team/Enterprise plan for team snippets (any plan for community contributions)
**Outcome:** Snippet created in the library with syntax highlighting preview

```
Step  Actor Action                           System Action                                                      State Change
────  ─────────────────────────────────────  ─────────────────────────────────────────────────────────────────   ──────────────────────────────
1     User navigates to /snippets/new        Dashboard renders snippet creation form:                            None
                                             → Title (required)
                                             → Description (required)
                                             → Category (select from 10 options)
                                             → Language (auto-detected from code, editable)
                                             → Framework (optional)
                                             → Code (Monaco editor with syntax highlighting)
                                             → Context / when to use (optional)
                                             → Tags (comma-separated)
                                             → Scope: "Team" or "Community contribution"

2     User fills form, clicks "Create"       POST /api/snippets                                                  ArangoDB snippets:
                                             → Validate required fields                                          new document
                                             → If scope = "team": require Teams/Enterprise plan
                                             → If scope = "community": status = "draft"
                                               (pending unerr team review)
                                             → Create snippet document in ArangoDB
                                             → Embed for semantic search

3     User sees snippet detail page          Redirect to /snippets/{id}                                         None
                                             → Syntax-highlighted code preview
                                             → Edit / delete buttons (if owner)
                                             → Upvote button (for community snippets)
```

### Flow 4: System Auto-Extracts Snippet Candidates

**Actor:** System (`extractSnippetCandidatesActivity` during indexing)
**Precondition:** `indexRepoWorkflow` or `embedRepoWorkflow` completed; entities exist in ArangoDB
**Outcome:** High-quality entities identified and created as draft auto-extracted snippets

```
Step  System Action                                                                State Change
────  ──────────────────────────────────────────────────────────────────────────    ──────────────────────────────
1     After embedRepoWorkflow completes, trigger:                                  Workflow started
      extractSnippetCandidatesWorkflow (light-llm-queue)

2     Activity: identifyCandidates                                                 None (read-only)
      → AQL: FOR e IN functions
               FILTER e.org_id == @orgId AND e.repo_id == @repoId
               LET callerCount = LENGTH(
                 FOR edge IN edges
                   FILTER edge._to == CONCAT("functions/", e._key)
                   AND edge.kind == "calls"
                   RETURN 1
               )
               FILTER callerCount >= 3          // frequently referenced
               AND LENGTH(e.body) < 3000        // concise (<100 lines)
               AND e.signature != ""            // has a signature
               RETURN { entity: e, callerCount }
      → Also query classes with similar criteria
      → Return candidates: EntityDoc[]

3     Activity: scoreAndFilter                                                     None
      → For each candidate, compute quality score:
        score = (callerCount × 0.4)             // popularity
              + (hasDocstring ? 20 : 0)          // documented
              + (bodyLines < 50 ? 15 : 0)        // concise
              + (signatureLength > 10 ? 10 : 0)  // meaningful signature
      → Filter: score >= 50 (threshold)
      → Sort by score descending
      → Take top 20 candidates per repo
        (avoid flooding the snippet library)

4     Activity: createDraftSnippets                                                ArangoDB snippets:
      → For each candidate:                                                        new documents
        → Check if snippet with same entity_ref exists
          (deduplicate — don't re-suggest already-pinned entities)
        → Create snippet:
            source: "auto_extracted"
            status: "draft"
            category: inferCategory(entity)
            confidence: normalizedScore
            title: entity.name (human-readable)
            code: entity.body
            entity_ref: entity._key

5     Activity: embedDraftSnippets                                                 unerr.snippet_embeddings:
      → Batch embed all new draft snippets                                         new rows
      → Same pipeline as Phase 3 embedding

6     Workflow completes                                                            Workflow complete
      → Log: "Extracted {N} snippet candidates for {repoId}"
```

**Category inference:** The system infers category from entity characteristics:
- Entity in `**/test/**` or name contains `test/spec/describe` → `testing`
- Entity imports from `react`/`vue`/`svelte` → `ui_component`
- Entity in `**/api/**` or `**/routes/**` → `api_pattern`
- Entity handles `Error`/`catch`/`throw` → `error_handling`
- Entity name contains `auth`/`session`/`token` → `security`
- Default: `architecture`

### Flow 5: Agent Searches Snippets Semantically — `search_snippets`

**Actor:** AI agent via MCP client
**Precondition:** Snippet library populated; agent needs a specific pattern
**Outcome:** Agent receives semantically relevant snippets ranked by similarity

```
Step  Actor Action                           System Action                                                      Latency
────  ─────────────────────────────────────  ─────────────────────────────────────────────────────────────────   ──────────
1     Agent calls MCP tool:                  MCP server receives tool call                                      ~1ms
      search_snippets({
        query: "optimistic update with
          rollback on error",
        category: "ui_component",
        language: "typescript",
        source: "all",
        limit: 5
      })

2                                            Embed query:                                                        ~50ms
                                             → IVectorSearch.embedQuery(query)

3                                            Vector search:                                                      ~30ms
                                             → Search unerr.snippet_embeddings
                                               with cosine distance
                                             → Filter: entityType = "snippet"
                                               AND (orgId = ctx.orgId OR orgId IS NULL)
                                               AND (category = @category OR @category = null)
                                               AND (language = @language OR @language = null)
                                               AND status = "active"
                                             → Top K results

4                                            Fetch full snippets from ArangoDB:                                  ~10ms
                                             → For each result._key:
                                               AQL: DOCUMENT("snippets", @key)
                                             → Filter by source if specified

5     Agent receives snippets                Response with similarity scores                                     ~1ms
                                             _meta.source: "semantic_search"
                                             Total: ~90ms
```

### Flow 6: Team Lead Reviews Auto-Extracted Candidates

**Actor:** Team lead on the dashboard
**Precondition:** Auto-extraction has created draft snippets
**Outcome:** Lead promotes worthy candidates to active team snippets or dismisses them

```
Step  Actor Action                           System Action                                                      State Change
────  ─────────────────────────────────────  ─────────────────────────────────────────────────────────────────   ──────────────────────────────
1     User navigates to                      GET /api/snippets?source=auto_extracted                             None
      /snippets/suggestions                  &status=draft&orgId=...
                                             → Returns draft auto-extracted snippets
                                             → Sorted by confidence score

2     User reviews snippet candidate         Detail view with:                                                   None
                                             → Syntax-highlighted code
                                             → Entity source (file path, line)
                                             → Quality score breakdown
                                             → Caller count (how often referenced)
                                             → Link to entity in knowledge graph

3a    User clicks "Promote"                  PATCH /api/snippets/{id}                                           ArangoDB snippet:
                                             → status: "draft" → "active"                                        status: "active"
                                             → source: remains "auto_extracted"                                  verified: true
                                             → verified: true
                                             → User can edit title, description,
                                               category, tags before promoting

3b    User clicks "Dismiss"                  PATCH /api/snippets/{id}                                           ArangoDB snippet:
                                             → status: "draft" → "deprecated"                                    status: "deprecated"
                                             → Entity ref remembered to avoid
                                               re-suggesting same entity
```

---

## 1.3 System Logic & State Management

### Snippet Data Model (ArangoDB)

The `snippets` collection is already bootstrapped in ArangoDB with a `(org_id, repo_id)` persistent index. Phase 9 defines the full document shape:

```
SnippetDoc {
  _key:               String    // UUID, primary key
  title:              String    // Human-readable title
  description:        String    // What this snippet demonstrates
  category:           String    // enum: ui_component, api_pattern, data_model,
                                //       testing, architecture, error_handling,
                                //       performance, security, devops, user_flow
  language:           String    // "typescript", "python", "go"
  framework:          String?   // "next.js", "fastapi", "gin"
  code:               String    // The actual snippet code
  context:            String?   // When/why to use this snippet
  tags:               String[]  // Searchable tags
  source:             String    // "community" | "team" | "auto_extracted"
  org_id:             String?   // null = community (public)
  repo_id:            String?   // null = org-wide or community
  entity_ref:         String?   // Link to source entity _key (pinned/auto-extracted)
  upvotes:            Number    // Community voting count
  verified:           Boolean   // Reviewed by unerr team (community) or org admin (team)
  created_by:         String    // User ID who created/pinned
  version:            Number    // Snippet versioning (for edits)
  status:             String    // "active" | "draft" | "deprecated"
  confidence:         Number?   // Auto-extraction quality score (0-100)
  created_at:         String    // ISO timestamp
  updated_at:         String    // ISO timestamp
}
```

### Snippet Embedding Table (pgvector)

Snippet embeddings live in a separate table from entity embeddings to avoid cross-contamination in search results:

```
unerr.snippet_embeddings {
  id:                 UUID      // PK
  snippet_key:        String    // FK to ArangoDB snippets._key
  org_id:             String?   // null for community snippets
  repo_id:            String?   // null for org-wide/community
  source:             String    // "community" | "team" | "auto_extracted"
  category:           String    // for filtered search
  language:           String    // for filtered search
  model_version:      String    // embedding model version
  embedding:          vector(768)  // nomic-embed-text-v1.5, same as entity embeddings
  created_at:         DateTime

  UNIQUE (snippet_key, model_version)
  INDEX USING hnsw (embedding vector_cosine_ops)
}
```

**Why a separate table?** Entity embeddings (`unerr.entity_embeddings`) are scoped to `(repo_id, entity_key)` and filtered by `repoId`. Snippet embeddings cross repo boundaries (community snippets are global, team snippets are org-scoped). Mixing them in one table would require complex filter logic and risk polluting entity search with snippet results (and vice versa). A separate table with its own HNSW index provides clean isolation.

### Snippet Resolution Algorithm

When `get_snippets` is called, the resolver fills slots in priority order:

```
Input: { filePath, taskDescription, category, language, framework, limit }
Derive: language from file extension, framework from project detection

slots_remaining = limit (default 3)
result = []

Phase 1: Team snippets (exact match on category + language)
  candidates = querySnippets(orgId, {
    source: "team", category, language, status: "active"
  })
  sorted by upvotes DESC
  take min(candidates.length, slots_remaining)
  result.push(...taken)
  slots_remaining -= taken.length

Phase 2: Auto-extracted from same repo
  if slots_remaining > 0:
    candidates = querySnippets(orgId, {
      source: "auto_extracted", repoId, category, status: "active"
    })
    sorted by confidence DESC
    take min(candidates.length, slots_remaining)
    result.push(...taken)
    slots_remaining -= taken.length

Phase 3: Community snippets (exact match)
  if slots_remaining > 0:
    candidates = querySnippets(null, {
      source: "community", category, language, framework, status: "active"
    })
    sorted by upvotes DESC
    take min(candidates.length, slots_remaining)
    result.push(...taken)
    slots_remaining -= taken.length

Phase 4: Semantic fill (embed taskDescription, search across all sources)
  if slots_remaining > 0 AND taskDescription != null:
    queryEmbedding = embedQuery(taskDescription)
    semanticResults = vectorSearch(queryEmbedding, topK: slots_remaining * 2, {
      filter: orgId OR orgId IS NULL,
      category, language
    })
    deduplicate against result (by _key)
    take min(deduplicated.length, slots_remaining)
    result.push(...taken)

return result (max: limit)
```

**Why this priority order?**
1. **Team snippets first** — the team's own conventions are the highest-signal examples. A team's "how we do auth" is more relevant than a generic community pattern.
2. **Auto-extracted second** — patterns proven in the same repo are highly relevant context, but haven't been curated by a human (lower confidence than pinned team snippets).
3. **Community third** — curated by the unerr team, these are well-known best practices but may not match the team's specific conventions.
4. **Semantic last** — fills remaining slots with the most semantically relevant snippets regardless of source. Acts as a catch-all when category filters are too narrow.

### Snippet Lifecycle

```
Auto-extracted path:
  indexing completes
      │
      ▼
  extractSnippetCandidatesWorkflow
      │
      ▼
  draft ──── team lead reviews ──── promote ──► active
      │                                            │
      │                                            │ deprecate
      │                                            ▼
      └──── dismiss ──────────────────────────► deprecated

Manual/pin path:
  user creates or pins
      │
      ▼
  active (team snippets go straight to active)
      │
      │ edit → version incremented
      │ deprecate
      ▼
  deprecated

Community contribution path:
  user creates with scope = "community"
      │
      ▼
  draft ──── unerr team reviews ──── approve ──► active
      │                                            │
      │                                            │ deprecate
      └──── reject ───────────────────────────► deprecated
```

### Plan Gating

Snippet features are gated by plan tier (Phase 8 feature flags):

| Feature | Free | Pro | Max | Teams | Enterprise |
|---|---|---|---|---|---|
| View community snippets | Yes | Yes | Yes | Yes | Yes |
| `get_snippets` MCP tool (community only) | Yes | Yes | Yes | Yes | Yes |
| `search_snippets` MCP tool | Yes | Yes | Yes | Yes | Yes |
| Contribute community snippets | Yes | Yes | Yes | Yes | Yes |
| View auto-extracted suggestions | — | Yes | Yes | Yes | Yes |
| `get_snippets` includes auto-extracted | — | Yes | Yes | Yes | Yes |
| Pin entity as team snippet (`pin_snippet`) | — | — | — | Yes | Yes |
| Team snippet library | — | — | — | Yes | Yes |
| Custom snippet categories | — | — | — | — | Yes |
| Cross-repo snippet sharing (org-wide) | — | — | — | — | Yes |

### Integration Points with Other Phases

| Phase | Integration | Direction |
|---|---|---|
| **Phase 1** (Indexing) | Entity data used for `pin_snippet` (entity body → snippet code) | Phase 1 → Phase 9 |
| **Phase 3** (Semantic Search) | Embedding pipeline reused for snippet embeddings; `IVectorSearch.embed/search` | Phase 3 → Phase 9 |
| **Phase 6** (Patterns) | Auto-extraction uses entity quality signals; pattern exemplars become snippet candidates | Phase 6 → Phase 9 |
| **Phase 7** (PR Review) | PR review can suggest pinning well-written functions from reviewed PRs | Phase 7 → Phase 9 |
| **Phase 8** (Billing) | Feature gating by plan; `embed` calls tagged in Langfuse for cost tracking | Phase 8 → Phase 9 |
| **Phase 10b** (Local Proxy) | Snippet data synced to local CozoDB as `snippets` relation (v3 snapshot) | Phase 9 → Phase 10b |
| **Bootstrap Rule** | Agent instructions updated to call `get_snippets` during implementation tasks | Phase 9 → Phase 2 |

---

## 1.4 Reliability & Resilience

### Failure Scenario Matrix

| # | Failure | Detection | Recovery | User Impact |
|---|---------|-----------|----------|-------------|
| 1 | **`get_snippets` — ArangoDB query timeout** | AQL query exceeds 5s timeout | Return empty snippets array with `_meta.error: "snippet lookup timed out"`. Agent proceeds without snippets. | Agent works without exemplar context. Code quality may be slightly lower but functionality unaffected. |
| 2 | **`get_snippets` — semantic search (pgvector) timeout** | Embedding or vector search exceeds 5s | Skip Phase 4 (semantic fill) of resolution. Return snippets from Phases 1-3 only. | Fewer snippets returned. Exact-match snippets still provided. |
| 3 | **`pin_snippet` — entity not found in graph** | `IGraphStore.getEntity()` returns null | Return MCP error: `"Entity not found. The entity may have been removed by a recent re-index. Try searching for it with search_code."` | Pin fails. User can search for the entity and retry. |
| 4 | **`pin_snippet` — embedding fails** | `IVectorSearch.embed()` throws | Snippet created in ArangoDB without embedding. Response includes `_meta.embedded: false, note: "Snippet saved but semantic search unavailable. Will be embedded on next sync."` Retry embedding in next `embedSnippetsWorkflow` run. | Snippet exists but not semantically searchable until next embedding run. Exact-match queries still find it. |
| 5 | **Auto-extraction — no candidates meet threshold** | `scoreAndFilter` returns 0 candidates | Workflow completes successfully with 0 snippets created. Log: `"No snippet candidates found for {repoId}."` | No auto-extracted suggestions visible. Normal — not every repo has snippet-worthy entities. |
| 6 | **Auto-extraction — re-indexing duplicates** | Same entity extracted again after re-index | `createDraftSnippets` checks for existing snippet with same `entity_ref`. If found, skip. | No duplicates. Idempotent. |
| 7 | **Community snippet — inappropriate content** | User-submitted snippet contains malicious code or offensive content | Community snippets start as `draft` and require unerr team review before `active`. Admin can deprecate at any time. Snippets flagged by users go to review queue. | Inappropriate content never reaches agent context (draft snippets excluded from `get_snippets`). |
| 8 | **Snippet embedding model version mismatch** | CLI or cloud uses different embedding model version | `snippet_embeddings` table includes `model_version` column. Search uses same model as the stored embeddings. On model upgrade, re-embed all snippets via `reembedSnippetsWorkflow`. | Brief period of degraded semantic search quality during model transition. |
| 9 | **Stale snippet — code entity was deleted or significantly changed** | Snippet's `entity_ref` no longer exists in graph after re-indexing | Background check during `extractSnippetCandidatesWorkflow`: if entity_ref is orphaned, mark snippet status as `deprecated` and add `_meta.orphaned: true`. | Snippet removed from active results. Dashboard shows "Source entity no longer exists" warning. |
| 10 | **Large snippet code (>5000 chars)** | Code length check during creation | Truncate code to 5000 chars with annotation: `"[truncated — original: {N} chars]"`. Full code available via `entity_ref` link in knowledge graph. | Snippet shows truncated preview. Agent can fetch full code via `get_function` if needed. |

### Content Safety for Community Snippets

Community snippets are user-contributed and publicly visible. Safety measures:

1. **Review gate:** All community contributions start as `draft`. Unerr team reviews and approves before `active`.
2. **Lint check:** On submission, snippet code is parsed with tree-sitter. If parsing fails, submission is rejected (prevents non-code content).
3. **Size limits:** Max 5000 chars for code, 500 chars for description, 200 chars for title.
4. **Rate limit:** Max 10 community snippet submissions per user per day.
5. **Flag mechanism:** Users can flag community snippets. After 3 flags, snippet is auto-set to `draft` pending review.
6. **No execution:** Snippets are text injected into agent context. They are never executed on the server. The agent decides whether to use the code.

---

## 1.5 Performance Considerations

### Latency Budgets

| Operation | Target | Expected | Notes |
|---|---|---|---|
| `get_snippets` (exact match, no semantic) | <50ms | ~30ms | 3 AQL queries in parallel |
| `get_snippets` (with semantic fill) | <200ms | ~150ms | Adds embedding + pgvector search |
| `search_snippets` (semantic only) | <150ms | ~100ms | Embed query + vector search + fetch |
| `pin_snippet` (create + embed) | <500ms | ~300ms | ArangoDB upsert + embedding generation |
| Auto-extraction per repo | <30s | ~15s | AQL candidate query + scoring + batch upsert |
| Snippet dashboard page load | <500ms | ~200ms | Paginated AQL query |
| Community snippet list (global) | <300ms | ~150ms | Filtered AQL with pagination |

### Snippet Library Scale Estimates

| Source | Snippets per org | Snippets global | Notes |
|---|---|---|---|
| Community | N/A (global) | 200-500 (curated) | Grows slowly — manual review gate |
| Team (per org) | 20-100 | — | Pinned by developers |
| Auto-extracted (per repo) | 10-20 | — | Top candidates only |
| **Total per org** | **50-200** | — | Team + auto-extracted + community |

At these volumes, ArangoDB queries are fast (<10ms for filtered scans). pgvector HNSW search across 1000 snippets is ~10ms. No scaling concerns at expected volumes.

### Embedding Cost

Snippet embedding uses the same model as entity embeddings (`nomic-embed-text-v1.5`). Cost per embedding is negligible (~$0.001 per snippet). This is not budget-gated — embedding cost is infrastructure cost, not per-user LLM cost.

### Response Size

Each snippet returned by `get_snippets` includes the full code (up to 5000 chars). With `limit: 3`, the maximum response size is ~15KB. This is well within MCP response limits and adds minimal latency.

---

## 1.6 Phase Bridge → Phase 10b & Beyond

Phase 9 is designed so that subsequent phases can extend the snippet library without refactoring.

### What Phase 10b inherits from Phase 9

| Phase 9 artifact | Phase 10b usage | Change type |
|---|---|---|
| **ArangoDB `snippets` collection** | `syncLocalGraphWorkflow` extended to export snippets to v3 snapshot | Additive — add snippets to export query |
| **CozoDB `snippets` relation** (if synced) | Local `get_snippets` resolution uses CozoDB for team + auto-extracted snippets | Additive — new CozoDB relation, new routing entry |
| **`get_snippets` MCP tool** | Routed locally for team/auto-extracted snippets; cloud for community + semantic | Routing table entry addition |

### What Phase 9 must NOT do (to avoid future rework)

1. **Do not couple snippet resolution to ArangoDB directly.** Use the `IGraphStore.querySnippets()` port method. Phase 10b's local CozoDB needs the same resolution logic against a different store.
2. **Do not embed snippet text inline in the embedding pipeline.** Use the same `IVectorSearch.embed()` port that entity embeddings use. This ensures model upgrades propagate uniformly.
3. **Do not hardcode the snippet category enum.** Store categories as strings, validate against a configurable list. Enterprise plans can add custom categories without schema migration.
4. **Do not assume snippets are always fetched from ArangoDB.** The resolution algorithm should accept a `querySnippets` function parameter, enabling Phase 10b to inject a CozoDB-backed implementation for local resolution.

### Bootstrap Rule Update

Phase 9 updates the Bootstrap Rule (`.cursor/rules/unerr.mdc`) to include snippet instructions:

```
Before implementing a feature:
  1. Call get_rules to understand constraints
  2. Call get_snippets with a description of what you're implementing
  3. Use returned snippets as reference implementations
  4. Follow the team's patterns shown in snippets
```

`RULE_VERSION` bumps from `"1.0.0"` to `"1.1.0"`. The Auto-PR onboarding flow (Phase 2) regenerates the rule file on the next onboarding trigger.

---

# Part 2: Implementation & Tracing Tracker

## 2.1 Infrastructure Layer

- [ ] **P9-INFRA-01: Create Supabase migration for `unerr.snippet_embeddings` table** — M
  - Table: `unerr.snippet_embeddings`
  - Columns: `id` (UUID PK), `snippet_key` (String), `org_id` (String, nullable), `repo_id` (String, nullable), `source` (String), `category` (String), `language` (String), `model_version` (String), `embedding` (vector(768)), `created_at` (timestamptz)
  - Unique constraint: `(snippet_key, model_version)`
  - HNSW index: `ON embedding USING hnsw (embedding vector_cosine_ops)`
  - Enable `pgvector` extension if not already enabled (should be from Phase 3)
  - **Test:** `pnpm migrate` succeeds. Insert a test embedding → vector search returns it. Unique constraint enforced.
  - **Depends on:** Phase 3 pgvector setup
  - **Files:** `supabase/migrations/YYYYMMDDHHMMSS_create_snippet_embeddings.sql`
  - Notes: _____

- [ ] **P9-INFRA-02: Add Phase 9 env vars to `env.mjs`** — S
  - New variables:
    - `SNIPPET_AUTO_EXTRACT_THRESHOLD` (default: `50` — quality score threshold)
    - `SNIPPET_MAX_PER_REPO` (default: `20` — max auto-extracted candidates per repo)
    - `SNIPPET_MAX_CODE_LENGTH` (default: `5000` — chars)
  - All optional with defaults
  - **Test:** `pnpm build` succeeds without these vars.
  - **Depends on:** Nothing
  - **Files:** `env.mjs`, `.env.example`
  - Notes: _____

---

## 2.2 Database & Schema Layer

- [ ] **P9-DB-01: Define full `SnippetDoc` type in `lib/ports/types.ts`** — M
  - Replace the current open-ended `SnippetDoc` stub with typed fields:
    - `_key`, `title`, `description`, `category`, `language`, `framework?`, `code`, `context?`, `tags[]`, `source`, `org_id?`, `repo_id?`, `entity_ref?`, `upvotes`, `verified`, `created_by`, `version`, `status`, `confidence?`, `created_at`, `updated_at`
  - Define `SnippetCategory` type with the 10 allowed values
  - Define `SnippetSource` type: `"community" | "team" | "auto_extracted"`
  - Define `SnippetStatus` type: `"active" | "draft" | "deprecated"`
  - Update `SnippetFilter` with typed filter fields:
    - `orgId?`, `repoId?`, `source?`, `category?`, `language?`, `framework?`, `status?`, `entityRef?`, `createdBy?`, `limit?`, `offset?`
  - **Test:** Type-check succeeds. All existing `SnippetDoc` references compile.
  - **Depends on:** Nothing
  - **Files:** `lib/ports/types.ts` (modified)
  - Notes: _____

- [ ] **P9-DB-02: Create ArangoDB indexes for snippet queries** — S
  - Add persistent indexes on `snippets` collection:
    - `(source, status, category)` — for priority-phase queries
    - `(org_id, source, status)` — for team snippet resolution
    - `(entity_ref)` — for deduplication during auto-extraction
  - Indexes created in `ensureCollections()` in `arango-graph-store.ts`
  - **Test:** Queries using these field combinations use index scans (verify via AQL explain).
  - **Depends on:** P9-DB-01
  - **Files:** `lib/adapters/arango-graph-store.ts` (modified — add indexes)
  - Notes: _____

---

## 2.3 Ports & Adapters Layer

- [ ] **P9-ADAPT-01: Implement `upsertSnippet` in `ArangoGraphStore`** — M
  - Replace no-op stub with real AQL:
    - `UPSERT { _key: @key } INSERT @doc UPDATE @doc IN snippets`
    - Set `updated_at` on update
    - Validate required fields before upsert
  - **Test:** Upsert new snippet → document created. Upsert same key → document updated. Missing required field → error thrown.
  - **Depends on:** P9-DB-01
  - **Files:** `lib/adapters/arango-graph-store.ts` (modified)
  - **Acceptance:** ArangoDB document created/updated correctly. `_key` uniqueness enforced.
  - Notes: _____

- [ ] **P9-ADAPT-02: Implement `querySnippets` in `ArangoGraphStore`** — L
  - Replace no-op stub with real AQL:
    - Support all `SnippetFilter` fields as optional AQL filters
    - Apply `FILTER` clauses dynamically based on provided filter fields
    - Support pagination via `limit` + `offset`
    - Support sorting: by `upvotes DESC` (community/team), by `confidence DESC` (auto-extracted)
    - Return full `SnippetDoc[]`
  - Community queries: `org_id == null AND source == "community"`
  - Team queries: `org_id == @orgId AND source == "team"`
  - Auto-extracted queries: `org_id == @orgId AND repo_id == @repoId AND source == "auto_extracted"`
  - **Test:** Query with category filter → only matching snippets. Query with source filter → correct source. Pagination: limit 5, offset 10 → correct slice. Empty result → empty array.
  - **Depends on:** P9-DB-01, P9-DB-02
  - **Files:** `lib/adapters/arango-graph-store.ts` (modified)
  - **Acceptance:** All filter combinations work. Pagination correct. Sort order correct.
  - Notes: _____

- [ ] **P9-ADAPT-03: Implement `InMemoryGraphStore` snippet methods** — S
  - Add `snippets: Map<string, SnippetDoc>` to the in-memory fake
  - `upsertSnippet` → map.set by `_key`
  - `querySnippets` → iterate map, apply filters, sort, paginate
  - Used for all unit tests and DI container tests
  - **Test:** Upsert + query round-trip works. Filter by source/category works.
  - **Depends on:** P9-DB-01
  - **Files:** `lib/di/fakes.ts` (modified)
  - Notes: _____

- [ ] **P9-ADAPT-04: Extend `IVectorSearch` with snippet embedding support** — M
  - Add methods or extend existing ones:
    - `upsertSnippetEmbedding(snippetKey, embedding, metadata)` → insert into `unerr.snippet_embeddings`
    - `searchSnippets(embedding, topK, filter?)` → search `unerr.snippet_embeddings` with cosine distance
    - `deleteSnippetEmbedding(snippetKey)` → delete from `unerr.snippet_embeddings`
  - Filter support: `orgId`, `source`, `category`, `language`
  - Implement in `LlamaindexVectorSearch` adapter
  - Implement in `FakeVectorSearch` (in-memory)
  - **Test:** Upsert snippet embedding → search returns it. Filter by category → only matching. Delete → no longer found.
  - **Depends on:** P9-INFRA-01, Phase 3 IVectorSearch
  - **Files:** `lib/ports/vector-search.ts` (modified), `lib/adapters/llamaindex-vector-search.ts` (modified), `lib/di/fakes.ts` (modified)
  - Notes: _____

---

## 2.4 Backend / API Layer

### Snippet Domain Logic

- [ ] **P9-API-01: Create snippet resolution module** — L
  - `resolveSnippets(ctx, filter, container): Promise<ResolvedSnippet[]>`
  - Implements the 4-phase priority resolution algorithm:
    1. Team snippets (exact match)
    2. Auto-extracted from same repo
    3. Community snippets (exact match)
    4. Semantic fill (embed + vector search)
  - Accepts `querySnippets` function as parameter (port-agnostic for Phase 10b)
  - Deduplication by `_key`
  - Annotates each snippet with `_meta.priority` and `_meta.matchType`
  - Language detection from file extension (for `filePath` input)
  - **Test:** With 2 team, 3 community, 5 semantic results → returns team first. Limit 3 → only 3 returned. No team/community → semantic fills all slots. Empty library → empty result.
  - **Depends on:** P9-ADAPT-02, P9-ADAPT-04
  - **Files:** `lib/snippets/resolver.ts` (new)
  - **Acceptance:** Priority order correct. Deduplication works. Limit respected.
  - Notes: _____

- [ ] **P9-API-02: Create auto-extraction pipeline** — L
  - `identifyCandidates(orgId, repoId, container): Promise<CandidateEntity[]>`
    - ArangoDB query for entities with: callerCount >= 3, bodyLength < 3000 chars, non-empty signature
  - `scoreCandidate(entity, callerCount): number`
    - Quality score: popularity (callers) + documentation + conciseness + signature quality
  - `inferCategory(entity): SnippetCategory`
    - Heuristic categorization from entity file path, imports, and naming patterns
  - `createDraftSnippets(candidates, orgId, repoId, container): Promise<number>`
    - Deduplicates against existing snippets with same `entity_ref`
    - Creates draft snippets in ArangoDB
    - Returns count of created snippets
  - **Test:** Entity with 5 callers + docstring + 30 lines → high score. Entity with 0 callers + 200 lines → below threshold. Same entity_ref → skip (deduplicate). Category inference: test file → "testing", auth file → "security".
  - **Depends on:** P9-ADAPT-01, P9-ADAPT-02
  - **Files:** `lib/snippets/extractor.ts` (new)
  - Notes: _____

- [ ] **P9-API-03: Create snippet embedding module** — M
  - `embedSnippet(snippet, container): Promise<void>`
    - Concatenates: `title + "\n" + description + "\n" + code`
    - Calls `IVectorSearch.embed([text])`
    - Calls snippet-specific upsert with metadata (orgId, source, category, language)
  - `embedSnippetBatch(snippets, container): Promise<void>`
    - Batch version for auto-extraction pipeline
    - Processes in chunks of 50 (same as entity embedding batch size)
  - **Test:** Single snippet → embedding created. Batch of 20 → all embedded. Duplicate key → upsert (update, not error).
  - **Depends on:** P9-ADAPT-04
  - **Files:** `lib/snippets/embedder.ts` (new)
  - Notes: _____

### MCP Tools

- [ ] **P9-API-04: Create `get_snippets` MCP tool** — L
  - Tool definition:
    ```
    name: "get_snippets"
    description: "Get reference code snippets relevant to the current file and task.
                  Call this before implementing a feature to see how your team writes similar code."
    inputSchema: { filePath (required), taskDescription, category, limit (default 3) }
    ```
  - Handler: calls `resolveSnippets()` from P9-API-01
  - Response format: array of snippets with title, code, context, source, category, `_meta`
  - Code truncation: if snippet code > 3000 chars in response, truncate with annotation
  - Plan gating: Free plan gets community snippets only. Pro+ gets auto-extracted. Teams+ gets team snippets.
  - **Test:** With team snippets → team snippets returned first. With category filter → only matching. Limit respected. Free plan → no team/auto-extracted snippets.
  - **Depends on:** P9-API-01, register in `lib/mcp/tools/index.ts`
  - **Files:** `lib/mcp/tools/snippets.ts` (new), `lib/mcp/tools/index.ts` (modified)
  - **Acceptance:** Tool registered. Resolution priority correct. Plan gating works.
  - Notes: _____

- [ ] **P9-API-05: Create `search_snippets` MCP tool** — M
  - Tool definition:
    ```
    name: "search_snippets"
    description: "Search for code snippets by natural language description or pattern."
    inputSchema: { query (required), category, language, framework, source, limit (default 5) }
    ```
  - Handler: embeds query → searches `snippet_embeddings` → fetches full snippets from ArangoDB
  - Filters: orgId (team + community visible), category, language, source
  - **Test:** Search "optimistic update" → returns UI-related snippets. Category filter → only matching. Source filter → only matching source. Empty results → empty array.
  - **Depends on:** P9-ADAPT-04, register in `lib/mcp/tools/index.ts`
  - **Files:** `lib/mcp/tools/snippets.ts` (modified), `lib/mcp/tools/index.ts` (modified)
  - Notes: _____

- [ ] **P9-API-06: Create `pin_snippet` MCP tool** — M
  - Tool definition:
    ```
    name: "pin_snippet"
    description: "Pin a code entity as a reference snippet for your team."
    inputSchema: { entityId (required), title (required), category (required), description }
    ```
  - Handler:
    1. Check plan: require Teams/Enterprise
    2. Fetch entity from graph store
    3. Create snippet from entity data
    4. Embed snippet
    5. Return success with snippet ID
  - **Test:** Valid entity + Teams plan → snippet created + embedded. Free plan → error. Entity not found → error. Missing title → validation error.
  - **Depends on:** P9-ADAPT-01, P9-API-03, register in `lib/mcp/tools/index.ts`
  - **Files:** `lib/mcp/tools/snippets.ts` (modified), `lib/mcp/tools/index.ts` (modified)
  - Notes: _____

### API Routes

- [ ] **P9-API-07: Create `GET /api/snippets` route** — M
  - Returns paginated snippet list for the authenticated user's org
  - Query params: `source`, `category`, `language`, `status`, `repoId`, `limit`, `offset`
  - Response: `{ snippets: SnippetDoc[], total: number, limit: number, offset: number }`
  - Includes community snippets (orgId = null) alongside team snippets
  - Auth: Better Auth session
  - **Test:** Returns snippets. Filters work. Pagination correct. Community included. Other org's snippets excluded.
  - **Depends on:** P9-ADAPT-02
  - **Files:** `app/api/snippets/route.ts` (new)
  - Notes: _____

- [ ] **P9-API-08: Create `POST /api/snippets` route** — M
  - Creates a new snippet (manual creation from dashboard)
  - Input: `{ title, description, category, language, code, context?, tags?, framework?, scope: "team" | "community" }`
  - Validation: required fields, code length < 5000, title < 200, description < 500
  - If scope = "team": require Teams/Enterprise plan; set `source: "team"`, `status: "active"`
  - If scope = "community": any plan; set `source: "community"`, `status: "draft"` (pending review)
  - Creates snippet + embeds it
  - Auth: Better Auth session
  - **Test:** Valid input → snippet created. Missing title → 400. Code too long → 400. Free plan + team scope → 403.
  - **Depends on:** P9-ADAPT-01, P9-API-03
  - **Files:** `app/api/snippets/route.ts` (modified — add POST)
  - Notes: _____

- [ ] **P9-API-09: Create `PATCH /api/snippets/[id]` route** — S
  - Updates snippet fields (title, description, category, tags, status)
  - Used for: editing, promoting (draft → active), deprecating
  - Only owner or org admin can edit
  - Increments `version` on edit
  - Re-embeds if title, description, or code changed
  - Auth: Better Auth session (owner or admin)
  - **Test:** Owner edits → updated. Non-owner → 403. Promote draft → active. Deprecate → deprecated. Version incremented.
  - **Depends on:** P9-ADAPT-01, P9-API-03
  - **Files:** `app/api/snippets/[id]/route.ts` (new)
  - Notes: _____

- [ ] **P9-API-10: Create `POST /api/snippets/[id]/upvote` route** — S
  - Increments upvote count on a snippet
  - One upvote per user per snippet (tracked via `unerr.snippet_upvotes` or Redis set)
  - Auth: Better Auth session
  - **Test:** First upvote → count incremented. Second upvote by same user → no-op. Different user → count incremented again.
  - **Depends on:** P9-ADAPT-01
  - **Files:** `app/api/snippets/[id]/upvote/route.ts` (new)
  - Notes: _____

### Temporal Workflows

- [ ] **P9-API-11: Create `extractSnippetCandidatesWorkflow`** — L
  - Workflow ID: `extract-snippets-{orgId}-{repoId}` (idempotent)
  - Queue: `light-llm-queue`
  - Triggered: after `embedRepoWorkflow` completes (chained)
  - Steps:
    1. `identifyCandidates` activity → AQL query for high-quality entities
    2. `scoreAndFilter` activity → quality scoring, threshold filter, top N
    3. `createDraftSnippets` activity → ArangoDB upsert (deduplicated)
    4. `embedDraftSnippets` activity → batch embed via IVectorSearch
  - On failure: retry individual activities 3x. If all fail, workflow fails (no partial state — snippets are idempotent).
  - **Test:** Temporal replay test with mock activities. Correct activity order. Deduplication on re-run.
  - **Depends on:** P9-API-02, P9-API-03
  - **Files:** `lib/temporal/workflows/extract-snippets.ts` (new)
  - Notes: _____

- [ ] **P9-API-12: Chain `extractSnippetCandidatesWorkflow` from `embedRepoWorkflow`** — S
  - After `embedRepoWorkflow` completes, start `extractSnippetCandidatesWorkflow` for the same repo
  - Only triggers if org has Pro+ plan (auto-extraction is plan-gated)
  - Uses same chaining pattern as Phase 10a's `syncLocalGraphWorkflow` trigger
  - **Test:** Embedding completes on Pro plan → extraction starts. Free plan → no extraction. Embedding fails → extraction NOT started.
  - **Depends on:** P9-API-11, Phase 3 `embedRepoWorkflow`
  - **Files:** Modify existing trigger chain (same location as Phase 3 → Phase 10a chain)
  - Notes: _____

- [ ] **P9-API-13: Update Bootstrap Rule with snippet instructions** — S
  - Modify `lib/onboarding/bootstrap-rule.ts`:
    - Add `get_snippets` to the tool instruction section
    - Add workflow step: "Before implementing, call get_snippets to see team examples"
    - Bump `RULE_VERSION` from `"1.0.0"` to `"1.1.0"`
  - The Auto-PR flow re-generates the rule file on next onboarding trigger
  - **Test:** `generateBootstrapRule("repo")` includes `get_snippets` instruction. Version is `"1.1.0"`.
  - **Depends on:** P9-API-04
  - **Files:** `lib/onboarding/bootstrap-rule.ts` (modified)
  - Notes: _____

---

## 2.5 Frontend / UI Layer

- [ ] **P9-UI-01: Create snippet library page at `/snippets`** — L
  - Layout: Search bar + filter sidebar + snippet card grid
  - Sections:
    - **Search bar:** text input for keyword/semantic search
    - **Filters:** source (all/team/community/auto-extracted), category (10 options), language, framework
    - **Snippet cards:** title, description preview (2 lines), category badge, source badge, language badge, upvote count
    - **Pagination:** 20 snippets per page
  - Data source: `GET /api/snippets`
  - Click snippet card → navigate to `/snippets/{id}`
  - "New Snippet" button (visible for Teams/Enterprise or community contribution)
  - Design: Follow golden page pattern. `glass-card` for snippet cards. Category badges use `bg-rail-fade` for active filter.
  - **Test:** Snippets render. Filters work. Search works. Pagination works. Empty state: "No snippets yet" message.
  - **Depends on:** P9-API-07
  - **Files:** `app/(dashboard)/snippets/page.tsx` (new)
  - Notes: _____

- [ ] **P9-UI-02: Create snippet detail page at `/snippets/[id]`** — M
  - Layout: Snippet metadata + syntax-highlighted code + action buttons
  - Sections:
    - **Header:** title, category badge, source badge, author, created date, version
    - **Description:** full description text
    - **Code:** syntax-highlighted code block (use `font-mono`, detect language)
    - **Context:** "When to use" section
    - **Tags:** tag chips
    - **Actions:**
      - Upvote button (with count)
      - Edit button (if owner or admin)
      - Deprecate button (if owner or admin)
      - "View source entity" link (if `entity_ref` exists)
      - Copy code button
  - Data source: `GET /api/snippets/{id}` (or fetched from list)
  - **Test:** All sections render. Syntax highlighting works. Edit button visible for owner. Copy button copies code.
  - **Depends on:** P9-API-07
  - **Files:** `app/(dashboard)/snippets/[id]/page.tsx` (new)
  - Notes: _____

- [ ] **P9-UI-03: Create snippet creation form at `/snippets/new`** — M
  - Layout: Form with live preview
  - Fields:
    - Title (text input, required)
    - Description (textarea, required)
    - Category (select, required)
    - Language (select, auto-detected from code)
    - Framework (select, optional)
    - Code (code editor area with `font-mono`, required)
    - Context / when to use (textarea, optional)
    - Tags (comma-separated input)
    - Scope: "Team snippet" or "Community contribution" (radio)
  - Live preview: right side shows rendered snippet card as it will appear
  - Submit: `POST /api/snippets`
  - Plan check: "Team snippet" option only visible for Teams/Enterprise
  - **Test:** Form validates required fields. Submit creates snippet. Preview updates in real-time. Plan gating works.
  - **Depends on:** P9-API-08
  - **Files:** `app/(dashboard)/snippets/new/page.tsx` (new)
  - Notes: _____

- [ ] **P9-UI-04: Create auto-extracted suggestions page at `/snippets/suggestions`** — M
  - Layout: List of draft auto-extracted snippets with promote/dismiss actions
  - Sections:
    - **Candidate card:** title, code preview (first 10 lines), quality score bar, caller count, source file path
    - **Actions:** "Promote" (edit fields → make active), "Dismiss" (set deprecated)
    - **Empty state:** "No suggestions yet. Snippets are extracted when repos are indexed."
  - Data source: `GET /api/snippets?source=auto_extracted&status=draft`
  - Only visible on Pro+ plans
  - **Test:** Draft snippets render. Promote updates status. Dismiss deprecates. Empty state shown when no drafts.
  - **Depends on:** P9-API-07, P9-API-09
  - **Files:** `app/(dashboard)/snippets/suggestions/page.tsx` (new)
  - Notes: _____

- [ ] **P9-UI-05: Add "Snippets" link to dashboard nav** — S
  - Add to `components/dashboard/dashboard-nav.tsx`:
    - "Snippets" link → `/snippets` (icon: `BookMarked` from Lucide, `h-4 w-4`)
  - Position: in Platform section after Search
  - Show badge count of unreviewed suggestions (if Pro+ plan and drafts exist)
  - **Test:** Link renders. Navigation works. Badge shows count when drafts exist.
  - **Depends on:** P9-UI-01
  - **Files:** `components/dashboard/dashboard-nav.tsx` (modified)
  - Notes: _____

---

## 2.6 Testing & Verification

### Unit Tests

- [ ] **P9-TEST-01: Snippet resolution tests** — L
  - 2 team + 3 community → team first, then community
  - 1 team + 0 community + 5 semantic → team first, semantic fills remaining
  - Limit 3 with 10 candidates → only 3 returned
  - Category filter → only matching category
  - Empty library → empty result (no error)
  - Deduplication: same snippet from AQL and semantic → only once
  - Free plan → no team/auto-extracted snippets
  - **Depends on:** P9-API-01
  - **Files:** `lib/snippets/__tests__/resolver.test.ts`
  - Notes: _____

- [ ] **P9-TEST-02: Auto-extraction candidate scoring tests** — M
  - Entity with 5 callers + docstring + 30 lines → score > 50 (passes threshold)
  - Entity with 0 callers + 200 lines → score < 50 (filtered out)
  - Entity with 3 callers + no docstring + 40 lines → borderline (test threshold)
  - Category inference: test file → "testing", API route → "api_pattern"
  - Top 20 limit: 30 candidates → only top 20 by score
  - **Depends on:** P9-API-02
  - **Files:** `lib/snippets/__tests__/extractor.test.ts`
  - Notes: _____

- [ ] **P9-TEST-03: Auto-extraction deduplication tests** — S
  - Entity already has a snippet (same entity_ref) → skip
  - Entity has a deprecated snippet → still skip (don't re-suggest dismissed)
  - Entity with no existing snippet → create draft
  - **Depends on:** P9-API-02
  - **Files:** `lib/snippets/__tests__/extractor.test.ts`
  - Notes: _____

- [ ] **P9-TEST-04: Snippet embedding round-trip tests** — S
  - Embed snippet → search with similar query → snippet found
  - Search with unrelated query → snippet not in top results
  - Upsert same snippet key → embedding updated (not duplicated)
  - Delete snippet embedding → no longer found in search
  - **Depends on:** P9-API-03, P9-ADAPT-04
  - **Files:** `lib/snippets/__tests__/embedder.test.ts`
  - Notes: _____

- [ ] **P9-TEST-05: MCP tool `get_snippets` tests** — M
  - With filePath only → returns snippets matching file's language
  - With filePath + taskDescription → semantic fill applied
  - With category filter → only matching
  - Limit 3 → max 3 returned
  - Plan gating: Free → community only. Teams → team + community + auto-extracted.
  - Empty library → empty response (no error)
  - **Depends on:** P9-API-04
  - **Files:** `lib/mcp/tools/__tests__/snippets.test.ts`
  - Notes: _____

- [ ] **P9-TEST-06: MCP tool `pin_snippet` tests** — M
  - Valid entity + Teams plan → snippet created + embedded
  - Free plan → error returned with plan upgrade message
  - Entity not found → error returned
  - Missing required title → validation error
  - Pin same entity twice → second pin updates existing (by entity_ref)
  - **Depends on:** P9-API-06
  - **Files:** `lib/mcp/tools/__tests__/snippets.test.ts`
  - Notes: _____

- [ ] **P9-TEST-07: Snippet API route tests** — M
  - GET /api/snippets → returns paginated list
  - POST /api/snippets (team, valid) → created with status active
  - POST /api/snippets (community) → created with status draft
  - PATCH /api/snippets/{id} (owner) → updated, version incremented
  - PATCH /api/snippets/{id} (non-owner) → 403
  - POST /api/snippets/{id}/upvote → count incremented
  - POST /api/snippets/{id}/upvote again (same user) → no-op
  - **Depends on:** P9-API-07, P9-API-08, P9-API-09, P9-API-10
  - **Files:** `app/api/snippets/__tests__/route.test.ts`
  - Notes: _____

### Integration Tests

- [ ] **P9-TEST-08: Auto-extraction workflow integration test** — L
  - End-to-end: insert 50 entities into ArangoDB (varying quality) → run `extractSnippetCandidatesWorkflow` → verify correct candidates extracted → verify embeddings created
  - Check: high-quality entities selected, low-quality skipped
  - Check: existing snippets not duplicated
  - Requires: ArangoDB fake, pgvector fake
  - **Depends on:** P9-API-11
  - **Files:** `lib/temporal/workflows/__tests__/extract-snippets.integration.test.ts`
  - Notes: _____

- [ ] **P9-TEST-09: Snippet resolution end-to-end test** — M
  - Insert 5 team + 10 community + 20 auto-extracted snippets with embeddings → call `get_snippets` MCP tool → verify priority ordering correct
  - Verify: team snippets first, then auto-extracted (same repo), then community, then semantic fill
  - **Depends on:** P9-API-04, P9-ADAPT-02, P9-ADAPT-04
  - **Files:** `lib/snippets/__tests__/resolver.integration.test.ts`
  - Notes: _____

### E2E Tests

- [ ] **P9-TEST-10: Snippet library browse E2E** — M
  - Navigate to /snippets → see snippet cards → filter by category → see filtered results → click card → see detail page → copy code → verify clipboard
  - **Depends on:** P9-UI-01, P9-UI-02
  - **Files:** `e2e/snippets.spec.ts`
  - Notes: _____

- [ ] **P9-TEST-11: Snippet creation E2E** — M
  - Navigate to /snippets/new → fill form → submit → redirect to detail page → snippet visible in library
  - Team snippet: require Teams plan
  - Community: created as draft
  - **Depends on:** P9-UI-03
  - **Files:** `e2e/snippets.spec.ts`
  - Notes: _____

### Manual Verification

- [ ] **P9-TEST-12: Manual agent snippet workflow** — L
  - Index a real repo → auto-extraction runs → suggestions appear in dashboard
  - Team lead promotes 3 suggestions → they appear in `get_snippets` results
  - Agent calls `get_snippets` during implementation → receives team snippets
  - Agent calls `search_snippets` with natural language → semantically relevant results
  - Agent calls `pin_snippet` on a well-written function → snippet appears in library
  - **Depends on:** All P9 items
  - Notes: _____

---

## Dependency Graph

```
P9-INFRA-01 (snippet_embeddings table) ─── depends on Phase 3 pgvector
P9-INFRA-02 (env vars) ───────────────── independent

P9-DB-01 (SnippetDoc types) ───────────── independent
P9-DB-02 (ArangoDB indexes) ──────────── depends on P9-DB-01

P9-ADAPT-01 (upsertSnippet) ──────────── depends on P9-DB-01
P9-ADAPT-02 (querySnippets) ──────────── depends on P9-DB-01, P9-DB-02
P9-ADAPT-03 (InMemory fakes) ─────────── depends on P9-DB-01
P9-ADAPT-04 (IVectorSearch snippets) ─── depends on P9-INFRA-01

P9-API-01 (resolver) ──────────────────── depends on P9-ADAPT-02, P9-ADAPT-04
P9-API-02 (extractor) ─────────────────── depends on P9-ADAPT-01, P9-ADAPT-02
P9-API-03 (embedder) ──────────────────── depends on P9-ADAPT-04
P9-API-04 (get_snippets tool) ─────────── depends on P9-API-01
P9-API-05 (search_snippets tool) ──────── depends on P9-ADAPT-04
P9-API-06 (pin_snippet tool) ──────────── depends on P9-ADAPT-01, P9-API-03
P9-API-07 (GET /api/snippets) ─────────── depends on P9-ADAPT-02
P9-API-08 (POST /api/snippets) ────────── depends on P9-ADAPT-01, P9-API-03
P9-API-09 (PATCH /api/snippets) ───────── depends on P9-ADAPT-01
P9-API-10 (upvote) ────────────────────── depends on P9-ADAPT-01
P9-API-11 (extract workflow) ──────────── depends on P9-API-02, P9-API-03
P9-API-12 (chain from embed) ──────────── depends on P9-API-11
P9-API-13 (bootstrap rule update) ─────── depends on P9-API-04

P9-UI-01 (snippet library page) ───────── depends on P9-API-07
P9-UI-02 (snippet detail page) ────────── depends on P9-API-07
P9-UI-03 (snippet creation form) ──────── depends on P9-API-08
P9-UI-04 (suggestions page) ───────────── depends on P9-API-07, P9-API-09
P9-UI-05 (nav link) ───────────────────── depends on P9-UI-01

P9-TEST-01..12 ── depend on corresponding implementation items
```

**Recommended implementation order:**

1. **Infrastructure** (P9-INFRA-01..02) — pgvector table, env vars
2. **Types** (P9-DB-01..02) — SnippetDoc type, ArangoDB indexes
3. **Adapters** (P9-ADAPT-01..04) — upsertSnippet, querySnippets, fakes, IVectorSearch extension
4. **Domain logic** (P9-API-01..03) — resolver, extractor, embedder
5. **MCP tools** (P9-API-04..06) — get_snippets, search_snippets, pin_snippet
6. **API routes** (P9-API-07..10) — CRUD, upvote
7. **Temporal** (P9-API-11..12) — extraction workflow, chain trigger
8. **Bootstrap rule** (P9-API-13) — agent instructions update
9. **Frontend** (P9-UI-01..05) — library page, detail, creation, suggestions, nav
10. **Testing** (P9-TEST-01..12) — unit, integration, E2E, manual

---

## New Files Summary

```
lib/snippets/
  resolver.ts                    ← 4-phase priority snippet resolution
  extractor.ts                   ← Auto-extraction candidate scoring + creation
  embedder.ts                    ← Snippet embedding (single + batch)
lib/mcp/tools/
  snippets.ts                   ← get_snippets, search_snippets, pin_snippet MCP tools
lib/temporal/workflows/
  extract-snippets.ts            ← extractSnippetCandidatesWorkflow
app/api/snippets/
  route.ts                       ← GET (list) + POST (create)
  [id]/
    route.ts                     ← PATCH (update)
    upvote/route.ts              ← POST (upvote)
app/(dashboard)/snippets/
  page.tsx                       ← Snippet library browser
  [id]/page.tsx                  ← Snippet detail/edit
  new/page.tsx                   ← Manual snippet creation form
  suggestions/page.tsx           ← Auto-extracted candidate review
components/dashboard/
  snippet-card.tsx               ← Reusable snippet card component
supabase/migrations/
  YYYYMMDDHHMMSS_create_snippet_embeddings.sql
```

### Modified Files

```
lib/ports/types.ts               ← Full SnippetDoc + SnippetFilter types
lib/ports/vector-search.ts       ← Snippet embedding methods
lib/adapters/arango-graph-store.ts  ← upsertSnippet, querySnippets, indexes
lib/adapters/llamaindex-vector-search.ts  ← Snippet embedding table operations
lib/di/fakes.ts                  ← InMemory snippet store + FakeVectorSearch
lib/mcp/tools/index.ts           ← Register 3 new snippet tools
lib/onboarding/bootstrap-rule.ts ← Add get_snippets to agent instructions
components/dashboard/dashboard-nav.tsx  ← Snippets nav link
env.mjs                          ← SNIPPET_* variables
.env.example                     ← Document Phase 9 variables
```

---

## Revision Log

| Date | Author | Change |
|------|--------|--------|
| 2026-02-21 | — | Initial document created. 2 INFRA, 2 DB, 4 ADAPT, 13 API, 5 UI, 12 TEST items. Total: **38 tracker items.** |
