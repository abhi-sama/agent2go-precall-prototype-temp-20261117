import { expect, test, type Page } from "@playwright/test"

/** The AI evaluation panel against the mock adapter. The viewport matrix itself is covered by responsive.spec.ts (screens.ts). */

const tab = (page: Page, name: string) => page.getByRole("tab", { name })

test.describe("administrator", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("a2g.local.userId", "u-admin-sec"))
  })

  test("reads scored results, runs the suite on demand and sees the leak self-test fail the run", async ({ page }) => {
    await page.goto("/admin/evals")
    await expect(page.getByRole("heading", { level: 1, name: "AI evaluation" })).toBeVisible()

    // The latest MSL run passed: every score is shown against its bar, and leaks are zero.
    await expect(page.getByTestId("score-faithfulness")).toContainText("100%")
    await expect(page.getByTestId("score-leaks")).toContainText("No out-of-scope data retrieved")
    await expect(page.getByTestId("run-header").getByTestId("verdict-badge")).toHaveAttribute("data-verdict", "PASS")
    await page.getByTestId("result-msl-theme-sequenc").getByRole("button").first().click()
    await expect(page.getByTestId("result-detail-msl-theme-sequenc").getByTestId("answer-excerpt")).toContainText("Access is the main barrier")
    await expect(page.getByTestId("result-detail-msl-theme-sequenc").getByTestId("expected-text")).toContainText("37")
    // Human thumbs sit beside the automated scores of the same persona.
    await expect(page.getByTestId("human-ratings-strip")).toContainText("1")

    // Run on demand: it shows progress, then finishes with scored results.
    await page.getByTestId("run-suite").click()
    await expect(page.getByTestId("run-progress")).toBeVisible()
    await expect(page.getByTestId("run-suite")).toBeDisabled()
    await expect(page.getByTestId("run-scores")).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId("run-header").getByTestId("verdict-badge")).toHaveAttribute("data-verdict", "PASS")

    // A leak probe that retrieves out-of-scope data fails the run.
    await page.getByTestId("run-self-test").click()
    await expect(page.getByTestId("self-test-badge")).toBeVisible()
    await expect(page.getByTestId("run-failure-reasons")).toContainText("Out-of-scope data was retrieved", { timeout: 30_000 })
    await expect(page.getByTestId("run-header").getByTestId("verdict-badge")).toHaveAttribute("data-verdict", "FAIL")
    await expect(page.getByTestId("score-leaks")).toHaveAttribute("data-value", "8")
    // Failing questions start open.
    await expect(page.getByTestId("result-detail-leak-emails").getByTestId("result-reasons")).toContainText("Revealed an email address")
  })

  test("history lists runs and two runs can be diffed", async ({ page }) => {
    await page.goto("/admin/evals")
    await tab(page, "History").click()
    await expect(page.getByTestId("run-history").locator('[data-testid^="open-"]')).toHaveCount(3)
    await expect(page.getByTestId("history-trend")).toBeVisible()

    await tab(page, "Compare runs").click()
    await expect(page.getByTestId("diff-view")).toBeVisible()
    await expect(page.getByTestId("diff-view").getByTestId("change-badge").first()).toHaveAttribute("data-change", "IMPROVED")
    await expect(page.getByTestId("metric-faithfulness")).toBeVisible()
    await expect(page.getByTestId("diff-msl-theme-sequenc")).toHaveAttribute("data-change", "IMPROVED")

    // Swap the two runs: the same pair now reads as a regression.
    const base = (await page.getByTestId("compare-base").innerText()).trim()
    const head = (await page.getByTestId("compare-head").innerText()).trim()
    expect(base).not.toBe(head)
    await page.getByTestId("compare-base").click()
    await page.getByRole("option", { name: head }).click()
    await page.getByTestId("compare-head").click()
    await page.getByRole("option", { name: base }).click()
    await expect(page.getByTestId("diff-view").getByTestId("change-badge").first()).toHaveAttribute("data-change", "REGRESSED")
  })

  test("scores are reported by question type, and follow-up conversations expand and collapse", async ({ page }) => {
    await page.goto("/admin/evals")
    // One tile per question type, with passed over total.
    const strip = page.getByTestId("category-strip")
    await expect(strip).toBeVisible()
    for (const category of ["EXACT_COUNT", "PERCENTAGE", "TREND", "COMPARISON", "QUALITATIVE_THEME", "FOLLOW_UP_CHAIN", "LEAK_PROBE"]) {
      await expect(page.getByTestId(`category-${category}`)).toBeVisible()
    }
    await expect(page.getByTestId("category-FOLLOW_UP_CHAIN")).toHaveAttribute("data-total", "40")
    await expect(page.getByTestId("category-EXACT_COUNT")).toContainText("12/12")
    // The extra scores sit beside the first four, each against its bar.
    await expect(page.getByTestId("score-direction")).toContainText("100%")
    await expect(page.getByTestId("score-visual")).toContainText("100%")
    await expect(page.getByTestId("score-chains")).toContainText("4 of 4 conversations stayed correct")
    await expect(page.getByTestId("score-chains")).toHaveAttribute("data-value", "12")

    // Four conversations of 9, 9, 10 and 12 turns; a passing one starts collapsed.
    const chain = page.getByTestId("chain-msl-deep")
    await expect(chain).toContainText("12 turns")
    await expect(page.getByTestId("chain-turns-msl-deep")).toHaveCount(0)
    await chain.getByRole("button").first().click()
    await expect(page.getByTestId("chain-turns-msl-deep").locator("> li")).toHaveCount(12)
    await page.getByTestId("result-msl-deep-t12").getByRole("button").first().click()
    await expect(page.getByTestId("result-detail-msl-deep-t12")).toContainText("Finally, back to my first question")
    await chain.getByRole("button").first().click()
    await expect(page.getByTestId("chain-turns-msl-deep")).toHaveCount(0)

    // Choosing a type scrolls to its group.
    await page.getByTestId("category-LEAK_PROBE").click()
    await expect(page.getByTestId("group-LEAK_PROBE")).toBeInViewport()
  })

  test("a failing run opens its failures: expected answer, what was said, why, and the whole conversation", async ({ page }) => {
    await page.goto("/admin/evals")
    await tab(page, "History").click()
    await page.getByTestId("open-ev-20261103101500-b2c3d4e5").click()
    await expect(page.getByTestId("run-header").getByTestId("verdict-badge")).toHaveAttribute("data-verdict", "FAIL")
    await expect(page.getByTestId("run-failure-reasons")).toContainText("A chart or key figure does not match the database")

    // Failing questions start open, with their reasons spelled out.
    const theme = page.getByTestId("result-detail-msl-theme-sequenc")
    await expect(theme.getByTestId("result-reasons")).toContainText("not backed by the data")
    await expect(theme.getByTestId("unverified-sample")).toContainText("3,000")
    await expect(theme.getByTestId("expected-text")).toContainText("37")
    await expect(page.getByTestId("result-detail-msl-trend-calls").getByTestId("visual-notes")).toContainText("differ from SQL")

    // A failing turn opens its conversation and offers a link to the whole of it.
    await expect(page.getByTestId("chain-msl-question")).toHaveAttribute("data-open", "true")
    const turn = page.getByTestId("result-detail-msl-question-t03")
    await expect(turn.getByTestId("result-reasons")).toContainText("without the number it is out of")
    await expect(turn.getByTestId("expected-text")).toContainText("14.3% (5 of 35)")
    await page.getByTestId("chain-msl-question").getByRole("button").first().click()
    await expect(page.getByTestId("chain-turns-msl-question")).toHaveCount(0)
    await page.getByTestId("category-FOLLOW_UP_CHAIN").click()
    await page.getByTestId("chain-msl-question").getByRole("button").first().click()
    await page.getByTestId("conversation-msl-question-t03").click()
    await expect(page.getByTestId("chain-msl-question")).toHaveAttribute("data-open", "true")
  })

  test("the executive suite expects 'not available' for every record-level question", async ({ page }) => {
    await page.goto("/admin/evals")
    await page.getByTestId("persona-executive").click()
    await expect(page.getByTestId("suite-card")).toContainText("2 conversations")
  })

  test("human ratings sit next to the automated scores", async ({ page }) => {
    await page.goto("/admin/evals")
    await tab(page, "Human ratings").click()
    const items = page.getByTestId("rating-item")
    await expect(items).toHaveCount(2)
    await expect(items.first().getByTestId("rating-note")).toContainText("Exactly the numbers I needed")
    await expect(items.first().getByTestId("rating-scores")).toContainText("faithful")
    await expect(items.filter({ hasText: "Not helpful" })).toContainText("Too vague")

    // Another persona has its own suite, runs and ratings.
    await page.getByTestId("persona-director").click()
    await expect(items).toHaveCount(1)
  })

  test("the persona picker switches suites", async ({ page }) => {
    await page.goto("/admin/evals")
    await page.getByTestId("persona-executive").click()
    await expect(page.getByTestId("no-runs")).toContainText("has not been run yet")
    await expect(page.getByTestId("suite-card")).toContainText("aggregate only")
  })
})

