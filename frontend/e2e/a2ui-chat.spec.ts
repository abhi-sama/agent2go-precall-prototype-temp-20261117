import { expect, test, type Locator, type Page } from "@playwright/test"
import { collectLayoutReport } from "./support/layout-checks"

/**
 * A2UI surfaces in Ask the agent (docs/adr/0017): a chat answer renders agent-sent A2UI v1.0 surfaces with the
 * allow-listed Astryx catalog (a table of recorded themes, the Adjust this answer form), and a submitted form goes back
 * to the agent as the next chat question through the same path. Runs on every iPad project and the MacBook sizes, in
 * the full-screen chat and in the panel (an overlay drawer below 1366px, the docked pane at 1366px and wider).
 */

test.beforeEach(async ({ page }, info) => {
  test.skip(!/^(ipad-|macbook-)/.test(info.project.name), "A2UI chat coverage runs on the iPad and MacBook projects")
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem("a2g.test.seeded")) {
      window.localStorage.removeItem("a2g.local.userId")
      window.sessionStorage.setItem("a2g.test.seeded", "1")
    }
  })
})

async function openAs(page: Page, userId: string, path = "/chat") {
  await page.addInitScript((id) => window.localStorage.setItem("a2g.local.userId", id), userId)
  await page.goto(path)
}

async function ask(page: Page, question: string): Promise<Locator> {
  await page.getByTestId("chat-input").fill(question)
  await page.getByTestId("chat-send").click()
  const turn = page.getByTestId("chat-turn").last()
  await expect(turn).toHaveAttribute("data-status", "done", { timeout: 20_000 })
  return turn
}

async function expectCleanLayout(page: Page, touch: boolean) {
  const report = await collectLayoutReport(page, { touch })
  expect(report.overflow, "horizontal overflow").toEqual([])
  expect(report.smallTargets, "touch targets under 44pt").toEqual([])
}

test("a count answer offers the Adjust form; submitting it asks the agent again through the chat", async ({ page }, info) => {
  const touch = info.project.use.hasTouch === true
  await openAs(page, "u-msl-ne-01")
  const first = await ask(page, "How many calls did I have in the last 90 days?")

  // The form is an A2UI surface from the agent, drawn with the answer catalog: collapsed until asked for.
  const surface = first.getByTestId("answer-follow-up-surfaces").getByTestId("a2ui-surface")
  await expect(surface).toHaveCount(1)
  await expect(surface).toHaveAttribute("data-slot", "follow_up")
  const toggle = surface.getByRole("button", { name: /Adjust this answer/ })
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await toggle.click()

  const form = surface.getByRole("form", { name: "Adjust this answer" })
  await expect(form).toBeVisible()
  await expect(surface.getByRole("search")).toBeVisible()
  // Pre-filled with what the answer covered.
  await expect(form.getByRole("radio", { name: "Distinct calls" })).toBeChecked()
  await expect(form.getByRole("radio", { name: "Total only" })).toBeChecked()
  await expect(form.getByRole("radio", { name: "All of my scope" })).toBeChecked()
  await expectCleanLayout(page, touch)

  await form.getByRole("radio", { name: "Engaged HCPs" }).check()
  await form.getByRole("radio", { name: "By month" }).check()
  await form.getByRole("button", { name: "Update answer" }).click()

  // The action becomes the next question in the same conversation, worded by the labels the form showed.
  const second = page.getByTestId("chat-turn").last()
  await expect(second.getByTestId("user-message")).toContainText("Update this answer: Engaged HCPs · By month · All of my scope")
  await expect(second).toHaveAttribute("data-status", "done", { timeout: 20_000 })
  await expect(page.getByTestId("chat-turn")).toHaveCount(2)
  // The agent ran exactly that query: a chart of engaged HCPs by month, and a new form that keeps the choices.
  await expect(second.getByTestId("visuals")).toContainText("Engaged HCPs by month")
  const next = second.getByTestId("answer-follow-up-surfaces").getByTestId("a2ui-surface")
  await next.getByRole("button", { name: /Adjust this answer/ }).click()
  await expect(next.getByRole("radio", { name: "Engaged HCPs" })).toBeChecked()
  await expect(next.getByRole("radio", { name: "By month" })).toBeChecked()
})

