import { describe, expect, it } from "vitest"
import { createGraphQLAdapter } from "./graphql-adapter"
import { createMockAdapter, type MockScenario } from "./mock-adapter"
import { DIRECTOR_OVERVIEW_QUERY, TERRITORY_COMPARISON_QUERY } from "./operations"

const ctx = { correlationId: "test" }
const NOW = () => new Date("2026-11-03T12:00:00Z")
const make = (userId: string, scenario: MockScenario = "ok") =>
  createMockAdapter({ getUserId: () => userId, getScenario: () => scenario, latencyMs: 0, now: NOW })
const range = { from: "2026-08-01", to: "2026-10-31" }

describe("mock director overview", () => {
  it("is limited to the director's own region and counts calls apart from call-product rows", async () => {
    const o = await make("u-dir-ne").directorOverview(ctx, range)
    expect(o.territories).toHaveLength(6)
    expect(o.territories.every((t) => t.regionId === "NE")).toBe(true)
    expect(o.kpis.callProductRows).toBeGreaterThan(o.kpis.distinctCalls)
    expect(o.kpis.distinctCalls).toBe(o.territories.reduce((n, t) => n + t.distinctCalls, 0))
    expect(o.kpis.distinctEngagedHcps).toBeLessThan(o.territories.reduce((n, t) => n + t.distinctEngagedHcps, 0))
    expect([o.from, o.to]).toEqual([range.from, range.to])
  })

  it("hides coverage without a target population and shows it only when one exists", async () => {
    const none = await make("u-dir-ne").directorOverview(ctx, range)
    expect(none.coverage).toMatchObject({ status: "NO_TARGET_POPULATION", percentage: null, targetHcps: null })
    expect(none.territories.every((t) => t.coverage.percentage === null)).toBe(true)
    const some = await make("u-dir-ne", "targets").directorOverview(ctx, range)
    expect(some.coverage.status).toBe("AVAILABLE")
    expect(some.coverage.percentage).toBeGreaterThan(0)
    expect(some.coverage.territoriesWithTargets).toBeLessThan(some.coverage.territoriesInScope)
    expect(some.territories.filter((t) => t.coverage.status === "AVAILABLE").length).toBe(some.coverage.territoriesWithTargets)
  })

  it("shows a hatched-zero reporting gap and a mix whose product mentions exceed the calls", async () => {
    const o = await make("u-dir-ne").directorOverview(ctx, range)
    expect(o.members.some((m) => m.reportingCompleteness < 1)).toBe(true)
    const product = o.mix.find((m) => m.dimension === "PRODUCT")!
    expect(product.valueTotal).toBeGreaterThan(product.totalDistinctCalls)
    expect(product.valuesOverlap).toBe(true)
    expect(o.mix.find((m) => m.dimension === "CHANNEL")!.valuesOverlap).toBe(false)
  })

  it("refuses other personas and an over-long window", async () => {
    await expect(make("u-msl-ne-01").directorOverview(ctx, range)).rejects.toMatchObject({ code: "FORBIDDEN" })
    await expect(make("u-exec-all").directorOverview(ctx, range)).rejects.toMatchObject({ code: "FORBIDDEN" })
    await expect(make("u-dir-ne").directorOverview(ctx, { from: "2025-01-01", to: "2026-11-03" })).rejects.toMatchObject({ code: "BAD_REQUEST" })
  })
})

describe("mock territory comparison", () => {
  it("applies one window to every territory and discloses unequal target data", async () => {
    const c = await make("u-dir-ne", "targets").territoryComparison(ctx, ["NE-01", "NE-03"], range)
    expect([c.from, c.to]).toEqual([range.from, range.to])
    expect(c.territories.map((t) => t.territoryId)).toEqual(["NE-01", "NE-03"])
    expect(c.populationsUnequal).toBe(true)
    expect(c.disclosures.map((d) => d.code)).toContain("TARGET_DATA_UNEVEN")
    expect(c.definitionVersion).toBe((await make("u-dir-ne").directorOverview(ctx, range)).definitionVersion)
  })

  it("refuses out-of-scope territories and too few or too many", async () => {
    const dir = make("u-dir-ne")
    await expect(dir.territoryComparison(ctx, ["NE-01", "SE-01"], range)).rejects.toMatchObject({ code: "FORBIDDEN" })
    await expect(dir.territoryComparison(ctx, ["NE-01"], range)).rejects.toMatchObject({ code: "BAD_REQUEST" })
  })
})

describe("graphql director adapter", () => {
  it("sends the documented operations with the window and returns the payload untouched", async () => {
    const seen: unknown[] = []
    const adapter = createGraphQLAdapter(async (req) => {
      seen.push(req)
      return { data: { directorOverview: { scopeLabel: "x" }, territoryComparison: { scopeLabel: "y" } } as never }
    })
    expect((await adapter.directorOverview(ctx, range)).scopeLabel).toBe("x")
    expect((await adapter.territoryComparison(ctx, ["T01-01", "T01-02"], range)).scopeLabel).toBe("y")
    expect(seen).toEqual([
      { query: DIRECTOR_OVERVIEW_QUERY, variables: { from: range.from, to: range.to } },
      { query: TERRITORY_COMPARISON_QUERY, variables: { territoryIds: ["T01-01", "T01-02"], from: range.from, to: range.to } },
    ])
  })
})
