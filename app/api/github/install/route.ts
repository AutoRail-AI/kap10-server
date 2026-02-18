import { headers } from "next/headers"
import { NextResponse } from "next/server"
import { randomBytes } from "node:crypto"
import { auth } from "@/lib/auth"
import { getContainer } from "@/lib/di/container"
import { errorResponse } from "@/lib/utils/api-response"

const GITHUB_APP_SLUG = process.env.GITHUB_APP_SLUG ?? "kap10-dev"
const STATE_TTL_SECONDS = 600

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return errorResponse("Unauthorized", 401)
  }

  const state = randomBytes(24).toString("hex")
  const container = getContainer()
  await container.cacheStore.set(`github:install:state:${state}`, state, STATE_TTL_SECONDS)

  const installUrl = `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new?state=${state}`
  return NextResponse.redirect(installUrl)
}
