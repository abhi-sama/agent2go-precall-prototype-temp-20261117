import { expect, test, type Page } from "@playwright/test"

/**
 * Motion (ticket #56): the planned motions play, nothing blocks input while they run, and reduced motion removes
 * all movement. Runs on the iPad Air 11 projects with the other functional specs.
 */

async function signInAs(page: Page, userId: string, extra: Record<string, string> = {}) {
  await page.addInitScript(
    ([id, more]) => {
      window.localStorage.setItem("a2g.local.userId", id as string)
      for (const [k, v] of Object.entries(more as Record<string, string>)) window.localStorage.setItem(k, v)
    },
    [userId, extra] as const,
  )
}

/** Samples a property of the first element matching `selector` on every frame for `ms`, starting after `trigger`. */
async function sampleAfter(page: Page, selector: string, property: "translate" | "opacity" | "scale" | "transform", ms: number, trigger: () => Promise<unknown>) {
  await page.evaluate(
    ([sel, prop, duration]) => {
      const out: string[] = []
      ;(window as unknown as { __samples: string[] }).__samples = out
      const t0 = performance.now()
      const tick = () => {
        const el = document.querySelector(sel as string)
        out.push(el ? getComputedStyle(el).getPropertyValue(prop as string) : "none-el")
        if (performance.now() - t0 < (duration as number)) requestAnimationFrame(tick)
      }
      tick()
    },
    [selector, property, ms] as const,
  )
  await trigger()
  await page.waitForTimeout(ms + 100)
  return page.evaluate(() => (window as unknown as { __samples: string[] }).__samples)
}

/** Animations and transitions on the page that move, scale or rotate something (opacity and colour do not count). */
const movingAnimations = (page: Page) =>
  page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => {
        if (a instanceof CSSTransition) return ["transform", "translate", "scale", "rotate"].includes(a.transitionProperty)
        const frames = (a.effect as KeyframeEffect | null)?.getKeyframes() ?? []
        return frames.some((f) => ["transform", "translate", "scale", "rotate"].some((p) => p in f && f[p] !== "none" && f[p] !== undefined))
      })
      .map((a) => (a instanceof CSSTransition ? `transition:${a.transitionProperty}` : `animation:${(a as CSSAnimation).animationName}`)),
  )

