/**
 * Phase 10b TEST-07: Extended query router tests with get_rules/check_rules.
 */

import { describe, expect, it, vi } from "vitest"
import { QueryRouter } from "../query-router.js"
import type { CozoGraphStore } from "../local-graph.js"
import type { CloudProxy } from "../cloud-proxy.js"

function createMockLocalGraph(hasRules = true): CozoGraphStore {
  return {
    getEntity: vi.fn().mockReturnValue({ key: "fn1", kind: "function", name: "doStuff", file_path: "src/index.ts", start_line: 10, signature: "", body: "" }),
    getCallersOf: vi.fn().mockReturnValue([]),
    getCalleesOf: vi.fn().mockReturnValue([]),
    getEntitiesByFile: vi.fn().mockReturnValue([]),
    searchEntities: vi.fn().mockReturnValue([]),
    getImports: vi.fn().mockReturnValue([]),
    healthCheck: vi.fn().mockReturnValue({ status: "up", latencyMs: 0 }),
    isLoaded: vi.fn().mockReturnValue(true),
    loadSnapshot: vi.fn(),
    hasRules: vi.fn().mockReturnValue(hasRules),
    getRules: vi.fn().mockReturnValue([
      { key: "r1", name: "Test", scope: "repo", severity: "warn", engine: "naming", query: "^_", message: "No underscore", file_glob: "", enabled: true, repo_id: "repo-1" },
    ]),
    getPatterns: vi.fn().mockReturnValue([]),
    loadRules: vi.fn(),
    loadPatterns: vi.fn(),
  } as unknown as CozoGraphStore
}

function createMockCloudProxy(): CloudProxy {
  return {
    callTool: vi.fn().mockResolvedValue({ results: [] }),
  } as unknown as CloudProxy
}

describe("QueryRouter", () => {
  describe("getRoute", () => {
    it("routes original 7 tools to local", () => {
      const router = new QueryRouter(createMockLocalGraph(), createMockCloudProxy())
      expect(router.getRoute("get_function")).toBe("local")
      expect(router.getRoute("get_class")).toBe("local")
      expect(router.getRoute("get_file")).toBe("local")
      expect(router.getRoute("get_callers")).toBe("local")
      expect(router.getRoute("get_callees")).toBe("local")
      expect(router.getRoute("get_imports")).toBe("local")
      expect(router.getRoute("search_code")).toBe("local")
    })

    it("routes get_rules and check_rules to local when rules exist", () => {
      const router = new QueryRouter(createMockLocalGraph(true), createMockCloudProxy())
      expect(router.getRoute("get_rules")).toBe("local")
      expect(router.getRoute("check_rules")).toBe("local")
    })

    it("routes get_rules and check_rules to cloud when no local rules", () => {
      const router = new QueryRouter(createMockLocalGraph(false), createMockCloudProxy())
      expect(router.getRoute("get_rules")).toBe("cloud")
      expect(router.getRoute("check_rules")).toBe("cloud")
    })

    it("routes semantic tools to cloud", () => {
      const router = new QueryRouter(createMockLocalGraph(), createMockCloudProxy())
      expect(router.getRoute("semantic_search")).toBe("cloud")
      expect(router.getRoute("find_similar")).toBe("cloud")
      expect(router.getRoute("get_project_stats")).toBe("cloud")
      expect(router.getRoute("sync_local_diff")).toBe("cloud")
    })

    it("defaults unknown tools to cloud", () => {
      const router = new QueryRouter(createMockLocalGraph(), createMockCloudProxy())
      expect(router.getRoute("unknown_tool")).toBe("cloud")
    })
  })

  describe("execute", () => {
    it("executes local tools with local source in meta", async () => {
      const localGraph = createMockLocalGraph()
      const cloudProxy = createMockCloudProxy()
      const router = new QueryRouter(localGraph, cloudProxy)

      const result = await router.execute("get_function", { key: "fn1" })
      expect(result._meta.source).toBe("local")
      expect(localGraph.getEntity).toHaveBeenCalledWith("fn1")
    })

    it("executes cloud tools with cloud source in meta", async () => {
      const localGraph = createMockLocalGraph()
      const cloudProxy = createMockCloudProxy()
      const router = new QueryRouter(localGraph, cloudProxy)

      const result = await router.execute("semantic_search", { query: "auth" })
      expect(result._meta.source).toBe("cloud")
      expect(cloudProxy.callTool).toHaveBeenCalledWith("semantic_search", { query: "auth" })
    })

    it("falls back to cloud when local fails", async () => {
      const localGraph = createMockLocalGraph()
      ;(localGraph.getEntity as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("Not found")
      })
      const cloudProxy = createMockCloudProxy()
      const router = new QueryRouter(localGraph, cloudProxy)

      const result = await router.execute("get_function", { key: "missing" })
      expect(result._meta.source).toBe("cloud")
      expect(cloudProxy.callTool).toHaveBeenCalled()
    })

    it("executes get_rules locally", async () => {
      const localGraph = createMockLocalGraph(true)
      const cloudProxy = createMockCloudProxy()
      const router = new QueryRouter(localGraph, cloudProxy)

      const result = await router.execute("get_rules", { file_path: "src/index.ts" })
      expect(result._meta.source).toBe("local")
      expect(localGraph.getRules).toHaveBeenCalledWith("src/index.ts")
    })

    it("executes check_rules locally with evaluator", async () => {
      const localGraph = createMockLocalGraph(true)
      const cloudProxy = createMockCloudProxy()
      const mockEvaluator = vi.fn().mockResolvedValue({
        violations: [],
        _meta: { source: "local", evaluatedRules: 1, skippedRules: 0, engines: { structural: 0, naming: 1, skipped: 0 } },
      })
      const router = new QueryRouter(localGraph, cloudProxy, mockEvaluator)

      const result = await router.execute("check_rules", { file_path: "src/index.ts", content: "const x = 1" })
      expect(result._meta.source).toBe("local")
      expect(mockEvaluator).toHaveBeenCalled()
    })

    it("falls back to cloud for check_rules without evaluator", async () => {
      const localGraph = createMockLocalGraph(true)
      const cloudProxy = createMockCloudProxy()
      const router = new QueryRouter(localGraph, cloudProxy) // no evaluator

      const result = await router.execute("check_rules", { file_path: "src/index.ts", content: "const x = 1" })
      expect(result._meta.source).toBe("cloud")
    })

    it("routes get_rules to cloud when no local rules", async () => {
      const localGraph = createMockLocalGraph(false)
      const cloudProxy = createMockCloudProxy()
      const router = new QueryRouter(localGraph, cloudProxy)

      const result = await router.execute("get_rules", {})
      expect(result._meta.source).toBe("cloud")
      expect(cloudProxy.callTool).toHaveBeenCalledWith("get_rules", {})
    })
  })
})
