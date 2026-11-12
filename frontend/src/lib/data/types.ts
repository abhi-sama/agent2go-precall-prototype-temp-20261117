/**
 * Types mirroring the foundation GraphQL contract (AppSync, owned by a2g-foundation):
 *
 *   type LandingKpis { distinctCalls: Int!, distinctEngagedHcps: Int!, responseCount: Int!,
 *                      from: AWSDate!, to: AWSDate!, dataThrough: AWSDateTime, scopeLabel: String! }
 *   type Me { userId: ID!, fullName: String!, email: String!, persona: String!, scopeLabel: String! }
 *   type Query { me: Me!, landingKpis(from: AWSDate, to: AWSDate): LandingKpis! }
 *
 * `geoActivity` extends the contract for the territory map (schema.graphql has the full types).
 */

export const PERSONAS = ["msl", "director", "executive", "admin"] as const
export type Persona = (typeof PERSONAS)[number]

/** AWSDate: `YYYY-MM-DD`. */
export type IsoDate = string
/** AWSDateTime: ISO 8601 with offset. */
export type IsoDateTime = string

export interface Me {
  userId: string
  fullName: string
  email: string
  /** Contract returns a string; the shell narrows it to a known persona or "unknown". */
  persona: string
  scopeLabel: string
}

export interface LandingKpis {
  distinctCalls: number
  distinctEngagedHcps: number
  responseCount: number
  from: IsoDate
  to: IsoDate
  dataThrough: IsoDateTime | null
  scopeLabel: string
}

export interface DateRange {
  from: IsoDate
  to: IsoDate
}

/** Filter state shared by every analytics surface. Values are source identifiers, never labels. */
export interface InsightFilters extends Partial<DateRange> {
  territoryId?: string
  molecule?: string
  landscape?: string
  study?: string
  survey?: string
  questionId?: string
}

export interface FilterOption {
  value: string
  label: string
}

export interface FilterOptions {
  territories: FilterOption[]
  molecules: FilterOption[]
  landscapes: FilterOption[]
  studies: FilterOption[]
  surveys: FilterOption[]
  questions: FilterOption[]
}

/** Rows are intentionally returned per question: unlike-looking prompts are never merged. */
export interface ResponseDistribution {
  questionId: string
  questionText: string
  parentQuestionId: string | null
  response: string
  count: number
  denominator: number
  percentage: number
}

export interface CatalogQuestion {
  questionId: string
  questionText: string
  topic: string | null
  molecule: string | null
  tumorType: string | null
  study: string | null
  survey: string | null
  status: string
  effectiveFrom: IsoDateTime | null
  effectiveTo: IsoDateTime | null
  applicability: string
}

export interface InsightDiscovery {
  scopeLabel: string
  options: FilterOptions
  distributions: ResponseDistribution[]
  questions: CatalogQuestion[]
  themes: QualitativeTheme[]
  followUpTopics: FollowUpTopic[]
}

/** Derived from recorded responses; never a source fact or confirmed conclusion. */
export interface QualitativeTheme { name: string; responseCount: number; excerpt: string; recordId: string; questionText: string | null }
/** A possible topic, explicitly separate from a confirmed follow-up action. */
export interface FollowUpTopic { topic: string; evidenceCount: number; excerpt: string; recordId: string }
export interface SemanticInsightResult { responseId: string; questionText: string; responseText: string; interactionDate: IsoDate; territoryId: string; score: number }

export interface SavedView {
  savedViewId: string
  name: string
  reportKind: string
  filters: InsightFilters
  createdAt: IsoDateTime
}

/** Style "auto" means the persona's default; density "auto" means the device's. "device" mode follows the OS. */
export type StylePref = "auto" | "warm" | "clinical"
export type ModePref = "device" | "light" | "charcoal" | "black"
export type DensityPref = "auto" | "comfortable" | "compact"

