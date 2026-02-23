/**
 * GET /api/repos/[repoId]/entities/[entityId]/graph
 * Returns a subgraph centered on the entity, with justification data per node.
 * Shaped for React Flow consumption.
 */

import { headers } from "next/headers"
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ repoId: string; entityId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const orgId = await getActiveOrgId()
  const { repoId, entityId } = await params
  const container = getContainer()

  const url = new URL(request.url)
  const depth = Math.min(Math.max(parseInt(url.searchParams.get("depth") ?? "2", 10), 1), 4)

  try {
    const subgraph = await container.graphStore.getSubgraph(orgId, entityId, depth)

    // Batch-fetch justifications for all entities
    const justifications = await Promise.all(
      subgraph.entities.map(async (e) => {
        const j = await container.graphStore
          .getJustification(orgId, e.id)
          .catch(() => null)
        return { entityId: e.id, justification: j }
      })
    )

    const justificationMap = new Map(
      justifications
        .filter((j) => j.justification)
        .map((j) => [j.entityId, j.justification])
    )

    const nodes = subgraph.entities.map((e) => {
      const j = justificationMap.get(e.id)
      return {
        id: e.id,
        type: "entity",
        data: {
          name: e.name,
          kind: e.kind,
          filePath: e.file_path,
          isCenter: e.id === entityId,
          taxonomy: j?.taxonomy ?? null,
          confidence: j?.confidence ?? null,
          businessPurpose: j?.business_purpose ?? null,
          domainConcepts: j?.domain_concepts ?? [],
          featureTag: j?.feature_tag ?? null,
        },
        position: { x: 0, y: 0 },
      }
    })

    const edges = subgraph.edges.map((e, i) => ({
      id: `edge-${i}`,
      source: e._from.split("/").pop() ?? e._from,
      target: e._to.split("/").pop() ?? e._to,
      type: "default",
      data: { kind: e.kind },
    }))

    return NextResponse.json({ data: { nodes, edges, centerEntityId: entityId } })
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch subgraph",
      },
      { status: 500 }
    )
  }
}