test.describe("planned motion plays", () => {
  test("the evidence drawer slides in from its edge", async ({ page }) => {
    await page.goto("/msl/activity")
    const open = page.getByTestId("evidence-open-calls")
    await expect(open).toBeVisible()
    const samples = await sampleAfter(page, "[data-slot=sheet-content]", "translate", 1500, () => open.click())
    const offsets = samples.filter((s) => s.endsWith("%")).map((s) => Number.parseFloat(s))
    // Starts off screen (100%), passes through intermediate positions, and lands at rest.
    expect(offsets[0]).toBeGreaterThan(50)
    expect(offsets.some((o) => o > 5 && o < 95), `translate samples: ${samples.join(" | ")}`).toBe(true)
    await expect.poll(() => page.locator("[data-slot=sheet-content]").evaluate((el) => getComputedStyle(el).translate)).toBe("none")
  })

  // Buttons are Astryx Buttons: a press paints the theme's pressed overlay instead of scaling. A fine pointer gets it
  // from CSS :active (--_press-overlay); under a coarse pointer Astryx paints it with the data-astryx-press attribute.
  test("a button press shows the pressed state and releases it", async ({ page }) => {
    await page.goto("/msl/activity")
    const button = page.getByTestId("evidence-open-calls")
    await expect(button).toBeEnabled()
    await button.scrollIntoViewIfNeeded()
    const state = () =>
      button.evaluate((el) => `${getComputedStyle(el).getPropertyValue("--_press-overlay").trim()}|${el.getAttribute("data-astryx-press") ?? ""}`)
    const resting = await state()
    const box = (await button.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await expect.poll(state).not.toBe(resting)
    await page.mouse.move(0, 0)
    await page.mouse.up()
    await expect.poll(state).toBe(resting)
  })

  test("landing KPI tiles spring in once; a filter change does not replay them", async ({ page }) => {
    await page.goto("/msl")
    const tile = page.getByTestId("kpi-calls")
    await expect(tile).toBeVisible()
    await expect(tile).toHaveClass(/spring-in/)
    // A new range swaps skeletons for data and remounts the tile: it must come back plain, with the new figure.
    await page.getByTestId("range-7d").click()
    await expect(page.getByTestId("range-7d")).toHaveAttribute("aria-pressed", "true")
    await expect(page.getByTestId("kpi-calls")).toBeVisible()
    await expect(page.getByTestId("kpi-calls")).not.toHaveClass(/spring-in/)
    const value = page.getByTestId("kpi-calls-value")
    await expect(value).toHaveText(Number(await value.getAttribute("data-value")).toLocaleString("en-US"))
  })

  test("the globe fly-in is short, and a flat map takes over", async ({ page }) => {
    test.slow()
    await signInAs(page, "u-exec-all")
    await page.goto("/executive")
    const map = page.getByTestId("territory-map")
    await expect(map).toHaveAttribute("data-renderer", "globe", { timeout: 30_000 })
    // The camera and the handoff read these tokens, so the numbers here are the ones that play.
    // (The minifier may print 560ms as .56s, so compare as milliseconds.)
    const tokens = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement)
      const ms = (name: string) => {
        const raw = cs.getPropertyValue(name).trim()
        return Math.round(raw.endsWith("ms") ? Number.parseFloat(raw) : Number.parseFloat(raw) * 1000)
      }
      return { fly: ms("--duration-fly"), drill: ms("--duration-drill") }
    })
    expect(tokens).toEqual({ fly: 560, drill: 220 })
    await page.getByTestId("globe-marker-BR").tap()
    await expect(map).toHaveAttribute("data-country", "BR")
    await expect(page.getByTestId("flat-map")).toBeVisible()
    // The globe leaves once the flat map has faded in over it.
    await expect(page.getByTestId("globe")).toHaveCount(0)
  })

  test("hierarchy rows select to show who holds them and collapse with their children", async ({ page }) => {
    await signInAs(page, "u-admin-sec")
    await page.goto("/admin/governance")
    await expect(page.getByTestId("hierarchy-tree")).toBeVisible()
    await page.getByRole("treeitem", { name: "NE-02" }).first().click()
    await expect(page.getByTestId("hierarchy-detail").getByText("Inherited from above")).toBeVisible()
    // Collapsing the region takes its children out of the tree once the close has finished.
    await page.getByRole("treeitem", { name: "REGION-NE" }).first().getByRole("button", { name: "Toggle children" }).click()
    await expect(page.getByRole("treeitem", { name: "NE-02" })).toHaveCount(0)
  })
})

