/**
 * P5.6-ADV-02: Graph-only upload endpoint.
 * Accepts { repoId, entities, edges, fileHashes } — no source code bodies.
 * Validates shapes, writes to ArangoDB, triggers embedding workflow.
 */

import { auth } from "@/lib/auth"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { headers } from "next/headers"
import { NextResponse } from "next/server"
import type { EdgeDoc, EntityDoc } from "@/lib/ports/types"

interface GraphUploadBody {
  repoId: string
  entities: EntityDoc[]
  edges: EdgeDoc[]
  fileHashes: Record<string, string>
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const orgId = await getActiveOrgId()
  if (!orgId) {
    return NextResponse.json({ error: "No active organization" }, { status: 400 })
  }

  const body = (await request.json()) as GraphUploadBody

  if (!body.repoId || !Array.isArray(body.entities) || !Array.isArray(body.edges)) {
    return NextResponse.json(
      { error: "repoId, entities[], and edges[] are required" },
      { status: 400 }
    )
  }

  const container = getContainer()

  // Validate repo ownership
  const repo = await container.relationalStore.getRepo(orgId, body.repoId)
  if (!repo) {
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
  } catch {
    // Best-effort embedding trigger
  }

  // Update repo stats
  await container.relationalStore.updateRepoStatus(body.repoId, {
    status: "ready",
    fileCount: new Set(body.entities.filter((e) => e.kind === "file").map((e) => e.file_path)).size,
    functionCount: body.entities.filter((e) => e.kind === "function" || e.kind === "method").length,
    classCount: body.entities.filter((e) => e.kind === "class").length,
  })

  return NextResponse.json({
    status: "uploaded",
    entitiesUpserted: body.entities.length,
    edgesUpserted: body.edges.length,
    fileHashes: Object.keys(body.fileHashes ?? {}).length,
  })
}
