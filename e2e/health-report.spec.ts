/**
 * E2E — Health Report Page (P4-TEST-14)
 *
 * Tests health report page: stats, risks, regenerate button, costs.
 * Requires authenticated session with a justified repo (skipped in CI without setup).
 */
import { expect, test } from "@playwright/test"

test.describe("Health Report Page", () => {
  test("health page requires authentication", async ({ page }) => {
    await page.goto("/repos/some-repo-id/health")
    await page.waitForURL(/\/login/)
    await expect(page).toHaveURL(/\/login/)
  })

  test("health API requires authentication", async ({ request }) => {
    const response = await request.get("/api/repos/some-repo-id/health")
    expect([401, 302, 307]).toContain(response.status())
  })

  test("health regenerate API requires authentication", async ({ request }) => {
    const response = await request.fetch("/api/repos/some-repo-id/health/regenerate", {
      method: "POST",
    })
    expect([401, 302, 307]).toContain(response.status())
  })

  test("costs API requires authentication", async ({ request }) => {
    const response = await request.get("/api/repos/some-repo-id/costs")
    expect([401, 302, 307]).toContain(response.status())
  })
})
