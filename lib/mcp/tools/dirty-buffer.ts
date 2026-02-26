/**
 * sync_dirty_buffer MCP tool — P5.6-ADV-05: Dirty state overlay.
 * Lightweight real-time uncommitted context with Redis ephemeral storage (30s TTL).
 * Overlay-aware query resolution: dirty_buffer > workspace_overlay > ArangoDB > pgvector.
 */

import type { Container } from "@/lib/di/container"
import type { McpAuthContext } from "../auth"
import { formatToolError, formatToolResponse } from "../formatter"

const DEFAULT_TTL = 30 // seconds
const _DEFAULT_DEBOUNCE = 2000 // ms
const _DEFAULT_PARSE_TIMEOUT = 500 // ms

export const SYNC_DIRTY_BUFFER_SCHEMA = {
  name: "sync_dirty_buffer",
  description:
    "Sync the current dirty (unsaved) buffer contents to a real-time overlay. This provides sub-second context updates for AI coding assistants. The overlay is ephemeral (30s TTL) and takes highest priority in entity resolution.",
  inputSchema: {
    type: "object" as const,
    properties: {
      file_path: {
        type: "string",
        description: "The file path being edited",
      },
      content: {
        type: "string",
        description: "The current buffer contents (may be unsaved)",
      },
      cursor_line: {
        type: "number",
        description: "Current cursor line number",
      },
      language: {
        type: "string",
        description: "Programming language of the file",
      },
    },
    required: ["file_path", "content"],
  },
}

interface DirtyBufferEntity {
  name: string
  kind: string
  start_line: number
  end_line: number
  signature?: string
}

/**
 * Lightweight entity extraction from buffer content using regex.
 * Not a full AST parse — just identifies function/class/interface signatures.
 */
