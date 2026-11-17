import type { Message } from "@ag-ui/client"
import { describe, expect, it, vi } from "vitest"
import type { DataAdapter } from "@/lib/data"
import type { ChatRunInput } from "@/lib/data/adapter"
import { DataError, type ChatEventPage } from "@/lib/data/types"
import { ids } from "./answer"
import { PAGE_FIGURES_CONTEXT } from "@/lib/chat/page-state"
import { AppSyncChatAgent, MESSAGES, SCREEN_CONTEXT, SURFACE_ACTION_PROP, contextOf, pageOf, surfaceActionOf } from "./appsync-agent"
import { turnsOf } from "./turns"

const ANSWER = [
  { type: "RUN_STARTED", threadId: "t", runId: "r" },
  { type: "TOOL_CALL_START", toolCallId: "tc-1", toolCallName: "get_activity_summary" },
  { type: "CUSTOM", name: "source_facts", value: { facts: [{ fact_id: "f1", label: "Distinct calls", value: 132, unit: "calls", period: "p", scope: "s", citation_ids: [] }] } },
  { type: "TOOL_CALL_END", toolCallId: "tc-1" },
  { type: "TEXT_MESSAGE_START", messageId: "m-1", role: "assistant" },
  { type: "TEXT_MESSAGE_CONTENT", messageId: "m-1", delta: "You had 132 calls." },
  { type: "TEXT_MESSAGE_END", messageId: "m-1" },
  { type: "RUN_FINISHED", threadId: "t", runId: "r" },
]

/** A fake BE: `startChatRun` records the request, `chatEvents` serves the log in pages of two. */
function fakeAdapter(log: Record<string, unknown>[] = ANSWER, overrides: Partial<DataAdapter> = {}) {
  const started: ChatRunInput[] = []
  const adapter = {
    startChatRun: vi.fn(async (_ctx: unknown, input: ChatRunInput) => {
      started.push(input)
      return { runId: input.runId, status: "running" }
    }),
    chatEvents: vi.fn(async (_ctx: unknown, _runId: string, after: number): Promise<ChatEventPage> => {
      const page = log.slice(after, after + 2).map((event, i) => ({ seq: after + i + 1, data: JSON.stringify(event) }))
      return { events: page, done: after + page.length >= log.length, status: "running" }
    }),
    ...overrides,
  } as unknown as DataAdapter
  return { adapter, started }
}

const ask = (question: string, id = "q-1"): Message => ({ id, role: "user", content: question })

function agentWith(adapter: DataAdapter, messages: Message[] = [ask("How many calls did I have?")]) {
  return new AppSyncChatAgent({ adapter, pollMs: 1, threadId: "thread-1", initialMessages: messages })
}

