import { describe, expect, it } from "vitest"
import { createGraphQLAdapter, type GraphQLTransport } from "./graphql-adapter"
import { EMERGING_TOPICS_QUERY, TOPIC_HEATMAP_QUERY } from "./director-insights"
import { createMockAdapter, type MockScenario } from "./mock-adapter"
import { emergingStatus } from "./insight-rules"
import { mockHcpTerritory, mockResponseRecord, THEMES } from "./mock-director-insights"
import { START_CHAT_RUN_MUTATION } from "./operations"

const ctx = { correlationId: "test" }
const NOW = () => new Date("2026-11-03T12:00:00Z")
const make = (userId: string, scenario: MockScenario = "ok") => createMockAdapter({ getUserId: () => userId, getScenario: () => scenario, latencyMs: 0, now: NOW })
const range = { from: "2026-08-05", to: "2026-11-03" }
const DIRECTOR = "u-dir-ne"

describe("mock Director insights: access", () => {
  it.each(["u-msl-ne-01", "u-exec-all"])("refuses %s on every field", async (user) => {
    const a = make(user)
    for (const call of [() => a.topicHeatmap(ctx), () => a.emergingTopics(ctx), () => a.questionAnalytics(ctx), () => a.directorDrilldown(ctx), () => a.directorExceptions(ctx), () => a.territorySummaryEvidence(ctx)]) {
      await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" })
    }
  })
  it("an administrator with no territory has no scope, not an empty result", async () => {
    await expect(make("u-admin-sec").topicHeatmap(ctx)).rejects.toMatchObject({ code: "NO_SCOPE" })
  })
  it("rejects a window longer than a year", async () => {
    await expect(make(DIRECTOR).emergingTopics(ctx, { range: { from: "2025-01-01", to: "2026-11-03" } })).rejects.toMatchObject({ code: "BAD_REQUEST" })
  })
  it("the forbidden scenario and the empty scenario behave", async () => {
    await expect(make(DIRECTOR, "forbidden").topicHeatmap(ctx)).rejects.toMatchObject({ code: "FORBIDDEN" })
    const empty = await make(DIRECTOR, "empty").topicHeatmap(ctx, { range })
    expect(empty.cells).toEqual([])
    expect(empty.themeCards).toEqual([])
  })
})

describe("mock Director insights: heatmap and theme cards", () => {
  it("has 14 derived themes, one column per territory, and cells that add up to each territory's denominator", async () => {
    const h = await make(DIRECTOR).topicHeatmap(ctx, { range })
    expect(THEMES).toHaveLength(14)
    expect(h.territories).toHaveLength(6)
    expect(h.topics.map((t) => t.topic)).toContain("ctDNA monitoring (emerging)")
    for (const t of h.territories) {
      const cells = h.cells.filter((c) => c.territoryId === t.territoryId)
      expect(cells.reduce((n, c) => n + c.responses, 0)).toBe(t.freeTextResponses)
      expect(cells.every((c) => c.territoryResponses === t.freeTextResponses)).toBe(true)
    }
    expect(h.freeTextResponses).toBe(h.territories.reduce((n, t) => n + t.freeTextResponses, 0))
    expect(h.topics[h.topics.length - 1].topic).toBe("Other perspectives")
  })
  it("every card cites responses, and groups by a facet when asked", async () => {
    const none = await make(DIRECTOR).topicHeatmap(ctx, { range })
    expect(none.facet).toBe("NONE")
    expect(none.themeCards.every((c) => c.facetValue === null && c.evidence.length > 0 && /^RESP-\d{6}$/.test(c.evidence[0].recordId))).toBe(true)
    const byMolecule = await make(DIRECTOR).topicHeatmap(ctx, { range, facet: "MOLECULE" })
    expect(byMolecule.facetLabel).toBe("Molecule")
    expect(new Set(byMolecule.themeCards.map((c) => c.facetValue)).size).toBe(4)
    expect(byMolecule.themeCards.every((c) => c.share <= 100)).toBe(true)
  })
  it("an evidence id opens again as the same response, only inside the viewer's scope", async () => {
    const h = await make(DIRECTOR).topicHeatmap(ctx, { range })
    const id = h.themeCards[0].evidence[0].recordId
    expect(mockResponseRecord(id, range)).toMatchObject({ recordId: id, excerpt: h.themeCards[0].evidence[0].excerpt })
    expect(mockResponseRecord("RESP-000001", range)).toBeNull()
    await expect(make(DIRECTOR).chatCitation(ctx, "hcp_raw_insights", id)).resolves.toMatchObject({ recordId: id, title: "Recorded HCP response" })
    await expect(make("u-msl-se-03").chatCitation(ctx, "hcp_raw_insights", id)).rejects.toMatchObject({ code: "NOT_FOUND" })
  })
})

