/**
 * Mock of the Director overview, mirroring the BE's definitions (backend/lambdas/api/src/a2g_api/director.py):
 * distinct calls vs call-product rows, member completeness as months with a recorded call over the
 * months the data has reached, and coverage withheld unless an approved target population exists.
 * Synthetic and deterministic; every number derives from the same fixture model as the other mocks.
 */
import { addDays, addMonths, daysInRange } from "@/lib/dates"
import type { FixtureTerritory } from "./fixtures"
import {
  type DateRange,
  type DirectorOverview,
  type Disclosure,
  type IsoDate,
  type MixDimension,
  type OverviewDefinition,
  type TeamMember,
  type TerritoryComparison,
  type TerritoryCoverage,
  type TerritoryRow,
} from "./types"

export const MOCK_DEFINITION_VERSION = "team-overview-v1"
export const MAX_WINDOW_DAYS = 366

export const DEFINITIONS: OverviewDefinition[] = [
  { key: "distinctCalls", label: "Distinct calls", text: "Each call counted once by its call id, however many products it covers." },
  { key: "callProductRows", label: "Call-product rows", text: "Source rows: one per product discussed. Never reported as calls." },
  { key: "distinctEngagedHcps", label: "Distinct engaged HCPs", text: "Each HCP reached at least once in the period, counted once." },
  { key: "responseCount", label: "Responses", text: "Recorded insight responses in the period, excluding responses flagged as excluded." },
  { key: "reportingMembers", label: "Reporting team members", text: "Team members with at least one recorded call in the period." },
  {
    key: "reportingCompleteness",
    label: "Reporting completeness",
    text: "Months with at least one recorded call divided by the months in the period that data has reached. It describes reporting, not performance.",
  },
  {
    key: "coverage",
    label: "Coverage",
    text: "Engaged target HCPs divided by the approved target population. Withheld when no approved target population exists.",
  },
]

export interface TerritoryMetrics {
  calls: number
  hcps: number
  responses: number
}

export interface BuildInput {
  territories: FixtureTerritory[]
  range: DateRange
  throughDay: IsoDate
  dataThrough: string
  scopeLabel: string
  metricsFor: (t: FixtureTerritory, range: DateRange) => TerritoryMetrics
  empty: boolean
  /** The "targets" scenario: an approved target population exists for the first two territories. */
  withTargets: boolean
}

const monthEnd = (first: IsoDate): IsoDate => addDays(addMonths(first, 1), -1)
const MEMBER_SHARES = [0.45, 0.35, 0.2] as const
const PRODUCTS = ["osimertinib", "pembrolizumab", "sacituzumab govitecan", "trastuzumab deruxtecan"]
const DISEASES = ["non-small cell lung cancer", "breast cancer", "urothelial cancer", "gastric cancer"]
const TOPICS = ["pre-call planning", "scientific exchange", "data request"]
const CHANNELS = [
  { channel: "in_person", share: 0.6 },
  { channel: "virtual", share: 0.3 },
  { channel: "phone", share: 0.1 },
]

export function windowMonths(range: DateRange, throughDay: IsoDate) {
  const last = range.to < throughDay ? range.to : throughDay
  const out: { month: IsoDate; isPartial: boolean }[] = []
  for (let m = `${range.from.slice(0, 7)}-01`; m <= last; m = addMonths(m, 1)) {
    out.push({ month: m, isPartial: range.from > m || last < monthEnd(m) })
  }
  return out
}

function withinMonth(range: DateRange, month: IsoDate, throughDay: IsoDate): DateRange | null {
  const from = month > range.from ? month : range.from
  const cap = range.to < throughDay ? range.to : throughDay
  const to = monthEnd(month) < cap ? monthEnd(month) : cap
  return from <= to ? { from, to } : null
}

const NO_TARGET: TerritoryCoverage = { status: "NO_TARGET_POPULATION", targetHcps: null, engagedTargetHcps: null, percentage: null }

function coverageFor(index: number, hcps: number, withTargets: boolean): TerritoryCoverage {
  if (!withTargets || index > 1) return NO_TARGET
  const target = 120 + index * 40
  const engaged = Math.min(target, Math.round(hcps * 0.55))
  return { status: "AVAILABLE", targetHcps: target, engagedTargetHcps: engaged, percentage: Math.round((1000 * engaged) / target) / 10 }
}

/** Members are 3 per territory; the third skips its latest complete month so completeness has a visible gap. */
function membersOf(t: FixtureTerritory, tIndex: number, input: BuildInput): TeamMember[] {
  const months = windowMonths(input.range, input.throughDay)
  return MEMBER_SHARES.map((share, i) => {
    const series = months.map((m, mi) => {
      const r = withinMonth(input.range, m.month, input.throughDay)
      const base = input.empty || !r ? 0 : Math.round(input.metricsFor(t, r).calls * share)
      const gap = i === 2 && tIndex === 0 && mi === Math.max(0, months.length - 2) && months.length >= 3
      return { month: m.month, distinctCalls: gap ? 0 : base }
    })
    const active = series.filter((s) => s.distinctCalls > 0).length
    return {
      memberId: `REP-${t.id}-${i + 1}`,
      name: `Synthetic MSL ${t.id} ${"ABC"[i]}`,
      linkedToRoster: false,
      territoryIds: [t.id],
      distinctCalls: series.reduce((a, s) => a + s.distinctCalls, 0),
      activeMonths: active,
      expectedMonths: months.length,
      reportingCompleteness: months.length ? Math.round((10000 * active) / months.length) / 10000 : 0,
      months: series,
    }
  }).filter((m) => m.distinctCalls > 0 || m.activeMonths > 0)
}

