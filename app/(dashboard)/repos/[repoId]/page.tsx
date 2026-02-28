import {
  BookOpen,
  BookText,
  FileCode,
  FileDown,
  Fingerprint,
  HeartPulse,
  Layers,
  LayoutGrid,
  Shield,
} from "lucide-react"
import Link from "next/link"
import { Suspense } from "react"
import { IssuesView } from "@/components/issues/issues-view"
import { RepoOnboardingConsole } from "@/components/repo/repo-onboarding-console"
import { Skeleton } from "@/components/ui/skeleton"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"

const PROCESSING_STATUSES = [
  "pending",
  "indexing",
  "embedding",
  "justifying",
  "ontology",
]
const ERROR_STATUSES = ["error", "embed_failed", "justify_failed"]

const GRADE_COLORS: Record<string, string> = {
  A: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  B: "text-blue-400 border-blue-500/30 bg-blue-500/10",
  C: "text-amber-400 border-amber-500/30 bg-amber-500/10",
  D: "text-orange-400 border-orange-500/30 bg-orange-500/10",
  F: "text-red-400 border-red-500/30 bg-red-500/10",
}

function computeGrade(risks: Array<{ severity: string }>): string {
  const high = risks.filter((r) => r.severity === "high").length
  const medium = risks.filter((r) => r.severity === "medium").length
  if (high >= 3) return "F"
  if (high >= 1) return "D"
  if (medium > 3) return "C"
  if (medium > 0) return "B"
  return "A"
}

/* ─── Overview Stats (async, loaded in Suspense) ─────── */

