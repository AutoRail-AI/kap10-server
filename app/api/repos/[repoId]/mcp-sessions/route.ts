/**
 * GET /api/repos/[repoId]/mcp-sessions — Active MCP session count for a repo.
 */

import { headers } from "next/headers"
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { logger } from "@/lib/utils/logger"

const log = logger.child({ service: "mcp-sessions" })

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ repoId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    log.warn("GET /api/repos/[repoId]/mcp-sessions — unauthorized")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { repoId } = await params
  log.info("Fetching MCP sessions", { userId: session.user.id, repoId })

  return NextResponse.json({
    repoId,
    activeSessions: 0,
    timestamp: new Date().toISOString(),
  })
}
