import { expect, test, type Page } from "@playwright/test"
import { VIEWPORTS } from "./support/viewports"

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

test("app chrome and install metadata use the shared MSL Agent mark", async ({ page }) => {
  await signInAs(page, "u-msl-ne-01", { theme: "light" })
  await page.goto("/msl")
  const brand = page.getByRole("link", { name: "MSL Agent home" })
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

// D1 (#49): persona defaults apply on first load for every seeded persona, with nothing saved yet.
for (const [userId, path, persona, style] of [
  ["u-msl-ne-01", "/msl", "MSL", "warm"],
  ["u-dir-ne", "/director", "Director", "clinical"],
  ["u-exec-all", "/executive", "Executive", "clinical"],
  ["u-admin-sec", "/admin", "Administrator", "clinical"],
] as const) {
  test(`${persona} defaults to the ${style} style on first load`, async ({ page }) => {
    await signInAs(page, userId)
    await page.goto(path)
    await expect(page.locator("main")).toBeVisible()
    await expect.poll(() => attr(page, "style")).toBe(style)
  })
}

/**
 * Records the appearance of every frame that is actually painted, from the first one. Sampling on animation frames (not
 * on each attribute write) is the point: the server-rendered defaults and the boot script's writes happen in the same
 * synchronous parse, before any paint, so only a change that reaches the screen counts as a flash.
 */
async function watchAppearance(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = []
    ;(window as unknown as { __appearanceSeen: string[] }).__appearanceSeen = seen
    const sample = () => {
      const root = document.documentElement
      const now = `${root.dataset.style ?? "-"}|${root.classList.contains("dark") ? "dark" : "light"}|${root.dataset.mode ?? "-"}|${root.dataset.density ?? "-"}`
      if (seen[seen.length - 1] !== now) seen.push(now)
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
}
const seenLooks = (page: Page) => page.evaluate(() => (window as unknown as { __appearanceSeen: string[] }).__appearanceSeen)

test("no theme flash: a saved look is there from the first moment and never changes", async ({ page }) => {
  await watchAppearance(page)
  await signInAs(page, "u-dir-ne", { "a2g.appearance": JSON.stringify({ uid: "u-dir-ne", style: "warm", mode: "black", density: "compact" }) })
  await page.goto("/director")
  await expect(page.getByTestId("director-overview")).toBeVisible()
  await page.waitForTimeout(1200) // past the saved-profile fetch and every effect
  expect(await seenLooks(page)).toEqual(["warm|dark|black|compact"])
})

test("no theme flash: a persona default paints correctly on a first visit", async ({ page }) => {
  await watchAppearance(page)
  await signInAs(page, "u-dir-ne")
  await page.goto("/director")
  await expect(page.getByTestId("director-overview")).toBeVisible()
  await page.waitForTimeout(1200)
  const looks = await seenLooks(page)
  // The style is clinical from the first recorded state; nothing flips to warm and back.
  expect(looks.every((look) => look.startsWith("clinical|"))).toBe(true)
})

test("changing style and mode persists across reload", async ({ page }) => {
  await signInAs(page, "u-msl-ne-01")
  await page.goto("/msl")
  await page.getByTestId("appearance-settings").click()
  await page.getByTestId("appearance-style-clinical").click()
  await page.getByTestId("appearance-mode-black").click()
  await expect.poll(() => attr(page, "mode")).toBe("black")
  await page.reload()
  await expect.poll(() => attr(page, "style")).toBe("clinical")
  await expect.poll(() => attr(page, "mode")).toBe("black")
  expect(await luminance(page, "body")).toBe(0) // true black is #000
})

test("the saved choice follows the person to a new device and not to someone else", async ({ page }) => {
  await signInAs(page, "u-msl-ne-01")
  await page.goto("/msl")
  await page.getByTestId("appearance-settings").click()
  await page.getByTestId("appearance-style-clinical").click()
  await page.getByTestId("appearance-mode-charcoal").click()
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("a2g.mock.appearance"))).toContain("charcoal")

  // A new device has no local copy; the saved profile (the stand-in for FE DynamoDB) restores the look.
  await page.evaluate(() => {
    window.localStorage.removeItem("a2g.appearance")
    window.localStorage.removeItem("theme")
  })
  await page.reload()
  await expect.poll(() => attr(page, "style")).toBe("clinical")
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true)

  // Another person on the same browser starts from their own persona default, not this choice.
  await page.getByTestId("persona-switch").click()
  await page.getByTestId("persona-option-u-dir-ne").click()
  await expect(page).toHaveURL(/\/director$/)
  await expect.poll(() => attr(page, "style")).toBe("clinical") // Director default
  await page.getByTestId("persona-switch").click()
  await page.getByTestId("persona-option-u-msl-ne-01").click()
  await expect.poll(() => attr(page, "style")).toBe("clinical") // their own saved choice
})

test("the header theme button saves too", async ({ page }) => {
  await signInAs(page, "u-msl-ne-01", { "a2g.appearance": JSON.stringify({ uid: "u-msl-ne-01", style: "auto", mode: "light", density: "auto" }) })
  await page.goto("/msl")
  await page.getByTestId("theme-toggle").click()
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("a2g.mock.appearance"))).toContain('"mode":"charcoal"')
  await page.reload()
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true)
})

test("density follows each device, remains live across resize, and can be pinned", async ({ page }, testInfo) => {
  await signInAs(page, "u-msl-ne-01", { theme: "light" })
  await page.goto("/msl")
  const viewport = VIEWPORTS.find((entry) => entry.name === testInfo.project.name)!
  const expectedDensity = viewport.touch ? "comfortable" : "compact"
  await expect.poll(() => attr(page, "density")).toBe(expectedDensity)

  // The automatic setting must re-evaluate while the browser recomputes its viewport on rotate.
  await page.evaluate(() => {
    window.dispatchEvent(new Event("resize"))
    window.dispatchEvent(new Event("orientationchange"))
  })
  await expect.poll(() => attr(page, "density")).toBe(expectedDensity)

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
        "a2g.appearance": JSON.stringify({ uid: "u-dir-ne", style, mode }),
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
