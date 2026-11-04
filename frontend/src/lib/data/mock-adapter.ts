import { addDays, daysInRange, todayIso, weekdaysInRange } from "@/lib/dates"
import { log } from "@/lib/log/logger"
import type { DataAdapter } from "./adapter"
import { findUser, TERRITORIES, REGIONS, type FixtureTerritory } from "./fixtures"
import {
  DataError,
  type DateRange,
  type LandingKpis,
  type Me,
  type RequestContext,
  type TerritoryActivity,
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

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

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

    async territoryActivity(ctx, partial): Promise<TerritoryActivity[]> {
      const s = await gate(ctx, "territoryActivity")
      const user = findUser(options.getUserId())
      if (s === "forbidden" || user.persona === "admin") {
        throw new DataError("FORBIDDEN", "You do not have access to this data.", ctx.correlationId)
      }
      const range = resolveRange(partial)
      return TERRITORIES.map((t) => {
        const inScope = user.territoryIds.includes(t.id)
        const m = inScope && s !== "empty" ? metricsFor(t, range) : { calls: 0, hcps: 0, responses: 0 }
        return {
          territoryId: t.id,
          name: t.name,
          regionId: t.regionId,
          regionName: REGIONS.find((r) => r.id === t.regionId)?.name ?? t.regionId,
          col: t.col,
          row: t.row,
          inScope,
          isOwn: user.persona === "msl" && inScope,
          distinctCalls: m.calls,
          distinctEngagedHcps: m.hcps,
          responseCount: m.responses,
        }
      })
    },
  }
}
