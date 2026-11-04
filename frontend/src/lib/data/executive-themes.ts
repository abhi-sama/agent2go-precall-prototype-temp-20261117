/**
 * Executive themes, cross-region topics and leadership summaries (ticket 13). Types and GraphQL documents mirror
 * `amplify/data/schema.graphql`. Everything is aggregate-only for an Executive: counts are `SuppressedCount`, themes
 * are derived keyword groupings of free text, and citations describe the cited set of responses (AGGREGATE) unless the
 * viewer also holds record-level permission (RECORD). The BE computes every number; the screens only lay it out.
 */
import type { DateRange, ExecutiveAccessLevel, IsoDate, IsoDateTime, OverviewDefinition, RequestContext, SuppressedCount } from "./types"

export const EXECUTIVE_THEME_FACETS = ["PORTFOLIO", "MOLECULE", "DISEASE_AREA", "STUDY"] as const
export type ExecutiveThemeFacet = (typeof EXECUTIVE_THEME_FACETS)[number]
export const FACET_LABEL: Record<ExecutiveThemeFacet, string> = {
  PORTFOLIO: "Portfolio",
  MOLECULE: "Molecule",
  DISEASE_AREA: "Disease area",
  STUDY: "Study",
}

/** RISING and FALLING come from the approved threshold rule. WITHHELD: a count behind the arrow is a small group. */
export type ExecutiveTrend = "RISING" | "FALLING" | "STEADY" | "WITHHELD" | "INSUFFICIENT_SAMPLE"
export type ExecutiveCitationKind = "AGGREGATE" | "RECORD"
export type LeadershipStaleReason = "NEWER_DATA_LOADED" | "SCOPE_CHANGED"

export interface DisclosureRuleInfo {
  minCell: number
  text: string
  suppressedCells: number
  /** False when the viewer holds record-level permission, so nothing is withheld. */
  applied: boolean
}

/** The responses a figure rests on. AGGREGATE describes the set; RECORD names one response. */
export interface ExecutiveCitation {
  citationId: string
  kind: ExecutiveCitationKind
  dataset: string
  label: string
  responses: SuppressedCount | null
  recordId: string | null
  excerpt: string | null
  interactionDate: IsoDate | null
}

export interface ExecutiveThemeCard {
  cardId: string
  facetValue: string
  topic: string
  responses: SuppressedCount
  priorResponses: SuppressedCount
  distinctHcps: SuppressedCount
  /** Percent of the group's free-text responses; null when withheld. */
  share: number | null
  regionCount: number
  trend: ExecutiveTrend
  citations: ExecutiveCitation[]
}

export interface ExecutiveThemeGroup {
  facetValue: string
  freeTextResponses: SuppressedCount
  priorFreeTextResponses: SuppressedCount
  regionCount: number
  cards: ExecutiveThemeCard[]
}

export interface ExecutiveThemes {
  from: IsoDate
  to: IsoDate
  priorFrom: IsoDate
  priorTo: IsoDate
  dataThrough: IsoDateTime | null
  scopeLabel: string
  accessLevel: ExecutiveAccessLevel
  facet: ExecutiveThemeFacet
  facetLabel: string
  definitionVersion: string
  disclosure: DisclosureRuleInfo
  groups: ExecutiveThemeGroup[]
  groupsLeftOut: number
  sampleLimitations: string[]
  note: string
}

export interface ExecutiveMatrixRegion {
  regionId: string
  regionName: string
  territoriesInScope: number
  freeTextResponses: SuppressedCount
  priorFreeTextResponses: SuppressedCount
  sampleSufficient: boolean
}

export interface ExecutiveMatrixCell {
  regionId: string
  responses: SuppressedCount
  priorResponses: SuppressedCount
  share: number | null
  priorShare: number | null
  sharePointChange: number | null
  trend: ExecutiveTrend
  /** True when the cell meets the approved alert threshold (RISING). */
  alert: boolean
}

export interface ExecutiveMatrixRow {
  topic: string
  isOther: boolean
  cells: ExecutiveMatrixCell[]
  regionsRising: number
  regionsFalling: number
  /** Rising in two or more regions at once. */
  crossRegion: boolean
}

export interface ExecutiveThresholds {
  minWindowResponses: number
  minTopicResponses: number
  minRelativeIncrease: number
  minSharePoints: number
  minCell: number
  rule: string
  approved: boolean
  definitionId: string | null
  version: number | null
  approvedAt: IsoDateTime | null
}

export interface ExecutiveTopicMatrix {
  from: IsoDate
  to: IsoDate
  priorFrom: IsoDate
  priorTo: IsoDate
  dataThrough: IsoDateTime | null
  scopeLabel: string
  accessLevel: ExecutiveAccessLevel
  facet: ExecutiveThemeFacet
  facetValue: string | null
  definitionVersion: string
  disclosure: DisclosureRuleInfo
  thresholds: ExecutiveThresholds
  regions: ExecutiveMatrixRegion[]
  rows: ExecutiveMatrixRow[]
  sampleLimitations: string[]
  note: string
}

