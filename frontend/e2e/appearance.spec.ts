import { expect, test, type Page } from "@playwright/test"
import { LOOKS, cacheFor, lookName, readLook, seedLook } from "./support/appearance"
import { VIEWPORTS } from "./support/viewports"

/** Astryx theme, colour scheme and density: defaults, the settings popover, persistence and no flash on load. */
const attr = (page: Page, name: string) => page.evaluate((n) => document.documentElement.getAttribute(n), name)
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

async function pickTheme(page: Page, label: string) {
  await page.getByTestId("theme-select").click()
  await page.getByRole("option", { name: label }).click()
}

test("app chrome and install metadata use the shared MSL Agent mark", async ({ page }) => {
  await signInAs(page, "u-msl-ne-01")
  await page.goto("/msl")
  const brand = page.getByRole("link", { name: "MSL Agent" }).first()
  await expect(brand).toBeVisible()
  await expect(brand.locator('img[src="/icon.svg"]')).toBeVisible()

  const manifest = await page.evaluate(async () => {
    const response = await fetch("/manifest.webmanifest")
    return response.json() as Promise<{ icons: { src: string; sizes: string }[] }>
  })
  expect(manifest.icons).toEqual([
    { src: "/app-icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/app-icon-512.png", sizes: "512x512", type: "image/png" },
  ])
})

// Every seeded persona starts on the default theme, following the device, with nothing saved yet.
for (const [userId, path, persona] of [
  ["u-msl-ne-01", "/msl", "MSL"],
  ["u-dir-ne", "/director", "Director"],
  ["u-exec-all", "/executive", "Executive"],
  ["u-admin-sec", "/admin", "Administrator"],
] as const) {
  test(`${persona} starts on the default theme and follows the device`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" })
    await signInAs(page, userId)
    await page.goto(path)
    await expect(page.getByRole("main")).toBeVisible()
    await expect.poll(() => readLook(page)).toEqual({ theme: "neutral", wrapper: "neutral", dark: true })
    expect(await attr(page, "data-color-scheme")).toBeNull()
  })
}

/**
 * Records the look of every frame that is actually painted, from the first one: the theme on the root Theme wrapper
 * (what the page's tokens come from), the resolved scheme and the density. Sampling on animation frames is the point:
 * server-rendered defaults and the boot scripts' writes happen in the same synchronous parse, before any paint.
 */
async function watchAppearance(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = []
    ;(window as unknown as { __appearanceSeen: string[] }).__appearanceSeen = seen
    const sample = () => {
      const root = document.documentElement
      const wrapper = document.querySelector("body [data-astryx-theme]")
      if (wrapper) {
        const scheme = getComputedStyle(wrapper).colorScheme
        const now = `${wrapper.getAttribute("data-astryx-theme")}|${scheme}|${root.dataset.density ?? "-"}`
        if (seen[seen.length - 1] !== now) seen.push(now)
      }
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
}
const seenLooks = (page: Page) => page.evaluate(() => (window as unknown as { __appearanceSeen: string[] }).__appearanceSeen)

test("no theme flash: a saved look is there from the first painted frame and never changes", async ({ page }) => {
  await watchAppearance(page)
  await signInAs(page, "u-dir-ne", { "a2g.appearance": cacheFor("u-dir-ne", { theme: "matcha", scheme: "dark" }, "compact") })
  await page.goto("/director")
  await expect(page.getByTestId("director-overview")).toBeVisible()
  await page.waitForTimeout(1200) // past the saved-profile fetch and every effect
  expect(await seenLooks(page)).toEqual(["matcha|dark|compact"])
})

test("no theme flash: the dark-only theme paints dark on a light device", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" })
  await watchAppearance(page)
  await signInAs(page, "u-dir-ne", { "a2g.appearance": cacheFor("u-dir-ne", { theme: "gothic", scheme: "light" }, "compact") })
  await page.goto("/director")
  await expect(page.getByTestId("director-overview")).toBeVisible()
  await page.waitForTimeout(1200)
  expect(await seenLooks(page)).toEqual(["gothic|dark|compact"])
})

test("changing theme and scheme persists across reload", async ({ page }) => {
  await signInAs(page, "u-msl-ne-01")
  await page.goto("/msl")
  await page.getByTestId("appearance-settings").click()
  await pickTheme(page, "Stone")
  await page.getByTestId("appearance-mode-dark").click()
  await expect.poll(() => readLook(page)).toEqual({ theme: "stone", wrapper: "stone", dark: true })
  await page.reload()
  await expect.poll(() => readLook(page)).toEqual({ theme: "stone", wrapper: "stone", dark: true })
  expect(await attr(page, "data-color-scheme")).toBe("dark")
  expect(await luminance(page, "body"), "page background").toBeLessThan(0.2)
})

test("a dark-only theme locks the scheme control to dark", async ({ page }) => {
  await signInAs(page, "u-msl-ne-01")
  await page.goto("/msl")
  await page.getByTestId("appearance-settings").click()
  await pickTheme(page, "Gothic")
  await expect.poll(() => attr(page, "data-color-scheme")).toBe("dark")
  await expect(page.getByTestId("appearance-mode-light")).toBeDisabled()
})