describe("mock Director insights: emerging topics", () => {
  it("returns the explicit threshold and flags the planted topics, with statuses that follow the rule", async () => {
    const e = await make(DIRECTOR).emergingTopics(ctx, { range })
    expect(e.thresholds).toMatchObject({ minWindowResponses: 30, minTopicResponses: 10, minRelativeIncrease: 0.5, minSharePoints: 2 })
    expect(e.thresholds.rule).toContain("EMERGING")
    expect(e.sampleSufficient).toBe(true)
    expect(e.topics.filter((t) => t.status === "EMERGING").map((t) => t.topic)).toEqual(expect.arrayContaining(["ctDNA monitoring (emerging)", "Pulmonary surveillance (emerging)"]))
    for (const t of e.topics) expect(t.status).toBe(emergingStatus(t.currentResponses, t.priorResponses, t.currentTotal, t.priorTotal))
    expect(e.topics[0].status).toBe("EMERGING")
    expect(e.topics.filter((t) => t.status === "EMERGING").every((t) => t.evidence.length > 0)).toBe(true)
  })
  it("compares two periods of equal length, with weekly counts that add up", async () => {
    const e = await make(DIRECTOR).emergingTopics(ctx, { range })
    expect(e.prior.to).toBe("2026-08-04")
    const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000 + 1
    expect(days(e.prior.from, e.prior.to)).toBe(days(e.current.from, e.current.to))
    const t = e.topics[0]
    expect(t.weeks.reduce((n, w) => n + w.responses, 0)).toBe(t.currentResponses + t.priorResponses)
  })
  it("says nothing about a thin sample", async () => {
    const e = await make(DIRECTOR).emergingTopics(ctx, { range: { from: "2026-11-03", to: "2026-11-03" } })
    expect(e.sampleSufficient).toBe(false)
    expect(e.topics.every((t) => t.status === "INSUFFICIENT_SAMPLE")).toBe(true)
  })
})

describe("mock Director insights: question analytics", () => {
  it("defaults to the best-answered question and keeps counts to that question", async () => {
    const q = await make(DIRECTOR).questionAnalytics(ctx, { range })
    expect(q.selected?.questionId).toBe(q.options[0].questionId)
    const s = q.selected!
    expect(s.denominator).toBe(s.responses)
    expect(s.bars.reduce((n, b) => n + b.responses, 0)).toBe(s.responses)
    expect(s.territories.reduce((n, t) => n + t.responses, 0)).toBe(s.responses)
  })
  it("select-all bars may exceed the denominator and say so", async () => {
    const q = await make(DIRECTOR).questionAnalytics(ctx, { range, questionId: "Q-0127" })
    expect(q.selected!.bars.reduce((n, b) => n + b.responses, 0)).toBeGreaterThan(q.selected!.denominator)
    expect(q.selected!.barNote).toContain("Select-all")
  })
  it("reads a follow-up in its parent's context, and flags a parent that is not in the catalog", async () => {
    const follow = (await make(DIRECTOR).questionAnalytics(ctx, { range, questionId: "Q-0333" })).selected!
    expect(follow.parent).toMatchObject({ questionId: "Q-0013", inCatalog: true })
    expect(follow.parent!.answerBreakdown.length).toBeGreaterThan(0)
    const orphan = (await make(DIRECTOR).questionAnalytics(ctx, { range, questionId: "Q-0100" })).selected!
    expect(orphan.parent).toMatchObject({ questionId: "Q-NOT-IN-CATALOG", inCatalog: false, answerBreakdown: [] })
    const parent = (await make(DIRECTOR).questionAnalytics(ctx, { range, questionId: "Q-0013" })).selected!
    expect(parent.followUps.map((f) => f.questionId)).toEqual(["Q-0333"])
  })
  it("a question with no responses in scope has no detail, with no hint why", async () => {
    expect((await make(DIRECTOR).questionAnalytics(ctx, { range, questionId: "Q-9999" })).selected).toBeNull()
  })
})

