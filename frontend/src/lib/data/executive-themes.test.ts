import { describe, expect, it } from "vitest"
import { applyEvent, isAggregateCitation, newTurn, parseEvent, type AssistantTurn } from "@/lib/chat/events"
import { MIN_CELL } from "./disclosure"
import { createGraphQLExecutiveThemes, EXECUTIVE_TOPIC_MATRIX_QUERY } from "./executive-themes"
import { createMockAdapter, type MockScenario } from "./mock-adapter"
import { buildGrid, buildMatrix, buildThemes, type ThemesInput } from "./mock-executive-themes"
import { TERRITORIES } from "./fixtures"
import { DataError } from "./types"

const ctx = { correlationId: "test" }
const NOW = () => new Date("2026-11-03T12:00:00Z")
const make = (scenario: MockScenario = "ok", userId = "u-exec-all") =>
  createMockAdapter({ getUserId: () => userId, getScenario: () => scenario, latencyMs: 0, now: NOW })

const input = (days: number, extra: Partial<ThemesInput> = {}): ThemesInput => ({
  territories: TERRITORIES,
  range: { from: `2026-${days > 30 ? "08" : "10"}-${days > 30 ? "01" : "02"}`, to: days > 60 ? "2026-10-30" : days > 30 ? "2026-08-30" : "2026-10-31" },
  dataThrough: "2026-11-02T05:30:00Z",
  scopeLabel: "All regions · aggregate only",
  records: false,
  empty: false,
  ...extra,
})
const WINDOWS = [7, 30, 60, 90, 180].map((d) => {
  const to = "2026-10-31"
  const from = new Date(Date.parse(to) - (d - 1) * 86_400_000).toISOString().slice(0, 10)
  return { from, to }
})
const at = (range: { from: string; to: string }, extra: Partial<ThemesInput> = {}): ThemesInput => ({ ...input(30), range, ...extra })

describe("topic-by-region matrix, aggregate-only", () => {
  it("never shows a count between 1 and 4, in any window, and never leaves a number on a withheld cell", () => {
    for (const range of WINDOWS) {
      const m = buildMatrix(at(range), "PORTFOLIO", null)
      for (const row of m.rows)
        for (const cell of row.cells)
          for (const c of [cell.responses, cell.priorResponses]) {
            if (c.suppressed) expect(c.value).toBeNull()
            else expect(c.value !== null && c.value >= 1 && c.value < MIN_CELL).toBe(false)
          }
      for (const r of m.regions) for (const c of [r.freeTextResponses, r.priorFreeTextResponses]) expect(c.suppressed ? c.value === null : !(c.value! >= 1 && c.value! < MIN_CELL)).toBe(true)
    }
  })

  it("withholds a second value in a column whenever exactly one small group would otherwise be recoverable", () => {
    let sawSmall = false
    for (const range of WINDOWS) {
      const input30 = at(range)
      const m = buildMatrix(input30, "PORTFOLIO", null)
      const grid = buildGrid(input30, "Portfolio", 1)
      m.regions.forEach((region, ci) => {
        const column = grid[ci].topics
        const small = column.filter((t) => t.cur > 0 && t.cur < MIN_CELL).length
        const hidden = m.rows.filter((r) => r.cells[ci].responses.suppressed).length
        if (small === 1 && !region.freeTextResponses.suppressed) {
          sawSmall = true
          expect(hidden).toBeGreaterThanOrEqual(2)
        }
        if (small === 0) expect(hidden).toBe(0)
        // The published total plus the shown parts must never pin down a single hidden part.
        if (!region.freeTextResponses.suppressed) expect(hidden).not.toBe(1)
      })
    }
    expect(sawSmall).toBe(true)
  })

  it("plants a thin region, a withheld cell and a topic rising in more than one region", () => {
    const m = buildMatrix(at(WINDOWS[3]), "PORTFOLIO", null)
    const thin = m.regions.find((r) => r.regionId === "WE")!
    expect(thin.sampleSufficient).toBe(false)
    expect(m.regions.filter((r) => r.sampleSufficient).length).toBeGreaterThanOrEqual(2)
    const thinCells = m.rows.map((r) => r.cells.find((c) => c.regionId === "WE")!)
    expect(thinCells.some((c) => c.responses.suppressed)).toBe(true)
    // A thin region never gets a rising or falling verdict.
    expect(thinCells.every((c) => c.trend === "WITHHELD" || c.trend === "INSUFFICIENT_SAMPLE")).toBe(true)
    const ct = m.rows.find((r) => r.topic.startsWith("ctDNA"))!
    expect(ct.crossRegion).toBe(true)
    expect(ct.regionsRising).toBeGreaterThanOrEqual(2)
    expect(ct.cells.filter((c) => c.alert).length).toBe(ct.regionsRising)
    const kinds = new Set(m.rows.flatMap((r) => r.cells.map((c) => c.trend)))
    for (const k of ["RISING", "STEADY", "WITHHELD", "INSUFFICIENT_SAMPLE"]) expect(kinds.has(k as never)).toBe(true)
  })

  it("states the approved thresholds and the sample limitations", () => {
    const m = buildMatrix(at(WINDOWS[3]), "PORTFOLIO", null)
    expect(m.thresholds).toMatchObject({ approved: true, minWindowResponses: 30, minTopicResponses: 10, minSharePoints: 2, minCell: MIN_CELL })
    expect(m.sampleLimitations.some((l) => l.includes("West") && l.includes("fewer than 30"))).toBe(true)
    expect(m.sampleLimitations.some((l) => /withheld/.test(l))).toBe(true)
  })

  it("with record-level permission nothing is withheld and the view says so", () => {
    const m = buildMatrix(at(WINDOWS[1], { records: true }), "PORTFOLIO", null)
    expect(m.accessLevel).toBe("RECORD_DRILLDOWN")
    expect(m.disclosure.applied).toBe(false)
    expect(m.rows.every((r) => r.cells.every((c) => !c.responses.suppressed && !c.priorResponses.suppressed))).toBe(true)
  })
})

