import { expect, test, type CDPSession, type Locator, type Page } from "@playwright/test"

/**
 * The 3D topic-by-territory view on Director insights at iPad viewports (playwright.config.ts), against the mock
 * adapter. The numbers behind it come from `topicHeatmap`, proven through the API as a persona in
 * tests/api/test_director_insights.py; this file proves the 3D view: touch control, the 2D fallback, reduced motion and a
 * frame budget. Every viewport in the matrix also checks the screen for overflow, overlap and touch targets
 * (e2e/support/screens.ts, `director-insights-3d`).
 */

async function signInAs(page: Page, userId: string) {
  await page.addInitScript((id) => window.localStorage.setItem("a2g.local.userId", id), userId)
}

// Software WebGL under four parallel workers: give the long gesture test room.
test.setTimeout(60_000)

const field = (page: Page) => page.getByTestId("bar-field")
const stat = async (el: Locator, name: string) => Number(await el.getAttribute(`data-${name}`))

async function open3d(page: Page) {
  await signInAs(page, "u-dir-ne")
  await page.goto("/director/insights")
  await expect(page.getByTestId("topic-heatmap")).toBeVisible()
  await page.getByTestId("heatmap-view-3d").tap()
  await expect(field(page)).toHaveAttribute("data-ready", "true", { timeout: 20_000 })
  await expect(field(page)).toHaveAttribute("data-intro", "done", { timeout: 5_000 })
  await field(page).scrollIntoViewIfNeeded()
}

/** Where the canvas is, and where each bar's top is, in page coordinates (local builds publish the second). */
async function geometry(page: Page) {
  return field(page).evaluate((el) => {
    const r = el.getBoundingClientRect()
    const bars = JSON.parse(el.getAttribute("data-bars") ?? "[]") as [number, number][]
    return { left: r.left, top: r.top, width: r.width, height: r.height, bars }
  })
}

/** A real touch gesture through the browser (Chromium turns it into pointer events, as Safari does on an iPad). */
class Touch {
  constructor(private cdp: CDPSession) {}
  static async on(page: Page) {
    return new Touch(await page.context().newCDPSession(page))
  }
  private send(type: "touchStart" | "touchMove" | "touchEnd", points: { x: number; y: number; id: number }[]) {
    return this.cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points })
  }
  async tap(x: number, y: number) {
    await this.send("touchStart", [{ x, y, id: 0 }])
    await this.send("touchEnd", [])
  }
  async drag(from: [number, number], to: [number, number], steps = 12) {
    await this.send("touchStart", [{ x: from[0], y: from[1], id: 0 }])
    for (let i = 1; i <= steps; i++) {
      await this.send("touchMove", [{ x: from[0] + ((to[0] - from[0]) * i) / steps, y: from[1] + ((to[1] - from[1]) * i) / steps, id: 0 }])
    }
    await this.send("touchEnd", [])
  }
  async pinch(centre: [number, number], from: number, to: number, steps = 10) {
    const pts = (gap: number) => [{ x: centre[0] - gap / 2, y: centre[1], id: 0 }, { x: centre[0] + gap / 2, y: centre[1], id: 1 }]
    await this.send("touchStart", pts(from))
    for (let i = 1; i <= steps; i++) await this.send("touchMove", pts(from + ((to - from) * i) / steps))
    await this.send("touchEnd", [])
  }
}

/** The scene draws only when something changes: waits until the frame counter stops. */
async function settled(el: Locator) {
  let last = -1
  await expect.poll(async () => { const now = await stat(el, "frames"); const same = now === last; last = now; return same }, { intervals: [250], timeout: 10_000 }).toBe(true)
}

/** Every distinct camera distance drawn while `act` runs and the scene settles (read from each attribute change, so none is missed). */
async function cameraSteps(page: Page, act: () => Promise<unknown>): Promise<number[]> {
  await field(page).evaluate((el) => {
    const seen: number[] = []
    ;(el as HTMLElement & { __steps?: number[] }).__steps = seen
    const last = { v: el.getAttribute("data-distance") }
    new MutationObserver(() => {
      const now = el.getAttribute("data-distance")
      if (now !== last.v) {
        last.v = now
        seen.push(Number(now))
      }
    }).observe(el, { attributes: true, attributeFilter: ["data-distance"] })
  })
  await act()
  await settled(field(page))
  return field(page).evaluate((el) => (el as HTMLElement & { __steps: number[] }).__steps)
}

