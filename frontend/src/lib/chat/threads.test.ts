import { describe, expect, it, vi } from "vitest"
import { createMockAdapter, resetMockFlags } from "@/lib/data/mock-adapter"
import { type ChatRunInput } from "@/lib/data/adapter"
import type { ChatThreadSummary, DataAdapter } from "@/lib/data"
import { ids } from "./agent/answer"
import { historyOf, turnsOf } from "./agent/turns"
import { listThreads, loadThreadMessages, threadDate, threadTitle, turnCountLabel } from "./threads"

const ctx = { correlationId: "test" }
const thread = (over: Partial<ChatThreadSummary>): ChatThreadSummary => ({ threadId: "t1", title: "Q", startedAt: "2026-11-01T09:00:00Z", updatedAt: "2026-11-01T09:00:00Z", turnCount: 1, ...over })

describe("the conversation list", () => {
  it("lists the most recently active conversation first, whatever order they arrive in", () => {
    const rows = [thread({ threadId: "old", updatedAt: "2026-10-01T09:00:00Z" }), thread({ threadId: "new", updatedAt: "2026-11-03T09:00:00Z" }), thread({ threadId: "mid", updatedAt: "2026-10-20T09:00:00Z" })]
    expect(listThreads(rows).map((t) => t.threadId)).toEqual(["new", "mid", "old"])
  })

  it("keeps one row per conversation (the newest) and drops rows that cannot be opened or dated", () => {
    const rows = [
      thread({ threadId: "a", updatedAt: "2026-11-01T09:00:00Z", turnCount: 1 }),
      thread({ threadId: "a", updatedAt: "2026-11-02T09:00:00Z", turnCount: 2 }),
      thread({ threadId: "", updatedAt: "2026-11-02T09:00:00Z" }),
      thread({ threadId: "bad-date", updatedAt: "not a date" }),
      null as unknown as ChatThreadSummary,
    ]
    expect(listThreads(rows)).toEqual([thread({ threadId: "a", updatedAt: "2026-11-02T09:00:00Z", turnCount: 2 })])
  })

  it("never shows an empty title, and counts questions", () => {
    expect(threadTitle({ title: "   " })).toBe("Conversation")
    expect(threadTitle({ title: " How many calls? " })).toBe("How many calls?")
    expect([turnCountLabel(1), turnCountLabel(3)]).toEqual(["1 question", "3 questions"])
  })

  it("dates a conversation by time today, then Yesterday, a weekday, and a plain date", () => {
    const now = new Date(2026, 10, 16, 15, 0) // Mon 16 Nov 2026, local time
    const at = (d: number, h = 9, m = 5) => new Date(2026, 10, d, h, m).toISOString()
    expect(threadDate(at(16), now, "en-US")).toBe("9:05 AM")
    expect(threadDate(at(15), now, "en-US")).toBe("Yesterday")
    expect(threadDate(at(12), now, "en-US")).toBe("Thursday")
    expect(threadDate(at(2), now, "en-US")).toBe("Nov 2")
    expect(threadDate(new Date(2025, 11, 30).toISOString(), now, "en-US")).toBe("Dec 30, 2025")
  })
})

/** The mock adapter stands in for AppSync: a run is saved once its answer has finished streaming. */
function conversation(userId = "u-msl-ne-01") {
  resetMockFlags()
  let time = Date.parse("2026-11-16T10:00:00Z")
  const adapter = createMockAdapter({ getUserId: () => userId, latencyMs: 0, now: () => new Date(time) })
  const ask = async (threadId: string, runId: string, message: string, history: ChatRunInput["history"] = []) => {
    await adapter.startChatRun(ctx, { threadId, runId, message, history })
    time += 60_000 // the answer has streamed and been saved
  }
  return { adapter, ask, advance: (ms: number) => (time += ms) }
}

