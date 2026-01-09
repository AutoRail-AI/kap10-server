import { afterAll, beforeAll, beforeEach, vi } from "vitest"

// Mock MongoDB connection for tests
beforeAll(async () => {
  // Set up test environment
  process.env.MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/test"
})

afterAll(async () => {
  // Clean up if needed
})

beforeEach(() => {
  // Clear mocks between tests
  vi.clearAllMocks()
})

