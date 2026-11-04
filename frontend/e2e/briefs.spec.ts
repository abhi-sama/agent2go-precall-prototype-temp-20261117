import { expect, test, type Page } from "@playwright/test"

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.removeItem("a2g.local.userId"))
})

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

async function generate(page: Page) {
  await page.goto("/msl/briefs")
  await page.getByTestId("brief-hcp-search").fill("call")
  await page.getByTestId("brief-hcp-search").press("Enter")
  await page.getByTestId("brief-pick-HCP-0001").click()
  await expect(page.getByTestId("brief-selected-name")).toContainText("Call system HCP 0001")
  await expect(page.getByTestId("brief-generate")).toBeDisabled()
  await page.getByTestId("brief-new-objective").fill("Understand how the care team weighs access evidence")
  await page.getByTestId("brief-generate").click()
  await expect(page.getByTestId("brief-generating")).toBeVisible()
  await expect(page.getByTestId("brief")).toBeVisible({ timeout: 15_000 })
}

test.describe("Pre-call brief", () => {
  test("exports a server-authorized printable snapshot with scope, dates, citations and generation time", async ({ page }) => {
    await page.addInitScript(() => {
      window.print = () => { document.documentElement.dataset.printed = "true" }
    })
    await generate(page)
    await page.getByTestId("brief-export").click()
    await expect(page.getByTestId("brief-print-document")).toContainText("Scope")
    await expect(page.getByTestId("brief-print-document")).toContainText("Record date range")
    await expect(page.getByTestId("brief-print-document")).toContainText("Generated")
    await expect(page.getByTestId("brief-print-document")).toContainText("Source citations")
    await expect.poll(() => page.locator("html").getAttribute("data-printed")).toBe("true")
  })

  test("select an HCP, add an objective, generate: every statement is source-linked and suggestions are labelled generated", async ({ page }) => {
    await generate(page)
    await expect(page.getByTestId("brief-hcp-name")).toContainText("Call system HCP 0001")
    await expect(page.getByTestId("brief-scope")).toContainText("NE-01")
    await expect(page.getByTestId("brief-data-through")).not.toHaveText("Not recorded")
    await expect(page.getByTestId("brief-generated-at")).toContainText("UTC")
    await expect(page.getByTestId("brief-stale")).toHaveCount(0)

    const statements = page.getByTestId("statement")
    expect(await statements.count()).toBeGreaterThan(3)
    for (const evidenceCount of await statements.evaluateAll((els) => els.map((el) => Number(el.getAttribute("data-evidence-count"))))) {
      expect(evidenceCount).toBeGreaterThan(0)
    }
    await expect(page.getByTestId("prompts-label")).toContainText("Generated")
    await expect(page.getByTestId("agenda-label")).toContainText("Generated")
    await expect(page.getByTestId("brief-prompts-item").first()).toContainText("Generated")
    await expect(page.getByTestId("brief-missing")).toBeVisible()
    await noHorizontalScroll(page)
  })

  test("a cited record opens as a source record", async ({ page }) => {
    await generate(page)
    await page.getByTestId("cite-CALL-0001").first().click()
    await expect(page.getByTestId("citation-sheet")).toBeVisible()
    await expect(page.getByTestId("citation-fields")).toContainText("CALL-0001")
  })

  test("agenda and prompts can be edited, extended and saved; generated labels survive", async ({ page }) => {
    await generate(page)
    await page.getByRole("button", { name: "Edit prompt 1" }).click()
    await page.getByLabel("Prompt text").fill("My reworded question?")
    await page.getByRole("button", { name: "Done editing prompt 1" }).click()
    await page.getByRole("button", { name: "Add agenda item" }).click()
    await page.getByLabel("Agenda item text").fill("Ask about scheduling")
    await expect(page.getByTestId("brief-save-bar")).toBeVisible()
    await page.getByTestId("brief-save").click()
    await expect(page.getByText("Changes saved")).toBeVisible()
    await expect(page.getByTestId("brief-save-bar")).toHaveCount(0)
    await expect(page.getByTestId("brief-prompts-item").first()).toContainText("Generated · edited")
    await expect(page.getByTestId("brief-agenda-item").last()).toContainText("Added by you")
  })

  test("reopening shows the stale badge after a newer load, and regenerating clears it", async ({ page }) => {
    await page.goto("/msl/briefs?scenario=stale")
    await expect(page.getByTestId("my-brief-stale").first()).toContainText("Newer data available - regenerate")
    await page.getByTestId("my-brief-br-20261103090000-aaaaaaaa").click()
    await expect(page.getByTestId("brief-stale")).toContainText("Newer data available - regenerate")
    await page.getByTestId("brief-regenerate").click()
    await expect(page.getByText("Brief regenerated")).toBeVisible()
    await expect(page.getByTestId("brief-stale")).toHaveCount(0)
    await expect(page.getByTestId("brief")).toBeVisible()
  })

  test("a brief for an HCP the viewer can no longer see is listed without detail and denied on open", async ({ page }) => {
    await page.goto("/msl/briefs")
    const row = page.getByTestId("my-brief-br-20261102090000-bbbbbbbb")
    await expect(row).toContainText("No longer available")
    await expect(row).not.toContainText("HCP-0099")
    await row.click()
    await expect(page.getByTestId("brief-denied")).toContainText("no longer have access")
    await expect(page.getByTestId("brief")).toHaveCount(0)
  })

  test("touch targets are at least 44pt and nothing overflows", async ({ page }) => {
    await page.goto("/msl/briefs")
    await expect(page.getByTestId("my-briefs")).toBeVisible()
    for (const locator of [page.getByTestId("brief-generate"), page.getByTestId("brief-hcp-search"), page.getByTestId("my-brief-br-20261103090000-aaaaaaaa")]) {
      const box = await locator.boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }
    await page.getByTestId("my-brief-br-20261103090000-aaaaaaaa").click()
    await expect(page.getByTestId("brief")).toBeVisible()
    for (const name of ["Edit prompt 1", "Remove prompt 1", "Add prompt"]) {
      const box = await page.getByRole("button", { name }).boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(44)
      expect(box!.width).toBeGreaterThanOrEqual(44)
    }
    await noHorizontalScroll(page)
  })
})
