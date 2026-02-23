import { headers } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { auth, listOrganizations, setActiveOrganization } from "@/lib/auth"
import { getContainer } from "@/lib/di/container"
import { getInstallationOctokit } from "@/lib/github/client"
import { errorResponse } from "@/lib/utils/api-response"
import { logger } from "@/lib/utils/logger"

const BASE_URL = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

/**
 * Extract orgId and optional cliPollToken from the state payload.
 * The cache store deserializes JSON automatically, so `stored` is already
 * an object — but we handle the string case defensively.
 */
function parseStatePayload(stored: unknown): { orgId: string | null; cliPollToken: string | null } {
  if (stored && typeof stored === "object" && "orgId" in stored) {
    const obj = stored as { orgId?: string; cliPollToken?: string }
    return {
      orgId: typeof obj.orgId === "string" ? obj.orgId : null,
      cliPollToken: typeof obj.cliPollToken === "string" ? obj.cliPollToken : null,
    }
  }
  if (typeof stored === "string") {
    try {
      const parsed = JSON.parse(stored) as { orgId?: string; cliPollToken?: string }
      return {
        orgId: parsed?.orgId ?? null,
        cliPollToken: parsed?.cliPollToken ?? null,
      }
    } catch {
      return { orgId: null, cliPollToken: null }
    }
  }
  return { orgId: null, cliPollToken: null }
}

const log = logger.child({ service: "github-callback" })

export async function GET(req: NextRequest) {
  const reqHeaders = await headers()
  const { searchParams } = new URL(req.url)
  const installationIdRaw = searchParams.get("installation_id")
  const setupAction = searchParams.get("setup_action")
  const state = searchParams.get("state")

  if (!state) {
    log.warn("Missing state parameter")
    return errorResponse("Missing state parameter", 400)
  }

  const container = getContainer()
  const stored = await container.cacheStore.get<{ orgId: string; cliPollToken?: string }>(
    `github:install:state:${state}`
  )
  if (!stored) {
    log.warn("Invalid or expired state")
    return errorResponse("Invalid or expired state", 403)
  }
  await container.cacheStore.invalidate(`github:install:state:${state}`)

  const { orgId: stateOrgId, cliPollToken } = parseStatePayload(stored)
  const isCliFlow = cliPollToken !== null

  // Determine orgId and userId based on flow type
  let orgId: string | null = null
  let userId = "cli"

  if (isCliFlow) {
    // CLI-initiated flow: orgId is pre-validated from the API key auth
    // that created the state token. No web session required.
    orgId = stateOrgId
    log.info("Processing CLI-initiated GitHub callback", { stateOrgId })
  } else {
    // Web flow: require session and validate org membership
    const session = await auth.api.getSession({ headers: reqHeaders })
    if (!session) {
      log.warn("GET /api/github/callback — unauthorized (web flow)")
      return errorResponse("Unauthorized", 401)
    }
    userId = session.user.id
    const orgs = await listOrganizations(reqHeaders)
    orgId = stateOrgId && orgs.some((o) => o.id === stateOrgId) ? stateOrgId : null
  }

  if (!orgId) {
    log.warn("No org context from state", { userId, stateOrgId })
    if (isCliFlow && cliPollToken) {
      await container.cacheStore.set(
        `github:cli-install:${cliPollToken}`,
        { status: "error", orgId: stateOrgId ?? "", error: "No org context" },
        600
      )
    }
    return NextResponse.redirect(`${BASE_URL}/?error=no_org_context`)
  }

  if (!installationIdRaw) {
    log.warn("Missing installation_id", { userId })
    if (isCliFlow && cliPollToken) {
      await container.cacheStore.set(
        `github:cli-install:${cliPollToken}`,
        { status: "error", orgId, error: "Missing installation_id" },
        600
      )
    }
    return NextResponse.redirect(`${BASE_URL}/?error=missing_installation`)
  }

  const installationId = Number(installationIdRaw)
  if (!Number.isFinite(installationId)) {
    log.warn("Invalid installation_id", { userId, installationIdRaw })
    return errorResponse("Invalid installation_id", 400)
  }

  const ctx = { userId, organizationId: orgId, installationId }
  log.info("Processing GitHub callback", ctx)

  let accountLogin = "unknown"
  let accountType = "User"

  try {
    const octokit = getInstallationOctokit(installationId)
    const { data: inst } = await octokit.rest.apps.getInstallation({ installation_id: installationId })
    const account = inst.account as { login?: string; type?: string } | null
    accountLogin = account?.login ?? "unknown"
    accountType = account?.type === "Organization" ? "Organization" : "User"

    if (!isCliFlow) {
      await setActiveOrganization(reqHeaders, orgId)
    }

    const existingByInstId = await container.relationalStore.getInstallationByInstallationId(installationId)
    if (existingByInstId) {
      log.info("Replacing existing installation", { ...ctx, existingId: existingByInstId.id })
      await container.relationalStore.deleteInstallationById(existingByInstId.id)
    }
    await container.relationalStore.createInstallation({
      organizationId: orgId,
      installationId,
      accountLogin,
      accountType,
      permissions: inst.permissions ?? undefined,
    })

    log.info("GitHub installation linked", { ...ctx, accountLogin, accountType })

    // Signal CLI poll token if this was a CLI-initiated install
    if (isCliFlow && cliPollToken) {
      await container.cacheStore.set(
        `github:cli-install:${cliPollToken}`,
        { status: "complete", orgId, installationId, accountLogin, accountType },
        600
      )
      log.info("CLI poll token signaled complete", { cliPollToken: cliPollToken.slice(0, 8) })
    }
  } catch (err: unknown) {
    log.error("GitHub callback failed", err instanceof Error ? err : undefined, ctx)
    if (isCliFlow && cliPollToken) {
      await container.cacheStore.set(
        `github:cli-install:${cliPollToken}`,
        { status: "error", orgId, error: err instanceof Error ? err.message : "callback_failed" },
        600
      )
    }
    return NextResponse.redirect(`${BASE_URL}/?error=callback_failed`)
  }

  if (isCliFlow) {
    return NextResponse.redirect(`${BASE_URL}/?cli_install=success&account=${accountLogin}`)
  }
  const redirectUrl = setupAction === "install" ? `${BASE_URL}/?connected=true` : `${BASE_URL}/`
  return NextResponse.redirect(redirectUrl)
}
