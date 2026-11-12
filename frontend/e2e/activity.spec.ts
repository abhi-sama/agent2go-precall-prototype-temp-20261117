import { expect, test } from "@playwright/test"

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.removeItem("a2g.local.userId"))
})

test.describe("personal activity trends", () => {
  test("shows scope, data-through, totals and three monthly charts with no score", async ({ page }) => {
    await page.goto("/msl/activity")
    await expect(page.getByRole("heading", { level: 1, name: "My activity" })).toBeVisible()
    await expect(page.getByTestId("scope-label")).toContainText("NE-01")
    await expect(page.getByTestId("data-through")).toContainText("Data through")
    await expect(page.getByTestId("window-label")).toContainText("12 months")
    await expect(page.getByTestId("window-label")).toContainText("month to date")
    for (const id of ["chart-calls", "chart-hcps", "chart-channels"]) await expect(page.getByTestId(id)).toBeVisible()
    await expect(page.getByTestId("kpi-calls")).toBeVisible()
    await expect(page.getByTestId("kpi-hcps")).toBeVisible()
    await expect(page.getByTestId("activity-trends")).toContainText("no target, ranking or score")
    await expect(page.getByTestId("activity-trends")).not.toContainText(/attainment|quota|rank #/i)
  })

  test("the page does not scroll sideways at iPad sizes", async ({ page }) => {
    await page.goto("/msl/activity")
    await expect(page.getByTestId("chart-calls")).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test("evidence drawer keeps the interaction date apart from the load date", async ({ page }) => {
    await page.goto("/msl/activity")
    await page.getByTestId("evidence-open-calls").click()
    const drawer = page.getByTestId("evidence-drawer")
    await expect(drawer).toBeVisible()
    await expect(page.getByTestId("evidence-table")).toBeVisible()
    await expect(page.getByTestId("evidence-freshness")).toContainText("Interaction date")
    await expect(page.getByTestId("evidence-freshness")).toContainText("Load date")
    await expect(drawer.getByTestId("data-through")).toBeVisible()
    // The table renders each field as its own cell, so the first row's cells are the first of each test id.
    const interaction = await page.getByTestId("evidence-interaction-date").first().innerText()
    const loaded = await page.getByTestId("evidence-loaded").first().innerText()
    expect(interaction).not.toEqual(loaded)
    expect(loaded).toMatch(/UTC$/)

    // Stepping the month reloads a different set; the count line states the denominator.
    const before = await page.getByTestId("evidence-month").innerText()
    await page.getByRole("button", { name: "Previous month" }).click()
    await expect(page.getByTestId("evidence-month")).not.toHaveText(before)
    await expect(page.getByTestId("evidence-count")).toContainText("distinct calls")
  })

  test("flag an issue from a record, then see its status in My flags", async ({ page }) => {
    await page.goto("/msl/activity")
    await expect(page.getByTestId("flags-empty")).toBeVisible()
    await page.getByTestId("evidence-open-calls").click()
    await page.getByTestId("evidence-flag").first().click()
    await expect(page.getByTestId("flag-form")).toBeVisible()
    await expect(page.getByTestId("flag-target")).toContainText("CALL-")
    await page.getByTestId("flag-kind-TERRITORY_ASSIGNMENT").click()
    await page.getByTestId("flag-note").fill("Assigned to the wrong territory.")
    await page.getByTestId("flag-submit").click()
    await expect(page.getByTestId("flag-sent")).toContainText("Flag received")
    await expect(page.getByTestId("flag-sent").getByTestId("flag-status")).toHaveAttribute("data-status", "OPEN")
    await page.getByRole("button", { name: "Done" }).click()

    const item = page.getByTestId("flag-item")
    await expect(item).toHaveCount(1)
    await expect(item).toContainText("Incorrect territory assignment")
    await expect(item.getByTestId("flag-status")).toHaveText("Open")
  })

  test("a manual flag needs an id and refuses a malformed one", async ({ page }) => {
    await page.goto("/msl/activity")
    await page.getByTestId("flag-open").click()
    await expect(page.getByTestId("flag-submit")).toBeDisabled()
    await page.getByTestId("flag-kind-SUMMARY").click()
    await page.getByTestId("flag-target-id").fill("has space")
    await page.getByTestId("flag-submit").click()
    await expect(page.getByTestId("flag-error")).toBeVisible()
  })

  test("touch targets in the drawer are at least 44pt", async ({ page }) => {
    await page.goto("/msl/activity")
    await page.getByTestId("evidence-open-calls").click()
    await expect(page.getByTestId("evidence-table")).toBeVisible()
    for (const name of ["Previous month", "Next month"]) {
      const box = await page.getByRole("button", { name }).boundingBox()
      expect(box!.height, name).toBeGreaterThanOrEqual(44)
      expect(box!.width, name).toBeGreaterThanOrEqual(44)
    }
    const flag = await page.getByTestId("evidence-flag").first().boundingBox()
    expect(flag!.height).toBeGreaterThanOrEqual(44)
  })

  test("service failure shows an error with retry; forbidden shows a locked state", async ({ page }) => {
    await page.goto("/msl/activity?scenario=error")
    await expect(page.getByTestId("state-error").first()).toBeVisible()
    await expect(page.getByRole("button", { name: "Try again" }).first()).toBeVisible()
    await page.goto("/msl/activity?scenario=forbidden")
    await expect(page.getByTestId("state-error").first()).toContainText("No access")
  })

  test("an empty scope shows the empty state, not zeros", async ({ page }) => {
    await page.goto("/msl/activity?scenario=empty")
    await expect(page.getByTestId("state-empty")).toBeVisible()
  })

  test("another persona gets the gate, not this data", async ({ page }) => {
    // Runs after the beforeEach reset, so the quick-switch user is the Director.
    await page.addInitScript(() => window.localStorage.setItem("a2g.local.userId", "u-dir-ne"))
    await page.goto("/msl/activity")
    await expect(page.getByTestId("role-gate")).toBeVisible()
    await expect(page.getByTestId("chart-calls")).toHaveCount(0)
  })

  test("navigation reaches the page from the MSL workspace", async ({ page }) => {
    await page.goto("/msl")
    // iPad uses the navigation sheet, while the desktop rail is intentionally hidden.
    await page.getByTestId("sidebar-menu").click()
    await page.getByRole("dialog", { name: "Navigation" }).getByRole("link", { name: "My activity" }).click()
    await expect(page).toHaveURL(/\/msl\/activity$/)
  })
})
