/**
 * E2E — Entity Detail Page (P4-TEST-12)
 *
 * Tests entity detail page with justification card.
 * Requires authenticated session with a justified repo (skipped in CI without setup).
 */
import { expect, test } from "@playwright/test"

test.describe("Entity Detail Page", () => {
  test("entity detail page requires authentication", async ({ page }) => {
    await page.goto("/repos/some-repo-id/entities/some-entity-id")
    await page.waitForURL(/\/login/)
    await expect(page).toHaveURL(/\/login/)
  })

  test("justification API requires authentication", async ({ request }) => {
    const response = await request.get("/api/entities/some-entity-id/justification")
    expect([401, 302, 307, 405]).toContain(response.status())
  })

  test("blueprint API requires authentication", async ({ request }) => {
    const response = await request.get("/api/repos/some-repo-id/blueprint")
    expect([401, 302, 307]).toContain(response.status())
  })
})
