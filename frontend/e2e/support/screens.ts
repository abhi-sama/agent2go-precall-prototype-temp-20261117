import { expect, type Page } from "@playwright/test"

/**
 * Every screen (and meaningful screen state) merged to main, checked at every viewport in `viewports.ts` by
 * `responsive.spec.ts`. A later ticket adds its screens by appending entries here; nothing else changes.
 *
 * - `userId`: the seeded persona (fixtures.ts) the screen is opened as; omit for the default MSL.
 * - `path`: route, optionally with `?scenario=` for mock-adapter states.
 * - `ready`: wait until the screen has finished loading (data on screen, not skeletons).
 * - `prepare`: drive the screen into the state under test (open a drawer, run a search). Optional.
 */
export interface ScreenSpec {
  /** Unique, kebab-case: used in test titles and screenshot file names. */
  name: string
  path: string
  userId?: string
  ready: (page: Page) => Promise<void>
  prepare?: (page: Page) => Promise<void>
}

const heading = (name: string, level = 1) => (page: Page) =>
  expect(page.getByRole("heading", { level, name })).toBeVisible()
const testId = (id: string) => (page: Page) => expect(page.getByTestId(id).first()).toBeVisible()

const STATE_APPEARANCES = [
  { name: "warm-light", style: "warm", mode: "light" },
  { name: "warm-charcoal", style: "warm", mode: "charcoal" },
  { name: "warm-black", style: "warm", mode: "black" },
  { name: "clinical-light", style: "clinical", mode: "light" },
  { name: "clinical-charcoal", style: "clinical", mode: "charcoal" },
  { name: "clinical-black", style: "clinical", mode: "black" },
] as const

async function setStateAppearance(page: Page, appearance: (typeof STATE_APPEARANCES)[number]) {
  await page.evaluate(({ style, mode }) => {
    const root = document.documentElement
    root.dataset.style = style
    root.classList.toggle("dark", mode !== "light")
    if (mode === "black") root.dataset.mode = "black"
    else delete root.dataset.mode
  }, appearance)
}

/** Waits until the 3D globe's markers stop moving (the camera is placed a frame or two after mount, slower under load). */
async function globeSettled(page: Page) {
  const read = () => page.evaluate(() => [...document.querySelectorAll("[data-testid^=globe-marker-]")].map((el) => { const r = el.getBoundingClientRect(); return `${el.textContent}:${Math.round(r.left)},${Math.round(r.top)}` }).join("|"))
  let previous = ""
  await expect.poll(async () => { const now = await read(); const stable = now !== "" && now === previous; previous = now; return stable }, { intervals: [300], timeout: 15_000 }).toBe(true)
}

