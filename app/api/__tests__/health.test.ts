import { describe, expect, it } from "vitest"
import { GET } from "../health/route"

describe("Health Check API", () => {
  it("should return 200 with health status", async () => {
    const request = new Request("http://localhost/api/health")
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty("status")
    expect(data.status).toBe("ok")
  })
})

