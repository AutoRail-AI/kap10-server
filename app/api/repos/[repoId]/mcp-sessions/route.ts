/**
 * GET /api/repos/[repoId]/mcp-sessions — Active MCP session count for a repo.
 */

import { headers } from "next/headers"
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ repoId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { repoId } = await params

  // In production, this would scan Redis keys matching mcp:session:*
  // and filter by repoId, counting sessions with lastToolCallAt within 5 minutes.
  // For now, return the session count from cache metadata.
  // The actual implementation uses ICacheStore, but we can't do SCAN pattern matching
  // through the port interface without adding a new method.
  // This returns 0 and will be enhanced when the cache port supports key scanning.

  return NextResponse.json({
    repoId,
    activeSessions: 0,
    timestamp: new Date().toISOString(),
  })
}
