/**
 * Executive trends (#121). Types and the GraphQL document mirror `amplify/data/schema.graphql`. The view is
 * aggregate-only: counts are `SuppressedCount`, the arrow per region and metric is judged in the database by the
 * approved thresholds, a region with too few responses gets no trend, and there is no record-level drill-down.
 * The BE computes every number; the screen only lays it out.
 */
import type { ExecutiveTrend } from "./executive-themes"
import type { DateRange, ExecutiveAccessLevel, IsoDate, IsoDateTime, RequestContext, SuppressedCount } from "./types"

export const EXECUTIVE_TREND_METRICS = ["CALLS", "ENGAGED_HCPS", "RESPONSES"] as const
export type ExecutiveTrendMetric = (typeof EXECUTIVE_TREND_METRICS)[number]
export const TREND_METRIC_LABEL: Record<ExecutiveTrendMetric, string> = {
  CALLS: "Distinct calls",
  ENGAGED_HCPS: "Engaged HCPs",
  RESPONSES: "Responses",
}

export interface ExecutiveTrendMonth {
  month: IsoDate
  /** Cut short by the selected dates or by the data-through date. */
  isPartial: boolean
  calls: SuppressedCount
  responses: SuppressedCount
  engagedHcps: SuppressedCount
}

export interface ExecutiveMetricTrend {
  metric: ExecutiveTrendMetric
  latest: SuppressedCount
  prior: SuppressedCount
  /** Percent change from prior to latest; null when either count is withheld or prior is zero. */
  changePercent: number | null
  trend: ExecutiveTrend
}

export interface ExecutiveRegionTrend {
  regionId: string
  regionName: string
  territoriesInScope: number
  /** Both periods hold at least the approved minimum number of responses, so a trend can be judged. */
  sampleSufficient: boolean
  months: ExecutiveTrendMonth[]
  metrics: ExecutiveMetricTrend[]
}

export interface ExecutiveTrendRule {
  minWindowResponses: number
  minChange: number
  minRelativeChange: number
  minCell: number
  trendDays: number
  rule: string
  approved: boolean
  definitionId: string | null
  version: number | null
  approvedAt: IsoDateTime | null
}

export interface ExecutiveTrends {
  from: IsoDate
  to: IsoDate
  trendFrom: IsoDate
  trendTo: IsoDate
  priorFrom: IsoDate
  priorTo: IsoDate
  dataThrough: IsoDateTime | null
  scopeLabel: string
  accessLevel: ExecutiveAccessLevel
  definitionVersion: string
  disclosure: { minCell: number; text: string; suppressedCells: number; applied: boolean }
  thresholds: ExecutiveTrendRule
  regions: ExecutiveRegionTrend[]
  sampleLimitations: string[]
  note: string
}

export interface ExecutiveTrendsAdapter {
  executiveTrends(ctx: RequestContext, range?: Partial<DateRange>): Promise<ExecutiveTrends>
}

const COUNT = "{ value suppressed }"

export const EXECUTIVE_TRENDS_QUERY = /* GraphQL */ `
  query ExecutiveTrends($from: AWSDate, $to: AWSDate) {
    executiveTrends(from: $from, to: $to) {
      from to trendFrom trendTo priorFrom priorTo dataThrough scopeLabel accessLevel definitionVersion sampleLimitations note
      disclosure { minCell text suppressedCells applied }
      thresholds { minWindowResponses minChange minRelativeChange minCell trendDays rule approved definitionId version approvedAt }
      regions {
        regionId regionName territoriesInScope sampleSufficient
        months { month isPartial calls ${COUNT} responses ${COUNT} engagedHcps ${COUNT} }
        metrics { metric latest ${COUNT} prior ${COUNT} changePercent trend }
      }
    }
  }
`

type Run = <T>(query: string, variables: Record<string, unknown> | undefined, ctx: RequestContext) => Promise<T>

export function createGraphQLExecutiveTrends(run: Run): ExecutiveTrendsAdapter {
  return {
    async executiveTrends(ctx, range) {
      // Optional values are omitted, never sent as null.
      const vars: Record<string, unknown> = {}
      if (range?.from) vars.from = range.from
      if (range?.to) vars.to = range.to
      return (await run<{ executiveTrends: ExecutiveTrends }>(EXECUTIVE_TRENDS_QUERY, vars, ctx)).executiveTrends
    },
  }
}
