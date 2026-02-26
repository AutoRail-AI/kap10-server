import { beforeEach, describe, expect, it } from "vitest"
import type { Container } from "@/lib/di/container"
import {
  FakeCodeIntelligence,
  FakeGitHost,
  FakePatternEngine,
  InlineWorkflowEngine,
  InMemoryCacheStore,
  InMemoryGraphStore,
  InMemoryObservability,
  InMemoryRelationalStore,
  InMemoryVectorSearch,
  MockLLMProvider,
  NoOpBillingProvider,
} from "@/lib/di/fakes"
import type { EntityDoc } from "@/lib/ports/types"
import type { McpAuthContext } from "../../auth"
import { filterDiff, parseDiffHunks } from "../diff-filter"
import { handleGetCallees, handleGetCallers, handleGetImports } from "../graph"
import { dispatchToolCall, getToolSchemas, TOOL_DEFINITIONS } from "../index"
import { handleGetClass, handleGetFile, handleGetFunction } from "../inspect"
import { handleSearchCode } from "../search"
import { handleGetProjectStats } from "../stats"

function makeContainer(overrides?: Partial<Container>): Container {
  return {
    graphStore: new InMemoryGraphStore(),
    relationalStore: new InMemoryRelationalStore(),
    cacheStore: new InMemoryCacheStore(),
    workflowEngine: new InlineWorkflowEngine(),
    gitHost: new FakeGitHost(),
    vectorSearch: new InMemoryVectorSearch(),
    billingProvider: new NoOpBillingProvider(),
    observability: new InMemoryObservability(),
    llmProvider: new MockLLMProvider(),
    codeIntelligence: new FakeCodeIntelligence(),
    patternEngine: new FakePatternEngine(),
    ...overrides,
  }
}

const baseCtx: McpAuthContext = {
  authMode: "api_key",
  userId: "user-1",
  orgId: "org-1",
  repoId: "repo-1",
  scopes: ["mcp:read", "mcp:sync"],
}

function makeEntity(overrides: Partial<EntityDoc> & { id: string; name: string }): EntityDoc {
  return {
    kind: "function",
    file_path: "src/index.ts",
    start_line: 1,
    end_line: 10,
    org_id: "org-1",
    repo_id: "repo-1",
    signature: `function ${overrides.name}()`,
    ...overrides,
  } as EntityDoc
}

describe("search_code", () => {
  it("searches entities by keyword", async () => {
    const container = makeContainer()
    await container.graphStore.upsertEntity("org-1", makeEntity({ id: "fn-1", name: "fetchUser" }))

    const result = await handleSearchCode({ query: "fetch" }, baseCtx, container)
    expect(result.content[0]!.text).toContain("fetchUser")
  })

  it("returns error for empty query", async () => {
    const container = makeContainer()
    const result = await handleSearchCode({ query: "" }, baseCtx, container)
    expect((result as { isError?: boolean }).isError).toBe(true)
  })

  it("returns error when no repoId in context", async () => {
    const container = makeContainer()
    const ctx = { ...baseCtx, repoId: undefined }
    const result = await handleSearchCode({ query: "test" }, ctx, container)
    expect((result as { isError?: boolean }).isError).toBe(true)
  })

  it("respects limit parameter", async () => {
    const container = makeContainer()
    for (let i = 0; i < 10; i++) {
      await container.graphStore.upsertEntity(
        "org-1",
        makeEntity({ id: `fn-${i}`, name: `handler${i}` })
      )
    }
    const result = await handleSearchCode({ query: "handler", limit: 3 }, baseCtx, container)
    const parsed = JSON.parse(result.content[0]!.text) as { count: number }
    expect(parsed.count).toBeLessThanOrEqual(3)
  })
})

