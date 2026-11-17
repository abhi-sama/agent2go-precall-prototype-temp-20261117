import { expect, test, type Page } from "@playwright/test"

/**
 * Ask the agent on CopilotKit (docs/adr/0018), at every size in the viewport matrix: every iPad in both orientations
 * and every MacBook and desktop size. The panel is CopilotKit's popup below 1366px and its sidebar beside the page from
 * 1366px; `/chat` is its full-page chat. An answer arrives through the mock adapter (the same `startChatRun` and
 * `chatEvents` contract as AppSync) with its evidence, and CopilotKit makes no request to its own servers.
 */

const isTouch = (page: Page) => page.evaluate(() => matchMedia("(pointer: coarse)").matches)
const docked = (page: Page) => page.viewportSize()!.width >= 1366
const panel = (page: Page) => page.getByRole(docked(page) ? "complementary" : "dialog", { name: "Ask the agent" })

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
      window.sessionStorage.setItem("a2g.test.seeded", "1")
    }
  })
})

test.afterEach(() => {
  // Nothing goes to CopilotKit's cloud: no runtime, no licence check, no telemetry, no CDN.
  expect(requests.filter((url) => /copilotkit\.ai|copilotcloud|scarf\.sh/i.test(url))).toEqual([])
  expect(problems).toEqual([])
})

/** `saved`: a conversation reopened from the list. Its answer has everything but the tool rows, which are not saved. */
async function expectAnswer(page: Page, { saved = false } = {}) {
  const turn = page.getByTestId("chat-turn").last()
  await expect(turn).toHaveAttribute("data-status", "done", { timeout: 20_000 })
  if (saved) await expect(turn.getByTestId("tool-call")).toHaveCount(0)
  else await expect(turn.getByTestId("tool-call").first()).toHaveAttribute("data-status", "complete")
  const calls = Number(await turn.getByTestId("fact-f1").getAttribute("data-value"))
  expect(calls).toBeGreaterThan(0)
  await expect(turn.getByTestId("ai-summary")).toContainText(String(calls))
  await expect(turn.getByTestId("inline-citation").first()).toBeVisible()
  await expect(turn.getByRole("button", { name: "Copy answer" })).toBeVisible()
  for (const kind of ["fact", "ai"]) await expect(turn.locator(`[data-provenance="${kind}"]`).first()).toBeVisible()
  await expect(page.getByRole("region", { name: "You could ask next" })).toBeVisible()
  return turn
}

async function noSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
}

test("the panel: CopilotKit's popup, or its sidebar beside the page at docking width", async ({ page }) => {
  await page.goto("/msl")
  await expect(page.getByTestId("kpi-calls").first()).toBeVisible()
  await page.getByTestId("chat-open").click()
  await expect(panel(page)).toBeVisible()
  await expect(page.getByTestId(docked(page) ? "chat-dock" : "chat-drawer")).toHaveCount(1)
  await expect(page.getByTestId("chat-empty")).toBeVisible()
  await expect(page.getByTestId("chat-chip").first()).toHaveAttribute("data-kind", "screen")

  await page.getByTestId("starter").first().click()
  await expectAnswer(page)
  await noSidewaysScroll(page)

  const box = (await panel(page).boundingBox())!
  const size = page.viewportSize()!
  if (docked(page)) {
    // The page is narrowed, not covered.
    expect(Math.round(box.x + box.width)).toBe(size.width)
    const kpi = (await page.getByTestId("kpi-calls").first().boundingBox())!
    expect(kpi.x + kpi.width).toBeLessThanOrEqual(box.x)
  } else {
    const trigger = (await page.getByTestId("chat-open").boundingBox())!
    expect(box.y).toBeGreaterThan(trigger.y + trigger.height)
    expect(box.x + box.width).toBeLessThanOrEqual(size.width)
  }

  if (await isTouch(page)) {
    for (const [name, target] of [
      ["send", page.getByTestId("chat-send")],
      ["close", panel(page).getByRole("button", { name: "Close" })],
      ["suggestion", page.getByTestId("suggestion")],
      ["thumbs up", page.getByTestId("rate-up")],
    ] as const) {
      const target_ = (await target.first().boundingBox())!
      expect(target_.height, name).toBeGreaterThanOrEqual(44)
    }
  }

  await panel(page).getByRole("button", { name: "Close" }).click()
  await expect(panel(page)).toBeHidden()
  expect(await page.evaluate(() => getComputedStyle(document.body).marginInlineEnd)).toBe("0px")
})

