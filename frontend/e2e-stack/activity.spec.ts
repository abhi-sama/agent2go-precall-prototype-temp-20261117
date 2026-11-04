import { readFileSync } from "node:fs"
import path from "node:path"
import { expect, test } from "@playwright/test"

/** Written by backend/infra/scripts/up.sh; the source of seeded users and the local password. */
const outputs = JSON.parse(readFileSync(path.join(__dirname, "..", "amplify_outputs.json"), "utf8"))
const a2g = outputs.custom.a2g as { local_password: string; seeded_users: { userId: string; email: string }[] }
const email = (id: string) => a2g.seeded_users.find((u) => u.userId === id)!.email

test("an MSL sees real monthly trends, opens the evidence behind a month, and flags an HCP identifier", async ({ page }) => {
  await page.goto("/login")
  await page.getByTestId("login-email").fill(email("msl-t01-01"))
  await page.getByTestId("login-password").fill(a2g.local_password)
  await page.getByTestId("login-submit").click()
  await expect(page).toHaveURL(/\/msl$/)

  await page.getByRole("link", { name: "My activity" }).first().click()
  await expect(page).toHaveURL(/\/msl\/activity$/)
  await expect(page.getByTestId("scope-label")).toContainText("T01-01")
  await expect(page.getByTestId("data-through")).toContainText("Data through")
  for (const id of ["chart-calls", "chart-hcps", "chart-channels"]) await expect(page.getByTestId(id)).toBeVisible()
  const calls = Number(await page.getByTestId("kpi-calls-value").getAttribute("data-value"))
  const hcps = Number(await page.getByTestId("kpi-hcps-value").getAttribute("data-value"))
  expect(calls).toBeGreaterThan(0)
  expect(hcps).toBeLessThanOrEqual(calls)

  // The drawer shows the records behind the latest complete month, with both dates.
  await page.getByTestId("evidence-open-calls").click()
  await expect(page.getByTestId("evidence-table")).toBeVisible()
  await expect(page.getByTestId("evidence-freshness")).toContainText("Load date")
  const row = page.getByTestId("evidence-row").first()
  expect(await row.getByTestId("evidence-interaction-date").innerText()).not.toEqual(await row.getByTestId("evidence-loaded").innerText())
  await expect(page.getByTestId("evidence-count")).toContainText("distinct calls")

  // Flag the HCP behind the first row; it is stored in FE DynamoDB and shows as Open.
  await page.getByTestId("evidence-flag").first().click()
  await page.getByTestId("flag-note").fill("Identifier looks wrong.")
  await page.getByTestId("flag-submit").click()
  await expect(page.getByTestId("flag-sent")).toContainText("Flag received")
  await page.getByRole("button", { name: "Done" }).click()
  await expect(page.getByTestId("flag-item").first().getByTestId("flag-status")).toHaveText("Open")

  // It survives a reload: the status comes from the store, not from page state.
  await page.reload()
  await expect(page.getByTestId("flag-item").first()).toContainText("Incorrect identifier")
})