describe("theme cards, aggregate-only", () => {
  it("ranks only what is shown, lists withheld cards last, and keeps hidden counts out of citation text", () => {
    for (const range of WINDOWS) {
      const themes = buildThemes(at(range), "MOLECULE")
      for (const group of themes.groups) {
        const values = group.cards.map((c) => c.responses.value)
        const firstHidden = values.findIndex((v) => v === null)
        if (firstHidden >= 0) expect(values.slice(firstHidden).every((v) => v === null)).toBe(true)
        const shownValues = values.filter((v): v is number => v !== null)
        expect(shownValues).toEqual([...shownValues].sort((a, b) => b - a))
        for (const card of group.cards) {
          expect(card.citations.length).toBeGreaterThan(0)
          expect(card.citations.every((c) => c.kind === "AGGREGATE" && c.recordId === null && c.excerpt === null)).toBe(true)
          if (card.responses.suppressed) {
            expect(card.share).toBeNull()
            expect(card.trend).toBe("WITHHELD")
            expect(card.citations[0].responses?.value).toBeNull()
            expect(card.citations[0].label).not.toMatch(/\b[1-4] responses/)
          }
        }
      }
    }
  })

  it("covers portfolio, molecule, disease area and study", () => {
    expect(buildThemes(at(WINDOWS[3]), "PORTFOLIO").groups.map((g) => g.facetValue)).toEqual(["Portfolio"])
    for (const f of ["MOLECULE", "DISEASE_AREA", "STUDY"] as const) expect(buildThemes(at(WINDOWS[3]), f).groups.length).toBe(4)
  })

  it("with record-level permission cards cite responses with excerpts", () => {
    const themes = buildThemes(at(WINDOWS[3], { records: true }), "PORTFOLIO")
    const citation = themes.groups[0].cards[0].citations[0]
    expect(citation).toMatchObject({ kind: "RECORD" })
    expect(citation.recordId).toMatch(/^RESP-5/)
    expect(citation.excerpt).toBeTruthy()
  })
})