export function territoryRows(input: BuildInput, only?: string[]): TerritoryRow[] {
  const expected = windowMonths(input.range, input.throughDay).length
  return input.territories
    .map((t, index) => ({ t, index }))
    .filter(({ t }) => !only || only.includes(t.id))
    .map(({ t, index }) => {
      const m = input.empty ? { calls: 0, hcps: 0, responses: 0 } : input.metricsFor(t, input.range)
      const members = membersOf(t, index, input).filter((x) => x.distinctCalls > 0)
      const activeMonths = members.reduce((a, x) => a + x.activeMonths, 0)
      return {
        territoryId: t.id,
        name: t.name,
        regionId: t.regionId,
        regionName: t.regionId,
        distinctCalls: m.calls,
        distinctEngagedHcps: m.hcps,
        callProductRows: m.calls * 2,
        responseCount: m.responses,
        reportingMembers: members.length,
        rosteredMembers: 3,
        callsPerReportingMember: members.length ? Math.round((10 * m.calls) / members.length) / 10 : null,
        reportingCompleteness: members.length && expected ? Math.round((10000 * activeMonths) / (members.length * expected)) / 10000 : null,
        latestLoadDate: input.empty ? null : input.dataThrough.slice(0, 10),
        coverage: coverageFor(index, m.hcps, input.withTargets),
      }
    })
}

function mixOf(input: BuildInput, totalCalls: number): MixDimension[] {
  const months = windowMonths(input.range, input.throughDay)
  const monthCalls = months.map((m) => {
    const r = withinMonth(input.range, m.month, input.throughDay)
    return r && !input.empty ? input.territories.reduce((a, t) => a + input.metricsFor(t, r).calls, 0) : 0
  })
  const dimension = (
    dimension: MixDimension["dimension"],
    label: string,
    shares: { value: string; share: number }[],
    perCall: number,
  ): MixDimension => {
    const values = shares.map(({ value, share }) => ({
      value,
      distinctCalls: Math.round(totalCalls * share),
      callProductRows: Math.round(totalCalls * share * 2),
      months: months.map((m, i) => ({ month: m.month, distinctCalls: Math.round(monthCalls[i] * share) })),
    }))
    const valueTotal = values.reduce((a, v) => a + v.distinctCalls, 0)
    return { dimension, label, totalDistinctCalls: totalCalls, valueTotal: totalCalls ? Math.max(valueTotal, Math.round(totalCalls * perCall)) : 0, valuesOverlap: perCall > 1 && totalCalls > 0, values: totalCalls ? values : [] }
  }
  const even = (names: string[]) => names.map((value) => ({ value, share: 1 / names.length }))
  return [
    dimension("CHANNEL", "Channel", CHANNELS.map((c) => ({ value: c.channel, share: c.share })), 1),
    dimension("TOPIC", "Topic (reason for visit)", [{ value: TOPICS[0], share: 0.5 }, { value: TOPICS[1], share: 0.35 }, { value: TOPICS[2], share: 0.15 }], 1),
    dimension("DISEASE_STATE", "Disease state", even(DISEASES), 2),
    dimension("PRODUCT", "Product (mentions)", even(PRODUCTS), 2),
  ]
}

