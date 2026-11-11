import { expect, test, type Page } from "@playwright/test"
import { KEY_LOOKS, lookName, seedLook } from "./support/appearance"
import { collectLayoutReport } from "./support/layout-checks"
import { VIEWPORTS } from "./support/viewports"

/**
 * Ticket #56 acceptance: every viewport in the matrix, in the key Astryx looks (default theme light and dark, the
 * dark-only theme, a strongly styled light theme), with the landing motion in play. After the entrances finish nothing may overflow, overlap, clip or
 * miss a 44pt touch target, and the landing figures and decorative scene must be present. Runs in every project.
 */

const PERSONAS = [
  { name: "msl", userId: "u-msl-ne-01", path: "/msl", ready: "kpi-calls" },
  { name: "executive", userId: "u-exec-all", path: "/executive", ready: "exec-kpi-calls" },
] as const

async function settled(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  // Entrances (spring 550ms + stagger), the map reveal and chart draw-in all finish well inside this.
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && Number.isFinite(a.effect?.getComputedTiming().endTime as number)).length), { timeout: 8000 }).toBe(0)
}

for (const persona of PERSONAS) {
  for (const look of KEY_LOOKS) {
    {
      test(`${persona.name} landing, ${lookName(look)}`, async ({ page }, testInfo) => {
        const viewport = VIEWPORTS.find((v) => v.name === testInfo.project.name)!
        await seedLook(page, persona.userId, look)
        await page.goto(persona.path)
        await expect(page.getByTestId(persona.ready)).toBeVisible()
        await expect(page.getByTestId("territory-map")).toBeVisible()
        await expect(page.getByTestId("parallax-stage").first()).toBeAttached()
        await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-astryx-theme"))).toBe(look.theme)
        await settled(page)
        if (persona.name === "executive") {
          // The globe's markers have to stop moving before the layout is measured.
          await page.waitForTimeout(700)
        }
        const report = await collectLayoutReport(page, { touch: viewport.touch })
        const problems = Object.entries(report).filter(([, rows]) => rows.length).map(([k, rows]) => `${k}:\n  ${rows.join("\n  ")}`)
        expect(problems, `${persona.name} ${lookName(look)} at ${viewport.width}x${viewport.height}`).toEqual([])
      })
    }
  }
}
