import { beforeEach, describe, expect, it } from "vitest"
import { createTestContainer } from "@/lib/di/container"
import type { Container } from "@/lib/di/container"
import { InMemoryGraphStore } from "@/lib/di/fakes"
import type { RuleExceptionDoc } from "@/lib/ports/types"
import { createException, getActiveExceptions, isExempt, revokeException } from "@/lib/rules/exception-ledger"

describe("exception-ledger", () => {
  let container: Container
  let graphStore: InMemoryGraphStore

  beforeEach(() => {
    graphStore = new InMemoryGraphStore()
    container = createTestContainer({ graphStore })
  })

  describe("createException", () => {
    it("creates a new exception with active status", async () => {
      const exception = await createException(container, "org-1", "rule-1", {
        reason: "Legacy code migration",
        createdBy: "user-1",
        ttlDays: 30,
      })

      expect(exception.org_id).toBe("org-1")
      expect(exception.rule_id).toBe("rule-1")
      expect(exception.status).toBe("active")
      expect(exception.reason).toBe("Legacy code migration")
      expect(exception.created_by).toBe("user-1")
      expect(exception.id).toBeDefined()
      expect(exception.expires_at).toBeDefined()

      // Verify it was persisted
      const stored = await getActiveExceptions(container, "org-1", "rule-1")
      expect(stored.length).toBe(1)
    })

    it("sets expiration based on ttlDays", async () => {
      const exception = await createException(container, "org-1", "rule-1", {
        reason: "Temp exemption",
        createdBy: "user-1",
        ttlDays: 7,
      })

      const expiresAt = new Date(exception.expires_at)
      const now = new Date()
      const diffDays = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)

      // Should expire in roughly 7 days
      expect(diffDays).toBeGreaterThan(6.9)
      expect(diffDays).toBeLessThan(7.1)
    })
  })

  describe("isExempt", () => {
    it("returns true for active exceptions that have not expired", () => {
      const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      const exceptions: RuleExceptionDoc[] = [
        {
          id: "exc-1",
          org_id: "org-1",
          rule_id: "rule-1",
          reason: "Legacy code",
          created_by: "user-1",
          expires_at: future,
          status: "active",
          created_at: new Date().toISOString(),
        },
      ]

      expect(isExempt(exceptions)).toBe(true)
    })

    it("returns false for expired exceptions", () => {
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const exceptions: RuleExceptionDoc[] = [
        {
          id: "exc-1",
          org_id: "org-1",
          rule_id: "rule-1",
          reason: "Legacy code",
          created_by: "user-1",
          expires_at: past,
          status: "active",
          created_at: new Date().toISOString(),
        },
      ]

      expect(isExempt(exceptions)).toBe(false)
    })

    it("returns false for revoked exceptions", () => {
      const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      const exceptions: RuleExceptionDoc[] = [
        {
          id: "exc-1",
          org_id: "org-1",
          rule_id: "rule-1",
          reason: "Legacy code",
          created_by: "user-1",
          expires_at: future,
          status: "revoked",
          created_at: new Date().toISOString(),
        },
      ]

      expect(isExempt(exceptions)).toBe(false)
    })

    it("returns true for entity-specific exception matching entityId", () => {
      const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      const exceptions: RuleExceptionDoc[] = [
        {
          id: "exc-1",
          org_id: "org-1",
          rule_id: "rule-1",
          entity_id: "entity-abc",
          reason: "Specific entity exemption",
          created_by: "user-1",
          expires_at: future,
          status: "active",
          created_at: new Date().toISOString(),
        },
      ]

      expect(isExempt(exceptions, "entity-abc")).toBe(true)
      expect(isExempt(exceptions, "entity-other")).toBe(false)
    })
  })

  describe("revokeException", () => {
    it("updates status to revoked", async () => {
      const exception = await createException(container, "org-1", "rule-1", {
        reason: "Temporary",
        createdBy: "user-1",
        ttlDays: 30,
      })

      await revokeException(container, "org-1", exception.id)

      // After revocation, getActiveExceptions should return empty
      const active = await getActiveExceptions(container, "org-1", "rule-1")
      expect(active.length).toBe(0)
    })
  })
})
