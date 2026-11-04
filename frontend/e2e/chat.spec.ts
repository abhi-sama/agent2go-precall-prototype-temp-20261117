import { expect, test } from "@playwright/test"

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.removeItem("a2g.local.userId"))
})

async function ask(page: import("@playwright/test").Page, question: string) {
  await page.getByTestId("chat-input").fill(question)
  await page.getByTestId("chat-send").click()
}

test.describe("chat panel (mock adapter, iPad viewports)", () => {
  test("streams a cited answer with source facts, AI summary and suggestions kept distinct", async ({ page }) => {
    await page.goto("/chat")
    await expect(page.getByRole("heading", { level: 1, name: "Ask the agent" })).toBeVisible()
    await expect(page.getByTestId("scope-label")).toContainText("NE-01")

    await ask(page, "How many calls did I have in the last 90 days?")
    await expect(page.getByTestId("user-message")).toContainText("How many calls")

    // The answer streams: the turn is running before it is done.
    await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "running")
    await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 15_000 })

    const calls = Number(await page.getByTestId("fact-f1").getAttribute("data-value"))
    expect(calls).toBeGreaterThan(0)
    // The AI summary repeats the computed number; it never carries a different one.
    await expect(page.getByTestId("ai-summary")).toContainText(String(calls))

    // Three visually distinct kinds of content, each labelled (colour is never the only signal).
    for (const kind of ["fact", "ai", "suggestion"]) {
      await expect(page.locator(`[data-provenance="${kind}"]`)).toBeVisible()
    }

    // A citation opens the source record.
    await page.getByTestId("citation").first().click()
    await expect(page.getByTestId("citation-sheet")).toBeVisible()
    await expect(page.getByTestId("citation-fields")).toContainText("CALL-")
    await expect(page.getByTestId("inline-citation").first()).toBeVisible()
    await page.getByTestId("show-rows").click()
    await expect(page.getByTestId("chat-rows")).toContainText("Territory")
    expect(await page.getByTestId("chat-row").count()).toBeGreaterThan(0)
  })

  test("an out-of-scope territory returns no data", async ({ page }) => {
    await page.goto("/chat")
    await ask(page, "How many calls did SE-03 have?")
    await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 15_000 })
    await expect(page.getByTestId("ai-summary")).toContainText("outside your scope")
    await expect(page.getByTestId("source-facts")).toHaveCount(0)
    await expect(page.getByTestId("citation")).toHaveCount(0)
  })

  test("a suggestion asks the next question; touch targets are at least 44pt", async ({ page }) => {
    await page.goto("/chat")
    for (const id of ["chat-send"]) {
      const box = await page.getByTestId(id).boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(44)
      expect(box!.width).toBeGreaterThanOrEqual(44)
    }
    await page.getByTestId("starter").first().click()
    await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 15_000 })
    for (const target of await page.getByTestId("suggestion").all()) {
      expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    }
    await page.getByTestId("suggestion").first().click()
    await expect(page.getByTestId("chat-turn")).toHaveCount(2)
    // No horizontal scroll at iPad widths.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test("executive gets an aggregate-only analysis that states its sample limitations, with no records", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("a2g.local.userId", "u-exec-all"))
    await page.goto("/chat")
    await ask(page, "Which topics are rising across regions?")
    await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 15_000 })
    await expect(page.getByTestId("sample-limitations")).toBeVisible()
    await expect(page.getByTestId("ai-summary")).not.toContainText("Sample limitations")
    await expect(page.getByTestId("aggregate-only-note")).toContainText("does not grant source-row access")
    // Sources describe sets of responses; none names a record.
    await expect(page.getByTestId("ai-summary").getByTestId("inline-citation").first()).toBeVisible()
    await expect(page.getByTestId("fact-f2")).toBeVisible()
  })

  test("a trend question draws a line whose values add up to the key figure; a plain count stays text and key figures", async ({ page }) => {
    await page.goto("/chat")
    await ask(page, "How many calls did I have in the last 90 days?")
    await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 15_000 })
    await expect(page.getByTestId("visual")).toHaveCount(0)
    await expect(page.getByTestId("source-facts")).toBeVisible()

    await page.getByTestId("chat-new").click()
    await ask(page, "Show my calls by month")
    await expect(page.getByTestId("visual")).toHaveAttribute("data-kind", "line", { timeout: 15_000 })
    await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 15_000 })
    const calls = Number(await page.getByTestId("fact-f1").getAttribute("data-value"))
    const points = await page.getByTestId("line-point").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-value"))))
    expect(points.length).toBeGreaterThanOrEqual(3)
    expect(points.reduce((a, b) => a + b, 0)).toBe(calls)
    await expect(page.getByTestId("visual-total")).toContainText(calls.toLocaleString("en-US"))
  })

  test("bars show exact values, a tap reads one out, the table twin matches, and the chart expands full screen", async ({ page }) => {
    await page.goto("/chat")
    await ask(page, "Compare my calls by product")
    await expect(page.getByTestId("visual")).toHaveAttribute("data-kind", "bar", { timeout: 15_000 })
    await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 15_000 })
    const calls = Number(await page.getByTestId("fact-f1").getAttribute("data-value"))
    const bars = await page.getByTestId("bar-row").evaluateAll((els) => els.map((e) => [e.getAttribute("data-key"), Number(e.getAttribute("data-value"))] as const))
    expect(bars.reduce((a, [, v]) => a + v, 0)).toBe(calls)
    // Longest first.
    expect(bars.map(([, v]) => v)).toEqual([...bars.map(([, v]) => v)].sort((a, b) => b - a))

    // Tap a bar: its exact value and share appear in the readout.
    await page.getByTestId("bar-row").nth(1).tap()
    await expect(page.getByTestId("viz-readout")).toContainText(String(bars[1][1]))
    await expect(page.getByTestId("viz-readout")).toContainText("% of the total")

    // Every chart has a table twin with the same numbers.
    await page.getByTestId("visual-toggle").click()
    const cells = await page.getByTestId("visual-table").locator("tbody tr").evaluateAll((rows) => rows.map((r) => Number(r.querySelector("td")!.getAttribute("data-value"))))
    expect(cells).toEqual(bars.map(([, v]) => v))
    await page.getByTestId("visual-toggle").click()

    // Expand to full screen, and close again.
    await page.getByTestId("visual-expand").click()
    await expect(page.getByTestId("visual-sheet")).toBeVisible()
    await expect(page.getByTestId("visual-sheet").getByTestId("bar-row")).toHaveCount(bars.length)
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("visual-sheet")).toHaveCount(0)
  })

  test("heatmap, timeline, distribution and table visuals render their values", async ({ page }) => {
    await page.goto("/chat")
    const kinds: [string, string, string][] = [
      ["Heatmap of calls by product", "heatmap", "heat-cell"],
      ["Show my weekly calls timeline", "timeline", "timeline-point"],
      ["How did HCPs rate it, show the scores", "distribution", "distribution-chart"],
      ["Give me a table of calls", "table", "table-row"],
    ]
    for (const [question, kind, mark] of kinds) {
      await ask(page, question)
      const turn = page.getByTestId("chat-turn").last()
      await expect(turn.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 15_000 })
      await expect(turn.getByTestId("visual")).toHaveAttribute("data-kind", kind)
      expect(await turn.getByTestId(mark).count()).toBeGreaterThan(0)
    }
    // Heatmap cells print their exact values (no hover needed) and add up to the key figure.
    const turn = page.getByTestId("chat-turn").nth(0)
    const total = Number(await turn.getByTestId("fact-f1").getAttribute("data-value"))
    const cells = await turn.getByTestId("heat-cell").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-calls"))))
    expect(cells.reduce((a, b) => a + b, 0)).toBe(total)
  })

  test("a visual never appears for an out-of-scope territory or an aggregate-only role", async ({ page }) => {
    await page.goto("/chat")
    await ask(page, "Show calls by month for SE-03")
    await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 15_000 })
    await expect(page.getByTestId("visual")).toHaveCount(0)
    await expect(page.getByTestId("visual-pending")).toHaveCount(0)
    await page.addInitScript(() => window.localStorage.setItem("a2g.local.userId", "u-exec-all"))
    await page.goto("/chat")
    await ask(page, "Show calls by month")
    await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 15_000 })
    await expect(page.getByTestId("visual")).toHaveCount(0)
  })
})