test.describe("3D topic-by-territory view", () => {
  test("is a third view beside the chart and the table, with one bar per theme and territory", async ({ page }) => {
    await open3d(page)
    await expect(page.getByTestId("topic-heatmap")).toHaveAttribute("data-view", "3d")
    await expect(page.getByTestId("heatmap-view-3d")).toHaveAttribute("aria-pressed", "true")
    await expect(field(page)).toHaveAttribute("data-bar-count", String(14 * 6))
    await expect(field(page)).toHaveAttribute("aria-label", /3D bar chart of 14 rows by 6 columns\. Highest: .*Open the table view/)
    await expect(page.getByTestId("bar-field-col-label").first()).toBeVisible()
    await expect(page.getByTestId("bar-field-row-label").first()).toBeVisible()
    await expect(page.getByTestId("heatmap-legend")).toBeVisible()
    // Still the two equivalents: the same page can switch back to either.
    await page.getByTestId("heatmap-view-chart").tap()
    await expect(page.getByTestId("echart").first()).toBeVisible()
    await expect(field(page)).toHaveCount(0)
  })

  test("stays inside a frame budget: one instanced draw call, a few thousand triangles, and nothing drawn while still", async ({ page }) => {
    await open3d(page)
    await settled(field(page))
    const calls = await stat(field(page), "draw-calls")
    const triangles = await stat(field(page), "triangles")
    // 84 bars would be 84 draw calls as separate meshes. Floor, grid, instanced bars (and the selection hull) stay single digits.
    expect(calls).toBeLessThanOrEqual(6)
    expect(triangles).toBeLessThanOrEqual(5_000)
    // Demand rendering: once settled, no frames are drawn (saves battery and heat on an iPad).
    const before = await stat(field(page), "frames")
    await page.waitForTimeout(700)
    expect(await stat(field(page), "frames")).toBe(before)
  })

  test("a finger drags to rotate without scrolling the page, two fingers pinch to zoom, a tap selects a bar", async ({ page }, testInfo) => {
    await open3d(page)
    await settled(field(page))
    const touch = await Touch.on(page)
    const g = await geometry(page)
    const centre: [number, number] = [g.left + g.width / 2, g.top + g.height / 2]
    const scrollBefore = await page.evaluate(() => window.scrollY)

    // Rotate: drag across the chart. Frames are counted to get a feel for the rate (software rendering here, so a floor only).
    const az0 = await stat(field(page), "azimuth")
    const frames0 = await stat(field(page), "frames")
    const started = Date.now()
    await touch.drag([centre[0] - 120, centre[1]], [centre[0] + 120, centre[1] - 20], 24)
    await page.waitForTimeout(150)
    const seconds = (Date.now() - started) / 1000
    const rendered = (await stat(field(page), "frames")) - frames0
    testInfo.annotations.push({ type: "frames-per-second-while-dragging", description: (rendered / seconds).toFixed(1) })
    expect(rendered / seconds).toBeGreaterThan(5)
    expect(await stat(field(page), "azimuth")).not.toBe(az0)
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore)

    // Pinch out: the camera moves in.
    await settled(field(page))
    const d0 = await stat(field(page), "distance")
    await touch.pinch(centre, 80, 220)
    await settled(field(page))
    expect(await stat(field(page), "distance")).toBeLessThan(d0)

    // Reset, then tap the front-left bar (the strongest cell for this scope): it is selected, and the shared detail card opens.
    await page.getByTestId("bar-field-reset").tap()
    await expect.poll(() => stat(field(page), "azimuth"), { timeout: 5_000 }).toBe(-0.5)
    await settled(field(page))
    const home = await geometry(page)
    const [bx, by] = home.bars[(14 - 1) * 6]
    await touch.tap(home.left + bx, home.top + by + 8)
    await expect(field(page)).not.toHaveAttribute("data-selected", "")
    await expect(page.getByTestId("cell-detail")).toBeVisible()
    await expect(page.getByTestId("bar-field-readout")).toContainText("free-text responses")
    const selected = (await field(page).getAttribute("data-selected"))!.split("|")
    await expect(page.getByTestId("cell-detail")).toContainText(selected[0])
    await expect(page.getByTestId("cell-detail")).toContainText(selected[1])

    // The same selection shows in the table twin.
    await page.getByTestId("heatmap-view-table").tap()
    await expect(page.locator(`[data-testid="heatmap-cell"][data-topic="${selected[0]}"][data-territory="${selected[1]}"]`)).toHaveAttribute("aria-pressed", "true")
  })

  test("a tap that lands beside a slim bar still picks the nearest one, and a tap on empty floor picks nothing", async ({ page }) => {
    await open3d(page)
    await settled(field(page))
    const touch = await Touch.on(page)
    const g = await geometry(page)
    const [bx, by] = g.bars[(14 - 1) * 6 + 5]
    await touch.tap(g.left + bx + 10, g.top + by + 22)
    await expect(field(page)).not.toHaveAttribute("data-selected", "")
    // Far corner of the canvas: nothing there.
    const picked = await field(page).getAttribute("data-selected")
    await touch.tap(g.left + 12, g.top + 12)
    await expect(field(page)).toHaveAttribute("data-selected", picked!)
  })

  test("buttons and arrow keys move the camera, and Reset returns to the first view", async ({ page }) => {
    await open3d(page)
    await settled(field(page))
    const d0 = await stat(field(page), "distance")
    await page.getByTestId("bar-field-zoom-in").tap()
    await expect.poll(() => stat(field(page), "distance")).toBeLessThan(d0)
    await page.getByTestId("bar-field-zoom-out").tap()
    await page.getByTestId("bar-field-zoom-out").tap()
    await expect.poll(() => stat(field(page), "distance")).toBeGreaterThan(d0)
    await field(page).focus()
    await page.keyboard.press("ArrowRight")
    await expect.poll(() => stat(field(page), "azimuth")).toBeGreaterThan(-0.5)
    await page.getByTestId("bar-field-reset").tap()
    await expect.poll(() => stat(field(page), "azimuth")).toBe(-0.5)
    await expect.poll(() => stat(field(page), "distance")).toBeCloseTo(d0, 1)
  })

  test("resizes with the window and keeps the field in view", async ({ page }) => {
    await open3d(page)
    await settled(field(page))
    const size = page.viewportSize()!
    await page.setViewportSize({ width: size.height, height: size.width })
    await expect(page.getByTestId("heatmap-view-3d")).toBeVisible()
    await field(page).scrollIntoViewIfNeeded()
    await settled(field(page))
    const g = await geometry(page)
    expect(g.width).toBeGreaterThan(280)
    // Every bar top is inside the canvas after the resize.
    for (const [x, y] of g.bars) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(g.width)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(g.height)
    }
  })
})

