import { redirect } from "next/navigation"
import { BlueprintView } from "@/components/blueprint/blueprint-view"
import { getSessionCached } from "@/lib/api/get-active-org"

export default async function BlueprintPage({
  params,
}: {
  params: Promise<{ repoId: string }>
}) {
  const session = await getSessionCached()
  if (!session) redirect("/login")

  const { repoId } = await params

  return <BlueprintView repoId={repoId} />
}
