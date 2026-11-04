/**
 * Director insights (ticket 11): topic-by-territory heatmap with theme cards, question analytics,
 * emerging-topic monitoring, region -> territory -> HCP drill-down, the exception table and the
 * evidence behind AI territory summaries. Types and GraphQL documents mirror
 * `amplify/data/schema.graphql`; the BE computes every number under row-level security.
 */
import type { DateRange, InsightFilters, IsoDate, IsoDateTime, RequestContext } from "./types"

export type ThemeFacet = "NONE" | "MOLECULE" | "TUMOR_TYPE" | "STUDY" | "SURVEY"
export type EmergingStatus = "EMERGING" | "DECLINING" | "STABLE" | "INSUFFICIENT_SAMPLE"
export type DrilldownLevel = "ROOT" | "REGION" | "TERRITORY"

/** One recorded response that a theme, a flag or a summary cites. Opens as a `hcp_raw_insights` citation. */
export interface InsightEvidence {
  recordId: string
  excerpt: string
  questionText: string | null
  interactionDate: IsoDate | null
  territoryId: string | null
}

export interface HeatmapTerritory {
  territoryId: string
  name: string | null
  regionId: string
  regionName: string
  freeTextResponses: number
}
export interface HeatmapTopic {
  topic: string
  responses: number
  distinctHcps: number
  isOther: boolean
}
export interface HeatmapCell {
  territoryId: string
  topic: string
  responses: number
  distinctHcps: number
  /** Percentage of `territoryResponses`. */
  share: number
  territoryResponses: number
}
export interface ThemeCard {
  cardId: string
  facetValue: string | null
  topic: string
  responses: number
  distinctHcps: number
  territoryCount: number
  share: number
  facetResponses: number
  evidence: InsightEvidence[]
}
export interface TopicHeatmap {
  from: IsoDate
  to: IsoDate
  dataThrough: IsoDateTime | null
  scopeLabel: string
  definitionVersion: string
  facet: ThemeFacet
  facetLabel: string | null
  territories: HeatmapTerritory[]
  topics: HeatmapTopic[]
  cells: HeatmapCell[]
  themeCards: ThemeCard[]
  freeTextResponses: number
  note: string
}

export interface EmergingWindow {
  from: IsoDate
  to: IsoDate
  freeTextResponses: number
}
export interface EmergingThresholds {
  minWindowResponses: number
  minTopicResponses: number
  minRelativeIncrease: number
  minSharePoints: number
  rule: string
}
export interface WeekCount {
  weekStart: IsoDate
  responses: number
}
export interface EmergingTopic {
  territoryId: string | null
  topic: string
  currentResponses: number
  priorResponses: number
  currentTotal: number
  priorTotal: number
  currentShare: number | null
  priorShare: number | null
  sharePointChange: number | null
  status: EmergingStatus
  weeks: WeekCount[]
  evidence: InsightEvidence[]
}
export interface EmergingTopics {
  scopeLabel: string
  definitionVersion: string
  dataThrough: IsoDateTime | null
  current: EmergingWindow
  prior: EmergingWindow
  thresholds: EmergingThresholds
  sampleSufficient: boolean
  topics: EmergingTopic[]
  statement: string
}

export interface QuestionOption {
  questionId: string
  questionText: string
  questionType: string | null
  parentQuestionId: string | null
  molecule: string | null
  responses: number
  distinctHcps: number
}
export interface ResponseBar {
  label: string
  responses: number
  distinctHcps: number
  percentage: number
}
export interface TerritoryQuestionCount {
  territoryId: string
  responses: number
  distinctHcps: number
}
export interface NumericSummary {
  min: number
  median: number
  max: number
  answered: number
}
export interface ParentAnswer {
  answer: string
  responses: number
}
export interface ParentContext {
  questionId: string
  questionText: string | null
  questionType: string | null
  inCatalog: boolean
  answerBreakdown: ParentAnswer[]
  note: string
}
export interface FollowUpQuestion {
  questionId: string
  questionText: string
  responses: number
}
export interface QuestionDetail extends QuestionOption {
  denominator: number
  bars: ResponseBar[]
  barNote: string
  territories: TerritoryQuestionCount[]
  numericSummary: NumericSummary | null
  parent: ParentContext | null
  followUps: FollowUpQuestion[]
  catalog: { status: string | null; tumorType: string | null; survey: string | null; study: string | null } | null
}
export interface QuestionAnalytics {
  scopeLabel: string
  definitionVersion: string
  from: IsoDate
  to: IsoDate
  dataThrough: IsoDateTime | null
  options: QuestionOption[]
  /** Null when the question has no responses in this scope and window (the BE does not say which). */
  selected: QuestionDetail | null
}

export interface DrillCrumb {
  level: string
  id: string
  label: string
}
export interface DrillChild {
  id: string
  label: string
  /** REGION, TERRITORY or HCP. An HCP opens its interaction and response timeline. */
  level: "REGION" | "TERRITORY" | "HCP"
  childLabel: string
  childCount: number
  distinctCalls: number
  distinctEngagedHcps: number
  responses: number
  lastInteractionDate: IsoDate | null
}
export interface DirectorDrilldown {
  level: DrilldownLevel
  id: string
  scopeLabel: string
  from: IsoDate
  to: IsoDate
  dataThrough: IsoDateTime | null
  breadcrumb: DrillCrumb[]
  children: DrillChild[]
  totalChildren: number
  truncated: boolean
  note: string
}

