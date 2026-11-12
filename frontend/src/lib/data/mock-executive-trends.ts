/**
 * Mock of the Executive trends (#121). It mirrors the BE rules in backend/lambdas/api/src/a2g_api/executive_trends.py
 * and migration 013: distinct calls, engaged HCPs and responses per explicit region and month; small groups (1 to 4)
 * withheld with complementary withholding in both cuts of the region-by-month table; the latest 90 days compared with
 * the equal period before, judged by the approved thresholds (`trendStatus`); a region with too few responses gets no
 * trend. Synthetic and deterministic: the Northeast ramps up, the Southeast falls away, the Midwest is steady and the
 * West is thin (small groups and too few responses).
 */
import { addDays, addMonths, daysInRange } from "@/lib/dates"
import { MIN_CELL } from "./disclosure"
import type { ExecutiveTrend } from "./executive-themes"
import {
  EXECUTIVE_TREND_METRICS,
  type ExecutiveMetricTrend,
  type ExecutiveRegionTrend,
  type ExecutiveTrendMonth,
  type ExecutiveTrendRule,
  type ExecutiveTrends,
  type ExecutiveTrendsAdapter,
} from "./executive-trends"
import { fixtureHash, REGIONS } from "./fixtures"
import type { ExecutiveInput } from "./mock-executive"
import type { MockScenario } from "./mock-adapter"
import { DataError, type DateRange, type IsoDate, type RequestContext, type SuppressedCount } from "./types"

export const TRENDS_DEFINITION_VERSION = "executive-trends-v1"
export const TREND_DAYS = 90
/** The approved thresholds the database holds (`app.emerging_thresholds`), as this rule uses them. */
export const TREND_THRESHOLDS = { minWindowResponses: 30, minChange: 10, minRelativeChange: 0.5 } as const

type Cell = [calls: number, responses: number, hcps: number]
const small = (n: number | null) => n !== null && n > 0 && n < MIN_CELL

/** Mirrors `app.exec_activity_trend_status`: the sample gate, then rising or falling by count and by relative change. */
export function trendStatus(latest: number, prior: number, latestSample: number, priorSample: number): "RISING" | "FALLING" | "STEADY" | "INSUFFICIENT_SAMPLE" {
  const t = TREND_THRESHOLDS
  if (latestSample < t.minWindowResponses || priorSample < t.minWindowResponses) return "INSUFFICIENT_SAMPLE"
  if (latest - prior >= t.minChange && latest >= prior * (1 + t.minRelativeChange)) return "RISING"
  if (prior - latest >= t.minChange && latest <= prior * (1 - t.minRelativeChange)) return "FALLING"
  return "STEADY"
}

/** Calls per territory per day by region, and a step change just before the latest period that makes the arrows differ. */
const ACTIVITY: Record<string, { perTerritory: number; step: number; responsesPerCall: number }> = {
  NE: { perTerritory: 1.4, step: 1.7, responsesPerCall: 4.6 },
  SE: { perTerritory: 1.2, step: 0.4, responsesPerCall: 4.4 },
  MW: { perTerritory: 1.1, step: 1, responsesPerCall: 4.5 },
  WE: { perTerritory: 0.05, step: 1, responsesPerCall: 0.5 },
}
/** The step lands a few days into the prior period, so the latest period is at the new rate throughout. */
const STEP_DAYS_BEFORE_THROUGH = 93

function dailyCells(regionId: string, territories: number, day: IsoDate, step: IsoDate): Cell {
  const a = ACTIVITY[regionId] ?? ACTIVITY.MW
  const wobble = 0.9 + 0.2 * fixtureHash(`${regionId}:${day}`)
  const calls = territories * a.perTerritory * (day >= step ? a.step : 1) * wobble
  return [calls, calls * a.responsesPerCall, calls * 0.86]
}

/** Region sums over [from, to], rounded once so a month cell and a window count are whole numbers. */
function sumDays(regionId: string, territories: number, from: IsoDate, to: IsoDate, step: IsoDate): Cell {
  const total: Cell = [0, 0, 0]
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const [c, r, h] = dailyCells(regionId, territories, d, step)
    total[0] += c
    total[1] += r
    total[2] += h
  }
  return [Math.round(total[0]), Math.round(total[1]), Math.round(total[2])]
}