export interface LeadershipFigure {
  label: string
  value: SuppressedCount
  citationIds: string[]
}
export interface LeadershipStatement {
  statementId: string
  section: string
  text: string
  citationIds: string[]
}

export interface LeadershipSummary {
  summaryId: string
  title: string
  from: IsoDate
  to: IsoDate
  dataThrough: IsoDateTime | null
  generatedAt: IsoDateTime
  scopeLabel: string
  scopeTerritoryIds: string[]
  accessLevel: ExecutiveAccessLevel
  definitionVersion: string
  modelMode: string
  numberCheck: string
  droppedStatements: number
  stale: boolean
  staleReasons: LeadershipStaleReason[]
  currentDataThrough: IsoDateTime | null
  keyFigures: LeadershipFigure[]
  statements: LeadershipStatement[]
  sampleLimitations: string[]
  definitions: OverviewDefinition[]
  citations: ExecutiveCitation[]
  disclosure: DisclosureRuleInfo
  regeneratesSummaryId: string | null
}

export interface LeadershipSummaryItem {
  summaryId: string
  title: string | null
  from: IsoDate | null
  to: IsoDate | null
  generatedAt: IsoDateTime
  dataThrough: IsoDateTime | null
  /** False when the caller can no longer open it; nothing else about it is revealed. */
  accessible: boolean
  stale: boolean
}

export interface LeadershipSummaryExport {
  summaryId: string
  title: string
  scopeLabel: string
  from: IsoDate
  to: IsoDate
  dataThrough: IsoDateTime | null
  generatedAt: IsoDateTime
  exportedAt: IsoDateTime
  accessLevel: ExecutiveAccessLevel
  definitionVersion: string
  keyFigures: LeadershipFigure[]
  statements: LeadershipStatement[]
  sampleLimitations: string[]
  definitions: OverviewDefinition[]
  citations: ExecutiveCitation[]
  disclosureText: string
}

export interface ExecutiveThemesAdapter {
  executiveThemes(ctx: RequestContext, range?: Partial<DateRange>, facet?: ExecutiveThemeFacet): Promise<ExecutiveThemes>
  executiveTopicMatrix(
    ctx: RequestContext,
    range?: Partial<DateRange>,
    facet?: ExecutiveThemeFacet,
    facetValue?: string | null,
  ): Promise<ExecutiveTopicMatrix>
  /** Generate and save a source-linked leadership summary. Takes several seconds against the real agent. */
  generateLeadershipSummary(ctx: RequestContext, range?: Partial<DateRange>, regeneratesSummaryId?: string | null): Promise<LeadershipSummary>
  /** Reopen a saved summary. Access is re-checked (FORBIDDEN if the scope or permission changed). */
  leadershipSummary(ctx: RequestContext, summaryId: string): Promise<LeadershipSummary>
  myLeadershipSummaries(ctx: RequestContext): Promise<LeadershipSummaryItem[]>
  /** Re-check access, record the audit event, then return a printable snapshot. */
  exportLeadershipSummary(ctx: RequestContext, summaryId: string): Promise<LeadershipSummaryExport>
}

const COUNT = "{ value suppressed }"
const DISCLOSURE = "disclosure { minCell text suppressedCells applied }"
const CITATION = `citationId kind dataset label responses ${COUNT} recordId excerpt interactionDate`

export const EXECUTIVE_THEMES_QUERY = /* GraphQL */ `
  query ExecutiveThemes($from: AWSDate, $to: AWSDate, $facet: ExecutiveThemeFacet) {
    executiveThemes(from: $from, to: $to, facet: $facet) {
      from to priorFrom priorTo dataThrough scopeLabel accessLevel facet facetLabel definitionVersion groupsLeftOut sampleLimitations note
      ${DISCLOSURE}
      groups {
        facetValue freeTextResponses ${COUNT} priorFreeTextResponses ${COUNT} regionCount
        cards {
          cardId facetValue topic responses ${COUNT} priorResponses ${COUNT} distinctHcps ${COUNT} share regionCount trend
          citations { ${CITATION} }
        }
      }
    }
  }
`

