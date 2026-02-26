/**
 * Query Router — decides whether a tool call runs locally or via cloud proxy.
 *
 * Local tools (9): graph queries + rules that CozoDB can answer sub-5ms
 * Cloud tools (4): require vector DB, aggregations, or server-side state
 */

import type { CloudProxy } from "./cloud-proxy.js"
import type { CozoGraphStore } from "./local-graph.js"
import type { evaluateRules as EvaluateRulesFn } from "./rule-evaluator.js"

export type ToolSource = "local" | "cloud"

/**
 * Static routing table: tool name → source.
 */
const ROUTING_TABLE: Record<string, ToolSource> = {
  // Local tools (CozoDB) — 9 total
  get_function: "local",
  get_class: "local",
  get_file: "local",
  get_callers: "local",
  get_callees: "local",
  get_imports: "local",
  search_code: "local",
  get_rules: "local",
  check_rules: "local",

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
  private ruleEvaluator: typeof EvaluateRulesFn | null

  constructor(
    private localGraph: CozoGraphStore,
    private cloudProxy: CloudProxy,
    ruleEvaluator?: typeof EvaluateRulesFn
  ) {
    this.ruleEvaluator = ruleEvaluator ?? null
  }

  getRoute(toolName: string): ToolSource {
    // get_rules and check_rules fall back to cloud if no local rules
    if ((toolName === "get_rules" || toolName === "check_rules") && !this.localGraph.hasRules()) {
      return "cloud"
    }
    return ROUTING_TABLE[toolName] ?? "cloud"
  }

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    const source = this.getRoute(toolName)

    if (source === "local") {
      try {
        const result = await this.executeLocal(toolName, args)
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

  private async executeLocal(toolName: string, args: Record<string, unknown>): Promise<unknown> {
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
      case "get_rules": {
        const filePath = args.file_path as string | undefined
        return this.localGraph.getRules(filePath)
      }
      case "check_rules": {
        const filePath = args.file_path as string
        const content = args.content as string
        if (!filePath || !content) {
          throw new Error("check_rules requires file_path and content")
        }
        if (!this.ruleEvaluator) {
          throw new Error("Rule evaluator not available")
        }
        const rules = this.localGraph.getRules(filePath)
        return this.ruleEvaluator(rules, filePath, content, this.localGraph)
      }
      default:
        throw new Error(`Unknown local tool: ${toolName}`)
    }
  }
}
