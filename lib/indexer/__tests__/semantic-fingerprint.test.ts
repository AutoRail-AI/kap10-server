import { describe, expect, it, vi } from "vitest"
import {
  computeSemanticFingerprint,
  detectMoves,
} from "@/lib/indexer/semantic-fingerprint"

// Mock @ast-grep/napi for deterministic behavior
vi.mock("@ast-grep/napi", () => ({
  TypeScript: {
    parse: (code: string) => ({
      root: () => ({
        text: () => code.replace(/\s+/g, " ").trim(),
      }),
    }),
  },
}))

describe("computeSemanticFingerprint", () => {
  it("returns null for empty body", () => {
    expect(computeSemanticFingerprint("", "typescript")).toBeNull()
    expect(computeSemanticFingerprint("   ", "typescript")).toBeNull()
    expect(computeSemanticFingerprint("\n\t", "typescript")).toBeNull()
  })

  it("returns consistent fingerprint for same input", () => {
    const code = "function foo() { return 42; }"
    const fp1 = computeSemanticFingerprint(code, "typescript")
    const fp2 = computeSemanticFingerprint(code, "typescript")
    expect(fp1).not.toBeNull()
    expect(fp1).toBe(fp2)
    expect(fp1!.length).toBe(32) // SHA-256 truncated to 32 hex chars
  })

  it("returns different fingerprints for different code", () => {
    const fp1 = computeSemanticFingerprint("function foo() { return 1; }", "typescript")
    const fp2 = computeSemanticFingerprint("function bar() { return 2; }", "typescript")
    expect(fp1).not.toBeNull()
    expect(fp2).not.toBeNull()
    expect(fp1).not.toBe(fp2)
  })
})

describe("detectMoves", () => {
  it("finds moved entities with same body", () => {
    const body = "function helper() { return true; }"
    const deleted = [
      { id: "old-1", body, kind: "function", name: "helper", file_path: "src/utils.ts" },
    ]
    const added = [
      { id: "new-1", body, kind: "function", name: "helper", file_path: "src/helpers.ts" },
    ]

    const moves = detectMoves(added, deleted, "typescript")
    expect(moves).toHaveLength(1)
    expect(moves[0]!.fromEntity.id).toBe("old-1")
    expect(moves[0]!.toEntity.id).toBe("new-1")
  })

  it("ignores kind mismatches", () => {
    const body = "function helper() { return true; }"
    const deleted = [
      { id: "old-1", body, kind: "function", name: "helper", file_path: "src/a.ts" },
    ]
    const added = [
      { id: "new-1", body, kind: "class", name: "helper", file_path: "src/b.ts" },
    ]

    const moves = detectMoves(added, deleted, "typescript")
    expect(moves).toHaveLength(0)
  })
})
