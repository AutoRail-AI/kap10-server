import { describe, expect, it } from "vitest"
import { formatToolError, formatToolResponse, truncateToolResult } from "../formatter"

describe("truncateToolResult", () => {
  it("returns small results unchanged", () => {
    const result = { name: "hello", kind: "function" }
    expect(truncateToolResult(result)).toEqual(result)
  })

  it("caps callers array at 20 items when over maxBytes", () => {
    const callers = Array.from({ length: 30 }, (_, i) => ({ name: `fn${i}`, body: "x".repeat(100) }))
    const result = truncateToolResult({ callers }, { maxBytes: 100 })
    expect((result.callers as unknown[]).length).toBe(20)
    expect(result._callersTruncated).toBe(true)
  })

  it("caps callees array at 20 items when over maxBytes", () => {
    const callees = Array.from({ length: 25 }, (_, i) => ({ name: `fn${i}`, body: "x".repeat(100) }))
    const result = truncateToolResult({ callees }, { maxBytes: 100 })
    expect((result.callees as unknown[]).length).toBe(20)
    expect(result._calleesTruncated).toBe(true)
  })

  it("caps results array at 50 items when over maxBytes", () => {
    const results = Array.from({ length: 60 }, (_, i) => ({ name: `result_item_${i}`, data: "x".repeat(50) }))
    const result = truncateToolResult({ results }, { maxBytes: 100 })
    expect((result.results as unknown[]).length).toBe(50)
    expect(result._resultsTruncated).toBe(true)
  })

  it("caps imports array at 30 items when over maxBytes", () => {
    const imports = Array.from({ length: 35 }, (_, i) => ({ path: `file${i}.ts`, data: "x".repeat(100) }))
    const result = truncateToolResult({ imports }, { maxBytes: 100 })
    expect((result.imports as unknown[]).length).toBe(30)
    expect(result._importsTruncated).toBe(true)
  })

  it("truncates body field when result exceeds maxBytes", () => {
    const longBody = "x".repeat(50000)
    const result = truncateToolResult(
      { name: "fn", body: longBody },
      { maxBytes: 1000 }
    )
    expect((result.body as string).length).toBeLessThan(longBody.length)
  })

  it("does not truncate arrays that are under limits", () => {
    const callers = [{ name: "fn1" }, { name: "fn2" }]
    const result = truncateToolResult({ callers })
    expect((result.callers as unknown[]).length).toBe(2)
    expect(result._callersTruncated).toBeUndefined()
  })
})

describe("formatToolResponse", () => {
  it("wraps result in MCP content format", () => {
    const response = formatToolResponse({ count: 5 })
    expect(response.content).toHaveLength(1)
    expect(response.content[0]!.type).toBe("text")
    const parsed = JSON.parse(response.content[0]!.text) as { count: number }
    expect(parsed.count).toBe(5)
  })
})

describe("formatToolError", () => {
  it("wraps error message in MCP error format", () => {
    const error = formatToolError("something went wrong")
    expect(error.isError).toBe(true)
    expect(error.content).toHaveLength(1)
    expect(error.content[0]!.text).toBe("something went wrong")
  })
})
