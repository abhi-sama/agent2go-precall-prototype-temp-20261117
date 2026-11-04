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
}

export interface SavedView {
  savedViewId: string
  name: string
  reportKind: string
  filters: InsightFilters
  createdAt: IsoDateTime
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
