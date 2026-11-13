import { expect, test } from "@playwright/test"
import { KEY_LOOKS, cacheFor, lookName } from "./support/appearance"
import { SCREENS } from "./support/screens"
import { VIEWPORTS } from "./support/viewports"

/**
 * D9 (#57): visual regression baselines. Every key screen in all six style x mode looks at every viewport in the
 * matrix; each is compared to a committed screenshot in `e2e/__visual__/<viewport>/`.
 *
 * Opt-in, because pixels depend on the machine: `pnpm test:visual` compares, `pnpm test:visual:update` rewrites the
 * baselines after an intended design change (review the diff in the PR, then commit). The baselines were captured on
 * macOS with the bundled Chromium; a different OS renders text slightly differently, so compare on the same
 * machine class or regenerate. Layout, overflow, touch-target and contrast checks run in `appearance-matrix.spec.ts`
 * on every `pnpm test:e2e`; this spec only answers "did the look change?".
 *
 * To keep the comparison deterministic: reduced motion (counters and charts land on their final frame, nothing
 * mid-transition), the above-the-fold viewport (the page below it is covered by the layout checks), and WebGL
 * canvases (software-rendered globe and 3D bars) masked, because the swiftshader output is not byte-stable.
 */
const KEY_SCREENS = [
  { name: "msl-landing" },
  { name: "director-landing" },
  { name: "admin" },
  { name: "chat" },
  { name: "design-system" },
]

test.describe.configure({ mode: "parallel" })

for (const { name } of KEY_SCREENS) {
  const file = name
  const screen = SCREENS.find((s) => s.name === name)
  if (!screen) throw new Error(`visual-regression: unknown screen ${name}`)
  for (const look of KEY_LOOKS) {
    {
      test(`${file} · ${lookName(look)}`, async ({ page }, testInfo) => {
        const viewport = VIEWPORTS.find((v) => v.name === testInfo.project.name)
        if (!viewport) throw new Error(`unknown viewport project ${testInfo.project.name}`)
        const userId = screen.userId ?? "u-msl-ne-01"
        await page.emulateMedia({ reducedMotion: "reduce" })
        await page.addInitScript(
          ([id, cache]) => {
            window.localStorage.setItem("a2g.local.userId", id as string)
            window.localStorage.setItem("a2g.appearance", cache as string)
          },
          [userId, cacheFor(userId, look)] as const,
        )
        await page.goto(screen.path)
        await screen.ready(page)
        if (screen.prepare) await screen.prepare(page)
        await page.evaluate(() => document.fonts.ready)
        await expect(page.locator("html")).toHaveAttribute("data-astryx-theme", look.theme)
        await page.waitForTimeout(700)

        await expect(page).toHaveScreenshot(`${file}__${lookName(look)}.png`, {
          animations: "disabled",
          caret: "hide",
          scale: "css",
          mask: [page.locator("canvas")],
          maskColor: "#808080",
          maxDiffPixelRatio: 0.004,
        })
      })
    }
  }
}
