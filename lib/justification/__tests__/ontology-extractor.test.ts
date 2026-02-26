import { describe, expect, it } from "vitest"
import type { EntityDoc } from "@/lib/ports/types"
import { buildOntologyPrompt, extractDomainTerms, splitIdentifier } from "../ontology-extractor"

describe("splitIdentifier", () => {
  it("splits camelCase", () => {
    expect(splitIdentifier("getUserById")).toEqual(["user"])
  })

  it("splits snake_case", () => {
    // "process" and "request" are programming stopwords
    expect(splitIdentifier("order_payment_invoice")).toEqual(["order", "payment", "invoice"])
  })

  it("filters programming stopwords", () => {
    const result = splitIdentifier("getDataFromList")
    // "get", "data", "from", "list" are all stopwords
    expect(result).toEqual([])
  })

  it("handles mixed case identifiers", () => {
    // "service" is a programming stopword
    expect(splitIdentifier("OrderPaymentInvoice")).toEqual(["order", "payment", "invoice"])
  })

  it("filters short terms", () => {
    const result = splitIdentifier("doIt")
    expect(result).toEqual([]) // "do" and "it" are < 3 chars or stopwords
  })
})

describe("extractDomainTerms", () => {
  const entities: EntityDoc[] = [
    { id: "1", org_id: "o", repo_id: "r", kind: "function", name: "processOrder", file_path: "a.ts" },
    { id: "2", org_id: "o", repo_id: "r", kind: "function", name: "validateOrder", file_path: "b.ts" },
    { id: "3", org_id: "o", repo_id: "r", kind: "class", name: "OrderRepository", file_path: "c.ts" },
    { id: "4", org_id: "o", repo_id: "r", kind: "function", name: "sendEmail", file_path: "d.ts" },
  ]

  it("returns terms sorted by frequency", () => {
    const result = extractDomainTerms(entities)
    expect(result[0]!.term).toBe("order")
    expect(result[0]!.frequency).toBe(3)
  })

  it("filters terms below minimum frequency", () => {
    const result = extractDomainTerms(entities)
    // "email" only appears once, should be filtered
    expect(result.find((t) => t.term === "email")).toBeUndefined()
  })

  it("returns empty for empty input", () => {
    expect(extractDomainTerms([])).toEqual([])
  })
})

describe("buildOntologyPrompt", () => {
  it("builds a prompt with terms and samples", () => {
    const terms = [{ term: "order", frequency: 5 }]
    const entities: EntityDoc[] = [
      { id: "1", org_id: "o", repo_id: "r", kind: "function", name: "processOrder", file_path: "a.ts" },
    ]
    const prompt = buildOntologyPrompt(terms, entities)
    expect(prompt).toContain("order")
    expect(prompt).toContain("processOrder")
    expect(prompt).toContain("ubiquitous language")
  })
})
