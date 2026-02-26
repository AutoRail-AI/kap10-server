/**
 * Inspection MCP tools: get_function, get_class, get_file.
 */

import type { Container } from "@/lib/di/container"
import { resolveEntityWithOverlay } from "./dirty-buffer"
import type { McpAuthContext } from "../auth"
import { formatToolError, formatToolResponse } from "../formatter"

// ── get_function ────────────────────────────────────────────────

export const GET_FUNCTION_SCHEMA = {
  name: "get_function",
  description:
    "Get detailed information about a function including its signature, body, callers, and callees. Look up by name or by file+line.",
  inputSchema: {
    type: "object" as const,
    properties: {
      name: {
        type: "string",
        description: "Function name to look up",
      },
      file: {
        type: "string",
        description: "File path (use with line for positional lookup)",
      },
      line: {
        type: "number",
        description: "Line number (use with file for positional lookup)",
      },
    },
  },
}

export async function handleGetFunction(
  args: { name?: string; file?: string; line?: number },
  ctx: McpAuthContext,
  container: Container
) {
  const repoId = ctx.repoId
  if (!repoId) {
    return formatToolError("No repository context. This API key is not scoped to a repository.")
  }

  let entity = null

  // P5.6-ADV-05: Check dirty buffer overlay first for name-based lookups
  if (args.name) {
    try {
      const overlay = await resolveEntityWithOverlay(
        container,
        ctx.orgId,
        repoId,
        args.name
      )
      if (overlay?.source === "dirty_buffer") {
        const dirtyEntity = overlay.entity as {
          name: string
          kind: string
          start_line: number
          end_line: number
          signature?: string
          file_path: string
        }
        return formatToolResponse({
          function: {
            name: dirtyEntity.name,
            signature: dirtyEntity.signature ?? dirtyEntity.name,
            file_path: dirtyEntity.file_path,
            line: dirtyEntity.start_line,
            end_line: dirtyEntity.end_line || undefined,
            kind: dirtyEntity.kind,
            _source: "dirty_buffer",
          },
          callers: [],
          callees: [],
        })
      }
    } catch {
      // Overlay is best-effort, fall through to committed entities
    }
  }

  if (args.name) {
    // Search by name
    const results = await container.graphStore.searchEntities(
      ctx.orgId,
      repoId,
      args.name,
      5
    )
    const match = results.find(
      (r) => r.name === args.name && (r.kind === "function" || r.kind === "method")
    ) ?? results[0]
    if (match) {
      // Get full entity by searching in the file
      const fileEntities = await container.graphStore.getEntitiesByFile(
        ctx.orgId,
        repoId,
        match.file_path
      )
      entity = fileEntities.find((e) => e.name === args.name) ?? null
    }
  } else if (args.file && args.line !== undefined) {
    // Search by file + line
    const entities = await container.graphStore.getEntitiesByFile(
      ctx.orgId,
      repoId,
      args.file
    )
    entity = entities.find(
      (e) =>
        (e.kind === "function" || e.kind === "method") &&
        Number(e.start_line) <= args.line! &&
        (Number(e.end_line) || Infinity) >= args.line!
    ) ?? null
  } else {
    return formatToolError("Provide either 'name' or both 'file' and 'line' parameters")
  }

  if (!entity) {
    return formatToolError(
      args.name
        ? `Function "${args.name}" not found in this repository`
        : `No function found at ${args.file}:${args.line}`
    )
  }

  // Get callers and callees
  const [callers, callees] = await Promise.all([
    container.graphStore.getCallersOf(ctx.orgId, entity.id, 1),
    container.graphStore.getCalleesOf(ctx.orgId, entity.id, 1),
  ])

  return formatToolResponse({
    function: {
      name: entity.name,
      signature: entity.signature ?? entity.name,
      file_path: entity.file_path,
      line: Number(entity.start_line) || 0,
      end_line: Number(entity.end_line) || undefined,
      body: entity.body ?? entity.source ?? undefined,
      kind: entity.kind,
    },
    callers: callers.map((c) => ({
      name: c.name,
      file_path: c.file_path,
      kind: c.kind,
      line: Number(c.start_line) || 0,
    })),
    callees: callees.map((c) => ({
      name: c.name,
      file_path: c.file_path,
      kind: c.kind,
      line: Number(c.start_line) || 0,
    })),
  })
}

// ── get_class ───────────────────────────────────────────────────

