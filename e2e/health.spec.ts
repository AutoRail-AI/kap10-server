import { expect, test } from "@playwright/test"

test.describe("Health API", () => {
  test("GET /api/health returns JSON with status", async ({ request }) => {
    const response = await request.get("/api/health")
    expect([200, 503]).toContain(response.status())

    const body = await response.json()
    expect(body).toHaveProperty("status")
    expect(body).toHaveProperty("timestamp")
    expect(body).toHaveProperty("checks")
  })
})
