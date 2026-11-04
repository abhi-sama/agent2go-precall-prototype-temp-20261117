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
    const tiles = await dirA.territoryActivity!(ctx, range)
    expect(tiles).toHaveLength(24)
    expect(tiles.filter((t) => t.inScope)).toHaveLength(6)
    expect(tiles.filter((t) => t.inScope).reduce((n, t) => n + t.distinctCalls, 0)).toBe(dir.distinctCalls)
  })

  it("out-of-scope territories carry no data", async () => {
    const tiles = await make("u-msl-ne-01").territoryActivity!(ctx, range)
    for (const t of tiles.filter((x) => !x.inScope)) {
      expect([t.distinctCalls, t.distinctEngagedHcps, t.responseCount]).toEqual([0, 0, 0])
    }
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

  it("administrators get no clinical KPIs", async () => {
    await expect(make("u-admin-sec").landingKpis(ctx, range)).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("parses scenario only from known values", () => {
    expect(readScenario("?scenario=empty")).toBe("empty")
    expect(readScenario("?scenario=bogus")).toBe("ok")
    expect(readScenario(undefined)).toBe("ok")
  })
})
