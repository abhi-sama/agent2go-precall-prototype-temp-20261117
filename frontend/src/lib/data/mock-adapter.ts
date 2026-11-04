import { addDays, addMonths, daysInRange, todayIso, weekdaysInRange } from "@/lib/dates"
import { log } from "@/lib/log/logger"
import type { DataAdapter } from "./adapter"
import { createMockDirectorInsights, mockHcpTerritory } from "./mock-director-insights"
import { createMockEvals } from "./mock-evals"
import { createMockGovernance } from "./governance"
import { buildComparison, buildOverview, tooLong } from "./mock-director"
import { buildExecutiveDrilldown, buildExecutiveOverview, defaultExecutiveRange, executiveWindowTooLong, type ExecutiveInput } from "./mock-executive"
import { findUser, fixtureHash, TERRITORIES, REGIONS, type FixtureTerritory } from "./fixtures"
import { mockCitation, readRun, scriptRun } from "./mock-chat"
import { createMockBriefs } from "./mock-briefs"
import { createMockExecutiveThemes, type ThemesInput } from "./mock-executive-themes"
import {
  type AccessAuditEvent, type AccessAuditFilter, type AdminAccessOverview,
  type AdminDataQuality,
  DataError,
  type ActivityEvidence,
  type ActivityMonth,
  type ActivityTrends,
  type DateRange,
  type DirectorOverview,
  type ExecutiveDrilldown,
  type ExecutiveOverview,
  type TerritoryComparison,
  type EvidenceRecord,
  type Flag,
  type IsoDate,
  type GeoActivity,
  type GeoCountry,
  type GeoTerritory,
  type LandingKpis,
  type Me,
  type RequestContext,
  type RolePermissionMatrix, type ScopeAssignment, type ScopeAssignmentInput,
  type HcpProfile,
  type HcpSearchResult,
  type HcpTimeline,
  type InsightDiscovery,
  type InsightFilters,
  type SavedView,
  type PostCallDraft,
  type FollowUpTask,
  type ConfirmFollowUpTaskInput,
  type TopicAlertRule,
  type TopicAlert,
} from "./types"

/**
 * `targets` is `ok` plus an approved target population for two territories, so coverage can be shown.
 * `records` is `ok` plus explicit record-level permission for an Executive, so nothing is withheld and drill-down opens.
 * `scope-changed` is `ok` except that saved leadership summaries can no longer be opened or exported (the Executive's scope changed).
 */
export type MockScenario = "ok" | "empty" | "error" | "forbidden" | "slow" | "stale" | "targets" | "records" | "scope-changed"

const SCENARIOS: readonly MockScenario[] = ["ok", "empty", "error", "forbidden", "slow", "stale", "targets", "records", "scope-changed"]

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

