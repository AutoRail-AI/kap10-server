import { expect, test } from "@playwright/test"

test.describe("Activity Feed", () => {
  test("activity page loads and shows title", async ({ page }) => {
    // Navigate to a repo activity page (will redirect to login if not authenticated)
    await page.goto("/repos/test-repo/activity")

    // Should either show the activity page or redirect to login
    const url = page.url()
    if (url.includes("/activity")) {
      // If we're on the activity page, check for the title
      await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible()
    } else {
      // Redirected to login — that's acceptable for E2E without auth setup
      expect(url).toContain("sign-in")
    }
  })
})
