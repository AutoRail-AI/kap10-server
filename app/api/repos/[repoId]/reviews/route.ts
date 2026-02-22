import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/di/container"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ repoId: string }> }
) {
  const { repoId } = await params
  const container = getContainer()

  const url = new URL(req.url)
  const status = url.searchParams.get("status") ?? undefined
  const limit = parseInt(url.searchParams.get("limit") ?? "20", 10)
  const cursor = url.searchParams.get("cursor") ?? undefined

  const result = await container.relationalStore.listPrReviews(repoId, { status, limit, cursor })
  return NextResponse.json(result)
}