describe("mock adapter: executive themes and leadership summaries", () => {
  it("refuses everyone but an Executive", async () => {
    await expect(make("ok", "u-dir-ne").executiveThemes(ctx)).rejects.toMatchObject({ code: "FORBIDDEN" })
    await expect(make("ok", "u-msl-ne-01").executiveTopicMatrix(ctx)).rejects.toMatchObject({ code: "FORBIDDEN" })
    await expect(make("forbidden").executiveThemes(ctx)).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("generates, lists, reopens and exports a summary with scope, dates, definitions, limitations and citations", async () => {
    const adapter = make()
    const range = { from: "2026-08-02", to: "2026-10-31" }
    const made = await adapter.generateLeadershipSummary(ctx, range)
    expect(made).toMatchObject({ from: range.from, to: range.to, accessLevel: "AGGREGATE_ONLY", modelMode: "stub", stale: false })
    expect(made.definitions.length).toBeGreaterThan(0)
    expect(made.sampleLimitations.length).toBeGreaterThan(0)
    const ids = new Set(made.citations.map((c) => c.citationId))
    expect(made.statements.every((s) => s.citationIds.length > 0 && s.citationIds.every((id) => ids.has(id)))).toBe(true)
    expect((await adapter.myLeadershipSummaries(ctx)).map((i) => i.summaryId)).toContain(made.summaryId)
    expect((await adapter.leadershipSummary(ctx, made.summaryId)).summaryId).toBe(made.summaryId)
    const exported = await adapter.exportLeadershipSummary(ctx, made.summaryId)
    expect(exported).toMatchObject({ summaryId: made.summaryId, scopeLabel: made.scopeLabel, from: range.from, to: range.to, definitionVersion: made.definitionVersion })
    expect(exported.disclosureText).toMatch(/withheld/)
    expect(exported.exportedAt).toBe(NOW().toISOString())
  })

  it("re-checks access on open and export when the scope has changed", async () => {
    const ok = make()
    const made = await ok.generateLeadershipSummary(ctx)
    const changed = make("scope-changed")
    await expect(changed.leadershipSummary(ctx, made.summaryId)).rejects.toMatchObject({ code: "FORBIDDEN" })
    await expect(changed.exportLeadershipSummary(ctx, made.summaryId)).rejects.toBeInstanceOf(DataError)
    const listed = await changed.myLeadershipSummaries(ctx)
    expect(listed.length).toBeGreaterThan(0)
    expect(listed.every((i) => i.accessible === false && i.title === null && i.from === null)).toBe(true)
  })

  it("marks a summary stale when newer data has been loaded", async () => {
    const made = await make().generateLeadershipSummary(ctx)
    const reopened = await make("stale").leadershipSummary(ctx, made.summaryId)
    expect(reopened.stale).toBe(true)
    expect(reopened.staleReasons).toEqual(["NEWER_DATA_LOADED"])
  })
})

describe("GraphQL adapter", () => {
  it("sends only the optional variables that were given", async () => {
    const calls: Array<{ query: string; variables?: Record<string, unknown> }> = []
    const adapter = createGraphQLExecutiveThemes(async (query, variables) => {
      calls.push({ query, variables })
      return { executiveTopicMatrix: { rows: [] } } as never
    })
    await adapter.executiveTopicMatrix(ctx, { from: "2026-08-01" }, "MOLECULE", "osimertinib")
    await adapter.executiveTopicMatrix(ctx)
    expect(calls[0].query).toBe(EXECUTIVE_TOPIC_MATRIX_QUERY)
    expect(calls[0].variables).toEqual({ from: "2026-08-01", facet: "MOLECULE", facetValue: "osimertinib" })
    expect(calls[1].variables).toEqual({})
  })
})

describe("chat events for Executive analysis", () => {
  const fold = (events: object[]) => events.reduce<AssistantTurn>((turn, e) => applyEvent(turn, parseEvent(JSON.stringify(e))!), newTurn("r1"))
  it("keeps sample limitations and tells aggregate citations apart from records", () => {
    const turn = fold([
      { type: "CUSTOM", name: "citations", value: [{ record_id: "agg:PORTFOLIO:Portfolio:X", dataset: "hcp_raw_insights", label: "A set", detail: "described by filters" }, { record_id: "RESP-1", dataset: "hcp_raw_insights", label: "One" }] },
      { type: "CUSTOM", name: "sample_limitations", value: { items: ["Few responses.", "Few responses.", " "] } },
    ])
    expect(turn.sampleLimitations).toEqual(["Few responses."])
    expect(turn.citations.map(isAggregateCitation)).toEqual([true, false])
    expect(turn.citations[0].detail).toBe("described by filters")
  })
})
