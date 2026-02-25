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
2. Redesigning the overview page with hero stats, top insights, and domain intelligence
3. Adding ADR browser and domain glossary pages
4. Enhancing entity detail with quality scores, architectural patterns, and dead code warnings
5. Enabling one-click rule creation from any insight

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

New layout (above existing language bar + code explorer):

1. **Hero stats row** — 4 glass cards in a grid:
   - Health Grade (large colored letter, A-F)
   - Entities Analyzed (number + subtitle)
   - Features Discovered (number + link to blueprint)
   - Insights Found (number + severity breakdown)

2. **Top Insights** — 3 most severe risks as compact cards. Severity dot + one-line description + "View Health Report →" link. If no insights, shows "No critical issues found" with emerald checkmark.

3. **Domain Intelligence** — Glass card with:
   - Project description (from ontology)
   - Tech stack as small badges
   - Top domain terms as pills with opacity proportional to frequency

4. **Quick navigation** — Row of icon links: Health Report, Blueprint, ADRs, Glossary

5. **Language Distribution** — Existing (moved below)
6. **Code Explorer** — Existing (kept as-is)

All data is fetched server-side in `Promise.all()` for maximum performance.

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

### New Files (12)
```
lib/health/fix-guidance.ts                              — Fix guidance + rule templates per risk type
app/api/repos/[repoId]/health/insights/route.ts         — Enhanced health insights API
app/api/repos/[repoId]/overview/route.ts                — Aggregated overview API
app/api/repos/[repoId]/adrs/route.ts                    — ADR listing API
app/api/repos/[repoId]/glossary/route.ts                — Domain ontology API
app/api/repos/[repoId]/rules/from-insight/route.ts      — One-click rule creation API
app/(dashboard)/repos/[repoId]/adrs/page.tsx            — ADR browser page
app/(dashboard)/repos/[repoId]/glossary/page.tsx        — Domain glossary page
components/health/insight-card.tsx                       — Reusable insight card component
components/adrs/adr-view.tsx                            — ADR list view component
components/glossary/glossary-view.tsx                    — Glossary view component
```

### Modified Files (8)
```
lib/justification/health-report-builder.ts              — 4 → 13 risk types, accepts entities+edges
lib/justification/schemas.ts                            — HealthRiskSchema extended with category, affectedCount, entities
lib/ports/types.ts                                      — HealthReportDoc.risks type extended
lib/temporal/activities/health-report.ts                 — Pass FetchedData to buildHealthReport
lib/temporal/workflows/generate-health-report.ts         — Updated call site
components/health/health-report-view.tsx                 — Full redesign with grade hero + category sections
app/(dashboard)/repos/[repoId]/page.tsx                 — Redesigned overview with hero stats + domain intelligence
app/(dashboard)/repos/[repoId]/rules/new/page.tsx       — Read query params for pre-fill
components/repo/repo-tabs.tsx                           — Added ADRs + Glossary tabs
components/entity/entity-detail.tsx                     — Quality score, arch pattern, dead code warning
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

2. **Overview Page:** Navigate to `/repos/{repoId}`. Verify:
   - Hero stats (grade, entities, features, insights) render in 4-column grid
   - Top 3 insights shown with severity dots
   - Domain terms and project description visible (if ontology exists)
   - Quick navigation links (Health, Blueprint, ADRs, Glossary) work
   - Language distribution and code explorer render below

3. **ADR Page:** Navigate to `/repos/{repoId}/adrs`. Verify:
   - Cards render with feature badge, context, decision
   - Consequences are collapsible
   - Empty state shown when no ADRs exist

4. **Glossary Page:** Navigate to `/repos/{repoId}/glossary`. Verify:
   - Project header shows name, description, tech stack
   - Term table is searchable via filter input
   - Domain term pills are clickable (scroll to definition)
   - Empty state when no ontology exists

5. **Entity Detail:** Navigate to any entity. Verify:
   - Quality score badge appears with color coding
   - Architectural pattern badge appears
   - Dead code warning banner shown if applicable
   - Propagated context section appears when values differ

6. **Build:** `pnpm build` succeeds. `pnpm lint` passes. No new TypeScript errors introduced.
