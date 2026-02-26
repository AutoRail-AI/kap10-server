import { describe, expect, it } from "vitest"
import { computeDrift, cosineSimilarity } from "../drift-detector"

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1.0)
  })

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0)
  })

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0)
  })

  it("returns 0 for empty vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0)
  })

  it("returns 0 for mismatched lengths", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0)
  })

  it("computes similarity for real vectors", () => {
    const a = [0.5, 0.3, 0.8]
    const b = [0.5, 0.35, 0.75]
    const sim = cosineSimilarity(a, b)
    expect(sim).toBeGreaterThan(0.99)
  })
})

describe("computeDrift", () => {
  it("returns stable when AST hash unchanged", () => {
    const result = computeDrift({
      astHashOld: "abc123",
      astHashNew: "abc123",
      embeddingOld: [1, 0],
      embeddingNew: [0, 1],
    })
    expect(result.category).toBe("stable")
    expect(result.embeddingSimilarity).toBe(1.0)
  })

  it("returns cosmetic for high embedding similarity", () => {
    const v = [0.5, 0.3, 0.8, 0.1]
    const vTweaked = [0.5, 0.3, 0.8, 0.11] // Very slight change
    const result = computeDrift({
      astHashOld: "abc",
      astHashNew: "def",
      embeddingOld: v,
      embeddingNew: vTweaked,
    })
    expect(result.category).toBe("cosmetic")
    expect(result.embeddingSimilarity).toBeGreaterThan(0.95)
  })

  it("returns refactor for moderate embedding similarity", () => {
    const result = computeDrift({
      astHashOld: "abc",
      astHashNew: "def",
      embeddingOld: [1, 0, 0],
      embeddingNew: [0.9, 0.3, 0.1],
    })
    expect(result.category).toBe("refactor")
    expect(result.embeddingSimilarity).toBeGreaterThan(0.8)
    expect(result.embeddingSimilarity).toBeLessThanOrEqual(0.95)
  })

  it("returns intent_drift for low embedding similarity", () => {
    const result = computeDrift({
      astHashOld: "abc",
      astHashNew: "def",
      embeddingOld: [1, 0, 0],
      embeddingNew: [0, 0, 1],
    })
    expect(result.category).toBe("intent_drift")
    expect(result.embeddingSimilarity).toBeLessThanOrEqual(0.8)
  })
})
