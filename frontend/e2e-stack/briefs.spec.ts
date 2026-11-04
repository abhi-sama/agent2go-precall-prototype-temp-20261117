import { readFileSync } from "node:fs"
import path from "node:path"
import { expect, test } from "@playwright/test"

const outputs = JSON.parse(readFileSync(path.join(__dirname, "..", "amplify_outputs.json"), "utf8"))
const a2g = outputs.custom.a2g as { local_password: string; seeded_users: { userId: string; email: string }[] }

test("a seeded MSL generates, edits and reopens a source-linked pre-call brief through the real stack", async ({ page }) => {
  test.setTimeout(180_000)
  const msl = a2g.seeded_users.find((u) => u.userId === "msl-t01-01")!
  await page.goto("/login")
  await page.getByTestId("login-email").fill(msl.email)
  await page.getByTestId("login-password").fill(a2g.local_password)
  await page.getByTestId("login-submit").click()
  await expect(page).toHaveURL(/\/msl$/)

  // From the HCP card: search, pick, prepare a brief.
  await page.getByTestId("hcp-search-input").fill("Call system HCP 0001")
  await page.getByTestId("hcp-search-submit").click()
  await page.getByTestId("hcp-result-HCP-0001").click()
  await page.getByTestId("hcp-prepare-brief").click()
  await expect(page).toHaveURL(/\/msl\/briefs\?hcp=HCP-0001/)
  await expect(page.getByTestId("brief-selected-name")).toContainText("HCP", { timeout: 30_000 })

  await page.getByTestId("brief-new-objective").fill("Understand how the care team weighs access evidence before the next exchange")
  await page.getByTestId("brief-generate").click()
  await expect(page.getByTestId("brief-generating")).toBeVisible()
  await expect(page.getByTestId("brief")).toBeVisible({ timeout: 120_000 })

  const counts = await page.getByTestId("statement").evaluateAll((els) => els.map((el) => Number(el.getAttribute("data-evidence-count"))))
  expect(counts.length).toBeGreaterThan(3)
  expect(counts.every((n) => n > 0)).toBe(true)
  await expect(page.getByTestId("prompts-label")).toContainText("Generated")
  await expect(page.getByTestId("brief-stale")).toHaveCount(0)

  // A cited record opens from the real API.
  await page.getByTestId("citations").first().getByRole("button").first().click()
  await expect(page.getByTestId("citation-fields")).toContainText("T01-01")
  await page.keyboard.press("Escape")

  // Edit and save, then reopen from the saved list after a full reload.
  await page.getByRole("button", { name: "Edit prompt 1" }).click()
  await page.getByLabel("Prompt text").fill("What matters most to the team about access evidence?")
  await page.getByTestId("brief-save").click()
  await expect(page.getByText("Changes saved")).toBeVisible()
  const briefId = await page.getByTestId("brief").getAttribute("data-brief-id")
  await page.goto(`/msl/briefs?brief=${briefId}`)
  await expect(page.getByTestId("brief-prompts-item").first()).toContainText("What matters most to the team")
  await expect(page.getByTestId("brief-prompts-item").first()).toContainText("Generated · edited")
})
