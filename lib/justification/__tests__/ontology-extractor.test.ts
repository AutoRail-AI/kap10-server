import { describe, expect, it } from "vitest"
import type { EntityDoc } from "@/lib/ports/types"
import {
  buildDomainToArchitectureMap,
  buildOntologyPrompt,
  classifyTerms,
  extractDomainTerms,
  splitIdentifier,
} from "../ontology-extractor"

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

  it("includes three-tier classification when classifiedTerms provided", () => {
    const terms = [{ term: "payment", frequency: 10 }]
    const entities: EntityDoc[] = [
      { id: "1", org_id: "o", repo_id: "r", kind: "function", name: "PaymentHandler", file_path: "a.ts" },
    ]
    const classified = classifyTerms([
      { term: "payment", frequency: 10 },
      { term: "handler", frequency: 5 },
      { term: "redis", frequency: 3 },
    ])
    const prompt = buildOntologyPrompt(terms, entities, classified)
    expect(prompt).toContain("Domain (business concepts)")
    expect(prompt).toContain("Architectural (design patterns)")
    expect(prompt).toContain("Framework/Infrastructure")
    expect(prompt).toContain("payment")
  })
})

// ── classifyTerms (L-25) ─────────────────────────────────────────────────────

describe("classifyTerms", () => {
  it("classifies domain, architectural, and framework terms", () => {
    const terms = [
      { term: "payment", frequency: 10 },
      { term: "handler", frequency: 8 },
      { term: "prisma", frequency: 5 },
    ]
    const result = classifyTerms(terms)

    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({ term: "payment", tier: "domain" })
    expect(result[1]).toMatchObject({ term: "handler", tier: "architectural" })
    expect(result[2]).toMatchObject({ term: "prisma", tier: "framework" })
  })

  it("defaults unknown terms to domain", () => {
    const terms = [
      { term: "invoice", frequency: 7 },
      { term: "subscription", frequency: 4 },
    ]
    const result = classifyTerms(terms)
    expect(result.every((t) => t.tier === "domain")).toBe(true)
  })

  it("preserves frequency and initializes relatedTerms as empty", () => {
    const terms = [{ term: "order", frequency: 15 }]
    const result = classifyTerms(terms)
    expect(result[0]?.frequency).toBe(15)
    expect(result[0]?.relatedTerms).toEqual([])
  })
})

// ── buildDomainToArchitectureMap (L-25) ──────────────────────────────────────

describe("buildDomainToArchitectureMap", () => {
  it("links domain terms to architectural compound names", () => {
    const entities: EntityDoc[] = [
      { id: "1", org_id: "o", repo_id: "r", kind: "class", name: "PaymentHandler", file_path: "a.ts" },
      { id: "2", org_id: "o", repo_id: "r", kind: "class", name: "PaymentService", file_path: "b.ts" },
    ]
    const classified = classifyTerms([
      { term: "payment", frequency: 10 },
      { term: "handler", frequency: 5 },
      { term: "service", frequency: 5 },
    ])

    const result = buildDomainToArchitectureMap(entities, classified)
    expect(result["payment"]).toContain("paymentHandler")
    expect(result["payment"]).toContain("paymentService")
  })

  it("returns empty map when no cross-tier co-occurrences exist", () => {
    const entities: EntityDoc[] = [
      { id: "1", org_id: "o", repo_id: "r", kind: "function", name: "calculateTotal", file_path: "a.ts" },
    ]
    const classified = classifyTerms([
      { term: "calculate", frequency: 5 },
      { term: "total", frequency: 3 },
    ])

    const result = buildDomainToArchitectureMap(entities, classified)
    expect(Object.keys(result)).toHaveLength(0)
  })

  it("handles entities with no parseable terms", () => {
    const entities: EntityDoc[] = [
      { id: "1", org_id: "o", repo_id: "r", kind: "function", name: "x", file_path: "a.ts" },
    ]
    const classified = classifyTerms([{ term: "payment", frequency: 5 }])
    const result = buildDomainToArchitectureMap(entities, classified)
    expect(Object.keys(result)).toHaveLength(0)
  })
})
