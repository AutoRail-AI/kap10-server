/**
 * P5.6-ADV-02: Graph-only upload endpoint.
 * Accepts { repoId, entities, edges, fileHashes } — no source code bodies.
 * Validates shapes, writes to ArangoDB, triggers embedding workflow.
 */

import { headers } from "next/headers"
import { NextResponse } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { auth } from "@/lib/auth"
import { getContainer } from "@/lib/di/container"
import type { EdgeDoc, EntityDoc } from "@/lib/ports/types"
import { logger } from "@/lib/utils/logger"

const log = logger.child({ service: "graph-upload" })

interface GraphUploadBody {
  repoId: string
  entities: EntityDoc[]
  edges: EdgeDoc[]
  fileHashes: Record<string, string>
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    log.warn("POST /api/cli/graph-upload — unauthorized")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  const orgId = await getActiveOrgId()
  if (!orgId) {
    log.warn("POST /api/cli/graph-upload — no active org", { userId })
    return NextResponse.json({ error: "No active organization" }, { status: 400 })
  }

  const body = (await request.json()) as GraphUploadBody

  if (!body.repoId || !Array.isArray(body.entities) || !Array.isArray(body.edges)) {
    log.warn("POST /api/cli/graph-upload — invalid body", { userId, organizationId: orgId })
    return NextResponse.json(
      { error: "repoId, entities[], and edges[] are required" },
      { status: 400 }
    )
  }

  const ctx = { userId, organizationId: orgId, repoId: body.repoId }
  log.info("Graph upload started", { ...ctx, entityCount: body.entities.length, edgeCount: body.edges.length })

  const container = getContainer()

  // Validate repo ownership
  const repo = await container.relationalStore.getRepo(orgId, body.repoId)
  if (!repo) {
    log.warn("Graph upload — repo not found", ctx)
    return NextResponse.json({ error: "Repository not found" }, { status: 404 })
  }

  // Validate entity shapes
  for (const entity of body.entities) {
    if (!entity.id || !entity.kind || !entity.name || !entity.file_path) {
      return NextResponse.json(
        { error: `Entity missing required fields (id, kind, name, file_path): ${JSON.stringify(entity).slice(0, 100)}` },
        { status: 400 }
      )
    }
  }

  // Validate edge shapes
  for (const edge of body.edges) {
    if (!edge._from || !edge._to || !edge.kind) {
      return NextResponse.json(
        { error: `Edge missing required fields (_from, _to, kind): ${JSON.stringify(edge).slice(0, 100)}` },
        { status: 400 }
      )
    }
  }

  // Stamp entities with org/repo context
  const stampedEntities = body.entities.map((e) => ({
    ...e,
    org_id: orgId,
    repo_id: body.repoId,
  }))

  const stampedEdges = body.edges.map((e) => ({
    ...e,
    org_id: orgId,
    repo_id: body.repoId,
  }))

  // Write to ArangoDB
  await container.graphStore.bulkUpsertEntities(orgId, stampedEntities)
  await container.graphStore.bulkUpsertEdges(orgId, stampedEdges)

  // Trigger embedding workflow (fire-and-forget)
  try {
    await container.workflowEngine.startWorkflow({
      taskQueue: "light-llm-queue",
      workflowId: `embed-graph-upload-${body.repoId}-${Date.now()}`,
      workflowFn: "embedRepo",
      args: [{ orgId, repoId: body.repoId }],
    })
    log.info("Embedding workflow triggered", ctx)
  } catch {
    log.warn("Embedding workflow trigger failed (best-effort)", ctx)
  }

  // Update repo stats
  await container.relationalStore.updateRepoStatus(body.repoId, {
    status: "ready",
    fileCount: new Set(body.entities.filter((e) => e.kind === "file").map((e) => e.file_path)).size,
    functionCount: body.entities.filter((e) => e.kind === "function" || e.kind === "method").length,
    classCount: body.entities.filter((e) => e.kind === "class").length,
  })

  log.info("Graph upload complete", { ...ctx, entitiesUpserted: body.entities.length, edgesUpserted: body.edges.length })
  return NextResponse.json({
    status: "uploaded",
    entitiesUpserted: body.entities.length,
    edgesUpserted: body.edges.length,
    fileHashes: Object.keys(body.fileHashes ?? {}).length,
  })
}