describe("AppSyncChatAgent", () => {
  it("asks through startChatRun, reads the event log, and leaves CopilotKit's messages for the answer", async () => {
    const { adapter, started } = fakeAdapter()
    const agent = agentWith(adapter)
    await agent.runAgent({ runId: "run-1" })
    expect(started).toEqual([{ threadId: "thread-1", runId: "run-1", message: "How many calls did I have?", history: [] }])
    const [turn] = turnsOf(agent.messages)
    expect(turn.text).toBe("You had 132 calls.")
    expect(turn.tail).toMatchObject({ status: "done", userMessageId: "q-1" })
    expect(turn.head?.events.some((e) => e.name === "source_facts")).toBe(true)
    expect(agent.messages.map((m) => m.id)).toEqual(["q-1", ids.tools("run-1"), ids.toolResult("run-1", "tc-1"), ids.head("run-1"), ids.text("run-1", 0), ids.tail("run-1")])
  })

  it("resumes an approval only through the AppSync resume mutation", async () => {
    const { adapter, started } = fakeAdapter()
    const resume = vi.fn(async () => ({ runId: "run-2", status: "running" }))
    Object.assign(adapter, { resumeChatRun: resume })
    await agentWith(adapter).runAgent({ runId: "run-2", resume: [{ interruptId: "write-run-12345678", status: "resolved", payload: { approved: true, values: { notes: "Edited" } } }] })
    expect(started).toHaveLength(0)
    expect(resume).toHaveBeenCalledWith(expect.anything(), { threadId: "thread-1", runId: "run-2", interruptedRunId: "run-12345678", approved: true, values: { notes: "Edited" } })
  })

  it("sends the checked screen context and a short history of finished answers", async () => {
    const { adapter, started } = fakeAdapter()
    const agent = agentWith(adapter)
    await agent.runAgent({ runId: "run-1" })
    agent.addMessage(ask("And last month?", "q-2"))
    await agent.runAgent({
      runId: "run-2",
      context: [{ description: SCREEN_CONTEXT, value: JSON.stringify({ view: "msl", territoryId: "NE-01;DROP", from: "2026-10-01", to: "2026-10-31" }) }],
    })
    expect(started[1]).toMatchObject({
      message: "And last month?",
      context: { view: "msl", from: "2026-10-01", to: "2026-10-31" },
      history: [
        { role: "user", content: "How many calls did I have?" },
        { role: "assistant", content: "You had 132 calls." },
      ],
    })
    expect(started[1].context).not.toHaveProperty("territoryId")
  })

  it("forwards an allowed surface action and ignores anything else", async () => {
    const action = { name: "refine_answer", surfaceId: "s1", sourceComponentId: "submit", timestamp: "2026-11-16T10:00:00Z", context: { measure: "calls" } }
    expect(surfaceActionOf({ forwardedProps: { [SURFACE_ACTION_PROP]: action } })).toEqual(action)
    expect(surfaceActionOf({ forwardedProps: { [SURFACE_ACTION_PROP]: { ...action, name: "openUrl" } } })).toBeUndefined()
    expect(surfaceActionOf({ forwardedProps: {} })).toBeUndefined()
    const { adapter, started } = fakeAdapter()
    await agentWith(adapter).runAgent({ runId: "run-1", forwardedProps: { [SURFACE_ACTION_PROP]: action } })
    expect(started[0].action).toEqual(action)
  })

  it("reads no context it cannot parse", () => {
    expect(contextOf({ context: [{ description: SCREEN_CONTEXT, value: "{not json" }] })).toBeUndefined()
    expect(contextOf({ context: [{ description: "other", value: JSON.stringify({ view: "msl" }) }] })).toBeUndefined()
  })

  it("shows a fixed message when the BE refuses or is unreachable, never the error itself", async () => {
    const forbidden = fakeAdapter(ANSWER, { startChatRun: vi.fn(async () => Promise.reject(new DataError("FORBIDDEN", "secret detail"))) } as Partial<DataAdapter>)
    const agent = agentWith(forbidden.adapter)
    await agent.runAgent({ runId: "run-1" }).catch(() => undefined)
    expect(turnsOf(agent.messages)[0].tail).toMatchObject({ status: "error", error: MESSAGES.forbidden })

    const down = fakeAdapter(ANSWER, { chatEvents: vi.fn(async () => Promise.reject(new Error("socket hang up"))) } as Partial<DataAdapter>)
    const other = agentWith(down.adapter)
    await other.runAgent({ runId: "run-1" }).catch(() => undefined)
    expect(turnsOf(other.messages)[0].tail).toMatchObject({ status: "error", error: MESSAGES.unavailable })
    expect(down.adapter.chatEvents).toHaveBeenCalledTimes(4)
  })

  it("ends a run that takes too long, and one whose log stops without a terminal event", async () => {
    const slow = fakeAdapter(ANSWER, { chatEvents: vi.fn(async () => ({ events: [], done: false, status: "running" })) } as Partial<DataAdapter>)
    const agent = new AppSyncChatAgent({ adapter: slow.adapter, pollMs: 1, maxRunMs: 20, initialMessages: [ask("q")] })
    await agent.runAgent({ runId: "run-1" }).catch(() => undefined)
    expect(turnsOf(agent.messages)[0].tail).toMatchObject({ status: "error", error: MESSAGES.slow })

    const cut = fakeAdapter(ANSWER.slice(0, 6))
    const other = agentWith(cut.adapter)
    await other.runAgent({ runId: "run-1" })
    expect(turnsOf(other.messages)[0]).toMatchObject({ text: "You had 132 calls.", tail: { status: "done" } })
  })

  it("stops on request, keeping the partial answer marked as stopped", async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const log = ANSWER.slice(0, 6)
    const { adapter } = fakeAdapter(log, {
      chatEvents: vi.fn(async (_ctx: unknown, _runId: string, after: number) => {
        if (after >= log.length) await gate
        return { events: log.slice(after).map((event, i) => ({ seq: after + i + 1, data: JSON.stringify(event) })), done: false, status: "running" }
      }),
    } as Partial<DataAdapter>)
    const agent = agentWith(adapter)
    const running = agent.runAgent({ runId: "run-1" })
    await vi.waitFor(() => expect(turnsOf(agent.messages)[0].text).toBe("You had 132 calls."))
    agent.abortRun()
    release()
    await running.catch(() => undefined)
    expect(turnsOf(agent.messages)[0]).toMatchObject({ text: "You had 132 calls.", tail: { status: "error", error: MESSAGES.stopped } })
  })

  it("clones with its adapter, so CopilotKit can copy it", () => {
    const { adapter } = fakeAdapter()
    const copy = agentWith(adapter).clone()
    expect(copy).toBeInstanceOf(AppSyncChatAgent)
    expect(copy.messages).toHaveLength(1)
  })
})

