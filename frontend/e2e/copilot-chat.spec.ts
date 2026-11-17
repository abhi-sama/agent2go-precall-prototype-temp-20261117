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

async function expectAnswer(page: Page) {
  const turn = page.getByTestId("chat-turn").last()
  await expect(turn).toHaveAttribute("data-status", "done", { timeout: 20_000 })
  await expect(turn.getByTestId("tool-call").first()).toHaveAttribute("data-status", "complete")
  const calls = Number(await turn.getByTestId("fact-f1").getAttribute("data-value"))
  expect(calls).toBeGreaterThan(0)
  await expect(turn.getByTestId("ai-summary")).toContainText(String(calls))
  await expect(turn.getByTestId("inline-citation").first()).toBeVisible()
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

  await page.reload()
  await expect(page.getByTestId("chat-turn")).toHaveCount(1)
  await expect(page.getByTestId("chat-turn")).toHaveAttribute("data-status", "done")

  await page.getByTestId("chat-new").click()
  await expect(page.getByTestId("chat-turn")).toHaveCount(0)
  await expect(page.getByTestId("chat-empty")).toBeVisible()
})
