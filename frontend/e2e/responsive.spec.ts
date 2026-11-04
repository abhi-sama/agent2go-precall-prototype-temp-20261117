import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { expect, test } from "@playwright/test"
import { collectLayoutReport } from "./support/layout-checks"
import { SCREENS } from "./support/screens"
import { VIEWPORTS } from "./support/viewports"

// Full-page captures include the software-rendered globe; its pixels can finish after the default
// 30-second budget even though the route, layout checks, and markers have already settled.
// Give the readiness poll and the capture enough room when four software-rendered WebGL pages run together.
test.setTimeout(90_000)

/**
 * The responsive matrix: every screen in `support/screens.ts` at every viewport in `support/viewports.ts` (one
 * Playwright project each). Fails on horizontal overflow, clipped or overlapping content, tablet touch targets under
 * 44pt, and charts or 3D views that do not fit their container. A full-page screenshot per screen and viewport is
 * written to test-results/screenshots/<viewport>/<screen>.png and attached to the report.
 */

for (const screen of SCREENS) {
  test(`${screen.name}`, async ({ page }, testInfo) => {
    const viewport = VIEWPORTS.find((v) => v.name === testInfo.project.name)!
    await page.addInitScript((id) => {
      if (id) window.localStorage.setItem("a2g.local.userId", id)
      else window.localStorage.removeItem("a2g.local.userId")
    }, screen.userId ?? null)

    await page.goto(screen.path)
    await screen.ready(page)
    if (screen.prepare) await screen.prepare(page)
    // Let charts, the map, sheets and the landing entrances (spring 550ms plus stagger) finish.
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(600)
    // Landing entrances (spring 550ms plus stagger) can still be running; wait for the CSS animations themselves, not longer.
    await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime as number)).map((a) => a.finished.catch(() => undefined))))

    // Measure first: a full-page screenshot resizes the emulated viewport and perturbs layout.
    const report = await collectLayoutReport(page, { touch: viewport.touch })
    // A modal (the chat panel, a citation sheet) is fixed to the viewport, so it is captured as the person sees it; a
    // full-page capture would stretch the viewport and the sheet with it.
    const modalOpen = (await page.locator('[role="dialog"]').count()) > 0
    const shot = await page.screenshot({ fullPage: !modalOpen, animations: "disabled" })
    // On disk for review (test-results/screenshots/<viewport>/<screen>.png) and attached to the HTML report.
    const dir = path.join("test-results", "screenshots", viewport.name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, `${screen.name}.png`), shot)
    await testInfo.attach(`${screen.name}@${viewport.name}`, { body: shot, contentType: "image/png" })
    const fmt = (title: string, rows: string[]) => (rows.length ? `${title}:\n  ${rows.join("\n  ")}` : "")
    const problems = [
      fmt("Horizontal overflow", report.overflow),
      fmt("Clipped content", report.clipped),
      fmt("Overlapping elements", report.overlapping),
      fmt("Touch targets under 44pt", report.smallTargets),
      fmt("Charts / 3D views not fitting their container", report.badMedia),
    ].filter(Boolean)
    expect(problems, `${screen.name} at ${viewport.width}x${viewport.height}\n${problems.join("\n")}`).toEqual([])
  })
}
