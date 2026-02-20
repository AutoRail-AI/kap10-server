/**
 * Auto-sync — stale detection and auto-pull on serve startup.
 *
 * Checks local manifest timestamp against TTL threshold.
 * Warns user if snapshot is stale and optionally triggers auto-pull.
 */

import { getManifest } from "./commands/pull.js"

const DEFAULT_TTL_HOURS = 24

/**
 * Check if a snapshot is stale (older than TTL).
 */
export function isSnapshotStale(repoId: string, ttlHours = DEFAULT_TTL_HOURS): boolean {
  const manifest = getManifest(repoId)
  if (!manifest) return true

  const pulledAt = new Date(manifest.pulledAt).getTime()
  const now = Date.now()
  const ageHours = (now - pulledAt) / (1000 * 60 * 60)

  return ageHours > ttlHours
}

/**
 * Get staleness info for display.
 */
export function getStalenessInfo(repoId: string): {
  isStale: boolean
  ageHours: number
  pulledAt: string | null
} {
  const manifest = getManifest(repoId)
  if (!manifest) return { isStale: true, ageHours: Infinity, pulledAt: null }

  const pulledAt = new Date(manifest.pulledAt).getTime()
  const ageHours = (Date.now() - pulledAt) / (1000 * 60 * 60)

  return {
    isStale: ageHours > DEFAULT_TTL_HOURS,
    ageHours: Math.round(ageHours * 10) / 10,
    pulledAt: manifest.pulledAt,
  }
}
