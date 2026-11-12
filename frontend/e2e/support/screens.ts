import { expect, type Page } from "@playwright/test"
import { cacheFor, lookName, type Look } from "./appearance"

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
/** A toast is a transient overlay (a confirmation, not part of the screen), so measure once it has gone. */
const toastsGone = (page: Page) => expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 12_000 })
const testId = (id: string) => (page: Page) => expect(page.getByTestId(id).first()).toBeVisible()
/** Wide workspaces reserve a supporting pane; smaller screens use the overlay with identical chat content. */
const chatSurface = (page: Page) => page.getByTestId(page.viewportSize()!.width >= 1366 ? "chat-dock" : "chat-drawer")

/** The state family is checked in the default theme both ways and in the dark-only theme. */
const STATE_LOOKS: Look[] = [
  { theme: "neutral", scheme: "light" },
  { theme: "neutral", scheme: "dark" },
  { theme: "gothic", scheme: "dark" },
]

/**
 * Switch the look in place (no reload, so a prepared screen state survives): the same attributes the boot script and
 * the root Theme write, on <html> and on the root Theme wrapper.
 */
async function applyLook(page: Page, look: Look) {
  await page.evaluate(({ theme, scheme }) => {
    const root = document.documentElement
    root.setAttribute("data-astryx-theme", theme)
    root.setAttribute("data-color-scheme", scheme)
    root.classList.toggle("dark", scheme === "dark")
    const wrapper = document.querySelector<HTMLElement>("body [data-astryx-theme]")
    wrapper?.setAttribute("data-astryx-theme", theme)
    // The wrapper's own colour scheme comes from the Theme's mode; pin it the way a saved choice would.
    if (wrapper) wrapper.style.colorScheme = scheme
  }, look)
}

/** Save the look for the current person and reload, so it applies exactly as a returning visit would. */
async function setStateAppearance(page: Page, look: Look) {
  const userId = await page.evaluate(() => window.localStorage.getItem("a2g.local.userId") ?? "u-msl-ne-01")
  await page.evaluate((cache) => window.localStorage.setItem("a2g.appearance", cache), cacheFor(userId, look))
  await page.reload()
  await expect(page.getByTestId("state-family-preview")).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-astryx-theme"))).toBe(look.theme)
}

