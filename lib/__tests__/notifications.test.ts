/* eslint-disable @typescript-eslint/no-unused-vars */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { connectDB } from "../db/mongoose"
import {
  createNotification,
  getNotifications,
  getUnreadCount,
  markAsRead,
} from "../notifications/manager"
import { queueEmail } from "../queue"

vi.mock("../db/mongoose", () => ({
  connectDB: vi.fn(),
}))

vi.mock("../queue", () => ({
  queueEmail: vi.fn(),
}))

describe("Notifications Manager", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("createNotification", () => {
    it("should create notification", async () => {
      const mockNotification = {
        _id: "notif-123",
        userId: "user-123",
        type: "info" as const,
        title: "Test",
        message: "Test message",
        read: false,
        createdAt: new Date(),
        save: vi.fn(),
      }

      const Notification = {
        create: vi.fn().mockResolvedValue(mockNotification),
      }

      vi.doMock("mongoose", () => ({
        default: {
          models: { Notification },
          model: vi.fn(),
        },
      }))

      const result = await createNotification({
        userId: "user-123",
        type: "info",
        title: "Test",
        message: "Test message",
      })

      expect(result).toBeDefined()
      expect(Notification.create).toHaveBeenCalled()
    })

    it("should send email when requested", async () => {
      const mockNotification = {
        _id: "notif-123",
        userId: "user-123",
        type: "info" as const,
        title: "Test",
        message: "Test message",
        read: false,
        createdAt: new Date(),
        save: vi.fn(),
      }

      const Notification = {
        create: vi.fn().mockResolvedValue(mockNotification),
      }

      const prisma = {
        user: {
          findUnique: vi.fn().mockResolvedValue({
            id: "user-123",
            email: "test@example.com",
          }),
        },
      }

      vi.doMock("mongoose", () => ({
        default: {
          models: { Notification },
          model: vi.fn(),
        },
      }))

      vi.doMock("../db/prisma", () => ({
        prisma,
      }))

      await createNotification({
        userId: "user-123",
        type: "info",
        title: "Test",
        message: "Test message",
        sendEmail: true,
      })

      expect(queueEmail).toHaveBeenCalled()
    })
  })

  describe("getNotifications", () => {
    it("should get unread notifications only", async () => {
      const mockNotifications = [
        {
          _id: "notif-1",
          userId: "user-123",
          read: false,
        },
        {
          _id: "notif-2",
          userId: "user-123",
          read: false,
        },
      ]

      const Notification = {
        find: vi.fn().mockReturnValue({
          sort: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(mockNotifications),
          }),
        }),
      }

      vi.doMock("mongoose", () => ({
        default: {
          models: { Notification },
          model: vi.fn(),
        },
      }))

      const _result = await getNotifications("user-123", {
        unreadOnly: true,
      })

      expect(Notification.find).toHaveBeenCalledWith(
        expect.objectContaining({ read: false })
      )
    })
  })
})

