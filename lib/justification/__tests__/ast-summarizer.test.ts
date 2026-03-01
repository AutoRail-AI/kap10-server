import { describe, expect, it } from "vitest"
import { summarizeBody } from "../ast-summarizer"

describe("summarizeBody", () => {
  it("returns empty for empty body", () => {
    const result = summarizeBody("")
    expect(result.text).toBe("")
    expect(result.anchors).toEqual([])
    expect(result.originalLength).toBe(0)
    expect(result.wasTruncated).toBe(false)
  })

  it("short function returned verbatim", () => {
    const body = `function add(a, b) {\n  return a + b\n}`
    const result = summarizeBody(body, 5000)
    expect(result.text).toBe(body)
    expect(result.wasTruncated).toBe(false)
    expect(result.anchors.length).toBe(1)
    expect(result.anchors[0]!.category).toBe("return")
  })

  it("preserves decision points as anchors", () => {
    const body = [
      "function validate(user) {",
      "  const name = user.name",
      "  const email = user.email",
      "  if (name.length === 0) {",
      '    throw new Error("Name required")',
      "  }",
      "  if (!email.includes('@')) {",
      '    throw new Error("Invalid email")',
      "  }",
      "  return true",
      "}",
    ].join("\n")

    // Short enough to not truncate, just verify anchor detection
    const result = summarizeBody(body, 10000)
    const categories = result.anchors.map((a) => a.category)
    expect(categories).toContain("decision")
    expect(categories).toContain("error")
    expect(categories).toContain("return")
  })

  it("detects external API calls as anchors", () => {
    const body = [
      "async function chargeCustomer(amount) {",
      "  const config = getConfig()",
      "  const logger = createLogger()",
      "  logger.info('starting charge')",
      "  const result = await stripe.charges.create({ amount })",
      "  return result",
      "}",
    ].join("\n")

    const result = summarizeBody(body, 10000)
    const externalCalls = result.anchors.filter((a) => a.category === "external_call")
    expect(externalCalls.length).toBeGreaterThanOrEqual(1)
    expect(externalCalls.some((a) => a.line.includes("stripe.charges.create"))).toBe(true)
  })

  it("detects state mutations as anchors", () => {
    const body = [
      "function updateOrder(order) {",
      '  order.status = "completed"',
      "  order.items.push(newItem)",
      "  return order",
      "}",
    ].join("\n")

    const result = summarizeBody(body, 10000)
    const mutations = result.anchors.filter((a) => a.category === "mutation")
    expect(mutations.length).toBeGreaterThanOrEqual(1)
    expect(mutations.some((a) => a.line.includes("order.status"))).toBe(true)
  })

  it("long function is summarized under maxChars", () => {
    // Generate a long function with lots of setup and few anchors
    const lines = ["function bigFunction() {"]
    for (let i = 0; i < 200; i++) {
      lines.push(`  const var${i} = getValue${i}()`)
    }
    lines.push("  if (var0 > 100) {")
    lines.push('    throw new Error("too large")')
    lines.push("  }")
    lines.push("  return var0")
    lines.push("}")
    const body = lines.join("\n")

    const result = summarizeBody(body, 1000)
    expect(result.wasTruncated).toBe(true)
    expect(result.text.length).toBeLessThanOrEqual(1000)
    // Anchors are preserved
    expect(result.anchors.some((a) => a.category === "decision")).toBe(true)
    expect(result.anchors.some((a) => a.category === "error")).toBe(true)
    expect(result.anchors.some((a) => a.category === "return")).toBe(true)
  })

  it("only setup code produces structural tokens", () => {
    const lines = ["function setup() {"]
    for (let i = 0; i < 20; i++) {
      lines.push(`  const x${i} = ${i}`)
    }
    lines.push("}")
    const body = lines.join("\n")

    // Make maxChars small enough to trigger summarization
    const result = summarizeBody(body, 50)
    expect(result.wasTruncated).toBe(true)
    // Should have structural tokens
    expect(result.text).toContain("[")
  })

  it("categorizes anchors correctly", () => {
    const body = [
      "async function process(items) {",
      "  if (items.length === 0) return []",
      "  const result = await this.service.fetchAll()",
      "  result.count = items.length",
      '  throw new Error("not implemented")',
      "  expect(result).toBeDefined()",
      "  return result",
      "}",
    ].join("\n")

    const result = summarizeBody(body, 10000)
    const catSet = new Set(result.anchors.map((a) => a.category))
    expect(catSet.has("decision")).toBe(true)
    expect(catSet.has("external_call")).toBe(true)
    expect(catSet.has("mutation")).toBe(true)
    expect(catSet.has("error")).toBe(true)
    expect(catSet.has("return")).toBe(true)
  })
})
