import { expect, test, type Page } from "@playwright/test"

/**
 * The shared page gutter and the absence of the old first-run landing card, checked in every matrix viewport
 * (MacBook widths where the navigation rail is inline, iPad widths where it is a drawer).
 *
 * Both are shell-level behaviours (`PageFrame` in `app-shell.tsx`), so a sample of pages across every persona is
 * enough: a page that regressed to flush edges would be one that bypasses the shell frame.
 */

/** One page per persona area, plus the pages that most recently drifted (Insights, Trends). */
const PAGES = [
  { persona: "u-msl-ne-01", path: "/msl" },
  { persona: "u-msl-ne-01", path: "/msl/insights" },
  { persona: "u-dir-ne", path: "/director" },
  { persona: "u-exec-all", path: "/executive" },
  { persona: "u-exec-all", path: "/executive/trends" },
  { persona: "u-admin-sec", path: "/admin" },
] as const

/** The 16px page gutter (spacing 4), with a pixel of slack for sub-pixel layout. */
const GUTTER = 15

async function signInAs(page: Page, userId: string) {
  await page.addInitScript((id) => window.localStorage.setItem("a2g.local.userId", id), userId)
}

test.describe("page gutter", () => {
  for (const { persona, path } of PAGES) {
    test(`${path} keeps a gutter from the sidebar and the screen edge`, async ({ page }) => {
      await signInAs(page, persona)
      await page.goto(path)
      const frame = page.getByTestId("page-frame")
      await expect(frame).toBeVisible()
      await expect(frame.getByRole("heading", { level: 1 }).first()).toBeVisible()

      const measured = await page.evaluate(() => {
        const frameEl = document.querySelector('[data-testid="page-frame"]')!
        const rail = document.querySelector('[data-testid="sidebar-rail"]')
        const railBox = rail?.getBoundingClientRect()
        // The inline rail occupies the start edge; below the desktop breakpoint it is a drawer and the edge is 0.
        const startEdge = railBox && railBox.width > 0 && railBox.right > 0 ? railBox.right : 0
        const heading = frameEl.querySelector("h1")!.getBoundingClientRect()
        // Every region inside the frame, not only its direct children: a region that bleeds out (for example an
        // Astryx Section with its own negative margin) would sit flush at the edge while the frame itself is fine.
        const regions = [...frameEl.querySelectorAll("h1, h2, section")]
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.height > 0)
        const children = [...frameEl.children].map((c) => c.getBoundingClientRect()).filter((r) => r.width > 0)
        return {
          startEdge,
          viewport: document.documentElement.clientWidth,
          headingLeft: heading.left,
          contentLeft: Math.min(...children.map((r) => r.left), ...regions.map((r) => r.left)),
          contentRight: Math.max(...children.map((r) => r.right), ...regions.map((r) => r.right)),
        }
      })

      expect(measured.headingLeft - measured.startEdge, "heading gap to the sidebar / screen edge").toBeGreaterThanOrEqual(GUTTER)
      expect(measured.contentLeft - measured.startEdge, "content gap to the sidebar / screen edge").toBeGreaterThanOrEqual(GUTTER)
      expect(measured.viewport - measured.contentRight, "content gap to the right screen edge").toBeGreaterThanOrEqual(GUTTER)
    })
  }
})

test.describe("first-run landing card", () => {
  for (const { persona, path } of [
    { persona: "u-msl-ne-01", path: "/msl" },
    { persona: "u-dir-ne", path: "/director" },
    { persona: "u-exec-all", path: "/executive" },
    { persona: "u-admin-sec", path: "/admin" },
  ]) {
    test(`a first visit to ${path} opens on the page, not on an orientation card`, async ({ page }) => {
      await signInAs(page, persona)
      // A brand-new browser profile: nothing saved from an earlier visit.
      await page.addInitScript(() => {
        for (const key of Object.keys(window.localStorage)) {
          if (key.startsWith("a2g.first-run")) window.localStorage.removeItem(key)
        }
      })
      await page.goto(path)
      const frame = page.getByTestId("page-frame")
      await expect(frame.getByRole("heading", { level: 1 }).first()).toBeVisible()

      await expect(page.getByTestId("first-run-orientation")).toHaveCount(0)
      await expect(page.getByTestId("state-first-run")).toHaveCount(0)
      await expect(page.getByText("Start with the signal in your scope")).toHaveCount(0)
      // The page title is the first thing in the frame: nothing is stacked above it.
      const titleTop = await frame.getByRole("heading", { level: 1 }).first().evaluate((el) => el.getBoundingClientRect().top)
      const frameTop = await frame.evaluate((el) => el.getBoundingClientRect().top)
      expect(titleTop - frameTop, "page title offset inside the page frame").toBeLessThan(220)
    })
  }
})