export const GET_CLASS_SCHEMA = {
  name: "get_class",
  description:
    "Get detailed information about a class including its methods, inheritance chain (extends/implements), up to 5 levels deep.",
  inputSchema: {
    type: "object" as const,
    properties: {
      name: {
        type: "string",
        description: "Class name to look up",
      },
    },
    required: ["name"],
  },
}

export async function handleGetClass(
  args: { name: string },
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

  // P5.6-ADV-05: Check dirty buffer overlay first
  try {
    const overlay = await resolveEntityWithOverlay(
      container,
      ctx.orgId,
      repoId,
      args.name
    )
    if (overlay?.source === "dirty_buffer") {
      const dirtyEntity = overlay.entity as {
        name: string
        kind: string
        start_line: number
        end_line: number
        signature?: string
        file_path: string
      }
      return formatToolResponse({
        class: {
          name: dirtyEntity.name,
          file_path: dirtyEntity.file_path,
          line: dirtyEntity.start_line,
          end_line: dirtyEntity.end_line || undefined,
          kind: dirtyEntity.kind,
          signature: dirtyEntity.signature,
          _source: "dirty_buffer",
        },
        methods: [],
        extends: [],
        implements: [],
      })
    }
  } catch {
    // Overlay is best-effort, fall through to committed entities
  }

  // Search for the class
  const results = await container.graphStore.searchEntities(
    ctx.orgId,
    repoId,
    args.name,
    5
  )
  const match = results.find(
    (r) => r.name === args.name && (r.kind === "class" || r.kind === "struct")
  )

  if (!match) {
    return formatToolError(`Class "${args.name}" not found in this repository`)
  }

  // Get entities in the same file to find methods
  const fileEntities = await container.graphStore.getEntitiesByFile(
    ctx.orgId,
    repoId,
    match.file_path
  )

  const classEntity = fileEntities.find((e) => e.name === args.name)
  if (!classEntity) {
    return formatToolError(`Class "${args.name}" not found`)
  }

  // Find methods: entities in same file between class start_line and end_line
  const classStart = Number(classEntity.start_line) || 0
  const classEnd = Number(classEntity.end_line) || Infinity
  const methods = fileEntities.filter(
    (e) =>
      (e.kind === "function" || e.kind === "method") &&
      Number(e.start_line) >= classStart &&
      Number(e.start_line) <= classEnd &&
      e.id !== classEntity.id
  )

  return formatToolResponse({
    class: {
      name: classEntity.name,
      file_path: classEntity.file_path,
      line: classStart,
      end_line: classEnd === Infinity ? undefined : classEnd,
      kind: classEntity.kind,
      signature: classEntity.signature,
    },
    methods: methods.map((m) => ({
      name: m.name,
      signature: m.signature ?? m.name,
      line: Number(m.start_line) || 0,
      kind: m.kind,
    })),
    extends: [],
    implements: [],
  })
}

// ── get_file ────────────────────────────────────────────────────

export const GET_FILE_SCHEMA = {
  name: "get_file",
  description:
    "Get information about a file including all entities (functions, classes, variables) defined in it.",
  inputSchema: {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description: "File path (repo-root-relative, e.g., src/auth/login.ts)",
      },
    },
    required: ["path"],
  },
}

export async function handleGetFile(
  args: { path: string },
  ctx: McpAuthContext,
  container: Container
) {
  const repoId = ctx.repoId
  if (!repoId) {
    return formatToolError("No repository context. This API key is not scoped to a repository.")
  }

  if (!args.path) {
    return formatToolError("path parameter is required")
  }

  const entities = await container.graphStore.getEntitiesByFile(
    ctx.orgId,
    repoId,
    args.path
  )

  if (entities.length === 0) {
    return formatToolError(`File "${args.path}" not found or contains no indexed entities`)
  }

  // Determine language from file extension
  const ext = args.path.split(".").pop() ?? ""
  const langMap: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    go: "go",
    rs: "rust",
    java: "java",
    rb: "ruby",
    cs: "csharp",
    cpp: "cpp",
    c: "c",
    h: "c",
  }
  const language = langMap[ext] ?? ext

  return formatToolResponse({
    file: {
      path: args.path,
      language,
      entity_count: entities.length,
    },
    entities: entities.map((e) => ({
      name: e.name,
      kind: e.kind,
      line: Number(e.start_line) || 0,
      signature: e.signature ?? e.name,
    })),
  })
}
