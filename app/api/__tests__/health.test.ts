import { describe, expect, it } from "vitest"
import { GET } from "../health/route"

describe("Health Check API", () => {
  it("should return health status with checks", async () => {
    const request = new Request("http://localhost/api/health")
    const response = await GET(request)
    const data = (await response.json()) as {
      status: string
      timestamp: string
      checks: Record<string, { status: string; latencyMs?: number }>
    }

    expect(["healthy", "degraded", "unhealthy"]).toContain(data.status)
    expect(data).toHaveProperty("timestamp")
    expect(data).toHaveProperty("checks")
    expect(data.checks).toHaveProperty("supabase")
    expect(data.checks).toHaveProperty("arangodb")
    expect(data.checks).toHaveProperty("temporal")
    expect(data.checks).toHaveProperty("redis")
    expect(data.checks).toHaveProperty("langfuse")

    if (data.status === "unhealthy") {
      expect(response.status).toBe(503)
    } else {
      expect(response.status).toBe(200)
    }
  })
})
