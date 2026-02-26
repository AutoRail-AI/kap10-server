/**
 * Phase 10b: POST /api/prefetch — Predictive context pre-warming.
 *
 * Accepts cursor context from the CLI, expands the entity graph N-hops,
 * and caches the result in Redis for fast subsequent lookups.
 */

import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { prefetchContext } from "@/lib/use-cases/prefetch-context"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

const PrefetchBodySchema = {
  validate(body: unknown): { filePath: string; line?: number; entityKey?: string; repoId: string } | null {
    if (!body || typeof body !== "object") return null
    const b = body as Record<string, unknown>
    if (typeof b.repoId !== "string" || !b.repoId) return null
    if (typeof b.filePath !== "string" || !b.filePath) return null
    return {
      filePath: b.filePath as string,
      line: typeof b.line === "number" ? b.line : undefined,
      entityKey: typeof b.entityKey === "string" ? b.entityKey : undefined,
      repoId: b.repoId as string,
    }
  },
}

export const POST = withAuth(async (req: NextRequest) => {
  const orgId = await getActiveOrgId()
  if (!orgId) return errorResponse("No organization", 400)

  const body = (await req.json()) as Record<string, unknown>
  const parsed = PrefetchBodySchema.validate(body)
  if (!parsed) {
    return errorResponse("Invalid body: filePath and repoId are required", 400)
  }

  const container = getContainer()

  // Verify repo exists
  const repo = await container.relationalStore.getRepo(orgId, parsed.repoId)
  if (!repo) return errorResponse("Repo not found", 404)

  // Fire-and-forget context expansion (don't block the response)
  prefetchContext(container, {
    orgId,
    repoId: parsed.repoId,
    filePath: parsed.filePath,
    line: parsed.line,
    entityKey: parsed.entityKey,
  }).catch(() => {
    // Prefetch failures are non-critical
  })

  return successResponse({ accepted: true })
})