describe("get_function", () => {
  let container: Container

  beforeEach(async () => {
    container = makeContainer()
    await container.graphStore.upsertEntity(
      "org-1",
      makeEntity({
        id: "fn-1",
        name: "processOrder",
        kind: "function",
        file_path: "src/orders.ts",
        start_line: 10,
        end_line: 30,
        signature: "function processOrder(order: Order): void",
      })
    )
  })

  it("finds function by name", async () => {
    const result = await handleGetFunction({ name: "processOrder" }, baseCtx, container)
    const parsed = JSON.parse(result.content[0]!.text) as {
      function: { name: string; signature: string }
    }
    expect(parsed.function.name).toBe("processOrder")
    expect(parsed.function.signature).toContain("processOrder")
  })

  it("finds function by file + line", async () => {
    const result = await handleGetFunction(
      { file: "src/orders.ts", line: 15 },
      baseCtx,
      container
    )
    const parsed = JSON.parse(result.content[0]!.text) as {
      function: { name: string }
    }
    expect(parsed.function.name).toBe("processOrder")
  })

  it("returns error for missing function", async () => {
    const result = await handleGetFunction({ name: "doesNotExist" }, baseCtx, container)
    expect((result as { isError?: boolean }).isError).toBe(true)
  })

  it("returns error when neither name nor file+line provided", async () => {
    const result = await handleGetFunction({}, baseCtx, container)
    expect((result as { isError?: boolean }).isError).toBe(true)
  })
})

describe("get_class", () => {
  it("finds class with methods", async () => {
    const container = makeContainer()
    await container.graphStore.upsertEntity(
      "org-1",
      makeEntity({
        id: "cls-1",
        name: "UserService",
        kind: "class",
        file_path: "src/services.ts",
        start_line: 1,
        end_line: 50,
      })
    )
    await container.graphStore.upsertEntity(
      "org-1",
      makeEntity({
        id: "method-1",
        name: "getUser",
        kind: "method",
        file_path: "src/services.ts",
        start_line: 5,
        end_line: 15,
      })
    )

    const result = await handleGetClass({ name: "UserService" }, baseCtx, container)
    const parsed = JSON.parse(result.content[0]!.text) as {
      class: { name: string }
      methods: Array<{ name: string }>
    }
    expect(parsed.class.name).toBe("UserService")
    expect(parsed.methods).toHaveLength(1)
    expect(parsed.methods[0]!.name).toBe("getUser")
  })

  it("returns error for missing class", async () => {
    const container = makeContainer()
    const result = await handleGetClass({ name: "Ghost" }, baseCtx, container)
    expect((result as { isError?: boolean }).isError).toBe(true)
  })
})

describe("get_file", () => {
  it("returns entities in a file", async () => {
    const container = makeContainer()
    await container.graphStore.upsertEntity(
      "org-1",
      makeEntity({ id: "fn-1", name: "alpha", file_path: "src/lib.ts", start_line: 1 })
    )
    await container.graphStore.upsertEntity(
      "org-1",
      makeEntity({ id: "fn-2", name: "beta", file_path: "src/lib.ts", start_line: 20 })
    )

    const result = await handleGetFile({ path: "src/lib.ts" }, baseCtx, container)
    const parsed = JSON.parse(result.content[0]!.text) as {
      file: { path: string; language: string; entity_count: number }
      entities: Array<{ name: string }>
    }
    expect(parsed.file.path).toBe("src/lib.ts")
    expect(parsed.file.language).toBe("typescript")
    expect(parsed.entities).toHaveLength(2)
  })

  it("returns error for non-existent file", async () => {
    const container = makeContainer()
    const result = await handleGetFile({ path: "nope.ts" }, baseCtx, container)
    expect((result as { isError?: boolean }).isError).toBe(true)
  })
})