/** A person's saved look. Saved per user in FE DynamoDB; `null` from `myAppearance` means they never chose. */
export interface AppearanceChoice {
  style: StylePref
  mode: ModePref
  density: DensityPref
}
export interface SavedAppearance extends AppearanceChoice {
  updatedAt: IsoDateTime
}

/** Optional post-call draft. Lines are a lossless rendering of entered notes, never generated observations. */
export interface PostCallDraft {
  draftId: string
  notes: string
  structuredLines: string[]
  status: string
  createdAt: IsoDateTime
}

/** A task appears only after an explicit confirmation mutation. */
export interface FollowUpTask {
  taskId: string
  description: string
  ownerUserId: string
  dueDate: IsoDate | null
  status: "OPEN" | "IN_PROGRESS" | "DONE"
  sourceDraftId: string | null
  createdAt: IsoDateTime
}

export interface ConfirmFollowUpTaskInput {
  description: string
  dueDate?: IsoDate | null
  sourceDraftId?: string | null
}

export interface TopicAlertRule {
  ruleId: string
  topic: string
  threshold: number
  periodDays: number
  createdAt: IsoDateTime
}

/** A deterministic count over permitted source records plus response-id evidence. */
export interface TopicAlert {
  ruleId: string
  topic: string
  threshold: number
  periodDays: number
  count: number
  evidenceResponseIds: string[]
}

export interface RequestContext {
  /** Sent with every call so FE and BE logs join up. */
  correlationId: string
}

/**
 * Territory map data (`geoActivity` query). The API returns only territories in the caller's
 * effective scope, so there is nothing to lock or hide on the client: whatever arrives may be shown.
 */
export interface GeoTerritory {
  territoryId: string
  /** The territory's primary city. */
  name: string
  regionId: string
  regionName: string
  /** ISO 3166-1 alpha-2. */
  countryCode: string
  countryName: string
  /** USPS code for the United States, the local code elsewhere. */
  subdivisionCode: string
  subdivisionName: string
  latitude: number
  longitude: number
  isOwn: boolean
  /** Null when `suppressed`: an aggregate-only viewer is never shown a small group. */
  distinctCalls: number | null
  suppressed: boolean
}

/** Distinct calls across a country's in-scope territories (counted once, not summed per territory). */
export interface GeoCountry {
  countryCode: string
  countryName: string
  territoryCount: number
  distinctCalls: number | null
  suppressed: boolean
}

export interface GeoActivity extends DateRange {
  dataThrough: IsoDateTime | null
  scopeLabel: string
  territories: GeoTerritory[]
  countries: GeoCountry[]
}

/** One calendar month of the caller's activity. Counts only: there is no target, rank or score. */
export interface ActivityMonth {
  /** First day of the month, `YYYY-MM-01`. */
  month: IsoDate
  distinctCalls: number
  /** Distinct within the month: months do not add up to the window total. */
  distinctEngagedHcps: number
  /** True while data-through has not yet covered the whole month. */
  isPartial: boolean
  channels: ChannelCount[]
}

export interface ChannelCount {
  channel: string
  distinctCalls: number
}

export interface ActivityTrends {
  from: IsoDate
  to: IsoDate
  months: ActivityMonth[]
  /** Every channel seen in the window, for a stable legend. */
  channels: string[]
  totalDistinctCalls: number
  totalDistinctEngagedHcps: number
  dataThrough: IsoDateTime | null
  scopeLabel: string
}

export type ActivityMetric = "CALLS" | "HCPS"

/** A record behind a chart point. The interaction date and the load date are different things. */
export interface EvidenceRecord {
  recordId: string
  kind: "CALL" | "HCP"
  hcpId: string | null
  hcpName: string | null
  territoryId: string | null
  channel: string | null
  callCount: number
  /** When the exchange happened. */
  interactionDate: IsoDate
  /** When the record reached this system. */
  loadedAt: IsoDateTime | null
}

export interface ActivityEvidence {
  metric: ActivityMetric
  month: IsoDate
  channel: string | null
  total: number
  truncated: boolean
  latestInteractionDate: IsoDate | null
  latestLoadedAt: IsoDateTime | null
  dataThrough: IsoDateTime | null
  scopeLabel: string
  records: EvidenceRecord[]
}