export type ExceptionCategoryCode =
  | "STALE_LOAD"
  | "MISSING_JOIN"
  | "UNRESOLVED_IDENTITY"
  | "DUPLICATE_KEY"
  | "STATUS_DIFFERENCE"
  | "MISSING_REPORTING"
export interface ExceptionCategory {
  category: ExceptionCategoryCode
  label: string
  rule: string
  count: number
}
export interface DirectorException {
  exceptionId: string
  category: ExceptionCategoryCode
  categoryLabel: string
  severity: "high" | "medium" | "low"
  title: string
  detail: string
  territoryId: string | null
  affectedCount: number
  sourceTable: string
  sampleRecordIds: string[]
  rule: string
}
export interface DirectorExceptions {
  scopeLabel: string
  from: IsoDate
  to: IsoDate
  dataThrough: IsoDateTime | null
  definitionVersion: string
  categories: ExceptionCategory[]
  exceptions: DirectorException[]
  note: string
}

export interface SummaryTheme {
  topic: string
  currentResponses: number
  priorResponses: number
  currentTotal: number
  priorTotal: number
  currentShare: number | null
  priorShare: number | null
  sharePointChange: number | null
  status: EmergingStatus
  evidence: InsightEvidence[]
}
export interface FlaggedTopic {
  topic: string
  status: EmergingStatus
  currentResponses: number
  priorResponses: number
}
export interface TerritorySummaryEvidence {
  territoryId: string
  name: string | null
  regionId: string
  regionName: string
  distinctCalls: number
  distinctEngagedHcps: number
  responses: number
  freeTextResponses: number
  priorFreeTextResponses: number
  topThemes: SummaryTheme[]
  flagged: FlaggedTopic[]
}
export interface TerritorySummaries {
  scopeLabel: string
  definitionVersion: string
  from: IsoDate
  to: IsoDate
  priorFrom: IsoDate
  priorTo: IsoDate
  dataThrough: IsoDateTime | null
  territories: TerritorySummaryEvidence[]
  note: string
}

/** What the chat is told about the screen it was opened from. Defaults for the agent, never authority. */
export interface ChatContext {
  view?: string
  territoryId?: string
  questionId?: string
  from?: IsoDate
  to?: IsoDate
  intent?: "FREE" | "TERRITORY_SUMMARY"
}

export interface DirectorInsightsAdapter {
  topicHeatmap(ctx: RequestContext, args?: { range?: Partial<DateRange>; filters?: InsightFilters; facet?: ThemeFacet }): Promise<TopicHeatmap>
  questionAnalytics(
    ctx: RequestContext,
    args?: { range?: Partial<DateRange>; filters?: InsightFilters; questionId?: string | null },
  ): Promise<QuestionAnalytics>
  emergingTopics(ctx: RequestContext, args?: { range?: Partial<DateRange>; filters?: InsightFilters }): Promise<EmergingTopics>
  directorDrilldown(
    ctx: RequestContext,
    args?: { level?: DrilldownLevel; id?: string | null; range?: Partial<DateRange> },
  ): Promise<DirectorDrilldown>
  directorExceptions(ctx: RequestContext, range?: Partial<DateRange>): Promise<DirectorExceptions>
  territorySummaryEvidence(ctx: RequestContext, range?: Partial<DateRange>): Promise<TerritorySummaries>
}

const EVIDENCE = "recordId excerpt questionText interactionDate territoryId"

export const TOPIC_HEATMAP_QUERY = /* GraphQL */ `
  query TopicHeatmap($from: AWSDate, $to: AWSDate, $filters: InsightFiltersInput, $facet: ThemeFacet) {
    topicHeatmap(from: $from, to: $to, filters: $filters, facet: $facet) {
      from to dataThrough scopeLabel definitionVersion facet facetLabel freeTextResponses note
      territories { territoryId name regionId regionName freeTextResponses }
      topics { topic responses distinctHcps isOther }
      cells { territoryId topic responses distinctHcps share territoryResponses }
      themeCards { cardId facetValue topic responses distinctHcps territoryCount share facetResponses evidence { ${EVIDENCE} } }
    }
  }
`

export const QUESTION_ANALYTICS_QUERY = /* GraphQL */ `
  query QuestionAnalytics($from: AWSDate, $to: AWSDate, $filters: InsightFiltersInput, $questionId: ID) {
    questionAnalytics(from: $from, to: $to, filters: $filters, questionId: $questionId) {
      scopeLabel definitionVersion from to dataThrough
      options { questionId questionText questionType parentQuestionId molecule responses distinctHcps }
      selected {
        questionId questionText questionType parentQuestionId molecule responses distinctHcps denominator barNote
        bars { label responses distinctHcps percentage }
        territories { territoryId responses distinctHcps }
        numericSummary { min median max answered }
        parent { questionId questionText questionType inCatalog note answerBreakdown { answer responses } }
        followUps { questionId questionText responses }
        catalog { status tumorType survey study }
      }
    }
  }
`