test.describe("3D view: reduced motion", () => {
  test.use({ reducedMotion: "reduce" })

  test("no bar rise and no glide: the scene is complete on its first frame and steps jump", async ({ page }) => {
    await open3d(page)
    await expect(field(page)).toHaveAttribute("data-motion", "reduced")
    await expect(page.getByText("Reduced motion is on")).toBeVisible()
    // The intro is already done on the first stats report, and nothing is animating afterwards.
    await expect(field(page)).toHaveAttribute("data-intro", "done")
    await settled(field(page))
    const d0 = await stat(field(page), "distance")
    const steps = await cameraSteps(page, () => page.getByTestId("bar-field-zoom-in").tap())
    // One press is one jump: the camera goes from where it was to where it is going in a single change.
    expect(steps).toHaveLength(1)
    expect(steps[0]).toBeLessThan(d0)
  })

  test("full motion animates the same step over several frames", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, reducedMotion: "no-preference", viewport: { width: 1180, height: 820 }, hasTouch: true })
    const page = await context.newPage()
    await open3d(page)
    await expect(field(page)).toHaveAttribute("data-motion", "full")
    await settled(field(page))
    const d0 = await stat(field(page), "distance")
    const steps = await cameraSteps(page, () => page.getByTestId("bar-field-zoom-in").tap())
    // The same press glides: at least one in-between position is drawn on the way, in order.
    expect(steps.length).toBeGreaterThanOrEqual(2)
    expect(steps[0]).toBeLessThan(d0)
    expect([...steps].sort((a, b) => b - a)).toEqual(steps)
    await context.close()
  })
})

