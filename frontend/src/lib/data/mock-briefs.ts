import { DataError, type BriefEditInput, type BriefExport, type BriefItem, type BriefSummary, type GenerateBriefInput, type HcpField, type PreCallBrief, type RequestContext } from "./types"
import type { FixtureUser } from "./fixtures"

/**
 * In-memory stand-in for the briefs the agent saves to FE DynamoDB. It mirrors the real rules the
 * API enforces: briefs are private to their owner, access is re-checked on every open, a brief
 * carries the data version it was written against, and edits never change what an item cites.
 */

const MOCK_HCP = "HCP-0001"
const MOCK_HCP_NAME = "Call system HCP 0001"
const NAME: HcpField = { value: MOCK_HCP_NAME, state: "PRESENT" }

interface StoredBrief extends Omit<PreCallBrief, "stale" | "staleReasons" | "currentDataThrough" | "hcpName"> {
  /** Data version the brief was written against; "stale" scenario simulates a newer load. */
  dataVersion: number
}

const STORE = new Map<string, StoredBrief[]>()

export function resetMockBriefs() {
  STORE.clear()
}

const evidence = [
  { evidenceId: "call:CALL-0001", dataset: "call_activity", recordId: "CALL-0001", label: "Call 2026-10-30", date: "2026-10-30" },
  { evidenceId: "call:CALL-0002", dataset: "call_activity", recordId: "CALL-0002", label: "Call 2026-08-15", date: "2026-08-15" },
  { evidenceId: "response:RESP-MOCK-1", dataset: "hcp_raw_insights", recordId: "RESP-MOCK-1", label: "Recorded response 2026-10-28", date: "2026-10-28" },
  { evidenceId: "response:RESP-MOCK-0", dataset: "hcp_raw_insights", recordId: "RESP-MOCK-0", label: "Recorded response 2026-08-15", date: "2026-08-15" },
]

function item(id: string, text: string, detail: string | null, evidenceIds: string[]): BriefItem {
  return { itemId: id, text, detail, evidenceIds, origin: "GENERATED", edited: false }
}

function build(user: FixtureUser, briefId: string, input: GenerateBriefInput, version: number, at: string): StoredBrief {
  return {
    briefId,
    hcpId: input.hcpId,
    objective: input.objective,
    ownerUserId: user.userId,
    scopeLabel: user.scopeLabel,
    scopeTerritoryIds: user.territoryIds,
    dataThrough: "2026-11-03T05:30:00Z",
    generatedAt: at,
    updatedAt: at,
    modelMode: "stub",
    numberCheck: "unchecked",
    droppedStatements: 0,
    lastInteractionDate: "2026-10-30",
    facts: [
      { label: "Calls on record", value: "2", evidenceIds: ["call:CALL-0001", "call:CALL-0002"] },
      { label: "Recorded responses", value: "2", evidenceIds: ["response:RESP-MOCK-1", "response:RESP-MOCK-0"] },
      { label: "Most recent call", value: "2026-10-30", evidenceIds: ["call:CALL-0001"] },
    ],
    engagement: [
      { statementId: "s-e1", text: "Call on 2026-10-30 (in-person; scientific) covering osimertinib and pembrolizumab.", evidenceIds: ["call:CALL-0001"] },
      { statementId: "s-e2", text: "An earlier call took place on 2026-08-15.", evidenceIds: ["call:CALL-0002"] },
    ],
    perspectives: [
      { statementId: "s-p1", text: "Recorded on 2026-10-28: long-term outcomes and access considerations are important.", evidenceIds: ["response:RESP-MOCK-1"] },
      { statementId: "s-p2", text: "Recorded on 2026-08-15: the team wanted practical evidence for their discussions.", evidenceIds: ["response:RESP-MOCK-0"] },
    ],
    followUps: [{ statementId: "s-f1", text: "Recorded follow-up topic: coverage criteria for the care team.", evidenceIds: ["response:RESP-MOCK-1"] }],
    prompts: [
      item("g-q1", "What practical evidence would help the care team most right now?", null, ["response:RESP-MOCK-0"]),
      item("g-q2", "Which access considerations should we cover first?", null, ["response:RESP-MOCK-1"]),
    ],
    agenda: [
      item("g-a1", `Objective: ${input.objective.slice(0, 120)}`, "Agree what the call needs to achieve.", []),
      item("g-a2", "Review the last interaction", "Most recent call: 2026-10-30.", ["call:CALL-0001"]),
      item("g-a3", "Revisit recorded perspectives", "Check whether the earlier answers still hold.", ["response:RESP-MOCK-1"]),
    ],
    missing: [{ code: "PROFILE_CREDENTIALS_MISSING", message: "Credentials are not recorded for this HCP." }],
    evidence,
    regeneratesBriefId: input.regeneratesBriefId ?? null,
    dataVersion: version,
  }
}

export interface MockBriefDeps {
  user: () => FixtureUser
  scenario: () => string
  gate: (ctx: RequestContext, operation: string) => Promise<string>
  now: () => Date
}

