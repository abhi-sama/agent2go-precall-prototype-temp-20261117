import { describe, expect, it } from "vitest"
import { createMockAdapter, readScenario, type MockScenario } from "./mock-adapter"
import { DataError } from "./types"

const ctx = { correlationId: "test" }
const NOW = () => new Date("2026-11-03T12:00:00Z")
const make = (userId: string, scenario: MockScenario = "ok") =>
  createMockAdapter({ getUserId: () => userId, getScenario: () => scenario, latencyMs: 0, now: NOW })
const range = { from: "2026-10-05", to: "2026-11-03" }

describe("mock adapter", () => {
  it("serves contract-shaped KPIs with sane relationships", async () => {
    const k = await make("u-msl-ne-01").landingKpis(ctx, range)
    expect(k.scopeLabel).toContain("NE-01")
    expect(k.distinctCalls).toBeGreaterThan(0)
    expect(k.distinctEngagedHcps).toBeLessThanOrEqual(k.distinctCalls)
    expect(k.responseCount).toBeGreaterThan(k.distinctCalls)
    expect(k.dataThrough).toMatch(/^2026-11-02T/)
  })

  it("is deterministic", async () => {
    const a = await make("u-msl-ne-01").landingKpis(ctx, range)
    const b = await make("u-msl-ne-01").landingKpis(ctx, range)
    expect(a).toEqual(b)
  })

  it("wider scope sees more, and the map reconciles with the KPIs", async () => {
    const msl = await make("u-msl-ne-01").landingKpis(ctx, range)
    const dirA = make("u-dir-ne")
    const dir = await dirA.landingKpis(ctx, range)
    expect(dir.distinctCalls).toBeGreaterThan(msl.distinctCalls)
    const geo = await dirA.geoActivity(ctx, range)
    expect(geo.territories).toHaveLength(6)
    expect(geo.territories.reduce((n, t) => n + (t.distinctCalls ?? 0), 0)).toBe(dir.distinctCalls)
    expect(geo.countries.reduce((n, c) => n + (c.distinctCalls ?? 0), 0)).toBe(dir.distinctCalls)
    expect(geo.countries.map((c) => c.countryCode)).toEqual(["CA", "US"])
    expect(geo).toMatchObject({ from: range.from, to: range.to })
  })

  it("the map holds only in-scope territories, with real locations", async () => {
    const geo = await make("u-msl-ne-01").geoActivity(ctx, range)
    expect(geo.territories.map((t) => [t.territoryId, t.subdivisionCode, t.countryCode, t.isOwn])).toEqual([["NE-01", "MA", "US", true]])
    expect(geo.countries).toEqual([{ countryCode: "US", countryName: "United States", territoryCount: 1, distinctCalls: geo.territories[0].distinctCalls, suppressed: false }])
    expect(JSON.stringify(geo)).not.toMatch(/NE-02|SE-0|Toronto/)
  })

  it("the executive sees every country, but small groups are hidden from aggregate-only viewers", async () => {
    const exec = make("u-exec-all")
    const geo = await exec.geoActivity(ctx, range)
    expect(geo.territories).toHaveLength(24)
    expect(geo.countries.map((c) => c.countryCode)).toEqual(["BR", "CA", "DE", "FR", "GB", "JP", "US"])
    expect(geo.territories.filter((t) => t.countryCode === "US")).toHaveLength(18)
    const oneDay = await exec.geoActivity(ctx, { from: "2026-11-03", to: "2026-11-03" })
    expect(oneDay.territories.every((t) => t.suppressed && t.distinctCalls === null)).toBe(true)
    expect(oneDay.countries.every((c) => c.suppressed && c.distinctCalls === null)).toBe(true)
    const record = await make("u-dir-ne").geoActivity(ctx, { from: "2026-11-03", to: "2026-11-03" })
    expect(record.territories.some((t) => t.suppressed)).toBe(false)
  })

  it("longer ranges give more calls", async () => {
    const a = make("u-msl-ne-01")
    const short = await a.landingKpis(ctx, { from: "2026-10-28", to: "2026-11-03" })
    const long = await a.landingKpis(ctx, range)
    expect(long.distinctCalls).toBeGreaterThan(short.distinctCalls)
  })

  it("simulates empty, stale, error and forbidden states", async () => {
    expect((await make("u-msl-ne-01", "empty").landingKpis(ctx, range)).distinctCalls).toBe(0)
    expect((await make("u-msl-ne-01", "stale").landingKpis(ctx, range)).dataThrough).toMatch(/^2026-10-25T/)
    await expect(make("u-msl-ne-01", "error").landingKpis(ctx, range)).rejects.toMatchObject({ code: "UNAVAILABLE" })
    await expect(make("u-msl-ne-01", "forbidden").landingKpis(ctx, range)).rejects.toBeInstanceOf(DataError)
  })

  it("administrators get no clinical KPIs and no map", async () => {
    await expect(make("u-admin-sec").landingKpis(ctx, range)).rejects.toMatchObject({ code: "FORBIDDEN" })
    await expect(make("u-admin-sec").geoActivity(ctx, range)).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("returns source-level ingestion runs only to an Administrator", async () => {
    const data = await make("u-admin-sec").adminIngestionRuns(ctx)
    expect(data.sources.map((source) => source.sourceId)).toEqual(["call-activity", "hcp-insights", "question-tag", "roster"])
    expect(data.sources[0]).toMatchObject({ loadDate: "2026-11-03T12:00:00Z", dataThrough: "2026-11-03T12:00:00Z" })
    expect(data.sources[0].ingestionRuns).toHaveLength(2)
    expect(data.sources[2].ingestionRuns[0]).toMatchObject({ status: "failed", recordsLoaded: 0 })
    await expect(make("u-msl-ne-01").adminIngestionRuns(ctx)).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("searches mock HCPs only within the selected persona scope and exposes missing fields", async () => {
    const northeast = make("u-msl-ne-01")
    await expect(northeast.searchHcps(ctx, "call system")).resolves.toMatchObject([{ hcpId: "HCP-0001" }])
    await expect(make("u-msl-se-03").searchHcps(ctx, "call system")).resolves.toEqual([])
    const profile = await northeast.hcpProfile(ctx, "HCP-0001")
    expect(profile.credentials).toEqual({ value: null, state: "MISSING" })
    await expect(make("u-msl-se-03").hcpProfile(ctx, "HCP-0001")).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("keeps response bars question-scoped with an explicit denominator", async () => {
    const discovery = await make("u-msl-ne-01").insightDiscovery(ctx, { questionId: "Q-0001" })
    expect(discovery.distributions).toHaveLength(3)
    expect(discovery.distributions.every((row) => row.questionId === "Q-0001" && row.denominator > 0)).toBe(true)
    expect(discovery.distributions.reduce((total, row) => total + row.count, 0)).toBe(discovery.distributions[0].denominator)
  })

  it("consolidates call product rows and preserves parent context within one interaction", async () => {
    const timeline = await make("u-msl-ne-01").hcpTimeline(ctx, "HCP-0001")
    expect(timeline.interactions).toEqual([expect.objectContaining({ callId: "CALL-MOCK-1001", products: ["osimertinib", "pembrolizumab"] })])
    expect(timeline.responses.find((response) => response.responseId === "insight-mock-child")!.parentResponseId).toBe("insight-mock-parent")
    expect(timeline.responses.find((response) => response.responseId === "insight-mock-unrelated")!.parentResponseId).toBeNull()
  })

  it("saves a per-user filter preset and returns it for one-tap reopening", async () => {
    const adapter = make("u-msl-ne-01")
    const saved = await adapter.saveView(ctx, { name: "Lung pulse", reportKind: "insight-discovery", filters: { molecule: "osimertinib", questionId: "Q-0002" } })
    expect(saved.filters.questionId).toBe("Q-0002")
    await expect(adapter.savedViews(ctx)).resolves.toMatchObject([{ savedViewId: saved.savedViewId, name: "Lung pulse" }])
  })

  it("parses scenario only from known values", () => {
    expect(readScenario("?scenario=empty")).toBe("empty")
    expect(readScenario("?scenario=bogus")).toBe("ok")
    expect(readScenario(undefined)).toBe("ok")
  })
})
