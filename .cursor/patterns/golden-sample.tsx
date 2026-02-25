/**
 * unerr server GOLDEN SAMPLE ARCHITECTURE
 * ----------------------------------------------------------------------------
 * This component demonstrates the "Glass Brain" architecture for unerr server
 * pages. Use this pattern for all new dashboard and complex UI views.
 *
 * SHELL CONTEXT:
 * - The Master Application Shell (Sidebar + layout) is provided by
 *   app/(dashboard)/layout.tsx. This sample shows PAGE CONTENT ONLY.
 * - Pages render inside <main className="flex-1 overflow-y-auto p-6">.
 *
 * KEY PRINCIPLES (Following docs/UI_UX_GUIDE.md and .cursorrules):
 * 1. Layout: Header -> Stats Grid -> Main Content (Tabs/Tables/Grid)
 * 2. Visuals: Design tokens (bg-background, glass-card, border-border), Rail Purple + Electric Cyan
 * 3. Typography: font-grotesk (Space Grotesk) for headings, font-sans (Inter) for body, font-mono (JetBrains Mono) for code
 * 4. Spacing: space-y-6 py-6 for page container, space-y-4 for sections
 * 5. Components: size="sm" for buttons, h-9 for inputs, Server Components by default
 * 6. UX: Skeleton Loading with Suspense, Empty States, proper design tokens
 *
 * COMPLIANCE:
 * - Page title: text-lg font-semibold (never larger)
 * - Uses design tokens (glass-card, glass-panel, border-border) not hardcoded colors
 * - Server Component by default (no 'use client' unless needed)
 * - Avoids CardHeader/CardTitle/CardDescription (uses inline structure with CardContent)
 * - No Loader2 (use Spinner from @shadcn/spinner)
 * - Accessibility: aria-label on icon buttons, Label/aria-label on inputs, focus-visible:ring-ring
 * - Enterprise: WCAG AA contrast, keyboard nav, reduced-motion support (see brand/brand.md)
 */

// Server Component by default - add 'use client' only if hooks/interactivity needed
import {
  Activity,
  ArrowRight,
  Brain,
  CheckCircle2,
  Code2,
  LayoutDashboard,
  Plus,
  Search,
  Sparkles,
} from "lucide-react"
import React, { Suspense } from "react"

// --- UI Primitives (In production, import from @/components/ui) ---
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

// --- Mock Data (Replace with Supabase + React Query) ---
const PROJECTS_DATA = [
  {
    id: "1",
    name: "legacy-invoicing-v2",
    status: "ready" as const,
    confidence_score: 0.92,
    description: "Migrating legacy VB6 invoicing module to Next.js",
    updated_at: "2025-02-06T10:30:00Z",
  },
  {
    id: "2",
    name: "cobol-payroll-extract",
    status: "processing" as const,
    confidence_score: 0.67,
    description: "COBOL mainframe payroll to cloud-native API",
    updated_at: "2025-02-06T09:15:00Z",
  },
  {
    id: "3",
    name: "asp-classic-crm",
    status: "pending" as const,
    confidence_score: 0,
    description: "Classic ASP CRM migration",
    updated_at: "2025-02-05T16:00:00Z",
  },
]

