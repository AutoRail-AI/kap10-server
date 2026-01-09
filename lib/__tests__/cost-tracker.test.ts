/* eslint-disable @typescript-eslint/no-unused-vars */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { calculateCost, getCostSummary, trackCost } from "../cost/tracker"
import { connectDB } from "../db/mongoose"

vi.mock("../db/mongoose", () => ({
  connectDB: vi.fn(),
}))

describe("Cost Tracker", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("calculateCost", () => {
    it("should calculate cost for OpenAI GPT-4", () => {
      const cost = calculateCost("openai", "gpt-4-turbo-preview", 1000, 500)
      expect(cost).toBeGreaterThan(0)
    })

    it("should calculate cost for Anthropic Claude", () => {
      const cost = calculateCost("anthropic", "claude-3-sonnet", 1000, 500)
      expect(cost).toBeGreaterThan(0)
    })

    it("should return 0 for unknown provider/model", () => {
      const cost = calculateCost("unknown", "unknown-model", 1000, 500)
      expect(cost).toBe(0)
    })

    it("should handle zero tokens", () => {
      const cost = calculateCost("openai", "gpt-4-turbo-preview", 0, 0)
      expect(cost).toBe(0)
    })
  })

  describe("trackCost", () => {
    it("should track cost with all fields", async () => {
      const mockCost = {
        _id: "cost-123",
        userId: "user-123",
        provider: "openai",
        model: "gpt-4-turbo-preview",
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cost: 25,
        timestamp: new Date(),
        save: vi.fn(),
      }

      const Cost = {
        create: vi.fn().mockResolvedValue(mockCost),
      }

      vi.doMock("mongoose", () => ({
        default: {
          models: { Cost },
          model: vi.fn(),
        },
      }))

      const result = await trackCost({
        userId: "user-123",
        provider: "openai",
        model: "gpt-4-turbo-preview",
        inputTokens: 1000,
        outputTokens: 500,
      })

      expect(result).toBeDefined()
      expect(Cost.create).toHaveBeenCalled()
    })
  })

  describe("getCostSummary", () => {
    it("should aggregate costs correctly", async () => {
      const mockCosts = [
        {
          provider: "openai",
          model: "gpt-4",
          cost: 10,
          totalTokens: 1000,
        },
        {
          provider: "openai",
          model: "gpt-4",
          cost: 15,
          totalTokens: 1500,
        },
      ]

      const Cost = {
        find: vi.fn().mockResolvedValue(mockCosts),
      }

      vi.doMock("mongoose", () => ({
        default: {
          models: { Cost },
          model: vi.fn(),
        },
      }))

      const summary = await getCostSummary({
        userId: "user-123",
      })

      expect(summary.totalCost).toBe(25)
      expect(summary.totalTokens).toBe(2500)
    })
  })
})

