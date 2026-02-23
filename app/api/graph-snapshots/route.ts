/**
 * Phase 10a: List graph snapshots for the active org.
 * GET /api/graph-snapshots
 */

import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getPrisma } from "@/lib/db/prisma"
import { withAuth } from "@/lib/middleware/api-handler"
import { successResponse, errorResponse } from "@/lib/utils/api-response"

export const GET = withAuth(async () => {
  const orgId = await getActiveOrgId()
  if (!orgId) {
    return errorResponse("No organization", 400)
  }

  const prisma = getPrisma()

  const snapshots = await prisma.graphSnapshotMeta.findMany({
    where: { orgId },
    orderBy: { generatedAt: "desc" },
  })

  return successResponse({
    snapshots: snapshots.map((s: {
      id: string
      repoId: string
      status: string
      checksum: string | null
      sizeBytes: number
      entityCount: number
      edgeCount: number
      generatedAt: Date | null
      createdAt: Date
    }) => ({
      id: s.id,
      repoId: s.repoId,
      status: s.status,
      checksum: s.checksum,
      sizeBytes: s.sizeBytes,
      entityCount: s.entityCount,
      edgeCount: s.edgeCount,
      generatedAt: s.generatedAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
    })),
  })
})
