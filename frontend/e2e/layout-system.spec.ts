import { expect, test } from "@playwright/test"

test("MSL promotes its dashboard regions to twelve tracks when an iPad has a 1024px-wide workspace", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1366 })
  await page.goto("/msl")
  await expect(page.getByTestId("kpi-calls")).toBeVisible()

  const columns = await page.getByTestId("dashboard-grid").first().evaluate((element) => getComputedStyle(element).gridTemplateColumns)
  expect(columns.trim().split(/\s+/)).toHaveLength(12)
})

test("administrator supporting panels use the same 7/5 workspace split at iPad landscape", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 1024 })
  await page.addInitScript(() => window.localStorage.setItem("a2g.local.userId", "u-admin-sec"))
  await page.goto("/admin/governance")
  await expect(page.getByTestId("hierarchy-tree")).toBeVisible()

  const grid = page.getByTestId("dashboard-grid").first()
  const columns = await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns)
  expect(columns.trim().split(/\s+/)).toHaveLength(12)

  const areas = await grid.locator(".a2g-dashboard-item").evaluateAll((items) =>
    items.map((item) => getComputedStyle(item).gridColumn),
  )
  expect(areas).toEqual(["span 7", "span 5"])
})