test("the full page: CopilotKit's chat, the same conversation after a reload, and starting over", async ({ page }) => {
  await page.goto("/chat")
  await expect(page.getByRole("heading", { level: 1, name: "Ask the agent" })).toBeVisible()
  await expect(page.getByTestId("chat-open")).toHaveCount(0)
  await page.getByTestId("chat-input").fill("How many calls did I have in the last 90 days?")
  await page.getByTestId("chat-send").click()
  await expect(page.getByTestId("user-message")).toContainText("How many calls")
  await expectAnswer(page)
  await noSidewaysScroll(page)

  // The OSS message toolbar regenerates in place through the existing AppSync agent; it never opens a CopilotKit runtime.
  await page.getByRole("button", { name: "Regenerate" }).click()
  await expectAnswer(page)
  await expect(page.getByTestId("chat-turn")).toHaveCount(1)

  // Editing replaces this turn and starts the edited question through the same AppSync path.
  await page.getByRole("button", { name: "Edit" }).click()
  await page.getByLabel("Edit question").fill("How many calls did I have in the last 30 days?")
  await page.getByTestId("chat-edit-send").click()
  await expect(page.getByTestId("user-message")).toContainText("How many calls did I have in the last 30 days?")
  await expectAnswer(page)

  await page.reload()
  await expect(page.getByTestId("chat-turn")).toHaveCount(1)
  await expect(page.getByTestId("chat-turn")).toHaveAttribute("data-status", "done")

  await page.getByTestId("chat-new").click()
  await expect(page.getByTestId("chat-turn")).toHaveCount(0)
  await expect(page.getByTestId("chat-empty")).toBeVisible()
})

test("the full page: a proposed write can be edited, approved, or rejected", async ({ page }) => {
  await page.goto("/chat")
  await page.getByTestId("chat-input").fill("save post-call output: Original note")
  await page.getByTestId("chat-send").click()
  await expect(page.getByRole("button", { name: "Approve and save" })).toBeVisible({ timeout: 20_000 })
  const editor = page.getByLabel("Edit notes")
  await editor.fill("Edited note")
  await page.getByRole("button", { name: "Approve and save" }).click()
  await expect(page.getByTestId("chat-turn").last()).toHaveAttribute("data-status", "done", { timeout: 20_000 })

  await page.getByTestId("chat-new").click()
  await page.getByTestId("chat-input").fill("save post-call output: Do not save")
  await page.getByTestId("chat-send").click()
  await expect(page.getByRole("button", { name: "Reject" })).toBeVisible({ timeout: 20_000 })
  await page.getByRole("button", { name: "Reject" }).click()
  await expect(page.getByText("No changes were saved.")).toBeVisible({ timeout: 20_000 })
})

const FIRST_QUESTION = "How many calls did I have in the last 90 days?"
const SECOND_QUESTION = "Which territories can I see?"

async function ask(page: Page, question: string) {
  await page.getByTestId("chat-input").fill(question)
  await page.getByTestId("chat-send").click()
  await expect(page.getByTestId("user-message").last()).toContainText(question)
}

