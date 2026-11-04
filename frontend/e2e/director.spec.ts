import { expect, test, type Page } from "@playwright/test"

/**
 * The Director overview at iPad viewports (playwright.config.ts) against the mock adapter, plus a sweep
 * of the captain's viewport matrix (13-inch MacBook up to 2560x1440, and every iPad Air/Pro size in both
 * orientations). The BE behaviour (scope, coverage, identical periods) is proven through the API in
 * tests/api/test_director_overview.py; this file proves the screen shows it and fits every size.
 */

async function signInAs(page: Page, userId: string) {
  await page.addInitScript((id) => window.localStorage.setItem("a2g.local.userId", id), userId)
}

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

test.describe("Director overview", () => {
  test.beforeEach(async ({ page }) => signInAs(page, "u-dir-ne"))

  test("lands on KPI cards, a scoped territory table and every section", async ({ page }) => {
    await page.goto("/director")
    await expect(page.getByTestId("director-overview")).toBeVisible()
    await expect(page.getByTestId("scope-label").first()).toContainText("Northeast")
    for (const id of ["members", "territories", "completeness", "rows"]) await expect(page.getByTestId(`kpi-${id}`)).toBeVisible()
    await expect(page.getByTestId("kpi-rows")).toContainText("Not calls")
    await expect(page.getByTestId("territory-row")).toHaveCount(6)
    for (const id of ["territories", "team", "mix", "engagement", "compare", "definitions"]) await expect(page.getByTestId(`section-${id}`)).toBeVisible()
    await expect(page.getByTestId("team-heatmap")).toBeVisible()
    await expect(page.getByTestId("mix-ranked")).toBeVisible()
  })

  test("coverage is withheld without a target population, and shown when one exists", async ({ page }) => {
    await page.goto("/director")
    await expect(page.getByTestId("coverage-withheld")).toContainText("Coverage is not shown")
    await expect(page.getByTestId("coverage-available")).toHaveCount(0)
    for (const cell of await page.getByTestId("cell-coverage").all()) {
      await expect(cell).toHaveAttribute("data-status", "NO_TARGET_POPULATION")
      await expect(cell).not.toContainText("%")
    }
    await page.goto("/director?scenario=targets")
    await expect(page.getByTestId("coverage-available")).toBeVisible()
    await expect(page.getByTestId("coverage-value")).toContainText("%")
    await expect(page.getByTestId("coverage-available")).toContainText("of 6 territories")
  })

  test("a month with no recorded calls is a hatched zero and lowers the member's completeness", async ({ page }) => {
    await page.goto("/director")
    await page.getByRole("button", { name: /90 days/i }).first().click()
    const gaps = page.locator('[data-testid="member-cell"][data-calls="0"]')
    await expect(gaps.first()).toBeVisible()
    await expect(gaps.first()).toHaveText("0")
    const row = page.locator('[data-testid="member-row"]').filter({ has: gaps }).first()
    await expect(row.getByTestId("member-completeness")).not.toHaveText("100%")
  })

  test("product mix labels mentions apart from distinct calls", async ({ page }) => {
    await page.goto("/director")
    await page.getByTestId("mix-tab-PRODUCT").click()
    await expect(page.getByTestId("mix-totals")).toContainText("distinct calls")
    await expect(page.getByTestId("mix-totals")).toContainText("product mentions")
    await expect(page.getByTestId("mix-totals")).toContainText("add up to more than the calls")
    await page.getByTestId("mix-tab-CHANNEL").click()
    await expect(page.getByTestId("mix-totals")).toContainText("Each call has one value here")
  })

  test("comparing territories fixes the period, and discloses unequal populations", async ({ page }) => {
    await page.goto("/director?scenario=targets")
    await expect(page.getByTestId("compare-hint")).toBeVisible()
    const toggles = page.getByTestId("compare-toggle")
    await toggles.nth(0).click()
    await expect(page.getByTestId("compare-hint")).toBeVisible()
    await toggles.nth(2).click()
    await expect(page.getByTestId("comparison")).toBeVisible()
    await expect(page.getByTestId("compare-basis")).toContainText("Same period for every territory")
    await expect(page.getByTestId("compare-basis")).toContainText("Same definitions")
    await expect(page.getByTestId("compare-unequal")).toContainText("not like-for-like")
    await expect(page.getByTestId("compare-disclosure").first()).toBeVisible()
    await expect(page.getByTestId("compare-row")).toHaveCount(2)
    for (const id of ["calls", "hcps", "per-member", "completeness"]) await expect(page.getByTestId(`compare-chart-${id}`)).toBeVisible()
    await expect(page.getByTestId("compare-coverage")).toContainText("not compared")
  })

  test("service failure shows retry; a non-director gets the role gate", async ({ page }) => {
    await page.goto("/director?scenario=error")
    await expect(page.getByTestId("state-error").first()).toBeVisible()
    await page.goto("/director?scenario=forbidden")
    await expect(page.getByTestId("state-error").first()).toContainText("No access")
    await page.addInitScript(() => window.localStorage.setItem("a2g.local.userId", "u-msl-ne-01"))
    await page.goto("/director")
    await expect(page.getByTestId("role-gate")).toBeVisible()
    await expect(page.getByTestId("director-overview")).toHaveCount(0)
  })

  test("touch targets that change the view are at least 44pt", async ({ page }) => {
    await page.goto("/director")
    for (const target of [page.getByTestId("compare-toggle").first(), page.getByTestId("mix-tab-PRODUCT")]) {
      const box = await target.boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(44)
      expect(box!.width).toBeGreaterThanOrEqual(44)
    }
  })
})

