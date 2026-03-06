import { redirect } from "next/navigation"
import { ImpactView } from "@/components/intelligence/impact-view"
import { getSessionCached } from "@/lib/api/get-active-org"

export default async function BlueprintImpactPage({
  params,
}: {
  params: Promise<{ repoId: string }>
}) {
  const session = await getSessionCached()
  if (!session) redirect("/login")

  const { repoId } = await params

  return <ImpactView repoId={repoId} />
}
