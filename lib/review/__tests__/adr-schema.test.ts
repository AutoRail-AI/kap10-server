import { describe, it, expect } from "vitest"
import { AdrSchema, renderAdrMarkdown, formatAdrFilename } from "@/lib/review/adr-schema"
import type { AdrContent } from "@/lib/ports/types"

function makeValidAdr(): AdrContent {
  return {
    title: "Use Repository Pattern for Data Access",
    context: "Direct database access in handlers creates tight coupling and makes testing difficult.",
    decision: "All data access will go through dedicated repository classes that abstract the persistence layer.",
    consequences: "Slightly more boilerplate but much cleaner architecture and testable units.",
    relatedEntities: ["UserRepository", "OrderRepository"],
    relatedFeatureAreas: ["infrastructure", "data-access"],
  }
}

describe("AdrSchema", () => {
  it("parses a valid ADR object without errors", () => {
    const adr = makeValidAdr()
    const result = AdrSchema.safeParse(adr)

    expect(result.success).toBe(true)
  })

  it("rejects a title that exceeds 100 characters", () => {
    const adr = {
      ...makeValidAdr(),
      title: "A".repeat(101),
    }
    const result = AdrSchema.safeParse(adr)

    expect(result.success).toBe(false)
  })

  it("rejects a context that exceeds 500 characters", () => {
    const adr = {
      ...makeValidAdr(),
      context: "C".repeat(501),
    }
    const result = AdrSchema.safeParse(adr)

    expect(result.success).toBe(false)
  })

  it("rejects a decision that exceeds 1000 characters", () => {
    const adr = {
      ...makeValidAdr(),
      decision: "D".repeat(1001),
    }
    const result = AdrSchema.safeParse(adr)

    expect(result.success).toBe(false)
  })

  it("rejects consequences that exceeds 500 characters", () => {
    const adr = {
      ...makeValidAdr(),
      consequences: "Q".repeat(501),
    }
    const result = AdrSchema.safeParse(adr)

    expect(result.success).toBe(false)
  })

  it("rejects relatedEntities array with more than 20 elements", () => {
    const adr = {
      ...makeValidAdr(),
      relatedEntities: Array.from({ length: 21 }, (_, i) => `Entity${i}`),
    }
    const result = AdrSchema.safeParse(adr)

    expect(result.success).toBe(false)
  })

  it("rejects relatedFeatureAreas array with more than 10 elements", () => {
    const adr = {
      ...makeValidAdr(),
      relatedFeatureAreas: Array.from({ length: 11 }, (_, i) => `area-${i}`),
    }
    const result = AdrSchema.safeParse(adr)

    expect(result.success).toBe(false)
  })

  it("accepts empty arrays for relatedEntities and relatedFeatureAreas", () => {
    const adr = {
      ...makeValidAdr(),
      relatedEntities: [],
      relatedFeatureAreas: [],
    }
    const result = AdrSchema.safeParse(adr)

    expect(result.success).toBe(true)
  })

  it("rejects missing required fields", () => {
    const result = AdrSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it("rejects when title is missing", () => {
    const { title: _title, ...withoutTitle } = makeValidAdr()
    const result = AdrSchema.safeParse(withoutTitle)
    expect(result.success).toBe(false)
  })
})

describe("renderAdrMarkdown", () => {
  it("includes the ADR title in a heading", () => {
    const adr = makeValidAdr()
    const md = renderAdrMarkdown(adr, 42)

    expect(md).toContain("# ADR: Use Repository Pattern for Data Access")
  })

  it("includes Status: Accepted", () => {
    const md = renderAdrMarkdown(makeValidAdr(), 42)

    expect(md).toContain("**Status:** Accepted")
  })

  it("includes the PR number in the triggered-by line", () => {
    const md = renderAdrMarkdown(makeValidAdr(), 99)

    expect(md).toContain("**Triggered by:** PR #99")
  })

  it("includes a Context section with the context text", () => {
    const adr = makeValidAdr()
    const md = renderAdrMarkdown(adr, 1)

    expect(md).toContain("## Context")
    expect(md).toContain(adr.context)
  })

  it("includes a Decision section with the decision text", () => {
    const adr = makeValidAdr()
    const md = renderAdrMarkdown(adr, 1)

    expect(md).toContain("## Decision")
    expect(md).toContain(adr.decision)
  })

  it("includes a Consequences section with the consequences text", () => {
    const adr = makeValidAdr()
    const md = renderAdrMarkdown(adr, 1)

    expect(md).toContain("## Consequences")
    expect(md).toContain(adr.consequences)
  })

  it("includes a Related Entities section with code-formatted entity names", () => {
    const adr = makeValidAdr()
    const md = renderAdrMarkdown(adr, 1)

    expect(md).toContain("## Related Entities")
    expect(md).toContain("`UserRepository`")
    expect(md).toContain("`OrderRepository`")
  })

  it("includes a Related Feature Areas section", () => {
    const adr = makeValidAdr()
    const md = renderAdrMarkdown(adr, 1)

    expect(md).toContain("## Related Feature Areas")
    expect(md).toContain("- infrastructure")
    expect(md).toContain("- data-access")
  })

  it("includes an auto-generated note at the end", () => {
    const md = renderAdrMarkdown(makeValidAdr(), 1)

    expect(md).toContain("automatically generated by kap10")
  })

  it("includes today's date in ISO format", () => {
    const today = new Date().toISOString().split("T")[0]!
    const md = renderAdrMarkdown(makeValidAdr(), 1)

    expect(md).toContain(today)
  })

  it("renders empty related entities gracefully", () => {
    const adr: AdrContent = { ...makeValidAdr(), relatedEntities: [] }
    const md = renderAdrMarkdown(adr, 1)

    expect(md).toContain("## Related Entities")
    // Empty list — no backtick entries
    expect(md).not.toContain("`UserRepository`")
  })
})

describe("formatAdrFilename", () => {
  it("generates a filename starting with docs/adr/", () => {
    const filename = formatAdrFilename("Use Repository Pattern")
    expect(filename).toMatch(/^docs\/adr\//)
  })

  it("includes today's date in the filename", () => {
    const today = new Date().toISOString().split("T")[0]!
    const filename = formatAdrFilename("Use Repository Pattern")
    expect(filename).toContain(today)
  })

  it("converts the title to kebab-case in the filename", () => {
    const filename = formatAdrFilename("Use Repository Pattern for Data Access")
    expect(filename).toContain("use-repository-pattern-for-data-access")
  })

  it("ends with .md extension", () => {
    const filename = formatAdrFilename("Some ADR Title")
    expect(filename).toMatch(/\.md$/)
  })

  it("strips leading and trailing hyphens from the slug", () => {
    const filename = formatAdrFilename("  ADR Title  ")
    const slug = filename.split("/").pop()!.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(".md", "")
    expect(slug).not.toMatch(/^-/)
    expect(slug).not.toMatch(/-$/)
  })

  it("replaces non-alphanumeric characters with hyphens", () => {
    const filename = formatAdrFilename("Use PostgreSQL + Redis (Phase 7)")
    // Special chars like +, (, ) and spaces become hyphens
    expect(filename).not.toContain("+")
    expect(filename).not.toContain("(")
    expect(filename).not.toContain(")")
  })

  it("truncates the slug to 50 characters", () => {
    const longTitle = "A Very Long ADR Title That Will Definitely Be Truncated Because It Is Way Too Long For The Filename"
    const filename = formatAdrFilename(longTitle)
    const datePrefix = new Date().toISOString().split("T")[0]! + "-"
    const slug = filename
      .replace("docs/adr/", "")
      .replace(datePrefix, "")
      .replace(".md", "")
    expect(slug.length).toBeLessThanOrEqual(50)
  })

  it("produces lowercase filenames", () => {
    const filename = formatAdrFilename("Use UPPERCASE Letters In ADR")
    const slug = filename.split("/").pop()!
    expect(slug).toBe(slug.toLowerCase())
  })
})
