import { expect, test, type Page } from "@playwright/test"

/**
 * Director insights at iPad viewports (playwright.config.ts) against the mock adapter. The BE behaviour (scope,
 * thresholds in the database, drill-down limits, planted exceptions) is proven through the API in
 * tests/api/test_director_insights.py; this file proves the screen shows it. Every viewport in the matrix also
 * checks this screen for overflow, overlap and touch targets through e2e/support/screens.ts.
 */

async function signInAs(page: Page, userId: string) {
  await page.addInitScript((id) => window.localStorage.setItem("a2g.local.userId", id), userId)
}

test.describe("Director insights", () => {
  test.beforeEach(async ({ page }) => signInAs(page, "u-dir-ne"))

  test("opens from the landing and the sidebar, with every section", async ({ page }) => {
    await page.goto("/director")
    await page.getByTestId("insights-link").click()
    await expect(page).toHaveURL(/\/director\/insights$/)
    await expect(page.getByRole("heading", { level: 1, name: "Insights" })).toBeVisible()
    for (const id of ["summaries", "heatmap", "emerging", "questions", "drilldown", "exceptions"]) await expect(page.getByTestId(`section-${id}`)).toBeVisible()
    await expect(page.getByTestId("scope-label").first()).toContainText("Northeast")
  })

  test("heatmap shows themes by territory with a stated denominator, and theme cards labelled derived", async ({ page }) => {
    await page.goto("/director/insights")
    await expect(page.getByTestId("topic-heatmap")).toBeVisible()
    await expect(page.getByTestId("heatmap-denominator")).toContainText("free-text responses")
    await expect(page.getByTestId("panel-meta").first()).toContainText("Data through")
    await expect(page.getByTestId("theme-card").first()).toBeVisible()
    await expect(page.getByTestId("theme-card").first().getByTestId("derived-badge")).toBeVisible()
    await expect(page.getByTestId("theme-card").first().getByTestId("evidence-chip").first()).toBeVisible()

    await page.getByTestId("heatmap-view-table").click()
    await expect(page.getByTestId("heatmap-cell")).toHaveCount(14 * 6)
    await page.locator('[data-testid="heatmap-cell"][data-territory="NE-02"][data-topic="Access and reimbursement"]').click()
    await expect(page.getByTestId("cell-detail")).toContainText("Access and reimbursement")
    await expect(page.getByTestId("cell-detail")).toContainText("free-text responses")
    await expect(page.getByTestId("ask-agent-cell")).toHaveAttribute("href", /\/chat\?.*territory=NE-02.*view=director-insights|\/chat\?.*view=director-insights.*territory=NE-02/)
  })

  test("theme cards regroup by molecule, tumor type, study and survey", async ({ page }) => {
    await page.goto("/director/insights")
    await page.getByTestId("facet-MOLECULE").click()
    await expect(page.getByTestId("facet-group")).toHaveCount(4)
    await expect(page.getByTestId("theme-cards")).toHaveAttribute("data-facet", "MOLECULE")
    await page.getByTestId("facet-SURVEY").click()
    await expect(page.getByTestId("facet-group")).toHaveCount(2)
  })

  test("emerging topics state the rule, both periods and sample sizes, and show the database's verdicts", async ({ page }) => {
    await page.goto("/director/insights")
    await expect(page.getByTestId("emerging-rule-text")).toContainText("at least 30 free-text responses")
    await expect(page.getByTestId("emerging-rule-text")).toContainText("1.5 times")
    await expect(page.getByTestId("sample-current")).toBeVisible()
    await expect(page.getByTestId("sample-prior")).toBeVisible()
    await expect(page.getByTestId("emerging-windows")).toContainText("Earlier period")
    const cards = page.getByTestId("emerging-card")
    await expect(cards.first()).toHaveAttribute("data-status", "EMERGING")
    await expect(cards.first().getByTestId("status-badge")).toContainText("Emerging")
    await expect(cards.first().getByTestId("sparkline")).toBeVisible()
    await expect(page.getByTestId("emerging-statement")).toContainText("do not say why")
    await expect(page.locator('[data-testid="emerging-row"][data-status="STABLE"]').first()).toBeVisible()
  })

  test("a thin sample is reported, not guessed", async ({ page }) => {
    await page.goto("/director/insights")
    await page.getByTestId("range-7d").click()
    await page.getByTestId("range-custom").click()
    await page.locator("#range-from").fill("2026-11-02")
    await page.locator("#range-to").fill("2026-11-02")
    await expect(page.getByTestId("sample-warning")).toBeVisible()
    await expect(page.locator('[data-testid="emerging-row"][data-status="EMERGING"]')).toHaveCount(0)
  })

  test("the question selector changes the bars; a follow-up shows its parent, an orphan says so", async ({ page }) => {
    await page.goto("/director/insights")
    const detail = page.getByTestId("question-detail")
    await expect(detail).toBeVisible()
    const first = await detail.getAttribute("data-question-id")
    await page.locator('[data-testid="question-option"][data-question-id="Q-0013"]').click()
    await expect(detail).toHaveAttribute("data-question-id", "Q-0013")
    expect(first).not.toBe("Q-0013")
    await expect(page.locator('[data-testid="response-bar"]')).toHaveCount(3)
    await expect(page.getByTestId("question-denominator")).toBeVisible()
    await expect(page.getByTestId("follow-ups")).toContainText("Q-0333")

    await page.locator('[data-testid="question-option"][data-question-id="Q-0333"]').click()
    await expect(page.getByTestId("parent-context")).toHaveAttribute("data-in-catalog", "true")
    await expect(page.getByTestId("parent-context")).toContainText("Q-0013")

    await page.locator('[data-testid="question-option"][data-question-id="Q-0100"]').click()
    await expect(page.getByTestId("parent-context")).toHaveAttribute("data-in-catalog", "false")
    await expect(page.getByTestId("parent-context")).toContainText("not in the catalog")
    await expect(page.getByTestId("ask-agent-question")).toHaveAttribute("href", /question=Q-0100/)
  })

  test("the question list filters by text and by answer type", async ({ page }) => {
    await page.goto("/director/insights")
    await page.getByTestId("question-search").fill("supportive")
    await expect(page.getByTestId("question-option")).toHaveCount(1)
    await page.getByTestId("question-search").fill("")
    await page.getByTestId("question-type").selectOption("yes_no")
    await expect(page.getByTestId("question-option")).toHaveCount(1)
  })

  test("drill-down goes region, territory, HCP, then the timeline, and stops there", async ({ page }) => {
    await page.goto("/director/insights")
    await expect(page.getByTestId("drilldown-limit")).toContainText("permitted to see")
    await expect(page.getByTestId("drill-row")).toHaveCount(1)
    await page.getByTestId("drill-row").first().getByTestId("drill-open").click()
    await expect(page.getByTestId("drill-table")).toHaveAttribute("data-level", "REGION")
    await expect(page.getByTestId("drill-row")).toHaveCount(6)
    await page.locator('[data-testid="drill-row"][data-id="NE-01"]').getByTestId("drill-open").click()
    await expect(page.getByTestId("drill-table")).toHaveAttribute("data-level", "TERRITORY")
    await expect(page.getByTestId("drill-breadcrumb")).toContainText("Boston Metro")
    await expect(page.getByTestId("ask-agent-territory")).toBeVisible()
    await page.locator('[data-testid="drill-row"][data-id="HCP-0001"]').getByTestId("drill-open").click()
    await expect(page.getByTestId("drill-hcp")).toBeVisible()
    await expect(page.getByTestId("hcp-timeline")).toBeVisible()
    await expect(page.getByTestId("drill-hcp")).toContainText("last level")
    // Nothing inside the timeline drills further.
    await expect(page.getByTestId("drill-hcp").getByTestId("drill-open")).toHaveCount(0)
    // Only this Director's own region was ever listed.
    await expect(page.getByTestId("drill-table")).not.toContainText("SE-")
  })

  test("exceptions list every planted defect category, each with its rule", async ({ page }) => {
    await page.goto("/director/insights")
    await expect(page.getByTestId("exceptions-table")).toBeVisible()
    for (const category of ["STALE_LOAD", "MISSING_JOIN", "UNRESOLVED_IDENTITY", "DUPLICATE_KEY", "STATUS_DIFFERENCE"]) {
      await page.getByTestId(`exception-filter-${category}`).click()
      const rows = page.locator(`[data-testid="exception-row"][data-category="${category}"]`)
      await expect(rows.first()).toBeVisible()
      await expect(page.locator('[data-testid="exception-row"]')).toHaveCount(await rows.count())
    }
    await page.getByTestId("exception-filter-STALE_LOAD").click()
    await expect(page.locator('[data-testid="exception-row"]')).toHaveCount(3)
    await page.getByTestId("exception-filter-ALL").click()
    await expect(page.getByTestId("exception-rules")).toContainText("Responses sharing one response key")
    await expect(page.getByTestId("exception-total")).toContainText("exceptions")
  })

  test("an AI summary streams, is labelled AI, and cites responses that open as source records", async ({ page }) => {
    await page.goto("/director/insights")
    const card = page.getByTestId("summary-card").first()
    await expect(card.getByTestId("derived-badge").first()).toBeVisible()
    await expect(card.locator('[data-provenance="fact"]').first()).toBeVisible()
    await card.getByTestId("generate-summary").click()
    const result = card.getByTestId("summary-result")
    await expect(result.locator('[data-provenance="ai"]')).toBeVisible({ timeout: 15_000 })
    await expect(result.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 30_000 })
    await expect(result.locator('[data-provenance="ai"]')).toContainText("AI summary")
    await expect(result.locator('[data-provenance="ai"]')).toContainText("Generated by AI")
    await expect(result.getByTestId("ai-summary")).toContainText("recorded")
    await result.getByTestId("citation").first().click()
    await expect(page.getByTestId("citation-sheet")).toContainText("Recorded HCP response")
  })

  test("an evidence chip opens the cited response", async ({ page }) => {
    await page.goto("/director/insights")
    await page.getByTestId("theme-card").first().getByTestId("evidence-chip").first().click()
    await expect(page.getByTestId("citation-sheet")).toContainText("Recorded HCP response")
    await expect(page.getByTestId("citation-fields")).toContainText("Recorded response")
  })

  test("other personas see the role gate, not the insights", async ({ page }) => {
    await signInAs(page, "u-msl-ne-01")
    await page.goto("/director/insights")
    await expect(page.getByTestId("role-gate")).toBeVisible()
  })

  test("error and empty states are explicit", async ({ page }) => {
    await page.goto("/director/insights?scenario=error")
    await expect(page.getByTestId("state-error").first()).toBeVisible()
    await page.goto("/director/insights?scenario=empty")
    await expect(page.getByTestId("section-heatmap")).toContainText("No free-text responses in this period")
    await expect(page.getByTestId("section-questions")).toContainText("No answered questions")
  })
})