/** Waits until the 3D globe's markers stop moving (the camera is placed a frame or two after mount, slower under load). */
async function globeSettled(page: Page) {
  const read = () => page.evaluate(() => [...document.querySelectorAll("[data-testid^=globe-marker-]")].map((el) => { const r = el.getBoundingClientRect(); return `${el.textContent}:${Math.round(r.left)},${Math.round(r.top)}` }).join("|"))
  let previous = ""
  await expect.poll(async () => { const now = await read(); const stable = now !== "" && now === previous; previous = now; return stable }, { intervals: [300], timeout: 30_000 }).toBe(true)
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
        await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible()
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
    name: "director-insights-3d-selected-gothic-dark",
    path: "/director/insights",
    userId: "u-dir-ne",
    ready: testId("topic-heatmap"),
    prepare: async (page) => {
      await applyLook(page, { theme: "gothic", scheme: "dark" })
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
    name: "executive-themes",
    path: "/executive/themes",
    userId: "u-exec-all",
    ready: async (page) => {
      await testId("theme-card")(page)
      await testId("topic-matrix")(page)
      await expect(page.getByTestId("saved-summaries")).toBeVisible()
      await expect(page.getByTestId("themes-loading")).toHaveCount(0)
      await expect(page.getByTestId("matrix-loading")).toHaveCount(0)
    },
  },
  {
    name: "executive-themes-molecule",
    path: "/executive/themes",
    userId: "u-exec-all",
    ready: testId("theme-card"),
    prepare: async (page) => {
      await page.getByTestId("facet-MOLECULE").click()
      await expect(page.getByTestId("theme-group")).toHaveCount(4)
      await expect(page.getByTestId("topic-matrix")).toHaveAttribute("data-facet", "MOLECULE")
    },
  },
  {
    name: "executive-themes-records",
    path: "/executive/themes?scenario=records",
    userId: "u-exec-all",
    ready: async (page) => { await testId("theme-card")(page); await testId("source-record")(page) },
  },
  {
    name: "executive-themes-summary",
    path: "/executive/themes",
    userId: "u-exec-all",
    ready: testId("generate-leadership-summary"),
    prepare: async (page) => {
      await page.getByTestId("generate-leadership-summary").click()
      await expect(page.getByTestId("leadership-summary")).toBeVisible({ timeout: 15_000 })
      await toastsGone(page)
    },
  },
  {
    name: "executive-themes-export",
    path: "/executive/themes",
    userId: "u-exec-all",
    ready: testId("generate-leadership-summary"),
    prepare: async (page) => {
      await page.getByTestId("generate-leadership-summary").click()
      await page.getByTestId("export-summary").click({ timeout: 15_000 })
      await expect(page.getByTestId("leadership-export-preview")).toBeVisible({ timeout: 15_000 })
      await toastsGone(page)
    },
  },
  {
    name: "executive-themes-analysis",
    path: "/executive/themes",
    userId: "u-exec-all",
    ready: testId("org-suggestion"),
    prepare: async (page) => {
      await page.getByTestId("org-suggestion").first().click()
      await expect(page.getByTestId("assistant-turn").first()).toHaveAttribute("data-status", "done", { timeout: 20_000 })
      await expect(page.getByTestId("sample-limitations").last()).toBeVisible()
    },
  },
  {
    name: "executive-themes-scope-changed",
    path: "/executive/themes?scenario=scope-changed",
    userId: "u-exec-all",
    ready: testId("saved-summary"),
    prepare: async (page) => {
      await page.getByTestId("open-summary").first().click()
      await expect(page.getByTestId("access-changed")).toBeVisible()
      await toastsGone(page)
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
  {
    name: "admin-ingestion-runs",
    path: "/admin/ingestion",
    userId: "u-admin-sec",
    ready: async (page) => {
      await heading("Ingestion runs")(page)
      await testId("admin-ingestion-runs")(page)
    },
  },
  { name: "admin-governance", path: "/admin/governance", userId: "u-admin-sec", ready: heading("Data governance workspace") },
  ...["Access timeline", "Catalog and responses", "Authorization checks"].map((tab): ScreenSpec => ({
    name: `admin-governance-${tab.toLowerCase().replace(/\s+/g, "-")}`,
    path: "/admin/governance",
    userId: "u-admin-sec",
    ready: heading("Data governance workspace"),
    prepare: async (page) => {
      await page.getByRole("tab", { name: tab }).click()
      await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true")
      if (tab === "Authorization checks") await testId("authorization-verification-grid")(page)
    },
  })),
  {
    name: "admin-evals",
    path: "/admin/evals",
    userId: "u-admin-sec",
    ready: async (page) => {
      await heading("AI evaluation")(page)
      await testId("run-scores")(page)
      await testId("category-strip")(page)
      await testId("results")(page)
    },
  },
  {
    // The oldest MSL run failed: failing questions and the failing conversation start open, and a passing one is opened by hand.
    name: "admin-evals-failures",
    path: "/admin/evals",
    userId: "u-admin-sec",
    ready: heading("AI evaluation"),
    prepare: async (page) => {
      await page.getByRole("tab", { name: "History" }).click()
      await page.getByTestId("open-ev-20261103101500-b2c3d4e5").click()
      await expect(page.getByTestId("result-detail-msl-theme-sequenc")).toBeVisible()
      await expect(page.getByTestId("chain-msl-question")).toHaveAttribute("data-open", "true")
      await page.getByTestId("chain-msl-deep").getByRole("button").first().click()
      await expect(page.getByTestId("chain-turns-msl-deep")).toBeVisible()
    },
  },
  ...(
    [
      ["History", "run-history"],
      ["Compare runs", "diff-view"],
      ["Human ratings", "ratings-panel"],
    ] as const
  ).map(
    ([tab, id]): ScreenSpec => ({
      name: `admin-evals-${tab.toLowerCase().replace(/\s+/g, "-")}`,
      path: "/admin/evals",
      userId: "u-admin-sec",
      ready: heading("AI evaluation"),
      prepare: async (page) => {
        await page.getByRole("tab", { name: tab }).click()
        await expect(page.getByTestId(id)).toBeVisible()
      },
    }),
  ),
  {
    name: "admin-evals-leak-failure",
    path: "/admin/evals",
    userId: "u-admin-sec",
    ready: heading("AI evaluation"),
    prepare: async (page) => {
      await page.getByTestId("run-self-test").click()
      await expect(page.getByTestId("run-failure-reasons")).toContainText("Out-of-scope data was retrieved", { timeout: 30_000 })
      // A failing question starts open.
      await expect(page.getByTestId("result-detail-leak-emails")).toBeVisible()
    },
  },
  { name: "chat", path: "/chat", ready: async (page) => { await heading("Ask the agent")(page); await testId("chat-input")(page) } },
  {
    name: "chat-executive-activity",
    path: "/chat",
    userId: "u-exec-all",
    ready: testId("chat-input"),
    prepare: async (page) => {
      await page.getByTestId("chat-input").fill("Show calls by month")
      await page.getByTestId("chat-send").click()
      await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 15_000 })
      await expect(page.getByTestId("visual")).toHaveAttribute("data-kind", "line")
      await expect(page.getByTestId("sample-limitations")).toBeVisible()
    },
  },
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
    name: "chat-answer-feedback",
    path: "/chat",
    ready: testId("chat-input"),
    prepare: async (page) => {
      await page.getByTestId("chat-input").fill("How many calls did I have in the last 90 days?")
      await page.getByTestId("chat-send").click()
      await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 20_000 })
      await page.getByTestId("rate-down").click()
      await expect(page.getByTestId("rating-saved")).toBeVisible()
      await expect(page.getByTestId("rating-note-input")).toBeVisible()
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
  {
    name: "chat-answer-rows",
    path: "/chat",
    ready: testId("chat-input"),
    prepare: async (page) => {
      await page.getByTestId("chat-input").fill("How many calls did I have in the last 90 days?")
      await page.getByTestId("chat-send").click()
      await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 20_000 })
      // Collapsed by default; one tap opens the exact rows behind the count.
      await expect(page.getByTestId("answer-rows-toggle")).toHaveAttribute("aria-expanded", "false")
      await page.getByTestId("answer-rows-toggle").click()
      await expect(page.getByTestId("answer-rows-table")).toBeVisible()
    },
  },
  {
    name: "chat-answer-rows-sorted",
    path: "/chat",
    userId: "u-dir-ne",
    ready: testId("chat-input"),
    prepare: async (page) => {
      await page.getByTestId("chat-input").fill("How many calls did I have in the last 90 days?")
      await page.getByTestId("chat-send").click()
      await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 20_000 })
      await page.getByTestId("answer-rows-toggle").click()
      await expect(page.getByTestId("answer-rows-table")).toBeVisible()
      // Another set, sorted by a numeric column, on the second page.
      await page.getByTestId("row-set-option").nth(1).click()
      await page.getByTestId("answer-rows-sort").and(page.locator('[data-column="calls"]')).click()
      await expect(page.getByTestId("answer-rows-table")).toHaveAttribute("data-sort-by", "calls")
      await page.getByTestId("answer-rows-next").click()
      await expect(page.getByTestId("answer-rows-range")).toContainText("26–50")
    },
  },
  {
    name: "chat-answer-rows-no-export",
    path: "/chat?scenario=no-export",
    ready: testId("chat-input"),
    prepare: async (page) => {
      await page.getByTestId("chat-input").fill("How many calls did I have in the last 90 days?")
      await page.getByTestId("chat-send").click()
      await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 20_000 })
      await page.getByTestId("answer-rows-toggle").click()
      await expect(page.getByTestId("answer-rows-export-denied")).toBeVisible()
    },
  },
  {
    name: "chat-answer-aggregate-only",
    path: "/chat",
    userId: "u-exec-all",
    ready: testId("chat-input"),
    prepare: async (page) => {
      await page.getByTestId("chat-input").fill("Which topics are rising across regions?")
      await page.getByTestId("chat-send").click()
      await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 20_000 })
      await expect(page.getByTestId("aggregate-only-note")).toBeVisible()
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
  // Ask the agent adapts from overlay to a reflowing supporting pane at the wide workspace threshold.
  {
    name: "chat-drawer-open",
    path: "/msl",
    ready: testId("kpi-calls"),
    prepare: async (page) => {
      await page.getByTestId("chat-open").click()
      await expect(chatSurface(page)).toBeVisible()
      await expect(page.getByTestId("chat-empty")).toBeVisible()
    },
  },
  {
    name: "chat-drawer-director-context",
    path: "/director/insights",
    userId: "u-dir-ne",
    ready: testId("topic-heatmap"),
    prepare: async (page) => {
      await page.getByTestId("chat-open").click()
      await expect(chatSurface(page)).toBeVisible()
      await expect(page.locator('[data-testid="chat-chip"][data-kind="range"]')).toBeVisible()
    },
  },
  {
    name: "chat-drawer-answer",
    path: "/msl",
    ready: testId("kpi-calls"),
    prepare: async (page) => {
      await page.getByTestId("chat-open").click()
      await page.getByTestId("chat-input").fill("How many calls did I have in the last 90 days?")
      await page.getByTestId("chat-send").click()
      await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 20_000 })
    },
  },
  ...([
    ["line", "Show my calls by month", "line-chart"],
    ["heatmap", "Heatmap of calls by product", "heatmap-chart"],
    ["table", "Give me a table of calls", "visual-table"],
  ] as const).map(([name, question, chart]): ScreenSpec => ({
    name: `chat-drawer-visual-${name}`,
    path: "/msl",
    ready: testId("kpi-calls"),
    prepare: async (page) => {
      await page.getByTestId("chat-open").click()
      await page.getByTestId("chat-input").fill(question)
      await page.getByTestId("chat-send").click()
      await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 20_000 })
      await expect(page.getByTestId(chart).first()).toBeVisible()
    },
  })),
  {
    name: "chat-drawer-citation",
    path: "/msl",
    ready: testId("kpi-calls"),
    prepare: async (page) => {
      await page.getByTestId("chat-open").click()
      await page.getByTestId("chat-input").fill("How many calls did I have in the last 90 days?")
      await page.getByTestId("chat-send").click()
      await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 20_000 })
      // Scoped to the panel: /msl has AI-content cards of its own with citations underneath it.
      await chatSurface(page).getByTestId("citation").first().click()
      await expect(page.getByTestId("citation-sheet")).toBeVisible()
    },
  },
  { name: "design-system", path: "/design", ready: async (page) => { await heading("Design system")(page); await testId("echart")(page) } },
  // Other Astryx looks: the same screens in further themes and the dark scheme.
  {
    name: "director-landing-gothic-dark",
    path: "/director",
    userId: "u-dir-ne",
    ready: testId("director-overview"),
    prepare: async (page) => {
      await applyLook(page, { theme: "gothic", scheme: "dark" })
    },
  },
  {
    name: "msl-landing-stone-dark",
    path: "/msl",
    ready: testId("kpi-calls"),
    prepare: async (page) => {
      await applyLook(page, { theme: "stone", scheme: "dark" })
    },
  },
  // AI-content look (ticket D3): facts, AI summaries and suggestions in the appearances where the washes are hardest to tell apart.
  {
    name: "chat-answer-neutral-dark",
    path: "/chat",
    ready: testId("chat-input"),
    prepare: async (page) => {
      await applyLook(page, { theme: "neutral", scheme: "dark" })
      await page.getByTestId("chat-input").fill("How many calls did I have in the last 90 days?")
      await page.getByTestId("chat-send").click()
      await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 20_000 })
      await expect(page.locator('[data-provenance="ai"]').getByTestId("citation").first()).toBeVisible()
    },
  },
  {
    name: "director-insights-themes-chocolate-dark",
    path: "/director/insights",
    userId: "u-dir-ne",
    ready: testId("theme-card"),
    prepare: async (page) => {
      await applyLook(page, { theme: "chocolate", scheme: "dark" })
    },
  },
  {
    name: "precall-brief-neutral-dark",
    path: "/msl/briefs?brief=br-20261103090000-aaaaaaaa",
    ready: testId("brief"),
    prepare: async (page) => {
      await applyLook(page, { theme: "neutral", scheme: "dark" })
    },
  },
  {
    name: "chat-drawer-neutral-dark",
    path: "/msl",
    ready: testId("kpi-calls"),
    prepare: async (page) => {
      await applyLook(page, { theme: "neutral", scheme: "dark" })
      await page.getByTestId("chat-open").click()
      await page.getByTestId("chat-input").fill("Compare my calls by product")
      await page.getByTestId("chat-send").click()
      await expect(page.getByTestId("assistant-turn")).toHaveAttribute("data-status", "done", { timeout: 20_000 })
    },
  },
  {
    name: "chat-drawer-chocolate-dark",
    path: "/director",
    userId: "u-dir-ne",
    ready: testId("director-overview"),
    prepare: async (page) => {
      await applyLook(page, { theme: "chocolate", scheme: "dark" })
      await page.getByTestId("chat-open").click()
      await expect(chatSurface(page)).toBeVisible()
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
    name: "precall-brief-offline-shell",
    path: "/msl/briefs?brief=br-20261103090000-aaaaaaaa",
    ready: async (page) => {
      await testId("brief")(page)
      await expect(page.getByTestId("brief-objective")).toBeVisible()
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
  ...STATE_LOOKS.map((look): ScreenSpec => ({
    name: `state-family-${lookName(look)}`,
    path: "/design",
    ready: testId("state-family-preview"),
    prepare: (page) => setStateAppearance(page, look),
  })),
]
