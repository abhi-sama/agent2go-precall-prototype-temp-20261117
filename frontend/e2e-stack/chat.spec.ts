import { readFileSync } from "node:fs"
import path from "node:path"
import { expect, test } from "@playwright/test"

const outputs = JSON.parse(readFileSync(path.join(__dirname, "..", "amplify_outputs.json"), "utf8"))
const a2g = outputs.custom.a2g as { local_password: string; seeded_users: { userId: string; email: string }[] }

test("a seeded MSL asks in the chat panel and gets a streamed, cited answer from the real stack", async ({ page }) => {
  test.setTimeout(150_000)
  const msl = a2g.seeded_users.find((u) => u.userId === "msl-t01-01")!
  await page.goto("/login")
  await page.getByTestId("login-email").fill(msl.email)
  await page.getByTestId("login-password").fill(a2g.local_password)
  await page.getByTestId("login-submit").click()
  await expect(page).toHaveURL(/\/msl$/)

  await page.getByRole("link", { name: "Ask the agent" }).first().click()
  await expect(page).toHaveURL(/\/chat$/)
  await page.getByTestId("chat-input").fill("How many distinct calls did I have in the last 90 days? Use the tool.")
  await page.getByTestId("chat-send").click()

  await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 120_000 })
  const calls = Number(await page.getByTestId("fact-f1").getAttribute("data-value"))
  expect(calls).toBeGreaterThan(0)
  await expect(page.getByTestId("ai-summary")).toContainText(String(calls))
  await expect(page.locator('[data-provenance="fact"]')).toBeVisible()
  await expect(page.locator('[data-provenance="ai"]')).toBeVisible()

  await page.getByTestId("citation").first().click()
  await expect(page.getByTestId("citation-fields")).toContainText("T01-01")
})

test("a trend question draws a chart whose values are the database counts, through the real stack", async ({ page }) => {
  test.setTimeout(150_000)
  const msl = a2g.seeded_users.find((u) => u.userId === "msl-t01-01")!
  await page.goto("/login")
  await page.getByTestId("login-email").fill(msl.email)
  await page.getByTestId("login-password").fill(a2g.local_password)
  await page.getByTestId("login-submit").click()
  await expect(page).toHaveURL(/\/msl$/)
  await page.goto("/chat")
  await page.getByTestId("chat-input").fill("Show my calls by month over the last 90 days.")
  await page.getByTestId("chat-send").click()

  await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 120_000 })
  const visual = page.getByTestId("visual").first()
  await expect(visual).toHaveAttribute("data-kind", "line")
  const total = Number(await visual.getAttribute("data-total"))
  const points = await page.getByTestId("line-point").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-value"))))
  expect(total).toBeGreaterThan(0)
  expect(points.reduce((a, b) => a + b, 0)).toBe(total)
  // Hover or tap reads out an exact value; the chart expands full screen.
  await page.getByTestId("line-hit").hover({ position: { x: 200, y: 100 } })
  await expect(page.getByTestId("viz-readout").first()).toContainText("calls")
  await visual.getByTestId("visual-expand").click()
  await expect(page.getByTestId("visual-sheet")).toBeVisible()
})
