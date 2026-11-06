import { describe, expect, it } from "vitest"
import { applyEvent, newTurn, parseEvent, parseVisual } from "./events"
import { citationNumber, citationsForFact, factsAreComparable } from "./events"

const fold = (events: object[]) =>
  events.reduce<ReturnType<typeof newTurn>>((turn, e) => applyEvent(turn, parseEvent(JSON.stringify(e))!), newTurn("r1"))

describe("applyEvent", () => {
  it("builds one turn from a streamed run, keeping facts, text and suggestions apart", () => {
    const turn = fold([
      { type: "RUN_STARTED" },
      { type: "CUSTOM", name: "model_mode", value: { mode: "claude" } },
      { type: "TOOL_CALL_START", toolCallId: "t1", toolCallName: "get_activity_summary" },
      {
        type: "CUSTOM",
        name: "source_facts",
        value: {
          facts: [{ fact_id: "f1", label: "Distinct calls", value: 130, unit: "calls", period: "p", scope: "s", citation_ids: ["CALL-1"] }],
          data_through: "2026-11-03T12:00:00+00:00",
        },
      },
      { type: "CUSTOM", name: "citations", value: [{ record_id: "CALL-1", dataset: "call_activity", label: "Call" }] },
      { type: "TOOL_CALL_END", toolCallId: "t1" },
      { type: "TEXT_MESSAGE_CONTENT", delta: "You had " },
      { type: "TEXT_MESSAGE_CONTENT", delta: "130 calls." },
      { type: "CUSTOM", name: "number_check", value: { status: "verified", count: 0, checked: true } },
      { type: "CUSTOM", name: "suggestions", value: ["a?", "b?", "c?", "d?"] },
      { type: "CUSTOM", name: "conversation_saved", value: { saved: true } },
      { type: "RUN_FINISHED" },
    ])
    expect(turn.status).toBe("done")
    expect(turn.text).toBe("You had 130 calls.")
    expect(turn.facts).toEqual([
      { factId: "f1", label: "Distinct calls", value: 130, unit: "calls", period: "p", scope: "s", citationIds: ["CALL-1"] },
    ])
    expect(turn.citations).toEqual([{ recordId: "CALL-1", dataset: "call_activity", label: "Call" }])
    expect(turn.tools).toEqual([{ id: "t1", name: "get_activity_summary", done: true }])
    expect(turn.suggestions).toHaveLength(3)
    expect(turn.saved).toBe(true)
    expect(turn.dataThrough).toContain("2026-11-03")
  })

  it("does not duplicate facts or citations replayed in a later event", () => {
    const fact = { fact_id: "f1", label: "x", value: 1, unit: "u", period: "p", scope: "s", citation_ids: [] }
    const cite = { record_id: "C1", dataset: "call_activity", label: "c" }
    const turn = fold([
      { type: "CUSTOM", name: "source_facts", value: { facts: [fact] } },
      { type: "CUSTOM", name: "source_facts", value: { facts: [fact] } },
      { type: "CUSTOM", name: "citations", value: [cite] },
      { type: "CUSTOM", name: "citations", value: [cite] },
    ])
    expect(turn.facts).toHaveLength(1)
    expect(turn.citations).toHaveLength(1)
  })

  it("keeps a deterministic citation number and maps facts to their records", () => {
    const turn = fold([
      { type: "CUSTOM", name: "source_facts", value: { facts: [{ fact_id: "f1", label: "x", value: 1, unit: "u", period: "p", scope: "s", citation_ids: ["C2"] }] } },
      { type: "CUSTOM", name: "citations", value: [{ record_id: "C1", dataset: "call_activity", label: "first" }, { record_id: "C2", dataset: "call_activity", label: "second" }] },
    ])
    expect(citationNumber(turn.citations, turn.citations[1])).toBe(2)
    expect(citationsForFact(turn.facts[0], turn.citations)).toEqual([turn.citations[1]])
  })

  it("a run error ends the turn with fixed text", () => {
    const turn = fold([{ type: "RUN_ERROR", message: "The agent is unavailable. Please try again." }])
    expect(turn.status).toBe("error")
    expect(turn.error).toBe("The agent is unavailable. Please try again.")
  })

  it("ignores malformed payloads", () => {
    expect(parseEvent("not json")).toBeNull()
    expect(parseEvent('{"no":"type"}')).toBeNull()
    const turn = fold([{ type: "CUSTOM", name: "source_facts", value: "oops" }, { type: "CUSTOM", name: "suggestions", value: 3 }])
    expect(turn.facts).toEqual([])
    expect(turn.suggestions).toEqual([])
  })
})

describe("visual events", () => {
  const base = { visual_id: "v1", kind: "bar", title: "Distinct calls by product", unit: "calls", total: 6, points: [{ key: "a", label: "a", value: 4, share_pct: 66.7 }, { key: "b", label: "b", value: 2, share_pct: 33.3 }] }
  const custom = (value: unknown) => ({ type: "CUSTOM", name: "visual", value })

  it("reserves a place when the query starts and fills it with the plotted values", () => {
    let turn = applyEvent(newTurn("r"), custom({ phase: "pending", visual_id: "v1" }))
    expect(turn.visuals).toEqual([{ visualId: "v1", status: "pending", spec: null }])
    turn = applyEvent(turn, custom({ phase: "ready", ...base }))
    expect(turn.visuals).toHaveLength(1)
    expect(turn.visuals[0].status).toBe("ready")
    expect(turn.visuals[0].spec?.points.map((p) => [p.value, p.sharePct])).toEqual([[4, 66.7], [2, 33.3]])
  })

  it("a chart tool that ends without a visual leaves no placeholder", () => {
    let turn = applyEvent(newTurn("r"), { type: "TOOL_CALL_START", toolCallId: "v1", toolCallName: "show_chart" })
    turn = applyEvent(turn, custom({ phase: "pending", visual_id: "v1" }))
    turn = applyEvent(turn, { type: "TOOL_CALL_END", toolCallId: "v1" })
    expect(turn.visuals).toEqual([])
  })

  it("drops malformed visuals instead of half drawing them", () => {
    expect(parseVisual({ visual_id: "v1", kind: "pie" })).toBeNull()
    expect(parseVisual({ kind: "bar" })).toBeNull()
    const turn = applyEvent(newTurn("r"), custom({ phase: "ready", visual_id: "v9", kind: "nope" }))
    expect(turn.visuals).toEqual([])
  })

  it("keeps a ready visual when its tool call ends", () => {
    let turn = applyEvent(newTurn("r"), custom({ phase: "ready", ...base }))
    turn = applyEvent(turn, { type: "TOOL_CALL_END", toolCallId: "v1" })
    expect(turn.visuals).toHaveLength(1)
  })
})

describe("fact comparisons", () => {
  it("only compares facts that use the same measure", () => {
    const fact = (unit: string) => ({ factId: unit, label: unit, value: 1, unit, period: "p", scope: "s", citationIds: [] })
    expect(factsAreComparable([fact("calls"), fact("calls")])).toBe(true)
    expect(factsAreComparable([fact("calls"), fact("HCPs"), fact("responses")])).toBe(false)
  })
})
