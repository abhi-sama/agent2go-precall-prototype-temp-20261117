import { verifyEvents, type BaseEvent } from "@ag-ui/client"
import { firstValueFrom, from, toArray } from "rxjs"
import { describe, expect, it } from "vitest"
import { ANSWER_ACTIVITY, ids, type AnswerActivity } from "./answer"
import { RunStream } from "./run-stream"

const IDS = { threadId: "thread-1", runId: "run-1" }
const META = { userMessageId: "q-1", context: { view: "msl" } }

/** Every event the agent sends for one ordinary answer, as the event log stores them. */
const ANSWER = [
  { type: "RUN_STARTED", threadId: "thread-1", runId: "run-1" },
  { type: "CUSTOM", name: "model_mode", value: { mode: "claude" } },
  { type: "TOOL_CALL_START", toolCallId: "tc-1", toolCallName: "get_activity_summary" },
  { type: "CUSTOM", name: "source_facts", value: { facts: [{ fact_id: "f1", label: "Distinct calls", value: 132, unit: "calls", period: "p", scope: "NE-01", citation_ids: ["CALL-1"] }], data_through: "2026-11-16" } },
  { type: "CUSTOM", name: "citations", value: [{ record_id: "CALL-1", dataset: "calls", label: "Call on 2026-11-15" }] },
  { type: "TOOL_CALL_END", toolCallId: "tc-1" },
  { type: "TEXT_MESSAGE_START", messageId: "m-1", role: "assistant" },
  { type: "TEXT_MESSAGE_CONTENT", messageId: "m-1", delta: "You had 132 calls." },
  { type: "TEXT_MESSAGE_END", messageId: "m-1" },
  { type: "CUSTOM", name: "suggestions", value: ["Which territories can I see?"] },
  { type: "RUN_FINISHED", threadId: "thread-1", runId: "run-1" },
]

function run(events: Record<string, unknown>[], finish?: Parameters<RunStream["finish"]>[0]) {
  const stream = new RunStream(IDS, META)
  const out: BaseEvent[] = [...stream.start()]
  for (const event of events) out.push(...stream.push(event))
  if (finish) out.push(...stream.finish(finish))
  return { stream, out }
}

/** The AG-UI client's own verifier: what CopilotKit would reject. */
const verified = (events: BaseEvent[]) => firstValueFrom(from(events).pipe(verifyEvents(), toArray()))

const tail = (out: BaseEvent[]) => out.find((e) => e.type === "ACTIVITY_SNAPSHOT" && (e as unknown as { messageId: string }).messageId === ids.tail("run-1")) as unknown as { content: AnswerActivity }

