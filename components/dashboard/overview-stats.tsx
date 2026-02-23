import type { LucideIcon } from "lucide-react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"

/**
 * Usage telemetry stat card. Labels in Cloud White, metric values in Electric Cyan.
 * Uses hover:shadow-glow-cyan for kap10 product lane.
 */
export function StatCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string
  value: string | number
  detail?: string
  icon: LucideIcon
}) {
  return (
    <Card className="glass-card border-border hover:shadow-glow-cyan transition-shadow duration-200 group">
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-foreground uppercase tracking-wider">{label}</p>
          <Icon className="h-4 w-4 text-electric-cyan opacity-70 group-hover:opacity-100 transition-opacity" />
        </div>
        <div className="font-grotesk text-2xl font-bold text-electric-cyan tracking-tight tabular-nums">
          {value}
        </div>
        {detail && (
          <p className="text-xs text-muted-foreground mt-1 font-mono">{detail}</p>
        )}
      </CardContent>
    </Card>
  )
}

export function RepoRowCompact({
  repo,
}: {
  repo: {
    id: string
    name: string
    fullName: string
    status: string
    fileCount?: number | null
    functionCount?: number | null
    classCount?: number | null
  }
}) {
  const statusColor =
    repo.status === "ready"
      ? "bg-electric-cyan shadow-[0_0_8px_rgba(0,229,255,0.4)]"
      : repo.status === "indexing"
        ? "bg-primary shadow-[0_0_8px_rgba(110,24,179,0.4)]"
        : repo.status === "error"
          ? "bg-destructive shadow-[0_0_8px_rgba(255,51,102,0.4)]"
          : "bg-muted-foreground"

  return (
    <Link
      href={repo.status === "ready" ? `/repos/${repo.id}` : `/repos`}
      className="flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-muted/20 group"
    >
      <span className={`h-2 w-2 rounded-full ${statusColor} shrink-0 transition-transform group-hover:scale-110`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate group-hover:text-electric-cyan transition-colors">{repo.name}</p>
        <p className="text-xs text-muted-foreground truncate font-mono opacity-80">{repo.fullName}</p>
      </div>
      <div className="text-xs text-muted-foreground shrink-0 font-mono">
        {repo.status === "ready"
          ? `${repo.fileCount ?? 0} files`
          : repo.status}
      </div>
    </Link>
  )
}

export function QuickActionCard({
  icon: Icon,
  title,
  description,
  href,
}: {
  icon: LucideIcon
  title: string
  description: string
  href: string
}) {
  return (
    <Link href={href}>
      <Card className="glass-card border-border hover:shadow-glow-purple transition-all duration-300 cursor-pointer group">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-muted/30 group-hover:border-electric-cyan/30 group-hover:bg-electric-cyan/10 transition-colors">
              <Icon className="h-4 w-4 text-foreground group-hover:text-electric-cyan transition-colors" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground group-hover:text-electric-cyan transition-colors">{title}</p>
              <p className="text-xs text-muted-foreground">{description}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
