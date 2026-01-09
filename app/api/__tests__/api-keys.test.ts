/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from "@/lib/api-keys/manager"
import { auth } from "@/lib/auth"
import { DELETE, GET, POST } from "../api-keys/route"

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-keys/manager", () => ({
  createApiKey: vi.fn(),
  listApiKeys: vi.fn(),
  revokeApiKey: vi.fn(),
}))

describe("API Keys API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("GET /api/api-keys", () => {
    it("should return 401 if not authenticated", async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(null)

      const request = new Request("http://localhost/api/api-keys")
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe("Unauthorized")
    })

    it("should return API keys for authenticated user", async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue({
        user: { id: "user-123" },
      } as any)

      const mockKeys = [
        {
          _id: { toString: () => "key-1" },
          name: "Test Key",
          keyPrefix: "sk_live_ab",
          enabled: true,
          createdAt: new Date(),
        },
      ]

      vi.mocked(listApiKeys).mockResolvedValue(mockKeys as any)

      const request = new Request("http://localhost/api/api-keys")
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toHaveLength(1)
      expect(data[0].name).toBe("Test Key")
      expect(data[0].keyPrefix).toBe("sk_live_ab")
      expect(data[0].key).toBeUndefined() // Should not expose full key
    })
  })

  describe("POST /api/api-keys", () => {
    it("should create API key", async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue({
        user: { id: "user-123" },
      } as any)

      const mockApiKey = {
        _id: { toString: () => "key-1" },
        name: "New Key",
        keyPrefix: "sk_live_ab",
        scopes: ["read", "write"],
        createdAt: new Date(),
      }

      vi.mocked(createApiKey).mockResolvedValue({
        apiKey: mockApiKey as any,
        plainKey: "sk_live_abcdef123456",
      })

      const request = new Request("http://localhost/api/api-keys", {
        method: "POST",
        body: JSON.stringify({
          name: "New Key",
          scopes: ["read", "write"],
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.key).toBe("sk_live_abcdef123456") // Plain key returned once
      expect(data.name).toBe("New Key")
    })

    it("should return 400 if name is missing", async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue({
        user: { id: "user-123" },
      } as any)

      const request = new Request("http://localhost/api/api-keys", {
        method: "POST",
        body: JSON.stringify({}),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe("Name is required")
    })
  })

  describe("DELETE /api/api-keys", () => {
    it("should revoke API key", async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue({
        user: { id: "user-123" },
      } as any)

      vi.mocked(revokeApiKey).mockResolvedValue()

      const request = new Request("http://localhost/api/api-keys?id=key-123", {
        method: "DELETE",
      })

      const response = await DELETE(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(revokeApiKey).toHaveBeenCalledWith("key-123", "user-123")
    })
  })
})