const MATRIX: ReadonlyArray<[string, number, number]> = [
  ["MacBook Air 13 (1280x800)", 1280, 800],
  ["MacBook Air 13 (1470x956)", 1470, 956],
  ["MacBook Pro 14", 1512, 982],
  ["MacBook Pro 16", 1728, 1117],
  ["Desktop 1080p", 1920, 1080],
  ["Desktop 1440p", 2560, 1440],
  ["iPad Air 11 portrait", 820, 1180],
  ["iPad Air 11 landscape", 1180, 820],
  ["iPad Pro 11 portrait", 834, 1194],
  ["iPad Pro 11 landscape", 1194, 834],
  ["iPad Air 13 portrait", 1024, 1366],
  ["iPad Air 13 landscape", 1366, 1024],
  ["iPad Pro 13 portrait", 1032, 1376],
  ["iPad Pro 13 landscape", 1376, 1032],
]

test.describe("Director overview viewport matrix", () => {
  for (const [name, width, height] of MATRIX) {
    test(`fits ${name}: no overflow, charts drawn, touch targets on iPad sizes`, async ({ page }) => {
      await signInAs(page, "u-dir-ne")
      await page.setViewportSize({ width, height })
      await page.goto("/director?scenario=targets")
      await expect(page.getByTestId("director-overview")).toBeVisible()
      await page.getByTestId("compare-toggle").nth(0).click()
      await page.getByTestId("compare-toggle").nth(1).click()
      await expect(page.getByTestId("compare-chart-calls")).toBeVisible()
      await expect(page.getByTestId("mix-ranked").locator("svg").first()).toBeVisible()
      expect(await overflow(page), "page scrolls sideways").toBeLessThanOrEqual(0)
      // No inner scroller (table, heatmap, comparison) scrolls sideways either.
      const inner = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-testid="director-overview"] *')].filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible" && el.clientWidth > 1).length,
      )
      expect(inner, "an inner region needs horizontal scrolling").toBe(0)
      // Charts keep a real size and stay inside the page.
      for (const id of ["compare-chart-calls", "mix-ranked", "team-heatmap"]) {
        const box = await page.getByTestId(id).boundingBox()
        expect(box!.width, id).toBeGreaterThan(200)
        expect(box!.x + box!.width, id).toBeLessThanOrEqual(width + 1)
      }
      if (width <= 1376) {
        for (const target of [page.getByTestId("compare-toggle").first(), page.getByTestId("mix-tab-PRODUCT")]) {
          const box = await target.boundingBox()
          expect(box!.height).toBeGreaterThanOrEqual(44)
        }
      }
    })
  }
})
