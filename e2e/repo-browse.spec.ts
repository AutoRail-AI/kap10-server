/**
 * E2E — Browse Indexed Repository (P1-TEST-12)
 *
 * Tests the repo detail page: file tree, entity list, entity detail.
 * Requires authenticated session with an indexed repo (skipped in CI).
 */
import { expect, test } from "@playwright/test"

test.describe("Browse Indexed Repository", () => {
  test("repo detail page requires authentication", async ({ page }) => {
    await page.goto("/repos/some-repo-id")
    // Should redirect to login for unauthenticated users
    await page.waitForURL(/\/login/)
    await expect(page).toHaveURL(/\/login/)
  })

  test("tree API requires authentication", async ({ request }) => {
    const response = await request.get("/api/repos/some-repo-id/tree")
    expect([401, 302, 307]).toContain(response.status())
  })

  test("entities API requires authentication", async ({ request }) => {
    const response = await request.get("/api/repos/some-repo-id/entities?file=src/index.ts")
    expect([401, 302, 307]).toContain(response.status())
  })

  test("entity detail API requires authentication", async ({ request }) => {
    const response = await request.get("/api/repos/some-repo-id/entities/some-entity-id")
    expect([401, 302, 307]).toContain(response.status())
  })

  test.describe("Authenticated flow", () => {
    test.skip(true, "Requires authenticated session with indexed repo — skipped until test auth helper is implemented")

    test("repo detail page shows file tree", async ({ page }) => {
      // Navigate to an indexed repo
      await page.goto("/repos/test-repo-id")
      // File tree panel should be visible
      const fileTreePanel = page.getByText(/files/i).first()
      await expect(fileTreePanel).toBeVisible()
    })

    test("clicking a file shows entities", async ({ page }) => {
      await page.goto("/repos/test-repo-id")
      // Click on a file in the tree
      const fileNode = page.locator("button").filter({ hasText: /\.ts$/ }).first()
      await fileNode.click()

      // Entity list should appear
      const entitiesPanel = page.getByText(/entities/i)
      await expect(entitiesPanel).toBeVisible()
    })

    test("clicking a directory expands it", async ({ page }) => {
      await page.goto("/repos/test-repo-id")
      // Click on a directory node (has folder icon or chevron)
      const dirNode = page.locator("button").filter({ hasText: "src" }).first()
      await dirNode.click()

      // Children should be visible
      const childNodes = dirNode.locator("..").locator("ul li")
      await expect(childNodes.first()).toBeVisible()
    })

    test("clicking an entity shows detail panel with callers and callees", async ({ page }) => {
      await page.goto("/repos/test-repo-id")
      // Click a file first
      const fileNode = page.locator("button").filter({ hasText: /\.ts$/ }).first()
      await fileNode.click()

      // Click on an entity
      const entityBtn = page.locator("button").filter({ hasText: /function|class/i }).first()
      await entityBtn.click()

      // Detail panel should show entity info
      const detailPanel = page.getByText(/detail/i)
      await expect(detailPanel).toBeVisible()
    })
  })
})
