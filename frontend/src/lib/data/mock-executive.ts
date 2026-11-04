/**
 * Mock of the Executive overview, mirroring the BE (backend/lambdas/api/src/a2g_api/executive.py): explicit
 * scope, aggregate counts with small groups withheld (and a complementary value withheld so nothing can be
 * recovered by subtraction), ranked regional and territory comparisons under one definition set, and a
 * drill-down that only opens for a viewer holding record-level permission. Synthetic and deterministic.
 */
import { addDays, addMonths } from "@/lib/dates"
import { MIN_CELL, shown, suppressFlags } from "./disclosure"
import { fixtureHash, REGIONS, type FixtureTerritory } from "./fixtures"
import { windowMonths } from "./mock-director"
import {
  type DateRange,
  type ExecutiveDrilldown,
  type ExecutiveDrilldownInput,
  type ExecutiveMonth,
  type ExecutiveOverview,
  type ExecutiveRankBy,
  type ExecutiveRecord,
  type ExecutiveUnit,
  type IsoDate,
  type SuppressedCount,
} from "./types"

export const EXECUTIVE_DEFINITION_VERSION = "executive-overview-v1"
export const EXECUTIVE_MAX_WINDOW_DAYS = 731
export const EXECUTIVE_DEFAULT_MONTHS = 12

const DEFINITIONS = [
  { key: "calls", label: "Distinct calls", text: "Each call counted once by its call id, however many products it covers." },
  { key: "responses", label: "Responses", text: "Recorded insight responses in the period, excluding responses flagged as excluded." },
  { key: "engagedHcps", label: "Engaged HCPs", text: "Each HCP reached at least once, counted once at every level. They do not add up across months or regions." },
  {
    key: "reportingCompleteness",
    label: "Reporting completeness",
    text: "Territory-months with at least one recorded call over the territories in scope times the months data has reached. It describes reporting, not performance.",
  },
  {
    key: "coverage",
    label: "Coverage",
    text: "Engaged target HCPs divided by the approved target population. Withheld when no approved target population exists.",
  },
]

const CHANNELS = [
  { channel: "in_person", share: 0.6 },
  { channel: "virtual", share: 0.3 },
  { channel: "phone", share: 0.1 },
]
const BANDS = [
  { band: "1 call", share: 0.66 },
  { band: "2 calls", share: 0.22 },
  { band: "3-4 calls", share: 0.09 },
  { band: "5+ calls", share: 0.03 },
]

type Metrics = { calls: number; hcps: number; responses: number }
export interface ExecutiveInput {
  territories: FixtureTerritory[]
  range: DateRange
  throughDay: IsoDate
  dataThrough: string
  scopeLabel: string
  metricsFor: (t: FixtureTerritory, range: DateRange) => Metrics
  empty: boolean
  /** Explicit record-level permission: nothing is withheld and the drill-down opens. */
  records: boolean
  rankBy: ExecutiveRankBy
  /** An approved target population exists for the scope (the "targets" scenario). */
  withTargets: boolean
}

const monthEnd = (first: IsoDate): IsoDate => addDays(addMonths(first, 1), -1)
const sum = (rows: Metrics[]): Metrics => rows.reduce((a, m) => ({ calls: a.calls + m.calls, hcps: a.hcps + m.hcps, responses: a.responses + m.responses }), { calls: 0, hcps: 0, responses: 0 })

/** The default window: the twelve months ending at data-through. */
export function defaultExecutiveRange(throughDay: IsoDate): DateRange {
  return { from: addMonths(`${throughDay.slice(0, 7)}-01`, -(EXECUTIVE_DEFAULT_MONTHS - 1)), to: throughDay }
}

export const executiveWindowTooLong = (range: DateRange) =>
  (Date.parse(range.to) - Date.parse(range.from)) / 86_400_000 + 1 > EXECUTIVE_MAX_WINDOW_DAYS

