/**
 * Phase 10a: Download graph snapshot for a repo.
 * GET /api/graph-snapshots/[repoId]/download
 *
 * Auth: session cookie (withAuth) OR Bearer API key (for CLI `kap10 pull`)
 * Returns pre-signed Supabase Storage URL (1h TTL) + metadata.
 */

import { NextRequest, NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { hashApiKey } from "@/lib/mcp/auth"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ repoId: string }> }
): Promise<NextResponse> {
  const { repoId } = await params

  // Try session auth first, then API key fallback
  let orgId: string | null = null

  const session = await auth.api.getSession({ headers: await headers() })
  if (session) {
    orgId = await getActiveOrgId()
  } else {
    // API key auth fallback for CLI
    const authHeader = req.headers.get("authorization")
    if (authHeader?.startsWith("Bearer kap10_sk_")) {
      const token = authHeader.slice(7)
      const keyHash = hashApiKey(token)
      const container = getContainer()
      const apiKey = await container.relationalStore.getApiKeyByHash(keyHash)
      if (apiKey && !apiKey.revokedAt && apiKey.repoId === repoId) {
        orgId = apiKey.organizationId
        void container.relationalStore.updateApiKeyLastUsed(apiKey.id).catch(() => {})
      }
    }
  }

  if (!orgId) {
    return errorResponse("Unauthorized", 401)
  }

  const { PrismaClient } = require("@prisma/client") as typeof import("@prisma/client")
  const prisma = new PrismaClient()

  try {
    const snapshot = await prisma.graphSnapshotMeta.findUnique({
      where: { repoId },
    })

    if (!snapshot || snapshot.orgId !== orgId) {
      return errorResponse("Snapshot not found", 404)
    }

    if (snapshot.status !== "available" || !snapshot.storagePath) {
      return errorResponse("Snapshot not available", 404)
    }

    // Generate pre-signed download URL (1 hour TTL)
    const { supabase } = require("@/lib/db") as typeof import("@/lib/db")
    const bucketName = process.env.GRAPH_SNAPSHOT_BUCKET ?? "graph-snapshots"

    const { data: signedUrl, error: signError } = await supabase.storage
      .from(bucketName)
      .createSignedUrl(snapshot.storagePath, 3600)

    if (signError || !signedUrl) {
      return errorResponse("Failed to generate download URL", 500)
    }

    return successResponse({
      url: signedUrl.signedUrl,
      checksum: snapshot.checksum,
      entityCount: snapshot.entityCount,
      edgeCount: snapshot.edgeCount,
      sizeBytes: snapshot.sizeBytes,
      generatedAt: snapshot.generatedAt?.toISOString() ?? null,
    })
  } finally {
    await prisma.$disconnect()
  }
}