export const SCREENS: ScreenSpec[] = [
  { name: "login", path: "/login", ready: async (page) => { await expect(page.locator("main, form").first()).toBeVisible() } },
  {
    name: "msl-landing",
    path: "/msl",
    ready: async (page) => {
      await heading("My territory")(page)
      await testId("kpi-calls")(page)
      await expect(page.getByTestId("territory-map")).toBeVisible()
      await testId("semantic-search")(page)
    },
  },
  {
    name: "sidebar-navigation",
    path: "/msl",
    ready: async (page) => {
      await heading("My territory")(page)
    },
    prepare: async (page) => {
      const menu = page.getByTestId("sidebar-menu")
      if (await menu.isVisible()) {
        await menu.click()
        await expect(page.getByTestId("sidebar-sheet")).toBeVisible()
      }
    },
  },
  {
    name: "msl-landing-hcp-profile",
    path: "/msl",
    ready: testId("hcp-search-input"),
    prepare: async (page) => {
      await page.getByTestId("hcp-search-input").fill("call system")
      await page.getByTestId("hcp-search-submit").click()
      await page.getByTestId("hcp-result-HCP-0001").click()
      await expect(page.getByTestId("hcp-profile")).toBeVisible()
    },
  },
  {
    name: "msl-landing-hcp-deep-timeline",
    path: "/msl",
    ready: testId("hcp-search-input"),
    prepare: async (page) => {
      await page.getByTestId("hcp-search-input").fill("call system")
      await page.getByTestId("hcp-search-submit").click()
      await page.getByTestId("hcp-result-HCP-0001").click()
      const chain = page.getByTestId("response-insight-mock-deep-1")
      await expect(chain).toBeVisible()
      for (let index = 1; index <= 10; index += 1) {
        await page.getByTestId(`response-toggle-insight-mock-deep-${index}`).click()
      }
      await expect(page.getByTestId("response-insight-mock-deep-10")).toHaveAttribute("data-depth", "9")
    },
  },
  {
    name: "msl-landing-semantic-search",
    path: "/msl",
    ready: testId("semantic-search"),
    prepare: async (page) => {
      await page.getByLabel("Search insight responses").fill("evidence access")
      await page.getByRole("button", { name: "Search insights" }).click()
      await expect(page.getByTestId("semantic-search").locator("li").first()).toBeVisible()
    },
  },
  {
    name: "msl-landing-filters",
    path: "/msl",
    ready: testId("filter-bar"),
    prepare: async (page) => {
      await page.locator("#filter-question").selectOption("Q-0001")
      await expect(page.getByTestId("distribution-Q-0001")).toBeVisible()
    },
  },
  {
    name: "msl-post-call-workflow",
    path: "/msl/follow-up",
    ready: async (page) => {
      await heading("Optional post-call workflow", 2)(page)
      await testId("post-call-drafts")(page)
      await testId("confirmed-tasks")(page)
      await testId("topic-alerts")(page)
    },
  },
  {
    name: "msl-activity",
    path: "/msl/activity",
    ready: async (page) => {
      await heading("My activity")(page)
      for (const id of ["chart-calls", "chart-hcps", "chart-channels"]) await testId(id)(page)
    },
  },
  {
    name: "msl-activity-evidence",
    path: "/msl/activity",
    ready: testId("evidence-open-calls"),
    prepare: async (page) => {
      await page.getByTestId("evidence-open-calls").click()
      await expect(page.getByTestId("evidence-table")).toBeVisible()
    },
  },
  {
    name: "msl-activity-flag-form",
    path: "/msl/activity",
    ready: testId("flag-open"),
    prepare: async (page) => {
      await page.getByTestId("flag-open").click()
      await expect(page.getByTestId("flag-form")).toBeVisible()
    },
  },
  {
    name: "director-landing",
    path: "/director",
    userId: "u-dir-ne",
    ready: async (page) => {
      await heading("My region")(page)
      await testId("director-overview")(page)
      await testId("team-heatmap")(page)
      await testId("mix-ranked")(page)
    },
  },
  {
    name: "director-landing-targets",
    path: "/director?scenario=targets",
    userId: "u-dir-ne",
    ready: async (page) => { await testId("director-overview")(page); await testId("coverage-available")(page) },
  },
  {
    name: "director-insights",
    path: "/director/insights",
    userId: "u-dir-ne",
    ready: async (page) => {
      for (const id of ["summary-card", "topic-heatmap", "emerging-rule", "question-detail", "drill-table", "exceptions-table"]) await testId(id)(page)
      await expect(page.getByTestId("echart").first()).toBeVisible()
    },
  },
  {
    name: "director-insights-heatmap-table",
    path: "/director/insights",
    userId: "u-dir-ne",
    ready: testId("topic-heatmap"),
    prepare: async (page) => {
      await page.getByTestId("heatmap-view-table").click()
      await page.locator('[data-testid="heatmap-cell"][data-territory="NE-02"][data-topic="Access and reimbursement"]').click()
      await expect(page.getByTestId("cell-detail")).toBeVisible()
    },
  },
  {
    name: "director-insights-3d",
    path: "/director/insights",
    userId: "u-dir-ne",
    ready: testId("topic-heatmap"),
    prepare: async (page) => {
      await page.getByTestId("heatmap-view-3d").click()
      await expect(page.getByTestId("bar-field")).toHaveAttribute("data-intro", "done", { timeout: 20_000 })
      await expect(page.getByTestId("bar-field-col-label").first()).toBeVisible()
      await page.getByTestId("bar-field").scrollIntoViewIfNeeded()
    },
  },
  {
    name: "director-insights-3d-selected-black-warm",
    path: "/director/insights",
    userId: "u-dir-ne",
    ready: testId("topic-heatmap"),
    prepare: async (page) => {
      await page.evaluate(() => {
        const root = document.documentElement
        root.classList.add("dark")
        root.dataset.mode = "black"
        root.dataset.style = "warm"
      })
      await page.getByTestId("heatmap-view-3d").click()
      await expect(page.getByTestId("bar-field")).toHaveAttribute("data-intro", "done", { timeout: 20_000 })
      // Select the front-left bar by tapping where the local-build probe says its top is.
      const spot = await page.getByTestId("bar-field").evaluate((el) => (JSON.parse(el.getAttribute("data-bars") ?? "[]") as [number, number][])[13 * 6])
      await page.getByTestId("bar-field").click({ position: { x: spot[0], y: spot[1] + 8 } })
      await expect(page.getByTestId("cell-detail")).toBeVisible()
      await page.getByTestId("bar-field").scrollIntoViewIfNeeded()
    },
  },
  {
    name: "director-insights-ai-summary",
    path: "/director/insights",
    userId: "u-dir-ne",
    ready: testId("summary-card"),
    prepare: async (page) => {
      await page.getByTestId("generate-summary").first().click()
      await expect(page.getByTestId("summary-result").first().getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 30_000 })
    },
  },
  {
    name: "director-insights-citation",
    path: "/director/insights",
    userId: "u-dir-ne",
    ready: testId("theme-card"),
    prepare: async (page) => {
      await page.getByTestId("theme-card").first().getByTestId("evidence-chip").first().click()
      await expect(page.getByTestId("citation-sheet")).toBeVisible()
      await expect(page.getByTestId("citation-fields")).toBeVisible()
    },
  },
  {
    name: "director-insights-hcp-timeline",
    path: "/director/insights",
    userId: "u-dir-ne",
    ready: testId("drill-table"),
    prepare: async (page) => {
      await page.getByTestId("drill-row").first().getByTestId("drill-open").click()
      await page.locator('[data-testid="drill-row"][data-id="NE-01"]').getByTestId("drill-open").click()
      await page.locator('[data-testid="drill-row"][data-id="HCP-0001"]').getByTestId("drill-open").click()
      await expect(page.getByTestId("hcp-timeline")).toBeVisible()
    },
  },
  {
    name: "director-insights-empty",
    path: "/director/insights?scenario=empty",
    userId: "u-dir-ne",
    ready: async (page) => { await expect(page.getByTestId("section-heatmap")).toContainText("No free-text responses in this period") },
  },
  {
    name: "executive-landing",
    path: "/executive",
    userId: "u-exec-all",
    ready: async (page) => {
      await testId("kpi-calls")(page)
      await expect(page.getByTestId("territory-map")).toHaveAttribute("data-renderer", "globe")
      await expect(page.getByTestId("globe")).toBeVisible()
      await globeSettled(page)
    },
  },
  {
    name: "executive-overview",
    path: "/executive",
    userId: "u-exec-all",
    ready: async (page) => {
      await testId("executive-overview")(page)
      await testId("trend-columns")(page)
      await testId("ranked-regions")(page)
      await testId("depth")(page)
    },
  },
  {
    name: "executive-overview-records",
    path: "/executive?scenario=records",
    userId: "u-exec-all",
    ready: async (page) => { await testId("executive-overview")(page); await testId("drill-open")(page) },
  },
  {
    name: "executive-drilldown",
    path: "/executive?scenario=records",
    userId: "u-exec-all",
    ready: testId("drill-open"),
    prepare: async (page) => {
      await page.getByTestId("ranked-regions").getByTestId("drill-open").first().click()
      await expect(page.getByTestId("drill-row").first()).toBeVisible()
    },
  },
  {
    name: "executive-country-map",
    path: "/executive",
    userId: "u-exec-all",
    ready: testId("country-option-BR"),
    prepare: async (page) => {
      await page.getByTestId("country-option-BR").click()
      await expect(page.getByTestId("territory-map")).toHaveAttribute("data-view", "country", { timeout: 15_000 })
      await expect(page.getByTestId("flat-map-canvas")).toBeVisible()
    },
  },
  {
    name: "admin",
    path: "/admin",
    userId: "u-admin-sec",
    ready: async (page) => {
      await heading("Administration")(page)
      await expect(page.getByRole("heading", { level: 2, name: "Role permission matrix" })).toBeVisible()
      await testId("access-audit-filters")(page)
    },
  },
  { name: "admin-governance", path: "/admin/governance", userId: "u-admin-sec", ready: heading("Data governance workspace") },
  ...["Access timeline", "Catalog and responses"].map((tab): ScreenSpec => ({
    name: `admin-governance-${tab.toLowerCase().replace(/\s+/g, "-")}`,
    path: "/admin/governance",
    userId: "u-admin-sec",
    ready: heading("Data governance workspace"),
    prepare: async (page) => {
      await page.getByRole("tab", { name: tab }).click()
      await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true")
    },
  })),
  { name: "chat", path: "/chat", ready: async (page) => { await heading("Ask the agent")(page); await testId("chat-input")(page) } },
  {
    name: "chat-answer",
    path: "/chat",
    ready: testId("chat-input"),
    prepare: async (page) => {
      await page.getByTestId("chat-input").fill("How many calls did I have in the last 90 days?")
      await page.getByTestId("chat-send").click()
      await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 20_000 })
    },
  },
  {
    name: "chat-citation",
    path: "/chat",
    ready: testId("chat-input"),
    prepare: async (page) => {
      await page.getByTestId("chat-input").fill("How many calls did I have in the last 90 days?")
      await page.getByTestId("chat-send").click()
      await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 20_000 })
      await page.getByTestId("citation").first().click()
      await expect(page.getByTestId("citation-sheet")).toBeVisible()
    },
  },
  {
    name: "chat-rows",
    path: "/chat",
    ready: testId("chat-input"),
    prepare: async (page) => {
      await page.getByTestId("chat-input").fill("How many calls did I have in the last 90 days?")
      await page.getByTestId("chat-send").click()
      await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 20_000 })
      await page.getByTestId("citation").first().click()
      await page.getByTestId("show-rows").click()
      await expect(page.getByTestId("chat-rows")).toBeVisible()
    },
  },
  ...([
    ["line", "Show my calls by month", "line-chart"],
    ["bars", "Compare my calls by product", "ranked-bars"],
    ["heatmap", "Heatmap of calls by product", "heatmap-chart"],
    ["timeline", "Show my weekly calls timeline", "timeline-chart"],
    ["distribution", "How did HCPs rate it, show the scores", "distribution-chart"],
    ["table", "Give me a table of calls", "visual-table"],
  ] as const).map(([name, question, chart]): ScreenSpec => ({
    name: `chat-visual-${name}`,
    path: "/chat",
    ready: testId("chat-input"),
    prepare: async (page) => {
      await page.getByTestId("chat-input").fill(question)
      await page.getByTestId("chat-send").click()
      await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 20_000 })
      await expect(page.getByTestId(chart).first()).toBeVisible()
    },
  })),
  {
    name: "chat-visual-expanded",
    path: "/chat",
    ready: testId("chat-input"),
    prepare: async (page) => {
      await page.getByTestId("chat-input").fill("Heatmap of calls by product")
      await page.getByTestId("chat-send").click()
      await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 20_000 })
      await page.getByTestId("visual-expand").click()
      await expect(page.getByTestId("visual-sheet")).toBeVisible()
    },
  },
  { name: "design-system", path: "/design", ready: async (page) => { await heading("Design system")(page); await testId("echart")(page) } },
  // The other appearances (docs/design/direction.md): the same screens in true black and in the other style.
  {
    name: "director-landing-black-warm",
    path: "/director",
    userId: "u-dir-ne",
    ready: testId("director-overview"),
    prepare: async (page) => {
      await page.evaluate(() => {
        const root = document.documentElement
        root.classList.add("dark")
        root.dataset.mode = "black"
        root.dataset.style = "warm"
      })
    },
  },
  {
    name: "msl-landing-charcoal-clinical",
    path: "/msl",
    ready: testId("kpi-calls"),
    prepare: async (page) => {
      await page.evaluate(() => {
        const root = document.documentElement
        root.classList.add("dark")
        root.dataset.style = "clinical"
      })
    },
  },
  // AI-content look (ticket D3): facts, AI summaries and suggestions in the appearances where the washes are hardest to tell apart.
  {
    name: "chat-answer-black-clinical",
    path: "/chat",
    ready: testId("chat-input"),
    prepare: async (page) => {
      await page.evaluate(() => {
        const root = document.documentElement
        root.classList.add("dark")
        root.dataset.mode = "black"
        root.dataset.style = "clinical"
      })
      await page.getByTestId("chat-input").fill("How many calls did I have in the last 90 days?")
      await page.getByTestId("chat-send").click()
      await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 20_000 })
      await expect(page.locator('[data-provenance="ai"]').getByTestId("citation").first()).toBeVisible()
    },
  },
  {
    name: "director-insights-themes-charcoal-warm",
    path: "/director/insights",
    userId: "u-dir-ne",
    ready: testId("theme-card"),
    prepare: async (page) => {
      await page.evaluate(() => {
        const root = document.documentElement
        root.classList.add("dark")
        root.dataset.style = "warm"
      })
    },
  },
  {
    name: "precall-brief-black-clinical",
    path: "/msl/briefs?brief=br-20261103090000-aaaaaaaa",
    ready: testId("brief"),
    prepare: async (page) => {
      await page.evaluate(() => {
        const root = document.documentElement
        root.classList.add("dark")
        root.dataset.mode = "black"
        root.dataset.style = "clinical"
      })
    },
  },
  {
    name: "precall-brief-new",
    path: "/msl/briefs",
    ready: testId("my-briefs"),
  },
  {
    name: "precall-brief-saved-stale",
    path: "/msl/briefs?brief=br-20261103090000-aaaaaaaa&scenario=stale",
    ready: async (page) => {
      await testId("brief")(page)
      await testId("brief-stale")(page)
    },
  },
  {
    name: "precall-brief-editing",
    path: "/msl/briefs?brief=br-20261103090000-aaaaaaaa",
    ready: testId("brief"),
    prepare: async (page) => {
      await page.getByRole("button", { name: "Edit prompt 1" }).click()
      await page.getByLabel("Prompt text").fill("A reworded discussion question?")
      await expect(page.getByTestId("brief-save-bar")).toBeVisible()
    },
  },
  {
    name: "precall-brief-denied",
    path: "/msl/briefs?brief=br-20261102090000-bbbbbbbb",
    ready: testId("brief-denied"),
  },
  // Error and empty states share the shell; one MSL state each keeps the matrix quick.
  { name: "msl-landing-empty", path: "/msl?scenario=empty", ready: testId("state-empty") },
  { name: "msl-landing-error", path: "/msl?scenario=error", ready: testId("state-error") },
  { name: "role-gate", path: "/executive", ready: testId("role-gate") },
  ...STATE_APPEARANCES.map((appearance): ScreenSpec => ({
    name: `state-family-${appearance.name}`,
    path: "/design",
    ready: testId("state-family-preview"),
    prepare: (page) => setStateAppearance(page, appearance),
  })),
]
