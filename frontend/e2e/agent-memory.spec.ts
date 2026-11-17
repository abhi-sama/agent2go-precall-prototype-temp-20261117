import { expect, test, type Page } from "@playwright/test"

/**
 * What the agent remembers (docs/adr/0022): "remember I prefer tables" is proposed on the approval card of ADR 0020,
 * saved only on approval, listed with a delete and a clear-all from the top-bar panel, the docked view and the full
 * screen. Runs against the mock adapter (the same AppSync operations as the BE); never touches CopilotKit's cloud.
 */

const docked = (page: Page) => page.viewportSize()!.width >= 1366
const panel = (page: Page) => page.getByRole(docked(page) ? "complementary" : "dialog", { name: "Ask the agent" })
const memory = (page: Page) => page.getByRole("dialog", { name: "What the agent remembers" })

const requests: string[] = []
const problems: string[] = []

test.beforeEach(async ({ page }) => {
  requests.length = 0
  problems.length = 0
  page.on("request", (request) => requests.push(request.url()))
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`))
  page.on("console", (message) => {
    if (message.type() === "error" || /\[CopilotKit\]|copilotkit\.ai\/pricing|not licensed/i.test(message.text())) problems.push(`${message.type()}: ${message.text()}`)
  })
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem("a2g.test.seeded")) {
      window.localStorage.removeItem("a2g.local.userId")
      window.localStorage.removeItem("a2g.mock.agentMemory")
      window.sessionStorage.setItem("a2g.test.seeded", "1")
    }
  })
})

test.afterEach(() => {
  expect(requests.filter((url) => /copilotkit\.ai|copilotcloud|scarf\.sh/i.test(url))).toEqual([])
  expect(problems).toEqual([])
})

async function ask(page: Page, text: string) {
  await page.getByTestId("chat-input").fill(text)
  await page.getByTestId("chat-send").click()
}

/** Approve the card and wait for the browser to have saved it: the tool runs after the approval run completes. */
async function approveAndWaitForSave(page: Page) {
  await page.getByRole("button", { name: "Approve and save" }).click({ timeout: 20_000 })
  await expect(page.getByText("You can review or delete it under What the agent remembers.", { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId("chat-turn").last()).toHaveAttribute("data-status", "done", { timeout: 20_000 })
}

async function openMemory(page: Page) {
  await page.getByTestId("chat-memory").click()
  await expect(memory(page)).toBeVisible()
  return memory(page)
}

test("the full page: remember on approval, review it, delete it", async ({ page }) => {
  await page.goto("/chat")
  await ask(page, "Remember I prefer tables over charts")
  await expect(page.getByRole("button", { name: "Approve and save" })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText("I prefer tables over charts").first()).toBeVisible()

  // Nothing is saved until the person approves.
  let sheet = await openMemory(page)
  await expect(sheet.getByTestId("memory-empty")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(memory(page)).toBeHidden()

  await approveAndWaitForSave(page)

  sheet = await openMemory(page)
  await expect(sheet.getByTestId("memory-item")).toHaveCount(1)
  await expect(sheet.getByTestId("memory-text")).toHaveText("I prefer tables over charts")
  await expect(sheet.getByTestId("memory-explainer")).toContainText("never data about HCPs, calls or figures")

  // The list survives a reload: it lives in the store, not in the page.
  await page.reload()
  sheet = await openMemory(page)
  await expect(sheet.getByTestId("memory-item")).toHaveCount(1)

  await sheet.getByTestId("memory-delete").click()
  await expect(sheet.getByTestId("memory-empty")).toBeVisible()
  await expect(sheet.getByTestId("memory-item")).toHaveCount(0)
})

test("a rejected approval saves nothing, and an edit is saved as edited", async ({ page }) => {
  await page.goto("/chat")
  await ask(page, "remember default to the last 90 days")
  await expect(page.getByRole("button", { name: "Reject" })).toBeVisible({ timeout: 20_000 })
  await page.getByRole("button", { name: "Reject" }).click()
  await expect(page.getByText("No changes were saved.")).toBeVisible({ timeout: 20_000 })
  let sheet = await openMemory(page)
  await expect(sheet.getByTestId("memory-empty")).toBeVisible()
  await page.keyboard.press("Escape")

  await page.getByTestId("chat-new").click()
  await ask(page, "remember default to the last 90 days")
  await expect(page.getByRole("button", { name: "Approve and save" })).toBeVisible({ timeout: 20_000 })
  await page.getByLabel("Edit text").fill("Default to the last 30 days")
  await approveAndWaitForSave(page)
  sheet = await openMemory(page)
  await expect(sheet.getByTestId("memory-text")).toHaveText("Default to the last 30 days")
})

test("a record fact is refused with no approval card and nothing is stored", async ({ page }) => {
  await page.goto("/chat")
  await ask(page, "Remember HCP-0001 prefers email")
  await expect(page.getByText("I do not save names, record IDs, calls or figures")).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole("button", { name: "Approve and save" })).toHaveCount(0)
  const sheet = await openMemory(page)
  await expect(sheet.getByTestId("memory-empty")).toBeVisible()
})

test("the panel: reachable from the top-bar panel or the docked view, with clear-all behind a confirmation", async ({ page }) => {
  await page.goto("/msl")
  await expect(page.getByTestId("kpi-calls").first()).toBeVisible()
  await page.getByTestId("chat-open").click()
  await expect(panel(page)).toBeVisible()

  for (const text of ["remember I prefer tables", "remember keep briefs to 5 bullets"]) {
    if (text.includes("briefs")) await page.getByTestId("chat-new").click()
    await ask(page, text)
    await approveAndWaitForSave(page)
  }

  const sheet = await panel(page).getByTestId("chat-memory").click().then(() => memory(page))
  await expect(sheet).toBeVisible()
  await expect(sheet.getByTestId("memory-item")).toHaveCount(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)

  if (await page.evaluate(() => matchMedia("(pointer: coarse)").matches)) {
    for (const target of [sheet.getByTestId("memory-delete").first(), sheet.getByTestId("memory-clear")]) expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }

  // Clear all asks first, and "Keep them" has focus, so a stray Enter keeps everything.
  await sheet.getByTestId("memory-clear").click()
  const confirm = page.getByRole("alertdialog", { name: "Clear everything the agent remembers?" })
  await expect(confirm).toBeVisible()
  await expect(confirm.getByRole("button", { name: "Keep them" })).toBeFocused()
  await confirm.getByRole("button", { name: "Keep them" }).click()
  await expect(sheet.getByTestId("memory-item")).toHaveCount(2)

  await sheet.getByTestId("memory-clear").click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Clear all" }).click()
  await expect(sheet.getByTestId("memory-empty")).toBeVisible()

  // Closing returns focus to the control that opened it.
  await page.keyboard.press("Escape")
  await expect(memory(page)).toBeHidden()
  await expect(panel(page).getByTestId("chat-memory")).toBeFocused()
})
