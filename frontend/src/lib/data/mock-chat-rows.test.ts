import { describe, expect, it } from "vitest"
import { applyEvent, newTurn, parseEvent, parseRowSets } from "@/lib/chat/events"
import { createMockAdapter, type MockScenario } from "./mock-adapter"
import { DataError } from "./types"

const ctx = { correlationId: "test" }
// Scripted runs reveal their events by the clock, so the clock here is ours: a run is asked, then a minute passes.
const clock = { ms: Date.parse("2026-11-03T12:00:00Z") }
const make = (userId: string, scenario: MockScenario = "ok") => createMockAdapter({ getUserId: () => userId, getScenario: () => scenario, latencyMs: 0, now: () => new Date(clock.ms) })

async function ask(adapter: ReturnType<typeof make>, runId: string, question = "How many calls did I have in the last 90 days?") {
  await adapter.startChatRun(ctx, { threadId: "t", runId, message: question, history: [] })
  clock.ms += 60_000
  // Fold every event into a turn like the panel does.
  const page = await adapter.chatEvents(ctx, runId, 0)
  expect(page.done).toBe(true)
  return page.events.reduce((turn, e) => applyEvent(turn, parseEvent(e.data)!), newTurn(runId))
}

describe("Show rows (mock adapter)", () => {
  it("describes the rows behind each key figure, and each table adds up to its figure", async () => {
    const a = make("u-msl-ne-01")
    const turn = await ask(a, "run-rows-1")
    expect(turn.rowSets.map((r) => [r.kind, r.sourceId])).toEqual([["calls", "f1"], ["hcps", "f2"], ["responses", "f3"]])
    for (const set of turn.rowSets) {
      const fact = turn.facts.find((f) => f.factId === set.sourceId)!
      const page = await a.chatAnswerRows(ctx, { runId: "run-rows-1", rowSetId: set.rowSetId, limit: 100 })
      expect(set.count).toBe(fact.value)
      expect(page.total).toBe(fact.value)
      expect(page.answerCount).toBe(fact.value)
      expect(page.rows.length).toBe(Math.min(100, fact.value))
      expect(page.columns).toHaveLength(page.rows[0].cells.length)
    }
  }, 15_000)

  it("sorts and pages on the server, stable across pages", async () => {
    const a = make("u-msl-ne-01")
    await ask(a, "run-rows-2")
    const total = (await a.chatAnswerRows(ctx, { runId: "run-rows-2", rowSetId: "rs1", limit: 1 })).total
    const seen: string[] = []
    const dates: string[] = []
    for (let offset = 0; offset < total; offset += 40) {
      const page = await a.chatAnswerRows(ctx, { runId: "run-rows-2", rowSetId: "rs1", sortBy: "date", sortDir: "ASC", offset, limit: 40 })
      seen.push(...page.rows.map((r) => r.id))
      dates.push(...page.rows.map((r) => r.cells[1] as string))
    }
    expect(seen).toHaveLength(total)
    expect(new Set(seen).size).toBe(total)
    expect(dates).toEqual([...dates].sort())
    const desc = await a.chatAnswerRows(ctx, { runId: "run-rows-2", rowSetId: "rs1", sortBy: "minutes", sortDir: "DESC", limit: 10 })
    const minutes = desc.rows.map((r) => Number(r.cells[4]))
    expect(minutes).toEqual([...minutes].sort((x, y) => y - x))
  }, 15_000)

  it("refuses an unknown column, an unknown row set and another run", async () => {
    const a = make("u-msl-ne-01")
    await ask(a, "run-rows-3")
    await expect(a.chatAnswerRows(ctx, { runId: "run-rows-3", rowSetId: "rs1", sortBy: "call_dt; drop" })).rejects.toMatchObject({ code: "BAD_REQUEST" })
    await expect(a.chatAnswerRows(ctx, { runId: "run-rows-3", rowSetId: "rs9" })).rejects.toMatchObject({ code: "NOT_FOUND" })
    await expect(a.chatAnswerRows(ctx, { runId: "nope", rowSetId: "rs1" })).rejects.toBeInstanceOf(DataError)
  }, 15_000)

  it("an aggregate-only Executive gets the note and no row sets, and the rows query is refused", async () => {
    const a = make("u-exec-all")
    const turn = await ask(a, "run-rows-4", "Which topics are rising across regions?")
    expect(turn.rowSets).toEqual([])
    expect(turn.rowsUnavailable).toBe(true)
    await expect(a.chatAnswerRows(ctx, { runId: "run-rows-4", rowSetId: "rs1" })).rejects.toMatchObject({ code: "FORBIDDEN" })
    await expect(a.exportChatRows(ctx, { runId: "run-rows-4", rowSetId: "rs1" })).rejects.toMatchObject({ code: "FORBIDDEN" })
  }, 15_000)

  it("export returns a labelled CSV with the same rows and is audited; without the permission it is refused and records nothing", async () => {
    const a = make("u-msl-ne-01")
    await ask(a, "run-rows-5")
    const file = await a.exportChatRows(ctx, { runId: "run-rows-5", rowSetId: "rs3", sortBy: "date", sortDir: "ASC" })
    const lines = file.content.trimEnd().split("\n")
    expect(lines[0]).toMatch(/^# \[SOURCE\]/)
    const header = lines.findIndex((l) => l.startsWith("Response,Date"))
    expect(lines.length - header - 1).toBe(file.rowCount)
    expect(file.rowCount).toBe(file.total)
    // The trail holds ids and counts only, never row content.
    const audit = await a.accessAudit(ctx, { action: "chat_rows.exported" })
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ actorUserId: "u-msl-ne-01", resourceType: "chat_row_set", resourceId: "run-rows-5:rs3", outcome: "allowed" })

    const denied = make("u-msl-ne-01", "no-export")
    await ask(denied, "run-rows-6")
    expect((await denied.chatAnswerRows(ctx, { runId: "run-rows-6", rowSetId: "rs1" })).canExport).toBe(false)
    await expect(denied.exportChatRows(ctx, { runId: "run-rows-6", rowSetId: "rs1" })).rejects.toMatchObject({ code: "FORBIDDEN" })
  }, 20_000)
})