test.describe("3D view: 2D fallback", () => {
  test("without WebGL the 3D button explains itself and the 2D chart stays", async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
        if (/webgl/i.test(kind)) return null
        return (original as (...a: unknown[]) => RenderingContext | null).call(this, kind, ...rest)
      } as typeof original
    })
    await signInAs(page, "u-dir-ne")
    await page.goto("/director/insights")
    await expect(page.getByTestId("topic-heatmap")).toBeVisible()
    await page.getByTestId("heatmap-view-3d").tap()
    await expect(page.getByTestId("heatmap-3d-notice")).toContainText("needs WebGL")
    await expect(page.getByTestId("topic-heatmap")).toHaveAttribute("data-view", "chart")
    await expect(page.getByTestId("echart").first()).toBeVisible()
    await expect(field(page)).toHaveCount(0)
    // The table is untouched, and choosing a view clears the notice.
    await page.getByTestId("heatmap-view-table").tap()
    await expect(page.getByTestId("heatmap-3d-notice")).toHaveCount(0)
    await expect(page.getByTestId("heatmap-table")).toBeVisible()
  })

  test("if the graphics context is lost while viewing, the 2D chart takes over and says so", async ({ page }) => {
    await open3d(page)
    await field(page).locator("canvas").evaluate((canvas) => {
      const gl = (canvas as HTMLCanvasElement).getContext("webgl2") ?? (canvas as HTMLCanvasElement).getContext("webgl")
      gl?.getExtension("WEBGL_lose_context")?.loseContext()
    })
    await expect(page.getByTestId("heatmap-3d-notice")).toContainText("graphics context")
    await expect(page.getByTestId("topic-heatmap")).toHaveAttribute("data-view", "chart")
    await expect(page.getByTestId("echart").first()).toBeVisible()
  })
})

test.describe("3D view: desktop pointer", () => {
  test.use({ hasTouch: false, isMobile: false, viewport: { width: 1280, height: 800 } })

  test("the wheel scrolls the page past the chart; Ctrl + wheel zooms it; a click selects", async ({ page }) => {
    await signInAs(page, "u-dir-ne")
    await page.goto("/director/insights")
    await page.getByTestId("heatmap-view-3d").click()
    await expect(field(page)).toHaveAttribute("data-intro", "done", { timeout: 20_000 })
    await field(page).scrollIntoViewIfNeeded()
    await settled(field(page))
    const g = await geometry(page)
    await page.mouse.move(g.left + g.width / 2, g.top + g.height / 2)
    const d0 = await stat(field(page), "distance")
    const y0 = await page.evaluate(() => window.scrollY)
    await page.mouse.wheel(0, 200)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(y0)
    expect(await stat(field(page), "distance")).toBe(d0)
    await page.keyboard.down("Control")
    await page.mouse.wheel(0, -300)
    await page.keyboard.up("Control")
    await expect.poll(() => stat(field(page), "distance")).toBeLessThan(d0)

    await page.getByTestId("bar-field-reset").click()
    await settled(field(page))
    const home = await geometry(page)
    const [bx, by] = home.bars[(14 - 1) * 6]
    // Relative to the canvas, so Playwright scrolls it into view first (the wheel moved the page).
    await field(page).click({ position: { x: bx, y: by + 8 } })
    await expect(page.getByTestId("cell-detail")).toBeVisible()
  })
})
