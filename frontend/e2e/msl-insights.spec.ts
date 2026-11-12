import { expect, test, type Page } from "@playwright/test"

async function signInAsMsl(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem("a2g.local.userId", "u-msl-ne-01"))
}

async function openInsightsFromNavigation(page: Page) {
  const menu = page.getByTestId("sidebar-menu")
  if (await menu.isVisible()) {
    await menu.click()
    await page.getByRole("dialog", { name: "Navigation" }).getByRole("link", { name: "Insights" }).click()
    return
  }
  await page.getByRole("link", { name: "Insights" }).click()
}

test.describe("MSL Insights", () => {
  test.beforeEach(async ({ page }) => signInAsMsl(page))

  test("opens from the sidebar and lists source-recorded responses", async ({ page }) => {
    await page.goto("/msl")
    await openInsightsFromNavigation(page)
    await expect(page).toHaveURL(/\/msl\/insights$/)
    await expect(page.getByRole("heading", { level: 1, name: "Insights" })).toBeVisible()
    await expect(page.getByTestId("insight-response-table")).toBeVisible()
    await expect(page.getByTestId("insight-response-count")).toContainText("source-recorded responses")
  })

  test("filters by Theme, HCP and Molecule then opens the response Interaction", async ({ page }) => {
    await page.goto("/msl/insights")
    await page.getByTestId("insight-theme-filter").click()
    await page.getByRole("option", { name: "Access and reimbursement" }).click()
    await expect(page.getByTestId("insight-response-count")).toContainText("1 source-recorded response")
    await page.getByTestId("insight-response-open").click()
    await expect(page.getByTestId("insight-response-drawer")).toContainText("Long-term outcomes and access considerations")
    await expect(page.getByTestId("insight-response-drawer")).toContainText("Interaction date")
    await expect(page.getByTestId("insight-response-drawer")).toContainText("INSIGHT-LIST-1")
  })

  test("does not render the MSL response list for another persona", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("a2g.local.userId", "u-dir-ne"))
    await page.goto("/msl/insights")
    await expect(page.getByTestId("role-gate")).toBeVisible()
    await expect(page.getByTestId("insight-response-table")).toHaveCount(0)
  })
})
