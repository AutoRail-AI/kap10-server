import { beforeEach, describe, expect, it } from "vitest"
import { applyBranchEdgeOverlay, applyBranchOverlay, shouldIndexBranch } from "@/lib/indexer/branch-overlay"
import type { EdgeDoc, EntityDoc } from "@/lib/ports/types"

describe("branch-overlay", () => {
  beforeEach(() => {
    delete process.env.BRANCH_INDEXING_ENABLED
    delete process.env.BRANCH_INDEXING_PATTERN
  })

  describe("shouldIndexBranch", () => {
    it("always returns true for default branch", () => {
      expect(shouldIndexBranch("main", "main")).toBe(true)
    })

    it("returns false for non-default when disabled", () => {
      process.env.BRANCH_INDEXING_ENABLED = "false"
      expect(shouldIndexBranch("feature/test", "main")).toBe(false)
    })

    it("returns true for non-default when enabled with wildcard", () => {
      process.env.BRANCH_INDEXING_ENABLED = "true"
      process.env.BRANCH_INDEXING_PATTERN = "*"
      expect(shouldIndexBranch("feature/test", "main")).toBe(true)
    })

    it("respects prefix pattern", () => {
      process.env.BRANCH_INDEXING_ENABLED = "true"
      process.env.BRANCH_INDEXING_PATTERN = "feature/*"
      expect(shouldIndexBranch("feature/test", "main")).toBe(true)
      expect(shouldIndexBranch("bugfix/test", "main")).toBe(false)
    })
  })

  describe("applyBranchOverlay", () => {
    const entity: EntityDoc = {
      id: "abc123",
      org_id: "org-1",
      repo_id: "repo-1",
      kind: "function",
      name: "test",
      file_path: "src/test.ts",
    }

    it("returns entities unchanged for default branch", () => {
      const result = applyBranchOverlay([entity], "main", "main")
      expect(result[0]?.id).toBe("abc123")
    })

    it("prefixes IDs for non-default branch", () => {
      const result = applyBranchOverlay([entity], "feature/test", "main")
      expect(result[0]?.id).toBe("branch:feature/test:abc123")
      expect((result[0] as Record<string, unknown>)._branch).toBe("feature/test")
    })
  })

  describe("applyBranchEdgeOverlay", () => {
    const edge: EdgeDoc = {
      _from: "functions/abc",
      _to: "functions/def",
      org_id: "org-1",
      repo_id: "repo-1",
      kind: "calls",
    }

    it("returns edges unchanged for default branch", () => {
      const result = applyBranchEdgeOverlay([edge], "main", "main")
      expect(result[0]?._from).toBe("functions/abc")
    })

    it("prefixes edge IDs for non-default branch", () => {
      const result = applyBranchEdgeOverlay([edge], "feature/test", "main")
      expect(result[0]?._from).toContain("branch:feature/test:")
    })
  })
})
