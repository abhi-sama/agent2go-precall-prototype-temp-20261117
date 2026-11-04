import { expect, test, type Page } from "@playwright/test"

/**
 * The Executive's themes, cross-region topics, leadership summaries and organisational analysis at iPad viewports
 * against the mock adapter. Every viewport of the matrix also runs these screens through e2e/support/screens.ts.
 * Aggregate-only rules, access re-checks and sample limitations are proven through the API in the backend tests;
 * this file proves the screen shows them and never shows a withheld count.
 */

async function signInAs(page: Page, userId: string) {
  await page.addInitScript((id) => window.localStorage.setItem("a2g.local.userId", id), userId)
}

const smallNumber = /^\s*[1-4]\s*$/

test.describe("Executive themes", () => {
  test.beforeEach(async ({ page }) => signInAs(page, "u-exec-all"))

  test("is reachable from the Executive overview and the navigation", async ({ page }) => {
    await page.goto("/executive")
    await page.getByTestId("themes-link").click()
    await expect(page).toHaveURL(/\/executive\/themes$/)
    await expect(page.getByRole("heading", { level: 1, name: "Themes & summaries" })).toBeVisible()
  })

  test("theme cards switch between portfolio, molecule, disease area and study, each with trend and source", async ({ page }) => {
    await page.goto("/executive/themes")
    await expect(page.getByTestId("access-banner")).toHaveAttribute("data-level", "AGGREGATE_ONLY")
    await expect(page.getByTestId("theme-group")).toHaveCount(1)
    const first = page.getByTestId("theme-card").first()
    await expect(first.getByTestId("trend")).toBeVisible()
    await expect(first.getByTestId("source-chip")).toBeVisible()
    await expect(first.getByTestId("derived-badge")).toBeVisible()
    for (const facet of ["MOLECULE", "DISEASE_AREA", "STUDY"]) {
      await page.getByTestId(`facet-${facet}`).click()
      await expect(page.getByTestId("facet-" + facet)).toHaveAttribute("aria-pressed", "true")
      await expect(page.getByTestId("theme-group")).toHaveCount(4)
      await expect(page.getByTestId("theme-cards")).toHaveAttribute("data-facet", facet)
      await expect(page.getByTestId("topic-matrix")).toHaveAttribute("data-facet", facet)
    }
    await page.getByTestId("facet-PORTFOLIO").click()
    await expect(page.getByTestId("theme-group")).toHaveCount(1)
  })

  test("the matrix marks alert cells and cross-region topics, and states the approved thresholds", async ({ page }) => {
    await page.goto("/executive/themes")
    await expect(page.getByTestId("matrix-row")).toHaveCount(14)
    await expect(page.getByTestId("matrix-region")).toHaveCount(4)
    await expect(page.getByTestId("small-sample")).toHaveCount(1)
    const alerts = page.locator('[data-testid="matrix-cell"][data-alert="true"]')
    expect(await alerts.count()).toBeGreaterThan(1)
    for (const cell of await alerts.all()) await expect(cell).toHaveAttribute("data-trend", "RISING")
    await expect(page.getByTestId("cross-region").first()).toContainText(/Rising in \d regions/)
    await expect(page.getByTestId("thresholds-approved")).toContainText("Approved")
    await expect(page.getByTestId("th-window")).toHaveText("30")
    await expect(page.getByTestId("th-topic")).toHaveText("10")
    await expect(page.getByTestId("th-points")).toContainText("2")
    await expect(page.getByTestId("th-mincell")).toHaveText("5")
    await expect(page.getByTestId("matrix-disclosure")).toContainText("Counts below 5 are withheld")
    // Trend arrows come with words, never colour alone.
    for (const trend of await page.getByTestId("matrix-table").getByTestId("trend").all()) await expect(trend).not.toHaveText("")
  })

  test("a withheld count is a labelled placeholder, never a number from 1 to 4", async ({ page }) => {
    await page.goto("/executive/themes")
    await expect(page.getByTestId("matrix-row")).toHaveCount(14)
    const withheld = page.locator('[data-suppressed="true"]')
    expect(await withheld.count()).toBeGreaterThan(0)
    for (const el of await withheld.all()) {
      await expect(el).not.toHaveText(smallNumber)
      await expect(el).toContainText("Withheld")
    }
    for (const el of await page.getByTestId("matrix-count").all()) {
      const value = await el.getAttribute("data-value")
      if (value !== null) expect(Number(value) >= 5 || Number(value) === 0).toBe(true)
    }
    for (const el of await page.getByTestId("card-responses").all()) {
      const value = Number(await el.getAttribute("data-value"))
      expect(value >= 5 || value === 0).toBe(true)
    }
  })

  test("with record-level permission nothing is withheld and cards cite responses with excerpts", async ({ page }) => {
    await page.goto("/executive/themes?scenario=records")
    await expect(page.getByTestId("access-banner")).toHaveAttribute("data-level", "RECORD_DRILLDOWN")
    await expect(page.getByTestId("topic-matrix")).toBeVisible()
    await expect(page.locator('[data-suppressed="true"]')).toHaveCount(0)
    await expect(page.getByTestId("source-record").first()).toBeVisible()
    await expect(page.getByTestId("source-chip")).toHaveCount(0)
  })

  test("generates a source-linked summary, saves it, and exports a printable document", async ({ page }) => {
    await page.goto("/executive/themes")
    await page.getByTestId("generate-leadership-summary").click()
    const summary = page.getByTestId("leadership-summary")
    await expect(summary).toBeVisible({ timeout: 15_000 })
    await expect(summary.getByTestId("summary-scope")).toContainText("All regions")
    await expect(summary.getByTestId("summary-range")).toContainText(" to ")
    await expect(summary.getByTestId("summary-sources").locator("li").first()).toBeVisible()
    await expect(summary.getByTestId("sample-limitations")).toBeVisible()
    await summary.getByTestId("summary-definitions").locator("summary").click()
    await expect(summary.getByTestId("summary-definitions")).toContainText("Free-text responses")
    for (const statement of await summary.getByTestId("summary-statement").all()) await expect(statement.getByTestId("summary-cite").first()).toBeVisible()
    await expect(page.getByTestId("saved-summary")).toHaveCount(1)

    await summary.getByTestId("export-summary").click()
    const preview = page.getByTestId("leadership-export-preview")
    await expect(preview).toBeVisible({ timeout: 15_000 })
    for (const text of ["Scope", "Date range", "Data through", "Generated", "Exported", "Metric definitions", "Sample limitations", "Disclosure", "Source citations"]) {
      await expect(preview).toContainText(text)
    }
    // The print-only copy exists in the page (and is what the browser prints), but is not shown on screen.
    await expect(page.getByTestId("leadership-print-document")).toBeHidden()
    await expect(page.getByTestId("leadership-print-document")).toContainText("Source citations")
  })

  test("reopens a saved summary", async ({ page }) => {
    await page.goto("/executive/themes")
    await page.getByTestId("generate-leadership-summary").click()
    await expect(page.getByTestId("leadership-summary")).toBeVisible({ timeout: 15_000 })
    await page.getByTestId("saved-summary").getByTestId("open-summary").click()
    await expect(page.getByTestId("leadership-summary")).toBeVisible()
  })

  test("a summary whose scope has changed cannot be opened or exported, and says why", async ({ page }) => {
    await page.goto("/executive/themes?scenario=scope-changed")
    await expect(page.getByTestId("summary-locked")).toBeVisible()
    await page.getByTestId("open-summary").first().click()
    await expect(page.getByTestId("access-changed")).toContainText("Your access has changed")
    await expect(page.getByTestId("leadership-summary")).toHaveCount(0)
    // Freshly generated, but exporting re-checks access and is refused.
    await page.getByTestId("generate-leadership-summary").click()
    await expect(page.getByTestId("leadership-summary")).toBeVisible({ timeout: 15_000 })
    await page.getByTestId("export-summary").click()
    await expect(page.getByTestId("access-changed")).toContainText("cannot be exported")
    await expect(page.getByTestId("leadership-export-preview")).toHaveCount(0)
  })

  test("an answer states its sample limitations and cites an aggregate source that opens without a record fetch", async ({ page }) => {
    const consoleLines: string[] = []
    page.on("console", (m) => consoleLines.push(m.text()))
    await page.goto("/executive/themes")
    await page.getByTestId("org-suggestion").first().click()
    const turn = page.getByTestId("org-turn").first().getByTestId("assistant-turn")
    await expect(turn).toHaveAttribute("data-status", "done", { timeout: 20_000 })
    await expect(turn.getByTestId("sample-limitations")).toContainText("West")
    // The limitations are shown once, in their own block, not repeated inside the answer prose.
    await expect(turn.getByTestId("ai-summary")).not.toContainText("Sample limitations")
    await expect(turn.getByTestId("aggregate-only-note")).toBeVisible()
    await turn.getByTestId("citation").first().click()
    await expect(page.getByTestId("aggregate-citation")).toContainText("Free-text responses on")
    await expect(page.getByTestId("citation-fields")).toHaveCount(0)
    expect(consoleLines.filter((l) => l.includes('"operation":"chatCitation"'))).toHaveLength(0)
  })
})