export const FLAG_KINDS = ["IDENTIFIER", "TERRITORY_ASSIGNMENT", "SUMMARY"] as const
export type FlagKind = (typeof FLAG_KINDS)[number]
export type FlagTargetType = "SUMMARY" | "CALL" | "HCP" | "TERRITORY"
export type FlagStatus = "OPEN" | "IN_REVIEW" | "RESOLVED" | "DISMISSED"

export interface Flag {
  flagId: string
  kind: FlagKind
  targetType: FlagTargetType
  targetId: string
  note: string | null
  status: FlagStatus
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  scopeLabel?: string | null
  dataThrough?: IsoDateTime | null
}

export interface FlagInput {
  kind: FlagKind
  targetType: FlagTargetType
  targetId: string
  note?: string | null
}

export type HcpFieldState = "PRESENT" | "MISSING"
export interface HcpField { value: string | null; state: HcpFieldState }
export interface HcpSearchResult { hcpId: string; name: HcpField; institution: HcpField; territory: HcpField }
export interface HcpProfile { hcpId: string; name: HcpField; specialty: HcpField; discipline: HcpField; type: HcpField; institution: HcpField; credentials: HcpField; territory: HcpField }

export interface IdentityMatch {
  userId: string
  displayName: string
  identityStatus: string
  rosterSourceRowId: string | null
  rosterName: string | null
  exactEmailCandidateCount: number
  candidateRosterSourceRowIds: string[]
  /** matched, missing, or conflicting; candidates are never a mapping by themselves. */
  flag: string
}

export interface PermissionGrant {
  permissionCode: string
  description: string
}

export interface RolePermissionMatrix {
  roleId: string
  roleName: string
  permissions: PermissionGrant[]
}

export interface ScopeAssignment {
  assignmentId: string
  userId: string
  displayName: string
  territoryId: string
  assignmentType: string
  effectiveFrom: IsoDateTime
  effectiveTo: IsoDateTime | null
  unresolvedTerritory: boolean
}

export interface AccessAuditEvent {
  eventId: string
  actorUserId: string | null
  action: string
  resourceType: string
  resourceId: string | null
  outcome: string
  occurredAt: IsoDateTime
}

export interface AdminAccessOverview {
  identityMatches: IdentityMatch[]
  availablePermissions: PermissionGrant[]
  roleMatrix: RolePermissionMatrix[]
  scopeAssignments: ScopeAssignment[]
}

export interface AccessAuditFilter {
  actorUserId?: string
  action?: string
  resourceType?: string
  outcome?: string
  from?: IsoDateTime
  to?: IsoDateTime
}

export interface ScopeAssignmentInput {
  userId: string
  territoryId: string
  assignmentType: string
  effectiveFrom: IsoDateTime
  effectiveTo?: IsoDateTime
}

export interface HcpField {
  value: string | null
  state: "PRESENT" | "MISSING"
}

export interface HcpSearchResult {
  hcpId: string
  name: HcpField
  institution: HcpField
  territory: HcpField
}

export interface HcpProfile {
  hcpId: string
  name: HcpField
  specialty: HcpField
  discipline: HcpField
  type: HcpField
  institution: HcpField
  credentials: HcpField
  territory: HcpField
}

export interface IngestionRun {
  runId: string
  sourceId: string
  sourceName: string
  /** completed, failed, running, or stale; stale is derived by the API. */
  status: string
  startedAt: IsoDateTime
  completedAt: IsoDateTime | null
  recordsLoaded: number
  errorSummary: string | null
}

/** Administrator-only operational metadata for one source dataset. */
export interface IngestionSource {
  sourceId: string
  sourceName: string
  /** Latest source-record load date for this source dataset. */
  loadDate: IsoDateTime | null
  /** Latest time every monitored source dataset is loaded through. */
  dataThrough: IsoDateTime | null
  /** Latest run first; contains no source records. */
  ingestionRuns: IngestionRun[]
}

