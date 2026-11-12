import { expect, test } from "@playwright/test"

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("a2g.local.userId", "u-admin-sec"))
})

test("Administrator reviews source-level ingestion runs", async ({ page }) => {
  await page.goto("/admin/ingestion")
  await expect(page.getByRole("heading", { level: 1, name: "Ingestion runs" })).toBeVisible()
  const workspace = page.getByTestId("admin-ingestion-runs")
  await expect(workspace).toContainText("Call Activity")
  await expect(workspace).toContainText("Load date")
  await expect(workspace).toContainText("Data through")
  await expect(workspace).toContainText("Synthetic source delivery failure")
})

test("non-Administrators cannot view ingestion metadata", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("a2g.local.userId", "u-msl-ne-01"))
  await page.goto("/admin/ingestion")
  await expect(page.getByTestId("role-gate")).toBeVisible()
  await expect(page.getByTestId("admin-ingestion-runs")).toHaveCount(0)
})
