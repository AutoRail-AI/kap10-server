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

  return (
    <div className="space-y-6 py-6 animate-fade-in">
      <div className="space-y-1">
        <h1 className="font-grotesk text-lg font-semibold text-foreground">Blueprint</h1>
        <p className="text-sm text-foreground mt-0.5">Feature map and taxonomy overview</p>
      </div>
      <BlueprintView repoId={repoId} />
    </div>
  )
}