test("the saved scheme follows the person to a new device and not to someone else", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" })
  await signInAs(page, "u-msl-ne-01")
  await page.goto("/msl")
  await page.getByTestId("appearance-settings").click()
  await page.getByTestId("appearance-mode-dark").click()
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("a2g.mock.appearance"))).toContain("charcoal")

  // A new device has no local copy; the saved profile (the stand-in for FE DynamoDB) restores the scheme.
  await page.evaluate(() => {
    window.localStorage.removeItem("a2g.appearance")
    window.localStorage.removeItem("a2g.device-appearance")
  })
  await page.reload()
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true)

  // Each person on a shared browser keeps their own choice: the Director pins light, the MSL keeps dark.
  await page.getByTestId("persona-switch").click()
  await page.getByTestId("persona-option-u-dir-ne").click()
  await expect(page).toHaveURL(/\/director$/)
  // Wait until the switch has finished, so the choice below is the Director's and not the MSL's.
  await expect(page.getByTestId("director-overview")).toBeVisible()
  await expect(page.getByTestId("persona-switch")).toContainText("Director")
  await page.getByTestId("appearance-settings").click()
  await page.getByTestId("appearance-mode-light").click()
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false)
  // The mock adapter reads the signed-in person when its simulated latency ends; let the save land before switching.
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("a2g.mock.appearance"))).toContain('"u-dir-ne"')
  await page.keyboard.press("Escape")
  await page.getByTestId("persona-switch").click()
  await page.getByTestId("persona-option-u-msl-ne-01").click()
  await expect(page).toHaveURL(/\/msl$/)
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true)
})

test("density follows each device, remains live across resize, and can be pinned", async ({ page }, testInfo) => {
  await signInAs(page, "u-msl-ne-01")
  await page.goto("/msl")
  const viewport = VIEWPORTS.find((entry) => entry.name === testInfo.project.name)!
  const expectedDensity = viewport.touch ? "comfortable" : "compact"
  await expect.poll(() => attr(page, "data-density")).toBe(expectedDensity)

  // The automatic setting must re-evaluate while the browser recomputes its viewport on rotate.
  await page.evaluate(() => {
    window.dispatchEvent(new Event("resize"))
    window.dispatchEvent(new Event("orientationchange"))
  })
  await expect.poll(() => attr(page, "data-density")).toBe(expectedDensity)

  await page.getByTestId("appearance-settings").click()
  await page.getByTestId("appearance-density-compact").click()
  await expect.poll(() => attr(page, "data-density")).toBe("compact")
  await page.reload()
  await expect.poll(() => attr(page, "data-density")).toBe("compact")
})

for (const look of LOOKS.filter((l) => l.scheme === "dark")) {
  test(`${lookName(look)} keeps dark surfaces`, async ({ page }) => {
    await seedLook(page, "u-dir-ne", look)
    await page.goto("/director")
    await expect(page.getByTestId("director-overview")).toBeVisible()
    await expect.poll(() => readLook(page)).toEqual({ theme: look.theme, wrapper: look.theme, dark: true })
    expect(await luminance(page, "body"), "page background").toBeLessThan(0.2)
    expect(await luminance(page, '[data-slot="card"]'), "card background").toBeLessThan(0.25)
  })
}

test("the settings controls keep 44pt targets on touch", async ({ page }, testInfo) => {
  const viewport = VIEWPORTS.find((entry) => entry.name === testInfo.project.name)!
  test.skip(!viewport.touch, "44pt is the touch target floor")
  await signInAs(page, "u-msl-ne-01")
  await page.goto("/msl")
  await page.getByTestId("appearance-settings").click()
  for (const id of ["theme-select", "appearance-mode-dark", "appearance-density-comfortable"]) {
    // Layout size: the popover may still be scaling in, which changes the bounding box but not the target.
    const height = await page.getByTestId(id).evaluate((el) => (el as HTMLElement).offsetHeight)
    expect(height, id).toBeGreaterThanOrEqual(44)
  }
})

test("each person keeps their own theme on a shared device", async ({ page }) => {
  await signInAs(page, "u-msl-ne-01")
  await page.goto("/msl")
  await page.getByTestId("appearance-settings").click()
  await pickTheme(page, "Stone")
  await expect.poll(() => readLook(page).then((l) => l.theme)).toBe("stone")
  await page.keyboard.press("Escape")

  await page.getByTestId("persona-switch").click()
  await page.getByTestId("persona-option-u-dir-ne").click()
  await expect(page.getByTestId("director-overview")).toBeVisible()
  await expect(page.getByTestId("persona-switch")).toContainText("Director")
  await page.getByTestId("appearance-settings").click()
  await pickTheme(page, "Butter")
  await expect.poll(() => readLook(page).then((l) => l.theme)).toBe("butter")
  await page.keyboard.press("Escape")

  await page.getByTestId("persona-switch").click()
  await page.getByTestId("persona-option-u-msl-ne-01").click()
  await expect(page).toHaveURL(/\/msl$/)
  await expect.poll(() => readLook(page)).toMatchObject({ theme: "stone", wrapper: "stone" })
  await page.reload()
  await expect.poll(() => readLook(page)).toMatchObject({ theme: "stone", wrapper: "stone" })
})
