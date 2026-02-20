/**
 * E2E — GitHub App Install Flow (P1-TEST-10)
 *
 * Tests the GitHub connection flow as far as possible without a real GitHub App.
 * Full authenticated flow requires test auth helper (skipped in CI).
 */
import { expect, test } from "@playwright/test"

test.describe("GitHub Connect Flow", () => {
  test("install redirect requires authentication", async ({ request }) => {
    // GET /api/github/install without a session should return 401 or redirect to login
    const response = await request.get("/api/github/install", {
      maxRedirects: 0,
    })
    // Should be 401 (unauthorized) or 302 (redirect to login)
    expect([401, 302, 307]).toContain(response.status())
  })

  test("callback rejects requests without state parameter", async ({ request }) => {
    const response = await request.get("/api/github/callback")
    // Missing installation_id and state → should fail
    expect([400, 302, 307]).toContain(response.status())
  })

  test("callback rejects invalid state parameter", async ({ request }) => {
    const response = await request.get(
      "/api/github/callback?installation_id=123&setup_action=install&state=invalid-state-token",
      { maxRedirects: 0 }
    )
    // Invalid state → should reject (redirect with error or 403)
    expect([302, 307, 400, 403]).toContain(response.status())
  })

  test.describe("Authenticated flow", () => {
    test.skip(true, "Requires authenticated session — skipped until test auth helper is implemented")

    test("Connect GitHub button visible on empty dashboard", async ({ page }) => {
      await page.goto("/")
      // Look for Connect GitHub button or link in empty state
      const connectBtn = page.getByRole("link", { name: /connect github/i }).or(
        page.getByRole("button", { name: /connect github/i })
      )
      await expect(connectBtn).toBeVisible()
    })

    test("Connect GitHub redirects to GitHub App install page", async ({ page }) => {
      await page.goto("/")
      const connectBtn = page.getByRole("link", { name: /connect github/i }).or(
        page.getByRole("button", { name: /connect github/i })
      )
      // Click should navigate to GitHub
      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/github/install")),
        connectBtn.click(),
      ])
      expect(response.status()).toBe(302)
    })

    test("After connection, repos are listed on dashboard", async ({ page }) => {
      // Simulate: user has connected GitHub and has repos
      await page.goto("/")
      // Should see repo cards (not the empty state)
      const repoCards = page.locator("[data-testid=repo-card]").or(
        page.locator(".repo-card")
      )
      // At least one repo should be visible after connection
      await expect(repoCards.first()).toBeVisible()
    })
  })
})
