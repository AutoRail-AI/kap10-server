/**
 * L-06: Tests for shared complexity estimation module.
 */
import { describe, expect, it } from "vitest"

import {
  computeComplexity,
  estimateCognitiveComplexity,
  estimateCyclomaticComplexity,
  stripCommentsAndStrings,
} from "../complexity"

describe("stripCommentsAndStrings", () => {
  it("strips single-line comments", () => {
    const body = `if (a) { // check a
      return true
    }`
    const cleaned = stripCommentsAndStrings(body, "typescript")
    expect(cleaned).not.toContain("// check a")
    expect(cleaned).toContain("if (a)")
  })

  it("strips block comments", () => {
    const body = `/* this is a comment */
    if (a) { return true }`
    const cleaned = stripCommentsAndStrings(body, "typescript")
    expect(cleaned).not.toContain("this is a comment")
    expect(cleaned).toContain("if (a)")
  })

  it("strips string literals", () => {
    const body = `const msg = "if this fails"
    if (real) { return true }`
    const cleaned = stripCommentsAndStrings(body, "typescript")
    expect(cleaned).not.toContain("if this fails")
    expect(cleaned).toContain("if (real)")
  })

  it("handles Python-style comments", () => {
    const body = `# check condition
    if a:
        return True`
    const cleaned = stripCommentsAndStrings(body, "python")
    expect(cleaned).not.toContain("# check")
    expect(cleaned).toContain("if a:")
  })
})

describe("estimateCyclomaticComplexity", () => {
  it("returns 1 for empty/trivial function", () => {
    expect(estimateCyclomaticComplexity("return 42", "typescript")).toBe(1)
  })

  it("counts if statements", () => {
    const body = `if (a) { return 1 }
    if (b) { return 2 }
    return 3`
    expect(estimateCyclomaticComplexity(body, "typescript")).toBe(3) // 1 + 2 ifs
  })

  it("counts logical operators", () => {
    const body = `if (a && b || c) { return true }`
    expect(estimateCyclomaticComplexity(body, "typescript")).toBe(4) // 1 + if + && + ||
  })

  it("does not count keywords in comments", () => {
    const body = `// if this is a comment with if and for
    return 42`
    expect(estimateCyclomaticComplexity(body, "typescript")).toBe(1)
  })

  it("does not count keywords in strings", () => {
    const body = `const msg = "if for while"
    return msg`
    expect(estimateCyclomaticComplexity(body, "typescript")).toBe(1)
  })

  it("handles Go-specific keywords", () => {
    const body = `if err != nil {
      return err
    }
    select {
    case msg := <-ch:
      handle(msg)
    }`
    expect(estimateCyclomaticComplexity(body, "go")).toBeGreaterThan(1)
  })

  it("handles Python-specific keywords", () => {
    const body = `if a and b:
      return True
    elif c or d:
      return False`
    // 1 + if + and + elif + or = 5
    expect(estimateCyclomaticComplexity(body, "python")).toBe(5)
  })
})

describe("estimateCognitiveComplexity", () => {
  it("returns 0 for trivial function", () => {
    expect(estimateCognitiveComplexity("return 42", "typescript")).toBe(0)
  })

  it("returns 1 for single if", () => {
    const body = `if (a) {
      return 1
    }
    return 2`
    expect(estimateCognitiveComplexity(body, "typescript")).toBe(1)
  })

  it("weights nested conditions higher", () => {
    const flat = `if (a) { return 1 }
    if (b) { return 2 }
    if (c) { return 3 }`

    const nested = `if (a) {
      if (b) {
        if (c) {
          return 1
        }
      }
    }`

    const flatScore = estimateCognitiveComplexity(flat, "typescript")
    const nestedScore = estimateCognitiveComplexity(nested, "typescript")

    // Nested should be higher: 1 + 2 + 3 = 6 vs flat: 1 + 1 + 1 = 3
    expect(nestedScore).toBeGreaterThan(flatScore)
  })

  it("counts logical operators", () => {
    const body = `if (a && b || c) {
      return true
    }`
    const score = estimateCognitiveComplexity(body, "typescript")
    // if(+1) + &&(+1) + ||(+1) = 3
    expect(score).toBeGreaterThanOrEqual(3)
  })

  it("else adds 1 without nesting increase", () => {
    const body = `if (a) {
      return 1
    } else {
      return 2
    }`
    const score = estimateCognitiveComplexity(body, "typescript")
    // if(+1) + else(+1) = 2
    expect(score).toBe(2)
  })
})

describe("computeComplexity", () => {
  it("returns both metrics", () => {
    const body = `if (a) {
      if (b) {
        return 1
      }
    }`
    const result = computeComplexity(body, "typescript")
    expect(result.cyclomatic).toBeGreaterThanOrEqual(3) // 1 + 2 ifs
    expect(result.cognitive).toBeGreaterThanOrEqual(3) // 1 + 2 (nested)
  })

  it("distinguishes flat vs nested for cognitive but not cyclomatic", () => {
    const flat = `if (a) { x() }
    if (b) { y() }
    if (c) { z() }`

    const nested = `if (a) {
      if (b) {
        if (c) {
          x()
        }
      }
    }`

    const flatResult = computeComplexity(flat, "typescript")
    const nestedResult = computeComplexity(nested, "typescript")

    // Cyclomatic should be similar (both have 3 ifs)
    expect(flatResult.cyclomatic).toBe(nestedResult.cyclomatic)
    // Cognitive should be much higher for nested
    expect(nestedResult.cognitive).toBeGreaterThan(flatResult.cognitive)
  })
})