export interface QualityRecord {
  recordId: string
  sourceTable: string
  sourceRecordId: string
  label: string
}

export interface DataQualityIssue {
  issueId: string
  category: string
  severity: string
  title: string
  summary: string
  affectedCount: number
  records: QualityRecord[]
}

export interface QuestionDependencyNode {
  questionId: string
  parentQuestionId: string | null
  state: string
}

export interface AdminDataQuality {
  ingestionRuns: IngestionRun[]
  identities: { matched: number; unmatched: number }
  duplicateKeyCount: number
  recordGrain: { callProductRows: number; distinctCalls: number }
  issues: DataQualityIssue[]
  questionGraph: { missingParentCount: number; duplicateKeyCount: number; cycleCount: number; nodes: QuestionDependencyNode[] }
}

export interface AdminIngestionRuns {
  sources: IngestionSource[]
}

/** A local-stack AppSync assertion recorded in the Administrator verification grid. */
export interface AuthorizationVerificationResult {
  testId: string
  persona: string
  accessPath: string
  scopeScenario: "in_scope" | "out_of_scope" | "after_transfer" | "coverage_expired"
  expectation: string
  status: "PASS" | "FAIL"
}

export interface AuthorizationVerificationGrid {
  suiteId: string
  localOnly: boolean
  total: number
  passed: number
  results: AuthorizationVerificationResult[]
}

/** Coverage is withheld (never estimated) when no approved target population exists. */
export type CoverageStatus = "AVAILABLE" | "NO_TARGET_POPULATION"

export interface TerritoryCoverage {
  status: CoverageStatus
  targetHcps: number | null
  engagedTargetHcps: number | null
  /** Null unless status is AVAILABLE. */
  percentage: number | null
}

export interface ScopeCoverage extends TerritoryCoverage {
  territoriesWithTargets: number
  territoriesInScope: number
  asOf: IsoDate
}

export interface OverviewDefinition {
  key: string
  label: string
  text: string
}

/** A deterministic statement about the data, never generated. */
export interface Disclosure {
  code: string
  message: string
}

export interface DirectorKpis {
  distinctCalls: number
  distinctEngagedHcps: number
  /** Source rows, one per product discussed. Never a call count. */
  callProductRows: number
  responseCount: number
  reportingMembers: number
  territoriesInScope: number
  territoriesWithActivity: number
  unattributedCalls: number
  /** 0..1, or null when there is nobody to measure. */
  reportingCompleteness: number | null
}

export interface TeamMonth {
  month: IsoDate
  isPartial: boolean
  distinctCalls: number
  distinctEngagedHcps: number
}

export interface MonthCount {
  month: IsoDate
  distinctCalls: number
}

export interface TerritoryRow {
  territoryId: string
  name: string
  regionId: string
  regionName: string
  distinctCalls: number
  distinctEngagedHcps: number
  callProductRows: number
  responseCount: number
  reportingMembers: number
  rosteredMembers: number
  callsPerReportingMember: number | null
  reportingCompleteness: number | null
  latestLoadDate: IsoDate | null
  coverage: TerritoryCoverage
}

export interface TeamMember {
  memberId: string
  name: string
  linkedToRoster: boolean
  territoryIds: string[]
  distinctCalls: number
  activeMonths: number
  expectedMonths: number
  reportingCompleteness: number
  months: MonthCount[]
}

export type MixDimensionKind = "CHANNEL" | "TOPIC" | "DISEASE_STATE" | "PRODUCT"

export interface MixValue {
  value: string
  distinctCalls: number
  callProductRows: number
  months: MonthCount[]
}

export interface MixDimension {
  dimension: MixDimensionKind
  label: string
  totalDistinctCalls: number
  /** Sum over all values; larger than totalDistinctCalls when a call carries several values. */
  valueTotal: number
  valuesOverlap: boolean
  values: MixValue[]
}