describe("the page the question was asked from (docs/adr/0019)", () => {
  const figures = [{ id: "kpi-calls", label: "Distinct calls", value: "132", definition: "Each call counted once." }]

  it("reads the page's state and its printed figures, checked", () => {
    const page = pageOf({
      state: { page: { label: "My territory", filters: { territoryId: "NE-01", from: "2026-10-01", to: "2026-10-31", hcpId: "H-1", molecule: "<b>" } } },
      context: [{ description: PAGE_FIGURES_CONTEXT, value: JSON.stringify([...figures, { id: "bad id", label: "x", value: "1" }]) }],
    })
    expect(page).toEqual({ label: "My territory", filters: { territoryId: "NE-01", from: "2026-10-01", to: "2026-10-31" }, figures })
  })

  it("sends nothing when there is no page state and no figures, and survives junk", () => {
    expect(pageOf({ state: {}, context: [] })).toBeUndefined()
    expect(pageOf({ state: { page: "x" }, context: [{ description: PAGE_FIGURES_CONTEXT, value: "not json" }] })).toBeUndefined()
  })

  it("sends it with the question through startChatRun", async () => {
    const { adapter, started } = fakeAdapter()
    const agent = agentWith(adapter)
    agent.setState({ page: { label: "My territory", filters: { territoryId: "NE-01" } } })
    await agent.runAgent({ runId: "run-1", context: [{ description: PAGE_FIGURES_CONTEXT, value: JSON.stringify(figures) }] })
    expect(started[0].page).toEqual({ label: "My territory", filters: { territoryId: "NE-01" }, figures })
  })

  it("writes the agent's progress into the shared state and leaves the page's own state alone", async () => {
    const progress = { type: "STATE_SNAPSHOT", snapshot: { progress: { status: "running", steps: [{ id: "scope", label: "Checking what you can see", status: "running" }] }, page: { filters: { territoryId: "XX-99" } } } }
    const { adapter } = fakeAdapter([ANSWER[0], progress, ...ANSWER.slice(1)])
    const agent = agentWith(adapter)
    agent.setState({ page: { label: "My territory", filters: { territoryId: "NE-01" } } })
    await agent.runAgent({ runId: "run-1" })
    const state = agent.state as { page: unknown; progress: { status: string; steps: { status: string }[] }; proposal: unknown }
    expect(state.page).toEqual({ label: "My territory", filters: { territoryId: "NE-01" } })
    expect(state.progress).toEqual({ status: "done", steps: [{ id: "scope", label: "Checking what you can see", status: "done" }] })
    expect(state.proposal).toBeNull()
  })

  it("puts the agent's proposal in the shared state for the page to offer", async () => {
    const proposal = { id: "run-1-proposal", status: "proposed", reason: "Set the page to territory NE-01.", filters: { territoryId: "NE-01" } }
    const { adapter } = fakeAdapter([ANSWER[0], { type: "STATE_SNAPSHOT", snapshot: { proposal } }, ...ANSWER.slice(1)])
    const agent = agentWith(adapter)
    await agent.runAgent({ runId: "run-1" })
    expect((agent.state as { proposal: unknown }).proposal).toEqual(proposal)
  })
})
