import { readFileSync } from "node:fs"
import path from "node:path"
import { expect, test } from "@playwright/test"

const outputs = JSON.parse(readFileSync(path.join(__dirname, "..", "amplify_outputs.json"), "utf8"))
const a2g = outputs.custom.a2g as { local_password: string; seeded_users: { userId: string; email: string }[] }
const email = (id: string) => a2g.seeded_users.find((u) => u.userId === id)!.email

test("a Director lands on the real team overview: six descendant territories, no coverage, comparison with one period", async ({ page }) => {
  await page.goto("/login")
  await page.getByTestId("login-email").fill(email("director-region-01"))
  await page.getByTestId("login-password").fill(a2g.local_password)
  await page.getByTestId("login-submit").click()
  await expect(page).toHaveURL(/\/director$/)

  await expect(page.getByTestId("director-overview")).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId("scope-label").first()).toContainText("REGION-01")
  await expect(page.getByTestId("territory-row")).toHaveCount(6)
  for (const territory of ["T01-01", "T01-06"]) await expect(page.locator(`[data-testid="territory-row"][data-territory="${territory}"]`)).toBeVisible()
  await expect(page.locator('[data-testid="territory-row"][data-territory="T02-01"]')).toHaveCount(0)
  await expect(page.getByTestId("coverage-withheld")).toBeVisible()
  await expect(page.getByTestId("kpi-rows")).toContainText("Not calls")
  await expect(page.getByTestId("team-heatmap")).toBeVisible()

  await page.getByTestId("compare-toggle").nth(0).click()
  await page.getByTestId("compare-toggle").nth(1).click()
  await expect(page.getByTestId("compare-basis")).toContainText("Same period for every territory")
  await expect(page.getByTestId("compare-row")).toHaveCount(2)
})
