import { expect, test, type Page } from "@playwright/test"
import { collectLayoutReport } from "./support/layout-checks"
import { VIEWPORTS } from "./support/viewports"

/**
 * Ticket #56 acceptance: every viewport in the matrix, in both styles and all three modes (light, warm charcoal,
 * true black), with the landing motion in play. After the entrances finish nothing may overflow, overlap, clip or
 * miss a 44pt touch target, and the landing figures and decorative scene must be present. Runs in every project.
 */

const STYLES = ["warm", "clinical"] as const
const MODES = [
  { name: "light", theme: "light", black: false },
  { name: "charcoal", theme: "dark", black: false },
  { name: "black", theme: "dark", black: true },
] as const
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
  for (const style of STYLES) {
    for (const mode of MODES) {
      test(`${persona.name} landing, ${style} style, ${mode.name} mode`, async ({ page }, testInfo) => {
        const viewport = VIEWPORTS.find((v) => v.name === testInfo.project.name)!
        await page.addInitScript(
          ([id, theme, appearance]) => {
            window.localStorage.setItem("a2g.local.userId", id as string)
            window.localStorage.setItem("theme", theme as string)
            window.localStorage.setItem("a2g.appearance", appearance as string)
          },
          [persona.userId, mode.theme, JSON.stringify({ style, black: mode.black })] as const,
        )
        await page.goto(persona.path)
        await expect(page.getByTestId(persona.ready)).toBeVisible()
        await expect(page.getByTestId("territory-map")).toBeVisible()
        await expect(page.getByTestId("parallax-stage").first()).toBeAttached()
        await expect.poll(() => page.evaluate(() => document.documentElement.dataset.style)).toBe(style)
        await settled(page)
        if (persona.name === "executive") {
          // The globe's markers have to stop moving before the layout is measured.
          await page.waitForTimeout(700)
        }
        const report = await collectLayoutReport(page, { touch: viewport.touch })
        const problems = Object.entries(report).filter(([, rows]) => rows.length).map(([k, rows]) => `${k}:\n  ${rows.join("\n  ")}`)
        expect(problems, `${persona.name} ${style}/${mode.name} at ${viewport.width}x${viewport.height}`).toEqual([])
      })
    }
  }
}
