import { headers } from "next/headers"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Suspense } from "react"
import { ChevronRight } from "lucide-react"
import { EntityDetail } from "@/components/entity/entity-detail"
import { Skeleton } from "@/components/ui/skeleton"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { auth } from "@/lib/auth"
import { getContainer } from "@/lib/di/container"

async function EntityContent({ repoId, entityId }: { repoId: string; entityId: string }) {
  const session = await auth.api.getSession({ headers: await headers() })
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
