import { readFileSync } from "node:fs"
import path from "node:path"
import { expect, test } from "@playwright/test"

/** Written by backend/infra/scripts/up.sh; the source of seeded users and the local password. */
const outputs = JSON.parse(readFileSync(path.join(__dirname, "..", "amplify_outputs.json"), "utf8"))
const a2g = outputs.custom.a2g as { local_password: string; seeded_users: { userId: string; email: string }[] }

/**
 * An aggregate-only Executive is refused the record-level catalog read behind the filter options. The bar must say so
 * instead of loading forever, and the page must not show a "No access" panel under data it just rendered
 * (found by the end-to-end acceptance run).
 */
test("an Executive's filter bar says its catalog filters are unavailable and the overview shows no false no-access panel", async ({ page }) => {
  await page.goto("/login")
  await page.getByTestId("login-email").fill(a2g.seeded_users.find((u) => u.userId === "executive-region-01")!.email)
  await page.getByTestId("login-password").fill(a2g.local_password)
  await page.getByTestId("login-submit").click()
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible()
  await expect(page.getByTestId("aggregate-only-note")).toBeVisible()
  for (const id of ["territory", "molecule", "landscape", "study", "survey", "question"]) {
    const select = page.locator(`#filter-${id}`)
    await expect(select).toBeDisabled()
    await expect(select).toContainText("Not available for your role")
  }
  await expect(page.getByText("No access to this view")).toHaveCount(0)
  // The date range stays usable.
  await expect(page.getByRole("button", { name: "90 days" })).toBeEnabled()
})
