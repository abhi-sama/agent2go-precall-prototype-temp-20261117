import { describe, expect, it } from "vitest"
import { MIN_CELL } from "./disclosure"
import { createGraphQLExecutiveTrends, EXECUTIVE_TRENDS_QUERY } from "./executive-trends"
import { createMockAdapter, type MockScenario } from "./mock-adapter"
import { buildTrends, trendStatus } from "./mock-executive-trends"
import { TERRITORIES } from "./fixtures"
import type { ExecutiveInput } from "./mock-executive"

const ctx = { correlationId: "test" }
const NOW = () => new Date("2026-11-03T12:00:00Z")
const make = (scenario: MockScenario = "ok", userId = "u-exec-all") =>
  createMockAdapter({ getUserId: () => userId, getScenario: () => scenario, latencyMs: 0, now: NOW })

const input = (extra: Partial<ExecutiveInput> = {}): ExecutiveInput => ({
  territories: TERRITORIES,
  range: { from: "2025-12-01", to: "2026-11-02" },
  throughDay: "2026-11-02",
  dataThrough: "2026-11-02T05:30:00Z",
  scopeLabel: "All regions · aggregate only",
  empty: false,
  records: false,
  rankBy: "CALLS",
  withTargets: false,
  metricsFor: () => ({ calls: 0, hcps: 0, responses: 0 }),
  ...extra,
})

describe("the approved threshold rule (mirrors app.exec_activity_trend_status)", () => {
  it("matches the database truth table", () => {
    expect(trendStatus(100, 50, 100, 100)).toBe("RISING")
    expect(trendStatus(10, 30, 20, 40)).toBe("INSUFFICIENT_SAMPLE")
    expect(trendStatus(50, 50, 60, 60)).toBe("STEADY")
    expect(trendStatus(10, 30, 60, 60)).toBe("FALLING")
    expect(trendStatus(50, 100, 60, 60)).toBe("FALLING")
    expect(trendStatus(60, 50, 60, 60)).toBe("STEADY")
  })
})

describe("executive trends, aggregate-only", () => {
  const trends = buildTrends(input())

  it("covers every explicitly granted region and every month, with the three metrics", () => {
    expect(trends.regions.map((r) => r.regionId)).toEqual(["NE", "SE", "MW", "WE"])
    for (const r of trends.regions) {
      expect(r.months).toHaveLength(12)
      expect(r.metrics.map((m) => m.metric)).toEqual(["CALLS", "ENGAGED_HCPS", "RESPONSES"])
    }
    expect(trends.priorTo < trends.trendFrom && trends.trendFrom <= trends.trendTo).toBe(true)
  })

  it("never shows a count between 1 and 4, and a withheld count carries no value", () => {
    for (const r of trends.regions) {
      const counts = [...r.months.flatMap((m) => [m.calls, m.responses, m.engagedHcps]), ...r.metrics.flatMap((m) => [m.latest, m.prior])]
      for (const c of counts) {
        if (c.suppressed) expect(c.value).toBeNull()
        else expect(c.value !== null && c.value >= 1 && c.value < MIN_CELL).toBe(false)
      }
    }
  })

  it("leaves no row or column of the region-by-month table with exactly one withheld call count", () => {
    const rows = trends.regions.map((r) => r.months.map((m) => m.calls.suppressed))
    for (const row of rows) expect(row.filter(Boolean).length).not.toBe(1)
    for (let m = 0; m < 12; m++) expect(rows.filter((row) => row[m]).length).not.toBe(1)
  })

  it("judges one verdict per region from the rule: rising, falling, steady, and no trend where responses are few", () => {
    const calls = Object.fromEntries(trends.regions.map((r) => [r.regionId, r.metrics[0].trend]))
    expect(calls).toMatchObject({ NE: "RISING", SE: "FALLING", MW: "STEADY" })
    const west = trends.regions.find((r) => r.regionId === "WE")!
    expect(west.sampleSufficient).toBe(false)
    expect(west.metrics.every((m) => m.trend === "INSUFFICIENT_SAMPLE")).toBe(true)
    expect(trends.sampleLimitations.join(" ")).toContain("Too few responses to judge a trend in West")
  })

  it("gives a withheld figure no arrow and no percentage", () => {
    const tiny = buildTrends(input({ territories: TERRITORIES.filter((t) => t.regionId === "WE").slice(0, 1) }))
    const metric = tiny.regions[0].metrics.find((m) => m.metric === "CALLS")!
    if (metric.latest.suppressed || metric.prior.suppressed) {
      expect(metric.changePercent).toBeNull()
      expect(["WITHHELD", "INSUFFICIENT_SAMPLE"]).toContain(metric.trend)
    }
  })

  it("withholds nothing for an Executive with record-level permission", () => {
    const open = buildTrends(input({ records: true }))
    expect(open.accessLevel).toBe("RECORD_DRILLDOWN")
    expect(open.disclosure.applied).toBe(false)
    expect(open.regions.flatMap((r) => r.months).some((m) => m.calls.suppressed)).toBe(false)
  })

  it("is empty, not zero-filled with arrows, when nothing was recorded", () => {
    const empty = buildTrends(input({ empty: true }))
    expect(empty.regions.flatMap((r) => r.metrics).every((m) => m.trend === "INSUFFICIENT_SAMPLE")).toBe(true)
  })
})

describe("executive trends through the adapter", () => {
  it("serves an Executive their regions and refuses every other persona", async () => {
    const t = await make().executiveTrends(ctx)
    expect(t.accessLevel).toBe("AGGREGATE_ONLY")
    expect(t.regions).toHaveLength(4)
    expect(t.thresholds.approved).toBe(true)
    for (const user of ["u-msl-ne-01", "u-admin-sec"]) {
      await expect(make("ok", user).executiveTrends(ctx)).rejects.toMatchObject({ code: "FORBIDDEN" })
    }
    await expect(make("forbidden").executiveTrends(ctx)).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("rejects a range that ends before it starts", async () => {
    await expect(make().executiveTrends(ctx, { from: "2026-02-01", to: "2026-01-01" })).rejects.toMatchObject({ code: "BAD_REQUEST" })
  })
})

describe("executive trends GraphQL document", () => {
  it("asks for the explicit fields and omits unset variables", async () => {
    const seen: { query: string; variables: unknown }[] = []
    const adapter = createGraphQLExecutiveTrends(async (query, variables) => {
      seen.push({ query, variables })
      return { executiveTrends: { regions: [] } } as never
    })
    await adapter.executiveTrends(ctx)
    await adapter.executiveTrends(ctx, { from: "2026-01-01", to: "2026-03-31" })
    expect(seen[0].variables).toEqual({})
    expect(seen[1].variables).toEqual({ from: "2026-01-01", to: "2026-03-31" })
    expect(EXECUTIVE_TRENDS_QUERY).toContain("sampleLimitations")
    expect(EXECUTIVE_TRENDS_QUERY).not.toMatch(/record|excerpt|hcpId/i)
  })
})
