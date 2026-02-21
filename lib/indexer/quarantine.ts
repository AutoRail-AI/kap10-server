/**
 * Phase 5: Quarantine wrapper for entity extraction.
 * Protects against timeouts and oversized files during incremental indexing.
 * Quarantined entities are marked and surfaced in MCP tool responses.
 */

import type { EntityDoc } from "@/lib/ports/types"

export interface QuarantineConfig {
  timeoutMs: number
  maxFileSize: number
}

export interface QuarantineResult {
  entities: EntityDoc[]
  quarantined: Array<{ filePath: string; reason: string }>
}

function getDefaultConfig(): QuarantineConfig {
  const timeoutStr = process.env.QUARANTINE_TIMEOUT ?? "30s"
  const timeoutMs = parseTimeoutMs(timeoutStr)
  const maxFileSize = parseInt(process.env.QUARANTINE_MAX_FILE_SIZE ?? "5242880", 10)
  return { timeoutMs, maxFileSize }
}

function parseTimeoutMs(timeout: string): number {
  const match = timeout.match(/^(\d+)(ms|s|m)$/)
  if (!match) return 30000
  const value = parseInt(match[1]!, 10)
  switch (match[2]) {
    case "ms": return value
    case "s": return value * 1000
    case "m": return value * 60 * 1000
    default: return 30000
  }
}

/**
 * Wrap an extraction function with quarantine protection.
 * If extraction times out or the file is too large, a quarantined
 * placeholder entity is created instead.
 */
export async function withQuarantine(
  filePath: string,
  fileSize: number,
  orgId: string,
  repoId: string,
  extractFn: () => Promise<EntityDoc[]>,
  config?: Partial<QuarantineConfig>
): Promise<QuarantineResult> {
  const cfg = { ...getDefaultConfig(), ...config }

  // Check file size
  if (fileSize > cfg.maxFileSize) {
    return {
      entities: [createQuarantinedEntity(filePath, orgId, repoId, "file_too_large")],
      quarantined: [{ filePath, reason: `File size ${fileSize} exceeds max ${cfg.maxFileSize}` }],
    }
  }

  // Run extraction with timeout
  try {
    const result = await Promise.race([
      extractFn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("extraction_timeout")), cfg.timeoutMs)
      ),
    ])
    return { entities: result, quarantined: [] }
  } catch (error: unknown) {
    const reason = error instanceof Error && error.message === "extraction_timeout"
      ? "extraction_timeout"
      : "extraction_error"
    const message = error instanceof Error ? error.message : String(error)

    return {
      entities: [createQuarantinedEntity(filePath, orgId, repoId, reason)],
      quarantined: [{ filePath, reason: message }],
    }
  }
}

/**
 * Create a placeholder entity for a quarantined file.
 * This entity is marked with _quarantined=true so MCP tools
 * can attach warnings to responses.
 */
function createQuarantinedEntity(
  filePath: string,
  orgId: string,
  repoId: string,
  reason: string
): EntityDoc {
  const { createHash } = require("node:crypto") as typeof import("node:crypto")
  const id = createHash("sha256")
    .update(`${repoId}\0${filePath}\0quarantine`)
    .digest("hex")
    .slice(0, 16)

  return {
    id,
    org_id: orgId,
    repo_id: repoId,
    kind: "file",
    name: filePath.split("/").pop() ?? filePath,
    file_path: filePath,
    _quarantined: true,
    _quarantine_reason: reason,
    _quarantine_at: new Date().toISOString(),
  }
}

/**
 * Check if an entity is quarantined.
 * Used by MCP tools to attach warnings.
 */
export function isQuarantined(entity: EntityDoc): boolean {
  return entity._quarantined === true
}

/**
 * Check if a previously quarantined file should be healed
 * (i.e., successfully re-extracted on a subsequent push).
 */
export function shouldHealQuarantine(
  existingEntities: EntityDoc[],
  newEntities: EntityDoc[]
): string[] {
  const quarantinedPaths = new Set<string>()
  for (const e of existingEntities) {
    if (e._quarantined === true) {
      quarantinedPaths.add(e.file_path)
    }
  }

  const healedPaths: string[] = []
  for (const e of newEntities) {
    if (quarantinedPaths.has(e.file_path) && e._quarantined !== true) {
      healedPaths.push(e.file_path)
    }
  }

  return Array.from(new Set(healedPaths))
}
