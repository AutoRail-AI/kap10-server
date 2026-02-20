/**
 * E2E — Repo Indexing Progress (P1-TEST-11)
 *
 * Tests the repo indexing progress UI.
 * Requires authenticated session with connected repos (skipped in CI).
 */
import { expect, test } from "@playwright/test"

test.describe("Repo Indexing Progress", () => {
  test("status API returns valid shape for unknown repo", async ({ request }) => {
    // Unauthenticated request to a non-existent repo
    const response = await request.get("/api/repos/non-existent-repo-id/status")
    // Should be 401 (unauthenticated) or 404 (not found)
    expect([401, 404, 302, 307]).toContain(response.status())
  })

  test("retry API requires authentication", async ({ request }) => {
    const response = await request.post("/api/repos/non-existent-repo-id/retry")
    expect([401, 302, 307]).toContain(response.status())
  })

  test.describe("Authenticated flow", () => {
    test.skip(true, "Requires authenticated session with indexing repo — skipped until test auth helper is implemented")

    test("repo card shows progress bar when indexing", async ({ page }) => {
      await page.goto("/")
      // Find a repo card that's indexing
      const indexingCard = page.locator("[data-status=indexing]").or(
        page.getByText(/indexing/i).first()
      )
      await expect(indexingCard).toBeVisible()

      // Progress bar should be visible
      const progressBar = page.locator("[role=progressbar]").or(
        page.locator(".progress-bar")
      )
      await expect(progressBar).toBeVisible()
    })

    test("progress updates over time", async ({ page }) => {
      await page.goto("/")
      // Wait for progress to update (polling every 5s)
      const progressText = page.getByText(/%/)
      await expect(progressText).toBeVisible({ timeout: 10000 })
    })

    test("repo card shows Ready badge after indexing completes", async ({ page }) => {
      await page.goto("/")
      // Wait for a repo to finish indexing
      const readyBadge = page.getByText(/ready/i)
      await expect(readyBadge).toBeVisible({ timeout: 60000 })
    })

    test("error state shows retry button", async ({ page }) => {
      await page.goto("/")
      // Find a repo in error state
      const errorCard = page.locator("[data-status=error]")
      if (await errorCard.isVisible()) {
        const retryBtn = errorCard.getByRole("button", { name: /retry/i })
        await expect(retryBtn).toBeVisible()
      }
    })
  })
})
