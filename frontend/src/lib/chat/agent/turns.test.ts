import type { Message } from "@ag-ui/core"
import { describe, expect, it } from "vitest"
import { ANSWER_ACTIVITY, ids, type AnswerActivity } from "./answer"
import { INTERRUPTED, historyOf, settle, turnsOf } from "./turns"

const activity = (runId: string, part: "head" | "tail", status: AnswerActivity["status"] = "done"): Message =>
  ({
    id: part === "head" ? ids.head(runId) : ids.tail(runId),
    role: "activity",
    activityType: ANSWER_ACTIVITY,
    content: { v: 1, runId, part, userMessageId: `q-${runId}`, status, error: status === "error" ? "Stopped." : null, events: [] } satisfies AnswerActivity,
  }) as Message

const turn = (runId: string, text: string, status: AnswerActivity["status"] | null = "done"): Message[] => [
  { id: `q-${runId}`, role: "user", content: `question ${runId}` },
  { id: ids.text(runId, 0), role: "assistant", content: text },
  ...(status ? [activity(runId, "tail", status)] : []),
]

describe("turns", () => {
  it("groups a thread into one turn per question, traced to its run", () => {
    const turns = turnsOf([...turn("r1", "first"), ...turn("r2", "second")])
    expect(turns.map((t) => [t.questionId, t.runId, t.text, t.tail?.status])).toEqual([
      ["q-r1", "r1", "first", "done"],
      ["q-r2", "r2", "second", "done"],
    ])
  })

  it("sends only finished answers as history, newest three, text only", () => {
    const messages = [...turn("r1", "one"), ...turn("r2", "two", "error"), ...turn("r3", "three"), ...turn("r4", "four"), ...turn("r5", "five")]
    expect(historyOf(messages).map((m) => m.content)).toEqual(["question r3", "three", "question r4", "four", "question r5", "five"])
  })

  it("marks an answer cut off by a reload as interrupted, once", () => {
    const settled = settle([...turn("r1", "one"), ...turn("r2", "half", null)])
    const last = turnsOf(settled).at(-1)!
    expect(last.tail).toMatchObject({ status: "error", error: INTERRUPTED, runId: "r2", userMessageId: "q-r2" })
    expect(settle(settled)).toHaveLength(settled.length)
    expect(historyOf(settled).map((m) => m.content)).toEqual(["question r1", "one"])
  })

  it("ignores an answer activity that does not match the schema", () => {
    const forged = { id: "x~answer-tail", role: "activity", activityType: ANSWER_ACTIVITY, content: { part: "tail", status: "done" } } as Message
    expect(turnsOf([{ id: "q", role: "user", content: "q" }, forged])[0].tail).toBeNull()
  })

  it("keeps the steps the agent reported on a finished answer, and drops an answer whose steps are forged", () => {
    const withSteps = (steps: unknown): Message =>
      ({ ...activity("r1", "tail"), content: { ...(activity("r1", "tail") as unknown as { content: object }).content, steps } }) as Message
    const steps = [{ id: "scope", label: "Checking what you can see", status: "done" }]
    expect(turnsOf([{ id: "q-r1", role: "user", content: "q" }, withSteps(steps)])[0].tail?.steps).toEqual(steps)
    expect(turnsOf([{ id: "q-r1", role: "user", content: "q" }, withSteps([{ id: "x", label: "y", status: "exploded" }])])[0].tail).toBeNull()
  })
})