export const EMERGING_TOPICS_QUERY = /* GraphQL */ `
  query EmergingTopics($from: AWSDate, $to: AWSDate, $filters: InsightFiltersInput) {
    emergingTopics(from: $from, to: $to, filters: $filters) {
      scopeLabel definitionVersion dataThrough sampleSufficient statement
      current { from to freeTextResponses }
      prior { from to freeTextResponses }
      thresholds { minWindowResponses minTopicResponses minRelativeIncrease minSharePoints rule }
      topics {
        territoryId topic currentResponses priorResponses currentTotal priorTotal currentShare priorShare sharePointChange status
        weeks { weekStart responses }
        evidence { ${EVIDENCE} }
      }
    }
  }
`

export const DIRECTOR_DRILLDOWN_QUERY = /* GraphQL */ `
  query DirectorDrilldown($level: DrilldownLevel, $id: ID, $from: AWSDate, $to: AWSDate) {
    directorDrilldown(level: $level, id: $id, from: $from, to: $to) {
      level id scopeLabel from to dataThrough totalChildren truncated note
      breadcrumb { level id label }
      children { id label level childLabel childCount distinctCalls distinctEngagedHcps responses lastInteractionDate }
    }
  }
`

export const DIRECTOR_EXCEPTIONS_QUERY = /* GraphQL */ `
  query DirectorExceptions($from: AWSDate, $to: AWSDate) {
    directorExceptions(from: $from, to: $to) {
      scopeLabel from to dataThrough definitionVersion note
      categories { category label rule count }
      exceptions { exceptionId category categoryLabel severity title detail territoryId affectedCount sourceTable sampleRecordIds rule }
    }
  }
`

export const TERRITORY_SUMMARY_EVIDENCE_QUERY = /* GraphQL */ `
  query TerritorySummaryEvidence($from: AWSDate, $to: AWSDate) {
    territorySummaryEvidence(from: $from, to: $to) {
      scopeLabel definitionVersion from to priorFrom priorTo dataThrough note
      territories {
        territoryId name regionId regionName distinctCalls distinctEngagedHcps responses freeTextResponses priorFreeTextResponses
        flagged { topic status currentResponses priorResponses }
        topThemes {
          topic currentResponses priorResponses currentTotal priorTotal currentShare priorShare sharePointChange status
          evidence { ${EVIDENCE} }
        }
      }
    }
  }
`

type Run = <T>(query: string, variables: Record<string, unknown> | undefined, ctx: RequestContext) => Promise<T>

/** Variables for the shared window and filter arguments. Optional values are omitted, never null. */
function windowVars(range?: Partial<DateRange>, filters?: InsightFilters): Record<string, unknown> {
  const vars: Record<string, unknown> = {}
  if (range?.from) vars.from = range.from
  if (range?.to) vars.to = range.to
  if (filters) {
    // The window travels as from/to; the filter object carries the facets only.
    const facets = Object.fromEntries(Object.entries(filters).filter(([key, value]) => value && key !== "from" && key !== "to"))
    if (Object.keys(facets).length) vars.filters = facets
  }
  return vars
}

export function createGraphQLDirectorInsights(run: Run): DirectorInsightsAdapter {
  return {
    async topicHeatmap(ctx, args) {
      const vars = { ...windowVars(args?.range, args?.filters), ...(args?.facet && args.facet !== "NONE" ? { facet: args.facet } : {}) }
      return (await run<{ topicHeatmap: TopicHeatmap }>(TOPIC_HEATMAP_QUERY, vars, ctx)).topicHeatmap
    },
    async questionAnalytics(ctx, args) {
      const vars = { ...windowVars(args?.range, args?.filters), ...(args?.questionId ? { questionId: args.questionId } : {}) }
      return (await run<{ questionAnalytics: QuestionAnalytics }>(QUESTION_ANALYTICS_QUERY, vars, ctx)).questionAnalytics
    },
    async emergingTopics(ctx, args) {
      return (await run<{ emergingTopics: EmergingTopics }>(EMERGING_TOPICS_QUERY, windowVars(args?.range, args?.filters), ctx)).emergingTopics
    },
    async directorDrilldown(ctx, args) {
      const vars = { ...windowVars(args?.range), level: args?.level ?? "ROOT", ...(args?.id ? { id: args.id } : {}) }
      return (await run<{ directorDrilldown: DirectorDrilldown }>(DIRECTOR_DRILLDOWN_QUERY, vars, ctx)).directorDrilldown
    },
    async directorExceptions(ctx, range) {
      return (await run<{ directorExceptions: DirectorExceptions }>(DIRECTOR_EXCEPTIONS_QUERY, windowVars(range), ctx)).directorExceptions
    },
    async territorySummaryEvidence(ctx, range) {
      return (await run<{ territorySummaryEvidence: TerritorySummaries }>(TERRITORY_SUMMARY_EVIDENCE_QUERY, windowVars(range), ctx)).territorySummaryEvidence
    },
  }
}
