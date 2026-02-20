/**
 * POST /api/api-keys — Create a new API key for a repo.
 * GET /api/api-keys — List API keys for the org.
 */

import { headers } from "next/headers"
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getContainer } from "@/lib/di/container"
import { generateApiKey } from "@/lib/mcp/auth"

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const orgId = (session.user as { organizationId?: string }).organizationId
  if (!orgId) {
    return NextResponse.json({ error: "No organization context" }, { status: 400 })
  }

  const body = (await request.json()) as { repoId: string; name: string; scopes?: string[] }
  if (!body.repoId || !body.name) {
    return NextResponse.json({ error: "repoId and name are required" }, { status: 400 })
  }

  const container = getContainer()

  // Verify repo exists and belongs to org
  const repo = await container.relationalStore.getRepo(orgId, body.repoId)
  if (!repo) {
    return NextResponse.json({ error: "Repository not found" }, { status: 404 })
  }
  if (repo.status !== "ready") {
    return NextResponse.json({ error: "Repository must be fully indexed before creating API keys" }, { status: 400 })
  }

  // Check API key limit (10 per repo)
  const existingKeys = await container.relationalStore.listApiKeys(orgId, body.repoId)
  const activeKeys = existingKeys.filter((k) => !k.revokedAt)
  if (activeKeys.length >= 10) {
    return NextResponse.json(
      { error: "API key limit reached (10 active keys per repository)" },
      { status: 400 }
    )
  }

  // Generate and store API key
  const { raw, hash, prefix } = generateApiKey()
  const scopes = body.scopes ?? ["mcp:read", "mcp:sync"]

  const apiKey = await container.relationalStore.createApiKey({
    organizationId: orgId,
    repoId: body.repoId,
    name: body.name,
    keyPrefix: prefix,
    keyHash: hash,
    scopes,
  })

  return NextResponse.json({
    id: apiKey.id,
    key: raw, // Returned ONCE — never stored or retrievable again
    keyPrefix: apiKey.keyPrefix,
    name: apiKey.name,
    scopes: apiKey.scopes,
    createdAt: apiKey.createdAt.toISOString(),
  })
}

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const orgId = (session.user as { organizationId?: string }).organizationId
  if (!orgId) {
    return NextResponse.json({ error: "No organization context" }, { status: 400 })
  }

  const container = getContainer()
  const keys = await container.relationalStore.listApiKeys(orgId)

  return NextResponse.json({
    keys: keys.map((k) => ({
      id: k.id,
      keyPrefix: k.keyPrefix,
      name: k.name,
      repoId: k.repoId,
      scopes: k.scopes,
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      revokedAt: k.revokedAt?.toISOString() ?? null,
      createdAt: k.createdAt.toISOString(),
    })),
  })
}
