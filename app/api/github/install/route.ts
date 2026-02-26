import { headers } from "next/headers"
import { NextResponse } from "next/server"
import { randomBytes } from "node:crypto"
import { auth, listOrganizations } from "@/lib/auth"
import { getContainer } from "@/lib/di/container"
import { errorResponse } from "@/lib/utils/api-response"
import { logger } from "@/lib/utils/logger"

const log = logger.child({ service: "github-install" })

const _BASE_URL = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
const GITHUB_APP_SLUG = process.env.GITHUB_APP_SLUG ?? "unerr-dev"
const STATE_TTL_SECONDS = 600

export async function GET(req: Request) {
  const reqHeaders = await headers()
  const session = await auth.api.getSession({ headers: reqHeaders })
  if (!session) {
    log.warn("GET /api/github/install — unauthorized")
    return errorResponse("Unauthorized", 401)
  }

  const userId = session.user.id
  const { searchParams } = new URL(req.url)
  const orgId = searchParams.get("orgId")

  if (!orgId) {
    log.warn("GET /api/github/install — missing orgId", { userId })
    return errorResponse("Missing orgId. An active organization is required.", 400)
  }

  // Verify the user actually belongs to this org
  const orgs = await listOrganizations(reqHeaders)
  if (!orgs.some((o) => o.id === orgId)) {
    log.warn("GET /api/github/install — org access denied", { userId, organizationId: orgId })
    return errorResponse("Organization not found or access denied.", 403)
  }

  const state = randomBytes(24).toString("hex")
  const container = getContainer()
  await container.cacheStore.set(
    `github:install:state:${state}`,
    { orgId },
    STATE_TTL_SECONDS
  )

  log.info("Redirecting to GitHub app install", { userId, organizationId: orgId })
  const installUrl = `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new?state=${state}`
  return NextResponse.redirect(installUrl)
}
