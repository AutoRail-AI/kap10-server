/**
 * GET /api/repos/[repoId]/history/indexing — Return indexing event history.
 */
import { headers } from "next/headers"
import { NextResponse } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { auth } from "@/lib/auth"
import { getContainer } from "@/lib/di/container"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ repoId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const orgId = await getActiveOrgId()
  const { repoId } = await params
  const container = getContainer()

  try {
    const events = await container.graphStore.getIndexEvents(orgId, repoId, 50)
    return NextResponse.json({ data: { events } })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch indexing history" },
      { status: 500 }
    )
  }
}