async function OverviewStats({ repoId }: { repoId: string }) {
  const orgId = await getActiveOrgId()
  const container = getContainer()

  const [projectStats, healthReport, features, ontology] = await Promise.all([
    container.graphStore.getProjectStats(orgId, repoId).catch(() => null),
    container.graphStore.getHealthReport(orgId, repoId).catch(() => null),
    container.graphStore.getFeatureAggregations(orgId, repoId).catch(() => []),
    container.graphStore.getDomainOntology(orgId, repoId).catch(() => null),
  ])

  const totalEntities =
    (projectStats?.functions ?? 0) +
    (projectStats?.classes ?? 0) +
    (projectStats?.interfaces ?? 0) +
    (projectStats?.variables ?? 0)
  const grade = healthReport ? computeGrade(healthReport.risks) : null

  const topLanguages = projectStats?.languages
    ? Object.entries(projectStats.languages)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
    : []
  const totalLangFiles = topLanguages.reduce((s: number, [, c]) => s + c, 0)

  const topInsights = healthReport
    ? [...healthReport.risks]
        .sort((a, b) => {
          const sev: Record<string, number> = { high: 0, medium: 1, low: 2 }
          return (sev[a.severity] ?? 2) - (sev[b.severity] ?? 2)
        })
        .slice(0, 3)
    : []

  const domainTerms = ontology?.terms
    ? [...ontology.terms]
        .sort((a, b) => b.frequency - a.frequency)
        .slice(0, 12)
    : []
  const maxFreq = domainTerms.length > 0 ? domainTerms[0]!.frequency : 1

  return (
    <div className="space-y-5">
      {/* Hero Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Health Grade */}
        <div className="rounded-lg border border-white/10 bg-white/2 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk mb-2">
            Health Grade
          </p>
          {grade ? (
            <div
              className={`inline-flex items-center justify-center w-10 h-10 rounded-lg border text-xl font-bold font-grotesk ${GRADE_COLORS[grade] ?? ""}`}
            >
              {grade}
            </div>
          ) : (
            <p className="text-xl font-semibold text-muted-foreground">&mdash;</p>
          )}
        </div>

        {/* Entities */}
        <div className="rounded-lg border border-white/10 bg-white/2 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk mb-2">
            Entities Analyzed
          </p>
          <p className="text-xl font-bold font-mono text-foreground tabular-nums">
            {totalEntities.toLocaleString()}
          </p>
          <p className="text-[10px] text-white/30 mt-0.5">
            functions, classes, methods
          </p>
        </div>

        {/* Features */}
        <div className="rounded-lg border border-white/10 bg-white/2 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk mb-2">
            Features Discovered
          </p>
          <p className="text-xl font-bold font-mono text-foreground tabular-nums">
            {features.length}
          </p>
          <Link
            href={`/repos/${repoId}/blueprint`}
            className="text-[10px] text-electric-cyan hover:underline mt-0.5 inline-block"
          >
            View Blueprint &rarr;
          </Link>
        </div>

        {/* Insights */}
        <div className="rounded-lg border border-white/10 bg-white/2 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk mb-2">
            Insights Found
          </p>
          <p className="text-xl font-bold font-mono text-foreground tabular-nums">
            {healthReport?.risks.length ?? 0}
          </p>
          {healthReport && healthReport.risks.length > 0 && (
            <div className="flex gap-1.5 mt-1">
              {healthReport.risks.filter((r) => r.severity === "high").length >
                0 && (
                <span className="text-[10px] text-red-400">
                  {
                    healthReport.risks.filter((r) => r.severity === "high")
                      .length
                  }{" "}
                  high
                </span>
              )}
              {healthReport.risks.filter((r) => r.severity === "medium")
                .length > 0 && (
                <span className="text-[10px] text-amber-400">
                  {
                    healthReport.risks.filter((r) => r.severity === "medium")
                      .length
                  }{" "}
                  med
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Top Insights */}
      {topInsights.length > 0 && (
        <div className="rounded-lg border border-white/10 bg-white/2 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk">
              Top Insights
            </p>
            <Link
              href={`/repos/${repoId}/health`}
              className="text-xs text-electric-cyan hover:underline"
            >
              View Health Report &rarr;
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {topInsights.map((risk, i) => (
              <div key={i} className="rounded-md bg-muted/10 p-3 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${
                      risk.severity === "high"
                        ? "bg-red-400"
                        : risk.severity === "medium"
                          ? "bg-amber-400"
                          : "bg-muted-foreground"
                    }`}
                  />
                  <span className="text-xs font-medium text-foreground">
                    {risk.riskType.replace(/_/g, " ")}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground line-clamp-2">
                  {risk.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Domain Intelligence + Language Distribution (side by side on wide screens) */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* Domain Intelligence */}
        {(ontology || domainTerms.length > 0) && (
          <div className="rounded-lg border border-white/10 bg-white/2 p-4 space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk">
              Domain Intelligence
            </p>
            {ontology?.project_description && (
              <p className="text-sm text-foreground leading-relaxed">
                {ontology.project_description}
              </p>
            )}
            {ontology?.tech_stack && ontology.tech_stack.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {ontology.tech_stack.map((tech) => (
                  <span
                    key={tech}
                    className="inline-block px-2 py-0.5 rounded text-[10px] font-mono bg-primary/10 text-primary border border-primary/20"
                  >
                    {tech}
                  </span>
                ))}
              </div>
            )}
            {domainTerms.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {domainTerms.map((t) => (
                  <span
                    key={t.term}
                    className="inline-block px-2 py-0.5 rounded text-xs text-foreground bg-white/5 border border-white/10"
                    style={{ opacity: 0.4 + 0.6 * (t.frequency / maxFreq) }}
                  >
                    {t.term}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Language Distribution */}
        {topLanguages.length > 0 && (
          <div className="rounded-lg border border-white/10 bg-white/2 p-4 space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk">
              Language Distribution
            </p>
            <div className="flex h-1.5 overflow-hidden rounded-full bg-white/5">
              {topLanguages.map(([lang, count], i) => {
                const pct =
                  totalLangFiles > 0 ? (count / totalLangFiles) * 100 : 0
                const colors = [
                  "bg-electric-cyan",
                  "bg-primary",
                  "bg-emerald-400",
                  "bg-warning",
                  "bg-white/30",
                  "bg-primary/60",
                ]
                return (
                  <div
                    key={lang}
                    className={colors[i % colors.length]}
                    style={{ width: `${pct}%` }}
                    title={`${lang}: ${count} files (${pct.toFixed(1)}%)`}
                  />
                )
              })}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {topLanguages.map(([lang, count], i) => {
                const pct =
                  totalLangFiles > 0 ? (count / totalLangFiles) * 100 : 0
                const dots = [
                  "bg-electric-cyan",
                  "bg-primary",
                  "bg-emerald-400",
                  "bg-warning",
                  "bg-white/30",
                  "bg-primary/60",
                ]
                return (
                  <div key={lang} className="flex items-center gap-1.5">
                    <span
                      className={`h-2 w-2 rounded-full ${dots[i % dots.length]}`}
                    />
                    <span className="text-xs text-white/60">{lang}</span>
                    <span className="font-mono text-[10px] text-white/30 tabular-nums">
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Quick Navigation */}
      <div className="flex flex-wrap gap-2">
        {[
          {
            label: "Health Report",
            href: `/repos/${repoId}/health`,
            icon: HeartPulse,
          },
          {
            label: "Blueprint",
            href: `/repos/${repoId}/blueprint`,
            icon: LayoutGrid,
          },
          {
            label: "Entities",
            href: `/repos/${repoId}/entities`,
            icon: Layers,
          },
          {
            label: "Patterns",
            href: `/repos/${repoId}/patterns`,
            icon: Fingerprint,
          },
          {
            label: "Rules",
            href: `/repos/${repoId}/rules`,
            icon: Shield,
          },
          { label: "ADRs", href: `/repos/${repoId}/adrs`, icon: BookOpen },
          {
            label: "Glossary",
            href: `/repos/${repoId}/glossary`,
            icon: BookText,
          },
        ].map((nav) => {
          const NavIcon = nav.icon
          return (
            <Link
              key={nav.label}
              href={nav.href}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/10 bg-white/2 text-xs text-muted-foreground hover:text-foreground hover:border-white/20 transition-colors"
            >
              <NavIcon className="h-3.5 w-3.5" />
              {nav.label}
            </Link>
          )
        })}
        <a
          href={`/api/repos/${repoId}/export/context`}
          download
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-primary/20 bg-primary/5 text-xs text-primary hover:bg-primary/10 hover:border-primary/30 transition-colors"
        >
          <FileDown className="h-3.5 w-3.5" />
          Download UNERR_CONTEXT.md
        </a>
      </div>
    </div>
  )
}

/* ─── Main Page ──────────────────────────────────────── */

async function RepoContent({ repoId }: { repoId: string }) {
  const orgId = await getActiveOrgId()
  const container = getContainer()
  const repo = await container.relationalStore.getRepo(orgId, repoId)
  if (!repo) return null

  const isProcessing = PROCESSING_STATUSES.includes(repo.status)
  const isError = ERROR_STATUSES.includes(repo.status)

  if (isProcessing || isError) {
    return (
      <RepoOnboardingConsole
        repoId={repoId}
        initialStatus={repo.status}
        initialProgress={repo.indexProgress ?? 0}
        repoName={repo.name}
        fullName={repo.fullName}
        errorMessage={repo.errorMessage}
      />
    )
  }

  return (
    <>
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="font-grotesk text-lg font-semibold text-foreground">
            Overview
          </h1>
          <p className="text-sm text-foreground mt-0.5">
            A snapshot of what was extracted from your codebase during indexing.
          </p>
        </div>
      </div>

      {/* Codebase insights (async, loads in parallel) */}
      <Suspense
        fallback={
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[88px] w-full rounded-lg" />
            ))}
          </div>
        }
      >
        <OverviewStats repoId={repoId} />
      </Suspense>

      {/* Issues subsection */}
      <div className="space-y-3 pt-2">
        <div className="space-y-1">
          <h2 className="font-grotesk text-base font-semibold text-foreground">
            Issues
          </h2>
          <p className="text-sm text-muted-foreground">
            Prioritized issues with reasoning, impact analysis, and agent-ready
            fix prompts.
          </p>
        </div>
        <IssuesView repoId={repoId} />
      </div>
    </>
  )
}

export default async function RepoDefaultPage({
  params,
}: {
  params: Promise<{ repoId: string }>
}) {
  const { repoId } = await params
  return (
    <div className="space-y-6 py-6 animate-fade-in">
      <Suspense fallback={<Skeleton className="h-[400px] w-full" />}>
        <RepoContent repoId={repoId} />
      </Suspense>
    </div>
  )
}
