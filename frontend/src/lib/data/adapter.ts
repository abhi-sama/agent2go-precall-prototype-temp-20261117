import type {
  ActivityEvidence,
  ActivityMetric,
  ActivityTrends,
  ChatEventPage,
  ChatMessageInput,
  ChatRun,
  AccessAuditEvent,
  AccessAuditFilter,
  AdminAccessOverview,
  DateRange,
  Flag,
  FlagInput,
  GeoActivity,
  HcpProfile,
  HcpSearchResult,
  IsoDate,
  IdentityMatch,
  LandingKpis,
  Me,
  RequestContext,
  RolePermissionMatrix,
  ScopeAssignment,
  ScopeAssignmentInput,
  SourceRecord,
} from "./types"

/**
 * The only way UI code reads data. The mock adapter (fixtures) and the AppSync adapter (wiring
 * worker, via `createGraphQLAdapter`) both implement it, so swapping is a one-line change in
 * `getDataAdapter()`.
 */
export interface DataAdapter {
  readonly kind: "mock" | "appsync"
  me(ctx: RequestContext): Promise<Me>
  /** `range` omitted lets the backend choose its default window. */
  landingKpis(ctx: RequestContext, range?: Partial<DateRange>): Promise<LandingKpis>
  /** Distinct calls per territory and country, for the globe and the flat map. See `GeoActivity`. */
  geoActivity(ctx: RequestContext, range?: Partial<DateRange>): Promise<GeoActivity>
  /** Monthly distinct calls, distinct HCPs and channel mix for the last `months` months. */
  activityTrends(ctx: RequestContext, months?: number): Promise<ActivityTrends>
  /** The distinct calls or HCPs behind one chart point: a month, optionally one channel. */
  activityEvidence(
    ctx: RequestContext,
    query: { metric: ActivityMetric; month: IsoDate; channel?: string | null; limit?: number },
  ): Promise<ActivityEvidence>
  /** The caller's own flags, newest first. */
  myFlags(ctx: RequestContext): Promise<Flag[]>
  /** Raise a flag. Flagging the same open item again returns the existing flag. */
  flagIssue(ctx: RequestContext, input: FlagInput): Promise<Flag>
  adminAccessOverview(ctx: RequestContext): Promise<AdminAccessOverview>
  accessAudit(ctx: RequestContext, filter?: AccessAuditFilter): Promise<AccessAuditEvent[]>
  createScopeAssignment(ctx: RequestContext, input: ScopeAssignmentInput): Promise<ScopeAssignment>
  setRolePermissions(ctx: RequestContext, input: { roleId: string; permissionCodes: string[] }): Promise<RolePermissionMatrix>
  approveIdentityMapping(ctx: RequestContext, input: { userId: string; rosterSourceRowId: string }): Promise<IdentityMatch>
  startChatRun(ctx: RequestContext, input: { threadId: string; runId: string; message: string; history: ChatMessageInput[] }): Promise<ChatRun>
  chatEvents(ctx: RequestContext, runId: string, after: number): Promise<ChatEventPage>
  chatCitation(ctx: RequestContext, dataset: string, recordId: string): Promise<SourceRecord>
  searchHcps(ctx: RequestContext, query: string, limit?: number): Promise<HcpSearchResult[]>
  hcpProfile(ctx: RequestContext, hcpId: string): Promise<HcpProfile>
}