function sortUnits(rows: ExecutiveUnit[], rankBy: ExecutiveRankBy): ExecutiveUnit[] {
  const key = (r: ExecutiveUnit): number | null =>
    ({ CALLS: r.calls.value, RESPONSES: r.responses.value, ENGAGED_HCPS: r.engagedHcps.value, CALLS_PER_TERRITORY: r.callsPerTerritory, COMPLETENESS: r.reportingCompleteness })[rankBy]
  const ranked = rows.filter((r) => key(r) !== null).sort((a, b) => (key(b) as number) - (key(a) as number) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  const rest = rows.filter((r) => key(r) === null).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  let rank = 0
  let previous: number | null = null
  return [
    ...ranked.map((r, i) => {
      if (key(r) !== previous) {
        rank = i + 1
        previous = key(r)
      }
      return { ...r, rank }
    }),
    ...rest.map((r) => ({ ...r, rank: null })),
  ]
}

export function buildExecutiveOverview(input: ExecutiveInput): ExecutiveOverview {
  const { territories, range, throughDay } = input
  const suppress = !input.records
  const months = windowMonths(range, throughDay)
  const zero: Metrics = { calls: 0, hcps: 0, responses: 0 }
  const clip = (month: IsoDate): DateRange | null => {
    const from = month > range.from ? month : range.from
    const cap = range.to < throughDay ? range.to : throughDay
    const to = monthEnd(month) < cap ? monthEnd(month) : cap
    return from <= to ? { from, to } : null
  }
  const territoryMetrics = new Map<string, Metrics>()
  const monthMetrics = new Map<IsoDate, Metrics>()
  const reportingByTerritory = new Map<string, number>()
  const reportingByMonth = new Map<IsoDate, number>()
  for (const t of territories) {
    territoryMetrics.set(t.id, input.empty ? zero : input.metricsFor(t, { from: range.from, to: range.to < throughDay ? range.to : throughDay }))
  }
  months.forEach((m, mi) => {
    const r = clip(m.month)
    const rows = territories.map((t) => (input.empty || !r ? zero : input.metricsFor(t, r)))
    monthMetrics.set(m.month, sum(rows))
    territories.forEach((t, ti) => {
      // One territory skips its latest complete month so completeness has a visible gap.
      const gap = ti === 0 && mi === Math.max(0, months.length - 2) && months.length >= 3
      const reported = !input.empty && rows[ti].calls > 0 && !gap
      if (reported) {
        reportingByTerritory.set(t.id, (reportingByTerritory.get(t.id) ?? 0) + 1)
        reportingByMonth.set(m.month, (reportingByMonth.get(m.month) ?? 0) + 1)
      }
    })
  })
  const total = sum([...territoryMetrics.values()])
  const nTerritories = territories.length
  const regionIds = REGIONS.filter((r) => territories.some((t) => t.regionId === r.id))
  const regionMetrics = new Map(regionIds.map((r) => [r.id, sum(territories.filter((t) => t.regionId === r.id).map((t) => territoryMetrics.get(t.id) as Metrics))]))

  const hide = (values: number[], totalValue: number | null, additive: boolean) =>
    suppress ? suppressFlags(values, totalValue, additive) : { flags: values.map(() => false), totalHidden: false }
  const totalHidden = [suppress && total.calls > 0 && total.calls < MIN_CELL, suppress && total.responses > 0 && total.responses < MIN_CELL, suppress && total.hcps > 0 && total.hcps < MIN_CELL]

  // Monthly trend
  const monthValues = months.map((m) => monthMetrics.get(m.month) ?? zero)
  const mc = hide(monthValues.map((v) => v.calls), total.calls, true)
  const mr = hide(monthValues.map((v) => v.responses), total.responses, true)
  const mh = hide(monthValues.map((v) => v.hcps), null, false)
  totalHidden[0] ||= mc.totalHidden
  totalHidden[1] ||= mr.totalHidden
  const monthRows: ExecutiveMonth[] = months.map((m, i) => ({
    month: m.month,
    isPartial: m.isPartial,
    calls: shown(monthValues[i].calls, mc.flags[i]),
    responses: shown(monthValues[i].responses, mr.flags[i]),
    engagedHcps: shown(monthValues[i].hcps, mh.flags[i] || mc.flags[i]),
    territoriesReporting: reportingByMonth.get(m.month) ?? 0,
    territoriesInScope: nTerritories,
    reportingCompleteness: Math.round((1000 * (reportingByMonth.get(m.month) ?? 0)) / Math.max(1, nTerritories)) / 10,
  }))

  // Comparisons: siblings add up to their parent, so withhold complementarily, and a withheld region hides its territories.
  const unitRow = (id: string, name: string, level: "REGION" | "TERRITORY", regionId: string, regionName: string, count: number, m: Metrics, flags: [boolean, boolean, boolean], reported: number): ExecutiveUnit => {
    const possible = count * months.length
    return {
      rank: null,
      id,
      name,
      level,
      regionId,
      regionName,
      territoriesInScope: count,
      calls: shown(m.calls, flags[0]),
      responses: shown(m.responses, flags[1]),
      engagedHcps: shown(m.hcps, flags[2] || flags[0]),
      callsPerTerritory: flags[0] || !count ? null : Math.round((10 * m.calls) / count) / 10,
      reportingCompleteness: possible ? Math.round((1000 * reported) / possible) / 10 : null,
    }
  }
  const siblingFlags = (list: Metrics[], parent: Metrics) => {
    const c = hide(list.map((m) => m.calls), parent.calls, true).flags
    const r = hide(list.map((m) => m.responses), parent.responses, true).flags
    const h = hide(list.map((m) => m.hcps), null, false).flags
    return list.map((_, i): [boolean, boolean, boolean] => [c[i], r[i], h[i]])
  }
  const regionFlags = siblingFlags(regionIds.map((r) => regionMetrics.get(r.id) as Metrics), total)
  const regionReports = (id: string) => territories.filter((t) => t.regionId === id).reduce((a, t) => a + (reportingByTerritory.get(t.id) ?? 0), 0)
  const regions = sortUnits(
    regionIds.map((r, i) =>
      unitRow(r.id, r.name, "REGION", r.id, r.name, territories.filter((t) => t.regionId === r.id).length, regionMetrics.get(r.id) as Metrics, regionFlags[i], regionReports(r.id)),
    ),
    input.rankBy,
  )
  const territoryRows: ExecutiveUnit[] = []
  regionIds.forEach((r, ri) => {
    const members = territories.filter((t) => t.regionId === r.id)
    const flags = siblingFlags(members.map((t) => territoryMetrics.get(t.id) as Metrics), regionMetrics.get(r.id) as Metrics)
    members.forEach((t, i) => {
      const f: [boolean, boolean, boolean] = [flags[i][0] || regionFlags[ri][0], flags[i][1] || regionFlags[ri][1], flags[i][2] || regionFlags[ri][2]]
      territoryRows.push(unitRow(t.id, `${t.id} · ${t.name}`, "TERRITORY", r.id, r.name, 1, territoryMetrics.get(t.id) as Metrics, f, reportingByTerritory.get(t.id) ?? 0))
    })
  })
  const territoriesRanked = sortUnits(territoryRows, input.rankBy)

  // Engagement
  const bandValues = BANDS.map((b, i) => (i === BANDS.length - 1 ? total.hcps - BANDS.slice(0, -1).reduce((a, x) => a + Math.round(total.hcps * x.share), 0) : Math.round(total.hcps * b.share)))
  const bh = hide(bandValues, total.hcps, true)
  totalHidden[2] ||= bh.totalHidden
  const channelValues = CHANNELS.map((c, i) => (i === CHANNELS.length - 1 ? total.calls - CHANNELS.slice(0, -1).reduce((a, x) => a + Math.round(total.calls * x.share), 0) : Math.round(total.calls * c.share)))
  const ch = hide(channelValues, total.calls, true)
  totalHidden[0] ||= ch.totalHidden
  totalHidden[2] ||= totalHidden[0]
  const coverage: ExecutiveOverview["engagement"]["coverage"] = input.withTargets
    ? { status: "AVAILABLE", percentage: 54.2, territoriesWithTargets: Math.min(2, nTerritories), territoriesInScope: nTerritories }
    : { status: "NO_TARGET_POPULATION", percentage: null, territoriesWithTargets: 0, territoriesInScope: nTerritories }

  const sizes = [...new Set(regionIds.map((r) => territories.filter((t) => t.regionId === r.id).length))].sort((a, b) => a - b)
  const notes: ExecutiveOverview["notes"] = []
  if (suppress) notes.push({ code: "AGGREGATE_ONLY", message: "This view shows aggregates only. Individual records are not available to your role." })
  if (coverage.status === "NO_TARGET_POPULATION") notes.push({ code: "COVERAGE_WITHHELD", message: "Coverage is not shown: no approved target population exists for these territories." })
  if (range.to > throughDay) notes.push({ code: "AFTER_DATA_THROUGH", message: "Months after the data-through date are not shown, so they are not read as zero activity." })
  if (months.some((m) => m.isPartial)) notes.push({ code: "PARTIAL_MONTH", message: "A month marked partial is cut short by the selected dates or the data-through date." })
  if (sizes.length > 1) notes.push({ code: "REGION_SIZES_DIFFER", message: `Regions differ in size (${sizes[0]} to ${sizes[sizes.length - 1]} territories); compare calls per territory.` })

  const reportedTotal = [...reportingByTerritory.values()].reduce((a, n) => a + n, 0)
  const possible = nTerritories * months.length
  const suppressedCells =
    totalHidden.filter(Boolean).length + [...mc.flags, ...mr.flags, ...mh.flags, ...bh.flags, ...ch.flags].filter(Boolean).length +
    [...regions, ...territoriesRanked].reduce((a, u) => a + [u.calls, u.responses, u.engagedHcps].filter((c) => c.suppressed).length, 0)
  const hiddenCount = (i: number, v: number): SuppressedCount => shown(v, totalHidden[i])

  return {
    from: range.from,
    to: range.to,
    dataThrough: input.dataThrough,
    scopeLabel: input.scopeLabel,
    accessLevel: input.records ? "RECORD_DRILLDOWN" : "AGGREGATE_ONLY",
    drilldownAllowed: input.records,
    definitionVersion: EXECUTIVE_DEFINITION_VERSION,
    definitions: DEFINITIONS,
    disclosure: {
      minCell: MIN_CELL,
      text: `Counts below ${MIN_CELL} are withheld so no small group can be identified. When one value in a total is withheld, the next smallest is withheld as well, so it cannot be worked out by subtraction.`,
      suppressedCells,
      applied: suppress,
    },
    rankBy: input.rankBy,
    kpis: {
      calls: hiddenCount(0, total.calls),
      responses: hiddenCount(1, total.responses),
      engagedHcps: hiddenCount(2, total.hcps),
      regionsInScope: regionIds.length,
      territoriesInScope: nTerritories,
      reportingCompleteness: possible ? Math.round((1000 * reportedTotal) / possible) / 10 : null,
    },
    freshness: {
      status: range.to > throughDay ? "PARTIAL" : "CURRENT",
      callsLoadedThrough: input.dataThrough,
      responsesLoadedThrough: input.dataThrough,
      sourceLagDays: 0,
      monthsShown: months.length,
    },
    months: monthRows,
    regions,
    territories: territoriesRanked,
    engagement: {
      engagedHcps: hiddenCount(2, total.hcps),
      callsPerEngagedHcp: totalHidden[0] || totalHidden[2] || !total.hcps ? null : Math.round((100 * total.calls) / total.hcps) / 100,
      depth: BANDS.map((b, i) => ({ band: b.band, hcps: shown(bandValues[i], bh.flags[i]) })),
      channels: CHANNELS.map((c, i) => ({ channel: c.channel, calls: shown(channelValues[i], ch.flags[i]) })),
      coverage,
    },
    notes,
  }
}

const QUESTION_TEXT = ["Barriers to adopting biomarker testing", "Perceived unmet need in second-line treatment", "Interest in real-world evidence", "Concerns about managing adverse events"]
const RESPONSE_TEXT = ["Recorded perspective: access to testing varies between sites.", "Recorded perspective: sequencing after progression is unclear.", "Recorded perspective: wants longer follow-up data."]

/** Deterministic synthetic records behind one chart point; only reachable with record-level permission. */
export function buildExecutiveDrilldown(input: ExecutiveInput, query: ExecutiveDrilldownInput): ExecutiveDrilldown | null {
  const scoped = input.territories.filter((t) => t.id === query.scopeId || t.regionId === query.scopeId)
  if (!scoped.length) return null
  const month = `${query.month.slice(0, 7)}-01`
  const r = { from: month, to: monthEnd(month) < input.throughDay ? monthEnd(month) : input.throughDay }
  const totals = scoped.map((t) => (input.empty || r.from > r.to ? { calls: 0, hcps: 0, responses: 0 } : input.metricsFor(t, r)))
  const total = query.kind === "CALLS" ? sum(totals).calls : sum(totals).responses
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 100)
  const count = Math.min(total, limit)
  const records: ExecutiveRecord[] = Array.from({ length: count }, (_, i) => {
    const t = scoped[i % scoped.length]
    const day = addDays(r.to, -Math.floor(i / scoped.length))
    const hcp = Math.floor(fixtureHash(`${t.id}:${month}:${i}`) * t.hcpPool)
    return {
      recordId: `${query.kind === "CALLS" ? "CALL" : "RESP"}-${t.id}-${month.slice(0, 7)}-${String(i + 1).padStart(4, "0")}`,
      kind: query.kind === "CALLS" ? "CALL" : "RESPONSE",
      territoryId: t.id,
      hcpId: `HCP-${t.id}-${String(hcp).padStart(4, "0")}`,
      hcpName: `Synthetic HCP ${t.id}-${hcp}`,
      detail: query.kind === "CALLS" ? CHANNELS[i % 3].channel : `Q-${String(1 + (i % QUESTION_TEXT.length)).padStart(4, "0")}`,
      responseText: query.kind === "RESPONSES" ? RESPONSE_TEXT[i % RESPONSE_TEXT.length] : null,
      interactionDate: day < r.from ? r.from : day,
      loadedAt: input.dataThrough,
    }
  })
  return { scopeId: query.scopeId, kind: query.kind, month, total, truncated: total > count, dataThrough: input.dataThrough, scopeLabel: input.scopeLabel, records }
}
