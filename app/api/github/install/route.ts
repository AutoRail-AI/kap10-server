import { headers } from "next/headers"
import { NextResponse } from "next/server"
import { randomBytes } from "node:crypto"
import { auth, listOrganizations } from "@/lib/auth"
import { getContainer } from "@/lib/di/container"
import { errorResponse } from "@/lib/utils/api-response"

const BASE_URL = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
const GITHUB_APP_SLUG = process.env.GITHUB_APP_SLUG ?? "kap10-dev"
const STATE_TTL_SECONDS = 600

export async function GET(req: Request) {
  const reqHeaders = await headers()
  const session = await auth.api.getSession({ headers: reqHeaders })
  if (!session) {
    return errorResponse("Unauthorized", 401)
  }

  const orgs = await listOrganizations(reqHeaders)
  if (orgs.length === 0) {
    return NextResponse.redirect(`${BASE_URL}/?error=create_workspace_first`)
  }

  const { searchParams } = new URL(req.url)
  const orgIdParam = searchParams.get("orgId")
  const activeOrgId =
    orgIdParam && orgs.some((o) => o.id === orgIdParam) ? orgIdParam : orgs[0]?.id ?? ""

  const state = randomBytes(24).toString("hex")
  const container = getContainer()
  await container.cacheStore.set(
    `github:install:state:${state}`,
    JSON.stringify({ orgId: activeOrgId }),
    STATE_TTL_SECONDS
  )

  const installUrl = `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new?state=${state}`
  return NextResponse.redirect(installUrl)
}
