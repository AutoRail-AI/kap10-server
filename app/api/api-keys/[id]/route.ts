/**
 * DELETE /api/api-keys/[id] — Revoke an API key.
 */

import { headers } from "next/headers"
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getContainer } from "@/lib/di/container"

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const orgId = (session.user as { organizationId?: string }).organizationId
  if (!orgId) {
    return NextResponse.json({ error: "No organization context" }, { status: 400 })
  }

  const { id } = await params
  const container = getContainer()

  // Verify the key belongs to this org by listing and checking
  const keys = await container.relationalStore.listApiKeys(orgId)
  const key = keys.find((k) => k.id === id)
  if (!key) {
    return NextResponse.json({ error: "API key not found" }, { status: 404 })
  }

  if (key.revokedAt) {
    return NextResponse.json({ error: "API key already revoked" }, { status: 400 })
  }

  // Revoke the key
  await container.relationalStore.revokeApiKey(id)

  // Invalidate Redis cache for this key hash
  await container.cacheStore.invalidate(`mcp:apikey:${key.keyHash}`)

  return NextResponse.json({ success: true, revokedAt: new Date().toISOString() })
}
