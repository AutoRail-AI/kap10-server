/* eslint-disable @typescript-eslint/no-unused-vars */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { connectDB } from "../db/mongoose"
import { checkQuota, getUsageStats, trackUsage } from "../usage/tracker"

vi.mock("../db/mongoose", () => ({
  connectDB: vi.fn(),
}))

describe("Usage Tracker", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("trackUsage", () => {
    it("should track usage with all required fields", async () => {
      const mockUsage = {
        userId: "user-123",
        type: "api_call" as const,
        resource: "ai.agent",
        quantity: 1,
        timestamp: new Date(),
        save: vi.fn(),
      }

      const Usage = {
        create: vi.fn().mockResolvedValue(mockUsage),
      }

      vi.doMock("mongoose", () => ({
        default: {
          models: { Usage },
          model: vi.fn(),
        },
      }))

      await trackUsage({
        userId: "user-123",
        type: "api_call",
        resource: "ai.agent",
        quantity: 1,
      })

      expect(Usage.create).toHaveBeenCalled()
    })

    it("should track usage with cost", async () => {
      const mockUsage = {
        userId: "user-123",
        type: "ai_request" as const,
        resource: "openai.gpt-4",
        quantity: 1000,
        cost: 10,
        timestamp: new Date(),
        save: vi.fn(),
      }

      const Usage = {
        create: vi.fn().mockResolvedValue(mockUsage),
      }

      vi.doMock("mongoose", () => ({
        default: {
          models: { Usage },
          model: vi.fn(),
        },
      }))

      await trackUsage({
        userId: "user-123",
        type: "ai_request",
        resource: "openai.gpt-4",
        quantity: 1000,
        cost: 10,
      })

      expect(Usage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          cost: 10,
        })
      )
    })
  })

  describe("checkQuota", () => {
    it("should allow request when under quota", async () => {
      const mockAggregate = vi.fn().mockResolvedValue([])

      const Usage = {
        aggregate: mockAggregate,
      }

      vi.doMock("mongoose", () => ({
        default: {
          models: { Usage },
          model: vi.fn(),
        },
      }))

      const result = await checkQuota(
        "user-123",
        undefined,
        {
          limit: 1000,
          windowMs: 86400000,
          type: "api_call",
        }
      )

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(1000)
    })

    it("should deny request when over quota", async () => {
      const mockAggregate = vi.fn().mockResolvedValue([
        { total: 1000 },
      ])

      const Usage = {
        aggregate: mockAggregate,
      }

      vi.doMock("mongoose", () => ({
        default: {
          models: { Usage },
          model: vi.fn(),
        },
      }))

      const result = await checkQuota(
        "user-123",
        undefined,
        {
          limit: 1000,
          windowMs: 86400000,
          type: "api_call",
        }
      )

      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
    })
  })
})