describe("get_callers", () => {
  it("finds callers of a function", async () => {
    const container = makeContainer()
    await container.graphStore.upsertEntity(
      "org-1",
      makeEntity({ id: "fn-a", name: "main", file_path: "src/app.ts", start_line: 1 })
    )
    await container.graphStore.upsertEntity(
      "org-1",
      makeEntity({ id: "fn-b", name: "helper", file_path: "src/app.ts", start_line: 20 })
    )
    await container.graphStore.upsertEdge("org-1", {
      _from: "functions/fn-a",
      _to: "functions/fn-b",
      kind: "calls",
      org_id: "org-1",
      repo_id: "repo-1",
    })

    const result = await handleGetCallers({ name: "helper" }, baseCtx, container)
    const parsed = JSON.parse(result.content[0]!.text) as {
      callers: Array<{ name: string }>
    }
    expect(parsed.callers).toHaveLength(1)
    expect(parsed.callers[0]!.name).toBe("main")
  })
})

describe("get_callees", () => {
  it("finds callees of a function", async () => {
    const container = makeContainer()
    await container.graphStore.upsertEntity(
      "org-1",
      makeEntity({ id: "fn-a", name: "controller", file_path: "src/ctrl.ts", start_line: 1 })
    )
    await container.graphStore.upsertEntity(
      "org-1",
      makeEntity({ id: "fn-b", name: "service", file_path: "src/ctrl.ts", start_line: 30 })
    )
    await container.graphStore.upsertEdge("org-1", {
      _from: "functions/fn-a",
      _to: "functions/fn-b",
      kind: "calls",
      org_id: "org-1",
      repo_id: "repo-1",
    })

    const result = await handleGetCallees({ name: "controller" }, baseCtx, container)
    const parsed = JSON.parse(result.content[0]!.text) as {
      callees: Array<{ name: string }>
    }
    expect(parsed.callees).toHaveLength(1)
    expect(parsed.callees[0]!.name).toBe("service")
  })
})

describe("get_imports", () => {
  it("returns import chains for a file", async () => {
    const container = makeContainer()
    await container.graphStore.upsertEntity(
      "org-1",
      makeEntity({
        id: "file-a",
        name: "src/app.ts",
        kind: "file",
        file_path: "src/app.ts",
        start_line: 0,
      })
    )
    await container.graphStore.upsertEntity(
      "org-1",
      makeEntity({
        id: "file-b",
        name: "src/utils.ts",
        kind: "file",
        file_path: "src/utils.ts",
        start_line: 0,
      })
    )
    await container.graphStore.upsertEdge("org-1", {
      _from: "files/file-a",
      _to: "files/file-b",
      kind: "imports",
      org_id: "org-1",
      repo_id: "repo-1",
    })

    const result = await handleGetImports({ file: "src/app.ts" }, baseCtx, container)
    const parsed = JSON.parse(result.content[0]!.text) as {
      imports: Array<{ path: string }>
    }
    expect(parsed.imports).toHaveLength(1)
    expect(parsed.imports[0]!.path).toBe("src/utils.ts")
  })
})

describe("get_project_stats", () => {
  it("returns aggregated stats", async () => {
    const container = makeContainer()
    await container.graphStore.upsertEntity(
      "org-1",
      makeEntity({ id: "f1", name: "src/a.ts", kind: "file", file_path: "src/a.ts", start_line: 0 })
    )
    await container.graphStore.upsertEntity(
      "org-1",
      makeEntity({ id: "fn1", name: "hello", kind: "function", file_path: "src/a.ts", start_line: 1 })
    )
    // Create a repo in the relational store
    await container.relationalStore.createRepo({
      organizationId: "org-1",
      name: "test",
      fullName: "org/test",
      provider: "github",
      providerId: "123",
      status: "ready",
    })

    const result = await handleGetProjectStats({} as Record<string, never>, baseCtx, container)
    const parsed = JSON.parse(result.content[0]!.text) as {
      files: number
      functions: number
    }
    expect(parsed.files).toBe(1)
    expect(parsed.functions).toBe(1)
  })
})

