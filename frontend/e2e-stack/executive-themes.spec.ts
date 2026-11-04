import { readFileSync } from "node:fs"
import path from "node:path"
import { expect, test, type Page } from "@playwright/test"

const outputs = JSON.parse(readFileSync(path.join(__dirname, "..", "amplify_outputs.json"), "utf8"))
const a2g = outputs.custom.a2g as { local_password: string; seeded_users: { userId: string; email: string }[] }
const email = (id: string) => a2g.seeded_users.find((u) => u.userId === id)!.email

async function signInExecutive(page: Page) {
  await page.goto("/login")
  await page.getByTestId("login-email").fill(email("executive-region-01"))
  await page.getByTestId("login-password").fill(a2g.local_password)
  await page.getByTestId("login-submit").click()
  await expect(page).toHaveURL(/\/executive$/)
}

test("an Executive opens Themes on the real stack: aggregate cards, the matrix with approved thresholds, and nothing withheld shows a number", async ({ page }) => {
  await signInExecutive(page)
  await page.goto("/executive/themes")
  await expect(page.getByTestId("executive-themes")).toBeVisible({ timeout: 45_000 })
  await expect(page.getByTestId("access-banner")).toHaveAttribute("data-level", "AGGREGATE_ONLY")
  const card = page.getByTestId("theme-card").first()
  await expect(card.getByTestId("trend")).toBeVisible()
  await expect(card.getByTestId("source-chip")).toBeVisible()
  await expect(page.getByTestId("topic-matrix")).toBeVisible({ timeout: 45_000 })
  await expect(page.getByTestId("th-mincell")).toBeVisible()
  for (const el of await page.locator('[data-suppressed="true"]').all()) await expect(el).not.toHaveText(/^\s*[1-4]\s*$/)
})

test("an Executive generates a leadership summary through the agent, then exports it", async ({ page }) => {
  await signInExecutive(page)
  await page.goto("/executive/themes")
  await expect(page.getByTestId("leadership-summaries")).toBeVisible({ timeout: 45_000 })
  await page.getByTestId("generate-leadership-summary").click()
  const summary = page.getByTestId("leadership-summary").first()
  await expect(summary).toBeVisible({ timeout: 120_000 })
  await expect(summary.getByTestId("summary-statement").first()).toBeVisible()
  await expect(summary.getByTestId("summary-range")).toBeVisible()
  await summary.getByTestId("export-summary").click()
  await expect(page.getByTestId("export-sheet")).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId("leadership-print-document")).toBeAttached()
})
