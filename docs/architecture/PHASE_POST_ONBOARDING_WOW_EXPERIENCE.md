# Post-Onboarding "Wow" Experience — Surface Hidden Intelligence

> **Phase Feature Statement:** _"After onboarding a repo, unerr surfaces the massive intelligence it generated — dead code, architectural violations, quality scores, domain glossary, ADRs, fan-in/fan-out hotspots — turning the health report into a 'how does it know this?' moment."_
>
> **Prerequisites:** [Phase 1 — GitHub Connect & Repo Indexing](./PHASE_1_GITHUB_CONNECT_AND_INDEXING.md) (entities + edges in ArangoDB), [Phase 4 — Business Justification & Taxonomy](./PHASE_4_BUSINESS_JUSTIFICATION_AND_TAXONOMY.md) (justifications, features, health report, ADRs, domain ontology, dead code detection, quality scoring), [Phase 6 — Pattern Enforcement & Rules Engine](./PHASE_6_PATTERN_ENFORCEMENT_AND_RULES_ENGINE.md) (rule creation via `graphStore.upsertRule()`)
>
> **Status:** Implemented (February 2026)

---

## Table of Contents

- [Overview](#overview)
- [Phase 1: Expanded Health Report](#phase-1-expanded-health-report)
  - [1A: Health Report Builder (4 → 13 Risk Types)](#1a-health-report-builder-4--13-risk-types)
  - [1B: Fix Guidance & Rule Templates](#1b-fix-guidance--rule-templates)
  - [1C: Health Insights API](#1c-health-insights-api)
  - [1D: InsightCard Component](#1d-insightcard-component)
  - [1E: Redesigned Health Report View](#1e-redesigned-health-report-view)
  - [1F: Pre-fill Rule Creation from Query Params](#1f-pre-fill-rule-creation-from-query-params)
- [Phase 2: Redesigned Overview Page](#phase-2-redesigned-overview-page)
  - [2A: Overview API](#2a-overview-api)
  - [2B: Overview Page Redesign](#2b-overview-page-redesign)
- [Phase 2.5: Annotated Code Viewer](#phase-25-annotated-code-viewer)
  - [2.5A: Enriched Entities API](#25a-enriched-entities-api)
  - [2.5B: Annotated Code Viewer Component](#25b-annotated-code-viewer-component)
- [Phase 2.6: Unified Activity Tab](#phase-26-unified-activity-tab)
  - [2.6A: Tab Consolidation](#26a-tab-consolidation)
  - [2.6B: Pipeline Run Detail Page](#26b-pipeline-run-detail-page)
- [Phase 3: ADR Browser Page](#phase-3-adr-browser-page)
- [Phase 4: Domain Glossary Page](#phase-4-domain-glossary-page)
- [Phase 5: Enhanced Entity Detail](#phase-5-enhanced-entity-detail)
- [Phase 6: Rule from Insight API](#phase-6-rule-from-insight-api)
- [Files Summary](#files-summary)
- [Verification](#verification)

---

## Overview

After repo onboarding (index → embed → justify → health report), unerr generates massive amounts of intelligence that was previously invisible to users. The health report showed only 4 basic risk types. ADRs, domain ontology, dead code, quality scores, drift alerts, architectural violations, graph connectivity — all generated and stored in ArangoDB, but no UI surfaced them.

**The gap:** We analyze every function down to its business purpose, detect dead code, score justification quality, extract domain vocabulary, generate architecture decision records, detect intent drift — and showed almost none of it.

This implementation transforms the post-onboarding experience into a "how does it know this?" moment by:
1. Expanding the health report from 4 to 13 risk types with graph-based analysis
2. Redesigning the overview page (renamed from Issues) with hero stats, top insights, domain intelligence, and Issues as a subsection
3. Building an annotated code viewer that interleaves business justifications with code, leading with purpose before code — designed for both developers and non-developers
4. Consolidating 5 activity-related tabs (Activity, Timeline, Commits, History, Pipeline) into a single unified Activity tab with pipeline run tracking
5. Adding ADR browser and domain glossary pages
6. Enhancing entity detail with quality scores, architectural patterns, and dead code warnings
7. Enabling one-click rule creation from any insight

---

## Phase 1: Expanded Health Report

### 1A: Health Report Builder (4 → 13 Risk Types)

**File:** `lib/justification/health-report-builder.ts` (rewritten)

The `buildHealthReport()` function now accepts optional `entities` and `edges` parameters. When provided, it runs 9 additional graph-based risk detectors on top of the original 4.

**Signature change:**
```typescript
// Before:
buildHealthReport(justifications, features, orgId, repoId)

// After (backward compatible — new params are optional):
buildHealthReport(justifications, features, orgId, repoId, entities?, edges?)
```

**13 Risk Types:**

| # | Risk Type | Category | Detection Logic |
|---|-----------|----------|----------------|
| 1 | `low_confidence` | quality | Justifications with confidence < 0.5 |
| 2 | `untested_vertical` | quality | VERTICAL entities with confidence < 0.6 |
| 3 | `single_entity_feature` | taxonomy | Features with only 1 entity |
| 4 | `high_utility_ratio` | taxonomy | >70% of entities classified as UTILITY |
| 5 | `dead_code` | dead_code | `detectDeadCode()` from `dead-code-detector.ts` — 0 inbound refs, not exported, not entry point |
| 6 | `architectural_violation` | architecture | Justifications with `architectural_pattern === "mixed"` |
| 7 | `low_quality_justification` | quality | `scoreJustification()` score < 0.5 |
| 8 | `high_fan_in` | complexity | Entities with ≥10 inbound `calls` edges |
| 9 | `high_fan_out` | complexity | Entities with ≥10 outbound `calls` edges |
| 10 | `circular_dependency` | architecture | Iterative DFS cycle detection on `calls` + `imports` edges (capped at 10 cycles) |
| 11 | `taxonomy_anomaly` | taxonomy | VERTICAL with 0 callers; HORIZONTAL with exactly 1 caller |
| 12 | `confidence_gap` | quality | Features with average_confidence < 0.6 |
| 13 | `missing_justification` | taxonomy | Entities without justifications (>5% threshold) |

**Extended risk item shape** (backward compatible):
```typescript
interface HealthRisk {
  riskType: string
  description: string
  severity: "low" | "medium" | "high"
  featureTag?: string
  entityId?: string
  // NEW optional fields:
  category?: "dead_code" | "architecture" | "quality" | "complexity" | "taxonomy"
  affectedCount?: number
  entities?: Array<{ id: string; name: string; filePath: string; detail?: string }>
}
```

**Schema changes:**
- `lib/justification/schemas.ts` — `HealthRiskSchema` extended with `category`, `affectedCount`, `entities`
- `lib/ports/types.ts` — `HealthReportDoc.risks` type extended to match

**Activity + Workflow changes:**
- `lib/temporal/activities/health-report.ts` — `buildAndStoreHealthReport()` now receives `FetchedData` (with entities + edges) instead of just `justifications`
- `lib/temporal/workflows/generate-health-report.ts` — Updated call site to pass `data` instead of `data.justifications`

### 1B: Fix Guidance & Rule Templates

**File:** `lib/health/fix-guidance.ts` (new)

Static mapping of `riskType` → `FixGuidance` for each of the 13 risk types:

```typescript
interface FixGuidance {
  title: string           // Human-readable title (e.g., "Dead Code Detected")
  icon: string            // Lucide icon name
  category: string        // Category grouping
  howToFix: string        // Guidance paragraph
  ruleTemplate: {         // Pre-filled rule for one-click creation
    title: string
    description: string
    type: RuleType
    enforcement: RuleEnforcement
    priority: number
  }
}
```

Also exports `CATEGORY_INFO` for display labels and icons per category.

### 1C: Health Insights API

**File:** `app/api/repos/[repoId]/health/insights/route.ts` (new)

`GET /api/repos/{repoId}/health/insights`

Fetches entities, edges, and justifications live from the graph store, runs the expanded `buildHealthReport()` with all 13 risk types, and returns:

```typescript
{
  report: HealthReportDoc,
  summary: {
    healthGrade: "A" | "B" | "C" | "D" | "F",
    totalInsights: number,
    criticalCount: number,
    categories: Record<string, number>,
  }
}
```

**Health grade formula:** A = 0 high, ≤0 medium; B = 0 high, ≤3 medium; C = 0 high, >3 medium; D = 1-2 high; F = 3+ high.

### 1D: InsightCard Component

**File:** `components/health/insight-card.tsx` (new)

Reusable glass-card component for each insight:
- Category icon (from `ICON_MAP`) + severity badge (color-coded)
- Title + affected count
- Description paragraph
- Expandable entity list (collapsed by default, toggle with chevron, max 20 shown)
- Collapsible "How to Fix" section with guidance text
- "Create Rule" button → links to `/repos/{repoId}/rules/new?title=...&description=...&type=...&enforcement=...&priority=...`

### 1E: Redesigned Health Report View

**File:** `components/health/health-report-view.tsx` (rewritten)

Replaced flat risk list with:

1. **Grade hero** — Large letter grade (A-F) with color + stat grid (total entities, justified, avg confidence, risk severity breakdown)
2. **Taxonomy breakdown** — VERTICAL/HORIZONTAL/UTILITY counts
3. **Category sections** — Risks grouped by category with section headers and icons:
   - Dead Code (Trash2 icon)
   - Architecture (Layers icon) — violations + circular deps
   - Quality (BadgeCheck icon) — low quality + confidence gaps
   - Complexity (Activity icon) — fan-in/fan-out hotspots
   - Taxonomy (Tag icon) — anomalies + orphans + missing justifications
4. Each category renders `InsightCard` components
5. Cost section at bottom (preserved from original)

Data source changed from `/api/repos/{repoId}/health` to `/api/repos/{repoId}/health/insights` (with fallback to original endpoint).

### 1F: Pre-fill Rule Creation from Query Params

**File:** `app/(dashboard)/repos/[repoId]/rules/new/page.tsx` (modified)

Now reads `useSearchParams()` for `title`, `description`, `type`, `enforcement`, `priority` query params. These are used as initial state values, enabling the "Create Rule" buttons on InsightCards to deep-link with pre-filled values.

---

## Phase 2: Redesigned Overview Page

### 2A: Overview API

**File:** `app/api/repos/[repoId]/overview/route.ts` (new)

`GET /api/repos/{repoId}/overview`

Aggregates data from multiple sources into a single payload:

```typescript
{
  healthGrade: "A" | "B" | "C" | "D" | "F" | null,
  stats: {
    totalEntities: number,
    featuresDiscovered: number,
    deadCodeCount: number,
    insightsFound: number,
    avgConfidence: number,
  },
  topInsights: Array<{ riskType, severity, description, affectedCount }>,  // top 3
  domainTerms: Array<{ term: string, frequency: number }>,  // top 12
  taxonomyBreakdown: Record<string, number>,
  projectDescription: string | null,
  techStack: string[],
}
```

Fetches health report, features, ontology, entities, edges in parallel.

### 2B: Overview Page Redesign

**File:** `app/(dashboard)/repos/[repoId]/page.tsx` (rewritten)

The "Issues" tab was renamed to **"Overview"** (with `Home` icon) to serve as the primary landing page. It provides a glimpse of what was extracted from the codebase, with Issues as a subsection rather than the entire page.

New layout:

1. **Hero stats row** — 4 glass cards in a grid:
   - Health Grade (large colored letter, A-F)
   - Entities Analyzed (number + subtitle)
   - Features Discovered (number + link to blueprint)
   - Insights Found (number + severity breakdown)

2. **Top Insights** — 3 most severe risks as compact cards. Severity dot + one-line description + "View Health Report →" link. If no insights, shows "No critical issues found" with emerald checkmark.

3. **Domain Intelligence + Language Distribution** — Side-by-side layout:
   - Domain card: project description, tech stack badges, top domain terms as pills
   - Language distribution chart (moved from code tab)

4. **Quick navigation** — Row of icon links: Code, Health, Blueprint, Patterns, ADRs, Glossary

5. **Issues subsection** — `IssuesView` component renders existing health risks below the overview content, providing the previous "Issues" functionality within the Overview tab.

All data is fetched server-side in `Promise.all()` for maximum performance.

---

## Phase 2.5: Annotated Code Viewer

The Code tab was redesigned to lead with business intelligence rather than raw code. When users open the Code tab, they immediately see what each code entity _does for the business_, with justifications and classifications interleaved with the actual code signatures.

**Design principle:** Both developers and non-developers should understand what the codebase does at a glance — no documentation study required. Business purpose leads before code.

### 2.5A: Enriched Entities API

**File:** `app/api/repos/[repoId]/entities/route.ts` (modified)

Added `?enrich=true` query parameter for file-scoped entity queries. When enriched, the API batch-fetches justifications for all entities in the file via `Promise.all()` and returns:

```typescript
{
  entities: Array<{
    // Standard entity fields
    id: string, name: string, kind: string, file_path: string, start_line: number, signature: string
    // Justification fields (when enrich=true)
    justification?: {
      taxonomy: "VERTICAL" | "HORIZONTAL" | "UTILITY"
      confidence: number
      businessPurpose: string
      featureTag: string
      domainConcepts: string[]
      semanticTriples?: Array<{ subject: string; predicate: string; object: string }>
      complianceTags?: string[]
      architecturalPattern?: string | null
      reasoning?: string | null
      modelTier?: string
      modelUsed?: string | null
    }
  }>
}
```

### 2.5B: Annotated Code Viewer Component

**File:** `components/code/annotated-code-viewer.tsx` (new, ~740 lines)

Full-page code intelligence viewer with two panels:

**Left panel — File tree:**
- Sorted IDE-style: folders first (alphabetical), then files (alphabetical), recursively at all levels
- Search/filter input for quick file lookup
- Scrollable with `min-h-0` flex fix
- Built using `lib/utils/file-tree-builder.ts` with new `sortTree()` function

**Right panel — Annotated entity stream:**
Each entity renders as a card with progressive disclosure:
- **Kind badge** (function/class/file) + **entity name** in `font-mono`
- **Taxonomy badge** with human-readable labels: "Core Business" (VERTICAL, cyan), "Shared Logic" (HORIZONTAL, purple), "Helper" (UTILITY, amber)
- **Confidence** with word labels: "High 92%", "Medium 65%", "Low 30%"
- **Business purpose** as hero text (leads before code — the "wow" moment)
- **Code signature** in monospace below
- **Domain concept pills** as small badges
- **Expandable section**: "Why was it classified this way?" reveals reasoning and semantic triples
- Left border colored by taxonomy for quick visual scanning

**Summary stats bar** at top of entity stream: entity count, justified ratio, average confidence, taxonomy breakdown.

**File:** `app/(dashboard)/repos/[repoId]/code/page.tsx` (simplified)

Removed hero stats, top insights, domain intelligence, language distribution (all moved to Overview). Code tab now renders only the `AnnotatedCodeViewer` component.

**File:** `lib/utils/file-tree-builder.ts` (modified)

Added `sortTree()` function for recursive IDE-like sorting:
```typescript
function sortTree(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  })
  for (const node of nodes) {
    if (node.children?.length) sortTree(node.children)
  }
}
```

---

## Phase 2.6: Unified Activity Tab

Five previously separate tabs (**Activity**, **Timeline**, **Commits**, **History**, **Pipeline**) were consolidated into a single **Activity** tab. The overlap between these tabs was significant — timeline and activity showed the same data, pipeline was a subset of activity, and commits/history were rarely used independently.

### 2.6A: Tab Consolidation

**File:** `components/repo/repo-tabs.tsx` (modified)

Removed 4 tabs: Timeline, Commits, History, Pipeline. The final tab set:
```typescript
const tabs = [
  { label: "Overview", href: "", icon: Home },
  { label: "Code", href: "/code", icon: Code },
  { label: "Entities", href: "/entities", icon: Layers },
  { label: "Blueprint", href: "/blueprint", icon: LayoutGrid },
  { label: "Patterns", href: "/patterns", icon: Fingerprint },
  { label: "Rules", href: "/rules", icon: Shield },
  { label: "Reviews", href: "/reviews", icon: GitPullRequest },
  { label: "Health", href: "/health", icon: HeartPulse },
  { label: "Impact", href: "/impact", icon: Zap },
  { label: "Drift", href: "/drift", icon: TrendingDown },
  { label: "Intelligence", href: "/intelligence", icon: Brain },
  { label: "ADRs", href: "/adrs", icon: BookOpen },
  { label: "Glossary", href: "/glossary", icon: BookText },
  { label: "Activity", href: "/activity", icon: Activity },
]
```

**File:** `app/(dashboard)/repos/[repoId]/activity/page.tsx` (rewritten)

Unified activity hub with:
1. **Pipeline controls** — Re-index, Stop, and Restart buttons with rate limiting and processing state
2. **Pipeline status banner** — Shows when a pipeline is actively running
3. **Section switcher** — Three sections: Pipeline Runs | Index Events | Logs
4. **Pipeline Runs section** — `PipelineHistoryTable` with run ID, time, trigger, status, duration, files, entities, edges. Clicking a run ID opens the run detail page in a new tab.
5. **Index Events section** — Legacy `IndexEvent` table or `ActivityFeed` component
6. **Logs section** — `PipelineLogViewer` for live/archived logs

**File:** `components/repo/pipeline-history-table.tsx` (modified)

Added `repoId` prop and "Run" column showing truncated run ID (`run.id.slice(0, 8)`). Run rows are now clickable — `onClick` opens `/repos/{repoId}/activity/{runId}` in a new tab via `window.open()`.

**File:** `components/repo/pipeline-log-viewer.tsx` (modified)

Added optional `runId` prop, passed through to `usePipelineLogs(repoId, enabled, runId)` for run-specific log fetching.

### 2.6B: Pipeline Run Detail Page

**File:** `app/(dashboard)/repos/[repoId]/activity/[runId]/page.tsx` (new)

Dedicated page for viewing a single pipeline run, opened in a new tab from the runs table. Includes:
1. **Back link** — "Back to Activity" → `/repos/{repoId}/activity`
2. **Status header** — Status icon + "Pipeline Run" title + run ID (mono) + status badge
3. **Meta grid** — 4 cards: Trigger, Type, Started (timestamp), Duration
4. **Error message** — Destructive-styled card shown if run has an error
5. **Pipeline steps** — Visual step cards with status coloring (pending, running, completed, failed, skipped), duration, and error messages
6. **Results metrics** — 5 stat cards: Files, Functions, Classes, Entities Written, Edges Written
7. **Run-specific logs** — `PipelineLogViewer` with `runId` prop for run-bound log viewing

Fetches data from `GET /api/repos/{repoId}/runs/{runId}`.

---

## Phase 3: ADR Browser Page

ADRs are already generated by `synthesizeAndStoreADRs()` in the health report workflow and stored via `bulkUpsertADRs()`. Retrievable via `getADRs(orgId, repoId)`.

**Files:**
- `app/api/repos/[repoId]/adrs/route.ts` (new) — `GET` returns `{ adrs: ADRDoc[], count: number }`
- `app/(dashboard)/repos/[repoId]/adrs/page.tsx` (new) — Server component with Suspense + Skeleton. Title: "Architecture Decisions"
- `components/adrs/adr-view.tsx` (new) — Client component rendering ADR cards:
  - Feature area badge (colored)
  - Title in `font-grotesk text-sm font-semibold`
  - **Context** section (always visible)
  - **Decision** section (always visible)
  - **Consequences** section (collapsible)
  - Generated timestamp
  - Empty state when no ADRs exist

**Tab added:** `{ label: "ADRs", href: "/adrs", icon: BookOpen }` after "Health" in `components/repo/repo-tabs.tsx`

---

## Phase 4: Domain Glossary Page

Domain ontology is already extracted by `ontology-extractor.ts` and stored via `graphStore.upsertDomainOntology()`. Retrievable via `getDomainOntology(orgId, repoId)`.

**Files:**
- `app/api/repos/[repoId]/glossary/route.ts` (new) — `GET` returns `{ ontology: DomainOntologyDoc | null }`
- `app/(dashboard)/repos/[repoId]/glossary/page.tsx` (new) — Server component. Title: "Domain Glossary"
- `components/glossary/glossary-view.tsx` (new) — Client component rendering:
  1. **Project header** — Project name, description, domain, tech stack badges (from ontology metadata)
  2. **Ubiquitous Language** — Searchable table with columns: Term | Definition | Related Terms. Uses `ubiquitous_language` map from ontology. Terms in `font-mono`. Filter input for instant search.
  3. **All Domain Terms** — Grid of term pills sized by frequency. Clicking a term with a definition scrolls to it in the table above.
  4. Empty state when no ontology exists.

**Tab added:** `{ label: "Glossary", href: "/glossary", icon: BookText }` after "ADRs" in `components/repo/repo-tabs.tsx`

---

## Phase 5: Enhanced Entity Detail

### 5A: Entity Detail API

**File:** `app/api/repos/[repoId]/entities/[entityId]/route.ts` (modified)

Now returns additional fields alongside the existing entity/callers/callees:
- `qualityScore` — from `scoreJustification()` (0-1 scale)
- `qualityFlags` — human-readable flag strings from quality scorer
- `architecturalPattern` — from justification's `architectural_pattern` field
- `propagatedFeatureTag` — from context propagation metadata (if different from direct)
- `propagatedDomainConcepts` — from context propagation metadata
- `isDeadCode` — boolean (no callers + not exported + not entry point + not structural entity)

### 5B: Entity Detail Component

**File:** `components/entity/entity-detail.tsx` (modified)

New sections below existing justification card:
- **Dead Code Warning** — Prominent amber alert banner if `isDeadCode === true`
- **Analysis Details** card with:
  - **Quality Score** — Colored badge (red < 0.3, amber < 0.5, blue < 0.7, emerald ≥ 0.7)
  - **Architectural Pattern** — Badge (pure_domain=emerald, pure_infrastructure=blue, adapter=amber, mixed=red, unknown=muted)
  - **Quality Flags** — Muted pills showing deduction reasons
- **Propagated Context** — If propagated values differ from direct, shows them with amber badges

**File:** `app/(dashboard)/repos/[repoId]/entities/[entityId]/page.tsx` (modified) — Computes quality score, architectural pattern, dead code status server-side and passes as props.

---

## Phase 6: Rule from Insight API

**File:** `app/api/repos/[repoId]/rules/from-insight/route.ts` (new)

`POST /api/repos/{repoId}/rules/from-insight`

Body: `{ insightType: string }`

Looks up the rule template from `fix-guidance.ts`, creates a draft rule via `graphStore.upsertRule()`. Returns `{ ruleId }`. This enables one-click rule creation from insight cards (alternative to the query-param deep-link approach — both coexist).

---

## Files Summary

### New Files (15)
```
lib/health/fix-guidance.ts                              — Fix guidance + rule templates per risk type
app/api/repos/[repoId]/health/insights/route.ts         — Enhanced health insights API
app/api/repos/[repoId]/overview/route.ts                — Aggregated overview API
app/api/repos/[repoId]/adrs/route.ts                    — ADR listing API
app/api/repos/[repoId]/glossary/route.ts                — Domain ontology API
app/api/repos/[repoId]/rules/from-insight/route.ts      — One-click rule creation API
app/(dashboard)/repos/[repoId]/adrs/page.tsx            — ADR browser page
app/(dashboard)/repos/[repoId]/glossary/page.tsx        — Domain glossary page
app/(dashboard)/repos/[repoId]/activity/[runId]/page.tsx — Pipeline run detail page
components/health/insight-card.tsx                       — Reusable insight card component
components/adrs/adr-view.tsx                            — ADR list view component
components/glossary/glossary-view.tsx                    — Glossary view component
components/code/annotated-code-viewer.tsx                — Annotated code viewer with justifications
```

### Modified Files (14)
```
lib/justification/health-report-builder.ts              — 4 → 13 risk types, accepts entities+edges
lib/justification/schemas.ts                            — HealthRiskSchema extended with category, affectedCount, entities
lib/ports/types.ts                                      — HealthReportDoc.risks type extended
lib/temporal/activities/health-report.ts                 — Pass FetchedData to buildHealthReport
lib/temporal/workflows/generate-health-report.ts         — Updated call site
components/health/health-report-view.tsx                 — Full redesign with grade hero + category sections
app/(dashboard)/repos/[repoId]/page.tsx                 — Redesigned as Overview tab with hero stats + Issues subsection
app/(dashboard)/repos/[repoId]/code/page.tsx            — Simplified to AnnotatedCodeViewer only
app/(dashboard)/repos/[repoId]/activity/page.tsx        — Unified activity hub (merged 5 tabs into 1)
app/(dashboard)/repos/[repoId]/rules/new/page.tsx       — Read query params for pre-fill
components/repo/repo-tabs.tsx                           — Overview rename, removed 4 tabs, added ADRs + Glossary
components/repo/pipeline-history-table.tsx               — Clickable run rows, Run ID column
components/repo/pipeline-log-viewer.tsx                  — Optional runId prop for run-specific logs
lib/utils/file-tree-builder.ts                          — IDE-like sortTree() function
components/entity/entity-detail.tsx                     — Quality score, arch pattern, dead code warning
app/api/repos/[repoId]/entities/route.ts                — ?enrich=true for justification data
app/api/repos/[repoId]/entities/[entityId]/route.ts     — Returns quality/arch/dead code data
app/(dashboard)/repos/[repoId]/entities/[entityId]/page.tsx — Computes + passes new entity props
```

---

## Verification

1. **Health Report:** Navigate to `/repos/{repoId}/health`. Verify:
   - Health grade (A-F) displayed prominently in grade hero
   - 5 category sections render with appropriate risks
   - InsightCards show affected count, expandable entity list, "How to Fix", "Create Rule"
   - Clicking "Create Rule" navigates to pre-filled form at `/repos/{repoId}/rules/new`

2. **Overview Page (renamed from Issues):** Navigate to `/repos/{repoId}`. Verify:
   - Tab label shows "Overview" with Home icon (not "Issues")
   - Hero stats (grade, entities, features, insights) render in 4-column grid
   - Top 3 insights shown with severity dots
   - Domain intelligence and language distribution render side-by-side
   - Quick navigation links (Code, Health, Blueprint, Patterns, ADRs, Glossary) work
   - Issues subsection renders health risks below the overview content

3. **Code Tab (Annotated Code Viewer):** Navigate to `/repos/{repoId}/code`. Verify:
   - Left panel: file tree with IDE-like sorting (folders first, alphabetical)
   - File tree is scrollable and searchable
   - Right panel: entity cards with taxonomy badge, confidence label, business purpose
   - Business purpose text appears prominently before code signature
   - Expand "Why was it classified this way?" shows reasoning + semantic triples
   - Summary stats bar at top shows entity count, justified ratio, avg confidence

4. **Activity Tab (unified):** Navigate to `/repos/{repoId}/activity`. Verify:
   - Only one "Activity" tab exists (no Timeline, Commits, History, Pipeline tabs)
   - Section switcher: Pipeline Runs / Index Events / Logs
   - Pipeline runs table shows Run ID, time, trigger, status, duration
   - Clicking run ID opens detail page in a new tab
   - Pipeline controls (Re-index, Stop, Restart) work correctly

5. **Run Detail Page:** Click a run ID from the activity table. Verify:
   - Opens in new tab at `/repos/{repoId}/activity/{runId}`
   - Shows status, meta grid, pipeline steps, results metrics
   - Run-specific logs appear in PipelineLogViewer
   - "Back to Activity" link works

6. **ADR Page:** Navigate to `/repos/{repoId}/adrs`. Verify:
   - Cards render with feature badge, context, decision
   - Consequences are collapsible
   - Empty state shown when no ADRs exist

7. **Glossary Page:** Navigate to `/repos/{repoId}/glossary`. Verify:
   - Project header shows name, description, tech stack
   - Term table is searchable via filter input
   - Domain term pills are clickable (scroll to definition)
   - Empty state when no ontology exists

8. **Entity Detail:** Navigate to any entity. Verify:
   - Quality score badge appears with color coding
   - Architectural pattern badge appears
   - Dead code warning banner shown if applicable
   - Propagated context section appears when values differ

9. **Build:** `pnpm build` succeeds. `pnpm lint` passes. No new TypeScript errors introduced.

---

## Phase 7: Pipeline Intelligence Enhancements (February 2026)

Five high-leverage additions that transform the indexing pipeline from an opaque background task into a transparent, trust-building experience. All implemented and passing `pnpm build`.

### 7A: Context Seeding (Pre-Indexing Context Injection)

Users can paste their `ARCHITECTURE.md`, PRD, or project description into a textarea in the onboarding console before indexing begins. The text is stored as `contextDocuments` on the repo record (max 10k chars) and injected into both the ontology extraction and justification LLM prompts, anchoring `feature_tag` and `business_purpose` to the team's actual vocabulary.

**Files:**
- `prisma/schema.prisma` — `contextDocuments` field on Repo model
- `supabase/migrations/00004_context_documents.sql` — DDL migration
- `app/api/repos/[repoId]/context/route.ts` — PUT/GET endpoints
- `lib/temporal/activities/ontology.ts` — fetches contextDocuments, appends to project description
- `lib/temporal/activities/justification.ts` — fetches contextDocuments, passes to prompt builder
- `lib/justification/prompt-builder.ts` — "Project Context (provided by the team)" section
- `components/repo/repo-onboarding-console.tsx` — collapsible Context Seeding section

### 7B: LLM Chain-of-Thought in Pipeline Logs

During justification, each entity's reasoning is emitted to the pipeline log: `"Analyzed {name}. Tagged as {taxonomy} ({confidence}%) — {businessPurpose}"`. These lines appear live in the Pipeline Monitor, making the AI's reasoning visible in real time.

**Files:**
- `lib/temporal/activities/justification.ts` — per-entity log emission via `createPipelineLogger()`

### 7C: UNERR_CONTEXT.md Export

Compiles pipeline outputs (features, health report, ADRs, ontology, glossary, ubiquitous language) into a downloadable markdown file. Available from the overview page and celebration modal.

**Files:**
- `lib/justification/context-document-generator.ts` — `generateContextDocument()` function
- `app/api/repos/[repoId]/export/context/route.ts` — GET endpoint with `Content-Disposition: attachment`
- `app/(dashboard)/repos/[repoId]/page.tsx` — "Download UNERR_CONTEXT.md" button
- `components/repo/repo-onboarding-console.tsx` — "Download Intelligence Report" in celebration modal

### 7D: Blast Radius Pre-Computation

After finalization (Step 4b), computes `fan_in`, `fan_out`, and `risk_level` for every entity using AQL COLLECT queries on the `calls` edge collection. High-risk entities (≥10 fan-in/fan-out) are flagged with red border + glow + `AlertTriangle` badge in the annotated code viewer.

**Files:**
- `lib/temporal/activities/graph-analysis.ts` — `precomputeBlastRadius()` activity
- `lib/temporal/workflows/index-repo.ts` — Step 4b after finalization
- `lib/ports/types.ts` — `fan_in`, `fan_out`, `risk_level` on `EntityDoc`
- `app/api/repos/[repoId]/entities/route.ts` — risk fields in entity responses
- `components/code/annotated-code-viewer.tsx` — risk badge, red border/glow
- `components/blueprint/blueprint-view.tsx` — confidence glow on feature cards

### 7E: Human-in-the-Loop Corrections

Inline correction editor in the annotated code viewer. Edit icon on taxonomy badge (hover-visible). Override taxonomy (VERTICAL/HORIZONTAL/UTILITY), feature tag, and business purpose. Corrections saved with `confidence: 1.0`, `model_used: "human_override"`.

**Files:**
- `app/api/repos/[repoId]/entities/[entityId]/override/route.ts` — POST override API
- `components/code/annotated-code-viewer.tsx` — edit icon, inline correction editor
- `components/blueprint/blueprint-view.tsx` — `confidenceGlow()` function for ring/shadow effects