describe("mock Director insights: drill-down", () => {
  it("walks region -> territory -> permitted HCPs", async () => {
    const a = make(DIRECTOR)
    const root = await a.directorDrilldown(ctx, { range })
    expect(root.children.map((c) => c.id)).toEqual(["NE"])
    const region = await a.directorDrilldown(ctx, { level: "REGION", id: "NE", range })
    expect(region.children).toHaveLength(6)
    expect(region.breadcrumb.map((b) => b.level)).toEqual(["ROOT", "REGION"])
    const territory = await a.directorDrilldown(ctx, { level: "TERRITORY", id: "NE-01", range })
    expect(territory.children.every((c) => c.level === "HCP")).toBe(true)
    expect(territory.children[0].id).toBe("HCP-0001")
    expect(territory.truncated).toBe(territory.totalChildren > territory.children.length)
    expect(territory.breadcrumb.map((b) => b.level)).toEqual(["ROOT", "REGION", "TERRITORY"])
  })
  it("a region or territory outside scope answers exactly like one that does not exist", async () => {
    const a = make(DIRECTOR)
    const errors = await Promise.all(
      [{ level: "REGION" as const, id: "SE" }, { level: "REGION" as const, id: "NOPE" }, { level: "TERRITORY" as const, id: "SE-01" }, { level: "TERRITORY" as const, id: "XX-99" }].map((q) => a.directorDrilldown(ctx, { ...q, range }).catch((e) => e)),
    )
    for (const e of errors) expect(e).toMatchObject({ code: "FORBIDDEN", message: errors[0].message })
  })
  it("opens an HCP timeline only for HCPs in the director's own territories", async () => {
    const a = make(DIRECTOR)
    expect(mockHcpTerritory("HCP-0041")).toBe("NE-02")
    await expect(a.hcpTimeline(ctx, "HCP-0041")).resolves.toMatchObject({ hcpId: "HCP-0041" })
    await expect(a.hcpTimeline(ctx, `HCP-${String(6 * 40 + 1).padStart(4, "0")}`)).rejects.toMatchObject({ code: "FORBIDDEN" })
    await expect(make("u-msl-se-03").hcpTimeline(ctx, "HCP-0041")).rejects.toMatchObject({ code: "FORBIDDEN" })
  })
})

describe("mock Director insights: exceptions and summaries", () => {
  it("lists every planted defect category with the rule that found it", async () => {
    const x = await make(DIRECTOR).directorExceptions(ctx, range)
    const count = (c: string) => x.categories.find((k) => k.category === c)!.count
    expect(count("STALE_LOAD")).toBe(3)
    for (const c of ["MISSING_JOIN", "UNRESOLVED_IDENTITY", "DUPLICATE_KEY", "STATUS_DIFFERENCE"]) expect(count(c)).toBeGreaterThan(0)
    expect(x.categories.every((c) => c.rule.length > 20)).toBe(true)
    expect(x.exceptions.every((e) => e.rule === x.categories.find((c) => c.category === e.category)!.rule)).toBe(true)
    expect(x.exceptions.some((e) => e.sampleRecordIds.includes("RESP-000001"))).toBe(true)
  })
  it("territory summary evidence is per territory, with cited themes and the rule's verdicts", async () => {
    const s = await make(DIRECTOR).territorySummaryEvidence(ctx, range)
    expect(s.territories).toHaveLength(6)
    for (const t of s.territories) {
      expect(t.topThemes.length).toBeLessThanOrEqual(3)
      expect(t.topThemes.every((th) => th.evidence.length === 1 && th.status === emergingStatus(th.currentResponses, th.priorResponses, th.currentTotal, th.priorTotal))).toBe(true)
    }
  })
})

describe("mock AI territory summary run", () => {
  it("streams a labelled summary whose figures are all in the source facts, and refuses another territory", async () => {
    // Runs reveal their events by the clock, so this one adapter uses the real time.
    const a = createMockAdapter({ getUserId: () => DIRECTOR, getScenario: () => "ok", latencyMs: 0 })
    await a.startChatRun(ctx, { threadId: "t", runId: "run-summary-1", message: "Summarize NE-01", history: [], context: { intent: "TERRITORY_SUMMARY", territoryId: "NE-01", from: range.from, to: range.to, view: "director-insights" } })
    await new Promise((r) => setTimeout(r, 5000))
    const page = await a.chatEvents(ctx, "run-summary-1", 0)
    const events = page.events.map((e) => JSON.parse(e.data))
    const text = events.filter((e) => e.type === "TEXT_MESSAGE_CONTENT").map((e) => e.delta).join("")
    const facts = events.find((e) => e.name === "source_facts").value.facts as { value: number }[]
    for (const n of text.match(/\d+/g) ?? []) if (n !== "01") expect(facts.map((f) => String(f.value))).toContain(n)
    expect(events.find((e) => e.name === "citations").value[0].dataset).toBe("hcp_raw_insights")
    await a.startChatRun(ctx, { threadId: "t", runId: "run-summary-2", message: "Summarize SE-01", history: [], context: { intent: "TERRITORY_SUMMARY", territoryId: "SE-01" } })
    await new Promise((r) => setTimeout(r, 2500))
    const refused = (await a.chatEvents(ctx, "run-summary-2", 0)).events.map((e) => JSON.parse(e.data)).filter((e) => e.type === "TEXT_MESSAGE_CONTENT").map((e) => e.delta).join("")
    expect(refused).toContain("outside your scope")
  }, 15_000)
})

