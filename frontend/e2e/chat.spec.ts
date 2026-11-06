import { expect, test } from "@playwright/test"

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.removeItem("a2g.local.userId"))
})

async function ask(page: import("@playwright/test").Page, question: string) {
  await page.getByTestId("chat-input").fill(question)
  await page.getByTestId("chat-send").click()
}

async function openAs(page: import("@playwright/test").Page, userId: string) {
  // The suite's default init script clears local persona state. Register this after it so every
  // navigation retains the requested fixture persona.
  await page.addInitScript((id) => window.localStorage.setItem("a2g.local.userId", id), userId)
  await page.goto("/chat")
}

test.describe("chat panel (mock adapter, iPad viewports)", () => {
  test("small talk stays conversational for every persona", async ({ page }) => {
    const cases = [
      ["u-msl-ne-01", "hi"],
      ["u-dir-ne", "Hi there"],
      ["u-exec-all", "Thanks, that's helpful"],
      ["u-admin-sec", "What can you do today?"],
    ] as const

    for (const [userId, message] of cases) {
      await openAs(page, userId)
      await ask(page, message)
      const turn = page.getByTestId("chat-turn").last()
      await expect(turn.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 15_000 })
      await expect(turn.getByTestId("ai-summary")).toContainText(/help with activity counts/i)
      await expect(turn.getByTestId("ai-summary")).not.toContainText("facts above")
      await expect(turn.getByTestId("source-facts")).toHaveCount(0)
      await expect(turn.getByTestId("citation")).toHaveCount(0)
      await expect(turn.getByTestId("show-rows")).toHaveCount(0)
      await expect(turn.getByTestId("visuals")).toHaveCount(0)
    }
  })

  test("each persona can follow every suggested next question in the rendered chat", async ({ page }) => {
    test.setTimeout(90_000)
    for (const userId of ["u-msl-ne-01", "u-dir-ne", "u-exec-all", "u-admin-sec"]) {
      await openAs(page, userId)
      await ask(page, "How can you help me?")
      const introduction = page.getByTestId("assistant-turn").last()
      await expect(introduction).toHaveAttribute("data-status", "done", { timeout: 15_000 })
      const suggestions = await introduction.getByTestId("suggestion").allInnerTexts()
      expect(suggestions.length).toBeGreaterThan(0)

      for (const label of suggestions) {
        await introduction.getByTestId("suggestion").filter({ hasText: label }).click()
        const turn = page.getByTestId("chat-turn").last()
        await expect(turn.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 15_000 })
        await expect(page.getByTestId("user-message").last()).toHaveText(label)
        await expect(turn.getByTestId("ai-summary")).not.toBeEmpty()
      }
    }
  })

  test("aggregate-only follow-ups do not turn a recorded-response chip into source data", async ({ page }) => {
    for (const [userId, expected] of [
      ["u-exec-all", /source-record data/i],
      ["u-admin-sec", /not available for this administration role/i],
    ] as const) {
      await openAs(page, userId)
      await ask(page, "How can you help me?")
      const introduction = page.getByTestId("assistant-turn").last()
      await expect(introduction).toHaveAttribute("data-status", "done", { timeout: 15_000 })
      await introduction.getByTestId("suggestion").filter({ hasText: "What have HCPs recorded about osimertinib?" }).click()
      const turn = page.getByTestId("chat-turn").last()
      await expect(turn.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 15_000 })
      await expect(turn.getByTestId("ai-summary")).toContainText(expected)
      await expect(turn.getByTestId("source-facts")).toHaveCount(0)
      await expect(turn.getByTestId("citation")).toHaveCount(0)
      await expect(turn.getByTestId("show-rows")).toHaveCount(0)
      await expect(turn.getByTestId("visuals")).toHaveCount(0)
    }
  })

  test("follow-up chips preserve their requested scope and topic", async ({ page }) => {
    await page.goto("/chat")
    await ask(page, "How many calls did I have in the last 90 days?")
    await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 15_000 })

    await page.getByTestId("suggestion").filter({ hasText: "Which territories can I see?" }).last().click()
    const scopeTurn = page.getByTestId("chat-turn").last()
    await expect(scopeTurn.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 15_000 })
    await expect(scopeTurn.getByTestId("source-facts")).toContainText("Territories in your scope")
    await expect(scopeTurn.getByTestId("show-rows")).toHaveCount(0)

    await scopeTurn.getByTestId("suggestion").filter({ hasText: "What have HCPs recorded about osimertinib?" }).click()
    const topicTurn = page.getByTestId("chat-turn").last()
    await expect(topicTurn.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 15_000 })
    await expect(topicTurn.getByTestId("source-facts")).toContainText("Recorded responses mentioning osimertinib")
    await expect(topicTurn.getByTestId("citation")).toHaveCount(1)
  })

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

  test("executive activity uses a suppressed aggregate chart, never source rows", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("a2g.local.userId", "u-exec-all"))
    await page.goto("/chat")
    await ask(page, "Show calls by month")
    await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 15_000 })
    await expect(page.getByTestId("visual")).toHaveAttribute("data-kind", "line")
    await expect(page.getByTestId("visual-title")).toContainText("shown aggregates")
    await expect(page.getByTestId("sample-limitations")).toContainText("withheld")
    await expect(page.getByTestId("aggregate-only-note")).toBeVisible()
    await expect(page.getByTestId("fact-f1")).toContainText("aggregate source")
    await expect(page.getByTestId("fact-f1")).not.toContainText("source records")
    await expect(page.getByTestId("ai-summary")).toContainText("individual records are not available")
    await expect(page.getByTestId("show-rows")).toHaveCount(0)
    const points = await page.getByTestId("line-point").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-value"))))
    expect(points).toEqual([15, 17])
  })

  test("a trend question draws a line whose values add up to the key figure; a plain count stays text and key figures", async ({ page }) => {
    await page.goto("/chat")
    await ask(page, "How many calls did I have in the last 90 days?")
    await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 15_000 })
    await expect(page.getByTestId("visual")).toHaveCount(0)
    await expect(page.getByTestId("source-facts")).toBeVisible()
    await expect(page.getByTestId("chat-fact-chart")).toHaveCount(0)

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