const ADMIN: AdminAccessOverview = { identityMatches:[{userId:"u-admin-sec",displayName:"Sofia Alvarez",identityStatus:"matched",rosterSourceRowId:"101",rosterName:"Sofia Alvarez",exactEmailCandidateCount:1,candidateRosterSourceRowIds:["101"],flag:"matched"},{userId:"u-review",displayName:"Duplicate roster candidate",identityStatus:"unresolved",rosterSourceRowId:null,rosterName:null,exactEmailCandidateCount:2,candidateRosterSourceRowIds:["209","266"],flag:"conflicting"}], availablePermissions:[{permissionCode:"source.records.read",description:"Read source records"},{permissionCode:"catalog.read",description:"Read catalog"},{permissionCode:"aggregate.read",description:"Read aggregates"},{permissionCode:"admin.manage",description:"Manage governance"}], roleMatrix:[{roleId:"msl",roleName:"MSL field role",permissions:[{permissionCode:"source.records.read",description:"Read source records"}]},{roleId:"administrator",roleName:"Data security administrator",permissions:[{permissionCode:"admin.manage",description:"Manage governance"}]}], scopeAssignments:[{assignmentId:"19",userId:"u-review",displayName:"Duplicate roster candidate",territoryId:"UNRESOLVED-01",assignmentType:"temporary",effectiveFrom:"2026-10-01T00:00:00Z",effectiveTo:null,unresolvedTerritory:true}] }
const ADMIN_AUDIT: AccessAuditEvent[]=[{eventId:"901",actorUserId:"u-admin-sec",action:"scope_assignment.created",resourceType:"user_scope_assignment",resourceId:"19",outcome:"scheduled",occurredAt:"2026-11-03T14:20:00Z"}]

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
  const admin = structuredClone(ADMIN); const audit = [...ADMIN_AUDIT]

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

  function directorInput(ctx: RequestContext, s: MockScenario, range?: Partial<DateRange>) {
    const user = findUser(options.getUserId())
    if (s === "forbidden" || (user.persona !== "director" && user.persona !== "admin")) {
      throw new DataError("FORBIDDEN", "You do not have access to this data.", ctx.correlationId)
    }
    if (user.territoryIds.length === 0) throw new DataError("NO_SCOPE", "No territory is assigned to your account.", ctx.correlationId)
    const resolved = resolveRange(range ?? { from: addDays(todayIso(now()), -89) })
    if (tooLong(resolved)) throw new DataError("BAD_REQUEST", "That request was not accepted.", ctx.correlationId)
    const through = dataThrough(s)
    return {
      territories: TERRITORIES.filter((x) => user.territoryIds.includes(x.id)),
      range: resolved,
      throughDay: through.slice(0, 10),
      dataThrough: through,
      scopeLabel: user.scopeLabel,
      metricsFor,
      empty: s === "empty",
      withTargets: s === "targets",
    }
  }

  function executiveInput(ctx: RequestContext, s: MockScenario, range?: Partial<DateRange>, rankBy: ExecutiveInput["rankBy"] = "CALLS"): ExecutiveInput {
    const user = findUser(options.getUserId())
    if (s === "forbidden" || user.persona !== "executive") {
      throw new DataError("FORBIDDEN", "You do not have access to this data.", ctx.correlationId)
    }
    if (user.territoryIds.length === 0) throw new DataError("NO_SCOPE", "No territory is assigned to your account.", ctx.correlationId)
    const through = dataThrough(s)
    const fallback = defaultExecutiveRange(through.slice(0, 10))
    const resolved: DateRange = { from: range?.from ?? fallback.from, to: range?.to ?? fallback.to }
    if (resolved.from > resolved.to || executiveWindowTooLong(resolved)) {
      throw new DataError("BAD_REQUEST", "That request was not accepted.", ctx.correlationId)
    }
    return {
      territories: TERRITORIES.filter((x) => user.territoryIds.includes(x.id)),
      range: resolved,
      throughDay: through.slice(0, 10),
      dataThrough: through,
      scopeLabel: user.scopeLabel,
      metricsFor,
      empty: s === "empty",
      records: s === "records",
      rankBy,
      withTargets: s === "targets",
    }
  }

  function themesInput(ctx: RequestContext, s: MockScenario, range?: Partial<DateRange>): ThemesInput {
    const user = findUser(options.getUserId())
    if (s === "forbidden" || user.persona !== "executive") {
      throw new DataError("FORBIDDEN", "You do not have access to this data.", ctx.correlationId)
    }
    if (user.territoryIds.length === 0) throw new DataError("NO_SCOPE", "No territory is assigned to your account.", ctx.correlationId)
    const through = dataThrough(s)
    const to = range?.to ?? through.slice(0, 10)
    const resolved: DateRange = { from: range?.from ?? addDays(to, -89), to }
    if (resolved.from > resolved.to || daysInRange(resolved) > 731) throw new DataError("BAD_REQUEST", "That request was not accepted.", ctx.correlationId)
    return {
      territories: TERRITORIES.filter((x) => user.territoryIds.includes(x.id)),
      range: resolved,
      dataThrough: through,
      scopeLabel: user.scopeLabel,
      records: s === "records",
      empty: s === "empty",
    }
  }

  /** `HCP-0001` is the profile-card fixture; the rest are the HCPs the Director drill-down lists, per territory. */
  const hcpInScope = (hcpId: string) => {
    const user = findUser(options.getUserId())
    const territory = hcpId === "HCP-0001" ? "NE-01" : mockHcpTerritory(hcpId)
    return territory !== null && user.territoryIds.includes(territory)
  }

  const saved: SavedView[] = []
  const drafts: PostCallDraft[] = []
  const tasks: FollowUpTask[] = []
  const alertRules: TopicAlertRule[] = []
  const discoveryOptions: InsightDiscovery["options"] = {
    territories: TERRITORIES.map((t) => ({ value: t.id, label: t.name })),
    molecules: ["trastuzumab deruxtecan", "osimertinib", "pembrolizumab", "sacituzumab govitecan"].map((value) => ({ value, label: value })),
    landscapes: [{ value: "treatment landscape", label: "Treatment landscape" }],
    studies: ["DESTINY-Breast06", "FLAURA2", "KEYNOTE-671", "TROPiCS-02"].map((value) => ({ value, label: value })),
    surveys: [{ value: "MSL pulse", label: "MSL pulse" }],
    questions: [1, 2, 3, 4].map((n) => ({ value: `Q-${String(n).padStart(4, "0")}`, label: `Question ${n}: treatment discussion` })),
  }
  const rows = [
    { questionId: "Q-0001", questionText: "How does trastuzumab deruxtecan fit in breast cancer discussion?", parentQuestionId: null, response: "Evidence and access are important.", count: 18, denominator: 32 },
    { questionId: "Q-0001", questionText: "How does trastuzumab deruxtecan fit in breast cancer discussion?", parentQuestionId: null, response: "Need more practical guidance.", count: 9, denominator: 32 },
    { questionId: "Q-0001", questionText: "How does trastuzumab deruxtecan fit in breast cancer discussion?", parentQuestionId: null, response: "No perspective recorded.", count: 5, denominator: 32 },
    { questionId: "Q-0002", questionText: "How does osimertinib fit in lung cancer discussion?", parentQuestionId: "Q-0001", response: "Evidence and access are important.", count: 11, denominator: 20 },
    { questionId: "Q-0002", questionText: "How does osimertinib fit in lung cancer discussion?", parentQuestionId: "Q-0001", response: "Need more practical guidance.", count: 9, denominator: 20 },
  ]
  const questions = [
    { questionId: "Q-0001", questionText: "How does trastuzumab deruxtecan fit in breast cancer discussion?", topic: "Oncology", molecule: "trastuzumab deruxtecan", tumorType: "breast cancer", study: "DESTINY-Breast06", survey: "MSL pulse", status: "Active", effectiveFrom: "2025-01-01T00:00:00Z", effectiveTo: null, applicability: "Active for oncology insight collection" },
    { questionId: "Q-0002", questionText: "How does osimertinib fit in lung cancer discussion?", topic: "Oncology", molecule: "osimertinib", tumorType: "non-small cell lung cancer", study: "FLAURA2", survey: "MSL pulse", status: "Active", effectiveFrom: "2025-01-01T00:00:00Z", effectiveTo: null, applicability: "Follow-up question; use with parent context" },
    { questionId: "Q-0003", questionText: "How does pembrolizumab fit in gastric cancer discussion?", topic: "Oncology", molecule: "pembrolizumab", tumorType: "gastric cancer", study: "KEYNOTE-671", survey: "MSL pulse", status: "Retired", effectiveFrom: "2025-01-01T00:00:00Z", effectiveTo: "2026-09-30T00:00:00Z", applicability: "Historical only; no longer active" },
  ]
  const matches = (filters: InsightFilters | undefined, value: string | null | undefined, key: keyof InsightFilters) => !filters?.[key] || filters[key] === value

  return {
    kind: "mock",
    ...createMockGovernance({ getUser: () => findUser(options.getUserId()), gate, now }),
    ...createMockEvals({ getUser: () => findUser(options.getUserId()), gate, now }),
    ...createMockBriefs({ user: () => findUser(options.getUserId()), scenario, gate, now }),
    ...createMockDirectorInsights({ getUser: () => findUser(options.getUserId()), gate, now }),
    ...createMockExecutiveThemes({ user: () => findUser(options.getUserId()), scenario, gate, input: themesInput, now }),

    async me(ctx): Promise<Me> {
      await gate(ctx, "me")
      const u = findUser(options.getUserId())
      return { userId: u.userId, fullName: u.fullName, email: u.email, persona: u.persona, scopeLabel: u.scopeLabel }
    },

    async landingKpis(ctx, partial, filters): Promise<LandingKpis> {
      const s = await gate(ctx, "landingKpis")
      const user = findUser(options.getUserId())
      if (s === "forbidden" || user.persona === "admin") {
        throw new DataError("FORBIDDEN", "You do not have access to this data.", ctx.correlationId)
      }
      if (user.territoryIds.length === 0) {
        throw new DataError("NO_SCOPE", "No territory is assigned to your account.", ctx.correlationId)
      }
      const range = resolveRange({ ...partial, from: filters?.from ?? partial?.from, to: filters?.to ?? partial?.to })
      const totals = { calls: 0, hcps: 0, responses: 0 }
      if (s !== "empty") {
        for (const t of TERRITORIES.filter((x) => user.territoryIds.includes(x.id) && (!filters?.territoryId || filters.territoryId === x.id))) {
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

    async geoActivity(ctx, partial, filters): Promise<GeoActivity> {
      const s = await gate(ctx, "geoActivity")
      const user = findUser(options.getUserId())
      if (s === "forbidden" || user.persona === "admin") {
        throw new DataError("FORBIDDEN", "You do not have access to this data.", ctx.correlationId)
      }
      if (user.territoryIds.length === 0) {
        throw new DataError("NO_SCOPE", "No territory is assigned to your account.", ctx.correlationId)
      }
      const range = resolveRange({ ...partial, from: filters?.from ?? partial?.from, to: filters?.to ?? partial?.to })
      // Like the API: only in-scope territories exist in the response, and an aggregate-only
      // persona (executive) never sees a small group.
      const aggregateOnly = user.persona === "executive"
      const inScope = TERRITORIES.filter((t) => user.territoryIds.includes(t.id) && (!filters?.territoryId || filters.territoryId === t.id))
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

    async directorOverview(ctx, range): Promise<DirectorOverview> {
      const s = await gate(ctx, "directorOverview")
      return buildOverview(directorInput(ctx, s, range))
    },

    async territoryComparison(ctx, territoryIds, range): Promise<TerritoryComparison> {
      const s = await gate(ctx, "territoryComparison")
      const input = directorInput(ctx, s, range)
      const ids = [...new Set(territoryIds)]
      if (ids.length < 2 || ids.length > 6) throw new DataError("BAD_REQUEST", "That request was not accepted.", ctx.correlationId)
      // One refusal for "outside your scope" and "does not exist", as the BE gives.
      if (ids.some((id) => !input.territories.some((t) => t.id === id))) {
        throw new DataError("FORBIDDEN", "You do not have access to this data.", ctx.correlationId)
      }
      return buildComparison(input, ids)
    },

    async executiveOverview(ctx, input): Promise<ExecutiveOverview> {
      const s = await gate(ctx, "executiveOverview")
      return buildExecutiveOverview(executiveInput(ctx, s, input, input?.rankBy ?? "CALLS"))
    },

    async executiveDrilldown(ctx, input): Promise<ExecutiveDrilldown> {
      const s = await gate(ctx, "executiveDrilldown")
      const exec = executiveInput(ctx, s)
      // Record-level permission is separate from aggregate access: no grant, no records.
      if (!exec.records) throw new DataError("FORBIDDEN", "You do not have access to this data.", ctx.correlationId)
      // One refusal for "outside your scope" and "does not exist", as the BE gives.
      const result = buildExecutiveDrilldown(exec, input)
      if (!result) throw new DataError("FORBIDDEN", "You do not have access to this data.", ctx.correlationId)
      return result
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
    async adminAccessOverview(ctx) { await gate(ctx,"adminAccessOverview"); if(findUser(options.getUserId()).persona!=="admin") throw new DataError("FORBIDDEN","No access",ctx.correlationId); return structuredClone(admin) },
    async accessAudit(ctx, filter: AccessAuditFilter={}) { await gate(ctx,"accessAudit"); return audit.filter(x => (!filter.actorUserId||x.actorUserId===filter.actorUserId)&&(!filter.action||x.action===filter.action)&&(!filter.resourceType||x.resourceType===filter.resourceType)&&(!filter.outcome||x.outcome===filter.outcome)) },
    async createScopeAssignment(ctx,input: ScopeAssignmentInput): Promise<ScopeAssignment> { await gate(ctx,"createScopeAssignment"); const row={assignmentId:String(100+admin.scopeAssignments.length),userId:input.userId,displayName:input.userId,territoryId:input.territoryId,assignmentType:input.assignmentType,effectiveFrom:input.effectiveFrom,effectiveTo:input.effectiveTo??null,unresolvedTerritory:false}; admin.scopeAssignments.unshift(row); audit.unshift({eventId:row.assignmentId,actorUserId:options.getUserId(),action:"scope_assignment.created",resourceType:"user_scope_assignment",resourceId:row.assignmentId,outcome:"scheduled",occurredAt:new Date().toISOString()}); return row },
    async setRolePermissions(ctx,input): Promise<RolePermissionMatrix> { await gate(ctx,"setRolePermissions"); const row=admin.roleMatrix.find(x=>x.roleId===input.roleId)!; row.permissions=admin.availablePermissions.filter(x=>input.permissionCodes.includes(x.permissionCode)); return structuredClone(row) },
    async approveIdentityMapping(ctx,input) { await gate(ctx,"approveIdentityMapping"); const row=admin.identityMatches.find(x=>x.userId===input.userId)!; row.rosterSourceRowId=input.rosterSourceRowId;row.rosterName="Approved roster entry";row.identityStatus="matched";row.flag="matched";return structuredClone(row) },
    async startChatRun(ctx, input) {
      const s = await gate(ctx, "startChatRun")
      if (s === "forbidden") throw new DataError("FORBIDDEN", "You do not have access to this data.", ctx.correlationId)
      scriptRun(input.runId, findUser(options.getUserId()), input.message, now().getTime(), input.context)
      return { runId: input.runId, status: "RUNNING" }
    },

    async chatEvents(ctx, runId, after) {
      const page = readRun(runId, after, now().getTime())
      if (!page) throw new DataError("NOT_FOUND", "That run is not available.", ctx.correlationId)
      return page
    },

    async chatCitation(ctx, dataset, recordId) {
      await gate(ctx, "chatCitation")
      const record = mockCitation(dataset, recordId, findUser(options.getUserId()), now(), scenario() === "records")
      if (!record) throw new DataError("NOT_FOUND", "That record is not available in your scope.", ctx.correlationId)
      return record
    },
    async searchHcps(ctx, query): Promise<HcpSearchResult[]> { await gate(ctx, "searchHcps"); const user = findUser(options.getUserId()); return user.territoryIds.includes("NE-01") && query.toLowerCase().includes("call") ? [{ hcpId: "HCP-0001", name: { value: "Call system HCP 0001", state: "PRESENT" }, institution: { value: "Northeast Cancer Center", state: "PRESENT" }, territory: { value: "Boston Metro", state: "PRESENT" } }] : [] },
    async hcpProfile(ctx, hcpId): Promise<HcpProfile> { await gate(ctx, "hcpProfile"); if (!hcpInScope(hcpId)) throw new DataError("FORBIDDEN", "You do not have access to this data.", ctx.correlationId); const p = (v: string | null) => ({ value: v, state: v === null ? "MISSING" as const : "PRESENT" as const }); return { hcpId, name: p("Call system HCP 0001"), specialty: p("Medical oncology"), discipline: p("Oncology"), type: p("HCP"), institution: p("Northeast Cancer Center"), credentials: p(null), territory: p("Boston Metro") } },
    async hcpTimeline(ctx, hcpId): Promise<HcpTimeline> {
      await gate(ctx, "hcpTimeline")
      if (!hcpInScope(hcpId)) throw new DataError("FORBIDDEN", "You do not have access to this data.", ctx.correlationId)
      const parent = { responseId: "insight-mock-parent", interactionId: "INSIGHT-MOCK-1", parentResponseId: null, questionId: "Q-001", question: "What evidence would be most useful?", answer: "Long-term outcomes and access considerations are important.", interactionDate: "2026-10-28", sourceRecordId: "RESP-MOCK-1" }
      const child = { responseId: "insight-mock-child", interactionId: "INSIGHT-MOCK-1", parentResponseId: parent.responseId, questionId: "Q-101", question: "Which access consideration should be discussed first?", answer: "Coverage criteria should be clear for the care team.", interactionDate: "2026-10-28", sourceRecordId: "RESP-MOCK-2" }
      const chain = Array.from({ length: 10 }, (_, index) => ({
        responseId: `insight-mock-deep-${index + 1}`,
        interactionId: "INSIGHT-MOCK-DEEP",
        parentResponseId: index === 0 ? null : `insight-mock-deep-${index}`,
        questionId: `Q-DEEP-${index + 1}`,
        question: `Contextual follow-up ${index + 1}: what should we clarify next?`,
        answer: `Recorded answer ${index + 1} retains the prior interaction context.`,
        interactionDate: "2026-10-26",
        sourceRecordId: `RESP-DEEP-${index + 1}`,
      }))
      const earlier = { responseId: "insight-mock-earlier", interactionId: "INSIGHT-MOCK-0", parentResponseId: null, questionId: "Q-001", question: parent.question, answer: "The team wanted practical evidence for their discussions.", interactionDate: "2026-08-15", sourceRecordId: "RESP-MOCK-0" }
      const unrelated = { responseId: "insight-mock-unrelated", interactionId: "INSIGHT-MOCK-2", parentResponseId: null, questionId: "Q-101", question: child.question, answer: "Scheduling and coverage are separate discussion points.", interactionDate: "2026-07-02", sourceRecordId: "RESP-MOCK-3" }
      return { hcpId, interactions: [{ callId: "CALL-MOCK-1001", interactionDate: "2026-10-30", channels: ["in-person"], types: ["scientific"], statuses: ["completed"], products: ["osimertinib", "pembrolizumab"], topics: ["pre-call planning", "non-small cell lung cancer"], sourceRecordId: "CALL-MOCK-1001" }], responses: [parent, child, ...chain, earlier, unrelated], perspectives: [{ questionId: parent.questionId, question: parent.question, answers: [parent, earlier] }, { questionId: child.questionId, question: child.question, answers: [child, unrelated] }] }
    },
    async insightDiscovery(ctx, filters): Promise<InsightDiscovery> {
      const s = await gate(ctx, "insightDiscovery")
      const user = findUser(options.getUserId())
      if (s === "forbidden") throw new DataError("FORBIDDEN", "You do not have access to this data.", ctx.correlationId)
      const distributions = s === "empty" ? [] : rows
        .filter((row) => matches(filters, row.questionId, "questionId"))
        .filter((row) => !filters?.molecule || (row.questionId === "Q-0001" ? filters.molecule === "trastuzumab deruxtecan" : filters.molecule === "osimertinib"))
        .map((row) => ({ ...row, percentage: (row.count / row.denominator) * 100 }))
      return {
        scopeLabel: user.scopeLabel,
        options: discoveryOptions,
        distributions,
        questions: questions.filter((q) => matches(filters, q.questionId, "questionId") && matches(filters, q.molecule, "molecule") && matches(filters, q.study, "study") && matches(filters, q.survey, "survey")),
        themes: [{ name: "Evidence questions", responseCount: 18, excerpt: "Evidence and access are important.", recordId: "RESP-000001", questionText: "How does treatment fit in discussion?" }],
        followUpTopics: [{ topic: "Explore evidence and access", evidenceCount: 6, excerpt: "Evidence and access are important.", recordId: "RESP-000001" }],
      }
    },
    async semanticInsightSearch(ctx, query) {
      await gate(ctx, "semanticInsightSearch")
      return query.trim().length < 2 ? [] : [{ responseId: "RESP-000001", questionText: "How does treatment fit in discussion?", responseText: "Evidence and access are important.", interactionDate: "2026-10-15", territoryId: "NE-01", score: 0.91 }]
    },
    async savedViews(ctx) {
      await gate(ctx, "savedViews")
      return saved.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },
    async saveView(ctx, input) {
      await gate(ctx, "saveView")
      const name = input.name.trim()
      if (!name) throw new DataError("UNKNOWN", "Name your saved view before saving.", ctx.correlationId)
      const view: SavedView = { savedViewId: `view-${saved.length + 1}`, name, reportKind: input.reportKind, filters: input.filters, createdAt: now().toISOString() }
      saved.unshift(view)
      return view
    },
    async createPostCallDraft(ctx, input) {
      await gate(ctx, "createPostCallDraft")
      const notes = input.notes.trim()
      const structuredLines = notes.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      if (!notes || !structuredLines.length) throw new DataError("BAD_REQUEST", "Enter at least one note before creating a draft.", ctx.correlationId)
      const draft: PostCallDraft = { draftId: `draft-${drafts.length + 1}`, notes, structuredLines, status: "DRAFT", createdAt: now().toISOString() }
      drafts.unshift(draft)
      return draft
    },
    async confirmPostCallDraft(ctx, draftId) {
      await gate(ctx, "confirmPostCallDraft")
      const draft = drafts.find((item) => item.draftId === draftId && item.status === "DRAFT")
      if (!draft) throw new DataError("BAD_REQUEST", "That draft is not available for confirmation.", ctx.correlationId)
      draft.status = "CONFIRMED"
      return { ...draft }
    },
    async postCallDrafts(ctx) { await gate(ctx, "postCallDrafts"); return [...drafts] },
    async confirmFollowUpTasks(ctx, input: ConfirmFollowUpTaskInput[]) {
      await gate(ctx, "confirmFollowUpTasks")
      const user = findUser(options.getUserId())
      if (!input.length) throw new DataError("BAD_REQUEST", "Select a task to confirm.", ctx.correlationId)
      const confirmed = input.map((item) => {
        const description = item.description.trim()
        if (!description) throw new DataError("BAD_REQUEST", "A task needs a description.", ctx.correlationId)
        const task: FollowUpTask = { taskId: `task-${tasks.length + 1}`, description, ownerUserId: user.userId, dueDate: item.dueDate ?? null, status: "OPEN", sourceDraftId: item.sourceDraftId ?? null, createdAt: now().toISOString() }
        tasks.unshift(task)
        return task
      })
      return confirmed
    },
    async myFollowUpTasks(ctx) { await gate(ctx, "myFollowUpTasks"); return [...tasks] },
    async createTopicAlertRule(ctx, input) {
      await gate(ctx, "createTopicAlertRule")
      if (input.topic.trim().length < 2 || input.threshold < 1 || input.periodDays < 1) throw new DataError("BAD_REQUEST", "Complete the alert rule before saving.", ctx.correlationId)
      const rule: TopicAlertRule = { ruleId: `alert-${alertRules.length + 1}`, topic: input.topic.trim(), threshold: input.threshold, periodDays: input.periodDays, createdAt: now().toISOString() }
      alertRules.unshift(rule)
      return rule
    },
    async topicAlertRules(ctx) { await gate(ctx, "topicAlertRules"); return [...alertRules] },
    async topicAlerts(ctx) {
      await gate(ctx, "topicAlerts")
      // Mirrors the API contract: deterministic fixture counts and response-id evidence only.
      return alertRules.map((rule) => ({ ruleId: rule.ruleId, topic: rule.topic, threshold: rule.threshold, periodDays: rule.periodDays, count: rule.topic.toLowerCase().includes("evidence") ? rule.threshold + 2 : 0, evidenceResponseIds: rule.topic.toLowerCase().includes("evidence") ? ["RESP-000001", "RESP-000017", "RESP-000024"] : [] })).filter((alert) => alert.count >= alert.threshold) satisfies TopicAlert[]
    },
    async adminDataQuality(ctx): Promise<AdminDataQuality> {
      const s = await gate(ctx, "adminDataQuality")
      const user = findUser(options.getUserId())
      if (s === "forbidden" || user.persona !== "admin") throw new DataError("FORBIDDEN", "You do not have access to this data.", ctx.correlationId)
      return { ingestionRuns: [{ runId: "run-failed", sourceId: "question-tag", sourceName: "Question tag", status: "failed", startedAt: "2026-11-03T09:00:00Z", completedAt: "2026-11-03T09:01:00Z", recordsLoaded: 0, errorSummary: "Synthetic source delivery failure" }, { runId: "run-current", sourceId: "call-activity", sourceName: "Call Activity", status: "completed", startedAt: "2026-11-03T08:00:00Z", completedAt: "2026-11-03T08:30:00Z", recordsLoaded: 25000, errorSummary: null }, { runId: "run-stale", sourceId: "hcp-insights", sourceName: "HCP Raw Insights", status: "stale", startedAt: "2025-01-01T08:00:00Z", completedAt: "2025-01-01T08:30:00Z", recordsLoaded: 60000, errorSummary: null }], identities: { matched: 35, unmatched: 1 }, duplicateKeyCount: 1, recordGrain: { callProductRows: 25000, distinctCalls: 12500 }, issues: [{ issueId: "duplicate-response-keys", category: "duplicate_key", severity: "high", title: "Duplicate response keys", summary: "Responses share a uniq_rspns_id and need reconciliation before relying on row grain.", affectedCount: 1, records: [{ recordId: "hcp_raw_insights:INT-000001", sourceTable: "hcp_raw_insights", sourceRecordId: "INT-000001", label: "Response key RESP-000001" }, { recordId: "hcp_raw_insights:INT-060000", sourceTable: "hcp_raw_insights", sourceRecordId: "INT-060000", label: "Response key RESP-000001" }] }, { issueId: "missing-question-parents", category: "invalid_parent", severity: "high", title: "Questions with missing parents", summary: "These follow-up questions point to a parent that is not in the catalog.", affectedCount: 1, records: [{ recordId: "question_tag:Q-0100", sourceTable: "question_tag", sourceRecordId: "Q-0100", label: "Question Q-0100" }] }, { issueId: "unmatched-identities", category: "unresolved_identity", severity: "warning", title: "Unmatched login-to-user mappings", summary: "These logins have no approved matched identity.", affectedCount: 1, records: [{ recordId: "users:admin-region-04", sourceTable: "users", sourceRecordId: "admin-region-04", label: "Unmatched login admin-region-04" }] }], questionGraph: { missingParentCount: 1, duplicateKeyCount: 0, cycleCount: 0, nodes: [{ questionId: "Q-0100", parentQuestionId: "Q-NOT-IN-CATALOG", state: "missing_parent" }] } }
    },
    async authorizationVerificationGrid(ctx) {
      const s = await gate(ctx, "authorizationVerificationGrid")
      const user = findUser(options.getUserId())
      if (s === "forbidden" || user.persona !== "admin") throw new DataError("FORBIDDEN", "You do not have access to this data.", ctx.correlationId)
      const paths = ["API search", "Dashboards", "Chat retrieval", "Vector search", "Saved outputs", "Offline caches", "Exports", "Drill-down"]
      const scenarios = [
        ["in_scope", "Only records in the active scope are returned."],
        ["out_of_scope", "An out-of-scope record is refused without confirming it exists."],
        ["after_transfer", "The prior territory closes immediately when a transfer takes effect."],
        ["coverage_expired", "Temporary coverage closes at its effective end time."],
      ] as const
      const results = ["MSL", "Director", "Executive", "Administrator"].flatMap((persona) => paths.flatMap((accessPath) => scenarios.map(([scopeScenario, expectation]) => ({ testId: `authorization-grid::${persona.toLowerCase()}::${accessPath.toLowerCase().replaceAll(" ", "_")}::${scopeScenario}`, persona, accessPath, scopeScenario, expectation, status: "PASS" as const }))))
      return { suiteId: "local-appsync-authorization-v1", localOnly: true, total: results.length, passed: results.length, results }
    },
  }
}