export const EXECUTIVE_TOPIC_MATRIX_QUERY = /* GraphQL */ `
  query ExecutiveTopicMatrix($from: AWSDate, $to: AWSDate, $facet: ExecutiveThemeFacet, $facetValue: String) {
    executiveTopicMatrix(from: $from, to: $to, facet: $facet, facetValue: $facetValue) {
      from to priorFrom priorTo dataThrough scopeLabel accessLevel facet facetValue definitionVersion sampleLimitations note
      ${DISCLOSURE}
      thresholds { minWindowResponses minTopicResponses minRelativeIncrease minSharePoints minCell rule approved definitionId version approvedAt }
      regions { regionId regionName territoriesInScope freeTextResponses ${COUNT} priorFreeTextResponses ${COUNT} sampleSufficient }
      rows {
        topic isOther regionsRising regionsFalling crossRegion
        cells { regionId responses ${COUNT} priorResponses ${COUNT} share priorShare sharePointChange trend alert }
      }
    }
  }
`

const SUMMARY_FIELDS = `
  summaryId title from to dataThrough generatedAt scopeLabel scopeTerritoryIds accessLevel definitionVersion modelMode numberCheck
  droppedStatements stale staleReasons currentDataThrough sampleLimitations regeneratesSummaryId
  ${DISCLOSURE}
  keyFigures { label value ${COUNT} citationIds }
  statements { statementId section text citationIds }
  definitions { key label text }
  citations { ${CITATION} }`

export const GENERATE_LEADERSHIP_SUMMARY_MUTATION = /* GraphQL */ `
  mutation GenerateLeadershipSummary($from: AWSDate, $to: AWSDate, $regeneratesSummaryId: ID) {
    generateLeadershipSummary(from: $from, to: $to, regeneratesSummaryId: $regeneratesSummaryId) {${SUMMARY_FIELDS}}
  }
`
export const LEADERSHIP_SUMMARY_QUERY = /* GraphQL */ `
  query LeadershipSummary($summaryId: ID!) { leadershipSummary(summaryId: $summaryId) {${SUMMARY_FIELDS}} }
`
export const MY_LEADERSHIP_SUMMARIES_QUERY = /* GraphQL */ `
  query MyLeadershipSummaries { myLeadershipSummaries { summaryId title from to generatedAt dataThrough accessible stale } }
`
export const EXPORT_LEADERSHIP_SUMMARY_MUTATION = /* GraphQL */ `
  mutation ExportLeadershipSummary($summaryId: ID!) {
    exportLeadershipSummary(summaryId: $summaryId) {
      summaryId title scopeLabel from to dataThrough generatedAt exportedAt accessLevel definitionVersion sampleLimitations disclosureText
      keyFigures { label value ${COUNT} citationIds }
      statements { statementId section text citationIds }
      definitions { key label text }
      citations { ${CITATION} }
    }
  }
`

type Run = <T>(query: string, variables: Record<string, unknown> | undefined, ctx: RequestContext) => Promise<T>

/** Optional values are omitted, never sent as null. */
function windowVars(range?: Partial<DateRange>): Record<string, unknown> {
  const vars: Record<string, unknown> = {}
  if (range?.from) vars.from = range.from
  if (range?.to) vars.to = range.to
  return vars
}

export function createGraphQLExecutiveThemes(run: Run): ExecutiveThemesAdapter {
  return {
    async executiveThemes(ctx, range, facet) {
      const vars = { ...windowVars(range), ...(facet ? { facet } : {}) }
      return (await run<{ executiveThemes: ExecutiveThemes }>(EXECUTIVE_THEMES_QUERY, vars, ctx)).executiveThemes
    },
    async executiveTopicMatrix(ctx, range, facet, facetValue) {
      const vars = { ...windowVars(range), ...(facet ? { facet } : {}), ...(facetValue ? { facetValue } : {}) }
      return (await run<{ executiveTopicMatrix: ExecutiveTopicMatrix }>(EXECUTIVE_TOPIC_MATRIX_QUERY, vars, ctx)).executiveTopicMatrix
    },
    async generateLeadershipSummary(ctx, range, regeneratesSummaryId) {
      const vars = { ...windowVars(range), ...(regeneratesSummaryId ? { regeneratesSummaryId } : {}) }
      return (await run<{ generateLeadershipSummary: LeadershipSummary }>(GENERATE_LEADERSHIP_SUMMARY_MUTATION, vars, ctx)).generateLeadershipSummary
    },
    async leadershipSummary(ctx, summaryId) {
      return (await run<{ leadershipSummary: LeadershipSummary }>(LEADERSHIP_SUMMARY_QUERY, { summaryId }, ctx)).leadershipSummary
    },
    async myLeadershipSummaries(ctx) {
      return (await run<{ myLeadershipSummaries: LeadershipSummaryItem[] }>(MY_LEADERSHIP_SUMMARIES_QUERY, undefined, ctx)).myLeadershipSummaries
    },
    async exportLeadershipSummary(ctx, summaryId) {
      return (await run<{ exportLeadershipSummary: LeadershipSummaryExport }>(EXPORT_LEADERSHIP_SUMMARY_MUTATION, { summaryId }, ctx)).exportLeadershipSummary
    },
  }
}
