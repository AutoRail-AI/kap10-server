import type { LucideIcon } from "lucide-react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"

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
    <Card className="glass-card border-border">
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{label}</p>
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <p className="font-grotesk text-2xl font-semibold text-foreground mt-1">{value}</p>
        {detail && <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>}
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
      ? "bg-electric-cyan"
      : repo.status === "indexing"
        ? "bg-primary"
        : repo.status === "error"
          ? "bg-destructive"
          : "bg-muted-foreground"

  return (
    <Link
      href={repo.status === "ready" ? `/repos/${repo.id}` : `/repos`}
      className="flex items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-muted/20"
    >
      <span className={`h-2 w-2 rounded-full ${statusColor} flex-shrink-0`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{repo.name}</p>
        <p className="text-xs text-muted-foreground truncate">{repo.fullName}</p>
      </div>
      <div className="text-xs text-muted-foreground flex-shrink-0">
        {repo.status === "ready"
          ? `${repo.fileCount ?? 0} files · ${(repo.functionCount ?? 0) + (repo.classCount ?? 0)} entities`
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
      <Card className="glass-card border-border hover:shadow-glow-purple transition cursor-pointer">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-muted/30">
              <Icon className="h-4 w-4 text-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{title}</p>
              <p className="text-xs text-muted-foreground">{description}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
