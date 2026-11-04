import type {
  ActivityEvidence,
  ActivityMetric,
  ActivityTrends,
  DateRange,
  Flag,
  FlagInput,
  IsoDate,
  LandingKpis,
  Me,
  RequestContext,
  TerritoryActivity,
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
  /** Optional; see `TerritoryActivity` (not in the contract). */
  territoryActivity?(ctx: RequestContext, range?: Partial<DateRange>): Promise<TerritoryActivity[]>
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
}
