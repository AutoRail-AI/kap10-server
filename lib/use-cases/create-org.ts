/**
 * Create organization use case — Better Auth org + ArangoDB bootstrap.
 * Phase 0: called after Better Auth creates org; we only bootstrap graph schema for the org.
 */

import type { Container } from "@/lib/di/container"

export interface CreateOrgResult {
  organizationId: string
  name: string
  arangoBootstrapped: boolean
}

/**
 * Bootstrap ArangoDB for an org (ensure collections/indexes exist).
 * Idempotent; safe to call multiple times.
 * If ArangoDB is down, we log and return success (org is already created in Supabase).
 */
export async function createOrgUseCase(
  container: Container,
  _params: { organizationId: string; name: string }
): Promise<CreateOrgResult> {
  const { organizationId, name } = _params
  let arangoBootstrapped = false
  try {
    await container.graphStore.bootstrapGraphSchema()
    arangoBootstrapped = true
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[createOrgUseCase] ArangoDB bootstrap failed:", message)
    // Org is already created in Supabase; Phase 1 can re-bootstrap on first repo connect
  }
  return { organizationId, name, arangoBootstrapped }
}
