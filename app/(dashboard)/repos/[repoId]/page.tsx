import {
  ChevronRight,
  Download,
  FileCode,
  Fingerprint,
  GitBranch,
  Layers,
  Plug,
  RefreshCw,
  Shield,
} from "lucide-react"
import { headers } from "next/headers"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Suspense } from "react"
import { RepoDetailClient } from "@/components/repo/repo-detail-client"
import { McpStatus } from "@/components/repo/mcp-status"
import { PipelineLogViewer } from "@/components/repo/pipeline-log-viewer"
import { RepoOnboardingConsole } from "@/components/repo/repo-onboarding-console"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { auth } from "@/lib/auth"
import { getContainer } from "@/lib/di/container"
import { buildFileTree } from "@/lib/utils/file-tree-builder"

async function RepoDetailContent({ repoId }: { repoId: string }) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return null
  const orgId = await getActiveOrgId()
  const container = getContainer()
  const repo = await container.relationalStore.getRepo(orgId, repoId)
  if (!repo) notFound()

  if (repo.status !== "ready") {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <nav className="flex items-center gap-1.5 text-sm">
            <Link href="/repos" className="text-white/40 hover:text-white/70 transition-colors">
              Repositories
            </Link>
            <ChevronRight className="h-3.5 w-3.5 text-white/20" />
            <span className="text-foreground font-medium">{repo.name}</span>
          </nav>
          <p className="font-mono text-xs text-white/30">{repo.fullName}</p>
        </div>
        <RepoOnboardingConsole
          repoId={repoId}
          initialStatus={repo.status}
          initialProgress={repo.indexProgress ?? 0}
          repoName={repo.name}
          fullName={repo.fullName ?? repo.name}
          errorMessage={repo.errorMessage}
        />
      </div>
    )
  }

  const [paths, projectStats, activeRules, patterns, healthReport] =
    await Promise.all([
      container.graphStore.getFilePaths(orgId, repoId),
      container.graphStore.getProjectStats(orgId, repoId).catch(() => null),
      container.graphStore
        .queryRules(orgId, { orgId, repoId, status: "active" })
        .catch(() => []),
      container.graphStore
        .queryPatterns(orgId, { orgId, repoId })
        .catch(() => []),
      container.graphStore.getHealthReport(orgId, repoId).catch(() => null),
    ])

  const tree = buildFileTree(paths)

  let snapshot: {
    status: string
    sizeBytes: number
    entityCount: number
    edgeCount: number
    generatedAt: Date | null
    snapshotVersion?: number
  } | null = null
  try {
    const { getPrisma } = require("@/lib/db/prisma") as typeof import("@/lib/db/prisma")
    const prisma = getPrisma()
    const meta = await prisma.graphSnapshotMeta.findUnique({ where: { repoId } })
    if (meta) {
      snapshot = {
        status: meta.status,
        sizeBytes: meta.sizeBytes,
        entityCount: meta.entityCount,
        edgeCount: meta.edgeCount,
        generatedAt: meta.generatedAt,
        snapshotVersion: (meta as Record<string, unknown>).snapshotVersion as number | undefined,
      }
    }
  } catch {
    // non-critical
  }

  const totalEntities =
    (projectStats?.functions ?? 0) +
    (projectStats?.classes ?? 0) +
    (projectStats?.interfaces ?? 0) +
    (projectStats?.variables ?? 0)
  const topLanguages = projectStats?.languages
    ? Object.entries(projectStats.languages)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
    : []
  const totalLangFiles = topLanguages.reduce((s, [, c]) => s + c, 0)

  const syncAge = repo.lastIndexedAt
    ? Math.round(
        (Date.now() - new Date(repo.lastIndexedAt).getTime()) / 3_600_000
      )
    : null
  const isLive = syncAge !== null && syncAge < 24

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <nav className="flex items-center gap-1.5 text-sm">
            <Link href="/repos" className="text-white/40 hover:text-white/70 transition-colors">
              Repositories
            </Link>
            <ChevronRight className="h-3.5 w-3.5 text-white/20" />
            <span className="font-grotesk font-semibold text-foreground">{repo.name}</span>
            {/* Status pill */}
            <span className={`ml-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
              isLive
                ? "border border-emerald-400/30 bg-emerald-400/5 text-emerald-400"
                : "border border-white/10 bg-white/5 text-white/50"
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${isLive ? "bg-emerald-400 animate-pulse" : "bg-white/30"}`} />
              {isLive ? "Live Sync" : "Offline"}
            </span>
          </nav>
          <p className="font-mono text-xs text-white/30">{repo.fullName}</p>
        </div>
        <div className="flex items-center gap-2">
          <McpStatus repoId={repoId} />
          {snapshot?.status === "available" && (
            <div className="flex items-center gap-1.5 rounded-md border border-emerald-400/30 bg-emerald-400/5 px-2.5 py-1">
              <Download className="h-3.5 w-3.5 text-emerald-400" />
              <span className="font-mono text-xs text-emerald-400 tabular-nums">
                {(snapshot.sizeBytes / 1024).toFixed(0)}KB
              </span>
            </div>
          )}
          <Link href={`/repos/${repoId}/connect`}>
            <Button size="sm" className="bg-rail-fade hover:opacity-90 gap-1.5 h-7 text-xs">
              <Plug className="h-3 w-3" />
              Connect to IDE
            </Button>
          </Link>
        </div>
      </div>

      <div className="h-px bg-white/10" />

      {/* ── Telemetry Grid ── */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        <TelemetryCard
          label="Indexed Entities"
          value={totalEntities}
          detail={`${(repo.fileCount ?? 0).toLocaleString()} files`}
          icon={Layers}
        />
        <TelemetryCard
          label="Active Rules"
          value={activeRules.length}
          detail="Enforced"
          icon={Shield}
        />
        <TelemetryCard
          label="Patterns"
          value={patterns.length}
          detail="Detected"
          icon={Fingerprint}
        />
        <TelemetryCard
          label="Branch"
          value={repo.defaultBranch ?? "main"}
          detail={
            syncAge !== null
              ? syncAge < 1
                ? "Synced just now"
                : syncAge < 24
                  ? `Synced ${syncAge}h ago`
                  : `Synced ${Math.floor(syncAge / 24)}d ago`
              : "Never synced"
          }
          icon={GitBranch}
          mono
        />
        <TelemetryCard
          label="Graph Edges"
          value={snapshot?.edgeCount ?? 0}
          detail={snapshot?.snapshotVersion ? `v${snapshot.snapshotVersion} snapshot` : "—"}
          icon={RefreshCw}
        />
      </div>

      {/* ── Language Distribution ── */}
      {topLanguages.length > 0 && (
        <div className="rounded-lg border border-white/10 bg-white/2 p-4 space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk">
            Language Distribution
          </p>
          <div className="flex h-1.5 overflow-hidden rounded-full bg-white/5">
            {topLanguages.map(([lang, count], i) => {
              const pct = totalLangFiles > 0 ? (count / totalLangFiles) * 100 : 0
              const colors = ["bg-electric-cyan", "bg-primary", "bg-emerald-400", "bg-warning", "bg-white/30", "bg-primary/60"]
              return (
                <div
                  key={lang}
                  className={`${colors[i % colors.length]}`}
                  style={{ width: `${pct}%` }}
                  title={`${lang}: ${count} files (${pct.toFixed(1)}%)`}
                />
              )
            })}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {topLanguages.map(([lang, count], i) => {
              const pct = totalLangFiles > 0 ? (count / totalLangFiles) * 100 : 0
              const dots = ["bg-electric-cyan", "bg-primary", "bg-emerald-400", "bg-warning", "bg-white/30", "bg-primary/60"]
              return (
                <div key={lang} className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${dots[i % dots.length]}`} />
                  <span className="text-xs text-white/60">{lang}</span>
                  <span className="font-mono text-[10px] text-white/30 tabular-nums">{pct.toFixed(0)}%</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Health Summary ── */}
      {healthReport && (
        <div className="rounded-lg border border-white/10 bg-white/2 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk">
              Health Summary
            </p>
            <Link href={`/repos/${repoId}/health`} className="text-xs text-electric-cyan hover:underline">
              Full Report
            </Link>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <HealthMetric
              label="Score"
              value={
                (healthReport as unknown as Record<string, unknown>).overallScore
                  ? `${Math.round(Number((healthReport as unknown as Record<string, unknown>).overallScore))}%`
                  : "—"
              }
            />
            <HealthMetric
              label="Suggestions"
              value={
                Array.isArray((healthReport as unknown as Record<string, unknown>).suggestions)
                  ? ((healthReport as unknown as Record<string, unknown>).suggestions as unknown[]).length
                  : "—"
              }
            />
            <HealthMetric label="Active Rules" value={activeRules.length} />
          </div>
        </div>
      )}

      {/* ── Code Explorer ── */}
      {paths.length > 0 ? (
        <RepoDetailClient repoId={repoId} repoName={repo.name} initialTree={tree} orgId={orgId} />
      ) : (
        <div className="rounded-lg border border-white/10 p-12 text-center">
          <FileCode className="mx-auto h-10 w-10 text-white/10 mb-4" />
          <p className="font-grotesk text-sm font-semibold text-foreground">No files indexed</p>
          <p className="text-xs text-white/40 mt-1">
            The indexing pipeline completed but no file entities were stored. Try re-indexing.
          </p>
        </div>
      )}

      {/* ── Pipeline Logs ── */}
      <PipelineLogViewer repoId={repoId} status={repo.status} />
    </div>
  )
}

function TelemetryCard({
  label,
  value,
  detail,
  icon: Icon,
  mono,
}: {
  label: string
  value: string | number
  detail: string
  icon: React.ComponentType<{ className?: string }>
  mono?: boolean
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/2 p-4 space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk">
          {label}
        </p>
        <Icon className="h-3.5 w-3.5 text-electric-cyan" />
      </div>
      <p className={`font-grotesk text-xl font-bold text-foreground tabular-nums ${mono ? "font-mono text-base" : ""}`}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      <p className="font-mono text-[10px] text-white/30">{detail}</p>
    </div>
  )
}

function HealthMetric({
  label,
  value,
}: {
  label: string
  value: string | number
}) {
  return (
    <div>
      <p className="font-mono text-lg font-bold text-foreground tabular-nums">
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      <p className="text-[10px] text-white/40 uppercase tracking-widest font-grotesk">{label}</p>
    </div>
  )
}

export default async function RepoDetailPage({
  params,
}: {
  params: Promise<{ repoId: string }>
}) {
  const { repoId } = await params
  return (
    <div className="space-y-6 py-6 animate-fade-in">
      <Suspense fallback={<Skeleton className="h-[400px] w-full" />}>
        <RepoDetailContent repoId={repoId} />
      </Suspense>
    </div>
  )
}