export interface DirectorOverview {
  from: IsoDate
  to: IsoDate
  dataThrough: IsoDateTime | null
  scopeLabel: string
  definitionVersion: string
  definitions: OverviewDefinition[]
  kpis: DirectorKpis
  months: TeamMonth[]
  territories: TerritoryRow[]
  members: TeamMember[]
  mix: MixDimension[]
  coverage: ScopeCoverage
  notes: Disclosure[]
}

export interface TerritoryComparison {
  from: IsoDate
  to: IsoDate
  dataThrough: IsoDateTime | null
  scopeLabel: string
  definitionVersion: string
  definitions: OverviewDefinition[]
  territories: TerritoryRow[]
  populationsUnequal: boolean
  disclosures: Disclosure[]
}

/** A CRM call consolidated from the source's repeated call-product rows. */
export interface HcpCallInteraction {
  callId: string
  interactionDate: IsoDate
  channels: string[]
  types: string[]
  statuses: string[]
  products: string[]
  topics: string[]
  /** The original CRM call id, retained for source evidence. */
  sourceRecordId: string
}

/** A source response. It is only nested if its parent response is in the same insight interaction. */
export interface HcpResponse {
  responseId: string
  interactionId: string
  parentResponseId: string | null
  questionId: string
  question: string
  answer: string
  interactionDate: IsoDate
  /** The original response record identifier, not a generated summary id. */
  sourceRecordId: string
}

/** A chronological comparison of original answers to one compatible catalog question. */
export interface HcpPerspective {
  questionId: string
  question: string
  answers: HcpResponse[]
}

export interface HcpTimeline {
  hcpId: string
  interactions: HcpCallInteraction[]
  responses: HcpResponse[]
  perspectives: HcpPerspective[]
}

export type DataErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "BAD_REQUEST"
  | "NO_SCOPE"
  | "NOT_FOUND"
  | "UNAVAILABLE"
  | "TIMEOUT"
  | "UNKNOWN"

export class DataError extends Error {
  readonly code: DataErrorCode
  readonly correlationId?: string
  constructor(code: DataErrorCode, message: string, correlationId?: string) {
    super(message)
    this.name = "DataError"
    this.code = code
    this.correlationId = correlationId
  }
}

export function toDataError(err: unknown, correlationId?: string): DataError {
  if (err instanceof DataError) return err
  return new DataError("UNKNOWN", "Something went wrong while loading data.", correlationId)
}

/** A chat run the BE accepted; its answer is read with `chatEvents`. */
export interface ChatRun {
  runId: string
  status: string
}

export interface ChatMessageInput {
  role: "user" | "assistant"
  content: string
}

/** One page of the run's AG-UI events. `data` is the event, JSON-encoded. */
export interface ChatEventPage {
  events: { seq: number; data: string }[]
  /** True once the run has ended and every event has been returned. */
  done: boolean
  status: string
}

export interface SourceRecord {
  dataset: string
  recordId: string
  title: string
  fields: { label: string; value: string }[]
  dataThrough: IsoDateTime | null
}

/** What one row of a "Show rows" table is: a call, an HCP or a recorded response. */
export type ChatRowKind = "CALLS" | "HCPS" | "RESPONSES"
export type ChatRowColumnType = "TEXT" | "DATE" | "NUMBER"
export type ChatRowSortDir = "ASC" | "DESC"

export interface ChatRowColumn {
  key: string
  label: string
  type: ChatRowColumnType
}

export interface ChatRow {
  id: string
  /** One cell per column, null where the source holds nothing. */
  cells: (string | null)[]
}

export interface ChatRowsQuery {
  runId: string
  rowSetId: string
  sortBy?: string
  sortDir?: ChatRowSortDir
  offset?: number
  limit?: number
}

/**
 * One sorted page of the exact rows behind a figure in a chat answer (docs/adr/0015). `total` is counted now from the
 * rows; `answerCount` is the figure the answer stated, so a difference means the data changed since the answer.
 */