/** Complement one cut of a table: small values, plus the smallest other positive value when exactly one is withheld. */
function complement(values: number[], hidden: boolean[]): boolean[] {
  const flags = values.map((v, i) => hidden[i] || small(v))
  if (flags.filter(Boolean).length === 1) {
    let pick = -1
    values.forEach((v, i) => {
      if (!flags[i] && v > 0 && (pick < 0 || v < values[pick])) pick = i
    })
    if (pick >= 0) flags[pick] = true
  }
  return flags
}

/** Which region-month cells are withheld for one additive metric: both cuts, repeated until stable. */
function withheld(grid: number[][]): boolean[][] {
  const hidden = grid.map((row) => row.map(() => false))
  let changed = true
  while (changed) {
    changed = false
    for (let r = 0; r < grid.length; r++) {
      const next = complement(grid[r], hidden[r])
      next.forEach((flag, m) => {
        if (flag && !hidden[r][m]) {
          hidden[r][m] = true
          changed = true
        }
      })
    }
    for (let m = 0; m < (grid[0]?.length ?? 0); m++) {
      const next = complement(grid.map((row) => row[m]), grid.map((_row, r) => hidden[r][m]))
      next.forEach((flag, r) => {
        if (flag && !hidden[r][m]) {
          hidden[r][m] = true
          changed = true
        }
      })
    }
  }
  return hidden
}

const count = (value: number, hidden: boolean): SuppressedCount => ({ value: hidden ? null : value, suppressed: hidden })

function monthsOf(range: DateRange, throughDay: IsoDate) {
  const last = range.to < throughDay ? range.to : throughDay
  const out: { first: IsoDate; from: IsoDate; to: IsoDate; isPartial: boolean }[] = []
  for (let first = `${range.from.slice(0, 7)}-01`; first <= last; first = addMonths(first, 1)) {
    const end = addDays(addMonths(first, 1), -1)
    const from = first < range.from ? range.from : first
    const to = end > last ? last : end
    out.push({ first, from, to, isPartial: from > first || to < end })
  }
  return out
}

export function thresholdRule(): ExecutiveTrendRule {
  const t = TREND_THRESHOLDS
  return {
    ...t,
    minCell: MIN_CELL,
    trendDays: TREND_DAYS,
    rule:
      `Each region compares the latest ${TREND_DAYS} days with the ${TREND_DAYS} days before. Both periods must hold at least ${t.minWindowResponses} responses, ` +
      `or the region gets no trend. A figure is rising when it grew by at least ${t.minChange} and by at least ${t.minRelativeChange * 100}% of the earlier figure; ` +
      `falling is the mirror image; anything else is steady. Counts below ${MIN_CELL} are withheld, so no arrow is drawn from them.`,
    approved: true,
    definitionId: "emerging-topic-rule",
    version: 1,
    approvedAt: "2026-11-01T00:00:00Z",
  }
}

