import { expect, test, type Page } from "@playwright/test"

/**
 * The Executive's Trends page at the iPad Air 11 projects (portrait and landscape) and the MacBook matrix, against the
 * mock adapter. Aggregate-only rules and the approved threshold rule are proven through the API in the backend tests
 * (backend/lambdas/api/tests/test_executive_trends_db.py); this file proves the screen reaches the nav entry, shows
 * regions, months and arrows, never shows a withheld count, and never offers a record-level drill-down.
 */

async function signInAs(page: Page, userId: string) {
  await page.addInitScript((id) => window.localStorage.setItem("a2g.local.userId", id), userId)
}

const smallNumber = /^\s*[1-4]\s*$/

test.describe("Executive trends", () => {
  test.beforeEach(async ({ page }) => signInAs(page, "u-exec-all"))

  test("is reached from the Trends navigation entry", async ({ page }) => {
    await page.goto("/executive")
    if ((page.viewportSize()?.width ?? 0) < 1280) {
      await page.getByTestId("sidebar-menu").click()
      await page.getByRole("dialog", { name: "Navigation" }).getByRole("link", { name: "Trends" }).click()
    } else {
      await page.getByTestId("sidebar-rail").getByRole("link", { name: "Trends" }).click()
    }
    await expect(page).toHaveURL(/\/executive\/trends$/)
    await expect(page.getByRole("heading", { level: 1, name: "Trends" })).toBeVisible()
    await expect(page.getByTestId("executive-trends")).toHaveAttribute("aria-busy", "false")
  })

  test("shows every authorized region with an arrow per metric, judged by the approved rule", async ({ page }) => {
    await page.goto("/executive/trends")
    await expect(page.getByTestId("access-banner")).toHaveAttribute("data-level", "AGGREGATE_ONLY")
    await expect(page.getByTestId("arrow-row")).toHaveCount(4)
    await expect(page.getByTestId("arrow-cell")).toHaveCount(12)
    const trend = (region: string, metric: string) => page.locator(`[data-testid="arrow-cell"][data-region="${region}"][data-metric="${metric}"]`)
    await expect(trend("NE", "CALLS")).toHaveAttribute("data-trend", "RISING")
    await expect(trend("SE", "CALLS")).toHaveAttribute("data-trend", "FALLING")
    await expect(trend("MW", "CALLS")).toHaveAttribute("data-trend", "STEADY")
    // A region with too few responses gets no trend, and says so in words.
    await expect(trend("WE", "RESPONSES")).toHaveAttribute("data-trend", "INSUFFICIENT_SAMPLE")
    await expect(page.getByTestId("small-sample")).toHaveCount(1)
    for (const arrow of await page.getByTestId("arrow-cell").getByTestId("trend").all()) await expect(arrow).not.toHaveText("")
    await expect(page.getByTestId("thresholds-approved")).toContainText("Approved")
    await expect(page.getByTestId("th-window")).toHaveText("30")
    await expect(page.getByTestId("th-mincell")).toHaveText("5")
    await expect(page.getByTestId("trend-rule-text")).toContainText("90 days")
  })

  test("plots months by region for each metric and mirrors the chart in a table", async ({ page }) => {
    await page.goto("/executive/trends")
    await expect(page.getByTestId("region-trend-chart")).toHaveAttribute("data-metric", "CALLS")
    await expect(page.getByTestId("month-row")).toHaveCount(12)
    await expect(page.getByTestId("month-table").getByRole("columnheader")).toHaveCount(5)
    for (const metric of ["ENGAGED_HCPS", "RESPONSES", "CALLS"]) {
      await page.getByTestId(`metric-${metric}`).click()
      await expect(page.getByTestId("region-trend-chart")).toHaveAttribute("data-metric", metric)
    }
    await page.getByTestId("period-6").click()
    await expect(page.getByTestId("month-row")).toHaveCount(6)
  })

  test("a withheld count is a labelled placeholder, never a number from 1 to 4", async ({ page }) => {
    await page.goto("/executive/trends")
    await expect(page.getByTestId("month-row")).toHaveCount(12)
    const withheld = page.locator('[data-suppressed="true"]')
    expect(await withheld.count()).toBeGreaterThan(0)
    for (const el of await withheld.all()) {
      await expect(el).not.toHaveText(smallNumber)
      await expect(el).toContainText("Withheld")
    }
    for (const el of await page.locator('[data-testid="month-table"] [data-value], [data-testid="region-arrows"] [data-value]').all()) {
      const value = Number(await el.getAttribute("data-value"))
      expect(value >= 5 || value === 0).toBe(true)
    }
    await expect(page.getByTestId("disclosure-text")).toContainText("Counts below 5 are withheld")
    await expect(page.getByTestId("sample-limitations")).toContainText("Too few responses to judge a trend in West")
  })

  test("is aggregate-only: no record-level control, link or button anywhere on the page", async ({ page }) => {
    await page.goto("/executive/trends?scenario=records")
    await expect(page.getByTestId("access-banner")).toHaveAttribute("data-level", "RECORD_DRILLDOWN")
    await expect(page.getByTestId("month-row")).toHaveCount(12)
    await expect(page.locator('[data-suppressed="true"]')).toHaveCount(0)
    for (const id of ["drill-open", "evidence-chip", "source-record"]) await expect(page.getByTestId(id)).toHaveCount(0)
    await page.goto("/executive/trends")
    await expect(page.getByTestId("arrow-row")).toHaveCount(4)
    await expect(page.getByRole("button", { name: /records?|drill/i })).toHaveCount(0)
  })

  test("says so when nothing was recorded, and recovers from an error", async ({ page }) => {
    await page.goto("/executive/trends?scenario=empty")
    await expect(page.getByText("No activity in this period")).toBeVisible()
    await page.goto("/executive/trends?scenario=error")
    await expect(page.getByRole("alert")).toBeVisible()
    await expect(page.getByTestId("arrow-row")).toHaveCount(0)
  })

  test("has no horizontal overflow", async ({ page }) => {
    await page.goto("/executive/trends")
    await expect(page.getByTestId("arrow-row")).toHaveCount(4)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth))
  })
})

test("other personas are kept out of the Executive trends page", async ({ page }) => {
  await signInAs(page, "u-msl-ne-01")
  await page.goto("/executive/trends")
  await expect(page.getByTestId("role-gate")).toBeVisible()
  await expect(page.getByTestId("executive-trends")).toHaveCount(0)
})