export function buildOverview(input: BuildInput): DirectorOverview {
  const rows = territoryRows(input)
  const calls = rows.reduce((a, r) => a + r.distinctCalls, 0)
  const hcpSum = rows.reduce((a, r) => a + r.distinctEngagedHcps, 0)
  const members = input.territories.flatMap((t, i) => membersOf(t, i, input)).sort((a, b) => b.distinctCalls - a.distinctCalls)
  const reporting = members.filter((m) => m.distinctCalls > 0)
  const expected = windowMonths(input.range, input.throughDay).length
  const active = reporting.reduce((a, m) => a + m.activeMonths, 0)
  const withTargets = rows.filter((r) => r.coverage.status === "AVAILABLE")
  const target = withTargets.reduce((a, r) => a + (r.coverage.targetHcps ?? 0), 0)
  const engaged = withTargets.reduce((a, r) => a + (r.coverage.engagedTargetHcps ?? 0), 0)
  const notes: Disclosure[] = [
    { code: "ROSTER_NOT_LINKED", message: `${rows.length * 3} rostered staff in these territories could not be linked to a call-feed user, so completeness covers call-feed reporters only.` },
    {
      code: "MIX_MULTIVALUE",
      message: "A call recorded under several channels, topics, disease states or products counts once in each, so mix values can add up to more than the distinct calls.",
    },
  ]
  return {
    from: input.range.from,
    to: input.range.to,
    dataThrough: input.dataThrough,
    scopeLabel: input.scopeLabel,
    definitionVersion: MOCK_DEFINITION_VERSION,
    definitions: DEFINITIONS,
    kpis: {
      distinctCalls: calls,
      // Engaged HCPs are distinct across territories, so the scope total is below the sum of the rows.
      distinctEngagedHcps: Math.round(hcpSum * 0.97),
      callProductRows: calls * 2,
      responseCount: rows.reduce((a, r) => a + r.responseCount, 0),
      reportingMembers: reporting.length,
      territoriesInScope: rows.length,
      territoriesWithActivity: rows.filter((r) => r.distinctCalls > 0).length,
      unattributedCalls: 0,
      reportingCompleteness: reporting.length && expected ? Math.round((10000 * active) / (reporting.length * expected)) / 10000 : null,
    },
    months: windowMonths(input.range, input.throughDay).map((m) => {
      const r = withinMonth(input.range, m.month, input.throughDay)
      const sums = r && !input.empty ? input.territories.map((t) => input.metricsFor(t, r)) : []
      return {
        month: m.month,
        isPartial: m.isPartial,
        distinctCalls: sums.reduce((a, x) => a + x.calls, 0),
        distinctEngagedHcps: Math.round(sums.reduce((a, x) => a + x.hcps, 0) * 0.97),
      }
    }),
    territories: rows,
    members,
    mix: mixOf(input, calls),
    coverage: {
      status: withTargets.length ? "AVAILABLE" : "NO_TARGET_POPULATION",
      targetHcps: withTargets.length ? target : null,
      engagedTargetHcps: withTargets.length ? engaged : null,
      percentage: withTargets.length && target ? Math.round((1000 * engaged) / target) / 10 : null,
      territoriesWithTargets: withTargets.length,
      territoriesInScope: rows.length,
      asOf: input.range.to,
    },
    notes: input.empty ? notes.slice(1) : notes,
  }
}

export function buildComparison(input: BuildInput, ids: string[]): TerritoryComparison {
  const rows = territoryRows(input, ids).sort((a, b) => ids.indexOf(a.territoryId) - ids.indexOf(b.territoryId))
  const disclosures: Disclosure[] = []
  const distinct = (xs: unknown[]) => new Set(xs.map((x) => JSON.stringify(x))).size > 1
  const show = (xs: (number | null)[]) => xs.map((x) => (x === null ? "n/a" : String(x))).join(", ")
  if (distinct(rows.map((r) => r.reportingMembers))) {
    disclosures.push({ code: "REPORTING_MEMBERS_DIFFER", message: `Reporting team sizes differ (${show(rows.map((r) => r.reportingMembers))}). Calls per reporting member is shown for a like-for-like read.` })
  }
  if (distinct(rows.map((r) => r.reportingCompleteness?.toFixed(2) ?? null))) {
    disclosures.push({
      code: "COMPLETENESS_DIFFERS",
      message: `Reporting completeness differs (${rows.map((r) => (r.reportingCompleteness === null ? "n/a" : `${Math.round(r.reportingCompleteness * 100)}%`)).join(", ")}); a lower figure may reflect missing reporting rather than less activity.`,
    })
  }
  const has = rows.map((r) => r.coverage.status === "AVAILABLE")
  if (has.some(Boolean) && !has.every(Boolean)) {
    disclosures.push({ code: "TARGET_DATA_UNEVEN", message: "Only some of these territories have an approved target population, so coverage is shown for those alone and is not compared." })
  } else if (has.every(Boolean) && distinct(rows.map((r) => r.coverage.targetHcps))) {
    disclosures.push({ code: "TARGET_POPULATION_DIFFERS", message: `Target populations differ in size (${show(rows.map((r) => r.coverage.targetHcps))}); compare coverage percentages, not counts.` })
  } else if (!has.some(Boolean)) {
    disclosures.push({ code: "COVERAGE_WITHHELD", message: "No approved target population exists for these territories, so coverage is not shown." })
  }
  if (windowMonths(input.range, input.throughDay).some((m) => m.isPartial)) {
    disclosures.push({ code: "PARTIAL_PERIOD", message: "The period includes a partial month, applied identically to every territory." })
  }
  const unequal = ["REPORTING_MEMBERS_DIFFER", "COMPLETENESS_DIFFERS", "TARGET_DATA_UNEVEN", "TARGET_POPULATION_DIFFERS"]
  return {
    from: input.range.from,
    to: input.range.to,
    dataThrough: input.dataThrough,
    scopeLabel: input.scopeLabel,
    definitionVersion: MOCK_DEFINITION_VERSION,
    definitions: DEFINITIONS,
    territories: rows,
    populationsUnequal: disclosures.some((d) => unequal.includes(d.code)),
    disclosures,
  }
}

export const tooLong = (range: DateRange) => daysInRange(range) > MAX_WINDOW_DAYS
