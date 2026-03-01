/**
 * Tests for the shared SCIP protobuf decoder.
 *
 * Since we can't easily generate real .scip files in tests,
 * we test the exported parseSCIPSymbol function and verify
 * the decoder handles edge cases gracefully.
 */
import { describe, expect, it } from "vitest"

import { parseSCIPSymbol } from "../scip-decoder"

describe("parseSCIPSymbol", () => {
  it("parses function symbols (ending with ())", () => {
    const result = parseSCIPSymbol("scip-typescript npm package func()")
    expect(result).toEqual({
      kind: "function",
      name: "func",
      signature: "func()",
    })
  })

  it("parses method symbols (ending with ().)", () => {
    // In real SCIP, method descriptors are separate space-delimited parts
    const result = parseSCIPSymbol("scip-typescript npm package method().")
    expect(result).toEqual({
      kind: "method",
      name: "method",
      signature: "method()",
    })
  })

  it("parses class symbols (ending with #)", () => {
    const result = parseSCIPSymbol("scip-typescript npm package UserService#")
    expect(result).toEqual({
      kind: "class",
      name: "UserService",
    })
  })

  it("parses variable symbols (ending with .)", () => {
    const result = parseSCIPSymbol("scip-typescript npm package MAX_SIZE.")
    expect(result).toEqual({
      kind: "variable",
      name: "MAX_SIZE",
    })
  })

  it("parses module symbols (ending with /)", () => {
    const result = parseSCIPSymbol("scip-typescript npm package utils/")
    expect(result).toEqual({
      kind: "module",
      name: "utils",
    })
  })

  it("works with Python SCIP symbols", () => {
    const result = parseSCIPSymbol("scip-python python project MyClass#")
    expect(result).toEqual({
      kind: "class",
      name: "MyClass",
    })
  })

  it("works with Go SCIP symbols", () => {
    const result = parseSCIPSymbol("scip-go go mod/pkg HandleRequest()")
    expect(result).toEqual({
      kind: "function",
      name: "HandleRequest",
      signature: "HandleRequest()",
    })
  })

  it("returns null for symbols with < 2 parts", () => {
    expect(parseSCIPSymbol("single")).toBeNull()
  })

  it("returns null for symbols with unknown descriptor suffix", () => {
    expect(parseSCIPSymbol("scip-typescript npm unknown_suffix!")).toBeNull()
  })

  it("returns null for empty string", () => {
    expect(parseSCIPSymbol("")).toBeNull()
  })

  it("handles whitespace in symbol string", () => {
    const result = parseSCIPSymbol("  scip-typescript npm package func()  ")
    expect(result).toEqual({
      kind: "function",
      name: "func",
      signature: "func()",
    })
  })
})

describe("SCIP edge classification (L-18a)", () => {
  it("function target → 'calls' edge kind", () => {
    const result = parseSCIPSymbol("scip-typescript npm pkg helper()")
    expect(result).not.toBeNull()
    const targetKind = result!.kind
    const edgeKind = (targetKind === "function" || targetKind === "method") ? "calls" : "references"
    expect(edgeKind).toBe("calls")
  })

  it("method target → 'calls' edge kind", () => {
    const result = parseSCIPSymbol("scip-typescript npm pkg doWork().")
    expect(result).not.toBeNull()
    const targetKind = result!.kind
    const edgeKind = (targetKind === "function" || targetKind === "method") ? "calls" : "references"
    expect(edgeKind).toBe("calls")
  })

  it("class target → 'references' edge kind", () => {
    const result = parseSCIPSymbol("scip-typescript npm pkg UserService#")
    expect(result).not.toBeNull()
    const targetKind = result!.kind
    const edgeKind = (targetKind === "function" || targetKind === "method") ? "calls" : "references"
    expect(edgeKind).toBe("references")
  })

  it("variable target → 'references' edge kind", () => {
    const result = parseSCIPSymbol("scip-typescript npm pkg MAX_SIZE.")
    expect(result).not.toBeNull()
    const targetKind = result!.kind
    const edgeKind = (targetKind === "function" || targetKind === "method") ? "calls" : "references"
    expect(edgeKind).toBe("references")
  })

  it("module target → 'references' edge kind", () => {
    const result = parseSCIPSymbol("scip-typescript npm pkg utils/")
    expect(result).not.toBeNull()
    const targetKind = result!.kind
    const edgeKind = (targetKind === "function" || targetKind === "method") ? "calls" : "references"
    expect(edgeKind).toBe("references")
  })
})
