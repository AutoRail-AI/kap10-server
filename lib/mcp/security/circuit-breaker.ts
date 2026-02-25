/**
 * Ledger Circuit Breaker — halts entity sync when hallucination loops are detected.
 * Uses Redis atomic counters per entity.
 * Phase 5.5: Prompt Ledger & Rewind
 */

import type { Container } from "@/lib/di/container"

const DEFAULT_THRESHOLD = 4
const DEFAULT_WINDOW_MINUTES = 10
const DEFAULT_COOLDOWN_MINUTES = 5

function getConfig() {
  return {
    threshold: parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD ?? String(DEFAULT_THRESHOLD), 10),
    windowMinutes: parseInt(
      process.env.CIRCUIT_BREAKER_WINDOW_MINUTES ?? String(DEFAULT_WINDOW_MINUTES),
      10
    ),
    cooldownMinutes: parseInt(
      process.env.CIRCUIT_BREAKER_COOLDOWN_MINUTES ?? String(DEFAULT_COOLDOWN_MINUTES),
      10
    ),
    enabled: process.env.CIRCUIT_BREAKER_ENABLED !== "false",
  }
}

function entityCounterKey(orgId: string, repoId: string, entityKeyStr: string): string {
  return `unerr:circuit:${orgId}:${repoId}:${entityKeyStr}`
}

function tripKey(orgId: string, repoId: string, entityKeyStr: string): string {
  return `unerr:circuit:tripped:${orgId}:${repoId}:${entityKeyStr}`
}

export async function recordBrokenEntry(
  container: Container,
  orgId: string,
  repoId: string,
  entityKeys: string[]
): Promise<{ tripped: boolean; trippedEntities: string[] }> {
  const config = getConfig()
  if (!config.enabled) return { tripped: false, trippedEntities: [] }

  const trippedEntities: string[] = []

  for (const ek of entityKeys) {
    const key = entityCounterKey(orgId, repoId, ek)
    // Increment counter with TTL — rateLimit returns true if under limit, false if over
    const allowed = await container.cacheStore.rateLimit(
      key,
      config.threshold,
      config.windowMinutes * 60
    )
    if (!allowed) {
      // Trip the circuit breaker
      await container.cacheStore.set(
        tripKey(orgId, repoId, ek),
        "tripped",
        config.cooldownMinutes * 60
      )
      trippedEntities.push(ek)
    }
  }

  return { tripped: trippedEntities.length > 0, trippedEntities }
}

export async function isCircuitTripped(
  container: Container,
  orgId: string,
  repoId: string,
  entityKeyStr: string
): Promise<boolean> {
  const config = getConfig()
  if (!config.enabled) return false

  const value = await container.cacheStore.get<string>(tripKey(orgId, repoId, entityKeyStr))
  return value === "tripped"
}

export async function resetCircuitBreaker(
  container: Container,
  orgId: string,
  repoId: string,
  entityKeyStr: string
): Promise<void> {
  await container.cacheStore.invalidate(tripKey(orgId, repoId, entityKeyStr))
  await container.cacheStore.invalidate(entityCounterKey(orgId, repoId, entityKeyStr))
}

export async function checkCircuitBreakers(
  container: Container,
  orgId: string,
  repoId: string,
  entityKeys: string[]
): Promise<{ blocked: boolean; blockedEntities: string[] }> {
  const config = getConfig()
  if (!config.enabled) return { blocked: false, blockedEntities: [] }

  const blockedEntities: string[] = []
  for (const ek of entityKeys) {
    if (await isCircuitTripped(container, orgId, repoId, ek)) {
      blockedEntities.push(ek)
    }
  }
  return { blocked: blockedEntities.length > 0, blockedEntities }
}
