import { expect, test } from "@playwright/test"

test("desktop navigation collapses with the keyboard and restores the saved preference", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto("/msl")
  await page.evaluate(() => window.localStorage.removeItem("a2g.sidebar.collapsed"))

  const rail = page.getByTestId("sidebar-rail")
  const collapse = page.getByTestId("sidebar-collapse")
  await expect(rail).toHaveAttribute("data-collapsed", "false")
  await collapse.focus()
  await page.keyboard.press("Enter")
  await expect(rail).toHaveAttribute("data-collapsed", "true")
  await expect(collapse).toHaveAccessibleName("Expand navigation")
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(await page.evaluate(() => window.innerWidth))

  await page.reload()
  await expect(rail).toHaveAttribute("data-collapsed", "true")
  await collapse.focus()
  await page.keyboard.press("Space")
  await expect(rail).toHaveAttribute("data-collapsed", "false")
})

test("iPad portrait opens an accessible navigation sheet and closes after navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1366 })
  await page.goto("/msl")

  const menu = page.getByTestId("sidebar-menu")
  await expect(page.getByTestId("sidebar-rail")).toBeHidden()
  await menu.focus()
  await page.keyboard.press("Enter")
  await expect(menu).toHaveAttribute("aria-expanded", "true")
  const sheet = page.getByTestId("sidebar-sheet")
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole("navigation", { name: "Primary" })).toBeVisible()
  await sheet.getByRole("link", { name: "My activity" }).click()
  await expect(page).toHaveURL(/\/msl\/activity$/)
  await expect(sheet).toBeHidden()
})

test("each persona sees its own permitted navigation only", async ({ page }) => {
  const cases = [
    { userId: "u-msl-ne-01", path: "/msl", expected: "My territory", forbidden: "Hierarchy and coverage" },
    { userId: "u-dir-ne", path: "/director", expected: "My region", forbidden: "Pre-call brief" },
    { userId: "u-exec-all", path: "/executive", expected: "Overview", forbidden: "My activity" },
    { userId: "u-admin-sec", path: "/admin", expected: "Hierarchy and coverage", forbidden: "My territory" },
  ]

  await page.setViewportSize({ width: 1024, height: 1366 })
  for (const persona of cases) {
    await page.addInitScript((userId) => window.localStorage.setItem("a2g.local.userId", userId), persona.userId)
    await page.goto(persona.path)
    await page.getByTestId("sidebar-menu").click()
    const sheet = page.getByTestId("sidebar-sheet")
    await expect(sheet.getByText(persona.expected, { exact: true })).toBeVisible()
    await expect(sheet.getByText(persona.forbidden, { exact: true })).toHaveCount(0)
    await page.keyboard.press("Escape")
    await expect(sheet).toBeHidden()
  }
})