export function buildTrends(input: ExecutiveInput): ExecutiveTrends {
  const through = input.throughDay
  const last = input.range.to < through ? input.range.to : through
  const trendTo = last
  const trendFrom = addDays(trendTo, -(TREND_DAYS - 1))
  const priorTo = addDays(trendFrom, -1)
  const priorFrom = addDays(priorTo, -(TREND_DAYS - 1))
  const months = monthsOf(input.range, through)
  const step = addDays(through, -STEP_DAYS_BEFORE_THROUGH)
  const regionIds = REGIONS.map((r) => r.id).filter((id) => input.territories.some((t) => t.regionId === id))
  const suppress = !input.records
  const rule = thresholdRule()

  const grids = regionIds.map((id) => {
    const n = input.territories.filter((t) => t.regionId === id).length
    return {
      id,
      n,
      cells: months.map((m): Cell => (input.empty ? [0, 0, 0] : sumDays(id, n, m.from, m.to, step))),
      latest: input.empty ? ([0, 0, 0] as Cell) : sumDays(id, n, trendFrom, trendTo, step),
      prior: input.empty ? ([0, 0, 0] as Cell) : sumDays(id, n, priorFrom, priorTo, step),
    }
  })
  const none = (grid: number[][]) => grid.map((row) => row.map(() => false))
  const calls = grids.map((g) => g.cells.map((c) => c[0]))
  const responses = grids.map((g) => g.cells.map((c) => c[1]))
  const hiddenCalls = suppress ? withheld(calls) : none(calls)
  const hiddenResponses = suppress ? withheld(responses) : none(responses)

  let suppressed = 0
  const regions: ExecutiveRegionTrend[] = grids.map((g, ri) => {
    const seriesRows: ExecutiveTrendMonth[] = months.map((m, mi) => {
      const [c, r, h] = g.cells[mi]
      const hc = hiddenCalls[ri][mi]
      const hr = hiddenResponses[ri][mi]
      const hh = suppress && (small(h) || hc)
      suppressed += Number(hc) + Number(hr) + Number(hh)
      return { month: m.first, isPartial: m.isPartial, calls: count(c, hc), responses: count(r, hr), engagedHcps: count(h, hh) }
    })
    const sufficient = g.latest[1] >= rule.minWindowResponses && g.prior[1] >= rule.minWindowResponses
    const metrics: ExecutiveMetricTrend[] = EXECUTIVE_TREND_METRICS.map((metric) => {
      const k = metric === "CALLS" ? 0 : metric === "RESPONSES" ? 1 : 2
      const latest = g.latest[k]
      const prior = g.prior[k]
      let lh = suppress && small(latest)
      let ph = suppress && small(prior)
      if (suppress && metric === "ENGAGED_HCPS") {
        lh = lh || small(g.latest[0])
        ph = ph || small(g.prior[0])
      }
      const verdict = trendStatus(latest, prior, g.latest[1], g.prior[1])
      const trend: ExecutiveTrend = verdict === "INSUFFICIENT_SAMPLE" ? verdict : lh || ph ? "WITHHELD" : verdict
      suppressed += Number(lh) + Number(ph)
      return {
        metric,
        latest: count(latest, lh),
        prior: count(prior, ph),
        changePercent: lh || ph || prior <= 0 ? null : Math.round((1000 * (latest - prior)) / prior) / 10,
        trend,
      }
    })
    const region = REGIONS.find((r) => r.id === g.id)
    return { regionId: g.id, regionName: region?.name ?? g.id, territoriesInScope: g.n, sampleSufficient: sufficient, months: seriesRows, metrics }
  })

  const thin = regions.filter((r) => !r.sampleSufficient).map((r) => r.regionName)
  const limitations = [
    `Trends compare the latest ${TREND_DAYS} days (${trendFrom} to ${trendTo}) with the ${TREND_DAYS} days before (${priorFrom} to ${priorTo}). They describe what was recorded, never why.`,
    "Engaged HCPs are counted at each level, so they do not add up across months or regions.",
  ]
  if (thin.length > 0 && !input.empty) limitations.push(`Too few responses to judge a trend in ${thin.join(", ")}: both periods need at least ${rule.minWindowResponses}.`)
  if (suppressed > 0) limitations.push(`${suppressed} counts between 1 and ${MIN_CELL - 1} are withheld, together with the next-smallest value where one would reveal them.`)
  if (input.range.to > through) limitations.push("Months after the data-through date are not shown, so they are not read as zero activity.")
  if (months.some((m) => m.isPartial)) limitations.push("A month marked partial is cut short by the selected dates or the data-through date.")

  return {
    from: input.range.from,
    to: input.range.to,
    trendFrom,
    trendTo,
    priorFrom,
    priorTo,
    dataThrough: input.dataThrough,
    scopeLabel: input.scopeLabel,
    accessLevel: input.records ? "RECORD_DRILLDOWN" : "AGGREGATE_ONLY",
    definitionVersion: TRENDS_DEFINITION_VERSION,
    disclosure: {
      minCell: MIN_CELL,
      text: `Counts below ${MIN_CELL} are withheld so no small group can be identified. When one value in a total is withheld, the next smallest is withheld as well, so it cannot be worked out by subtraction.`,
      suppressedCells: suppressed,
      applied: suppress,
    },
    thresholds: rule,
    regions,
    sampleLimitations: limitations,
    note: `Monthly distinct calls, engaged HCPs and responses for each region you are explicitly authorized for. Arrows compare the latest ${TREND_DAYS} days with the ${TREND_DAYS} before against the approved thresholds.`,
  }
}

interface Deps {
  scenario: () => MockScenario
  gate: (ctx: RequestContext, operation: string) => Promise<MockScenario>
  input: (ctx: RequestContext, s: MockScenario, range?: Partial<DateRange>) => ExecutiveInput
}

export function createMockExecutiveTrends(deps: Deps): ExecutiveTrendsAdapter {
  return {
    async executiveTrends(ctx, range) {
      const s = await deps.gate(ctx, "executiveTrends")
      const input = deps.input(ctx, s, range)
      if (daysInRange(input.range) > 731) throw new DataError("BAD_REQUEST", "That request was not accepted.", ctx.correlationId)
      return buildTrends(input)
    },
  }
}
