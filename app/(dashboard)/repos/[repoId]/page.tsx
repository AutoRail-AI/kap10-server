import { FileCode, HeartPulse, LayoutGrid, BookOpen, BookText } from "lucide-react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Suspense } from "react"
import { RepoDetailClient } from "@/components/repo/repo-detail-client"
import { RepoOnboardingConsole } from "@/components/repo/repo-onboarding-console"
import { Skeleton } from "@/components/ui/skeleton"
import { getActiveOrgId, getSessionCached } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { buildFileTree } from "@/lib/utils/file-tree-builder"

const GRADE_COLORS: Record<string, string> = {
  A: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  B: "text-blue-400 border-blue-500/30 bg-blue-500/10",
  C: "text-amber-400 border-amber-500/30 bg-amber-500/10",
  D: "text-orange-400 border-orange-500/30 bg-orange-500/10",
  F: "text-red-400 border-red-500/30 bg-red-500/10",
}

const SEVERITY_COLORS: Record<string, string> = {
  low: "bg-muted text-muted-foreground border-border",
  medium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  high: "bg-red-500/20 text-red-400 border-red-500/30",
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

async function CodeTabContent({ repoId }: { repoId: string }) {
  const session = await getSessionCached()
  if (!session) return null

  const orgId = await getActiveOrgId()
  const container = getContainer()
  const repo = await container.relationalStore.getRepo(orgId, repoId)
  if (!repo) notFound()

  if (repo.status !== "ready") {
    return (
      <RepoOnboardingConsole
        repoId={repoId}
        initialStatus={repo.status}
        initialProgress={repo.indexProgress ?? 0}
        repoName={repo.name}
        fullName={repo.fullName ?? repo.name}
        errorMessage={repo.errorMessage}
      />
    )
  }

  // Load lightweight data only — no getAllEntities/getAllEdges (those are 10K+ items).
  // Entity counts come from projectStats; dead code count comes from healthReport (pre-computed).
  const [paths, projectStats, healthReport, features, ontology] = await Promise.all([
    container.graphStore.getFilePaths(orgId, repoId),
    container.graphStore.getProjectStats(orgId, repoId).catch(() => null),
    container.graphStore.getHealthReport(orgId, repoId).catch(() => null),
    container.graphStore.getFeatureAggregations(orgId, repoId).catch(() => []),
    container.graphStore.getDomainOntology(orgId, repoId).catch(() => null),
  ])

  const tree = buildFileTree(paths)

  const topLanguages = projectStats?.languages
    ? Object.entries(projectStats.languages)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
    : []
  const totalLangFiles = topLanguages.reduce((s: number, [, c]) => s + c, 0)

  // Use pre-computed stats — no need to load full entity/edge arrays
  const totalEntities = (projectStats?.functions ?? 0) + (projectStats?.classes ?? 0) + (projectStats?.interfaces ?? 0) + (projectStats?.variables ?? 0)
  const grade = healthReport ? computeGrade(healthReport.risks) : null

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
    <div className="space-y-6 animate-fade-in">
      {/* Hero Stats Row */}
      <div className="grid grid-cols-4 gap-4">
        {/* Health Grade */}
        <div className="rounded-lg border border-white/10 bg-white/2 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk mb-2">
            Health Grade
          </p>
          {grade ? (
            <div className={`inline-flex items-center justify-center w-12 h-12 rounded-lg border text-2xl font-bold font-grotesk ${GRADE_COLORS[grade] ?? ""}`}>
              {grade}
            </div>
          ) : (
            <p className="text-xl font-semibold text-muted-foreground">—</p>
          )}
        </div>

        {/* Entities */}
        <div className="rounded-lg border border-white/10 bg-white/2 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk mb-2">
            Entities Analyzed
          </p>
          <p className="text-2xl font-bold font-mono text-foreground tabular-nums">
            {totalEntities.toLocaleString()}
          </p>
          <p className="text-[10px] text-white/30 mt-0.5">functions, classes, methods</p>
        </div>

        {/* Features */}
        <div className="rounded-lg border border-white/10 bg-white/2 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk mb-2">
            Features Discovered
          </p>
          <p className="text-2xl font-bold font-mono text-foreground tabular-nums">
            {features.length}
          </p>
          <Link
            href={`/repos/${repoId}/blueprint`}
            className="text-[10px] text-electric-cyan hover:underline mt-0.5 inline-block"
          >
            View Blueprint →
          </Link>
        </div>

        {/* Insights */}
        <div className="rounded-lg border border-white/10 bg-white/2 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk mb-2">
            Insights Found
          </p>
          <p className="text-2xl font-bold font-mono text-foreground tabular-nums">
            {healthReport?.risks.length ?? 0}
          </p>
          {healthReport && healthReport.risks.length > 0 && (
            <div className="flex gap-1.5 mt-1">
              {healthReport.risks.filter((r) => r.severity === "high").length > 0 && (
                <span className="text-[10px] text-red-400">
                  {healthReport.risks.filter((r) => r.severity === "high").length} high
                </span>
              )}
              {healthReport.risks.filter((r) => r.severity === "medium").length > 0 && (
                <span className="text-[10px] text-amber-400">
                  {healthReport.risks.filter((r) => r.severity === "medium").length} med
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Top Insights */}
      {topInsights.length > 0 ? (
        <div className="rounded-lg border border-white/10 bg-white/2 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk">
              Top Insights
            </p>
            <Link
              href={`/repos/${repoId}/health`}
              className="text-xs text-electric-cyan hover:underline"
            >
              View Health Report →
            </Link>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {topInsights.map((risk, i) => (
              <div key={i} className="rounded-md bg-muted/10 p-3 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${
                    risk.severity === "high" ? "bg-red-400" :
                    risk.severity === "medium" ? "bg-amber-400" : "bg-muted-foreground"
                  }`} />
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
      ) : healthReport ? (
        <div className="rounded-lg border border-white/10 bg-white/2 p-4 flex items-center gap-3">
          <span className="text-emerald-400 text-lg">✓</span>
          <p className="text-sm text-muted-foreground">No critical issues found</p>
        </div>
      ) : null}

      {/* Domain Intelligence */}
      {(ontology || domainTerms.length > 0) && (
        <div className="rounded-lg border border-white/10 bg-white/2 p-4 space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk">
            Domain Intelligence
          </p>
          {ontology?.project_description && (
            <p className="text-sm text-foreground">{ontology.project_description}</p>
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

      {/* Quick Navigation */}
      <div className="flex gap-3">
        {[
          { label: "Health Report", href: `/repos/${repoId}/health`, icon: HeartPulse },
          { label: "Blueprint", href: `/repos/${repoId}/blueprint`, icon: LayoutGrid },
          { label: "ADRs", href: `/repos/${repoId}/adrs`, icon: BookOpen },
          { label: "Glossary", href: `/repos/${repoId}/glossary`, icon: BookText },
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
      </div>

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

      {/* Code Explorer */}
      {paths.length > 0 ? (
        <RepoDetailClient
          repoId={repoId}
          repoName={repo.name}
          initialTree={tree}
          orgId={orgId}
        />
      ) : (
        <div className="rounded-lg border border-white/10 p-12 text-center">
          <FileCode className="mx-auto h-10 w-10 text-white/10 mb-4" />
          <p className="font-grotesk text-sm font-semibold text-foreground">
            No files indexed
          </p>
          <p className="text-xs text-white/40 mt-1">
            The indexing pipeline completed but no file entities were stored. Try
            re-indexing from the Pipeline tab.
          </p>
        </div>
      )}
    </div>
  )
}

export default async function RepoCodePage({
  params,
}: {
  params: Promise<{ repoId: string }>
}) {
  const { repoId } = await params
  return (
    <Suspense fallback={<Skeleton className="h-[400px] w-full" />}>
      <CodeTabContent repoId={repoId} />
    </Suspense>
  )
}
