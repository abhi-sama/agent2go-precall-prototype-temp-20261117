import { addDays, addMonths, daysInRange, todayIso, weekdaysInRange } from "@/lib/dates"
import { log } from "@/lib/log/logger"
import type { DataAdapter } from "./adapter"
import { findUser, fixtureHash, TERRITORIES, REGIONS, type FixtureTerritory } from "./fixtures"
import {
  DataError,
  type ActivityEvidence,
  type ActivityMonth,
  type ActivityTrends,
  type DateRange,
  type EvidenceRecord,
  type Flag,
  type IsoDate,
  type GeoActivity,
  type GeoCountry,
  type GeoTerritory,
  type LandingKpis,
  type Me,
  type RequestContext,
} from "./types"

export type MockScenario = "ok" | "empty" | "error" | "forbidden" | "slow" | "stale"

const SCENARIOS: readonly MockScenario[] = ["ok", "empty", "error", "forbidden", "slow", "stale"]

/** `?scenario=` is honoured only in local builds, so tests and demos can force each UI state. */
export function readScenario(search: string | undefined): MockScenario {
  if (!search) return "ok"
  const value = new URLSearchParams(search).get("scenario")
  return SCENARIOS.includes(value as MockScenario) ? (value as MockScenario) : "ok"
}

export interface MockAdapterOptions {
  getUserId: () => string
  /** Override for tests; defaults to the live URL query. */
  getScenario?: () => MockScenario
  /** Base latency in ms (0 in unit tests). */
  latencyMs?: number
  now?: () => Date
}

function metricsFor(t: FixtureTerritory, range: DateRange) {
  const workdays = weekdaysInRange(range)
  const calls = Math.round(t.callsPerWorkday * workdays)
  // Engaged HCPs saturate toward the territory pool: repeat calls to the same HCP count once.
  const hcps = Math.min(t.hcpPool, Math.round(t.hcpPool * (1 - Math.exp((-calls / (t.hcpPool * 1.6))))))
  const responses = Math.round(calls * t.responsesPerCall)
  return { calls, hcps, responses }
}

/** Synthetic channel split; the BE reports whatever `call_chnl` values the source holds. */
const MOCK_CHANNELS = [
  { channel: "in_person", share: 0.6 },
  { channel: "virtual", share: 0.3 },
  { channel: "phone", share: 0.1 },
] as const

const monthEnd = (first: IsoDate): IsoDate => addDays(addMonths(first, 1), -1)

/** Smallest group an aggregate-only viewer is shown (matches the API). */
export const GEO_MIN_CELL = 5

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Flags live per user for the life of the page, like the FE DynamoDB table does for real. */
const MOCK_FLAGS = new Map<string, Flag[]>()

export function resetMockFlags() {
  MOCK_FLAGS.clear()
}