describe("filterDiff", () => {
  it("strips lockfile hunks", () => {
    const diff = `diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,3 +1,3 @@
 lockfile content
diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 real code`

    const { filtered, strippedFiles } = filterDiff(diff)
    expect(strippedFiles).toContain("package-lock.json")
    expect(filtered).toContain("src/app.ts")
    expect(filtered).not.toContain("lockfile content")
  })

  it("strips node_modules paths", () => {
    const diff = `diff --git a/node_modules/pkg/index.js b/node_modules/pkg/index.js
+++ b/node_modules/pkg/index.js
@@ -1 +1 @@
 module code`

    const { filtered, strippedFiles } = filterDiff(diff)
    expect(strippedFiles.length).toBeGreaterThan(0)
    expect(filtered).not.toContain("module code")
  })

  it("preserves non-lockfile diffs", () => {
    const diff = `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
+import { foo } from './foo'
 const x = 1`

    const { filtered, strippedFiles } = filterDiff(diff)
    expect(strippedFiles).toHaveLength(0)
    expect(filtered).toContain("import { foo }")
  })
})

describe("parseDiffHunks", () => {
  it("extracts file paths and line numbers", () => {
    const diff = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,5 +10,7 @@
 some code
@@ -30,3 +32,4 @@
 more code`

    const files = parseDiffHunks(diff)
    expect(files).toHaveLength(1)
    expect(files[0]!.filePath).toBe("src/app.ts")
    expect(files[0]!.hunks).toHaveLength(2)
    expect(files[0]!.hunks[0]!.startLine).toBe(10)
    expect(files[0]!.hunks[1]!.startLine).toBe(32)
  })

  it("handles multiple files", () => {
    const diff = `diff --git a/a.ts b/a.ts
+++ b/a.ts
@@ -1,3 +1,4 @@
+new line
diff --git a/b.ts b/b.ts
+++ b/b.ts
@@ -5,2 +5,3 @@
+another line`

    const files = parseDiffHunks(diff)
    expect(files).toHaveLength(2)
    expect(files[0]!.filePath).toBe("a.ts")
    expect(files[1]!.filePath).toBe("b.ts")
  })
})

describe("dispatchToolCall", () => {
  it("returns error for unknown tool", async () => {
    const container = makeContainer()
    const result = await dispatchToolCall("nonexistent", {}, baseCtx, container)
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain("Unknown tool")
  })

  it("rejects when scope is missing", async () => {
    const container = makeContainer()
    const ctx: McpAuthContext = { ...baseCtx, scopes: ["mcp:read"] }
    const result = await dispatchToolCall("sync_local_diff", { diff: "test" }, ctx, container)
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain("mcp:sync")
  })
})

describe("getToolSchemas", () => {
  it("returns all 28 tool schemas", () => {
    const schemas = getToolSchemas()
    expect(schemas).toHaveLength(28)
    expect(schemas.map((s) => s.name)).toContain("search_code")
    expect(schemas.map((s) => s.name)).toContain("semantic_search")
    expect(schemas.map((s) => s.name)).toContain("find_similar")
    expect(schemas.map((s) => s.name)).toContain("sync_local_diff")
    // Phase 4 tools
    expect(schemas.map((s) => s.name)).toContain("get_business_context")
    expect(schemas.map((s) => s.name)).toContain("search_by_purpose")
    expect(schemas.map((s) => s.name)).toContain("analyze_impact")
    expect(schemas.map((s) => s.name)).toContain("get_blueprint")
  })
})

describe("TOOL_DEFINITIONS", () => {
  it("has 28 tools with required fields", () => {
    expect(TOOL_DEFINITIONS).toHaveLength(28)
    for (const def of TOOL_DEFINITIONS) {
      expect(def.name).toBeTruthy()
      expect(def.description).toBeTruthy()
      expect(def.inputSchema).toBeTruthy()
      expect(def.requiredScope).toBeTruthy()
    }
  })
})
