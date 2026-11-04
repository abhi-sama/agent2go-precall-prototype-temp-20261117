import { fetchAuthSession } from "aws-amplify/auth"
import { graphqlUrl, IS_FLOCI } from "@/lib/amplify/config"
import type { GraphQLResponse, GraphQLTransport } from "./graphql-adapter"

export const FULL_NAME_HEADER = "x-user-full-name"
export const EMAIL_HEADER = "x-user-email"

/** Optional variables are omitted rather than sent as null (floci's executor rejects explicit nulls). */
export function compactVariables(variables?: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(variables ?? {}).filter(([, v]) => v !== null && v !== undefined))
}

/**
 * GraphQL over HTTPS to the FE AppSync API with the Cognito ID token.
 *
 * Alongside the token it sends the IdP-provided full name and email (from the token's own
 * claims today; Okta's later) and the correlation id. The BE verifies the token and lets its
 * claims win over these request fields.
 */
export const appsyncTransport: GraphQLTransport = async <T,>(
  request: { query: string; variables?: Record<string, unknown> },
  ctx: { correlationId: string },
): Promise<GraphQLResponse<T>> => {
  const session = await fetchAuthSession()
  const idToken = session.tokens?.idToken
  if (!idToken) return { errors: [{ errorType: "Unauthorized" }] }
  const claims = idToken.payload
  const token = idToken.toString()
  const headers: Record<string, string> = {
    "content-type": "application/json",
    // AWS AppSync takes the raw JWT; floci requires the Bearer scheme to pick Cognito auth.
    authorization: IS_FLOCI ? `Bearer ${token}` : token,
    "x-correlation-id": ctx.correlationId,
  }
  if (typeof claims.name === "string") headers[FULL_NAME_HEADER] = claims.name
  if (typeof claims.email === "string") headers[EMAIL_HEADER] = claims.email

  const res = await fetch(graphqlUrl(), {
    method: "POST",
    headers,
    body: JSON.stringify({ query: request.query, variables: compactVariables(request.variables) }),
  })
  if (res.status === 401 || res.status === 403) return { errors: [{ errorType: "Unauthorized" }] }
  return (await res.json()) as GraphQLResponse<T>
}
