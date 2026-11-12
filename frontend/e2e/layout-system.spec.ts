import { expect, test } from "@playwright/test"

test("MSL promotes its dashboard regions to twelve tracks when an iPad has a 1024px-wide workspace", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1366 })
  await page.goto("/msl")
  await expect(page.getByTestId("kpi-calls")).toBeVisible()

  const columns = await page.getByTestId("dashboard-grid").first().evaluate((element) => getComputedStyle(element).gridTemplateColumns)
  expect(columns.trim().split(/\s+/)).toHaveLength(12)
})
