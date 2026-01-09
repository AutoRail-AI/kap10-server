/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { auth } from "@/lib/auth"
import {
  getNotifications,
  getUnreadCount,
  markAllAsRead,
  markAsRead,
} from "@/lib/notifications/manager"
import { GET, HEAD, PATCH } from "../notifications/route"

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

vi.mock("@/lib/notifications/manager", () => ({
  getNotifications: vi.fn(),
  markAsRead: vi.fn(),
  markAllAsRead: vi.fn(),
  getUnreadCount: vi.fn(),
}))

describe("Notifications API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("GET /api/notifications", () => {
    it("should return notifications", async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue({
        user: { id: "user-123" },
      } as any)

      const mockNotifications = [
        {
          _id: "notif-1",
          title: "Test",
          message: "Test message",
          read: false,
        },
      ]

      vi.mocked(getNotifications).mockResolvedValue(mockNotifications as any)

      const request = new Request("http://localhost/api/notifications")
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toHaveLength(1)
    })

    it("should filter unread notifications", async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue({
        user: { id: "user-123" },
      } as any)

      const request = new Request(
        "http://localhost/api/notifications?unreadOnly=true"
      )
      await GET(request)

      expect(getNotifications).toHaveBeenCalledWith(
        "user-123",
        expect.objectContaining({ unreadOnly: true })
      )
    })
  })

  describe("PATCH /api/notifications", () => {
    it("should mark notification as read", async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue({
        user: { id: "user-123" },
      } as any)

      vi.mocked(markAsRead).mockResolvedValue()

      const request = new Request("http://localhost/api/notifications", {
        method: "PATCH",
        body: JSON.stringify({ notificationId: "notif-123" }),
      })

      const response = await PATCH(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(markAsRead).toHaveBeenCalledWith("notif-123", "user-123")
    })

    it("should mark all as read", async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue({
        user: { id: "user-123" },
      } as any)

      vi.mocked(markAllAsRead).mockResolvedValue()

      const request = new Request("http://localhost/api/notifications", {
        method: "PATCH",
        body: JSON.stringify({ markAll: true }),
      })

      const response = await PATCH(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(markAllAsRead).toHaveBeenCalled()
    })
  })

  describe("HEAD /api/notifications", () => {
    it("should return unread count", async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue({
        user: { id: "user-123" },
      } as any)

      vi.mocked(getUnreadCount).mockResolvedValue(5)

      const request = new Request("http://localhost/api/notifications")
      const response = await HEAD(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.count).toBe(5)
    })
  })
})

