import { describe, expect, it } from "vitest"
import type { EdgeDoc, EntityDoc } from "@/lib/ports/types"
import { compactEdge, compactEntity } from "../graph-compactor"

describe("graph-compactor", () => {
  describe("compactEntity", () => {
    it("strips org_id and repo_id", () => {
      const entity: EntityDoc = {
        id: "abc123",
        org_id: "org1",
        repo_id: "repo1",
        kind: "function",
        name: "doStuff",
        file_path: "src/index.ts",
        start_line: 10,
      }
      const compact = compactEntity(entity)
      expect(compact).not.toHaveProperty("org_id")
      expect(compact).not.toHaveProperty("repo_id")
      expect(compact.key).toBe("abc123")
      expect(compact.kind).toBe("function")
      expect(compact.name).toBe("doStuff")
    })

    it("strips collection prefix from ArangoDB _id", () => {
      const entity: EntityDoc = {
        id: "functions/abc123",
        org_id: "org1",
        repo_id: "repo1",
        kind: "function",
        name: "doStuff",
        file_path: "src/index.ts",
      }
      const compact = compactEntity(entity)
      expect(compact.key).toBe("abc123")
    })

    it("truncates body over 50 lines", () => {
      const lines = Array.from({ length: 80 }, (_, i) => `line ${i + 1}`)
      const entity: EntityDoc = {
        id: "fn1",
        org_id: "org1",
        repo_id: "repo1",
        kind: "function",
        name: "bigFn",
        file_path: "src/big.ts",
        body: lines.join("\n"),
      }
      const compact = compactEntity(entity)
      const resultLines = compact.body!.split("\n")
      expect(resultLines).toHaveLength(51) // 50 + annotation
      expect(resultLines[50]).toBe("// ... 30 more lines")
    })

    it("preserves body under 50 lines", () => {
      const body = "line 1\nline 2\nline 3"
      const entity: EntityDoc = {
        id: "fn2",
        org_id: "org1",
        repo_id: "repo1",
        kind: "function",
        name: "smallFn",
        file_path: "src/small.ts",
        body,
      }
      const compact = compactEntity(entity)
      expect(compact.body).toBe(body)
    })

    it("handles missing optional fields", () => {
      const entity: EntityDoc = {
        id: "fn3",
        org_id: "org1",
        repo_id: "repo1",
        kind: "function",
        name: "noBody",
        file_path: "src/noop.ts",
      }
      const compact = compactEntity(entity)
      expect(compact.body).toBeUndefined()
      expect(compact.signature).toBeUndefined()
      expect(compact.start_line).toBeUndefined()
    })
  })

  describe("compactEdge", () => {
    it("strips collection prefix from _from and _to", () => {
      const edge: EdgeDoc = {
        _from: "functions/abc123",
        _to: "functions/def456",
        org_id: "org1",
        repo_id: "repo1",
        kind: "calls",
      }
      const compact = compactEdge(edge)
      expect(compact.from_key).toBe("abc123")
      expect(compact.to_key).toBe("def456")
      expect(compact.type).toBe("calls")
    })

    it("handles bare keys (no collection prefix)", () => {
      const edge: EdgeDoc = {
        _from: "abc123",
        _to: "def456",
        org_id: "org1",
        repo_id: "repo1",
        kind: "imports",
      }
      const compact = compactEdge(edge)
      expect(compact.from_key).toBe("abc123")
      expect(compact.to_key).toBe("def456")
      expect(compact.type).toBe("imports")
    })
  })
})
