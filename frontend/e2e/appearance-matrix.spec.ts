import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { collectContrastReport, collectFocusRingReport } from "./support/contrast"
import { LOOKS, lookName, readLook, seedLook, type Look } from "./support/appearance"
import { collectLayoutReport } from "./support/layout-checks"
import { SCREENS } from "./support/screens"
import { VIEWPORTS } from "./support/viewports"

/**
 * Every Astryx theme in light and dark (gothic is dark-only) on the key screens, at every viewport in the matrix. Each
 * page must lay out without overflow or overlap (the same checks as responsive.spec.ts) and every painted text and
 * form control must meet WCAG AA contrast (e2e/support/contrast.ts).
 *
 * Follow-device is not a separate look: it resolves to light or dark, and is covered below.
 */
const KEY_SCREENS = ["msl-landing", "director-landing", "admin", "chat", "chat-answer-rows", "design-system"]

async function openAs(page: Page, userId: string, look: Look) {
  await seedLook(page, userId, look)
}

for (const name of KEY_SCREENS) {
  const screen = SCREENS.find((s) => s.name === name)!
  for (const look of LOOKS) {
    {
      test(`${name} · ${lookName(look)}`, async ({ page }, testInfo) => {
        const viewport = VIEWPORTS.find((v) => v.name === testInfo.project.name)!
        await openAs(page, screen.userId ?? "u-msl-ne-01", look)
        await page.goto(screen.path)
        await screen.ready(page)
        if (screen.prepare) await screen.prepare(page)
        await page.evaluate(() => document.fonts.ready)
        await page.waitForTimeout(600)

        // The page is really in the look under test.
        expect(await readLook(page)).toEqual({ theme: look.theme, wrapper: look.theme, dark: look.scheme === "dark" })

        const layout = await collectLayoutReport(page, { touch: viewport.touch })
        const contrast = await collectContrastReport(page)
        const ring = await collectFocusRingReport(page)
        const shot = await page.screenshot({ fullPage: true, animations: "disabled" })
        const dir = path.join("test-results", "screenshots", viewport.name)
        mkdirSync(dir, { recursive: true })
        writeFileSync(path.join(dir, `${name}__${lookName(look)}.png`), shot)

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
        expect(problems, `${name} ${lookName(look)} at ${viewport.width}x${viewport.height}\n${problems.join("\n")}`).toEqual([])
        // A screen that measures nothing would pass vacuously.
        expect(contrast.checked, "text elements measured").toBeGreaterThan(10)
      })
    }
  }
}

test.describe("follow-device", () => {
  for (const [scheme, dark] of [["dark", true], ["light", false]] as const) {
    test(`device ${scheme} is the ${scheme} scheme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await page.addInitScript(() => {
        window.localStorage.setItem("a2g.local.userId", "u-msl-ne-01")
        window.localStorage.setItem("a2g.appearance", JSON.stringify({ uid: "u-msl-ne-01", theme: "neutral", mode: "device", style: "auto", density: "auto" }))
      })
      await page.goto("/msl")
      await expect(page.getByTestId("kpi-calls")).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(dark)
      expect(await page.evaluate(() => document.documentElement.getAttribute("data-color-scheme"))).toBeNull()
    })
  }
})
