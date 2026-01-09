/* eslint-disable @typescript-eslint/no-unused-vars */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { connectDB } from "../db/mongoose"
import {
  createTemplate,
  getTemplate,
  getTemplates,
  useTemplate,
} from "../templates/manager"

vi.mock("../db/mongoose", () => ({
  connectDB: vi.fn(),
}))

describe("Templates Manager", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("createTemplate", () => {
    it("should create template with required fields", async () => {
      const mockTemplate = {
        _id: "template-123",
        name: "Test Template",
        type: "prompt" as const,
        content: { prompt: "Test prompt" },
        public: false,
        featured: false,
        usageCount: 0,
        createdAt: new Date(),
        save: vi.fn(),
      }

      const Template = {
        create: vi.fn().mockResolvedValue(mockTemplate),
      }

      vi.doMock("mongoose", () => ({
        default: {
          models: { Template },
          model: vi.fn(),
        },
      }))

      const result = await createTemplate({
        name: "Test Template",
        type: "prompt",
        content: { prompt: "Test prompt" },
      })

      expect(result).toBeDefined()
      expect(Template.create).toHaveBeenCalled()
    })
  })

  describe("getTemplates", () => {
    it("should filter by type", async () => {
      const mockTemplates = [
        {
          _id: "template-1",
          type: "prompt",
          public: true,
        },
      ]

      const Template = {
        find: vi.fn().mockReturnValue({
          sort: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(mockTemplates),
          }),
        }),
      }

      vi.doMock("mongoose", () => ({
        default: {
          models: { Template },
          model: vi.fn(),
        },
      }))

      const _result = await getTemplates({
        type: "prompt",
        publicOnly: true,
      })

      expect(Template.find).toHaveBeenCalledWith(
        expect.objectContaining({ type: "prompt", public: true })
      )
    })
  })

  describe("useTemplate", () => {
    it("should increment usage count", async () => {
      const Template = {
        findByIdAndUpdate: vi.fn().mockResolvedValue({}),
      }

      vi.doMock("mongoose", () => ({
        default: {
          models: { Template },
          model: vi.fn(),
        },
      }))

      await useTemplate("template-123")

      expect(Template.findByIdAndUpdate).toHaveBeenCalledWith(
        "template-123",
        { $inc: { usageCount: 1 } }
      )
    })
  })
})

