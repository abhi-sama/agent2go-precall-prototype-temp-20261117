import type {
  ActivityEvidence,
  ActivityMetric,
  ActivityTrends,
  ChatEventPage,
  ChatMessageInput,
  ChatRun,
  DateRange,
  Flag,
  FlagInput,
  GeoActivity,
  HcpProfile,
  HcpSearchResult,
  IsoDate,
  LandingKpis,
  Me,
  RequestContext,
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
  /** Open a cited source record; the BE returns it only if the caller's scope covers it. */
  chatCitation(ctx: RequestContext, dataset: string, recordId: string): Promise<SourceRecord>
  searchHcps(ctx: RequestContext, query: string, limit?: number): Promise<HcpSearchResult[]>
  hcpProfile(ctx: RequestContext, hcpId: string): Promise<HcpProfile>
}
