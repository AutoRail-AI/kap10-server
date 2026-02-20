/**
 * Phase 3: GET /api/search — Hybrid semantic + keyword search API.
 *
 * Query params:
 *   q      — Search query (required)
 *   repoId — Repository ID (required)
 *   mode   — "hybrid" | "semantic" | "keyword" (default "hybrid")
 *   limit  — Max results (default 10, max 50)
 *
 * Auth: Better Auth session required. Verifies user has access to the repo's org.
 */

import { createHash } from "crypto"
import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { hybridSearch, type SearchMode } from "@/lib/embeddings/hybrid-search"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

export const GET = withAuth(async (req: NextRequest) => {
  const query = req.nextUrl.searchParams.get("q")
  const repoId = req.nextUrl.searchParams.get("repoId")
  const modeParam = req.nextUrl.searchParams.get("mode") ?? "hybrid"
  const limitParam = req.nextUrl.searchParams.get("limit") ?? "10"

  if (!query || query.trim().length === 0) {
    return errorResponse("Query parameter 'q' is required", 400)
  }
  if (!repoId) {
    return errorResponse("Query parameter 'repoId' is required", 400)
  }

  const mode = validateMode(modeParam)
  if (!mode) {
    return errorResponse("Invalid mode. Must be 'hybrid', 'semantic', or 'keyword'", 400)
  }

  const limit = Math.min(Math.max(parseInt(limitParam, 10) || 10, 1), 50)

  const orgId = await getActiveOrgId()
  if (!orgId) {
    return errorResponse("No active organization", 400)
  }

  const container = getContainer()

  // Verify user has access to this repo
  const repo = await container.relationalStore.getRepo(orgId, repoId)
  if (!repo) {
    return errorResponse("Repository not found", 404)
  }

  // Check Redis cache
  const cacheKey = `search:${orgId}:${repoId}:${sha256(query)}:${mode}`
  const cached = await container.cacheStore.get<string>(cacheKey)
  if (cached) {
    const parsed = JSON.parse(cached) as Record<string, unknown>
    return successResponse(parsed)
  }

  // Execute hybrid search
  const result = await hybridSearch(
    {
      query: query.trim(),
      orgId,
      repoId,
      mode,
      limit,
    },
    container
  )

  const response = {
    results: result.results,
    meta: result.meta,
  }

  // Cache for 5 minutes
  await container.cacheStore.set(cacheKey, JSON.stringify(response), 300)

  return successResponse(response)
})

function validateMode(mode: string): SearchMode | null {
  if (mode === "hybrid" || mode === "semantic" || mode === "keyword") return mode
  return null
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16)
}
