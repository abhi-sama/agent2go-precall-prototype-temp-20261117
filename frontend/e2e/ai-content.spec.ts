import { expect, test, type Page } from "@playwright/test"

/**
 * AI-content look (ticket D3): source facts are plain, AI summaries sit on a soft orange card with a sparkle badge and
 * openable citations, suggestions have a dashed outline, and exports carry the same labels. Checked in both styles and
 * all three modes. What a user sees, not token values: the three kinds must differ from each other on screen.
 */
const bg = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).backgroundColor)
/** Computed colours can be oklab(); a canvas pixel gives plain sRGB to compare channels. */
const srgb = (page: Page, color: string) =>
  page.evaluate((c) => {
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!
    ctx.fillStyle = c
    ctx.fillRect(0, 0, 1, 1)
    return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)]
  }, color)
const border = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).borderTopStyle)

const APPEARANCES = [
  { style: "warm", theme: "light", black: false },
  { style: "warm", theme: "dark", black: false },
  { style: "warm", theme: "dark", black: true },
  { style: "clinical", theme: "light", black: false },
  { style: "clinical", theme: "dark", black: false },
  { style: "clinical", theme: "dark", black: true },
]

for (const a of APPEARANCES) {
  const name = `${a.style} / ${a.theme === "light" ? "light" : a.black ? "true black" : "charcoal"}`
  test(`fact, AI summary and suggestion are visibly distinct: ${name}`, async ({ page }) => {
    await page.addInitScript(([appearance, theme]) => {
      window.localStorage.setItem("theme", theme as string)
      window.localStorage.setItem("a2g.appearance", JSON.stringify(appearance))
    }, [{ style: a.style, black: a.black }, a.theme] as const)
    await page.goto("/design")
    await expect(page.locator("[data-provenance]")).toHaveCount(3)
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.style)).toBe(a.style)

    const fact = '[data-provenance="fact"]'
    const ai = '[data-provenance="ai"]'
    const suggestion = '[data-provenance="suggestion"]'
    // Facts are plain: the card colour, no tint. The AI wash and the suggestion wash differ from it and from each other.
    const [fb, ab, sb] = [await bg(page, fact), await bg(page, ai), await bg(page, suggestion)]
    expect(ab, "AI summary tint differs from the plain fact").not.toBe(fb)
    expect(sb, "suggestion tint differs from the plain fact").not.toBe(fb)
    expect(ab, "AI summary tint differs from the suggestion").not.toBe(sb)
    // The AI wash is orange: red clearly above blue.
    const [r, , b] = await srgb(page, ab)
    expect(r).toBeGreaterThan(b)
    expect(await border(page, suggestion)).toBe("dashed")
    expect(await border(page, ai)).toBe("solid")
    await expect(page.locator(`${ai} [data-kind-badge="ai"]`)).toContainText("AI summary")
    await expect(page.locator(`${suggestion} [data-kind-badge="suggestion"]`)).toContainText("Suggestion")
    await expect(page.locator(`${fact} [data-kind-badge="fact"]`)).toContainText("Source")
    // Not colour alone: every kind carries an icon.
    for (const kind of ["fact", "ai", "suggestion"]) await expect(page.locator(`[data-kind-badge="${kind}"] svg`).first()).toBeVisible()
  })
}

test("citations on an AI summary are visible and open the source record (44pt on touch)", async ({ page }) => {
  await page.goto("/chat")
  await page.getByTestId("chat-input").fill("How many calls did I have in the last 90 days?")
  await page.getByTestId("chat-send").click()
  await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 20_000 })
  const summary = page.locator('[data-provenance="ai"]')
  const chip = summary.getByTestId("citation").first()
  await expect(chip).toBeVisible()
  const box = await chip.boundingBox()
  expect(box!.height).toBeGreaterThanOrEqual(44)
  await chip.click()
  await expect(page.getByTestId("citation-sheet")).toBeVisible()
  await expect(page.getByTestId("citation-fields")).toContainText("CALL-")
})

test("an exported answer keeps facts, the AI summary and suggestions in separate labelled blocks", async ({ page }) => {
  await page.goto("/chat")
  await page.getByTestId("chat-input").fill("How many calls did I have in the last 90 days?")
  await page.getByTestId("chat-send").click()
  await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 20_000 })
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-answer").click()])
  const stream = await download.createReadStream()
  let text = ""
  for await (const chunk of stream) text += chunk
  expect(download.suggestedFilename()).toMatch(/\.md$/)
  expect(text).toContain("## [SOURCE] Computed from your data")
  expect(text).toContain("## [AI SUMMARY] Answer")
  expect(text).toContain("Written by AI from the records cited")
  expect(text).toContain("Sources:")
})

test("an exported pre-call brief labels source facts, AI statements and suggestions", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.removeItem("a2g.local.userId"))
  await page.goto("/msl/briefs?brief=br-20261103090000-aaaaaaaa")
  await expect(page.getByTestId("brief")).toBeVisible()
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("brief-export").click()])
  const stream = await download.createReadStream()
  let text = ""
  for await (const chunk of stream) text += chunk
  expect(text).toContain("## [SOURCE] Counted from your records")
  expect(text).toContain("## [AI SUMMARY] What the records show")
  expect(text).toContain("## [SUGGESTION] Discussion prompts")
})

test("printing keeps the AI wash and the dashed outline", async ({ page }) => {
  await page.goto("/design")
  await page.emulateMedia({ media: "print" })
  const colorAdjust = await page.locator('[data-provenance="ai"]').evaluate((el) => getComputedStyle(el).getPropertyValue("print-color-adjust"))
  expect(colorAdjust).toBe("exact")
  expect(await border(page, '[data-provenance="suggestion"]')).toBe("dashed")
})
