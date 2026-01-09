/* eslint-disable @typescript-eslint/no-unused-vars */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { connectDB } from "../db/mongoose"
import {
  indexDocument,
  removeFromIndex,
  search,
  simpleSearch,
} from "../search/engine"

vi.mock("../db/mongoose", () => ({
  connectDB: vi.fn(),
}))

describe("Search Engine", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("indexDocument", () => {
    it("should index document", async () => {
      const mockIndex = {
        _id: "index-123",
        resource: "project",
        resourceId: "project-123",
        title: "Test Project",
        content: "Test content",
        createdAt: new Date(),
        save: vi.fn(),
      }

      const SearchIndex = {
        findOneAndUpdate: vi.fn().mockResolvedValue(mockIndex),
      }

      vi.doMock("mongoose", () => ({
        default: {
          models: { SearchIndex },
          model: vi.fn(),
        },
      }))

      const result = await indexDocument({
        resource: "project",
        resourceId: "project-123",
        title: "Test Project",
        content: "Test content",
      })

      expect(result).toBeDefined()
      expect(SearchIndex.findOneAndUpdate).toHaveBeenCalled()
    })
  })

  describe("search", () => {
    it("should search with text index", async () => {
      const mockResults = [
        {
          _id: "index-1",
          title: "Test Project",
          content: "Test content",
        },
      ]

      const SearchIndex = {
        find: vi.fn().mockReturnValue({
          sort: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(mockResults),
          }),
        }),
      }

      vi.doMock("mongoose", () => ({
        default: {
          models: { SearchIndex },
          model: vi.fn(),
        },
      }))

      const _results = await search("test", {
        organizationId: "org-123",
      })

      expect(SearchIndex.find).toHaveBeenCalled()
    })
  })

  describe("simpleSearch", () => {
    it("should fallback to regex search", async () => {
      const mockResults = [
        {
          _id: "index-1",
          title: "Test Project",
        },
      ]

      const SearchIndex = {
        find: vi.fn().mockReturnValue({
          sort: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(mockResults),
          }),
        }),
      }

      vi.doMock("mongoose", () => ({
        default: {
          models: { SearchIndex },
          model: vi.fn(),
        },
      }))

      const _results = await simpleSearch("test", {
        organizationId: "org-123",
      })

      expect(SearchIndex.find).toHaveBeenCalled()
    })
  })
})