// --- 1. Page Component (The View Layer) ---
// Renders inside app/(dashboard)/layout.tsx main content area
export default function ProjectLazarusDashboardPage() {
  return (
    <div className="space-y-6 py-6 animate-fade-in">
      {/* 2. Page Header - MANDATORY: text-lg font-semibold (never larger) */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <h1 className="font-grotesk text-lg font-semibold text-foreground">
            Projects
          </h1>
          <p className="text-sm text-foreground mt-0.5">
            Manage your legacy code migration projects and track transmutation
            progress.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="border-rail-purple/30 text-electric-cyan hover:bg-rail-purple/10"
          >
            <LayoutDashboard className="mr-2 h-3.5 w-3.5" />
            View All
          </Button>
          <Button
            size="sm"
            className="bg-rail-fade hover:opacity-90 transition-opacity shadow-glow-purple"
          >
            <Plus className="mr-2 h-3.5 w-3.5" />
            New Project
          </Button>
        </div>
      </div>

      {/* 3. Stats Grid (Glass Brain Cards) */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="Total Projects"
          value="12"
          icon={<LayoutDashboard className="h-4 w-4 text-electric-cyan" />}
        />
        <StatsCard
          title="Active Migrations"
          value="3"
          icon={<Activity className="h-4 w-4 text-rail-purple" />}
          trend="2 in progress"
        />
        <StatsCard
          title="Avg Confidence"
          value="87%"
          icon={<Brain className="h-4 w-4 text-success" />}
          trend="+5% this week"
        />
        <StatsCard
          title="Slices Complete"
          value="42"
          icon={<CheckCircle2 className="h-4 w-4 text-rail-purple" />}
        />
      </div>

      {/* 4. Main Content Area */}
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <Tabs defaultValue="projects" className="w-full">
            <TabsList className="bg-transparent p-0">
              <LazarusTabTrigger value="projects">Projects</LazarusTabTrigger>
              <LazarusTabTrigger value="glass-brain">
                Glass Brain
              </LazarusTabTrigger>
            </TabsList>
          </Tabs>

          {/* Search Input - MANDATORY: h-9 height, aria-label for a11y */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" aria-hidden />
            <Input
              aria-label="Search projects"
              placeholder="Search projects..."
              className="h-9 w-[200px] bg-muted/30 border-border pl-9 text-sm text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
          </div>
        </div>

        <Suspense fallback={<DashboardSkeleton />}>
          <ProjectsTable data={PROJECTS_DATA} />
        </Suspense>
      </div>

      {/* 5. Glass Brain Preview (Condensed pattern) */}
      <div className="grid gap-4 lg:grid-cols-3">
        <GlassBrainPane
          title="The Plan"
          icon={<Code2 className="h-4 w-4" />}
          content="Dependency graph of vertical slices"
        />
        <GlassBrainPane
          title="The Work"
          icon={<Sparkles className="h-4 w-4" />}
          content="Terminal-like streaming output"
        />
        <GlassBrainPane
          title="The Thoughts"
          icon={<Brain className="h-4 w-4" />}
          content="Agent reasoning and inner monologue"
        />
      </div>
    </div>
  )
}

// --- SUB-COMPONENTS ---

function StatsCard({
  title,
  value,
  icon,
  trend,
}: {
  title: string
  value: string
  icon: React.ReactNode
  trend?: string
}) {
  return (
    <Card className="glass-card border-border hover:shadow-glow-purple transition-all duration-300">
      <CardContent className="pt-6">
        <div className="flex flex-row items-center justify-between mb-2">
          <p className="text-xs font-medium text-muted-foreground font-sans">
            {title}
          </p>
          {icon}
        </div>
        <div className="font-grotesk text-2xl font-bold text-foreground tracking-tight">
          {value}
        </div>
        {trend && (
          <p className="text-xs text-muted-foreground mt-1 font-mono">
            {trend}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function ProjectsTable({
  data,
}: {
  data: typeof PROJECTS_DATA
}) {
  const statusColors: Record<
    string,
    string
  > = {
    pending: "bg-slate-grey/50 text-muted-foreground border-border",
    processing: "bg-electric-cyan/10 text-electric-cyan border-electric-cyan/20",
    ready: "bg-rail-purple/10 text-quantum-violet border-rail-purple/20",
    building: "bg-warning/10 text-warning border-warning/20",
    complete: "bg-success/10 text-success border-success/20",
  }

  return (
    <Card className="glass-panel border-border">
      <CardContent className="pt-6">
        <div className="space-y-1 mb-4">
          <h3 className="font-grotesk text-sm font-semibold text-foreground">
            Migration Projects
          </h3>
          <p className="text-xs text-muted-foreground">
            Click a project to open the Glass Brain Dashboard.
          </p>
        </div>
        <div className="relative w-full overflow-auto">
          <table className="w-full text-sm caption-bottom text-left">
            <thead className="[&_tr]:border-b [&_tr]:border-border">
              <tr className="border-b transition-colors hover:bg-transparent">
                <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground text-xs">
                  Name
                </th>
                <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground text-xs">
                  Status
                </th>
                <th className="h-10 px-4 text-right align-middle font-medium text-muted-foreground text-xs">
                  Confidence
                </th>
                <th className="h-10 px-4 text-right align-middle font-medium text-muted-foreground text-xs">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="[&_tr:last-child]:border-0">
              {data.map((project) => (
                <tr
                  key={project.id}
                  className="border-b border-border transition-colors hover:bg-muted/30"
                >
                  <td className="p-4 align-middle">
                    <div>
                      <span className="font-mono text-sm font-medium text-foreground">
                        {project.name}
                      </span>
                      <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                        {project.description}
                      </p>
                    </div>
                  </td>
                  <td className="p-4 align-middle">
                    <Badge
                      variant="outline"
                      className={statusColors[project.status] ?? statusColors.pending}
                    >
                      {project.status}
                    </Badge>
                  </td>
                  <td className="p-4 align-middle text-right">
                    <span
                      className={`font-mono text-sm ${
                        project.confidence_score >= 0.85
                          ? "text-success"
                          : project.confidence_score >= 0.5
                            ? "text-warning"
                            : "text-muted-foreground"
                      }`}
                    >
                      {project.confidence_score > 0
                        ? `${Math.round(project.confidence_score * 100)}%`
                        : "—"}
                    </span>
                  </td>
                  <td className="p-4 align-middle text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-electric-cyan focus-visible:ring-ring"
                      aria-label={`Open project ${project.name}`}
                    >
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

function GlassBrainPane({
  title,
  icon,
  content,
}: {
  title: string
  icon: React.ReactNode
  content: string
}) {
  return (
    <div className="glass-panel rounded-lg border border-border overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <span className="text-xs font-medium text-muted-foreground flex items-center gap-2">
          {icon}
          {title}
        </span>
      </div>
      <div className="p-4 font-mono text-xs text-foreground">
        {content}
      </div>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-[125px] w-full rounded-lg border border-border bg-card/50" />
      <Skeleton className="h-[300px] w-full rounded-lg border border-border bg-card/50" />
    </div>
  )
}

// Custom Tab Trigger with Rail Purple active state
function LazarusTabTrigger({
  value,
  children,
}: {
  value: string
  children: React.ReactNode
}) {
  return (
    <TabsTrigger
      value={value}
      className="relative h-9 rounded-none border-b-2 border-transparent bg-transparent px-4 pb-3 pt-2 font-sans font-medium text-muted-foreground shadow-none transition-none data-[state=active]:border-rail-purple data-[state=active]:text-electric-cyan data-[state=active]:shadow-[0_4px_12px_-4px_rgba(0,229,255,0.3)]"
    >
      {children}
    </TabsTrigger>
  )
}