export function createMockBriefs({ user, scenario, gate, now }: MockBriefDeps) {
  const version = () => (scenario() === "stale" ? 2 : 1)
  const canSee = (hcpId: string) => hcpId === MOCK_HCP && user().territoryIds.includes("NE-01")
  const list = () => {
    const u = user()
    let mine = STORE.get(u.userId)
    if (!mine) {
      // A saved brief written yesterday against the previous load, and one whose HCP has since moved.
      mine = [
        build(u, "br-20261103090000-aaaaaaaa", { hcpId: MOCK_HCP, objective: "Understand how the care team weighs access evidence" }, 1, "2026-11-03T09:00:00Z"),
        { ...build(u, "br-20261102090000-bbbbbbbb", { hcpId: "HCP-0099", objective: "Prepare an evidence recap" }, 1, "2026-11-02T09:00:00Z") },
      ]
      STORE.set(u.userId, mine)
    }
    return mine
  }
  const present = (b: StoredBrief): PreCallBrief => {
    const { dataVersion, ...rest } = b
    const stale = dataVersion < version()
    return {
      ...rest,
      hcpName: NAME,
      stale,
      staleReasons: stale ? ["HCP_DATA_CHANGED", "NEWER_DATA_LOADED"] : [],
      currentDataThrough: stale ? "2026-11-04T05:30:00Z" : b.dataThrough,
    }
  }
  const find = (id: string, ctx: RequestContext) => {
    const found = list().find((b) => b.briefId === id)
    if (!found) throw new DataError("NOT_FOUND", "That record is not available in your scope.", ctx.correlationId)
    if (!canSee(found.hcpId)) throw new DataError("FORBIDDEN", "You do not have access to this data.", ctx.correlationId)
    return found
  }

  return {
    async generateBrief(ctx: RequestContext, input: GenerateBriefInput): Promise<PreCallBrief> {
      const s = await gate(ctx, "generateBrief")
      if (s === "forbidden" || !canSee(input.hcpId)) throw new DataError("FORBIDDEN", "You do not have access to this data.", ctx.correlationId)
      const objective = input.objective.trim()
      if (objective.length < 3 || objective.length > 500) throw new DataError("BAD_REQUEST", "That request was not accepted.", ctx.correlationId)
      await new Promise((r) => setTimeout(r, s === "slow" ? 2500 : 900))
      const at = now().toISOString()
      const id = `br-${at.replace(/\D/g, "").slice(0, 14)}-${Math.random().toString(16).slice(2, 10).padEnd(8, "0")}`
      const brief = build(user(), id, { ...input, objective }, version(), at)
      list().unshift(brief)
      return present(brief)
    },
    async preCallBrief(ctx: RequestContext, briefId: string): Promise<PreCallBrief> {
      await gate(ctx, "preCallBrief")
      return present(find(briefId, ctx))
    },
    async myBriefs(ctx: RequestContext): Promise<BriefSummary[]> {
      await gate(ctx, "myBriefs")
      return list().map((b) => {
        const accessible = canSee(b.hcpId)
        return {
          briefId: b.briefId,
          hcpId: accessible ? b.hcpId : null,
          hcpName: accessible ? NAME : null,
          objective: accessible ? b.objective : null,
          generatedAt: b.generatedAt,
          dataThrough: b.dataThrough,
          accessible,
          stale: accessible && b.dataVersion < version(),
        }
      })
    },
    async saveBriefEdits(ctx: RequestContext, input: BriefEditInput): Promise<PreCallBrief> {
      await gate(ctx, "saveBriefEdits")
      const found = find(input.briefId, ctx)
      const merge = (incoming: BriefEditInput["prompts"], before: BriefItem[]): BriefItem[] =>
        (incoming ?? []).map((entry) => {
          const prior = before.find((b) => b.itemId === entry.itemId)
          if (!prior) {
            if (entry.itemId && !entry.itemId.startsWith("u-")) throw new DataError("BAD_REQUEST", "That request was not accepted.", ctx.correlationId)
            return { itemId: entry.itemId || `u-${Math.random().toString(16).slice(2, 12)}`, text: entry.text.trim(), detail: entry.detail ?? null, evidenceIds: [], origin: "USER", edited: false }
          }
          const text = entry.text.trim()
          return { ...prior, text, detail: entry.detail ?? null, edited: prior.edited || text !== prior.text || (entry.detail ?? null) !== prior.detail }
        })
      if (input.objective !== undefined) found.objective = input.objective.trim()
      if (input.prompts) found.prompts = merge(input.prompts, found.prompts)
      if (input.agenda) found.agenda = merge(input.agenda, found.agenda)
      found.updatedAt = now().toISOString()
      return present(found)
    },
    async exportBrief(ctx: RequestContext, briefId: string): Promise<BriefExport> {
      await gate(ctx, "exportBrief")
      const brief = present(find(briefId, ctx))
      const dates = brief.evidence.flatMap((record) => (record.date ? [record.date] : [])).sort()
      return {
        briefId: brief.briefId,
        hcpName: brief.hcpName.value ?? "HCP name not recorded",
        objective: brief.objective,
        scopeLabel: brief.scopeLabel,
        dateRangeFrom: dates.at(0) ?? null,
        dateRangeTo: dates.at(-1) ?? null,
        dataThrough: brief.dataThrough,
        generatedAt: brief.generatedAt,
        exportedAt: now().toISOString(),
        facts: brief.facts,
        engagement: brief.engagement,
        perspectives: brief.perspectives,
        followUps: brief.followUps,
        prompts: brief.prompts,
        agenda: brief.agenda,
        missing: brief.missing,
        citations: brief.evidence,
      }
    },
  }
}
