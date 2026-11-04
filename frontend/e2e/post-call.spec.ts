import { expect, test } from "@playwright/test"
import { VIEWPORTS } from "./support/viewports"

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.removeItem("a2g.local.userId"))
})

test("drafts remain review-only, tasks need confirmation, and alerts disclose evidence", async ({ page }) => {
  await page.goto("/msl/follow-up")
  await expect(page.getByTestId("confirmed-tasks")).toContainText("No confirmed follow-ups yet")
  await page.getByTestId("post-call-notes").fill("Evidence requested\nSchedule follow-up")
  await page.getByRole("button", { name: "Create review draft" }).click()
  await expect(page.getByTestId("post-call-drafts")).toContainText("Evidence requested")
  await page.getByRole("button", { name: "Confirm draft" }).click()
  await expect(page.getByTestId("post-call-drafts")).toContainText("Confirmed · CONFIRMED")
  await expect(page.getByTestId("confirmed-tasks")).toContainText("No confirmed follow-ups yet")
  await page.getByTestId("task-description").fill("Send evidence package")
  await page.getByRole("button", { name: "Confirm task" }).click()
  await expect(page.getByTestId("confirmed-tasks")).toContainText("Send evidence package")
  await page.getByTestId("alert-topic").fill("evidence")
  await page.getByRole("button", { name: "Save alert rule" }).click()
  await expect(page.getByTestId("topic-alerts")).toContainText("Evidence: RESP-000001")
})

for (const viewport of VIEWPORTS.filter((item) => item.touch)) {
  test(`post-call workspace fits ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto("/msl/follow-up")
    await expect(page.getByTestId("post-call-drafts")).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    for (const button of await page.getByTestId("post-call-drafts").getByRole("button").all()) {
      const box = await button.boundingBox()
      expect(box?.height).toBeGreaterThanOrEqual(44)
    }
  })
}
