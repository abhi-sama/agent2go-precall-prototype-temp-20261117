import { expect, test, type Page } from "@playwright/test"

/**
 * Suggested preferences (docs/adr/0023): after the same ask three times the agent offers one preference on a card with
 * Remember and Dismiss, once per conversation; Remember saves it, Dismiss means it is not offered again, and asking "what
 * have you noticed?" shows it on request. Nothing is saved without a click. Runs against the mock adapter (the same
 * AppSync operations as the BE); never touches CopilotKit's cloud.
 */

const memory = (page: Page) => page.getByRole("dialog", { name: "What the agent remembers" })
const ASK = "How many calls in the last 90 days?"
const SUGGESTED = "Default to the last 90 days"

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
      window.localStorage.removeItem("a2g.mock.agentMemoryDismissed")
      window.sessionStorage.setItem("a2g.test.seeded", "1")
    }
  })
})

// Each answer streams for a few seconds, and these flows ask up to ten questions.
test.setTimeout(120_000)

test.afterEach(() => {
  expect(requests.filter((url) => /copilotkit\.ai|copilotcloud|scarf\.sh/i.test(url))).toEqual([])
  expect(problems).toEqual([])
})

/** One question, answered: the next one is only sent after the last turn has finished. */
async function ask(page: Page, text: string) {
  const before = await page.getByTestId("chat-turn").count()
  await page.getByTestId("chat-input").fill(text)
  await page.getByTestId("chat-send").click()
  await expect(page.getByTestId("chat-turn")).toHaveCount(before + 1, { timeout: 20_000 })
  await expect(page.getByTestId("chat-turn").last()).toHaveAttribute("data-status", "done", { timeout: 20_000 })
}

const askThreeTimes = async (page: Page) => {
  for (let i = 0; i < 3; i++) await ask(page, ASK)
}

async function openMemory(page: Page) {
  await page.getByTestId("chat-memory").click()
  await expect(memory(page)).toBeVisible()
  return memory(page)
}

test("two asks are not a habit; the third offers one preference, and nothing is saved until Remember", async ({ page }) => {
  await page.goto("/chat")
  await ask(page, ASK)
  await ask(page, ASK)
  await expect(page.getByTestId("memory-suggestion")).toHaveCount(0)

  await ask(page, ASK)
  const card = page.getByTestId("memory-suggestion")
  await expect(card).toHaveCount(1)
  await expect(card.getByTestId("memory-suggestion-reason")).toHaveText("You asked for the last 90 days 3 times.")
  await expect(card.getByTestId("memory-suggestion-text")).toContainText(SUGGESTED)
  await expect(card).toContainText("Nothing is saved unless you choose Remember.")
  await expect(card.getByRole("button", { name: "Remember" })).toBeVisible()
  await expect(card.getByRole("button", { name: "Dismiss" })).toBeVisible()

  let sheet = await openMemory(page)
  await expect(sheet.getByTestId("memory-empty")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(memory(page)).toBeHidden()

  // Once per conversation: a fourth ask in the same conversation offers nothing more.
  await ask(page, ASK)
  await expect(page.getByTestId("memory-suggestion")).toHaveCount(1)

  await card.getByRole("button", { name: "Remember" }).click()
  await expect(card).toHaveAttribute("data-state", "remembered")
  await expect(card.getByTestId("memory-suggestion-result")).toContainText("Remembered.")
  await expect(card.getByRole("button")).toHaveCount(0)
  // The result takes focus when the clicked button goes away, so focus never falls to the page behind.
  await expect(card.getByTestId("memory-suggestion-result")).toBeFocused()

  sheet = await openMemory(page)
  await expect(sheet.getByTestId("memory-item")).toHaveCount(1)
  await expect(sheet.getByTestId("memory-text")).toHaveText(SUGGESTED)
})

test("Dismiss means it is not offered again, in this conversation or a new one", async ({ page }) => {
  await page.goto("/chat")
  await askThreeTimes(page)
  const card = page.getByTestId("memory-suggestion")
  await expect(card).toHaveCount(1)
  await card.getByRole("button", { name: "Dismiss" }).click()
  await expect(card).toHaveAttribute("data-state", "dismissed")
  await expect(card.getByTestId("memory-suggestion-result")).toContainText("Dismissed.")

  let sheet = await openMemory(page)
  await expect(sheet.getByTestId("memory-empty")).toBeVisible()
  await page.keyboard.press("Escape")

  await page.getByTestId("chat-new").click()
  await askThreeTimes(page)
  await expect(page.getByTestId("memory-suggestion")).toHaveCount(0)

  // Clear-all forgets dismissals too: after it the suggestion is offered afresh.
  await ask(page, "remember I prefer tables")
  await page.getByRole("button", { name: "Approve and save" }).click({ timeout: 20_000 })
  await expect(page.getByText("You can review or delete it under What the agent remembers.", { exact: true })).toBeVisible({ timeout: 20_000 })
  sheet = await openMemory(page)
  await sheet.getByTestId("memory-clear").click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Clear all" }).click()
  await expect(sheet.getByTestId("memory-empty")).toBeVisible()
  await page.keyboard.press("Escape")
  await page.getByTestId("chat-new").click()
  await askThreeTimes(page)
  await expect(page.getByTestId("memory-suggestion")).toHaveCount(1)
})

test("asking what the agent noticed shows it on request, even after an offer in the conversation", async ({ page }) => {
  await page.goto("/chat")
  await askThreeTimes(page)
  await expect(page.getByTestId("memory-suggestion")).toHaveCount(1)

  await ask(page, "What have you noticed about how I work?")
  await expect(page.getByText("Here is what I noticed in this conversation. Nothing is saved unless you choose Remember.")).toBeVisible()
  await expect(page.getByTestId("memory-suggestion")).toHaveCount(2)
  const sheet = await openMemory(page)
  await expect(sheet.getByTestId("memory-empty")).toBeVisible()
})

test("a remembered preference is not suggested again, and a suggestion is keyboard-operable at touch size", async ({ page }) => {
  await page.goto("/chat")
  await askThreeTimes(page)
  const card = page.getByTestId("memory-suggestion")
  const remember = card.getByRole("button", { name: "Remember" })
  if (await page.evaluate(() => matchMedia("(pointer: coarse)").matches)) {
    for (const button of [remember, card.getByRole("button", { name: "Dismiss" })]) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
  await remember.focus()
  await page.keyboard.press("Enter")
  await expect(card).toHaveAttribute("data-state", "remembered")

  await page.getByTestId("chat-new").click()
  await askThreeTimes(page)
  await expect(page.getByTestId("memory-suggestion")).toHaveCount(0)
  const sheet = await openMemory(page)
  await expect(sheet.getByTestId("memory-item")).toHaveCount(1)
})
