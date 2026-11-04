import { expect, test, type Page } from "@playwright/test"

/**
 * The territory map at iPad viewports (see playwright.config.ts): the Executive's globe, the tap that
 * flies into a country and swaps to the flat real map, the tap into a territory, and the MSL and Director
 * landing straight on their own scope. Everything must work without a third-party request.
 */

const map = (page: Page) => page.getByTestId("territory-map")

async function signInAs(page: Page, userId: string) {
  await page.addInitScript((id) => window.localStorage.setItem("a2g.local.userId", id), userId)
}

/** Fails the test if the page asks any origin but its own: no tile server, no key, no CDN. */
function forbidThirdParties(page: Page, base: string) {
  const outside: string[] = []
  page.on("request", (req) => {
    const url = new URL(req.url())
    if (!["http:", "https:"].includes(url.protocol)) return
    if (url.origin !== new URL(base).origin) outside.push(url.origin)
  })
  return () => expect(outside, "requests to other origins").toEqual([])
}

test.describe("Executive: globe to flat map to territory", () => {
  test("tap a country on the globe, fly in, then tap a territory", async ({ page, baseURL }) => {
    const noThirdParties = forbidThirdParties(page, baseURL!)
    await signInAs(page, "u-exec-all")
    await page.goto("/executive")

    // 1. The globe, with a marker per country and the date range on screen.
    await expect(map(page)).toHaveAttribute("data-renderer", "globe")
    await expect(map(page)).toHaveAttribute("data-view", "world")
    await expect(page.getByTestId("globe")).toBeVisible()
    await expect(page.getByTestId("map-range")).toContainText("Distinct calls")
    await expect(page.getByTestId("map-legend")).toBeVisible()
    for (const code of ["US", "CA", "GB", "DE", "FR", "JP", "BR"]) {
      await expect(page.getByTestId(`globe-marker-${code}`)).toHaveCount(1)
      await expect(page.getByTestId(`country-option-${code}`)).toBeVisible()
    }

    // 2. Tap a country's marker on the globe: the camera flies in, then the flat map takes over.
    await page.getByTestId("globe-marker-BR").tap()
    await expect(map(page)).toHaveAttribute("data-flying", "BR")
    await expect(map(page)).toHaveAttribute("data-view", "country")
    await expect(map(page)).toHaveAttribute("data-country", "BR")
    await expect(page.getByTestId("flat-map-canvas")).toBeVisible()
    await expect(page.getByTestId("country-detail")).toContainText("Brazil")
    await expect(page.getByTestId("crumb-country")).toContainText("Brazil")

    // 3. Tap the territory: the map drills into it.
    await page.getByTestId("territory-option-WE-06").tap()
    await expect(map(page)).toHaveAttribute("data-view", "territory")
    await expect(map(page)).toHaveAttribute("data-territory", "WE-06")
    await expect(page.getByTestId("territory-detail")).toContainText("Sao Paulo")
    expect(Number((await page.getByTestId("territory-calls").innerText()).replace(/,/g, ""))).toBeGreaterThan(0)

    // 4. Back out to the world: the globe returns.
    await page.getByTestId("crumb-world").tap()
    await expect(map(page)).toHaveAttribute("data-view", "world")
    await expect(page.getByTestId("globe")).toBeVisible()
    noThirdParties()
  })

  test("the US opens as states coloured by distinct calls, and a state opens its territory", async ({ page }) => {
    await signInAs(page, "u-exec-all")
    await page.goto("/executive")
    await page.getByTestId("country-option-US").tap()
    await expect(map(page)).toHaveAttribute("data-country", "US")
    await expect(map(page)).toHaveAttribute("data-lit", /NE-01.*WE-04/)
    expect((await map(page).getAttribute("data-lit"))!.split(",")).toHaveLength(18)
    await expect(page.getByTestId("country-detail")).toContainText("18 territories")
    await page.getByTestId("territory-option-WE-03").tap()
    await expect(page.getByTestId("territory-detail")).toContainText("California")
    await expect(map(page)).toHaveAttribute("data-territory", "WE-03")
  })

  test("reduced motion gets the flat map and nothing animates", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    await signInAs(page, "u-exec-all")
    await page.goto("/executive")
    await expect(map(page)).toHaveAttribute("data-renderer", "flat")
    await expect(map(page)).toHaveAttribute("data-view", "world")
    await expect(page.getByTestId("globe")).toHaveCount(0)
    await expect(page.getByTestId("flat-map-canvas")).toBeVisible()
    await page.getByTestId("country-option-JP").tap()
    // No fly-in: the country map is there at once.
    await expect(map(page)).toHaveAttribute("data-flying", "")
    await expect(map(page)).toHaveAttribute("data-view", "country")
    await expect(map(page)).toHaveAttribute("data-country", "JP")
    await page.getByTestId("territory-option-WE-05").tap()
    await expect(map(page)).toHaveAttribute("data-territory", "WE-05")
  })
})

test.describe("MSL and Director land on the flat map of their own scope", () => {
  test("an MSL sees only their territory, nothing else is named or coloured", async ({ page }) => {
    await signInAs(page, "u-msl-ne-01")
    await page.goto("/msl")
    await expect(map(page)).toHaveAttribute("data-renderer", "flat")
    await expect(map(page)).toHaveAttribute("data-view", "country")
    await expect(map(page)).toHaveAttribute("data-country", "US")
    await expect(map(page)).toHaveAttribute("data-lit", "NE-01")
    const panel = page.getByTestId("map-panel")
    await expect(panel).toContainText("Boston Metro")
    for (const other of ["New York", "Toronto", "Atlanta", "Tokyo", "Canada"]) await expect(panel).not.toContainText(other)
    await expect(page.getByTestId("globe")).toHaveCount(0)
    await page.getByTestId("territory-option-NE-01").tap()
    await expect(page.getByTestId("territory-detail")).toContainText("Your territory")
  })

  test("a Director sees their region's countries and territories only", async ({ page }) => {
    await signInAs(page, "u-dir-ne")
    await page.goto("/director")
    await expect(map(page)).toHaveAttribute("data-renderer", "flat")
    await expect(map(page)).toHaveAttribute("data-view", "world")
    await expect(map(page)).toHaveAttribute("data-lit", "CA,US")
    await expect(page.getByTestId("country-option-GB")).toHaveCount(0)
    await page.getByTestId("country-option-US").tap()
    await expect(map(page)).toHaveAttribute("data-lit", "NE-01,NE-02,NE-03,NE-04,NE-05")
    await expect(page.getByTestId("map-panel")).not.toContainText("Atlanta")
  })

  test("changing the date range keeps the drill-down and updates the counts", async ({ page }) => {
    await signInAs(page, "u-dir-ne")
    await page.goto("/director")
    await page.getByTestId("country-option-US").tap()
    const before = Number((await page.getByTestId("country-calls").innerText()).replace(/,/g, ""))
    await page.getByTestId("range-90d").tap()
    await expect.poll(async () => Number((await page.getByTestId("country-calls").innerText()).replace(/,/g, ""))).toBeGreaterThan(before)
    await expect(map(page)).toHaveAttribute("data-view", "country")
  })
})
