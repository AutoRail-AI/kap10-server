/**
 * Git HTTP Smart Protocol Proxy — Phase 13 security boundary.
 *
 * This is the ONLY public entry point for Git operations. The internal Gitea
 * instance has no ports exposed and lives on Docker's internal network.
 *
 * Route patterns:
 *   POST /api/git/{orgId}/{repoId}/info/refs?service=git-receive-pack
 *   POST /api/git/{orgId}/{repoId}/git-receive-pack
 *   POST /api/git/{orgId}/{repoId}/git-upload-pack
 *   GET  /api/git/{orgId}/{repoId}/info/refs?service=git-upload-pack
 *
 * Auth: Bearer token (API key) in Authorization header.
 * Body: Raw Git protocol bytes — streamed through without modification.
 */

import { NextResponse } from "next/server"
import { logger } from "@/lib/utils/logger"

const log = logger.child({ service: "git-proxy" })

/** Gitea internal URL — never exposed publicly */
function getGiteaBaseUrl(): string {
  return process.env.GITEA_URL?.replace(/\/$/, "") ?? "http://localhost:3001"
}

function getGiteaToken(): string {
  const token = process.env.GITEA_ADMIN_TOKEN
  if (!token) throw new Error("[git-proxy] GITEA_ADMIN_TOKEN env var is required")
  return token
}

/** Allowed Git smart protocol endpoints */
const ALLOWED_ACTIONS = new Set([
  "info/refs",
  "git-receive-pack",
  "git-upload-pack",
])

/**
 * Validate the API key from the Authorization header.
 * Returns the orgId if valid, null if invalid.
 */
async function validateApiKey(authHeader: string | null): Promise<{ orgId: string; repoId?: string } | null> {
  if (!authHeader?.startsWith("Bearer ")) return null

  const apiKey = authHeader.slice(7)
  if (!apiKey) return null

  try {
    // Lazy-load to avoid connecting to DB at build time
    const crypto = require("node:crypto") as typeof import("node:crypto")
    const keyHash = crypto.createHash("sha256").update(apiKey).digest("hex")

    const { getPrisma } = require("@/lib/db/prisma") as typeof import("@/lib/db/prisma")
    const prisma = getPrisma()
    const key = await prisma.apiKey.findFirst({
      where: {
        keyHash,
        revokedAt: null,
      },
    })

    if (!key) return null

    // Update last used
    prisma.apiKey.update({
      where: { id: key.id },
      data: { lastUsedAt: new Date() },
    }).catch(() => {}) // fire-and-forget

    return { orgId: key.organizationId, repoId: key.repoId ?? undefined }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    log.warn("API key validation failed", { error: msg })
    return null
  }
}

/**
 * Parse the slug into orgId, repoId, and git action.
 * /api/git/org123/repo456/git-receive-pack → { orgId: "org123", repoId: "repo456", action: "git-receive-pack" }
 * /api/git/org123/repo456/info/refs → { orgId: "org123", repoId: "repo456", action: "info/refs" }
 */
function parseSlug(slug: string[]): { orgId: string; repoId: string; action: string } | null {
  if (slug.length < 3) return null

  const orgId = slug[0]!
  const repoId = slug[1]!

  // Handle "info/refs" which spans two slug segments
  if (slug[2] === "info" && slug[3] === "refs") {
    return { orgId, repoId, action: "info/refs" }
  }

  const action = slug[2]!
  if (!ALLOWED_ACTIONS.has(action)) return null
  return { orgId, repoId, action }
}

/**
 * Build the Gitea-internal URL for the proxied request.
 * Gitea stores repos as {orgId}/{repoId}.git internally.
 */
function buildGiteaUrl(orgId: string, repoId: string, action: string, searchParams: URLSearchParams): string {
  const base = getGiteaBaseUrl()
  const repoPath = `${orgId}/${repoId}.git`
  const url = `${base}/${repoPath}/${action}`
  const qs = searchParams.toString()
  return qs ? `${url}?${qs}` : url
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  return handleRequest(request, await params)
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  return handleRequest(request, await params)
}

async function handleRequest(
  request: Request,
  { slug }: { slug: string[] }
): Promise<Response> {
  // Step 1: Parse the route
  const parsed = parseSlug(slug)
  if (!parsed) {
    return NextResponse.json({ error: "Invalid git endpoint" }, { status: 404 })
  }
  const { orgId, repoId, action } = parsed

  // Step 2: Validate API key
  const auth = await validateApiKey(request.headers.get("authorization"))
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Step 3: Verify the API key's org matches the requested org
  if (auth.orgId !== orgId) {
    log.warn("Org mismatch in git proxy", { keyOrg: auth.orgId, requestedOrg: orgId })
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Step 4: If the key is repo-scoped, verify it matches
  if (auth.repoId && auth.repoId !== repoId) {
    log.warn("Repo mismatch in git proxy", { keyRepo: auth.repoId, requestedRepo: repoId })
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Step 5: Build the Gitea URL and proxy
  const url = new URL(request.url)
  const giteaUrl = buildGiteaUrl(orgId, repoId, action, url.searchParams)
  const giteaToken = getGiteaToken()

  try {
    // Proxy the request body (raw Git protocol bytes) to Gitea
    const giteaResponse = await fetch(giteaUrl, {
      method: request.method,
      headers: {
        "Content-Type": request.headers.get("content-type") ?? "application/octet-stream",
        Authorization: `token ${giteaToken}`,
      },
      body: request.method === "POST" ? request.body : undefined,
      // @ts-expect-error -- duplex is needed for streaming request bodies in Node 18+
      duplex: "half",
    })

    // Stream Gitea's response back to the client
    return new Response(giteaResponse.body, {
      status: giteaResponse.status,
      headers: {
        "Content-Type": giteaResponse.headers.get("content-type") ?? "application/octet-stream",
        "Cache-Control": "no-cache",
      },
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    log.error("Git proxy failed", undefined, { giteaUrl, error: msg })
    return NextResponse.json({ error: "Git server unavailable" }, { status: 502 })
  }
}
