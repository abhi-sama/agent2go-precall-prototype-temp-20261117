import { describe, expect, it } from "vitest"
import { MIN_CELL, suppressFlags } from "./disclosure"
import { createGraphQLAdapter, type GraphQLTransport } from "./graphql-adapter"
import { createMockAdapter, type MockScenario } from "./mock-adapter"
import { EXECUTIVE_OVERVIEW_QUERY } from "./operations"
import type { ExecutiveOverview, SuppressedCount } from "./types"

const ctx = { correlationId: "test" }
const NOW = () => new Date("2026-11-03T12:00:00Z")
const make = (userId: string, scenario: MockScenario = "ok") =>
  createMockAdapter({ getUserId: () => userId, getScenario: () => scenario, latencyMs: 0, now: NOW })
const wide = { from: "2026-05-01", to: "2026-10-31" }
const oneDay = { from: "2026-11-02", to: "2026-11-02" }

const cells = (o: ExecutiveOverview): SuppressedCount[] => [
  o.kpis.calls, o.kpis.responses, o.kpis.engagedHcps,
  ...o.months.flatMap((m) => [m.calls, m.responses, m.engagedHcps]),
  ...[...o.regions, ...o.territories].flatMap((u) => [u.calls, u.responses, u.engagedHcps]),
  ...o.engagement.depth.map((d) => d.hcps), ...o.engagement.channels.map((c) => c.calls),
]

describe("small-group disclosure rule", () => {
  it("withholds counts below the threshold but not zero", () => {
    expect(suppressFlags([40, 0, 3, 25], 68, false).flags).toEqual([false, false, true, false])
    expect(suppressFlags([5, 4], null, false).flags).toEqual([false, true])
  })
  it("withholds the next smallest part so one hidden part cannot be found by subtraction", () => {
    expect(suppressFlags([40, 3, 25, 31], 99, true).flags).toEqual([false, true, true, false])
    expect(suppressFlags([3, 0, 0], 3, true)).toEqual({ flags: [true, false, false], totalHidden: true })
  })
})

describe("mock executive overview", () => {
  it("is aggregate-only: counts only, with small groups withheld and carrying no value", async () => {
    const o = await make("u-exec-all").executiveOverview(ctx, oneDay)
    expect(o.accessLevel).toBe("AGGREGATE_ONLY")
    expect(o.disclosure.applied).toBe(true)
    const all = cells(o)
    expect(all.some((c) => c.suppressed)).toBe(true)
    for (const c of all) {
      if (c.suppressed) expect(c.value).toBeNull()
      else expect(c.value === 0 || (c.value as number) >= MIN_CELL).toBe(true)
    }
    expect(o.disclosure.suppressedCells).toBeGreaterThan(0)
  })

  it("never ranks a withheld unit and ranks the rest best first", async () => {
    const o = await make("u-exec-all").executiveOverview(ctx, wide)
    const values = o.regions.map((r) => r.calls.value as number)
    expect(values).toEqual([...values].sort((a, b) => b - a))
    expect(o.regions[0].rank).toBe(1)
    const small = await make("u-exec-all").executiveOverview(ctx, oneDay)
    for (const u of small.territories.filter((t) => t.calls.suppressed)) expect(u.rank).toBeNull()
  })

  it("shows regional totals that add up to the enterprise total", async () => {
    const o = await make("u-exec-all").executiveOverview(ctx, wide)
    expect(o.regions.reduce((n, r) => n + (r.calls.value as number), 0)).toBe(o.kpis.calls.value)
    expect(o.territories.reduce((n, t) => n + (t.calls.value as number), 0)).toBe(o.kpis.calls.value)
    expect(o.kpis.regionsInScope).toBe(4)
  })

  it("covers only data-through: a window running past it omits later months and says so", async () => {
    const o = await make("u-exec-all").executiveOverview(ctx, { from: "2026-09-01", to: "2026-12-31" })
    expect(o.freshness.status).toBe("PARTIAL")
    expect(o.months.at(-1)?.month).toBe("2026-11-01")
    expect(o.months.at(-1)?.isPartial).toBe(true)
    expect(o.notes.map((n) => n.code)).toContain("AFTER_DATA_THROUGH")
  })

  it("withholds coverage without a target population", async () => {
    expect((await make("u-exec-all").executiveOverview(ctx, wide)).engagement.coverage.status).toBe("NO_TARGET_POPULATION")
    expect((await make("u-exec-all", "targets").executiveOverview(ctx, wide)).engagement.coverage.status).toBe("AVAILABLE")
  })

  it("refuses everyone but an Executive, and a bad window", async () => {
    for (const user of ["u-msl-ne-01", "u-dir-ne", "u-admin-sec"]) {
      await expect(make(user).executiveOverview(ctx, wide)).rejects.toMatchObject({ code: "FORBIDDEN" })
    }
    await expect(make("u-exec-all").executiveOverview(ctx, { from: "2020-01-01", to: "2026-10-01" })).rejects.toMatchObject({ code: "BAD_REQUEST" })
  })
})

describe("mock executive drill-down", () => {
  const input = { scopeId: "NE-01", kind: "CALLS" as const, month: "2026-10-01", limit: 10 }
  it("is denied without record-level permission", async () => {
    await expect(make("u-exec-all").executiveDrilldown(ctx, input)).rejects.toMatchObject({ code: "FORBIDDEN" })
  })
  it("opens with it, stays inside the scope, and refuses unknown scopes the same way", async () => {
    const adapter = make("u-exec-all", "records")
    const overview = await adapter.executiveOverview(ctx, wide)
    expect(overview.accessLevel).toBe("RECORD_DRILLDOWN")
    expect(overview.disclosure.applied).toBe(false)
    expect(cells(overview).every((c) => !c.suppressed)).toBe(true)
    const result = await adapter.executiveDrilldown(ctx, input)
    expect(result.records).toHaveLength(10)
    expect(result.records.every((r) => r.territoryId === "NE-01")).toBe(true)
    await expect(adapter.executiveDrilldown(ctx, { ...input, scopeId: "XX-99" })).rejects.toMatchObject({ code: "FORBIDDEN" })
    await expect(make("u-dir-ne", "records").executiveDrilldown(ctx, input)).rejects.toMatchObject({ code: "FORBIDDEN" })
  })
})

describe("executive over GraphQL", () => {
  it("sends the window and ranking as variables", async () => {
    const calls: { query: string; variables?: Record<string, unknown> }[] = []
    const adapter = createGraphQLAdapter((async (request: { query: string; variables?: Record<string, unknown> }) => {
      calls.push(request)
      return { data: { executiveOverview: { scopeLabel: "x" } } }
    }) as unknown as GraphQLTransport)
    await adapter.executiveOverview(ctx, { from: "2026-01-01", rankBy: "RESPONSES" })
    expect(calls[0].query).toBe(EXECUTIVE_OVERVIEW_QUERY)
    expect(calls[0].variables).toEqual({ from: "2026-01-01", to: null, rankBy: "RESPONSES" })
  })
})
