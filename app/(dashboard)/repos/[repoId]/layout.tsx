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
import { McpStatus } from "@/components/repo/mcp-status"
import { RepoTabs } from "@/components/repo/repo-tabs"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { auth } from "@/lib/auth"
import { getContainer } from "@/lib/di/container"

async function RepoHeader({ repoId }: { repoId: string }) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return null

  const orgId = await getActiveOrgId()
  const container = getContainer()
  const repo = await container.relationalStore.getRepo(orgId, repoId)
  if (!repo) notFound()

  if (repo.status !== "ready") {
    return (
      <div className="space-y-4 px-6 pt-6">
        <div className="space-y-1">
          <nav className="flex items-center gap-1.5 text-sm">
            <Link
              href="/repos"
              className="text-white/40 hover:text-white/70 transition-colors"
            >
              Repositories
            </Link>
            <ChevronRight className="h-3.5 w-3.5 text-white/20" />
            <span className="font-grotesk font-semibold text-foreground">
              {repo.name}
            </span>
            <StatusPill status={repo.status} />
          </nav>
          <p className="font-mono text-xs text-white/30">{repo.fullName}</p>
        </div>
      </div>
    )
  }

  const [projectStats, activeRules, patterns] = await Promise.all([
    container.graphStore.getProjectStats(orgId, repoId).catch(() => null),
    container.graphStore
      .queryRules(orgId, { orgId, repoId, status: "active" })
      .catch(() => []),
    container.graphStore
      .queryPatterns(orgId, { orgId, repoId })
      .catch(() => []),
  ])

  let snapshot: {
    status: string
    sizeBytes: number
    edgeCount: number
    snapshotVersion?: number
  } | null = null
  try {
    const { getPrisma } = require("@/lib/db/prisma") as typeof import("@/lib/db/prisma")
    const prisma = getPrisma()
    const meta = await prisma.graphSnapshotMeta.findUnique({
      where: { repoId },
    })
    if (meta) {
      snapshot = {
        status: meta.status,
        sizeBytes: meta.sizeBytes,
        edgeCount: meta.edgeCount,
        snapshotVersion: (meta as Record<string, unknown>).snapshotVersion as
          | number
          | undefined,
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

  const syncAge = repo.lastIndexedAt
    ? Math.round(
        (Date.now() - new Date(repo.lastIndexedAt).getTime()) / 3_600_000
      )
    : null
  const isLive = syncAge !== null && syncAge < 24

  return (
    <div className="space-y-4 border-b border-white/10 pb-0">
      {/* Breadcrumb + Actions */}
      <div className="flex flex-col gap-3 px-6 pt-6 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <nav className="flex items-center gap-1.5 text-sm">
            <Link
              href="/repos"
              className="text-white/40 hover:text-white/70 transition-colors"
            >
              Repositories
            </Link>
            <ChevronRight className="h-3.5 w-3.5 text-white/20" />
            <span className="font-grotesk font-semibold text-foreground">
              {repo.name}
            </span>
            <span
              className={`ml-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                isLive
                  ? "border border-emerald-400/30 bg-emerald-400/5 text-emerald-400"
                  : "border border-white/10 bg-white/5 text-white/50"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isLive
                    ? "bg-emerald-400 animate-pulse"
                    : "bg-white/30"
                }`}
              />
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
            <Button
              size="sm"
              className="bg-rail-fade hover:opacity-90 gap-1.5 h-7 text-xs"
            >
              <Plug className="h-3 w-3" />
              Connect to IDE
            </Button>
          </Link>
        </div>
      </div>

      {/* Telemetry Chips */}
      <div className="grid gap-2 grid-cols-3 sm:grid-cols-5 px-6">
        <TelemetryChip icon={FileCode} label="Files" value={repo.fileCount ?? 0} />
        <TelemetryChip icon={Layers} label="Entities" value={totalEntities} />
        <TelemetryChip icon={Shield} label="Rules" value={activeRules.length} />
        <TelemetryChip icon={Fingerprint} label="Patterns" value={patterns.length} />
        <TelemetryChip
          icon={GitBranch}
          label={repo.defaultBranch ?? "main"}
          value={
            syncAge !== null
              ? syncAge < 1
                ? "Just now"
                : syncAge < 24
                  ? `${syncAge}h ago`
                  : `${Math.floor(syncAge / 24)}d ago`
              : "—"
          }
          mono
        />
      </div>

      {/* Tabs */}
      <div className="px-6">
        <RepoTabs repoId={repoId} />
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const isError =
    status === "error" ||
    status === "embed_failed" ||
    status === "justify_failed"
  return (
    <span
      className={`ml-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        isError
          ? "border border-destructive/30 bg-destructive/5 text-destructive"
          : "border border-primary/30 bg-primary/5 text-primary"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          isError ? "bg-destructive" : "bg-primary animate-pulse"
        }`}
      />
      {status.replace("_", " ")}
    </span>
  )
}

function TelemetryChip({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string | number
  mono?: boolean
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-white/10 bg-white/2 px-3 py-1.5">
      <Icon className="h-3.5 w-3.5 shrink-0 text-electric-cyan" />
      <span
        className={`text-xs font-medium text-foreground tabular-nums truncate ${
          mono ? "font-mono" : ""
        }`}
      >
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
      <span className="text-[10px] text-white/30 truncate">{label}</span>
    </div>
  )
}

export default async function RepoLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ repoId: string }>
}) {
  const { repoId } = await params

  return (
    <div className="flex flex-col">
      <Suspense fallback={<Skeleton className="h-[180px] w-full" />}>
        <RepoHeader repoId={repoId} />
      </Suspense>
      <div className="flex-1 overflow-y-auto p-6">{children}</div>
    </div>
  )
}
