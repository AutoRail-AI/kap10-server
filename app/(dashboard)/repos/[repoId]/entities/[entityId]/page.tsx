import Link from "next/link"
import { notFound } from "next/navigation"
import { Suspense } from "react"
import { ChevronRight } from "lucide-react"
import { EntityDetail } from "@/components/entity/entity-detail"
import { Skeleton } from "@/components/ui/skeleton"
import { getActiveOrgId, getSessionCached } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { scoreJustification } from "@/lib/justification/quality-scorer"

async function EntityContent({ repoId, entityId }: { repoId: string; entityId: string }) {
  const session = await getSessionCached()
  if (!session) return null
  const orgId = await getActiveOrgId()
  const container = getContainer()

  const entity = await container.graphStore.getEntity(orgId, entityId)
  if (!entity) notFound()

  const [justification, callers, callees] = await Promise.all([
    container.graphStore.getJustification(orgId, entityId),
    container.graphStore.getCallersOf(orgId, entityId),
    container.graphStore.getCalleesOf(orgId, entityId),
  ])

  // Compute quality score and related metadata
  let qualityScore: number | null = null
  let qualityFlags: string[] = []
  let architecturalPattern: string | null = null
  let propagatedFeatureTag: string | null = null
  let propagatedDomainConcepts: string[] | null = null

  if (justification) {
    const qs = scoreJustification(justification)
    qualityScore = qs.score
    qualityFlags = qs.flags
    architecturalPattern = (justification.architectural_pattern as string) ?? null

    const pft = justification.propagated_feature_tag as string | undefined
    const pdc = justification.propagated_domain_concepts as string[] | undefined
    if (pft && pft !== justification.feature_tag) propagatedFeatureTag = pft
    if (pdc && pdc.length > 0) propagatedDomainConcepts = pdc
  }

  // Dead code check
  const isExported = (entity as Record<string, unknown>).exported === true
  const isEntryPoint = /\/(route|page|layout|middleware|proxy|main|index|cli)\.(ts|tsx|js|jsx)$/.test(entity.file_path)
  const isStructural = ["file", "module", "namespace", "directory", "type", "interface", "enum"].includes(entity.kind)
  const isDeadCode = !isStructural && !isExported && !isEntryPoint && callers.length === 0

  return (
    <div className="space-y-4">
      <nav className="flex items-center gap-1.5 text-sm">
        <Link href="/repos" className="text-muted-foreground hover:text-foreground transition-colors">
          Repositories
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        <Link href={`/repos/${repoId}`} className="text-muted-foreground hover:text-foreground transition-colors">
          {repoId}
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-foreground font-medium">{entity.name}</span>
      </nav>
      <EntityDetail
        entity={entity}
        justification={justification}
        callers={callers}
        callees={callees}
        qualityScore={qualityScore}
        qualityFlags={qualityFlags}
        architecturalPattern={architecturalPattern}
        propagatedFeatureTag={propagatedFeatureTag}
        propagatedDomainConcepts={propagatedDomainConcepts}
        isDeadCode={isDeadCode}
      />
    </div>
  )
}

export default async function EntityDetailPage({
  params,
}: {
  params: Promise<{ repoId: string; entityId: string }>
}) {
  const { repoId, entityId } = await params
  return (
    <div className="space-y-6 py-6 animate-fade-in">
      <Suspense fallback={<Skeleton className="h-[400px] w-full" />}>
        <EntityContent repoId={repoId} entityId={entityId} />
      </Suspense>
    </div>
  )
}
