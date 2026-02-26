/**
 * Graph traversal MCP tools: get_callers, get_callees, get_imports.
 */

import type { Container } from "@/lib/di/container"
import { resolveEntityWithOverlay } from "./dirty-buffer"
import type { McpAuthContext } from "../auth"
import { formatToolError, formatToolResponse } from "../formatter"

// ── get_callers ─────────────────────────────────────────────────

export const GET_CALLERS_SCHEMA = {
  name: "get_callers",
  description:
    "Find all callers of a function/method up to N hops deep. Returns the call chain showing which functions call the specified entity.",
  inputSchema: {
    type: "object" as const,
    properties: {
      name: {
        type: "string",
        description: "Entity name to find callers of",
      },
      depth: {
        type: "number",
        description: "Maximum traversal depth (default 1, max 5)",
      },
    },
    required: ["name"],
  },
}

export async function handleGetCallers(
  args: { name: string; depth?: number },
  ctx: McpAuthContext,
  container: Container
) {
  const repoId = ctx.repoId
  if (!repoId) {
    return formatToolError("No repository context. This API key is not scoped to a repository.")
  }

  if (!args.name) {
    return formatToolError("name parameter is required")
  }

  const depth = Math.min(Math.max(args.depth ?? 1, 1), 5)

  // P5.6-ADV-05: Check dirty buffer for entity metadata
  let entitySource = "committed"
  try {
    const overlay = await resolveEntityWithOverlay(
      container,
      ctx.orgId,
      repoId,
      args.name
    )
    if (overlay?.source === "dirty_buffer") {
      entitySource = "dirty_buffer"
    }
  } catch {
    // Best-effort overlay check
  }

  // Find the entity first
  const results = await container.graphStore.searchEntities(ctx.orgId, repoId, args.name, 5)
  const match = results.find((r) => r.name === args.name)
  if (!match) {
    return formatToolError(`Entity "${args.name}" not found in this repository`)
  }

  // Find the entity ID by looking in file entities
  const fileEntities = await container.graphStore.getEntitiesByFile(ctx.orgId, repoId, match.file_path)
  const entity = fileEntities.find((e) => e.name === args.name)
  if (!entity) {
    return formatToolError(`Entity "${args.name}" not found`)
  }

  const callers = await container.graphStore.getCallersOf(ctx.orgId, entity.id, depth)

  return formatToolResponse({
    entity: {
      name: entity.name,
      kind: entity.kind,
      file_path: entity.file_path,
      line: Number(entity.start_line) || 0,
      ...(entitySource === "dirty_buffer" && { _source: "dirty_buffer" }),
    },
    callers: callers.map((c) => ({
      name: c.name,
      file_path: c.file_path,
      kind: c.kind,
      line: Number(c.start_line) || 0,
    })),
    depth,
    count: callers.length,
  })
}

// ── get_callees ─────────────────────────────────────────────────

export const GET_CALLEES_SCHEMA = {
  name: "get_callees",
  description:
    "Find all functions/methods called by a given function, up to N hops deep. Returns the outgoing call chain.",
  inputSchema: {
    type: "object" as const,
    properties: {
      name: {
        type: "string",
        description: "Entity name to find callees of",
      },
      depth: {
        type: "number",
        description: "Maximum traversal depth (default 1, max 5)",
      },
    },
    required: ["name"],
  },
}

export async function handleGetCallees(
  args: { name: string; depth?: number },
  ctx: McpAuthContext,
  container: Container
) {
  const repoId = ctx.repoId
  if (!repoId) {
    return formatToolError("No repository context. This API key is not scoped to a repository.")
  }

  if (!args.name) {
    return formatToolError("name parameter is required")
  }

  const depth = Math.min(Math.max(args.depth ?? 1, 1), 5)

  // P5.6-ADV-05: Check dirty buffer for entity metadata
  let entitySource = "committed"
  try {
    const overlay = await resolveEntityWithOverlay(
      container,
      ctx.orgId,
      repoId,
      args.name
    )
    if (overlay?.source === "dirty_buffer") {
      entitySource = "dirty_buffer"
    }
  } catch {
    // Best-effort overlay check
  }

  const results = await container.graphStore.searchEntities(ctx.orgId, repoId, args.name, 5)
  const match = results.find((r) => r.name === args.name)
  if (!match) {
    return formatToolError(`Entity "${args.name}" not found in this repository`)
  }

  const fileEntities = await container.graphStore.getEntitiesByFile(ctx.orgId, repoId, match.file_path)
  const entity = fileEntities.find((e) => e.name === args.name)
  if (!entity) {
    return formatToolError(`Entity "${args.name}" not found`)
  }

  const callees = await container.graphStore.getCalleesOf(ctx.orgId, entity.id, depth)

  return formatToolResponse({
    entity: {
      name: entity.name,
      kind: entity.kind,
      file_path: entity.file_path,
      line: Number(entity.start_line) || 0,
      ...(entitySource === "dirty_buffer" && { _source: "dirty_buffer" }),
    },
    callees: callees.map((c) => ({
      name: c.name,
      file_path: c.file_path,
      kind: c.kind,
      line: Number(c.start_line) || 0,
    })),
    depth,
    count: callees.length,
  })
}

// ── get_imports ──────────────────────────────────────────────────

export const GET_IMPORTS_SCHEMA = {
  name: "get_imports",
  description:
    "Trace the import/dependency chain of a file. Returns imported files with their entities, up to N levels deep.",
  inputSchema: {
    type: "object" as const,
    properties: {
      file: {
        type: "string",
        description: "File path (repo-root-relative)",
      },
      depth: {
        type: "number",
        description: "Maximum traversal depth (default 1, max 5)",
      },
    },
    required: ["file"],
  },
}

export async function handleGetImports(
  args: { file: string; depth?: number },
  ctx: McpAuthContext,
  container: Container
) {
  const repoId = ctx.repoId
  if (!repoId) {
    return formatToolError("No repository context. This API key is not scoped to a repository.")
  }

  if (!args.file) {
    return formatToolError("file parameter is required")
  }

  const depth = Math.min(Math.max(args.depth ?? 1, 1), 5)

  const imports = await container.graphStore.getImports(
    ctx.orgId,
    repoId,
    args.file,
    depth
  )

  return formatToolResponse({
    file: args.file,
    imports: imports.map((imp) => ({
      path: imp.path,
      entities: imp.entities.map((e) => ({
        name: e.name,
        kind: e.kind,
      })),
      distance: imp.distance,
    })),
    depth,
    count: imports.length,
  })
}
