 
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  createActivity,
  getActivityFeed,
} from "../activity/feed"

vi.mock("../db/mongoose", () => ({
  connectDB: vi.fn(),
}))

describe("Activity Feed", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("createActivity", () => {
    it("should create activity", async () => {
      const mockActivity = {
        _id: "activity-123",
        organizationId: "org-123",
        type: "project.created" as const,
        action: "created a project",
        resource: "project",
        createdAt: new Date(),
        save: vi.fn(),
      }

      const Activity = {
        create: vi.fn().mockResolvedValue(mockActivity),
      }

      vi.doMock("mongoose", () => ({
        default: {
          models: { Activity },
          model: vi.fn(),
        },
      }))

      const _result = await createActivity({
        organizationId: "org-123",
        type: "project.created",
        action: "created a project",
        resource: "project",
      })

      expect(_result).toBeDefined()
      expect(Activity.create).toHaveBeenCalled()
    })
  })

  describe("getActivityFeed", () => {
    it("should get activity feed for organization", async () => {
      const mockActivities = [
        {
          _id: "activity-1",
          organizationId: "org-123",
          action: "created a project",
        },
      ]

      const Activity = {
        find: vi.fn().mockReturnValue({
          sort: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(mockActivities),
          }),
        }),
      }

      vi.doMock("mongoose", () => ({
        default: {
          models: { Activity },
          model: vi.fn(),
        },
      }))

      const _result = await getActivityFeed("org-123", {
        limit: 50,
      })

      expect(Activity.find).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org-123" })
      )
    })
  })
})

