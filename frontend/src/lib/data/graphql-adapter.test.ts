import { describe, expect, it } from "vitest"
import { createGraphQLAdapter, type GraphQLTransport } from "./graphql-adapter"
import { ADMIN_INGESTION_RUNS_QUERY, AUTHORIZATION_VERIFICATION_GRID_QUERY, HCP_PROFILE_QUERY, HCP_TIMELINE_QUERY, LANDING_KPIS_QUERY, SEARCH_HCPS_QUERY, START_CHAT_RUN_MUTATION } from "./operations"

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

  it("uses canonical HCP operations and preserves the explicit field state", async () => {
    const seen: unknown[] = []
    const adapter = createGraphQLAdapter(async (req) => {
      seen.push(req)
      if (req.query === SEARCH_HCPS_QUERY) {
        return { data: { searchHcps: [{ hcpId: "HCP-0001", name: { value: "A", state: "PRESENT" }, institution: { value: null, state: "MISSING" }, territory: { value: "T01", state: "PRESENT" } }] } as never }
      }
      return { data: { hcpProfile: { hcpId: "HCP-0001", name: { value: "A", state: "PRESENT" }, specialty: { value: "Oncology", state: "PRESENT" }, discipline: { value: "Oncology", state: "PRESENT" }, type: { value: "HCP", state: "PRESENT" }, institution: { value: "Hospital", state: "PRESENT" }, credentials: { value: null, state: "MISSING" }, territory: { value: "T01", state: "PRESENT" } } } as never }
    })
    expect(await adapter.searchHcps(ctx, "A")).toHaveLength(1)
    expect((await adapter.hcpProfile(ctx, "HCP-0001")).credentials.state).toBe("MISSING")
    expect(seen).toEqual([
      { query: SEARCH_HCPS_QUERY, variables: { query: "A", limit: null } },
      { query: HCP_PROFILE_QUERY, variables: { hcpId: "HCP-0001" } },
    ])
  })

  it("requests the HCP timeline through the contract", async () => {
    const seen: unknown[] = []
    const adapter = createGraphQLAdapter(async (req) => {
      seen.push(req)
      return { data: { hcpTimeline: { hcpId: "HCP-0001", interactions: [], responses: [], perspectives: [] } } as never }
    })
    await expect(adapter.hcpTimeline(ctx, "HCP-0001")).resolves.toMatchObject({ hcpId: "HCP-0001" })
    expect(seen).toEqual([{ query: HCP_TIMELINE_QUERY, variables: { hcpId: "HCP-0001" } }])
  })

  it("reads the Administrator authorization verification result through the contract", async () => {
    const adapter = createGraphQLAdapter(async (req) => {
      expect(req.query).toBe(AUTHORIZATION_VERIFICATION_GRID_QUERY)
      return { data: { authorizationVerificationGrid: { suiteId: "local-appsync-authorization-v1", localOnly: true, total: 128, passed: 128, results: [] } } as never }
    })
    await expect(adapter.authorizationVerificationGrid(ctx)).resolves.toMatchObject({ total: 128, passed: 128, localOnly: true })
  })

  it("reads Administrator ingestion metadata through the AppSync contract", async () => {
    const adapter = createGraphQLAdapter(async (req) => {
      expect(req.query).toBe(ADMIN_INGESTION_RUNS_QUERY)
      return { data: { adminIngestionRuns: { sources: [{ sourceId: "call-activity", sourceName: "Call Activity", loadDate: "2026-11-03T12:00:00Z", dataThrough: "2026-11-03T12:00:00Z", ingestionRuns: [] }] } } as never }
    })
    await expect(adapter.adminIngestionRuns(ctx)).resolves.toMatchObject({ sources: [{ sourceId: "call-activity", ingestionRuns: [] }] })
  })

  it("starts a real-adapter chat run with its message, history and screen context", async () => {
    const seen: unknown[] = []
    const adapter = createGraphQLAdapter(async (req) => {
      seen.push(req)
      return { data: { startChatRun: { runId: "run-live-1", status: "RUNNING" } } as never }
    })
    await expect(adapter.startChatRun(ctx, {
      threadId: "thread-live-1",
      runId: "run-live-1",
      message: "What are the main concerns of HCPs?",
      history: [{ role: "user", content: "hi" }],
      context: { view: "msl", from: "2026-10-01", to: "2026-10-31", intent: "FREE" },
    })).resolves.toEqual({ runId: "run-live-1", status: "RUNNING" })
    expect(seen).toEqual([{
      query: START_CHAT_RUN_MUTATION,
      variables: {
        threadId: "thread-live-1",
        runId: "run-live-1",
        message: "What are the main concerns of HCPs?",
        history: [{ role: "user", content: "hi" }],
        context: { view: "msl", from: "2026-10-01", to: "2026-10-31", intent: "FREE" },
      },
    }])
  })
})
