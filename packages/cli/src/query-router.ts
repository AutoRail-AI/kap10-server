/**
 * Query Router — decides whether a tool call runs locally or via cloud proxy.
 *
 * Local tools (7): graph queries that CozoDB can answer sub-5ms
 * Cloud tools (4): require vector DB, aggregations, or server-side state
 */

import type { CozoGraphStore } from "./local-graph.js"
import type { CloudProxy } from "./cloud-proxy.js"

export type ToolSource = "local" | "cloud"

/**
 * Static routing table: tool name → source.
 */
const ROUTING_TABLE: Record<string, ToolSource> = {
  // Local tools (CozoDB)
  get_function: "local",
  get_class: "local",
  get_file: "local",
  get_callers: "local",
  get_callees: "local",
  get_imports: "local",
  search_code: "local",

  // Cloud tools (server-side)
  semantic_search: "cloud",
  find_similar: "cloud",
  get_project_stats: "cloud",
  sync_local_diff: "cloud",
}

export interface ToolResult {
  content: unknown
  _meta: { source: ToolSource }
}

export class QueryRouter {
  constructor(
    private localGraph: CozoGraphStore,
    private cloudProxy: CloudProxy
  ) {}

  getRoute(toolName: string): ToolSource {
    return ROUTING_TABLE[toolName] ?? "cloud"
  }

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    const source = this.getRoute(toolName)

    if (source === "local") {
      try {
        const result = this.executeLocal(toolName, args)
        return { content: result, _meta: { source: "local" } }
      } catch {
        // Fallback to cloud on local failure
        const result = await this.cloudProxy.callTool(toolName, args)
        return { content: result, _meta: { source: "cloud" } }
      }
    }

    const result = await this.cloudProxy.callTool(toolName, args)
    return { content: result, _meta: { source: "cloud" } }
  }

  private executeLocal(toolName: string, args: Record<string, unknown>): unknown {
    switch (toolName) {
      case "get_function":
      case "get_class":
      case "get_file": {
        const key = args.key as string ?? args.name as string
        return this.localGraph.getEntity(key)
      }
      case "get_callers": {
        const key = args.key as string
        return this.localGraph.getCallersOf(key)
      }
      case "get_callees": {
        const key = args.key as string
        return this.localGraph.getCalleesOf(key)
      }
      case "get_imports": {
        const filePath = args.file_path as string
        return this.localGraph.getImports(filePath)
      }
      case "search_code": {
        const query = args.query as string
        const limit = (args.limit as number) ?? 20
        return this.localGraph.searchEntities(query, limit)
      }
      default:
        throw new Error(`Unknown local tool: ${toolName}`)
    }
  }
}
