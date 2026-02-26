/**
 * Phase 10a: Download graph snapshot for a repo.
 * GET /api/graph-snapshots/[repoId]/download
 *
 * Auth: session cookie (withAuth) OR Bearer API key (for CLI `unerr pull`)
 * Returns pre-signed Supabase Storage URL (1h TTL) + metadata.
 */

import { headers } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { auth } from "@/lib/auth"
import { getContainer } from "@/lib/di/container"
import { hashApiKey } from "@/lib/mcp/auth"
import { errorResponse, successResponse } from "@/lib/utils/api-response"
import { logger } from "@/lib/utils/logger"

const log = logger.child({ service: "graph-snapshot-download" })

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ repoId: string }> }
): Promise<NextResponse> {
  const { repoId } = await params

  // Try session auth first, then API key fallback
  let orgId: string | null = null
  let authMode = "none"

  const session = await auth.api.getSession({ headers: await headers() })
  if (session) {
    orgId = await getActiveOrgId()
    authMode = "session"
  } else {
    // API key auth fallback for CLI
    const authHeader = req.headers.get("authorization")
    if (authHeader?.startsWith("Bearer unerr_sk_")) {
      const token = authHeader.slice(7)
      const keyHash = hashApiKey(token)
      const container = getContainer()
      const apiKey = await container.relationalStore.getApiKeyByHash(keyHash)
      if (apiKey && !apiKey.revokedAt && apiKey.repoId === repoId) {
        orgId = apiKey.organizationId
        authMode = "api_key"
        void container.relationalStore.updateApiKeyLastUsed(apiKey.id).catch(() => {})
      }
    }
  }

  if (!orgId) {
    log.warn("GET /api/graph-snapshots/[repoId]/download — unauthorized", { repoId })
    return errorResponse("Unauthorized", 401)
  }

  log.info("Downloading graph snapshot", { organizationId: orgId, repoId, authMode, userId: session?.user.id })

  const { getPrisma } = require("@/lib/db/prisma") as typeof import("@/lib/db/prisma")
  const prisma = getPrisma()

  const snapshot = await prisma.graphSnapshotMeta.findUnique({
    where: { repoId },
  })

  if (!snapshot || snapshot.orgId !== orgId) {
    log.warn("Snapshot not found", { organizationId: orgId, repoId })
    return errorResponse("Snapshot not found", 404)
  }

  if (snapshot.status !== "available" || !snapshot.storagePath) {
    log.warn("Snapshot not available", { organizationId: orgId, repoId, snapshotStatus: snapshot.status })
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
}