test("the Adjust form validates on submit and moves focus to the field to fix, without asking the agent", async ({ page }) => {
  await openAs(page, "u-msl-ne-01")
  const turn = await ask(page, "How many calls did I have in the last 90 days?")
  const surface = turn.getByTestId("answer-follow-up-surfaces").getByTestId("a2ui-surface")
  await surface.getByRole("button", { name: /Adjust this answer/ }).click()
  const form = surface.getByRole("form", { name: "Adjust this answer" })

  // An empty end date fails the surface's v1.0 `required` check: the form names the problem, moves focus to the
  // field, and nothing is sent to the agent.
  const to = form.getByLabel("To", { exact: true })
  await to.fill("")
  await page.keyboard.press("Tab")
  await form.getByRole("button", { name: "Update answer" }).click()
  await expect(form.getByText("Choose an end date.")).toBeVisible()
  await expect(to).toBeFocused()
  await expect(page.getByTestId("chat-turn")).toHaveCount(1)

  // A typed date outside the allowed range never reaches the data model; the field's own error stops the submit too.
  await to.fill("2026-08-01")
  await page.keyboard.press("Tab")
  await form.getByRole("button", { name: "Update answer" }).click()
  await expect(page.getByTestId("chat-turn")).toHaveCount(1)
})

test("a theme answer shows the recorded themes as an accessible table in the panel", async ({ page }, info) => {
  const touch = info.project.use.hasTouch === true
  await openAs(page, "u-msl-ne-01", "/msl")
  await expect(page.getByTestId("kpi-calls").first()).toBeVisible()
  await page.getByTestId("chat-open").click()
  const wide = page.viewportSize()!.width >= 1366
  const panel = page.getByTestId(wide ? "chat-dock" : "chat-drawer")
  await expect(panel).toBeVisible()
  const turn = await ask(page, "What themes are emerging?")

  const surface = turn.getByTestId("answer-surfaces").getByTestId("a2ui-surface")
  await expect(surface).toHaveAttribute("data-slot", "evidence")
  const region = surface.getByRole("region", { name: "Recorded themes" })
  await expect(region).toBeVisible()
  const table = region.getByRole("table", { name: "Recorded themes" })
  await expect(table.getByRole("columnheader")).toHaveText(["Theme", "Latest period", "Earlier period", "Rule flag"])
  await expect(table.getByRole("rowheader").first()).toHaveText("ctDNA monitoring (emerging)")
  await expect(table.getByRole("row").nth(1)).toContainText("Emerging")
  // The table scrolls inside its own named region, never the page.
  await expect(region).toHaveAttribute("tabindex", "0")
  await page.waitForTimeout(400)
  await expectCleanLayout(page, touch)
})

test("an aggregate-only Executive gets withheld words and no record-level UI on surfaces", async ({ page }) => {
  await openAs(page, "u-exec-all")
  const themes = await ask(page, "Which topics are rising across regions?")
  const table = themes.getByTestId("answer-surfaces").getByRole("table", { name: "Recorded themes across your regions" })
  await expect(table).toBeVisible()
  await expect(table.getByRole("columnheader")).toHaveText(["Theme", "Latest period", "Earlier period", "Trend"])
  await expect(themes.getByTestId("answer-surfaces")).not.toContainText(/CALL-\d|RESP-\d/)
  await expect(themes.getByTestId("show-rows")).toHaveCount(0)
  await expect(themes.getByTestId("answer-follow-up-surfaces")).toHaveCount(0)

  const activity = await ask(page, "Show calls by month")
  const surface = activity.getByTestId("answer-follow-up-surfaces").getByTestId("a2ui-surface")
  await surface.getByRole("button", { name: /Adjust this answer/ }).click()
  await expect(surface.getByRole("radio", { name: "By region" })).toBeVisible()
  // Aggregate-only: no territory filter is offered.
  await expect(surface.getByText("Territory", { exact: true })).toHaveCount(0)
})
