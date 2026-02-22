import "./chunk-3RG5ZIWI.js";

// src/query-router.ts
var ROUTING_TABLE = {
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
  sync_local_diff: "cloud"
};
var QueryRouter = class {
  constructor(localGraph, cloudProxy, ruleEvaluator) {
    this.localGraph = localGraph;
    this.cloudProxy = cloudProxy;
    this.ruleEvaluator = ruleEvaluator ?? null;
  }
  ruleEvaluator;
  getRoute(toolName) {
    if ((toolName === "get_rules" || toolName === "check_rules") && !this.localGraph.hasRules()) {
      return "cloud";
    }
    return ROUTING_TABLE[toolName] ?? "cloud";
  }
  async execute(toolName, args) {
    const source = this.getRoute(toolName);
    if (source === "local") {
      try {
        const result2 = await this.executeLocal(toolName, args);
        return { content: result2, _meta: { source: "local" } };
      } catch {
        const result2 = await this.cloudProxy.callTool(toolName, args);
        return { content: result2, _meta: { source: "cloud" } };
      }
    }
    const result = await this.cloudProxy.callTool(toolName, args);
    return { content: result, _meta: { source: "cloud" } };
  }
  async executeLocal(toolName, args) {
    switch (toolName) {
      case "get_function":
      case "get_class":
      case "get_file": {
        const key = args.key ?? args.name;
        return this.localGraph.getEntity(key);
      }
      case "get_callers": {
        const key = args.key;
        return this.localGraph.getCallersOf(key);
      }
      case "get_callees": {
        const key = args.key;
        return this.localGraph.getCalleesOf(key);
      }
      case "get_imports": {
        const filePath = args.file_path;
        return this.localGraph.getImports(filePath);
      }
      case "search_code": {
        const query = args.query;
        const limit = args.limit ?? 20;
        return this.localGraph.searchEntities(query, limit);
      }
      case "get_rules": {
        const filePath = args.file_path;
        return this.localGraph.getRules(filePath);
      }
      case "check_rules": {
        const filePath = args.file_path;
        const content = args.content;
        if (!filePath || !content) {
          throw new Error("check_rules requires file_path and content");
        }
        if (!this.ruleEvaluator) {
          throw new Error("Rule evaluator not available");
        }
        const rules = this.localGraph.getRules(filePath);
        return this.ruleEvaluator(rules, filePath, content, this.localGraph);
      }
      default:
        throw new Error(`Unknown local tool: ${toolName}`);
    }
  }
};
export {
  QueryRouter
};