describe("reopening a conversation", () => {
  it("lists the conversations a person asked, newest activity first, titled by the first question", async () => {
    const { adapter, ask } = conversation()
    await ask("thread-one", "run-one-1", "How many calls did I have in the last 90 days?")
    await ask("thread-one", "run-one-2", "And which territories can I see?")
    await ask("thread-two", "run-two-1", "Which territories can I see?")
    const list = await adapter.myChatThreads(ctx)
    expect(list.map((t) => [t.threadId, t.title, t.turnCount])).toEqual([
      ["thread-two", "Which territories can I see?", 1],
      ["thread-one", "How many calls did I have in the last 90 days?", 2],
    ])
    expect(Date.parse(list[1].updatedAt)).toBeGreaterThan(Date.parse(list[1].startedAt))
  })

  it("does not list an answer that is still being written, or one waiting for approval", async () => {
    const { adapter } = conversation()
    await adapter.startChatRun(ctx, { threadId: "thread-one", runId: "run-one-1", message: "How many calls did I have in the last 90 days?", history: [] })
    expect(await adapter.myChatThreads(ctx)).toEqual([])
    const approval = conversation()
    await approval.ask("thread-two", "run-two-1", "save post-call output: A note")
    expect(await approval.adapter.myChatThreads(ctx)).toEqual([])
  })

  it("rebuilds the saved answer with its figures, citations and Adjust surface, so it reads as it did", async () => {
    const { adapter, ask } = conversation()
    await ask("thread-one", "run-one-1", "How many calls did I have in the last 90 days?")
    const messages = await loadThreadMessages(adapter, "thread-one")
    expect(messages.map((m) => m.id)).toEqual([
      "history~run-one-1~question",
      ids.head("run-one-1"),
      ids.text("run-one-1", 0),
      expect.stringMatching(/^history~run-one-1~surface~/),
      ids.tail("run-one-1"),
    ])
    const [turn] = turnsOf(messages)
    expect(turn.question).toBe("How many calls did I have in the last 90 days?")
    expect(turn.text).toMatch(/distinct calls/)
    expect(turn.tail).toMatchObject({ status: "done", error: null })
    const evidence = turn.head!.events.map((e) => e.name)
    expect(evidence).toEqual(expect.arrayContaining(["source_facts", "citations"]))
  })

  it("rebuilds a chart a saved answer drew", async () => {
    const { adapter, ask } = conversation()
    await ask("thread-one", "run-one-1", "Show my calls by month")
    const [turn] = turnsOf(await loadThreadMessages(adapter, "thread-one"))
    expect(turn.head!.events.filter((e) => e.name === "visual")).toHaveLength(1)
  })

  it("keeps the turns in the order they were asked, and the next question continues with them as context", async () => {
    const { adapter, ask } = conversation()
    await ask("thread-one", "run-one-1", "How many calls did I have in the last 90 days?")
    await ask("thread-one", "run-one-2", "Which territories can I see?")
    const messages = await loadThreadMessages(adapter, "thread-one")
    expect(turnsOf(messages).map((t) => t.question)).toEqual(["How many calls did I have in the last 90 days?", "Which territories can I see?"])
    // The same history the live thread would send: finished questions with the answers' text.
    expect(historyOf(messages)).toEqual([
      { role: "user", content: "How many calls did I have in the last 90 days?" },
      { role: "assistant", content: expect.stringContaining("distinct calls") },
      { role: "user", content: "Which territories can I see?" },
      { role: "assistant", content: expect.any(String) },
    ])
  })

  it("reopens only the asked conversation, and only the caller's own", async () => {
    const { adapter, ask } = conversation()
    await ask("thread-one", "run-one-1", "How many calls did I have in the last 90 days?")
    await ask("thread-two", "run-two-1", "Which territories can I see?")
    expect(turnsOf(await loadThreadMessages(adapter, "thread-two")).map((t) => t.question)).toEqual(["Which territories can I see?"])
    expect(await loadThreadMessages(adapter, "unknown-thread")).toEqual([])
    // Someone else's saved conversations are in another partition: their id finds nothing.
    const other = createMockAdapter({ getUserId: () => "u-msl-se-03", latencyMs: 0 })
    expect(await other.myChatThreads(ctx)).toEqual([])
    expect(await loadThreadMessages(other, "thread-one")).toEqual([])
  })

  it("never mixes in turns of another thread, whatever the adapter returned", async () => {
    const turn = (threadId: string, runId: string) => ({ threadId, runId, userMessage: `Q ${runId}`, assistantText: "A", generatedAt: "2026-11-01T09:00:00Z", payload: "{}" })
    const adapter = { myChatThread: vi.fn(async () => [turn("mine", "r1"), turn("other", "r2")]) } as unknown as DataAdapter
    expect(turnsOf(await loadThreadMessages(adapter, "mine")).map((t) => t.question)).toEqual(["Q r1"])
  })

  it("an aggregate-only Executive reopens nothing; with record access they can", async () => {
    resetMockFlags()
    const make = (scenario: "ok" | "records") => createMockAdapter({ getUserId: () => "u-exec-all", getScenario: () => scenario, latencyMs: 0, now: () => new Date(time) })
    let time = Date.parse("2026-11-16T10:00:00Z")
    const aggregate = make("ok")
    await aggregate.startChatRun(ctx, { threadId: "thread-one", runId: "run-one-1", message: "Which territories can I see?", history: [] })
    time += 60_000
    expect(await aggregate.myChatThreads(ctx)).toEqual([])
    expect(await aggregate.myChatThread(ctx, "thread-one")).toEqual([])
    expect((await make("records").myChatThreads(ctx)).map((t) => t.threadId)).toEqual(["thread-one"])
  })
})
