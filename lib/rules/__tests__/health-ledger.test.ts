import { describe, it, expect, beforeEach } from "vitest"
import { incrementRuleHealth, getRuleHealthSummary } from "@/lib/rules/health-ledger"
import { createTestContainer } from "@/lib/di/container"
import { InMemoryGraphStore } from "@/lib/di/fakes"
import type { Container } from "@/lib/di/container"

describe("health-ledger", () => {
  let container: Container
  let graphStore: InMemoryGraphStore

  beforeEach(() => {
    graphStore = new InMemoryGraphStore()
    container = createTestContainer({ graphStore })
  })

  describe("incrementRuleHealth", () => {
    it("creates a health record if none exists", async () => {
      await incrementRuleHealth(container, "org-1", "rule-1", "triggered")

      const health = await getRuleHealthSummary(container, "org-1", "rule-1")

      expect(health).not.toBeNull()
      expect(health!.rule_id).toBe("rule-1")
      expect(health!.org_id).toBe("org-1")
      expect(health!.triggered_count).toBe(1)
      expect(health!.overridden_count).toBe(0)
      expect(health!.false_positive_count).toBe(0)
      expect(health!.auto_fixed_count).toBe(0)
      expect(health!.last_triggered_at).toBeDefined()
    })

    it("increments triggered counter correctly", async () => {
      await incrementRuleHealth(container, "org-1", "rule-1", "triggered")
      await incrementRuleHealth(container, "org-1", "rule-1", "triggered")
      await incrementRuleHealth(container, "org-1", "rule-1", "triggered")

      const health = await getRuleHealthSummary(container, "org-1", "rule-1")

      expect(health!.triggered_count).toBe(3)
    })

    it("increments overridden counter correctly", async () => {
      await incrementRuleHealth(container, "org-1", "rule-1", "triggered")
      await incrementRuleHealth(container, "org-1", "rule-1", "overridden")
      await incrementRuleHealth(container, "org-1", "rule-1", "overridden")

      const health = await getRuleHealthSummary(container, "org-1", "rule-1")

      expect(health!.triggered_count).toBe(1)
      expect(health!.overridden_count).toBe(2)
    })

    it("increments false_positive counter correctly", async () => {
      await incrementRuleHealth(container, "org-1", "rule-1", "false_positive")

      const health = await getRuleHealthSummary(container, "org-1", "rule-1")

      expect(health!.false_positive_count).toBe(1)
    })

    it("increments auto_fixed counter correctly", async () => {
      await incrementRuleHealth(container, "org-1", "rule-1", "auto_fixed")

      const health = await getRuleHealthSummary(container, "org-1", "rule-1")

      expect(health!.auto_fixed_count).toBe(1)
    })

    it("sets last_triggered_at only for triggered events", async () => {
      await incrementRuleHealth(container, "org-1", "rule-1", "overridden")

      const health = await getRuleHealthSummary(container, "org-1", "rule-1")

      // overridden event does not set last_triggered_at
      expect(health!.last_triggered_at).toBeNull()
    })
  })
})