test.describe("Show rows (mock adapter, iPad viewports)", () => {
  const COUNT_QUESTION = "How many calls did I have in the last 90 days?"
  const done = async (page: import("@playwright/test").Page) => {
    await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 15_000 })
  }
  const numbers = (page: import("@playwright/test").Page, column: string) =>
    page.locator(`[data-testid="answer-row"] [data-column="${column}"]`).evaluateAll((els) => els.map((e) => Number(e.textContent)))

  test("is collapsed under a count, opens to exactly the rows counted, and says they match the answer", async ({ page }) => {
    await page.goto("/chat")
    await ask(page, COUNT_QUESTION)
    await done(page)
    const calls = Number(await page.getByTestId("fact-f1").getAttribute("data-value"))
    const hcps = Number(await page.getByTestId("fact-f2").getAttribute("data-value"))
    const responses = Number(await page.getByTestId("fact-f3").getAttribute("data-value"))

    // Hidden by default: nothing is rendered, so chat stays readable on an iPad.
    await expect(page.getByTestId("answer-rows-toggle")).toHaveAttribute("aria-expanded", "false")
    await expect(page.getByTestId("answer-rows-table")).toHaveCount(0)
    await page.getByTestId("answer-rows-toggle").click()
    await expect(page.getByTestId("answer-rows-toggle")).toHaveAttribute("aria-expanded", "true")
    await expect(page.getByTestId("answer-rows-table")).toBeVisible()

    // One set per figure; each set's table adds up to its tile.
    const options = page.getByTestId("row-set-option")
    expect(await options.evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-count"))))).toEqual([calls, hcps, responses])
    for (const [index, expected] of [calls, hcps, responses].entries()) {
      await options.nth(index).click()
      await expect(page.getByTestId("answer-rows-range")).toContainText(`of ${expected.toLocaleString("en-US")}`)
      await expect(page.getByTestId("answer-rows-match")).toHaveAttribute("data-match", "true")
      await expect(page.getByTestId("answer-rows-match")).toContainText("matching the figure in the answer")
      expect(await page.getByTestId("answer-row").count()).toBe(Math.min(25, expected))
    }

    // Collapses again.
    await page.getByTestId("answer-rows-toggle").click()
    await expect(page.getByTestId("answer-rows-table")).toHaveCount(0)
  })

  test("sorts by any column and pages through every row exactly once", async ({ page }) => {
    await page.goto("/chat")
    await ask(page, COUNT_QUESTION)
    await done(page)
    const calls = Number(await page.getByTestId("fact-f1").getAttribute("data-value"))
    await page.getByTestId("answer-rows-toggle").click()
    await expect(page.getByTestId("answer-rows-table")).toBeVisible()

    // A numeric column sorts largest first, then flips.
    await page.locator('[data-testid="answer-rows-sort"][data-column="minutes"]').click()
    await expect(page.getByTestId("answer-rows-table")).toHaveAttribute("data-sort-by", "minutes")
    await expect(page.getByTestId("answer-rows-table")).toHaveAttribute("data-sort-dir", "DESC")
    await expect(page.locator('th[aria-sort="descending"]')).toContainText("Minutes")
    let minutes = await numbers(page, "minutes")
    expect(minutes).toEqual([...minutes].sort((a, b) => b - a))
    await page.locator('[data-testid="answer-rows-sort"][data-column="minutes"]').click()
    await expect(page.getByTestId("answer-rows-table")).toHaveAttribute("data-sort-dir", "ASC")
    await expect(page.locator('th[aria-sort="ascending"]')).toContainText("Minutes")
    minutes = await numbers(page, "minutes")
    expect(minutes).toEqual([...minutes].sort((a, b) => a - b))

    // Page through the whole set: every call once, none missing, pages in order.
    const seen: string[] = []
    const pages = Math.ceil(calls / 25)
    for (let p = 0; p < pages; p++) {
      // Wait for this page (the previous one stays on screen, dimmed, while the next loads).
      await expect(page.getByTestId("answer-rows-range")).toContainText(`${(p * 25 + 1).toLocaleString("en-US")}–`)
      seen.push(...(await page.getByTestId("answer-row").evaluateAll((els) => els.map((e) => e.getAttribute("data-row-id")!))))
      if (p < pages - 1) await page.getByTestId("answer-rows-next").click()
    }
    await expect(page.getByTestId("answer-rows-next")).toBeDisabled()
    expect(seen).toHaveLength(calls)
    expect(new Set(seen).size).toBe(calls)
    await expect(page.getByTestId("answer-rows-range")).toContainText(`of ${calls.toLocaleString("en-US")}`)
    await page.getByTestId("answer-rows-prev").click()
    await expect(page.getByTestId("answer-rows-next")).toBeEnabled()
  })

  test("exports the rows as a labelled CSV, after the server re-checks access, and says it was audited", async ({ page }) => {
    await page.goto("/chat")
    await ask(page, COUNT_QUESTION)
    await done(page)
    const hcps = Number(await page.getByTestId("fact-f2").getAttribute("data-value"))
    await page.getByTestId("answer-rows-toggle").click()
    await page.getByTestId("row-set-option").nth(1).click()
    await expect(page.getByTestId("answer-rows-table")).toBeVisible()
    const download = page.waitForEvent("download")
    await page.getByTestId("answer-rows-export").click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/^msl-agent-rows-hcps-.*\.csv$/)
    const text = await (await import("node:fs/promises")).readFile((await file.path())!, "utf8")
    expect(text.split("\n")[0]).toMatch(/^# \[SOURCE\]/)
    const lines = text.trimEnd().split("\n")
    const header = lines.findIndex((l) => l.startsWith("HCP,Specialty"))
    expect(lines.length - header - 1).toBe(hcps)
    await expect(page.getByTestId("answer-rows-exported")).toContainText(`${hcps.toLocaleString("en-US")} rows exported`)
    await expect(page.getByTestId("answer-rows-exported")).toContainText("access audit")
  })

  test("without the export permission the rows are still readable but there is no export", async ({ page }) => {
    await page.goto("/chat?scenario=no-export")
    await ask(page, COUNT_QUESTION)
    await done(page)
    await page.getByTestId("answer-rows-toggle").click()
    await expect(page.getByTestId("answer-rows-table")).toBeVisible()
    await expect(page.getByTestId("answer-rows-export")).toHaveCount(0)
    await expect(page.getByTestId("answer-rows-export-denied")).toContainText("not permitted")
  })

  test("an aggregate-only Executive never sees Show rows and gets a clear note", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("a2g.local.userId", "u-exec-all"))
    await page.goto("/chat")
    await ask(page, "Which topics are rising across regions?")
    await done(page)
    await expect(page.getByTestId("answer-rows")).toHaveCount(0)
    await expect(page.getByTestId("answer-rows-toggle")).toHaveCount(0)
    await expect(page.getByTestId("aggregate-only-note")).toContainText("Rows are not available for this answer")
    await expect(page.getByTestId("aggregate-only-note")).toContainText("does not grant source-row access")
  })

  test("a rows service error shows a retryable message, not an empty table", async ({ page }) => {
    await page.goto("/chat")
    await ask(page, COUNT_QUESTION)
    await done(page)
    // The scripted run is done; from here the service is down.
    await page.evaluate(() => window.history.replaceState(null, "", "/chat?scenario=error"))
    await page.getByTestId("answer-rows-toggle").click()
    await expect(page.getByTestId("answer-rows-error")).toContainText("could not be loaded")
    await expect(page.getByTestId("answer-rows-table")).toHaveCount(0)
  })

  test("touch targets in the rows panel are at least 44pt, and nothing scrolls sideways", async ({ page }) => {
    await page.goto("/chat")
    await ask(page, COUNT_QUESTION)
    await done(page)
    await page.getByTestId("answer-rows-toggle").click()
    await expect(page.getByTestId("answer-rows-table")).toBeVisible()
    for (const id of ["answer-rows-toggle", "answer-rows-export", "answer-rows-next"]) {
      const box = (await page.getByTestId(id).boundingBox())!
      expect(box.height, id).toBeGreaterThanOrEqual(44)
    }
    for (const target of await page.getByTestId("answer-rows-sort").all()) expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    for (const target of await page.getByTestId("row-set-option").all()) expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
  })
})
