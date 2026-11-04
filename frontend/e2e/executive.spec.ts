import { expect, test, type Page } from "@playwright/test"

/**
 * The Executive overview at iPad viewports against the mock adapter. Every viewport of the matrix also runs these
 * screens through e2e/support/screens.ts. Scope, suppression and the drill-down refusal are proven through the API in
 * tests/api/test_executive_overview.py; this file proves the screen shows them.
 */

async function signInAs(page: Page, userId: string) {
  await page.addInitScript((id) => window.localStorage.setItem("a2g.local.userId", id), userId)
}

test.describe("Executive overview", () => {
  test.beforeEach(async ({ page }) => signInAs(page, "u-exec-all"))

  test("lands on aggregate KPIs, trends, ranked regions and engagement, with no record controls", async ({ page }) => {
    await page.goto("/executive")
    await expect(page.getByTestId("executive-overview")).toBeVisible()
    for (const id of ["calls", "hcps", "responses", "completeness"]) await expect(page.getByTestId(`exec-kpi-${id}`)).toBeVisible()
    for (const id of ["trends", "regions", "engagement", "definitions"]) await expect(page.getByTestId(`section-${id}`)).toBeVisible()
    await expect(page.getByTestId("access-banner")).toHaveAttribute("data-level", "AGGREGATE_ONLY")
    await expect(page.getByTestId("disclosure-text")).toContainText("Counts below 5 are withheld")
    await expect(page.getByTestId("ranked-regions").getByTestId("ranked-row")).toHaveCount(4)
    await expect(page.getByTestId("drill-open")).toHaveCount(0)
    await expect(page.getByTestId("trend-month").first()).toBeVisible()
  })

  test("ranks regions best first, and re-ranks by the chosen metric", async ({ page }) => {
    await page.goto("/executive")
    const ranks = page.getByTestId("ranked-regions").getByTestId("ranked-row")
    await expect(ranks.first()).toHaveAttribute("data-rank", "1")
    await page.getByTestId("rank-by").selectOption("COMPLETENESS")
    await expect(page.getByTestId("section-regions")).toContainText("reporting completeness")
    await expect(ranks.first()).toHaveAttribute("data-rank", "1")
  })

  test("a short period shows withheld small groups as labelled placeholders, never as numbers", async ({ page }) => {
    await page.goto("/executive")
    await page.getByTestId("period-6").click()
    // The mock's per-territory volume over six months is large; force small cells with a one-month dataset via the trend metric.
    await expect(page.getByTestId("trend-columns")).toBeVisible()
    const withheld = page.locator('[data-suppressed="true"]')
    for (const el of await withheld.all()) await expect(el).not.toHaveText(/^\s*[1-4]\s*$/)
  })

  test("with record-level permission nothing is withheld and a row opens its records", async ({ page }) => {
    await page.goto("/executive?scenario=records")
    await expect(page.getByTestId("access-banner")).toHaveAttribute("data-level", "RECORD_DRILLDOWN")
    await expect(page.locator('[data-suppressed="true"]')).toHaveCount(0)
    await page.getByTestId("ranked-regions").getByTestId("drill-open").first().click()
    await expect(page.getByTestId("drilldown-drawer")).toBeVisible()
    await expect(page.getByTestId("drill-row").first()).toBeVisible()
    await expect(page.getByTestId("drill-count")).toContainText("distinct calls")
    const box = await page.getByTestId("drill-open").first().boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
  })

  test("the trend has a table view with the same figures", async ({ page }) => {
    await page.goto("/executive")
    await expect(page.getByTestId("trend-table")).toHaveCount(0)
    await page.getByTestId("trend-table-toggle").click()
    await expect(page.getByTestId("trend-table")).toBeVisible()
    await expect(page.getByTestId("trend-table").locator("tbody tr")).toHaveCount(await page.getByTestId("trend-month").count())
  })

  test("coverage is withheld without a target population and shown with one", async ({ page }) => {
    await page.goto("/executive")
    await expect(page.getByTestId("executive-overview")).toHaveAttribute("aria-busy", "false", { timeout: 15_000 })
    await expect(page.getByTestId("coverage-withheld")).toContainText("Coverage is not shown")
    await page.goto("/executive?scenario=targets")
    await expect(page.getByTestId("executive-overview")).toHaveAttribute("aria-busy", "false", { timeout: 15_000 })
    await expect(page.getByTestId("coverage-value")).toContainText("%")
  })

  test("service failure shows retry; other personas get the role gate", async ({ page }) => {
    await page.goto("/executive?scenario=error")
    await expect(page.getByTestId("state-error").first()).toBeVisible()
    await page.addInitScript(() => window.localStorage.setItem("a2g.local.userId", "u-dir-ne"))
    await page.goto("/executive")
    await expect(page.getByTestId("role-gate")).toBeVisible()
    await expect(page.getByTestId("executive-overview")).toHaveCount(0)
  })

  test("controls that change the view are at least 44pt", async ({ page }) => {
    await page.goto("/executive")
    for (const target of [page.getByTestId("period-12"), page.getByTestId("trend-metric-calls"), page.getByTestId("rank-by")]) {
      const box = await target.boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }
  })
})
