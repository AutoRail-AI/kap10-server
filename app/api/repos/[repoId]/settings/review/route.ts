import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/di/container"
import type { ReviewConfig } from "@/lib/ports/types"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ repoId: string }> }
) {
  const { repoId } = await params
  const container = getContainer()
  const config = await container.relationalStore.getRepoReviewConfig(repoId)
  return NextResponse.json(config)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ repoId: string }> }
) {
  const { repoId } = await params
  const container = getContainer()

  const body = (await req.json()) as Partial<ReviewConfig>

  // Merge with existing config
  const current = await container.relationalStore.getRepoReviewConfig(repoId)
  const updated: ReviewConfig = {
    ...current,
    ...body,
    checksEnabled: {
      ...current.checksEnabled,
      ...(body.checksEnabled ?? {}),
    },
  }

  // Validate
  if (updated.impactThreshold < 0) {
    return NextResponse.json({ error: "impactThreshold must be non-negative" }, { status: 400 })
  }
  if (updated.complexityThreshold < 0) {
    return NextResponse.json({ error: "complexityThreshold must be non-negative" }, { status: 400 })
  }

  await container.relationalStore.updateRepoReviewConfig(repoId, updated)
  return NextResponse.json(updated)
}
