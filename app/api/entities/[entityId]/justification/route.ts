/**
 * Phase 4: Human-in-the-loop justification override.
 *
 * PATCH /api/entities/:entityId/justification
 *   - Updates justification (bi-temporal: closes old, inserts new)
 *   - Re-embeds in pgvector
 *   - Optionally triggers cascade re-justification for coupled callers
 */

import { auth } from "@/lib/auth"
import { getContainer } from "@/lib/di/container"
import { JustificationResultSchema } from "@/lib/justification/schemas"
import { headers } from "next/headers"
import { NextResponse } from "next/server"
import { randomUUID } from "node:crypto"
import { logger } from "@/lib/utils/logger"

const log = logger.child({ service: "justification-override" })

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ entityId: string }> }
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session) {
      log.warn("PATCH /api/entities/[entityId]/justification — unauthorized")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userId = session.user.id
    const { entityId } = await params
    const body = (await request.json()) as {
      orgId: string
      taxonomy?: string
      confidence?: number
      businessPurpose?: string
      domainConcepts?: string[]
      featureTag?: string
    }

    if (!body.orgId) {
      log.warn("PATCH justification — missing orgId", { userId, entityId })
      return NextResponse.json({ error: "orgId is required" }, { status: 400 })
    }

    const ctx = { userId, organizationId: body.orgId, entityId }
    log.info("Overriding justification", ctx)

    const container = getContainer()

    // Fetch current justification
    const existing = await container.graphStore.getJustification(body.orgId, entityId)
    if (!existing) {
      log.warn("No existing justification found", ctx)
      return NextResponse.json(
        { error: "No existing justification found for this entity" },
        { status: 404 }
      )
    }

    // Validate partial update
    const validTaxonomies = ["VERTICAL", "HORIZONTAL", "UTILITY"] as const
    if (body.taxonomy && !validTaxonomies.includes(body.taxonomy as typeof validTaxonomies[number])) {
      return NextResponse.json(
        { error: "Invalid taxonomy. Must be VERTICAL, HORIZONTAL, or UTILITY" },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()

    // Create updated justification (bi-temporal: new record with new valid_from)
    const updated = {
      ...existing,
      id: randomUUID(),
      taxonomy: (body.taxonomy as typeof validTaxonomies[number]) ?? existing.taxonomy,
      confidence: body.confidence ?? existing.confidence,
      business_purpose: body.businessPurpose ?? existing.business_purpose,
      domain_concepts: body.domainConcepts ?? existing.domain_concepts,
      feature_tag: body.featureTag ?? existing.feature_tag,
      model_tier: "heuristic" as const,
      model_used: "human_override",
      valid_from: now,
      valid_to: null,
      created_at: now,
    }

    // Store (bulkUpsertJustifications handles bi-temporal closing)
    await container.graphStore.bulkUpsertJustifications(body.orgId, [updated])

    // Re-embed
    const text = `${updated.taxonomy}: ${updated.business_purpose}. Concepts: ${updated.domain_concepts.join(", ")}. Feature: ${updated.feature_tag}`
    const embeddings = await container.vectorSearch.embed([text])
    await container.vectorSearch.upsert(
      [`just_${entityId}`],
      embeddings,
      [{
        orgId: updated.org_id,
        repoId: updated.repo_id,
        entityId,
        taxonomy: updated.taxonomy,
        featureTag: updated.feature_tag,
      }]
    )

    log.info("Justification overridden", { userId, organizationId: body.orgId, entityId, newTaxonomy: updated.taxonomy })
    return NextResponse.json({
      success: true,
      justification: {
        id: updated.id,
        taxonomy: updated.taxonomy,
        confidence: updated.confidence,
        businessPurpose: updated.business_purpose,
        featureTag: updated.feature_tag,
        validFrom: updated.valid_from,
      },
    })
  } catch (error: unknown) {
    log.error("Justification override failed", error instanceof Error ? error : undefined)
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
