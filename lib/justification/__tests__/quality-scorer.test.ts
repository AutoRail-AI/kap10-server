/**
 * L-11: Tests for quality scoring with positive reinforcement.
 */
import { describe, expect, it } from "vitest"

import type { JustificationDoc } from "@/lib/ports/types"

import { scoreJustification } from "../quality-scorer"

/** Helper to build a minimal justification for testing. */
function makeJustification(overrides: Partial<JustificationDoc> & Record<string, unknown> = {}): JustificationDoc {
  return {
    id: "j1",
    org_id: "org1",
    repo_id: "repo1",
    entity_id: "e1",
    taxonomy: "VERTICAL",
    confidence: 0.85,
    business_purpose: "Processes payment authorization requests for credit card transactions via the Stripe gateway",
    domain_concepts: ["payment", "authorization", "credit-card", "stripe"],
    feature_tag: "payment-processing",
    semantic_triples: [
      { subject: "PaymentService", predicate: "authorizes", object: "CreditCardTransaction" },
      { subject: "PaymentService", predicate: "delegates_to", object: "StripeGateway" },
      { subject: "CreditCardTransaction", predicate: "produces", object: "AuthorizationResult" },
    ],
    compliance_tags: ["pci-dss"],
    architectural_pattern: "gateway",
    model_tier: "standard",
    model_used: "claude-sonnet",
    valid_from: "2025-01-01T00:00:00Z",
    valid_to: null,
    created_at: "2025-01-01T00:00:00Z",
    reasoning: "The function name `authorizePayment` and its signature accepting `CreditCardDetails` indicate this handles payment authorization. It imports from `stripe-sdk` and calls `stripe.charges.create`, confirming it delegates to the Stripe payment gateway for credit card processing.",
    ...overrides,
  } as JustificationDoc
}

