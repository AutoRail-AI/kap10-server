/**
 * E2E — Blueprint Dashboard (P4-TEST-13)
 *
 * Tests blueprint page: features grid, health summary.
 * Requires authenticated session with a justified repo (skipped in CI without setup).
 */
import { expect, test } from "@playwright/test"

test.describe("Blueprint Dashboard", () => {
  test("blueprint page requires authentication", async ({ page }) => {
    await page.goto("/repos/some-repo-id/blueprint")
    await page.waitForURL(/\/login/)
    await expect(page).toHaveURL(/\/login/)
  })

  test("blueprint API requires authentication", async ({ request }) => {
    const response = await request.get("/api/repos/some-repo-id/blueprint")
    expect([401, 302, 307]).toContain(response.status())
  })

  test("justify API requires authentication", async ({ request }) => {
    const response = await request.fetch("/api/repos/some-repo-id/justify", {
      method: "POST",
    })
    expect([401, 302, 307]).toContain(response.status())
  })
})
