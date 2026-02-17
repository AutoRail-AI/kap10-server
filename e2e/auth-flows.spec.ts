import { expect, test } from "@playwright/test"

test.describe("Unauthenticated user flows", () => {
  test("redirects / to /login when not authenticated", async ({ page }) => {
    await page.goto("/")
    await page.waitForURL(/\/login/)
    await expect(page).toHaveURL(/\/login/)
  })

  test("login page renders with expected elements", async ({ page }) => {
    await page.goto("/login")
    // Should have email input, password input, and submit button
    await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"], input[name="password"]')).toBeVisible()
    await expect(page.getByRole("button", { name: /sign in|log in|continue/i })).toBeVisible()
  })

  test("register page renders with expected elements", async ({ page }) => {
    await page.goto("/register")
    await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"], input[name="password"]')).toBeVisible()
    await expect(page.getByRole("button", { name: /sign up|register|create/i })).toBeVisible()
  })

  test("login page has link to register", async ({ page }) => {
    await page.goto("/login")
    const registerLink = page.getByRole("link", { name: /sign up|register|create account/i })
    await expect(registerLink).toBeVisible()
  })

  test("protected routes redirect to login", async ({ page }) => {
    await page.goto("/settings")
    await page.waitForURL(/\/login/)
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe("Settings page", () => {
  test.skip(true, "Requires authenticated session — skipped in CI until test auth helper is implemented")

  test("settings page loads with expected sections", async ({ page }) => {
    await page.goto("/settings")
    await expect(page.getByText(/settings/i)).toBeVisible()
  })
})
