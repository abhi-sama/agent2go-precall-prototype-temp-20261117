import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { collectContrastReport, collectFocusRingReport } from "./support/contrast"
import { collectLayoutReport } from "./support/layout-checks"
import { SCREENS } from "./support/screens"
import { VIEWPORTS } from "./support/viewports"

/**
 * D1 (#49): every style x mode combination (warm/clinical x light/charcoal/black) on the key screens, at every viewport
 * in the matrix. Each page must lay out without overflow or overlap (the same checks as responsive.spec.ts) and every
 * painted text and form control must meet WCAG AA contrast (e2e/support/contrast.ts).
 *
 * Follow-device is not a seventh look: it resolves to light or charcoal, and is covered below.
 */
const KEY_SCREENS = ["msl-landing", "director-landing", "admin", "chat", "design-system"]
const STYLES = ["warm", "clinical"] as const
const MODES = ["light", "charcoal", "black"] as const

async function openAs(page: Page, userId: string, appearance: { style: string; mode: string }) {
  await page.addInitScript(
    ([id, cache]) => {
      window.localStorage.setItem("a2g.local.userId", id as string)
      window.localStorage.setItem("a2g.appearance", JSON.stringify({ uid: id, density: "auto", ...(cache as object) }))
    },
    [userId, appearance] as const,
  )
}

for (const name of KEY_SCREENS) {
  const screen = SCREENS.find((s) => s.name === name)!
  for (const style of STYLES) {
    for (const mode of MODES) {
      test(`${name} · ${style} · ${mode}`, async ({ page }, testInfo) => {
        const viewport = VIEWPORTS.find((v) => v.name === testInfo.project.name)!
        await openAs(page, screen.userId ?? "u-msl-ne-01", { style, mode })
        await page.goto(screen.path)
        await screen.ready(page)
        if (screen.prepare) await screen.prepare(page)
        await page.evaluate(() => document.fonts.ready)
        await page.waitForTimeout(600)

        // The page is really in the combination under test.
        const root = await page.evaluate(() => ({
          style: document.documentElement.dataset.style,
          dark: document.documentElement.classList.contains("dark"),
          black: document.documentElement.dataset.mode === "black",
        }))
        expect(root).toEqual({ style, dark: mode !== "light", black: mode === "black" })

        const layout = await collectLayoutReport(page, { touch: viewport.touch })
        const contrast = await collectContrastReport(page)
        const ring = await collectFocusRingReport(page)
        const shot = await page.screenshot({ fullPage: true, animations: "disabled" })
        const dir = path.join("test-results", "screenshots", viewport.name)
        mkdirSync(dir, { recursive: true })
        writeFileSync(path.join(dir, `${name}__${style}-${mode}.png`), shot)

        const fmt = (title: string, rows: string[]) => (rows.length ? `${title}:\n  ${rows.join("\n  ")}` : "")
        const problems = [
          fmt("Horizontal overflow", layout.overflow),
          fmt("Clipped content", layout.clipped),
          fmt("Overlapping elements", layout.overlapping),
          fmt("Touch targets under 44pt", layout.smallTargets),
          fmt("Charts / 3D views not fitting their container", layout.badMedia),
          fmt(`Contrast below WCAG AA (${contrast.checked} checked, ${contrast.unmeasured} over images/gradients not measurable)`, contrast.failures),
          fmt("Focus ring contrast", ring),
        ].filter(Boolean)
        expect(problems, `${name} ${style}/${mode} at ${viewport.width}x${viewport.height}\n${problems.join("\n")}`).toEqual([])
        // A screen that measures nothing would pass vacuously.
        expect(contrast.checked, "text elements measured").toBeGreaterThan(10)
      })
    }
  }
}

test.describe("follow-device", () => {
  test("device dark is warm charcoal, never true black", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" })
    await openAs(page, "u-msl-ne-01", { style: "warm", mode: "device" })
    await page.goto("/msl")
    await expect(page.getByTestId("kpi-calls")).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true)
    expect(await page.evaluate(() => document.documentElement.dataset.mode ?? null)).toBeNull()
  })

  test("device light is the light mode", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" })
    await openAs(page, "u-msl-ne-01", { style: "warm", mode: "device" })
    await page.goto("/msl")
    await expect(page.getByTestId("kpi-calls")).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false)
  })
})