describe("graphql adapter: Director insights", () => {
  const record = () => {
    const seen: { query: string; variables?: Record<string, unknown> }[] = []
    const transport: GraphQLTransport = async (req) => {
      seen.push(req)
      return { data: { topicHeatmap: {}, questionAnalytics: {}, emergingTopics: {}, directorDrilldown: {}, directorExceptions: {}, territorySummaryEvidence: {}, startChatRun: { runId: "r", status: "RUNNING" } } as never }
    }
    return { seen, adapter: createGraphQLAdapter(transport) }
  }

  it("sends the window and only the filters that are set, never nulls", async () => {
    const { seen, adapter } = record()
    await adapter.topicHeatmap(ctx, { range: { from: "2026-08-01", to: "2026-10-31" }, filters: { from: "x", to: "y", molecule: "osimertinib", study: "" }, facet: "STUDY" })
    expect(seen[0]).toEqual({ query: TOPIC_HEATMAP_QUERY, variables: { from: "2026-08-01", to: "2026-10-31", filters: { molecule: "osimertinib" }, facet: "STUDY" } })
    await adapter.topicHeatmap(ctx, { facet: "NONE" })
    expect(seen[1].variables).toEqual({})
    await adapter.emergingTopics(ctx, { range: { from: "2026-08-01", to: "2026-10-31" } })
    expect(seen[2]).toEqual({ query: EMERGING_TOPICS_QUERY, variables: { from: "2026-08-01", to: "2026-10-31" } })
  })

  it("shapes question, drill-down, exception and summary variables", async () => {
    const { seen, adapter } = record()
    await adapter.questionAnalytics(ctx, { questionId: "Q-0013" })
    await adapter.questionAnalytics(ctx, { questionId: null })
    await adapter.directorDrilldown(ctx, { level: "TERRITORY", id: "NE-01", range: { from: "2026-08-01", to: "2026-10-31" } })
    await adapter.directorDrilldown(ctx)
    await adapter.directorExceptions(ctx, { from: "2026-08-01", to: "2026-10-31" })
    await adapter.territorySummaryEvidence(ctx)
    expect(seen.map((s) => s.variables)).toEqual([
      { questionId: "Q-0013" },
      {},
      { from: "2026-08-01", to: "2026-10-31", level: "TERRITORY", id: "NE-01" },
      { level: "ROOT" },
      { from: "2026-08-01", to: "2026-10-31" },
      {},
    ])
  })

  it("adds the chat context only when there is one", async () => {
    const { seen, adapter } = record()
    await adapter.startChatRun(ctx, { threadId: "t", runId: "r1", message: "hi", history: [] })
    await adapter.startChatRun(ctx, { threadId: "t", runId: "r2", message: "hi", history: [], context: {} })
    await adapter.startChatRun(ctx, { threadId: "t", runId: "r3", message: "hi", history: [], context: { territoryId: "T01-01", intent: "TERRITORY_SUMMARY" } })
    expect(seen.every((s) => s.query === START_CHAT_RUN_MUTATION)).toBe(true)
    expect(seen[0].variables).not.toHaveProperty("context")
    expect(seen[1].variables).not.toHaveProperty("context")
    expect(seen[2].variables).toMatchObject({ context: { territoryId: "T01-01", intent: "TERRITORY_SUMMARY" } })
  })

  it("maps a refusal to a typed error without the server text", async () => {
    const adapter = createGraphQLAdapter(async () => ({ errors: [{ message: "HCP Jane Roe in T09", errorType: "Forbidden" }] }))
    const err = await adapter.directorDrilldown(ctx, { level: "TERRITORY", id: "T09-01" }).catch((e) => e)
    expect(err).toMatchObject({ code: "FORBIDDEN" })
    expect(String(err.message)).not.toContain("Jane")
  })
})
