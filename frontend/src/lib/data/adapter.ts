import type { ChatContext, DirectorInsightsAdapter } from "./director-insights"
import type { EvalsAdapter } from "./evals"
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
  BriefEditInput,
  BriefExport,
  BriefSummary,
  GenerateBriefInput,
  PreCallBrief,
  DateRange,
  DirectorOverview,
  Flag,
  FlagInput,
  GeoActivity,
  ExecutiveDrilldown,
  ExecutiveDrilldownInput,
  ExecutiveOverview,
  ExecutiveOverviewInput,
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
  PostCallDraft,
  FollowUpTask,
  ConfirmFollowUpTaskInput,
  TopicAlertRule,
  TopicAlert,
  TerritoryComparison,
} from "./types"

/**
 * The only way UI code reads data. The mock adapter (fixtures) and the AppSync adapter (wiring
 * worker, via `createGraphQLAdapter`) both implement it, so swapping is a one-line change in
 * `getDataAdapter()`.
 */
export interface DataAdapter extends GovernanceAdapter, DirectorInsightsAdapter, EvalsAdapter {
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
  /** Aggregate-only enterprise overview for an Executive: explicit scope only, small groups withheld. */
  executiveOverview(ctx: RequestContext, input?: ExecutiveOverviewInput): Promise<ExecutiveOverview>
  /** The calls or responses behind one chart point. Refused (FORBIDDEN) without explicit record-level permission. */
  executiveDrilldown(ctx: RequestContext, input: ExecutiveDrilldownInput): Promise<ExecutiveDrilldown>
  /** The caller's own flags, newest first. */
  myFlags(ctx: RequestContext): Promise<Flag[]>
  /** Raise a flag. Flagging the same open item again returns the existing flag. */
  flagIssue(ctx: RequestContext, input: FlagInput): Promise<Flag>
  adminAccessOverview(ctx: RequestContext): Promise<AdminAccessOverview>
  accessAudit(ctx: RequestContext, filter?: AccessAuditFilter): Promise<AccessAuditEvent[]>
  createScopeAssignment(ctx: RequestContext, input: ScopeAssignmentInput): Promise<ScopeAssignment>
  setRolePermissions(ctx: RequestContext, input: { roleId: string; permissionCodes: string[] }): Promise<RolePermissionMatrix>
  approveIdentityMapping(ctx: RequestContext, input: { userId: string; rosterSourceRowId: string }): Promise<IdentityMatch>
  startChatRun(ctx: RequestContext, input: { threadId: string; runId: string; message: string; history: ChatMessageInput[]; context?: ChatContext }): Promise<ChatRun>
  /**
   * Start a streamed chat answer. The caller picks `runId` so it can poll straight away. The mutation
   * returns once the BE accepted the run; the answer arrives through `chatEvents`.
   */
  startChatRun(
    ctx: RequestContext,
    input: { threadId: string; runId: string; message: string; history: ChatMessageInput[]; context?: ChatContext },
  ): Promise<ChatRun>
  /** Events with `seq > after`, in order. Stand-in for an AppSync subscription (docs/adr/0007). */
  chatEvents(ctx: RequestContext, runId: string, after: number): Promise<ChatEventPage>
  /** Re-checks record access. `auditExport` is true only for an explicit user export. */
  chatCitation(ctx: RequestContext, dataset: string, recordId: string, auditExport?: boolean): Promise<SourceRecord>
  searchHcps(ctx: RequestContext, query: string, limit?: number): Promise<HcpSearchResult[]>
  hcpProfile(ctx: RequestContext, hcpId: string): Promise<HcpProfile>
  hcpTimeline(ctx: RequestContext, hcpId: string): Promise<HcpTimeline>
  insightDiscovery(ctx: RequestContext, filters?: InsightFilters): Promise<InsightDiscovery>
  semanticInsightSearch(ctx: RequestContext, query: string, limit?: number): Promise<SemanticInsightResult[]>
  savedViews(ctx: RequestContext): Promise<SavedView[]>
  saveView(ctx: RequestContext, input: Pick<SavedView, "name" | "reportKind" | "filters">): Promise<SavedView>
  createPostCallDraft(ctx: RequestContext, input: { notes: string }): Promise<PostCallDraft>
  confirmPostCallDraft(ctx: RequestContext, draftId: string): Promise<PostCallDraft>
  postCallDrafts(ctx: RequestContext): Promise<PostCallDraft[]>
  /** This is the only method that may create task rows. */
  confirmFollowUpTasks(ctx: RequestContext, input: ConfirmFollowUpTaskInput[]): Promise<FollowUpTask[]>
  myFollowUpTasks(ctx: RequestContext): Promise<FollowUpTask[]>
  createTopicAlertRule(ctx: RequestContext, input: { topic: string; threshold: number; periodDays: number }): Promise<TopicAlertRule>
  topicAlertRules(ctx: RequestContext): Promise<TopicAlertRule[]>
  topicAlerts(ctx: RequestContext): Promise<TopicAlert[]>
  adminDataQuality(ctx: RequestContext): Promise<AdminDataQuality>
  /** Generate and save a source-linked brief for an authorized HCP. Takes several seconds. */
  generateBrief(ctx: RequestContext, input: GenerateBriefInput): Promise<PreCallBrief>
  /** Reopen a saved brief. Access is re-checked (FORBIDDEN if the HCP is no longer in scope) and staleness computed. */
  preCallBrief(ctx: RequestContext, briefId: string): Promise<PreCallBrief>
  myBriefs(ctx: RequestContext): Promise<BriefSummary[]>
  /** Save edits to the objective, prompts and agenda. Generated items stay marked generated. */
  saveBriefEdits(ctx: RequestContext, input: BriefEditInput): Promise<PreCallBrief>
  /** Re-check access, record the access-audit event, then return a printable saved-brief snapshot. */
  exportBrief(ctx: RequestContext, briefId: string): Promise<BriefExport>
}