describe("scoreJustification", () => {
  describe("baseline behavior", () => {
    it("scores a high-quality justification above 0.5 (baseline)", () => {
      const result = scoreJustification(makeJustification())
      expect(result.score).toBeGreaterThan(0.5)
    })

    it("scores a minimal/poor justification below 0.5", () => {
      const result = scoreJustification(makeJustification({
        business_purpose: "handles data",
        domain_concepts: [],
        feature_tag: "utility",
        semantic_triples: [],
        compliance_tags: [],
        architectural_pattern: undefined,
        reasoning: undefined,
      }))
      expect(result.score).toBeLessThan(0.5)
    })

    it("clamps score to [0, 1]", () => {
      // Maximally bad
      const bad = scoreJustification(makeJustification({
        business_purpose: "classification failed",
        domain_concepts: ["function", "class", "string"],
        feature_tag: "misc",
        semantic_triples: [],
        compliance_tags: [],
        reasoning: undefined,
      }))
      expect(bad.score).toBeGreaterThanOrEqual(0)
      expect(bad.score).toBeLessThanOrEqual(1)

      // Maximally good (should not exceed 1)
      const good = scoreJustification(makeJustification())
      expect(good.score).toBeLessThanOrEqual(1)
    })
  })

  describe("penalty signals", () => {
    it("penalizes generic phrases", () => {
      const generic = scoreJustification(makeJustification({
        business_purpose: "Handles operations for data management and processing tasks",
      }))
      const specific = scoreJustification(makeJustification({
        business_purpose: "Validates JWT tokens issued by the OAuth2 identity provider for API authentication",
      }))
      expect(generic.score).toBeLessThan(specific.score)
      expect(generic.flags.some((f) => f.includes("generic_phrase"))).toBe(true)
    })

    it("penalizes short business purpose", () => {
      const result = scoreJustification(makeJustification({
        business_purpose: "Does stuff",
      }))
      expect(result.flags.some((f) => f.includes("short_purpose"))).toBe(true)
    })

    it("penalizes programming terms as domain concepts", () => {
      const result = scoreJustification(makeJustification({
        domain_concepts: ["function", "class", "payment"],
      }))
      expect(result.flags.some((f) => f.includes("programming_terms"))).toBe(true)
    })

    it("penalizes generic feature tags", () => {
      for (const tag of ["utility", "misc", "other"]) {
        const result = scoreJustification(makeJustification({ feature_tag: tag }))
        expect(result.flags.some((f) => f.includes("generic_feature_tag"))).toBe(true)
      }
    })

    it("penalizes lazy phrasing", () => {
      const result = scoreJustification(makeJustification({
        business_purpose: "A function that processes payment data for billing purposes",
      }))
      expect(result.flags.some((f) => f.includes("lazy_phrasing"))).toBe(true)
    })

    it("scores fallback justifications near 0", () => {
      const result = scoreJustification(makeJustification({
        business_purpose: "classification failed — unable to determine purpose",
        domain_concepts: [],
        feature_tag: "unknown",
        semantic_triples: [],
        compliance_tags: [],
        architectural_pattern: undefined,
        reasoning: undefined,
      }))
      expect(result.score).toBe(0)
      expect(result.flags.some((f) => f.includes("fallback_justification"))).toBe(true)
    })

    it("penalizes missing reasoning", () => {
      const result = scoreJustification(makeJustification({ reasoning: undefined }))
      expect(result.flags.some((f) => f.includes("missing_reasoning"))).toBe(true)
    })

    it("penalizes short reasoning", () => {
      const result = scoreJustification(makeJustification({ reasoning: "It processes data." }))
      expect(result.flags.some((f) => f.includes("short_reasoning"))).toBe(true)
    })

    it("penalizes reasoning that copies business purpose", () => {
      const purpose = "Processes payment authorization requests for credit card transactions"
      const result = scoreJustification(makeJustification({
        business_purpose: purpose,
        reasoning: purpose.toLowerCase(),
      }))
      expect(result.flags.some((f) => f.includes("reasoning_copies_purpose"))).toBe(true)
    })
  })

  describe("positive reinforcement signals", () => {
    it("rewards rich domain concepts", () => {
      const rich = scoreJustification(makeJustification({
        domain_concepts: ["payment", "authorization", "credit-card", "stripe"],
      }))
      const sparse = scoreJustification(makeJustification({
        domain_concepts: [],
      }))
      expect(rich.score).toBeGreaterThan(sparse.score)
      expect(rich.flags.some((f) => f.includes("+rich_domain_concepts"))).toBe(true)
    })

    it("rewards domain-specific terminology in purpose", () => {
      const domainRich = scoreJustification(makeJustification({
        business_purpose: "Handles payment authorization and billing subscription renewals for tenant organizations",
      }))
      expect(domainRich.flags.some((f) => f.includes("+domain_terminology"))).toBe(true)
    })

    it("rewards specific (non-generic) feature tags", () => {
      const result = scoreJustification(makeJustification({
        feature_tag: "payment-processing",
      }))
      expect(result.flags.some((f) => f.includes("+specific_feature_tag"))).toBe(true)
    })

    it("rewards rich semantic triples", () => {
      const rich = scoreJustification(makeJustification({
        semantic_triples: [
          { subject: "PaymentService", predicate: "authorizes", object: "Transaction" },
          { subject: "PaymentService", predicate: "validates", object: "CreditCard" },
          { subject: "Transaction", predicate: "produces", object: "Receipt" },
        ],
      }))
      expect(rich.flags.some((f) => f.includes("+rich_semantic_triples"))).toBe(true)
    })

    it("rewards detailed business purpose", () => {
      const result = scoreJustification(makeJustification({
        business_purpose: "Orchestrates the end-to-end payment authorization flow by validating credit card details, delegating to the Stripe gateway, and recording the transaction outcome",
      }))
      expect(result.flags.some((f) => f.includes("+detailed_purpose"))).toBe(true)
    })

    it("rewards evidence-rich reasoning", () => {
      const result = scoreJustification(makeJustification({
        reasoning: "The function `authorizePayment` in payment_service.ts imports from stripe-sdk and calls stripe.charges.create with 3 dependencies. The snake_case naming follows the project's convention for service methods.",
      }))
      expect(result.flags.some((f) => f.includes("+evidence"))).toBe(true)
    })

    it("rewards compliance awareness", () => {
      const result = scoreJustification(makeJustification({
        compliance_tags: ["pci-dss", "gdpr"],
      }))
      expect(result.flags.some((f) => f.includes("+compliance_awareness"))).toBe(true)
    })

    it("rewards architectural pattern", () => {
      const result = scoreJustification(makeJustification({
        architectural_pattern: "gateway",
      }))
      expect(result.flags.some((f) => f.includes("+architectural_pattern"))).toBe(true)
    })
  })

  describe("balance and normalization", () => {
    it("excellent justification scores >= 0.75", () => {
      const result = scoreJustification(makeJustification())
      expect(result.score).toBeGreaterThanOrEqual(0.75)
    })

    it("mediocre justification scores around 0.4-0.6", () => {
      const result = scoreJustification(makeJustification({
        business_purpose: "This method handles data processing for the application",
        domain_concepts: ["processing"],
        feature_tag: "data-processing",
        semantic_triples: [{ subject: "method", predicate: "processes", object: "data" }],
        compliance_tags: [],
        architectural_pattern: undefined,
        reasoning: "The method processes data based on the input parameters and returns results.",
      }))
      expect(result.score).toBeGreaterThanOrEqual(0.3)
      expect(result.score).toBeLessThanOrEqual(0.7)
    })

    it("penalty flags are prefixed with -", () => {
      const result = scoreJustification(makeJustification({
        business_purpose: "handles data",
        reasoning: undefined,
      }))
      const penaltyFlags = result.flags.filter((f) => f.startsWith("-"))
      expect(penaltyFlags.length).toBeGreaterThan(0)
    })

    it("bonus flags are prefixed with +", () => {
      const result = scoreJustification(makeJustification())
      const bonusFlags = result.flags.filter((f) => f.startsWith("+"))
      expect(bonusFlags.length).toBeGreaterThan(0)
    })
  })
})