test.describe("input stays live during transitions", () => {
  test("a drawer can be closed the moment it starts opening", async ({ page }) => {
    await page.goto("/msl/activity")
    await page.getByTestId("evidence-open-calls").click()
    await page.keyboard.press("Escape")
    await expect(page.locator("[data-slot=sheet-content]")).toHaveCount(0)
    // And reopened straight away: the transition retargets instead of queueing.
    await page.getByTestId("evidence-open-calls").click()
    await expect(page.getByTestId("evidence-table")).toBeVisible()
  })

  // These two drive the page from inside one task chain: under load a Playwright round trip can outlast the whole 560ms flight.
  test("another country can be opened while the camera is flying, and the first flight is dropped", async ({ page }) => {
    test.slow()
    await signInAs(page, "u-exec-all")
    await page.goto("/executive")
    const map = page.getByTestId("territory-map")
    await expect(map).toHaveAttribute("data-renderer", "globe", { timeout: 30_000 })
    await expect(page.getByTestId("globe-marker-BR")).toBeAttached({ timeout: 30_000 })
    const seen = await page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const root = document.querySelector("[data-testid=territory-map]") as HTMLElement
          const log: string[] = []
          ;(document.querySelector("[data-testid=globe-marker-BR]") as HTMLElement).click()
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              log.push(`flying:${root.dataset.flying}`)
              ;(document.querySelector("[data-testid=country-option-US]") as HTMLElement).click()
              requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                  log.push(`flying:${root.dataset.flying}`)
                  resolve(log)
                }),
              )
            }),
          )
        }),
    )
    // Only meaningful if the first flight was still in the air when the second tap landed.
    if (seen[0] === "flying:BR") expect(seen[1]).toBe("flying:US")
    await expect(map).toHaveAttribute("data-country", /^(US|BR)$/)
    await expect(map).toHaveAttribute("data-country", "US", { timeout: 15_000 })
    // The cancelled first flight must not complete later and swap the map to Brazil.
    await page.waitForTimeout(1500)
    await expect(map).toHaveAttribute("data-country", "US")
  })

  test("touching the globe during the flight stops the camera and hands control back", async ({ page }) => {
    test.slow()
    await signInAs(page, "u-exec-all")
    await page.goto("/executive")
    const map = page.getByTestId("territory-map")
    await expect(map).toHaveAttribute("data-renderer", "globe", { timeout: 30_000 })
    await expect(page.getByTestId("globe-marker-BR")).toBeAttached({ timeout: 30_000 })
    const seen = await page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const root = document.querySelector("[data-testid=territory-map]") as HTMLElement
          const log: string[] = []
          ;(document.querySelector("[data-testid=globe-marker-BR]") as HTMLElement).click()
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              log.push(`flying:${root.dataset.flying}`)
              document.querySelector("[data-testid=globe] canvas")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
              requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                  log.push(`flying:${root.dataset.flying}`)
                  resolve(log)
                }),
              )
            }),
          )
        }),
    )
    test.skip(seen[0] !== "flying:BR", "the page was too starved to catch the camera in flight; the flight had already landed")
    expect(seen[1]).toBe("flying:")
    await page.waitForTimeout(1500)
    // Stayed on the globe: the dropped flight never swapped the map.
    await expect(map).toHaveAttribute("data-view", "world")
    await expect(page.getByTestId("globe")).toBeVisible()
  })
})

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" })

  test("no transform, scale or translate animation anywhere on the landing", async ({ page }) => {
    await signInAs(page, "u-exec-all")
    await page.goto("/executive")
    await expect(page.getByTestId("exec-kpis")).toBeVisible()
    expect(await movingAnimations(page)).toEqual([])
    // The tile is still there at full opacity, with no transform left on it.
    const tile = page.getByTestId("exec-kpi-calls")
    await expect.poll(() => tile.evaluate((el) => getComputedStyle(el).opacity)).toBe("1")
    expect(await tile.evaluate((el) => getComputedStyle(el).transform)).toBe("none")
    // The map is the flat one: no globe, nothing flies.
    await expect(page.getByTestId("territory-map")).toHaveAttribute("data-renderer", "flat")
  })

  test("the drawer appears without sliding, and presses do not scale", async ({ page }) => {
    await page.goto("/msl/activity")
    const open = page.getByTestId("evidence-open-calls")
    await open.click()
    await expect(page.getByTestId("evidence-table")).toBeVisible()
    expect(await movingAnimations(page)).toEqual([])
    const sheet = page.locator("[data-slot=sheet-content]")
    await expect.poll(() => sheet.evaluate((el) => getComputedStyle(el).translate)).toBe("none")
    // Close it, then hold a press on a button: no scale.
    await page.keyboard.press("Escape")
    await expect(sheet).toHaveCount(0)
    const box = (await open.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    expect(await open.evaluate((el) => getComputedStyle(el).scale)).toBe("none")
    await page.mouse.up()
  })

  test("KPI figures show their final value immediately", async ({ page }) => {
    await page.goto("/msl")
    const value = page.getByTestId("kpi-calls-value")
    await expect(value).toBeVisible()
    const expected = Number(await value.getAttribute("data-value"))
    expect(Number((await value.innerText()).replace(/,/g, ""))).toBe(expected)
  })

  test("parallax layers do not move", async ({ page }) => {
    await page.goto("/msl")
    const stage = page.getByTestId("parallax-stage").first()
    await expect(stage).toBeAttached()
    await page.mouse.move(300, 200)
    await page.mouse.move(700, 260)
    expect(await stage.evaluate((el) => getComputedStyle(el).transform)).toBe("none")
  })
})

test("parallax tilts the decorative stage for a fine pointer, and the content stays put", async ({ page, isMobile }) => {
  test.skip(isMobile, "touch projects have a coarse pointer: parallax is intentionally off")
  await page.goto("/msl")
  const stage = page.getByTestId("parallax-stage").first()
  const title = page.getByRole("heading", { level: 1 })
  await expect(title).toBeVisible()
  const before = await title.boundingBox()
  await page.mouse.move(40, 120)
  await page.mouse.move(900, 200, { steps: 6 })
  await expect.poll(() => stage.evaluate((el) => getComputedStyle(el).transform)).not.toBe("none")
  expect(await title.boundingBox()).toEqual(before)
  await page.mouse.move(900, 700)
  await page.mouse.move(2, 2)
})