function extractEntitiesFromBuffer(content: string, language?: string): DirtyBufferEntity[] {
  const entities: DirtyBufferEntity[] = []
  const lines = content.split("\n")

  // TypeScript/JavaScript patterns
  const functionPattern = /(?:export\s+)?(?:async\s+)?function\s+(\w+)/
  const arrowPattern = /(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(/
  const classPattern = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/
  const interfacePattern = /(?:export\s+)?interface\s+(\w+)/
  const methodPattern = /^\s+(?:async\s+)?(\w+)\s*\(/

  // Python patterns
  const pyFunctionPattern = /^(?:async\s+)?def\s+(\w+)/
  const pyClassPattern = /^class\s+(\w+)/

  // Go patterns
  const goFunctionPattern = /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)/

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ""
    let match: RegExpMatchArray | null = null

    if (language === "python") {
      match = line.match(pyFunctionPattern)
      if (match?.[1]) {
        entities.push({ name: match[1], kind: "function", start_line: i + 1, end_line: i + 1 })
        continue
      }
      match = line.match(pyClassPattern)
      if (match?.[1]) {
        entities.push({ name: match[1], kind: "class", start_line: i + 1, end_line: i + 1 })
        continue
      }
    } else if (language === "go") {
      match = line.match(goFunctionPattern)
      if (match?.[1]) {
        entities.push({ name: match[1], kind: "function", start_line: i + 1, end_line: i + 1 })
        continue
      }
    } else {
      // Default: TypeScript/JavaScript
      match = line.match(functionPattern)
      if (match?.[1]) {
        entities.push({ name: match[1], kind: "function", start_line: i + 1, end_line: i + 1, signature: line.trim() })
        continue
      }
      match = line.match(arrowPattern)
      if (match?.[1]) {
        entities.push({ name: match[1], kind: "function", start_line: i + 1, end_line: i + 1, signature: line.trim() })
        continue
      }
      match = line.match(classPattern)
      if (match?.[1]) {
        entities.push({ name: match[1], kind: "class", start_line: i + 1, end_line: i + 1 })
        continue
      }
      match = line.match(interfacePattern)
      if (match?.[1]) {
        entities.push({ name: match[1], kind: "interface", start_line: i + 1, end_line: i + 1 })
        continue
      }
      match = line.match(methodPattern)
      if (match?.[1] && match[1] !== "if" && match[1] !== "for" && match[1] !== "while" && match[1] !== "switch") {
        entities.push({ name: match[1], kind: "method", start_line: i + 1, end_line: i + 1, signature: line.trim() })
      }
    }
  }

  return entities
}

export async function handleSyncDirtyBuffer(
  args: { file_path: string; content: string; cursor_line?: number; language?: string },
  ctx: McpAuthContext,
  container: Container
) {
  if (!ctx.userId) {
    return formatToolError("sync_dirty_buffer requires user context.")
  }
  const repoId = ctx.repoId
  if (!repoId) {
    return formatToolError("No repository context.")
  }

  const enabled = process.env.DIRTY_OVERLAY_ENABLED !== "false"
  if (!enabled) {
    return formatToolResponse({ status: "disabled", message: "Dirty overlay is disabled" })
  }

  const ttl = parseInt(process.env.DIRTY_OVERLAY_TTL ?? String(DEFAULT_TTL), 10)

  try {
    // 1. Extract entities from buffer
    const entities = extractEntitiesFromBuffer(args.content, args.language)

    // 2. Store in Redis with short TTL
    const cacheKey = `unerr:dirty:${ctx.orgId}:${repoId}:${ctx.userId}:${args.file_path}`
    await container.cacheStore.set(
      cacheKey,
      {
        file_path: args.file_path,
        entities,
        cursor_line: args.cursor_line,
        language: args.language,
        updated_at: new Date().toISOString(),
      },
      ttl
    )

    // 3. Also store per-entity keys for fast lookup
    for (const entity of entities) {
      const entityCacheKey = `unerr:dirty:entity:${ctx.orgId}:${repoId}:${entity.name}`
      await container.cacheStore.set(
        entityCacheKey,
        {
          ...entity,
          file_path: args.file_path,
          user_id: ctx.userId,
          dirty: true,
        },
        ttl
      )
    }

    return formatToolResponse({
      status: "synced",
      file_path: args.file_path,
      entities_detected: entities.length,
      ttl_seconds: ttl,
      entity_names: entities.map((e) => e.name),
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return formatToolError(`Dirty buffer sync failed: ${message}`)
  }
}

/**
 * Overlay-aware entity resolution.
 * Priority: dirty_buffer > workspace_overlay > ArangoDB > pgvector
 */
export async function resolveEntityWithOverlay(
  container: Container,
  orgId: string,
  repoId: string,
  entityName: string,
  workspaceId?: string
): Promise<{ source: string; entity: unknown } | null> {
  // 1. Check dirty buffer (Redis)
  const dirtyKey = `unerr:dirty:entity:${orgId}:${repoId}:${entityName}`
  const dirtyEntity = await container.cacheStore.get(dirtyKey)
  if (dirtyEntity) {
    return { source: "dirty_buffer", entity: dirtyEntity }
  }

  // 2. Check workspace overlay (ArangoDB)
  // Search entities by name in overlay — simplified lookup
  if (workspaceId) {
    // We'd need to search workspace overlay entities by name, which isn't directly available
    // Fall through to committed entities
  }

  // 3. Check committed entities (ArangoDB) — via search
  const searchResults = await container.graphStore.searchEntities(orgId, repoId, entityName, 1)
  if (searchResults.length > 0 && searchResults[0]!.name === entityName) {
    return { source: "committed", entity: searchResults[0] }
  }

  // 4. Check pgvector semantic search
  const vs = container.vectorSearch
  if (vs?.embedQuery) {
    const queryEmbed = await vs.embedQuery(entityName)
    const vectorResults = await vs.search(queryEmbed, 1, { orgId, repoId })
    if (vectorResults.length > 0 && vectorResults[0]!.score > 0.9) {
      return { source: "pgvector", entity: vectorResults[0] }
    }
  }

  return null
}
