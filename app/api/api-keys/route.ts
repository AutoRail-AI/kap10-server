/**
 * POST /api/api-keys — Create a new API key for a repo.
 * GET /api/api-keys — List API keys for the org.
 */

import { headers } from "next/headers"
import { NextResponse } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { auth } from "@/lib/auth"
import { getContainer } from "@/lib/di/container"
import { generateApiKey } from "@/lib/mcp/auth"
import { logger } from "@/lib/utils/logger"

const log = logger.child({ service: "api-keys" })

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    log.warn("POST /api/api-keys — unauthorized")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  let orgId: string
  try {
    orgId = await getActiveOrgId()
  } catch {
    log.warn("POST /api/api-keys — no org context", { userId })
    return NextResponse.json({ error: "No organization context" }, { status: 400 })
  }

  const ctx = { userId, organizationId: orgId }
  const body = (await request.json()) as { repoId?: string; name: string; scopes?: string[] }
  if (!body.name) {
    log.warn("POST /api/api-keys — missing name", ctx)
    return NextResponse.json({ error: "name is required" }, { status: 400 })
  }

  log.info("Creating API key", { ...ctx, repoId: body.repoId, keyName: body.name })
  const container = getContainer()

  // If repo-scoped, verify repo exists and belongs to org
  if (body.repoId) {
    const repo = await container.relationalStore.getRepo(orgId, body.repoId)
    if (!repo) {
      log.warn("POST /api/api-keys — repo not found", { ...ctx, repoId: body.repoId })
      return NextResponse.json({ error: "Repository not found" }, { status: 404 })
    }
    if (repo.status !== "ready") {
      log.warn("POST /api/api-keys — repo not ready", { ...ctx, repoId: body.repoId, repoStatus: repo.status })
      return NextResponse.json({ error: "Repository must be fully indexed before creating API keys" }, { status: 400 })
    }

    // Check API key limit (10 per repo)
    const existingKeys = await container.relationalStore.listApiKeys(orgId, body.repoId)
    const activeKeys = existingKeys.filter((k) => !k.revokedAt)
    if (activeKeys.length >= 10) {
      log.warn("POST /api/api-keys — key limit reached", { ...ctx, repoId: body.repoId, activeKeyCount: activeKeys.length })
      return NextResponse.json(
        { error: "API key limit reached (10 active keys per repository)" },
        { status: 400 }
      )
    }
  }

  // Generate and store API key
  const { raw, hash, prefix } = generateApiKey()
  const scopes = body.scopes ?? ["mcp:read", "mcp:sync"]

  const apiKey = await container.relationalStore.createApiKey({
    organizationId: orgId,
    repoId: body.repoId ?? null,
    name: body.name,
    keyPrefix: prefix,
    keyHash: hash,
    scopes,
  })

  log.info("API key created", { ...ctx, apiKeyId: apiKey.id, keyPrefix: prefix, repoId: body.repoId })
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
    log.warn("GET /api/api-keys — unauthorized")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  let orgId: string
  try {
    orgId = await getActiveOrgId()
  } catch {
    log.warn("GET /api/api-keys — no org context", { userId })
    return NextResponse.json({ error: "No organization context" }, { status: 400 })
  }

  log.info("Listing API keys", { userId, organizationId: orgId })
  const container = getContainer()
  const keys = await container.relationalStore.listApiKeys(orgId)

  log.info("API keys listed", { userId, organizationId: orgId, keyCount: keys.length })
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
