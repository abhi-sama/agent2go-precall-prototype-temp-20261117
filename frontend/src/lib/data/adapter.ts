import type { GovernanceAdapter } from "./governance"
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
  AdminDataQuality,
  DateRange,
  DirectorOverview,
  Flag,
  FlagInput,
  GeoActivity,
  HcpProfile,
  HcpSearchResult,
  HcpTimeline,
  InsightDiscovery,
  SemanticInsightResult,
  InsightFilters,
  IsoDate,
  IdentityMatch,
  LandingKpis,
  Me,
  RequestContext,
  RolePermissionMatrix,
  ScopeAssignment,
  ScopeAssignmentInput,
  SourceRecord,
  SavedView,
  TerritoryComparison,
} from "./types"

/**
 * The only way UI code reads data. The mock adapter (fixtures) and the AppSync adapter (wiring
 * worker, via `createGraphQLAdapter`) both implement it, so swapping is a one-line change in
 * `getDataAdapter()`.
 */
export interface DataAdapter extends GovernanceAdapter {
  readonly kind: "mock" | "appsync"
  me(ctx: RequestContext): Promise<Me>
  /** `range` omitted lets the backend choose its default window. */
  landingKpis(ctx: RequestContext, range?: Partial<DateRange>, filters?: InsightFilters): Promise<LandingKpis>
  /** Distinct calls per territory and country, for the globe and the flat map. See `GeoActivity`. */
  geoActivity(ctx: RequestContext, range?: Partial<DateRange>, filters?: InsightFilters): Promise<GeoActivity>
  /** Monthly distinct calls, distinct HCPs and channel mix for the last `months` months. */
  activityTrends(ctx: RequestContext, months?: number): Promise<ActivityTrends>
  /** The distinct calls or HCPs behind one chart point: a month, optionally one channel. */
  activityEvidence(
    ctx: RequestContext,
    query: { metric: ActivityMetric; month: IsoDate; channel?: string | null; limit?: number },
  ): Promise<ActivityEvidence>
  /** Team and territory overview for a Director: approved descendant territories only, one window. */
  directorOverview(ctx: RequestContext, range?: Partial<DateRange>): Promise<DirectorOverview>
  /** 2 to 6 in-scope territories over one identical window and one set of definitions. */
  territoryComparison(ctx: RequestContext, territoryIds: string[], range?: Partial<DateRange>): Promise<TerritoryComparison>
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
  /**
   * Start a streamed chat answer. The caller picks `runId` so it can poll straight away. The mutation
   * returns once the BE accepted the run; the answer arrives through `chatEvents`.
   */
  startChatRun(
    ctx: RequestContext,
    input: { threadId: string; runId: string; message: string; history: ChatMessageInput[] },
  ): Promise<ChatRun>
  /** Events with `seq > after`, in order. Stand-in for an AppSync subscription (docs/adr/0007). */
  chatEvents(ctx: RequestContext, runId: string, after: number): Promise<ChatEventPage>
  chatCitation(ctx: RequestContext, dataset: string, recordId: string): Promise<SourceRecord>
  searchHcps(ctx: RequestContext, query: string, limit?: number): Promise<HcpSearchResult[]>
  hcpProfile(ctx: RequestContext, hcpId: string): Promise<HcpProfile>
  hcpTimeline(ctx: RequestContext, hcpId: string): Promise<HcpTimeline>
  insightDiscovery(ctx: RequestContext, filters?: InsightFilters): Promise<InsightDiscovery>
  semanticInsightSearch(ctx: RequestContext, query: string, limit?: number): Promise<SemanticInsightResult[]>
  savedViews(ctx: RequestContext): Promise<SavedView[]>
  saveView(ctx: RequestContext, input: Pick<SavedView, "name" | "reportKind" | "filters">): Promise<SavedView>
  adminDataQuality(ctx: RequestContext): Promise<AdminDataQuality>
}
