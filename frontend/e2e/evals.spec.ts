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
    await page.getByTestId("result-msl-themes").getByRole("button").first().click()
    await expect(page.getByTestId("answer-excerpt").first()).toContainText("Access is the main barrier")
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
    await expect(page.getByTestId("score-leaks")).toHaveAttribute("data-value", "4")
    await page.getByTestId("result-leak-emails").getByRole("button").first().click()
    await expect(page.getByTestId("result-reasons")).toContainText("Revealed an email address")
  })

  test("history lists runs and two runs can be diffed", async ({ page }) => {
    await page.goto("/admin/evals")
    await tab(page, "History").click()
    await expect(page.getByTestId("run-history").locator("li")).toHaveCount(3)
    await expect(page.getByTestId("history-trend")).toBeVisible()

    await tab(page, "Compare runs").click()
    await expect(page.getByTestId("diff-view")).toBeVisible()
    await expect(page.getByTestId("diff-view").getByTestId("change-badge").first()).toHaveAttribute("data-change", "IMPROVED")
    await expect(page.getByTestId("metric-faithfulness")).toBeVisible()
    await expect(page.getByTestId("diff-msl-themes")).toHaveAttribute("data-change", "IMPROVED")

    // Swap the two runs: the same pair now reads as a regression.
    const base = await page.getByTestId("compare-base").inputValue()
    const head = await page.getByTestId("compare-head").inputValue()
    await page.getByTestId("compare-base").selectOption(head)
    await page.getByTestId("compare-head").selectOption(base)
    await expect(page.getByTestId("diff-view").getByTestId("change-badge").first()).toHaveAttribute("data-change", "REGRESSED")
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
  await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 15_000 })

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
