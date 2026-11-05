import { readFileSync } from "node:fs"
import path from "node:path"
import { expect, test } from "@playwright/test"

/** Written by backend/infra/scripts/up.sh; the source of seeded users and the local password. */
const outputs = JSON.parse(readFileSync(path.join(__dirname, "..", "amplify_outputs.json"), "utf8"))
const a2g = outputs.custom.a2g as { local_password: string; seeded_users: { userId: string; email: string }[] }

/**
 * Leaving a screen that hosts an ECharts map must not throw. ECharts raised "Cannot read properties of null
 * (reading '0')" from a ResizeObserver callback that raced unmount (found by the end-to-end acceptance run; it needs real territory data, so it runs against the stack).
 */
test("moving between MSL screens at iPad portrait throws no page errors", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.setViewportSize({ width: 820, height: 1180 })
  await page.goto("/login")
  await page.getByTestId("login-email").fill(a2g.seeded_users.find((u) => u.userId === "msl-t01-01")!.email)
  await page.getByTestId("login-password").fill(a2g.local_password)
  await page.getByTestId("login-submit").click()
  await expect(page.getByRole("heading", { name: "My territory" })).toBeVisible()
  await page.waitForTimeout(1500)
  for (const [href, heading] of [
    ["/msl/briefs", "Pre-call brief"],
    ["/msl/activity", "My activity"],
    ["/msl", "My territory"],
  ] as const) {
    await page.evaluate((to) => document.querySelector<HTMLAnchorElement>(`a[href="${to}"]`)?.click(), href)
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible()
    await page.waitForTimeout(600)
  }
  expect(errors).toEqual([])
})
