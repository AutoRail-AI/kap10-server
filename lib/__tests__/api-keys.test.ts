/* eslint-disable @typescript-eslint/no-unused-vars */
import mongoose from "mongoose"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  createApiKey,
  generateApiKey,
  hashApiKey,
  listApiKeys,
  revokeApiKey,
  verifyApiKey,
} from "../api-keys/manager"
import { connectDB } from "../db/mongoose"

// Mock mongoose
vi.mock("../db/mongoose", () => ({
  connectDB: vi.fn(),
}))

describe("API Keys Manager", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("generateApiKey", () => {
    it("should generate API key with default prefix", () => {
      const key = generateApiKey()
      expect(key).toMatch(/^sk_live_/)
      expect(key.length).toBeGreaterThan(20)
    })

    it("should generate API key with custom prefix", () => {
      const key = generateApiKey("sk_test")
      expect(key).toMatch(/^sk_test_/)
    })
  })

  describe("hashApiKey", () => {
    it("should hash API key consistently", () => {
      const key = "sk_live_test123"
      const hash1 = hashApiKey(key)
      const hash2 = hashApiKey(key)
      expect(hash1).toBe(hash2)
      expect(hash1).toHaveLength(64) // SHA-256 hex length
    })

    it("should produce different hashes for different keys", () => {
      const hash1 = hashApiKey("sk_live_key1")
      const hash2 = hashApiKey("sk_live_key2")
      expect(hash1).not.toBe(hash2)
    })
  })

  describe("createApiKey", () => {
    it("should create API key with required fields", async () => {
      const mockApiKey = {
        _id: new mongoose.Types.ObjectId(),
        userId: "user-123",
        name: "Test Key",
        key: "hashed-key",
        keyPrefix: "sk_live_ab",
        scopes: ["read", "write"],
        enabled: true,
        createdAt: new Date(),
        save: vi.fn(),
      }

      const ApiKey = {
        create: vi.fn().mockResolvedValue(mockApiKey),
      }

      vi.doMock("mongoose", () => ({
        default: {
          models: { ApiKey },
          model: vi.fn(),
        },
      }))

      const result = await createApiKey("user-123", "Test Key", {
        scopes: ["read", "write"],
      })

      expect(result.apiKey).toBeDefined()
      expect(result.plainKey).toMatch(/^sk_live_/)
    })
  })
})