test("earlier conversations in the panel: ask, start a new conversation, reopen the first and see its answer", async ({ page }) => {
  await page.goto("/msl")
  await expect(page.getByTestId("kpi-calls").first()).toBeVisible()
  await page.getByTestId("chat-open").click()
  await expect(panel(page)).toBeVisible()

  // Nothing is saved yet: the list says so, and Back returns to the (empty) conversation.
  await page.getByTestId("chat-history-toggle").click()
  await expect(page.getByTestId("chat-history-empty")).toBeVisible()
  await page.getByTestId("chat-history-back").click()
  await expect(page.getByTestId("chat-history")).toHaveCount(0)

  await ask(page, FIRST_QUESTION)
  const firstAnswer = await expectAnswer(page)
  const calls = await firstAnswer.getByTestId("fact-f1").getAttribute("data-value")

  await page.getByTestId("chat-new").click()
  await expect(page.getByTestId("chat-turn")).toHaveCount(0)
  await ask(page, SECOND_QUESTION)
  await expect(page.getByTestId("chat-turn").last()).toHaveAttribute("data-status", "done", { timeout: 20_000 })

  // The list: both conversations, newest first, each titled by its first question, with a date; this one is marked.
  await page.getByTestId("chat-history-toggle").click()
  const view = page.getByTestId("chat-history")
  await expect(view).toBeVisible()
  await expect(view.getByRole("heading", { name: "Conversations" })).toBeVisible()
  await expect(view.getByTestId("chat-history-back")).toBeFocused()
  const items = view.getByTestId("chat-thread-item")
  await expect(items).toHaveCount(2)
  await expect(items.nth(0)).toContainText(SECOND_QUESTION)
  await expect(items.nth(0)).toHaveAttribute("aria-current", "true")
  await expect(items.nth(1)).toContainText(FIRST_QUESTION)
  await expect(items.nth(1)).toContainText("1 question")
  await expect(items.nth(1).locator("time")).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}T/)

  // The conversation behind the list cannot be reached while it shows.
  await expect(page.getByTestId("chat-input").locator("xpath=ancestor-or-self::*[@inert]")).toHaveCount(1)
  await noSidewaysScroll(page)
  if (await isTouch(page)) {
    for (const [name, target] of [
      ["back", view.getByTestId("chat-history-back")],
      ["new conversation", view.getByTestId("chat-history-new")],
      ["conversation", items.first()],
      ["toggle", page.getByTestId("chat-history-toggle")],
    ] as const) {
      expect((await target.boundingBox())!.height, name).toBeGreaterThanOrEqual(44)
    }
  }

  // Reopen the first conversation: its saved answer comes back with its figures and citations.
  await items.nth(1).click()
  await expect(view).toHaveCount(0)
  await expect(page.getByTestId("chat-turn")).toHaveCount(1)
  await expect(page.getByTestId("user-message")).toContainText(FIRST_QUESTION)
  const reopened = await expectAnswer(page, { saved: true })
  expect(await reopened.getByTestId("fact-f1").getAttribute("data-value")).toBe(calls)

  // It is a live conversation again: the next question continues it (two turns), and it is still the first in the list.
  await ask(page, SECOND_QUESTION)
  await expect(page.getByTestId("chat-turn")).toHaveCount(2)
  await expect(page.getByTestId("chat-turn").last()).toHaveAttribute("data-status", "done", { timeout: 20_000 })
  await page.getByTestId("chat-history-toggle").click()
  await expect(page.getByTestId("chat-thread-item")).toHaveCount(2)
  await expect(page.getByTestId("chat-thread-item").first()).toContainText(FIRST_QUESTION)
  await expect(page.getByTestId("chat-thread-item").first()).toContainText("2 questions")

  // Escape goes back one step, to the control that opened the list, and leaves the panel open.
  await page.keyboard.press("Escape")
  await expect(page.getByTestId("chat-history")).toHaveCount(0)
  await expect(page.getByTestId("chat-history-toggle")).toBeFocused()
  await expect(panel(page)).toBeVisible()

  // "New conversation" from the list starts an empty one and closes the list.
  await page.getByTestId("chat-history-toggle").click()
  await page.getByTestId("chat-history-new").click()
  await expect(page.getByTestId("chat-history")).toHaveCount(0)
  await expect(page.getByTestId("chat-empty")).toBeVisible()
})

test("earlier conversations on the full page: the list beside the chat reopens a conversation", async ({ page }) => {
  await page.goto("/chat")
  const rail = page.getByTestId("chat-history-rail")
  await expect(rail).toBeVisible()
  await expect(rail.getByTestId("chat-history-empty")).toBeVisible()
  // The panel's control is for narrow screens; here the list is already on the page.
  await expect(page.getByTestId("chat-history-toggle")).toBeHidden()

  await ask(page, FIRST_QUESTION)
  await expectAnswer(page)
  await page.getByTestId("chat-new").click()
  await ask(page, SECOND_QUESTION)
  await expect(page.getByTestId("chat-turn").last()).toHaveAttribute("data-status", "done", { timeout: 20_000 })

  const items = rail.getByTestId("chat-thread-item")
  await expect(items).toHaveCount(2)
  await expect(items.nth(0)).toContainText(SECOND_QUESTION)
  await expect(items.nth(1)).toContainText(FIRST_QUESTION)
  await noSidewaysScroll(page)

  await items.nth(1).click()
  await expect(page.getByTestId("user-message")).toContainText(FIRST_QUESTION)
  await expect(page.getByTestId("chat-turn")).toHaveCount(1)
  await expectAnswer(page, { saved: true })
  await expect(items.nth(1)).toHaveAttribute("aria-current", "true")

  // The reopened conversation is the one a reload brings back.
  await page.reload()
  await expect(page.getByTestId("user-message")).toContainText(FIRST_QUESTION)
  await expect(page.getByTestId("chat-turn")).toHaveCount(1)
})
