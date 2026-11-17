import { expect, test, type Page } from "@playwright/test"

/**
 * Shared state and page context in Ask the agent (docs/adr/0019), at every size in the viewport matrix. The chat reads
 * the page (its name, filters and headline figures), shows the agent's steps while it works, and offers the agent's
 * proposal for the page's filters, which changes nothing until the person applies it. The mock adapter speaks the same
 * `startChatRun` / `chatEvents` contract as AppSync; CopilotKit makes no request to its own servers.
 */

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
  expect(requests.filter((url) => /copilotkit\.ai|copilotcloud|scarf\.sh/i.test(url))).toEqual([])
  expect(problems).toEqual([])
})

async function ask(page: Page, question: string) {
  await page.getByTestId("chat-input").fill(question)
  await page.getByTestId("chat-send").click()
  await expect(page.getByTestId("chat-turn").last()).toHaveAttribute("data-status", "done", { timeout: 20_000 })
}

const pagesSent = (page: Page) => page.evaluate(() => (globalThis as { __a2gMockChatPages?: unknown[] }).__a2gMockChatPages ?? [])

test("page context: the question carries the page's name, filters and printed figures, and no persona", async ({ page }) => {
  await page.goto("/msl")
  await expect(page.getByTestId("kpi-calls").first()).toBeVisible()
  await page.getByTestId("chat-open").click()
  await expect(panel(page)).toBeVisible()
  await ask(page, "What does this number mean?")
  const [sent] = (await pagesSent(page)) as { label: string; filters: Record<string, string>; figures: { id: string; label: string; value: string }[]; persona?: string }[]
  expect(sent.label).toBe("My territory")
  expect(sent.filters.from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(sent.filters.to).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  const calls = sent.figures.find((figure) => figure.label === "Distinct calls")
  expect(calls?.value).toBe((await page.getByTestId("kpi-calls-value").first().getAttribute("data-value"))!.replace(/\B(?=(\d{3})+(?!\d))/g, ","))
  expect(sent).not.toHaveProperty("persona")
})

test("page context: removing a chip stops that filter being sent", async ({ page }) => {
  await page.goto("/msl")
  await page.getByTestId("chat-open").click()
  await expect(page.getByTestId("chat-chip").filter({ hasText: "–" })).toHaveCount(1)
  await panel(page).getByRole("button", { name: /^Remove .*–/ }).click()
  await ask(page, "What does this number mean?")
  const [sent] = (await pagesSent(page)) as { filters?: Record<string, string> }[]
  expect(sent.filters ?? {}).not.toHaveProperty("from")
})

test("agent state: the steps show while the agent works, then fold into the answer", async ({ page }) => {
  await page.goto("/msl")
  await page.getByTestId("chat-open").click()
  await page.getByTestId("chat-input").fill("How many calls did I have in the last 90 days?")
  await page.getByTestId("chat-send").click()
  const progress = page.getByTestId("agent-progress")
  await expect(progress).toHaveAttribute("data-state", "running", { timeout: 10_000 })
  await expect(progress.getByTestId("progress-step").first()).toContainText("Checking what you can see")
  await expect(page.getByTestId("chat-turn").last()).toHaveAttribute("data-status", "done", { timeout: 20_000 })
  await expect(progress).toHaveAttribute("data-state", "done")
  await progress.getByText("How this was worked out").click()
  await expect(progress.getByTestId("progress-step")).toHaveText([/Checking what you can see/, /Counting your activity/, /Writing the answer/, /Checking every number against your data/])
})

test("shared state: a proposal changes nothing until applied, then the page and the scope chip follow", async ({ page }) => {
  await page.goto("/msl")
  await expect(page.getByTestId("kpi-calls").first()).toBeVisible()
  const ninety = page.getByRole("button", { name: "90 days" })
  await expect(ninety).toHaveAttribute("aria-pressed", "false")
  await page.getByTestId("chat-open").click()
  await ask(page, "Filter the page to territory NE-01 for the last 90 days")
  const card = page.getByTestId("page-proposal")
  await expect(card).toHaveAttribute("data-status", "proposed")
  await expect(page.getByTestId("page-proposal-summary")).toContainText("Territory NE-01")
  // Nothing has changed yet.
  await expect(ninety).toHaveAttribute("aria-pressed", "false")
  await expect(page.getByTestId("chat-chip").filter({ hasText: "Territory NE-01" })).toHaveCount(0)

  await page.getByTestId("proposal-apply").click()
  await expect(card).toHaveAttribute("data-status", "applied")
  await expect(ninety).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByTestId("chat-chip").filter({ hasText: "Territory NE-01" })).toHaveCount(1)

  // The next question is asked from the page as it is now.
  await ask(page, "What does this number mean?")
  const sent = (await pagesSent(page)) as { filters: Record<string, string> }[]
  expect(sent.at(-1)!.filters.territoryId).toBe("NE-01")
})

test("shared state: 'Not now' leaves the page as it was", async ({ page }) => {
  await page.goto("/msl")
  await page.getByTestId("chat-open").click()
  await ask(page, "Please set the dashboard to the last 7 days")
  await page.getByTestId("proposal-dismiss").click()
  await expect(page.getByTestId("page-proposal")).toHaveAttribute("data-status", "dismissed")
  await expect(page.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "false")
})

test("shared state: a territory outside the caller's scope gets no proposal", async ({ page }) => {
  await page.goto("/msl")
  await page.getByTestId("chat-open").click()
  await ask(page, "Filter the page to territory WE-04")
  await expect(page.getByTestId("page-proposal")).toHaveCount(0)
  await expect(page.getByTestId("ai-summary")).toContainText("outside your scope")
})

test("full page: a proposal applied here is on the page when the person goes back", async ({ page }) => {
  await page.goto("/chat")
  await ask(page, "Set the page to the last 90 days")
  await page.getByTestId("proposal-apply").click()
  await expect(page.getByTestId("page-proposal")).toHaveAttribute("data-status", "applied")
  // Client-side navigation: the filters live in the app shell, so a full load would reset them.
  // (Not the brand link: it goes through `/`, outside the shell.) Below the rail's width the navigation is a dialog.
  const menu = page.getByRole("button", { name: "Open navigation" })
  if (await menu.isVisible()) await menu.click()
  await page.getByRole("link", { name: "My territory" }).first().click()
  await page.waitForURL(/\/msl$/)
  await expect(page.getByRole("button", { name: "90 days" })).toHaveAttribute("aria-pressed", "true")
})
