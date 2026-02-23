/**
 * DELETE /api/api-keys/[id] — Revoke an API key.
 */

import { headers } from "next/headers"
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { logger } from "@/lib/utils/logger"

const log = logger.child({ service: "api-keys" })

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    log.warn("DELETE /api/api-keys/[id] — unauthorized")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  let orgId: string
  try {
    orgId = await getActiveOrgId()
  } catch {
    log.warn("DELETE /api/api-keys/[id] — no org context", { userId })
    return NextResponse.json({ error: "No organization context" }, { status: 400 })
  }

  const { id } = await params
  const ctx = { userId, organizationId: orgId, apiKeyId: id }
  log.info("Revoking API key", ctx)

  const container = getContainer()

  // Verify the key belongs to this org by listing and checking
  const keys = await container.relationalStore.listApiKeys(orgId)
  const key = keys.find((k) => k.id === id)
  if (!key) {
    log.warn("DELETE /api/api-keys/[id] — key not found", ctx)
    return NextResponse.json({ error: "API key not found" }, { status: 404 })
  }

  if (key.revokedAt) {
    log.warn("DELETE /api/api-keys/[id] — already revoked", ctx)
    return NextResponse.json({ error: "API key already revoked" }, { status: 400 })
  }

  // Revoke the key
  await container.relationalStore.revokeApiKey(id)

  // Invalidate Redis cache for this key hash
  await container.cacheStore.invalidate(`mcp:apikey:${key.keyHash}`)

  log.info("API key revoked", { ...ctx, keyPrefix: key.keyPrefix })
  return NextResponse.json({ success: true, revokedAt: new Date().toISOString() })
}