export interface ChatRowsPage {
  rowSetId: string
  kind: ChatRowKind
  label: string
  scope: string
  period: string
  /** What one row is. */
  definition: string
  total: number
  answerCount: number
  columns: ChatRowColumn[]
  rows: ChatRow[]
  offset: number
  limit: number
  sortBy: string
  sortDir: ChatRowSortDir
  /** True when the caller holds the chat row export permission. */
  canExport: boolean
  dataThrough: IsoDateTime | null
}

/** A CSV of the rows behind a figure, created only after access and the export permission were re-checked and audited. */
export interface ChatRowsExport {
  rowSetId: string
  fileName: string
  mimeType: string
  content: string
  rowCount: number
  total: number
  truncated: boolean
  exportedAt: IsoDateTime
}

// ---- Pre-call brief (ticket 05, docs/adr/0009) ----------------------------------------------

export type BriefOrigin = "GENERATED" | "USER"
export type BriefStaleReason = "HCP_DATA_CHANGED" | "NEWER_DATA_LOADED"

/** A value read from source records, shown plainly with the records behind it. */
export interface BriefFact { label: string; value: string; evidenceIds: string[] }
/** Generated text. Every statement cites at least one evidence id. */
export interface BriefStatement { statementId: string; text: string; evidenceIds: string[] }
/** A generated suggestion (discussion prompt or agenda item) the MSL can edit, remove or extend. */
export interface BriefItem { itemId: string; text: string; detail: string | null; evidenceIds: string[]; origin: BriefOrigin; edited: boolean }
export interface BriefMissing { code: string; message: string }
export interface BriefEvidence { evidenceId: string; dataset: string; recordId: string; label: string; date: IsoDate | null }

export interface PreCallBrief {
  briefId: string
  hcpId: string
  hcpName: HcpField
  objective: string
  ownerUserId: string
  scopeLabel: string
  scopeTerritoryIds: string[]
  dataThrough: IsoDateTime | null
  generatedAt: IsoDateTime
  updatedAt: IsoDateTime
  /** `claude`, or `stub` when no model was available (labelled so it is never mistaken for a model's work). */
  modelMode: string
  numberCheck: string
  droppedStatements: number
  stale: boolean
  staleReasons: BriefStaleReason[]
  currentDataThrough: IsoDateTime | null
  lastInteractionDate: IsoDate | null
  facts: BriefFact[]
  engagement: BriefStatement[]
  perspectives: BriefStatement[]
  followUps: BriefStatement[]
  prompts: BriefItem[]
  agenda: BriefItem[]
  missing: BriefMissing[]
  evidence: BriefEvidence[]
  regeneratesBriefId: string | null
}

/** One row of the saved-brief list. A brief for an HCP the caller can no longer see shows nothing about it. */
export interface BriefSummary {
  briefId: string
  hcpId: string | null
  hcpName: HcpField | null
  objective: string | null
  generatedAt: IsoDateTime
  dataThrough: IsoDateTime | null
  accessible: boolean
  stale: boolean
}

export interface BriefItemInput { itemId?: string | null; text: string; detail?: string | null }
export interface BriefEditInput { briefId: string; objective?: string; prompts?: BriefItemInput[]; agenda?: BriefItemInput[] }
export interface GenerateBriefInput { hcpId: string; objective: string; regeneratesBriefId?: string | null }

/** A server-authorized, printable brief snapshot. Its fields come from the saved brief, not unsaved browser edits. */
export interface BriefExport {
  briefId: string
  hcpName: string
  objective: string
  scopeLabel: string
  dateRangeFrom: IsoDate | null
  dateRangeTo: IsoDate | null
  dataThrough: IsoDateTime | null
  generatedAt: IsoDateTime
  exportedAt: IsoDateTime
  facts: BriefFact[]
  engagement: BriefStatement[]
  perspectives: BriefStatement[]
  followUps: BriefStatement[]
  prompts: BriefItem[]
  agenda: BriefItem[]
  missing: BriefMissing[]
  citations: BriefEvidence[]
}
// --- Executive overview (ticket 12): aggregate-only, small groups withheld --------------------------

