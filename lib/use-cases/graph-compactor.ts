/**
 * Phase 10a: Graph Compactor — reduces entity/edge size for local snapshots.
 *
 * - Truncates entity body to MAX_BODY_LINES (adds "// ... N more lines" annotation)
 * - Strips org_id/repo_id (implicit in snapshot envelope)
 * - Converts ArangoDB _id → bare _key, _from/_to → bare keys
 */

import type { EdgeDoc, EntityDoc } from "@/lib/ports/types"

const MAX_BODY_LINES = 50

export interface CompactEntity {
  key: string
  kind: string
  name: string
  file_path: string
  start_line?: number
  signature?: string
  body?: string
}

export interface CompactEdge {
  from_key: string
  to_key: string
  type: string
}

/**
 * Strip collection prefix from ArangoDB `_id` or `_from`/`_to` handles.
 * "functions/abc123" → "abc123", bare key → as-is.
 */
function stripCollectionPrefix(handle: string): string {
  const slashIdx = handle.indexOf("/")
  return slashIdx >= 0 ? handle.slice(slashIdx + 1) : handle
}

/**
 * Truncate body text to MAX_BODY_LINES, appending annotation if truncated.
 */
function truncateBody(body: string | undefined): string | undefined {
  if (!body) return undefined
  const lines = body.split("\n")
  if (lines.length <= MAX_BODY_LINES) return body
  const truncated = lines.slice(0, MAX_BODY_LINES)
  const remaining = lines.length - MAX_BODY_LINES
  truncated.push(`// ... ${remaining} more lines`)
  return truncated.join("\n")
}

export function compactEntity(entity: EntityDoc): CompactEntity {
  const key = entity.id
    ? stripCollectionPrefix(entity.id)
    : (entity as Record<string, unknown>)._key as string ?? entity.id

  const result: CompactEntity = {
    key,
    kind: entity.kind,
    name: entity.name,
    file_path: entity.file_path,
  }

  if (entity.start_line != null) {
    result.start_line = entity.start_line as number
  }
  if (entity.signature != null) {
    result.signature = entity.signature as string
  }
  if (entity.body != null) {
    result.body = truncateBody(entity.body as string)
  }

  return result
}

export function compactEdge(edge: EdgeDoc): CompactEdge {
  return {
    from_key: stripCollectionPrefix(edge._from),
    to_key: stripCollectionPrefix(edge._to),
    type: edge.kind,
  }
}
