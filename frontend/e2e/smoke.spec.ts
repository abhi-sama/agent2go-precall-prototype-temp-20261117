import { expect, test, type Page } from "@playwright/test"

const kpiValue = async (page: Page, id: string) => Number(await page.getByTestId(`kpi-${id}-value`).getAttribute("data-value"))

const HCP_TIMELINE_VIEWPORTS = [
  { name: "MacBook Air 13", width: 1280, height: 800 },
  { name: "MacBook Air 13 large", width: 1470, height: 956 },
  { name: "MacBook Pro 14", width: 1512, height: 982 },
  { name: "MacBook Pro 16", width: 1728, height: 1117 },
  { name: "Desktop HD", width: 1920, height: 1080 },
  { name: "Desktop QHD", width: 2560, height: 1440 },
  { name: "iPad Air 11 portrait", width: 820, height: 1180, touch: true },
  { name: "iPad Air 11 landscape", width: 1180, height: 820, touch: true },
  { name: "iPad Pro 11 portrait", width: 834, height: 1194, touch: true },
  { name: "iPad Pro 11 landscape", width: 1194, height: 834, touch: true },
  { name: "iPad Air 13 portrait", width: 1024, height: 1366, touch: true },
  { name: "iPad Air 13 landscape", width: 1366, height: 1024, touch: true },
  { name: "iPad Pro 13 portrait", width: 1032, height: 1376, touch: true },
  { name: "iPad Pro 13 landscape", width: 1376, height: 1032, touch: true },
] as const

test.beforeEach(async ({ page }) => {
  // Start every test as the default seeded MSL, regardless of earlier switches.
  await page.addInitScript(() => window.localStorage.removeItem("a2g.local.userId"))
})

