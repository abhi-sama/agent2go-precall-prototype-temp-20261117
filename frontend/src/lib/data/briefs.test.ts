import { beforeEach, describe, expect, it } from "vitest"
import { createGraphQLAdapter } from "./graphql-adapter"
import { createMockAdapter, type MockScenario } from "./mock-adapter"
import { resetMockBriefs } from "./mock-briefs"
import { EXPORT_BRIEF_MUTATION, GENERATE_BRIEF_MUTATION, MY_BRIEFS_QUERY, PRE_CALL_BRIEF_QUERY, SAVE_BRIEF_EDITS_MUTATION } from "./operations"

const ctx = { correlationId: "test" }
const make = (userId: string, scenario: MockScenario = "ok") =>
  createMockAdapter({ getUserId: () => userId, getScenario: () => scenario, latencyMs: 0, now: () => new Date("2026-11-04T10:00:00Z") })
const MSL = "u-msl-ne-01"

beforeEach(resetMockBriefs)

describe("mock pre-call briefs", () => {
  it("generates a brief whose every statement cites evidence it lists, with generated labels", async () => {
    const brief = await make(MSL).generateBrief(ctx, { hcpId: "HCP-0001", objective: "Discuss access evidence" })
    const ids = new Set(brief.evidence.map((e) => e.evidenceId))
    for (const s of [...brief.engagement, ...brief.perspectives, ...brief.followUps, ...brief.prompts]) {
      expect(s.evidenceIds.length).toBeGreaterThan(0)
      expect(s.evidenceIds.every((id) => ids.has(id))).toBe(true)
    }
    expect([...brief.prompts, ...brief.agenda].every((i) => i.origin === "GENERATED" && !i.edited)).toBe(true)
    expect(brief.ownerUserId).toBe(MSL)
    expect(brief.stale).toBe(false)
  })

  it("refuses an HCP outside the caller's scope and a missing objective", async () => {
    await expect(make(MSL).generateBrief(ctx, { hcpId: "HCP-9999", objective: "Discuss" })).rejects.toMatchObject({ code: "FORBIDDEN" })
    await expect(make(MSL).generateBrief(ctx, { hcpId: "HCP-0001", objective: " " })).rejects.toMatchObject({ code: "BAD_REQUEST" })
  })

  it("keeps edits, marks generated items edited and lets the user add their own", async () => {
    const adapter = make(MSL)
    const brief = await adapter.generateBrief(ctx, { hcpId: "HCP-0001", objective: "Discuss access evidence" })
    const updated = await adapter.saveBriefEdits(ctx, {
      briefId: brief.briefId,
      prompts: [{ itemId: brief.prompts[0].itemId, text: "Reworded?" }, { text: "Mine" }],
    })
    expect(updated.prompts[0]).toMatchObject({ text: "Reworded?", origin: "GENERATED", edited: true, evidenceIds: brief.prompts[0].evidenceIds })
    expect(updated.prompts[1]).toMatchObject({ origin: "USER", evidenceIds: [] })
    await expect(adapter.saveBriefEdits(ctx, { briefId: brief.briefId, agenda: [{ itemId: "g-a99", text: "forged" }] })).rejects.toMatchObject({ code: "BAD_REQUEST" })
  })

  it("shows the stale badge after a newer load and regenerating clears it", async () => {
    let scenario: MockScenario = "ok"
    const adapter = createMockAdapter({ getUserId: () => MSL, getScenario: () => scenario, latencyMs: 0, now: () => new Date("2026-11-04T10:00:00Z") })
    const first = await adapter.generateBrief(ctx, { hcpId: "HCP-0001", objective: "Discuss access evidence" })
    expect((await adapter.preCallBrief(ctx, first.briefId)).stale).toBe(false)
    scenario = "stale"
    const reopened = await adapter.preCallBrief(ctx, first.briefId)
    expect(reopened.stale).toBe(true)
    expect((await adapter.myBriefs(ctx)).find((b) => b.briefId === first.briefId)?.stale).toBe(true)
    const again = await adapter.generateBrief(ctx, { hcpId: "HCP-0001", objective: first.objective, regeneratesBriefId: first.briefId })
    expect(again.stale).toBe(false)
    expect(again.regeneratesBriefId).toBe(first.briefId)
  })

  it("keeps briefs private and lists a brief whose HCP moved out of scope without detail", async () => {
    const adapter = make(MSL)
    const brief = await adapter.generateBrief(ctx, { hcpId: "HCP-0001", objective: "Discuss access evidence" })
    // Another user cannot open it at all: private to its owner.
    await expect(make("u-msl-se-03").preCallBrief(ctx, brief.briefId)).rejects.toMatchObject({ code: "NOT_FOUND" })
    const own = await adapter.myBriefs(ctx)
    expect(own.some((b) => !b.accessible && b.hcpId === null && b.objective === null)).toBe(true)
  })

  it("exports a fresh saved snapshot with dates and citations only after the mock access check", async () => {
    const adapter = make(MSL)
    const brief = await adapter.generateBrief(ctx, { hcpId: "HCP-0001", objective: "Discuss access evidence" })
    const exported = await adapter.exportBrief(ctx, brief.briefId)
    expect(exported).toMatchObject({ briefId: brief.briefId, scopeLabel: brief.scopeLabel, generatedAt: brief.generatedAt })
    expect(exported.dateRangeFrom).toBe("2026-08-15")
    expect(exported.dateRangeTo).toBe("2026-10-30")
    expect(exported.citations).toHaveLength(brief.evidence.length)
    await expect(make("u-msl-se-03").exportBrief(ctx, brief.briefId)).rejects.toMatchObject({ code: "NOT_FOUND" })
  })
})

describe("GraphQL brief operations", () => {
  it("sends the documented operations and omits empty optionals", async () => {
    const calls: { query: string; variables?: Record<string, unknown> }[] = []
    const adapter = createGraphQLAdapter(async (request) => {
      calls.push(request)
      return { data: { generateBrief: { briefId: "b" }, preCallBrief: { briefId: "b" }, myBriefs: [], saveBriefEdits: { briefId: "b" }, exportBrief: { briefId: "b" } } as never }
    })
    await adapter.generateBrief(ctx, { hcpId: "H", objective: "obj" })
    await adapter.preCallBrief(ctx, "b")
    await adapter.myBriefs(ctx)
    await adapter.saveBriefEdits(ctx, { briefId: "b", prompts: [{ itemId: null, text: "t", detail: null }] })
    await adapter.exportBrief(ctx, "b")
    expect(calls.map((c) => c.query)).toEqual([GENERATE_BRIEF_MUTATION, PRE_CALL_BRIEF_QUERY, MY_BRIEFS_QUERY, SAVE_BRIEF_EDITS_MUTATION, EXPORT_BRIEF_MUTATION])
    expect(calls[0].variables).toEqual({ hcpId: "H", objective: "obj" })
    expect(calls[3].variables).toEqual({ input: { briefId: "b", prompts: [{ text: "t" }] } })
    expect(calls[4].variables).toEqual({ briefId: "b" })
  })
})
