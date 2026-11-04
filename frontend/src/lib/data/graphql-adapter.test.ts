import { describe, expect, it } from "vitest"
import { createGraphQLAdapter, type GraphQLTransport } from "./graphql-adapter"
import { LANDING_KPIS_QUERY } from "./operations"

const ctx = { correlationId: "corr-9" }

describe("graphql adapter", () => {
  it("sends the contract query with range variables and the correlation id", async () => {
    const seen: unknown[] = []
    const transport: GraphQLTransport = async (req, c) => {
      seen.push({ req, c })
      return { data: { landingKpis: { distinctCalls: 1, distinctEngagedHcps: 1, responseCount: 2, from: "a", to: "b", dataThrough: null, scopeLabel: "s" } } as never }
    }
    const k = await createGraphQLAdapter(transport).landingKpis(ctx, { from: "2026-10-01", to: "2026-10-31" })
    expect(k.responseCount).toBe(2)
    expect(seen[0]).toMatchObject({ req: { query: LANDING_KPIS_QUERY, variables: { from: "2026-10-01", to: "2026-10-31" } }, c: ctx })
  })

  it("maps GraphQL errors to typed errors without leaking server text", async () => {
    const adapter = createGraphQLAdapter(async () => ({ errors: [{ message: "row 42 of priya.raman@example.test", errorType: "Unauthorized" }] }))
    const err = await adapter.me(ctx).catch((e) => e)
    expect(err).toMatchObject({ code: "UNAUTHENTICATED", correlationId: "corr-9" })
    expect(String(err.message)).not.toContain("priya")
  })

  it("maps transport failures to UNAVAILABLE", async () => {
    const adapter = createGraphQLAdapter(async () => {
      throw new Error("network")
    })
    await expect(adapter.landingKpis(ctx)).rejects.toMatchObject({ code: "UNAVAILABLE" })
  })
})
