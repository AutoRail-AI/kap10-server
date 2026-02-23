import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { ImpactView } from "@/components/intelligence/impact-view"
import { auth } from "@/lib/auth"

export default async function ImpactPage({
  params,
}: {
  params: Promise<{ repoId: string }>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect("/login")

  const { repoId } = await params

  return (
    <div className="space-y-6 py-6 animate-fade-in">
      <div className="space-y-1">
        <h1 className="font-grotesk text-lg font-semibold text-foreground">Impact Analysis</h1>
        <p className="text-sm text-foreground mt-0.5">Blast radius and upstream boundary visualization</p>
      </div>
      <ImpactView repoId={repoId} />
    </div>
  )
}
