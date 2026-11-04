import { expect, test, type Page } from "@playwright/test"

/** Style, mode and density: persona defaults, the settings control, and that every combination keeps its surfaces. */
const attr = (page: Page, name: string) => page.evaluate((n) => document.documentElement.dataset[n] ?? null, name)
const luminance = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement
    const [r, g, b] = getComputedStyle(el).backgroundColor.match(/[\d.]+/g)!.slice(0, 3).map(Number)
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  }, selector)

async function signInAs(page: Page, userId: string, extra: Record<string, string> = {}) {
  await page.addInitScript(([id, more]) => {
    window.localStorage.setItem("a2g.local.userId", id as string)
    for (const [k, v] of Object.entries(more as Record<string, string>)) window.localStorage.setItem(k, v)
  }, [userId, extra] as const)
}

test("MSL defaults to the warm style", async ({ page }) => {
  await signInAs(page, "u-msl-ne-01", { theme: "light" })
  await page.goto("/msl")
  await expect.poll(() => attr(page, "style")).toBe("warm")
})

test("Director defaults to the clinical style", async ({ page }) => {
  await signInAs(page, "u-dir-ne", { theme: "light" })
  await page.goto("/director")
  await expect.poll(() => attr(page, "style")).toBe("clinical")
})

test("density follows the device and can be pinned", async ({ page }) => {
  await signInAs(page, "u-msl-ne-01", { theme: "light" })
  await page.goto("/msl")
  // Playwright's iPad projects are touch devices.
  await expect.poll(() => attr(page, "density")).toBe("comfortable")
  await page.getByTestId("appearance-settings").click()
  await page.getByTestId("appearance-density-compact").click()
  await expect.poll(() => attr(page, "density")).toBe("compact")
  await page.reload()
  await expect.poll(() => attr(page, "density")).toBe("compact")
})

for (const style of ["warm", "clinical"]) {
  for (const mode of ["charcoal", "black"]) {
    test(`${style} style in ${mode} keeps dark surfaces`, async ({ page }) => {
      await signInAs(page, "u-dir-ne", {
        theme: "dark",
        "a2g.appearance": JSON.stringify({ style, black: mode === "black" }),
      })
      await page.goto("/director")
      await expect(page.getByTestId("director-overview")).toBeVisible()
      await expect.poll(() => attr(page, "style")).toBe(style)
      expect(await attr(page, "mode")).toBe(mode === "black" ? "black" : null)
      expect(await luminance(page, "body"), "page background").toBeLessThan(0.15)
      expect(await luminance(page, "aside"), "sidebar background").toBeLessThan(0.15)
      expect(await luminance(page, '[data-slot="card"]'), "card background").toBeLessThan(0.2)
    })
  }
}

test("the settings control switches mode, style and keeps 44pt targets", async ({ page }) => {
  await signInAs(page, "u-msl-ne-01", { theme: "light" })
  await page.goto("/msl")
  await page.getByTestId("appearance-settings").click()
  for (const id of ["appearance-mode-black", "appearance-style-clinical", "appearance-density-comfortable"]) {
    // Layout size: the popover is still scaling in, which changes the bounding box but not the target.
    const height = await page.getByTestId(id).evaluate((el) => (el as HTMLElement).offsetHeight)
    expect(height, id).toBeGreaterThanOrEqual(44)
  }
  await page.getByTestId("appearance-mode-black").click()
  await expect.poll(() => attr(page, "mode")).toBe("black")
  expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true)
  await page.getByTestId("appearance-style-clinical").click()
  await expect.poll(() => attr(page, "style")).toBe("clinical")
  await page.getByTestId("appearance-mode-light").click()
  await expect.poll(() => attr(page, "mode")).toBeNull()
})
