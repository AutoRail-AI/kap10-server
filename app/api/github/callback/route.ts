import { headers } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { auth, listOrganizations, setActiveOrganization } from "@/lib/auth"
import { getContainer } from "@/lib/di/container"
import { getInstallationOctokit } from "@/lib/github/client"
import { errorResponse } from "@/lib/utils/api-response"

const BASE_URL = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

function parseStatePayload(stored: string): { orgId: string | null } {
  try {
    const parsed = JSON.parse(stored) as { orgId?: string }
    return { orgId: parsed?.orgId ?? null }
  } catch {
    return { orgId: null }
  }
}

export async function GET(req: NextRequest) {
  const reqHeaders = await headers()
  const session = await auth.api.getSession({ headers: reqHeaders })
  if (!session) {
    return errorResponse("Unauthorized", 401)
  }

  const { searchParams } = new URL(req.url)
  const installationIdRaw = searchParams.get("installation_id")
  const setupAction = searchParams.get("setup_action")
  const state = searchParams.get("state")

  if (!state) {
    return errorResponse("Missing state parameter", 400)
  }
  const container = getContainer()
  const stored = await container.cacheStore.get<string>(`github:install:state:${state}`)
  if (!stored) {
    return errorResponse("Invalid or expired state", 403)
  }
  await container.cacheStore.invalidate(`github:install:state:${state}`)

  if (!installationIdRaw) {
    return NextResponse.redirect(`${BASE_URL}/?error=missing_installation`)
  }
  const installationId = Number(installationIdRaw)
  if (!Number.isFinite(installationId)) {
    return errorResponse("Invalid installation_id", 400)
  }

  const orgs = await listOrganizations(reqHeaders)
  const { orgId: stateOrgId } = parseStatePayload(stored)

  if (orgs.length === 0) {
    return NextResponse.redirect(`${BASE_URL}/?error=create_workspace_first`)
  }

  const orgId =
    stateOrgId && orgs.some((o) => o.id === stateOrgId) ? stateOrgId : orgs[0]?.id ?? ""
  if (!orgId) {
    return NextResponse.redirect(`${BASE_URL}/?error=create_workspace_first`)
  }

  try {
    const octokit = getInstallationOctokit(installationId)
    const { data: inst } = await octokit.rest.apps.getInstallation({ installation_id: installationId })
    const account = inst.account as { login?: string; type?: string } | null
    const accountLogin = account?.login ?? "unknown"
    const accountType = account?.type === "Organization" ? "Organization" : "User"

    await setActiveOrganization(reqHeaders, orgId)

    const existing = await container.relationalStore.getInstallation(orgId)
    if (existing) {
      await container.relationalStore.deleteInstallation(orgId)
    }
    await container.relationalStore.createInstallation({
      organizationId: orgId,
      installationId,
      accountLogin,
      accountType,
      permissions: inst.permissions ?? undefined,
    })

    const { data: reposData } = await octokit.rest.apps.listReposAccessibleToInstallation({
      per_page: 100,
    })
    const repos = "repositories" in reposData ? reposData.repositories : []
    for (const r of repos) {
      const fullName = r.full_name ?? `${(r.owner as { login?: string })?.login}/${r.name}`
      const providerId = String(r.id)
      const existingRepo = await container.relationalStore.getRepoByGithubId(orgId, r.id)
      if (!existingRepo) {
        await container.relationalStore.createRepo({
          organizationId: orgId,
          name: r.name ?? fullName,
          fullName,
          provider: "github",
          providerId,
          status: "pending",
          defaultBranch: (r.default_branch as string) ?? "main",
          githubRepoId: r.id,
          githubFullName: fullName,
        })
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[github/callback]", message)
    return NextResponse.redirect(`${BASE_URL}/?error=callback_failed`)
  }

  const redirectUrl = setupAction === "install" ? `${BASE_URL}/?connected=true` : `${BASE_URL}/`
  return NextResponse.redirect(redirectUrl)
}
