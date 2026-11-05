import { readFileSync } from "node:fs"
import path from "node:path"
import { expect, test } from "@playwright/test"
import { goToNav } from "./nav"

const outputs = JSON.parse(readFileSync(path.join(__dirname, "..", "amplify_outputs.json"), "utf8"))
const a2g = outputs.custom.a2g as { local_password: string; seeded_users: { userId: string; email: string }[] }
const email = (id: string) => a2g.seeded_users.find((u) => u.userId === id)!.email

test("an administrator sees the validated hierarchy, the approval trail and the two visibility matrices from the real API", async ({ page }) => {
  await page.goto("/login")
  await page.getByTestId("login-email").fill(email("admin-region-01"))
  await page.getByTestId("login-password").fill(a2g.local_password)
  await page.getByTestId("login-submit").click()
  await expect(page).toHaveURL(/\/admin$/)

  await goToNav(page, "Hierarchy and coverage")
  await expect(page).toHaveURL(/\/admin\/governance$/)
  // The seed plants an orphan assignment and a territory under two parents.
  await expect(page.getByTestId("hierarchy-findings")).toContainText("UNRESOLVED-01")
  await expect(page.getByTestId("hierarchy-findings")).toContainText("2 parents")
  await expect(page.getByTestId("hierarchy-tree")).toContainText("REGION-01")

  await page.getByRole("tab", { name: "Access timeline" }).click()
  await expect(page.getByTestId("access-timeline")).toContainText("MSL T01-01")
  await expect(page.getByTestId("scope-change-form")).toBeVisible()

  await page.getByRole("tab", { name: "Catalog and responses" }).click()
  await expect(page.getByTestId("catalog-matrix")).toContainText("Executive aggregate-only role")
  await expect(page.getByTestId("response-matrix").getByRole("radiogroup", { name: "Executive aggregate-only role response access" }).getByRole("radio", { name: "Aggregate only" })).toBeChecked()
})