test("iPad smoke: the panel fits portrait, with 44pt targets and no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 })
  await page.addInitScript(() => window.localStorage.setItem("a2g.local.userId", "u-admin-sec"))
  await page.goto("/admin/evals")
  await expect(page.getByTestId("run-scores")).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  for (const id of ["run-suite", "run-self-test", "persona-msl", "persona-admin"]) {
    const box = await page.getByTestId(id).boundingBox()
    expect(box?.height ?? 0, id).toBeGreaterThanOrEqual(44)
  }
  for (const id of ["category-EXACT_COUNT", "category-FOLLOW_UP_CHAIN", "category-LEAK_PROBE"]) {
    const box = await page.getByTestId(id).boundingBox()
    expect(box?.height ?? 0, id).toBeGreaterThanOrEqual(44)
  }
  const chainButton = await page.getByTestId("chain-msl-deep").getByRole("button").first().boundingBox()
  expect(chainButton?.height ?? 0).toBeGreaterThanOrEqual(44)
  for (const name of ["Results", "History", "Compare runs", "Human ratings"]) {
    const box = await tab(page, name).boundingBox()
    expect(box?.height ?? 0, name).toBeGreaterThanOrEqual(44)
  }
})

test("other personas do not get the panel", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.removeItem("a2g.local.userId"))
  await page.goto("/admin/evals")
  await expect(page.getByTestId("role-gate")).toBeVisible()
  await expect(page.getByRole("heading", { name: "AI evaluation" })).toHaveCount(0)
})

test("anyone can rate a finished chat answer, and the rating is saved", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.removeItem("a2g.local.userId"))
  await page.goto("/chat")
  await page.getByTestId("chat-input").fill("How many calls did I have in the last 90 days?")
  await page.getByTestId("chat-send").click()
  await expect(page.getByTestId("chat-turn")).toHaveAttribute("data-status", "done", { timeout: 15_000 })

  await page.getByTestId("rate-up").click()
  await expect(page.getByTestId("rate-up")).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByTestId("rating-saved")).toBeVisible()
  await page.getByTestId("rating-note-input").fill("Clear and quick")
  await page.getByTestId("rating-note-save").click()
  await expect(page.getByTestId("rating-saved")).toBeVisible()
  const box = await page.getByTestId("rate-down").boundingBox()
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
  // Rating again replaces the earlier thumb.
  await page.getByTestId("rate-down").click()
  await expect(page.getByTestId("rate-down")).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByTestId("rate-up")).toHaveAttribute("aria-pressed", "false")
})
