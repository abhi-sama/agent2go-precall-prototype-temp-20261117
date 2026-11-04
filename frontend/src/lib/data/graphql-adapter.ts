import type { DataAdapter } from "./adapter"
import {
  ACTIVITY_EVIDENCE_QUERY,
  ACTIVITY_TRENDS_QUERY,
  FLAG_ISSUE_MUTATION,
  GEO_ACTIVITY_QUERY,
  LANDING_KPIS_QUERY,
  ME_QUERY,
  MY_FLAGS_QUERY,
} from "./operations"
import {
  DataError,
  type ActivityEvidence,
  type ActivityTrends,
  type DateRange,
  type Flag,
  type GeoActivity,
  type LandingKpis,
  type Me,
  type RequestContext,
} from "./types"

export interface GraphQLResponse<T> {
  data?: T | null
  errors?: ReadonlyArray<{ message?: string; errorType?: string; extensions?: { code?: string } }>
}

/**
 * The wiring worker supplies this (for example a thin wrapper over Amplify's `client.graphql`
 * that attaches the Cognito token). It must send `ctx.correlationId` as a request header.
 */
export type GraphQLTransport = <T>(
  request: { query: string; variables?: Record<string, unknown> },
  ctx: RequestContext,
) => Promise<GraphQLResponse<T>>

function classify(errors: NonNullable<GraphQLResponse<unknown>["errors"]>, correlationId: string) {
  const text = errors.map((e) => `${e.errorType ?? ""} ${e.extensions?.code ?? ""}`).join(" ").toLowerCase()
  if (text.includes("unauthorized") || text.includes("unauthenticated")) {
    return new DataError("UNAUTHENTICATED", "Your session has expired. Sign in again.", correlationId)
  }
  if (text.includes("forbidden") || text.includes("access")) {
    return new DataError("FORBIDDEN", "You do not have access to this data.", correlationId)
  }
  if (text.includes("badrequest") || text.includes("bad_request")) {
    return new DataError("BAD_REQUEST", "That request was not accepted.", correlationId)
  }
  if (text.includes("no_scope") || text.includes("noscope")) {
    return new DataError("NO_SCOPE", "No territory is assigned to your account.", correlationId)
  }
  if (text.includes("timeout")) return new DataError("TIMEOUT", "The request took too long.", correlationId)
  // Never surface the raw server message: it may carry data. The correlation id is enough to trace it.
  return new DataError("UNAVAILABLE", "The data service is unavailable.", correlationId)
}

async function run<T>(
  transport: GraphQLTransport,
  query: string,
  variables: Record<string, unknown> | undefined,
  ctx: RequestContext,
): Promise<T> {
  let res: GraphQLResponse<T>
  try {
    res = await transport<T>({ query, variables }, ctx)
  } catch {
    throw new DataError("UNAVAILABLE", "The data service is unavailable.", ctx.correlationId)
  }
  if (res.errors?.length) throw classify(res.errors, ctx.correlationId)
  if (!res.data) throw new DataError("UNAVAILABLE", "The data service returned no data.", ctx.correlationId)
  return res.data
}

/** Real adapter against the contract schema. Transport is injected so this file has no AWS imports. */
export function createGraphQLAdapter(transport: GraphQLTransport): DataAdapter {
  return {
    kind: "appsync",
    async me(ctx) {
      const data = await run<{ me: Me }>(transport, ME_QUERY, undefined, ctx)
      return data.me
    },
    async landingKpis(ctx, range?: Partial<DateRange>) {
      const data = await run<{ landingKpis: LandingKpis }>(
        transport,
        LANDING_KPIS_QUERY,
        { from: range?.from ?? null, to: range?.to ?? null },
        ctx,
      )
      return data.landingKpis
    },
    async geoActivity(ctx, range?: Partial<DateRange>) {
      const data = await run<{ geoActivity: GeoActivity }>(
        transport,
        GEO_ACTIVITY_QUERY,
        { from: range?.from ?? null, to: range?.to ?? null },
        ctx,
      )
      return data.geoActivity
    },
    async activityTrends(ctx, months) {
      const data = await run<{ activityTrends: ActivityTrends }>(transport, ACTIVITY_TRENDS_QUERY, { months: months ?? null }, ctx)
      return data.activityTrends
    },
    async activityEvidence(ctx, query) {
      const data = await run<{ activityEvidence: ActivityEvidence }>(
        transport,
        ACTIVITY_EVIDENCE_QUERY,
        { metric: query.metric, month: query.month, channel: query.channel ?? null, limit: query.limit ?? null },
        ctx,
      )
      return data.activityEvidence
    },
    async myFlags(ctx) {
      const data = await run<{ myFlags: Flag[] }>(transport, MY_FLAGS_QUERY, undefined, ctx)
      return data.myFlags
    },
    async flagIssue(ctx, input) {
      const data = await run<{ flagIssue: Flag }>(
        transport,
        FLAG_ISSUE_MUTATION,
        // Optional fields are omitted, not null: floci's GraphQL executor rejects explicit nulls.
        { input: { kind: input.kind, targetType: input.targetType, targetId: input.targetId, ...(input.note ? { note: input.note } : {}) } },
        ctx,
      )
      return data.flagIssue
    },
  }
}
