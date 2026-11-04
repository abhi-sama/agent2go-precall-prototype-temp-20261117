import { beforeEach, describe, expect, it } from "vitest"
import { createGraphQLAdapter, type GraphQLTransport } from "./graphql-adapter"
import { createMockAdapter, resetMockFlags, type MockScenario } from "./mock-adapter"
import { FLAG_ISSUE_MUTATION } from "./operations"

const ctx = { correlationId: "test" }
const NOW = () => new Date("2026-11-03T12:00:00Z")
const make = (userId: string, scenario: MockScenario = "ok") =>
  createMockAdapter({ getUserId: () => userId, getScenario: () => scenario, latencyMs: 0, now: NOW })

beforeEach(resetMockFlags)

describe("mock activity trends", () => {
  it("returns twelve months of counts, newest last, with the partial month marked", async () => {
    const t = await make("u-msl-ne-01").activityTrends(ctx, 12)
    expect(t.months).toHaveLength(12)
    expect(t.months.map((m) => m.month)).toEqual([...t.months.map((m) => m.month)].sort())
    expect(t.months.at(-1)).toMatchObject({ month: "2026-11-01", isPartial: true })
    expect(t.months.slice(0, -1).every((m) => !m.isPartial)).toBe(true)
    expect(t.dataThrough).toMatch(/^2026-11-02T/)
  })

  it("reports distinct HCPs that never exceed calls and do not add up across months", async () => {
    const t = await make("u-msl-ne-01").activityTrends(ctx)
    for (const m of t.months) expect(m.distinctEngagedHcps).toBeLessThanOrEqual(m.distinctCalls)
    expect(t.totalDistinctCalls).toBe(t.months.reduce((n, m) => n + m.distinctCalls, 0))
    expect(t.totalDistinctEngagedHcps).toBeLessThan(t.months.reduce((n, m) => n + m.distinctEngagedHcps, 0))
  })

  it("has no performance field to render", async () => {
    const t = await make("u-msl-ne-01").activityTrends(ctx)
    const keys = new Set([...Object.keys(t), ...Object.keys(t.months[0])])
    for (const forbidden of ["score", "target", "rank", "attainment", "performance"]) {
      expect([...keys].some((k) => k.toLowerCase().includes(forbidden))).toBe(false)
    }
  })

  it("refuses aggregate-only and admin personas record-level trends", async () => {
    await expect(make("u-exec-all").activityTrends(ctx)).rejects.toMatchObject({ code: "FORBIDDEN" })
    await expect(make("u-admin-sec").activityTrends(ctx)).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("an empty scenario returns zeros, not an error", async () => {
    const t = await make("u-msl-ne-01", "empty").activityTrends(ctx)
    expect(t.totalDistinctCalls).toBe(0)
    expect(t.channels).toEqual([])
  })
})

describe("mock evidence", () => {
  it("lists records whose count matches the chart point, with load after interaction", async () => {
    const a = make("u-msl-ne-01")
    const trends = await a.activityTrends(ctx)
    const point = trends.months.find((m) => m.month === "2026-10-01")!
    const ev = await a.activityEvidence(ctx, { metric: "CALLS", month: "2026-10-15", limit: 100 })
    expect(ev.month).toBe("2026-10-01")
    expect(ev.total).toBe(point.distinctCalls)
    expect(ev.records.length).toBe(Math.min(100, ev.total))
    for (const r of ev.records) {
      expect(r.loadedAt).not.toBeNull()
      expect(r.loadedAt!.slice(0, 10) >= r.interactionDate).toBe(true)
      expect(r.loadedAt!.slice(0, 10) <= "2026-11-02").toBe(true)
    }
    expect(ev.records.some((r) => r.loadedAt!.slice(0, 10) !== r.interactionDate)).toBe(true)
  })

  it("flags truncation honestly", async () => {
    const ev = await make("u-msl-ne-01").activityEvidence(ctx, { metric: "CALLS", month: "2026-10-01", limit: 3 })
    expect(ev.records).toHaveLength(3)
    expect(ev.truncated).toBe(ev.total > 3)
  })
})

describe("mock flags", () => {
  const input = { kind: "IDENTIFIER", targetType: "HCP", targetId: "HCP-NE-01-007", note: "wrong NPI" } as const

  it("stores a flag as open and lists it newest first", async () => {
    const a = make("u-msl-ne-01")
    const flag = await a.flagIssue(ctx, input)
    expect(flag.status).toBe("OPEN")
    await a.flagIssue(ctx, { kind: "SUMMARY", targetType: "SUMMARY", targetId: "brief:1" })
    const all = await a.myFlags(ctx)
    expect(all.map((f) => f.targetId)).toEqual(["brief:1", "HCP-NE-01-007"])
  })

  it("returns the existing flag when the same open item is flagged again", async () => {
    const a = make("u-msl-ne-01")
    const first = await a.flagIssue(ctx, input)
    expect((await a.flagIssue(ctx, { ...input, note: "again" })).flagId).toBe(first.flagId)
    expect(await a.myFlags(ctx)).toHaveLength(1)
  })

  it("keeps flags private to their owner", async () => {
    await make("u-msl-ne-01").flagIssue(ctx, input)
    expect(await make("u-msl-se-03").myFlags(ctx)).toEqual([])
  })

  it("rejects malformed targets", async () => {
    await expect(make("u-msl-ne-01").flagIssue(ctx, { ...input, targetId: "has space" })).rejects.toMatchObject({ code: "BAD_REQUEST" })
  })
})

describe("graphql adapter: activity and flags", () => {
  it("omits an empty note from the mutation input and maps BadRequest", async () => {
    const seen: { variables?: Record<string, unknown> }[] = []
    const transport: GraphQLTransport = async (req) => {
      seen.push(req)
      return { errors: [{ errorType: "BadRequest", message: "BadRequest: the request arguments are invalid." }] }
    }
    const adapter = createGraphQLAdapter(transport)
    const err = await adapter.flagIssue(ctx, { kind: "SUMMARY", targetType: "SUMMARY", targetId: "brief:1" }).catch((e) => e)
    expect(err).toMatchObject({ code: "BAD_REQUEST" })
    expect(seen[0]).toMatchObject({ query: FLAG_ISSUE_MUTATION })
    expect(seen[0].variables).toEqual({ input: { kind: "SUMMARY", targetType: "SUMMARY", targetId: "brief:1" } })
  })
})