describe("row set events", () => {
  it("keeps only well-formed sets", () => {
    const good = { row_set_id: "rs1", kind: "calls", label: "Distinct calls", unit: "calls", count: 12, period_from: "2026-08-06", period_to: "2026-11-03", scope: "T01-01", source_id: "f1" }
    expect(parseRowSets({ row_sets: [good, { ...good, row_set_id: "x" }, { ...good, kind: "users" }, { ...good, count: -1 }, { ...good, count: 1.5 }, "nope"] })).toEqual([
      { rowSetId: "rs1", kind: "calls", label: "Distinct calls", unit: "calls", count: 12, periodFrom: "2026-08-06", periodTo: "2026-11-03", scope: "T01-01", sourceId: "f1" },
    ])
    expect(parseRowSets(null)).toEqual([])
  })

  it("folds row_sets and rows_unavailable into the turn without duplicating a set", () => {
    const set = { row_set_id: "rs1", kind: "hcps", label: "Engaged HCPs", unit: "HCPs", count: 4, period_from: "a", period_to: "b", scope: "s", source_id: "f2" }
    let turn = newTurn("r")
    turn = applyEvent(turn, { type: "CUSTOM", name: "row_sets", value: { row_sets: [set] } })
    turn = applyEvent(turn, { type: "CUSTOM", name: "row_sets", value: { row_sets: [set] } })
    turn = applyEvent(turn, { type: "CUSTOM", name: "rows_unavailable", value: { reason: "aggregate_only" } })
    expect(turn.rowSets).toHaveLength(1)
    expect(turn.rowsUnavailable).toBe(true)
  })
})
