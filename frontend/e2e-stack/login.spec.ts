import { readFileSync } from "node:fs"
import path from "node:path"
import { expect, test } from "@playwright/test"

/** Written by backend/infra/scripts/up.sh; the source of seeded users and the local password. */
const outputs = JSON.parse(readFileSync(path.join(__dirname, "..", "amplify_outputs.json"), "utf8"))
const a2g = outputs.custom.a2g as { local_password: string; seeded_users: { userId: string; email: string; fullName: string }[] }
const user = (id: string) => a2g.seeded_users.find((u) => u.userId === id)!

const kpi = async (page: import("@playwright/test").Page, id: string) =>
  Number(await page.getByTestId(`kpi-${id}-value`).getAttribute("data-value"))

test("signed-out visitors are sent to sign-in", async ({ page }) => {
  await page.goto("/msl")
  await expect(page).toHaveURL(/\/login\?next=%2Fmsl/)
  await expect(page.getByRole("heading", { name: "Sign in to MSL Agent" })).toBeVisible()
})

test("a seeded MSL signs in with email and password and sees own-territory KPIs", async ({ page }) => {
  const msl = user("msl-t01-01")
  await page.goto("/login")
  await page.getByTestId("login-email").fill(msl.email)
  await page.getByTestId("login-password").fill(a2g.local_password)
  await page.getByTestId("login-submit").click()

  await expect(page).toHaveURL(/\/msl$/)
  await expect(page.getByTestId("scope-label")).toContainText("T01-01")
  await expect(page.getByTestId("data-through")).toContainText("Data through")
  await expect(page.getByTestId("persona-switch")).toContainText(msl.fullName)
  await expect.poll(() => kpi(page, "calls")).toBeGreaterThan(0)
  expect(await kpi(page, "hcps")).toBeLessThanOrEqual(await kpi(page, "calls"))
  await expect(page.getByTestId("territory-map")).toBeVisible()
  await expect(page.getByTestId("territory-map")).toHaveAttribute("data-lit", "T01-01")

  await page.getByTestId("sign-out").click()
  await expect(page).toHaveURL(/\/login/)
})

test("a wrong password is refused without detail", async ({ page }) => {
  await page.goto("/login")
  await page.getByTestId("login-email").fill(user("msl-t01-01").email)
  await page.getByTestId("login-password").fill("Wrong-password-1")
  await page.getByTestId("login-submit").click()
  await expect(page.getByTestId("login-error")).toHaveText("Email or password is incorrect.")
  await expect(page).toHaveURL(/\/login/)
})

test("local quick-switch signs in as another seeded persona and the scope follows", async ({ page }) => {
  await page.goto("/login")
  await page.getByTestId("seeded-login-msl-t02-01").click()
  await expect(page).toHaveURL(/\/msl$/)
  await expect(page.getByTestId("scope-label")).toContainText("T02-01")

  await page.getByTestId("persona-switch").click()
  await page.getByTestId("persona-option-director-region-01").click()
  await expect(page).toHaveURL(/\/director$/)
  await expect(page.getByTestId("scope-label")).toContainText("REGION-01 · 6 territories")
})
