import type { DateRange, LandingKpis, Me, RequestContext, TerritoryActivity } from "./types"

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
}