describe("RunStream", () => {
  it("turns an ordinary answer into a stream the AG-UI verifier accepts", async () => {
    const { out, stream } = run(ANSWER)
    await expect(verified(out)).resolves.toHaveLength(out.length)
    expect(stream.done).toBe(true)
    expect(out[0]).toMatchObject({ type: "RUN_STARTED", threadId: "thread-1", runId: "run-1" })
    expect(out.at(-1)).toMatchObject({ type: "RUN_FINISHED", runId: "run-1" })
  })

  it("names the run's messages so they can be traced to it", () => {
    const { out } = run(ANSWER)
    expect(out.find((e) => e.type === "TEXT_MESSAGE_START")).toMatchObject({ messageId: ids.text("run-1", 0), role: "assistant" })
    expect(out.find((e) => e.type === "TOOL_CALL_START")).toMatchObject({ toolCallId: "tc-1", toolCallName: "get_activity_summary", parentMessageId: ids.tools("run-1") })
  })

  it("gives every finished tool call a result, without the tool's output", () => {
    const { out } = run(ANSWER)
    const result = out.find((e) => e.type === "TOOL_CALL_RESULT")
    expect(result).toMatchObject({ toolCallId: "tc-1", role: "tool", content: "complete", messageId: ids.toolResult("run-1", "tc-1") })
  })

  it("keeps a tool result the agent sent, once", () => {
    const { out } = run([...ANSWER.slice(0, 6), { type: "TOOL_CALL_RESULT", toolCallId: "tc-1", messageId: "x", content: "done" }, ...ANSWER.slice(6)])
    expect(out.filter((e) => e.type === "TOOL_CALL_RESULT")).toHaveLength(1)
  })

  it("puts the evidence in a head (when the first figure arrives) and a tail (when the run ends)", () => {
    const { out } = run(ANSWER)
    const heads = out.filter((e) => e.type === "ACTIVITY_SNAPSHOT" && (e as unknown as { messageId: string }).messageId === ids.head("run-1"))
    expect(heads.length).toBeGreaterThan(0)
    // The head comes after the tool call started, so it sits below the tool row in the thread.
    expect(out.findIndex((e) => e.type === "ACTIVITY_SNAPSHOT")).toBeGreaterThan(out.findIndex((e) => e.type === "TOOL_CALL_START"))
    const { content } = tail(out)
    expect(content).toMatchObject({ v: 1, runId: "run-1", part: "tail", userMessageId: "q-1", context: { view: "msl" }, status: "done", error: null })
    expect(content.events.map((e) => (e.type === "CUSTOM" ? e.name : e.type))).toEqual(["model_mode", "source_facts", "citations", "TOOL_CALL_END", "suggestions"])
    expect(out.filter((e) => e.type === "ACTIVITY_SNAPSHOT").every((e) => (e as unknown as { activityType: string }).activityType === ANSWER_ACTIVITY)).toBe(true)
  })

  it("closes what an event log left open and ends with the error (the worker's bare RUN_ERROR)", async () => {
    const { out } = run([
      { type: "TOOL_CALL_START", toolCallId: "tc-1", toolCallName: "show_chart" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "m-1", delta: "Partial" },
      { type: "RUN_ERROR", message: "The agent is unavailable. Please try again.", code: "AGENT_UNAVAILABLE" },
    ])
    await expect(verified(out)).resolves.toHaveLength(out.length)
    expect(out[0].type).toBe("RUN_STARTED")
    expect(tail(out).content).toMatchObject({ status: "error", error: "The agent is unavailable. Please try again." })
    expect(out.at(-1)).toMatchObject({ type: "RUN_ERROR", message: "The agent is unavailable. Please try again." })
  })

  it("ignores everything after the terminal event and finishes only once", () => {
    const { stream, out } = run(ANSWER)
    expect(stream.push({ type: "TEXT_MESSAGE_CONTENT", messageId: "m-2", delta: "late" })).toEqual([])
    expect(stream.finish({ status: "error", message: "Answer stopped." })).toEqual([])
    expect(out.filter((e) => e.type === "RUN_FINISHED")).toHaveLength(1)
  })

  it("is an allow-list: no state, interrupts, unknown custom events or other activity types reach CopilotKit", () => {
    const { out } = run([
      { type: "STATE_SNAPSHOT", snapshot: { evil: true } },
      { type: "MESSAGES_SNAPSHOT", messages: [] },
      { type: "CUSTOM", name: "on_interrupt", value: {} },
      { type: "CUSTOM", name: "computed_figures", value: {} },
      { type: "ACTIVITY_SNAPSHOT", messageId: "m", activityType: "mcp-apps", content: {} },
      { type: "RAW", event: {} },
    ])
    expect(out.map((e) => e.type)).toEqual(["RUN_STARTED"])
  })

  it("drops an A2UI surface that fails the answer-catalog gate, and scopes a good one to the run", () => {
    const create = { version: "1.0", createSurface: { surfaceId: "s1", catalogId: "urn:agent2go:a2ui:answer-catalog:v1", components: [{ id: "root", component: "Text", text: "Hello" }] } }
    const good = { type: "ACTIVITY_SNAPSHOT", messageId: "a2ui-surface-s1", activityType: "a2ui-surface", content: { a2ui_operations: [create] }, replace: true }
    const bad = { ...good, content: { a2ui_operations: [{ ...create, createSurface: { ...create.createSurface, components: [{ id: "root", component: "Image", url: "https://x" }] } }] } }
    expect(run([bad]).out.map((e) => e.type)).toEqual(["RUN_STARTED"])
    const surfaces = run([good]).out.filter((e) => e.type === "ACTIVITY_SNAPSHOT")
    expect(surfaces).toEqual([expect.objectContaining({ messageId: ids.surface("run-1", "s1"), activityType: "a2ui-surface", content: { a2ui_operations: [create] } })])
  })

  it("ends a stopped answer as an error the panel can show", () => {
    const stream = new RunStream(IDS, META)
    stream.start()
    stream.push({ type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: "Half an answer" })
    const out = stream.finish({ status: "error", message: "Answer stopped." })
    expect(out.map((e) => e.type)).toEqual(["TEXT_MESSAGE_END", "ACTIVITY_SNAPSHOT", "RUN_ERROR"])
    expect(tail(out).content).toMatchObject({ status: "error", error: "Answer stopped." })
  })
})
