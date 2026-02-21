import "./chunk-3RG5ZIWI.js";

// src/query-router.ts
var ROUTING_TABLE = {
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
  sync_local_diff: "cloud"
};
var QueryRouter = class {
  constructor(localGraph, cloudProxy) {
    this.localGraph = localGraph;
    this.cloudProxy = cloudProxy;
  }
  getRoute(toolName) {
    return ROUTING_TABLE[toolName] ?? "cloud";
  }
  async execute(toolName, args) {
    const source = this.getRoute(toolName);
    if (source === "local") {
      try {
        const result2 = this.executeLocal(toolName, args);
        return { content: result2, _meta: { source: "local" } };
      } catch {
        const result2 = await this.cloudProxy.callTool(toolName, args);
        return { content: result2, _meta: { source: "cloud" } };
      }
    }
    const result = await this.cloudProxy.callTool(toolName, args);
    return { content: result, _meta: { source: "cloud" } };
  }
  executeLocal(toolName, args) {
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
      default:
        throw new Error(`Unknown local tool: ${toolName}`);
    }
  }
};
export {
  QueryRouter
};