export function createMockAdapter(options: MockAdapterOptions): DataAdapter {
  const latency = options.latencyMs ?? 450
  const now = options.now ?? (() => new Date())
  const scenario = () =>
    options.getScenario?.() ?? readScenario(typeof window === "undefined" ? undefined : window.location.search)

  async function gate(ctx: RequestContext, operation: string) {
    const s = scenario()
    log.child(ctx.correlationId).info("data request", { operation, adapter: "mock", scenario: s })
    await sleep(s === "slow" ? Math.max(latency, 2500) : latency)
    if (s === "error") {
      throw new DataError("UNAVAILABLE", "The data service is unavailable.", ctx.correlationId)
    }
    return s
  }

  function resolveRange(range?: Partial<DateRange>): DateRange {
    const to = range?.to ?? todayIso(now())
    const from = range?.from ?? addDays(to, -29)
    return daysInRange({ from, to }) < 1 ? { from: to, to: from } : { from, to }
  }

  function dataThrough(s: MockScenario): string {
    const base = now()
    // Loads land early morning UTC; "stale" simulates a failed nightly load nine days ago.
    const daysBack = s === "stale" ? 9 : 1
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() - daysBack, 5, 30))
    return d.toISOString()
  }

  return {
    kind: "mock",

    async me(ctx): Promise<Me> {
      await gate(ctx, "me")
      const u = findUser(options.getUserId())
      return { userId: u.userId, fullName: u.fullName, email: u.email, persona: u.persona, scopeLabel: u.scopeLabel }
    },

    async landingKpis(ctx, partial): Promise<LandingKpis> {
      const s = await gate(ctx, "landingKpis")
      const user = findUser(options.getUserId())
      if (s === "forbidden" || user.persona === "admin") {
        throw new DataError("FORBIDDEN", "You do not have access to this data.", ctx.correlationId)
      }
      if (user.territoryIds.length === 0) {
        throw new DataError("NO_SCOPE", "No territory is assigned to your account.", ctx.correlationId)
      }
      const range = resolveRange(partial)
      const totals = { calls: 0, hcps: 0, responses: 0 }
      if (s !== "empty") {
        for (const t of TERRITORIES.filter((x) => user.territoryIds.includes(x.id))) {
          const m = metricsFor(t, range)
          totals.calls += m.calls
          totals.hcps += m.hcps
          totals.responses += m.responses
        }
      }
      return {
        distinctCalls: totals.calls,
        distinctEngagedHcps: totals.hcps,
        responseCount: totals.responses,
        from: range.from,
        to: range.to,
        dataThrough: dataThrough(s),
        scopeLabel: user.scopeLabel,
      }
    },

    async geoActivity(ctx, partial): Promise<GeoActivity> {
      const s = await gate(ctx, "geoActivity")
      const user = findUser(options.getUserId())
      if (s === "forbidden" || user.persona === "admin") {
        throw new DataError("FORBIDDEN", "You do not have access to this data.", ctx.correlationId)
      }
      if (user.territoryIds.length === 0) {
        throw new DataError("NO_SCOPE", "No territory is assigned to your account.", ctx.correlationId)
      }
      const range = resolveRange(partial)
      // Like the API: only in-scope territories exist in the response, and an aggregate-only
      // persona (executive) never sees a small group.
      const aggregateOnly = user.persona === "executive"
      const inScope = TERRITORIES.filter((t) => user.territoryIds.includes(t.id))
      const calls = new Map(inScope.map((t) => [t.id, s === "empty" ? 0 : metricsFor(t, range).calls]))
      const hide = (n: number) => aggregateOnly && n < GEO_MIN_CELL

      const territories: GeoTerritory[] = inScope.map((t) => ({
        territoryId: t.id,
        name: t.name,
        regionId: t.regionId,
        regionName: REGIONS.find((r) => r.id === t.regionId)?.name ?? t.regionId,
        countryCode: t.countryCode,
        countryName: t.countryName,
        subdivisionCode: t.subdivisionCode,
        subdivisionName: t.subdivisionName,
        latitude: t.latitude,
        longitude: t.longitude,
        isOwn: user.persona === "msl",
        distinctCalls: hide(calls.get(t.id)!) ? null : calls.get(t.id)!,
        suppressed: hide(calls.get(t.id)!),
      }))
      const countries: GeoCountry[] = [...new Set(inScope.map((t) => t.countryCode))].sort().map((code) => {
        const members = inScope.filter((t) => t.countryCode === code)
        const total = members.reduce((n, t) => n + calls.get(t.id)!, 0)
        // Hide a country total when any part of it is hidden, so a hidden part cannot be subtracted back out.
        const suppressed = hide(total) || members.some((t) => hide(calls.get(t.id)!))
        return {
          countryCode: code,
          countryName: members[0].countryName,
          territoryCount: members.length,
          distinctCalls: suppressed ? null : total,
          suppressed,
        }
      })
      return { from: range.from, to: range.to, dataThrough: dataThrough(s), scopeLabel: user.scopeLabel, territories, countries }
    },

    async activityTrends(ctx, months = 12): Promise<ActivityTrends> {
      const s = await gate(ctx, "activityTrends")
      const user = findUser(options.getUserId())
      if (s === "forbidden" || user.persona === "admin" || user.persona === "executive") {
        throw new DataError("FORBIDDEN", "You do not have access to this data.", ctx.correlationId)
      }
      if (user.territoryIds.length === 0) {
        throw new DataError("NO_SCOPE", "No territory is assigned to your account.", ctx.correlationId)
      }
      const through = dataThrough(s)
      const throughDay = through.slice(0, 10)
      const lastMonth = `${throughDay.slice(0, 7)}-01`
      const territories = TERRITORIES.filter((x) => user.territoryIds.includes(x.id))
      const series: ActivityMonth[] = []
      for (let i = months - 1; i >= 0; i--) {
        const month = addMonths(lastMonth, -i)
        const range = { from: month, to: monthEnd(month) < throughDay ? monthEnd(month) : throughDay }
        let calls = 0
        let hcps = 0
        if (s !== "empty") {
          for (const t of territories) {
            const m = metricsFor(t, range)
            calls += m.calls
            hcps += m.hcps
          }
        }
        series.push({
          month,
          distinctCalls: calls,
          distinctEngagedHcps: hcps,
          isPartial: monthEnd(month) > throughDay,
          channels: calls
            ? MOCK_CHANNELS.map((c) => ({ channel: c.channel, distinctCalls: Math.round(calls * c.share) }))
            : [],
        })
      }
      const totalCalls = series.reduce((a, m) => a + m.distinctCalls, 0)
      // Distinct HCPs across the window saturate: they are not the sum of the months.
      const pool = territories.reduce((a, t) => a + t.hcpPool, 0)
      const totalHcps = Math.min(pool, Math.round(series.reduce((a, m) => a + m.distinctEngagedHcps, 0) * 0.62))
      return {
        from: series[0].month,
        to: monthEnd(series[series.length - 1].month),
        months: series,
        channels: totalCalls ? MOCK_CHANNELS.map((c) => c.channel) : [],
        totalDistinctCalls: totalCalls,
        totalDistinctEngagedHcps: totalHcps,
        dataThrough: through,
        scopeLabel: user.scopeLabel,
      }
    },

    async activityEvidence(ctx, query): Promise<ActivityEvidence> {
      const s = await gate(ctx, "activityEvidence")
      const user = findUser(options.getUserId())
      if (s === "forbidden" || user.persona === "admin" || user.persona === "executive") {
        throw new DataError("FORBIDDEN", "You do not have access to this data.", ctx.correlationId)
      }
      const limit = Math.min(Math.max(query.limit ?? 50, 1), 100)
      const month = `${query.month.slice(0, 7)}-01`
      const through = dataThrough(s)
      const throughDay = through.slice(0, 10)
      const territories = TERRITORIES.filter((x) => user.territoryIds.includes(x.id))
      const range = { from: month, to: monthEnd(month) < throughDay ? monthEnd(month) : throughDay }
      let total = 0
      if (s !== "empty" && range.from <= range.to) {
        for (const t of territories) {
          const m = metricsFor(t, range)
          total += query.metric === "CALLS" ? m.calls : m.hcps
        }
        if (query.channel) {
          const share = MOCK_CHANNELS.find((c) => c.channel === query.channel)?.share ?? 0
          total = Math.round(total * share)
        }
      }
      const records: EvidenceRecord[] = []
      const days = Math.max(1, daysInRange(range))
      for (let i = 0; i < Math.min(total, limit); i++) {
        const seed = `${user.userId}:${query.metric}:${month}:${query.channel ?? "all"}:${i}`
        const t = territories[Math.floor(fixtureHash(`${seed}:t`) * territories.length)] ?? territories[0]
        const interaction = addDays(range.to, -Math.floor((i * days) / Math.max(total, 1)))
        // Records land one to three days after the exchange, but never after data-through.
        const lag = 1 + Math.floor(fixtureHash(`${seed}:lag`) * 3)
        const loadedDay = addDays(interaction, lag) < throughDay ? addDays(interaction, lag) : throughDay
        const hcpNumber = 1 + Math.floor(fixtureHash(`${seed}:h`) * t.hcpPool)
        const hcpId = `HCP-${t.id}-${String(hcpNumber).padStart(3, "0")}`
        records.push({
          recordId: query.metric === "CALLS" ? `CALL-${t.id}-${month.slice(2, 4)}${month.slice(5, 7)}-${String(i + 1).padStart(3, "0")}` : hcpId,
          kind: query.metric === "CALLS" ? "CALL" : "HCP",
          hcpId,
          hcpName: `Synthetic HCP ${hcpNumber}`,
          territoryId: t.id,
          channel: query.metric === "CALLS" ? (query.channel ?? MOCK_CHANNELS[i % 3].channel) : null,
          callCount: query.metric === "CALLS" ? 1 : 1 + Math.floor(fixtureHash(`${seed}:c`) * 3),
          interactionDate: interaction,
          loadedAt: `${loadedDay}T05:30:00.000Z`,
        })
      }
      records.sort((a, b) => b.interactionDate.localeCompare(a.interactionDate))
      return {
        metric: query.metric,
        month,
        channel: query.channel ?? null,
        total,
        truncated: total > records.length,
        latestInteractionDate: records[0]?.interactionDate ?? null,
        latestLoadedAt: records.map((r) => r.loadedAt).filter(Boolean).sort().at(-1) ?? null,
        dataThrough: through,
        scopeLabel: user.scopeLabel,
        records,
      }
    },

    async myFlags(ctx): Promise<Flag[]> {
      await gate(ctx, "myFlags")
      return [...(MOCK_FLAGS.get(options.getUserId()) ?? [])]
    },

    async flagIssue(ctx, input): Promise<Flag> {
      await gate(ctx, "flagIssue")
      const note = input.note?.trim() || null
      if ((note?.length ?? 0) > 500 || !/^[A-Za-z0-9][A-Za-z0-9:_.-]{0,127}$/.test(input.targetId)) {
        throw new DataError("BAD_REQUEST", "That request was not accepted.", ctx.correlationId)
      }
      const user = findUser(options.getUserId())
      const flags = MOCK_FLAGS.get(user.userId) ?? []
      const open = flags.find(
        (f) =>
          (f.status === "OPEN" || f.status === "IN_REVIEW") &&
          f.kind === input.kind &&
          f.targetType === input.targetType &&
          f.targetId === input.targetId,
      )
      if (open) return open
      const stamp = now().toISOString()
      const flag: Flag = {
        flagId: `flag-${flags.length + 1}-${stamp}`,
        kind: input.kind,
        targetType: input.targetType,
        targetId: input.targetId,
        note,
        status: "OPEN",
        createdAt: stamp,
        updatedAt: stamp,
        scopeLabel: user.scopeLabel,
        dataThrough: dataThrough("ok"),
      }
      MOCK_FLAGS.set(user.userId, [flag, ...flags])
      return flag
    },
  }
}