test.describe("MSL landing", () => {
  test("renders scope, freshness, KPI cards and the territory map", async ({ page }) => {
    await page.goto("/msl")
    await expect(page.getByRole("heading", { level: 1, name: "My territory" })).toBeVisible()
    await expect(page.getByTestId("scope-label")).toContainText("Territory NE-01")
    await expect(page.getByTestId("data-through")).toContainText("Data through")

    for (const id of ["calls", "hcps", "responses"]) {
      await expect(page.getByTestId(`kpi-${id}`)).toBeVisible()
      expect(await kpiValue(page, id)).toBeGreaterThan(0)
    }
    // Engaged HCPs cannot exceed distinct calls (calls are counted once, not per row).
    expect(await kpiValue(page, "hcps")).toBeLessThanOrEqual(await kpiValue(page, "calls"))

    // An MSL lands directly on the flat map of their own territory.
    await expect(page.getByTestId("territory-map")).toBeVisible()
    await expect(page.getByTestId("territory-map")).toHaveAttribute("data-renderer", "flat")
    await expect(page.getByTestId("territory-map")).toHaveAttribute("data-view", "country")
    await expect(page.getByTestId("territory-map")).toHaveAttribute("data-lit", "NE-01")
  })

  test("changing the date range reloads the KPIs", async ({ page }) => {
    await page.goto("/msl")
    await expect(page.getByTestId("kpi-calls")).toBeVisible()
    const before = await kpiValue(page, "calls")
    await page.getByTestId("range-90d").click()
    await expect.poll(() => kpiValue(page, "calls")).toBeGreaterThan(before)
  })

  test("touch targets are at least 44pt", async ({ page }) => {
    await page.goto("/msl")
    for (const id of ["appearance-settings", "persona-switch", "range-30d"]) {
      const target = page.getByTestId(id)
      await expect(target).toBeVisible()
      // Layout size, polled: the header settles into its touch layout after hydration.
      const size = () => target.evaluate((el) => Math.min(el.getBoundingClientRect().width, el.getBoundingClientRect().height))
      await expect.poll(size, { message: `${id} smaller side` }).toBeGreaterThanOrEqual(44)
    }
  })

  // TODO(#81): The seeded nested response-insight fixture is absent on iPad Air 11;
  // re-enable once the fixture consistently exposes the authorized HCP's child record.
  test.fixme("searches and selects an authorized HCP with an explicit missing profile field", async ({ page }) => {
    await page.goto("/msl")
    await page.getByTestId("hcp-search-input").fill("call system")
    await page.getByTestId("hcp-search-submit").click()
    const result = page.getByTestId("hcp-result-HCP-0001")
    await expect(result).toBeVisible()
    const box = await result.boundingBox()
    expect(box?.height).toBeGreaterThanOrEqual(44)
    await result.click()
    await expect(page.getByTestId("hcp-profile")).toContainText("Call system HCP 0001")
    await expect(page.getByTestId("hcp-profile")).toContainText("Credentials")
    await expect(page.getByTestId("hcp-profile")).toContainText("Missing")
    await expect(page.getByTestId("hcp-profile")).toContainText("Not available")
    await expect(page.getByTestId("hcp-timeline")).toBeVisible()
    await expect(page.getByTestId("call-CALL-MOCK-1001")).toContainText("osimertinib")
    const child = page.getByTestId("response-insight-mock-child")
    await expect(page.getByTestId("response-insight-mock-parent")).toHaveCount(1)
    // Follow-up answers are deliberately rendered only after their parent is opened.
    await expect(child).toHaveCount(0)
    await page.getByTestId("response-toggle-insight-mock-parent").click()
    await expect(child).toBeVisible()
    await expect(page.getByTestId("hcp-perspective-history")).toContainText("Recorded over time")
  })

  test.describe("HCP timeline viewport matrix", () => {
    // These visual checks deliberately share one local build; serial execution avoids starving it
    // with fourteen simultaneous full page loads.
    test.describe.configure({ mode: "serial" })
    for (const viewport of HCP_TIMELINE_VIEWPORTS) {
      test(`keeps the HCP interaction timeline usable at ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize(viewport)
        await page.goto("/msl")
        await page.getByTestId("hcp-search-input").fill("call system")
        await page.getByTestId("hcp-search-submit").click()
        await page.getByTestId("hcp-result-HCP-0001").click()
        await expect(page.getByTestId("hcp-profile")).toBeVisible({ timeout: 10_000 })
        await expect(page.getByTestId("hcp-timeline")).toBeVisible({ timeout: 10_000 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), viewport.name).toBe(true)
        if ("touch" in viewport && viewport.touch) {
          for (const summary of await page.getByTestId("hcp-response-cards").locator("summary").all()) {
            const box = await summary.boundingBox()
            expect(box?.height, `${viewport.name} response card target`).toBeGreaterThanOrEqual(44)
          }
        }
      })
    }
  })
})

test.describe("states", () => {
  test("empty range shows the empty state", async ({ page }) => {
    await page.goto("/msl?scenario=empty")
    await expect(page.getByTestId("state-empty")).toBeVisible()
  })

  test("service failure shows an error with retry", async ({ page }) => {
    await page.goto("/msl?scenario=error")
    await expect(page.getByTestId("state-error").first()).toBeVisible()
    await expect(page.getByRole("button", { name: "Try again" }).first()).toBeVisible()
  })

  test("forbidden shows a locked state with no retry", async ({ page }) => {
    await page.goto("/msl?scenario=forbidden")
    await expect(page.getByTestId("state-error").first()).toContainText("No access")
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0)
  })

  test("a slow load shows skeletons first", async ({ page }) => {
    await page.goto("/msl?scenario=slow")
    await expect(page.getByTestId("state-loading").first()).toBeVisible()
    await expect(page.getByTestId("kpi-calls")).toBeVisible({ timeout: 10_000 })
  })

  test("stale data is flagged on the badge", async ({ page }) => {
    await page.goto("/msl?scenario=stale")
    await expect(page.getByTestId("data-through")).toHaveAttribute("data-stale", "true")
  })
})

test("appearance settings switch light and dark", async ({ page }) => {
  await page.goto("/msl")
  const html = page.locator("html")
  await page.getByTestId("appearance-settings").click()
  await page.getByTestId("appearance-mode-dark").click()
  await expect(html).toHaveAttribute("data-color-scheme", "dark")
  await expect.poll(() => html.evaluate((el) => el.classList.contains("dark"))).toBe(true)
  await page.getByTestId("appearance-mode-light").click()
  await expect(html).toHaveAttribute("data-color-scheme", "light")
  await expect.poll(() => html.evaluate((el) => el.classList.contains("dark"))).toBe(false)
})

test("persona quick-switch changes landing route, scope and data", async ({ page }) => {
  await page.goto("/msl")
  await expect(page.getByTestId("scope-label")).toContainText("NE-01")

  await page.getByTestId("persona-switch").click()
  await page.getByTestId("persona-option-u-dir-ne").click()
  await expect(page).toHaveURL(/\/director$/)
  await expect(page.getByRole("heading", { level: 1, name: "My region" })).toBeVisible()
  await expect(page.getByTestId("scope-label")).toContainText("Region Northeast")
  const directorCalls = await (async () => {
    await expect(page.getByTestId("kpi-calls")).toBeVisible()
    return Number(await page.getByTestId("kpi-calls-value").getAttribute("data-value"))
  })()

  await page.getByTestId("persona-switch").click()
  await page.getByTestId("persona-option-u-exec-all").click()
  await expect(page).toHaveURL(/\/executive$/)
  await expect(page.getByTestId("scope-label")).toContainText("aggregate only")

  await page.getByTestId("persona-switch").click()
  await page.getByTestId("persona-option-u-admin-sec").click()
  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByRole("heading", { level: 1, name: "Administration" })).toBeVisible()

  // Wider scope sees more than a single territory.
  await page.getByTestId("persona-switch").click()
  await page.getByTestId("persona-option-u-msl-ne-01").click()
  await expect(page).toHaveURL(/\/msl$/)
  await expect(page.getByTestId("kpi-calls")).toBeVisible()
  expect(directorCalls).toBeGreaterThan(await kpiValue(page, "calls"))
})

test("administrator can review governed access controls at the iPad viewport", async ({ page }) => {
  await page.goto("/msl")
  await page.getByTestId("persona-switch").click()
  await page.getByTestId("persona-option-u-admin-sec").click()
  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByRole("heading", { level: 2, name: "Login-to-roster reconciliation" })).toBeVisible()
  await expect(page.getByTestId("identity-reconciliation")).toContainText("conflicting")
  await expect(page.getByRole("heading", { level: 2, name: "Role permission matrix" })).toBeVisible()
  await expect(page.getByTestId("scope-assignments")).toContainText("Unresolved")
  await expect(page.getByTestId("access-audit-filters")).toBeVisible()
  await expect(page.getByTestId("access-audit-filters").getByText("From time").first()).toBeVisible()
  await expect(page.getByTestId("access-audit-filters").getByText("To time").first()).toBeVisible()
  const addAssignment = await page.getByRole("button", { name: "Add assignment" }).boundingBox()
  expect(addAssignment).not.toBeNull()
  expect(addAssignment!.height).toBeGreaterThanOrEqual(44)
})

test("administrator sees seeded data-quality failures and their record links", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("a2g.local.userId", "u-admin-sec"))
  await page.goto("/admin")
  await expect(page.getByText("Pipeline status", { exact: true })).toBeVisible()
  await expect(page.getByText("failed", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("stale", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("Question dependency graph", { exact: true })).toBeVisible()
  const recordLink = page.getByRole("link", { name: "View record" }).first()
  await recordLink.click()
  await expect(page.locator("#quality-record-hcp_raw_insights-INT-000001")).toBeVisible()
})

test("administrator quality dashboard fits the required desktop and iPad viewport matrix", async ({ page }) => {
  const matrix = [
    [1280, 800], [1470, 956], [1512, 982], [1728, 1117], [1920, 1080], [2560, 1440],
    [820, 1180], [1180, 820], [834, 1194], [1194, 834], [1024, 1366], [1366, 1024], [1032, 1376], [1376, 1032],
  ] as const
  await page.addInitScript(() => window.localStorage.setItem("a2g.local.userId", "u-admin-sec"))
  for (const [width, height] of matrix) {
    await page.setViewportSize({ width, height })
    await page.goto("/admin")
    await expect(page.getByText("Pipeline status", { exact: true })).toBeVisible()
    await expect(page.getByText("Question dependency graph", { exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}x${height} should not overflow horizontally`).toBeTruthy()
    if (Math.min(width, height) >= 820 && Math.max(width, height) <= 1376) {
      const recordLink = await page.getByRole("link", { name: "View record" }).first().boundingBox()
      expect(recordLink, `${width}x${height} record link`).not.toBeNull()
      expect(recordLink!.height, `${width}x${height} record link`).toBeGreaterThanOrEqual(44)
    }
  }
})

test("a persona opening another persona's route gets a gate, not data", async ({ page }) => {
  await page.goto("/executive")
  await expect(page.getByTestId("role-gate")).toBeVisible()
  await expect(page.getByTestId("kpi-calls")).toHaveCount(0)
})

test("reduced motion shows final numbers immediately", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/msl")
  const card = page.getByTestId("kpi-calls-value")
  await expect(card).toBeVisible()
  const target = await card.getAttribute("data-value")
  await expect(card).toHaveText(Number(target).toLocaleString("en-US"))
})

test("design system page renders both chart libraries", async ({ page }) => {
  await page.goto("/design")
  await expect(page.getByRole("heading", { level: 1, name: "Design system" })).toBeVisible()
  await expect(page.getByTestId("echart")).toBeVisible()
  await expect(page.locator("[data-provenance]")).toHaveCount(3)
})

test("shared analytics filters, denominators, saved views and catalog dates work on iPad", async ({ page }) => {
  await page.goto("/msl")
  await expect(page.getByTestId("filter-bar")).toBeVisible()
  await page.locator("#filter-question").click()
  await page.getByRole("option", { name: /Question 1:/ }).click()
  await expect(page.getByTestId("distribution-Q-0001")).toBeVisible()
  await expect(page.getByTestId("distribution-Q-0002")).toHaveCount(0)
  await expect(page.getByTestId("distribution-Q-0001")).toContainText("Denominator:")
  await expect(page.getByTestId("question-Q-0001")).toContainText("Effective")
  await expect(page.getByTestId("question-Q-0001")).toContainText("Jan 1, 2025")
  await page.getByLabel("Saved view name").fill("Breast review")
  await page.getByRole("button", { name: "Save" }).click()
  await expect(page.getByRole("button", { name: /Breast review/ })).toBeVisible()
})

test("qualitative themes, possible topics, and scoped semantic search fit the iPad workspace", async ({ page }) => {
  await page.goto("/msl")
  await expect(page.getByRole("heading", { level: 2, name: "Qualitative insights" })).toBeVisible()
  await expect(page.getByTestId("theme-card").first()).toContainText("Derived")
  await expect(page.getByText("not a confirmed commitment or task").first()).toBeVisible()
  await page.getByLabel("Search insight responses").fill("evidence")
  const search = page.getByLabel("Search insights")
  const box = await search.boundingBox()
  expect(box!.height).toBeGreaterThanOrEqual(44)
  await search.click()
  await expect(page.getByTestId("semantic-search")).toContainText("RESP-")
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
})
