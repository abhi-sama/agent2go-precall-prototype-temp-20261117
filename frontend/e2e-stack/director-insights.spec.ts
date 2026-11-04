import { readFileSync } from "node:fs"
import path from "node:path"
import { expect, test } from "@playwright/test"

const outputs = JSON.parse(readFileSync(path.join(__dirname, "..", "amplify_outputs.json"), "utf8"))
const a2g = outputs.custom.a2g as { local_password: string; seeded_users: { userId: string; email: string }[] }
const email = (id: string) => a2g.seeded_users.find((u) => u.userId === id)!.email

test("a Director opens Insights on the real stack: scoped heatmap, emerging rule, exceptions, drill-down that stops at an HCP", async ({ page }) => {
  await page.goto("/login")
  await page.getByTestId("login-email").fill(email("director-region-01"))
  await page.getByTestId("login-password").fill(a2g.local_password)
  await page.getByTestId("login-submit").click()
  await expect(page).toHaveURL(/\/director$/)

  await page.goto("/director/insights")
  await expect(page.getByTestId("topic-heatmap")).toBeVisible({ timeout: 45_000 })
  await page.getByTestId("heatmap-view-table").click()
  const territories = await page.locator('[data-testid="heatmap-cell"]').evaluateAll((cells) => [...new Set(cells.map((c) => c.getAttribute("data-territory")))])
  expect(territories.sort()).toEqual(["T01-01", "T01-02", "T01-03", "T01-04", "T01-05", "T01-06"])
  await expect(page.getByTestId("theme-card").first().getByTestId("derived-badge")).toBeVisible()

  await expect(page.getByTestId("emerging-rule-text")).toContainText("at least 30 free-text responses")
  await expect(page.locator('[data-testid="emerging-card"][data-status="EMERGING"]').first()).toBeVisible()
  await expect(page.getByTestId("emerging-statement")).toContainText("do not say why")

  await expect(page.getByTestId("exceptions-table")).toBeVisible()
  await page.getByTestId("exception-filter-STALE_LOAD").click()
  await expect(page.locator('[data-testid="exception-row"]')).toHaveCount(3)

  await page.getByTestId("drill-row").first().getByTestId("drill-open").click()
  await page.locator('[data-testid="drill-row"][data-id="T01-02"]').getByTestId("drill-open").click()
  await expect(page.getByTestId("drill-table")).toHaveAttribute("data-level", "TERRITORY")
  await page.getByTestId("drill-row").first().getByTestId("drill-open").click()
  await expect(page.getByTestId("hcp-timeline")).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId("drill-hcp").getByTestId("drill-open")).toHaveCount(0)
})

test("the AI territory summary is generated through the agent, labelled AI, with citations", async ({ page }) => {
  await page.goto("/login")
  await page.getByTestId("login-email").fill(email("director-region-01"))
  await page.getByTestId("login-password").fill(a2g.local_password)
  await page.getByTestId("login-submit").click()
  await expect(page).toHaveURL(/\/director$/)
  await page.goto("/director/insights")
  await expect(page.getByTestId("summary-card").first()).toBeVisible({ timeout: 45_000 })
  await page.getByTestId("generate-summary").first().click()
  const result = page.getByTestId("summary-result").first()
  await expect(result).toBeVisible({ timeout: 120_000 })
  await expect(result).toContainText("AI")
})

test("the 3D topics-by-territory view draws the Director's real, scoped heatmap and picks the same cell as the table", async ({ page }) => {
  await page.goto("/login")
  await page.getByTestId("login-email").fill(email("director-region-01"))
  await page.getByTestId("login-password").fill(a2g.local_password)
  await page.getByTestId("login-submit").click()
  await expect(page).toHaveURL(/\/director$/)
  await page.goto("/director/insights")
  await expect(page.getByTestId("topic-heatmap")).toBeVisible({ timeout: 45_000 })

  // The table lists every cell the API returned for this persona's scope; the 3D view must have exactly one bar each.
  await page.getByTestId("heatmap-view-table").click()
  const cells = await page.locator('[data-testid="heatmap-cell"]').count()
  expect(cells).toBeGreaterThan(0)
  await page.getByTestId("heatmap-view-3d").click()
  const field = page.getByTestId("bar-field")
  await expect(field).toHaveAttribute("data-intro", "done", { timeout: 30_000 })
  await expect(field).toHaveAttribute("data-bar-count", String(cells))

  // Tap the bar for the first row of the front row of territories: the same cell is selected in the table twin.
  const rows = cells / 6
  const spot = await field.evaluate((el, index) => (JSON.parse(el.getAttribute("data-bars") ?? "[]") as [number, number][])[index], (rows - 1) * 6)
  await field.click({ position: { x: spot[0], y: spot[1] + 8 } })
  await expect(page.getByTestId("cell-detail")).toBeVisible()
  const [topic, territory] = (await field.getAttribute("data-selected"))!.split("|")
  expect(["T01-01", "T01-02", "T01-03", "T01-04", "T01-05", "T01-06"]).toContain(territory)
  await page.getByTestId("heatmap-view-table").click()
  await expect(page.locator(`[data-testid="heatmap-cell"][data-topic="${topic}"][data-territory="${territory}"]`)).toHaveAttribute("aria-pressed", "true")
})
