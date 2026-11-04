import type { DataAdapter } from "./adapter"
import { LANDING_KPIS_QUERY, ME_QUERY } from "./operations"
import { DataError, type DateRange, type LandingKpis, type Me, type RequestContext } from "./types"

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
  }
}