/** A count that may be withheld: `value` is null exactly when `suppressed` is true. */
export interface SuppressedCount {
  value: number | null
  suppressed: boolean
}

export type ExecutiveAccessLevel = "AGGREGATE_ONLY" | "RECORD_DRILLDOWN"
export const EXECUTIVE_RANK_BY = ["CALLS", "RESPONSES", "ENGAGED_HCPS", "CALLS_PER_TERRITORY", "COMPLETENESS"] as const
export type ExecutiveRankBy = (typeof EXECUTIVE_RANK_BY)[number]
export type ExecutiveFreshnessStatus = "CURRENT" | "PARTIAL" | "NO_DATA"

export interface ExecutiveKpis {
  calls: SuppressedCount
  responses: SuppressedCount
  engagedHcps: SuppressedCount
  regionsInScope: number
  territoriesInScope: number
  /** Percent (0 to 100) of territory-months with at least one recorded call. */
  reportingCompleteness: number | null
}

export interface ExecutiveMonth {
  month: IsoDate
  isPartial: boolean
  calls: SuppressedCount
  responses: SuppressedCount
  engagedHcps: SuppressedCount
  territoriesReporting: number
  territoriesInScope: number
  reportingCompleteness: number
}

export interface ExecutiveUnit {
  /** Null when the ranking value is withheld. */
  rank: number | null
  id: string
  name: string
  level: "REGION" | "TERRITORY"
  regionId: string
  regionName: string
  territoriesInScope: number
  calls: SuppressedCount
  responses: SuppressedCount
  engagedHcps: SuppressedCount
  callsPerTerritory: number | null
  reportingCompleteness: number | null
}

export interface ExecutiveEngagement {
  engagedHcps: SuppressedCount
  callsPerEngagedHcp: number | null
  depth: { band: string; hcps: SuppressedCount }[]
  channels: { channel: string; calls: SuppressedCount }[]
  coverage: { status: "AVAILABLE" | "NO_TARGET_POPULATION" | "SUPPRESSED"; percentage: number | null; territoriesWithTargets: number; territoriesInScope: number }
}

export interface ExecutiveOverview {
  from: IsoDate
  to: IsoDate
  dataThrough: string | null
  scopeLabel: string
  accessLevel: ExecutiveAccessLevel
  drilldownAllowed: boolean
  definitionVersion: string
  definitions: OverviewDefinition[]
  disclosure: { minCell: number; text: string; suppressedCells: number; applied: boolean }
  rankBy: ExecutiveRankBy
  kpis: ExecutiveKpis
  freshness: {
    status: ExecutiveFreshnessStatus
    callsLoadedThrough: string | null
    responsesLoadedThrough: string | null
    sourceLagDays: number | null
    monthsShown: number
  }
  months: ExecutiveMonth[]
  regions: ExecutiveUnit[]
  territories: ExecutiveUnit[]
  engagement: ExecutiveEngagement
  notes: Disclosure[]
}

export interface ExecutiveOverviewInput {
  from?: IsoDate
  to?: IsoDate
  rankBy?: ExecutiveRankBy
}

export type ExecutiveDrilldownKind = "CALLS" | "RESPONSES"

export interface ExecutiveRecord {
  recordId: string
  kind: "CALL" | "RESPONSE"
  territoryId: string
  hcpId: string | null
  hcpName: string | null
  detail: string | null
  responseText: string | null
  interactionDate: IsoDate | null
  loadedAt: string | null
}

export interface ExecutiveDrilldown {
  scopeId: string
  kind: ExecutiveDrilldownKind
  month: IsoDate
  total: number
  truncated: boolean
  dataThrough: string | null
  scopeLabel: string
  records: ExecutiveRecord[]
}

export interface ExecutiveDrilldownInput {
  scopeId: string
  kind: ExecutiveDrilldownKind
  month: IsoDate
  limit?: number
}
