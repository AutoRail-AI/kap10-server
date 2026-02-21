import { describe, it, expect, vi, beforeEach } from "vitest"
import { isSemanticChange } from "@/lib/indexer/ast-comparator"

// Mock @ast-grep/napi since it may not be installed
vi.mock("@ast-grep/napi", () => ({
  TypeScript: {
    parse: (code: string) => ({
      root: () => ({
        text: () => code.replace(/\s+/g, " ").trim(),
      }),
    }),
  },
  JavaScript: {
    parse: (code: string) => ({
      root: () => ({
        text: () => code.replace(/\s+/g, " ").trim(),
      }),
    }),
  },
}))

describe("isSemanticChange", () => {
  beforeEach(() => {
    // Reset AST_DIFF_ENABLED to default
    delete process.env.AST_DIFF_ENABLED
  })

  it("returns false for identical content", () => {
    const code = "function foo() { return 1; }"
    expect(isSemanticChange(code, code, "typescript")).toBe(false)
  })

  it("returns true when AST_DIFF_ENABLED is false and content differs", () => {
    process.env.AST_DIFF_ENABLED = "false"
    const oldCode = "function foo() { return 1; }"
    const newCode = "function foo() { return 2; }"
    expect(isSemanticChange(oldCode, newCode, "typescript")).toBe(true)
  })

  it("returns true for unknown languages", () => {
    const oldCode = "proc foo() { return 1; }"
    const newCode = "proc foo()  {  return 1;  }"
    // Unknown language always returns true when content differs
    expect(isSemanticChange(oldCode, newCode, "brainfuck")).toBe(true)
  })

  it("returns true when content differs", () => {
    const oldCode = "function foo() { return 1; }"
    const newCode = "function foo() { return 2; }"
    expect(isSemanticChange(oldCode, newCode, "typescript")).toBe(true)
  })

  it("handles empty strings", () => {
    // Identical empty strings → no change
    expect(isSemanticChange("", "", "typescript")).toBe(false)

    // One empty, one non-empty → semantic change
    expect(isSemanticChange("", "const x = 1;", "typescript")).toBe(true)
    expect(isSemanticChange("const x = 1;", "", "typescript")).toBe(true)
  })
})
