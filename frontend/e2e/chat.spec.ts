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

  test("executive gets a plain aggregate-only answer, not data", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("a2g.local.userId", "u-exec-all"))
    await page.goto("/chat")
    await ask(page, "How many calls were there?")
    await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 15_000 })
    await expect(page.getByTestId("ai-summary")).toContainText("not available for your role")
    await expect(page.getByTestId("source-facts")).toHaveCount(0)
  })
})
