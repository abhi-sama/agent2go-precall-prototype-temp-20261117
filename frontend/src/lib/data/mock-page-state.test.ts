import { describe, expect, it } from "vitest"
import { sanitizeProgress, sanitizeProposal } from "@/lib/chat/page-state"
import { createMockAdapter } from "./mock-adapter"
import { inferMockProposal, withProgress } from "./mock-page-state"

const ctx = { correlationId: "test" }
const clock = { ms: Date.parse("2026-11-03T12:00:00Z") }
const make = (userId: string) => createMockAdapter({ getUserId: () => userId, getScenario: () => "ok", latencyMs: 0, now: () => new Date(clock.ms) })

async function events(userId: string, runId: string, question: string) {
  const a = make(userId)
  await a.startChatRun(ctx, { threadId: "t", runId, message: question, history: [] })
  clock.ms += 60_000
  const page = await a.chatEvents(ctx, runId, 0)
  return page.events.map((e) => JSON.parse(e.data) as Record<string, unknown>)
}

const states = (log: Record<string, unknown>[]) => log.filter((e) => e.type === "STATE_SNAPSHOT").map((e) => e.snapshot as Record<string, unknown>)

describe("inferMockProposal (mirrors the agent's rule)", () => {
  it.each([
    ["Filter the page to territory NE-01 for the last 90 days", { filters: { preset: "90d", territoryId: "NE-01" } }],
    ["Please set the dashboard to 2026-01-01 to 2026-03-31", { filters: { from: "2026-01-01", to: "2026-03-31" } }],
    ["Can you please narrow the view to Q-007", { filters: { questionId: "Q-007" } }],
    ["Let's reset the filters", { filters: {}, reset: true }],
    ["Switch to the last 30 days on this page", { filters: { preset: "30d" } }],
  ])("proposes for %s", (question, expected) => {
    expect(inferMockProposal(question)).toEqual(expected)
  })

  it.each([
    "How many calls on my dashboard last 30 days?",
    "show me the calls on my dashboard for the last 30 days",
    "Why does the dashboard filter to NE-01 by default?",
    "What changed on the page in the last 7 days?",
    "I think you should reset the filters",
    "Filter the page please",
    "Set the page to 2026-03-31 to 2026-01-01",
  ])("does not propose for %s", (question) => {
    expect(inferMockProposal(question)).toBeNull()
  })
})

describe("progress in a mock run", () => {
  it("steps through the scope check, each tool, the answer and the number check, then settles done", async () => {
    const log = await events("u-msl-ne-01", "run-progress-1", "How many calls did I have in the last 90 days?")
    const snapshots = states(log).map((s) => sanitizeProgress(s.progress)!)
    expect(snapshots.every(Boolean)).toBe(true)
    const final = snapshots.at(-1)!
    expect(final.status).toBe("done")
    expect(final.steps.map((s) => s.label)).toEqual(["Checking what you can see", "Counting your activity", "Writing the answer", "Checking every number against your data"])
    expect(final.steps.every((s) => s.status === "done")).toBe(true)
    // It was running before it was done, and the last snapshot comes before the run ends.
    expect(snapshots[0].status).toBe("running")
    expect(log.at(-1)).toMatchObject({ type: "RUN_FINISHED" })
  })

  it("wraps an event list without touching its events", () => {
    const raw = [JSON.stringify({ type: "RUN_STARTED" }), JSON.stringify({ type: "CUSTOM", name: "model_mode", value: {} }), JSON.stringify({ type: "RUN_FINISHED" })]
    const woven = withProgress(raw)
    expect(woven.filter((e) => JSON.parse(e).type !== "STATE_SNAPSHOT")).toEqual(raw)
  })
})

describe("page proposals in a mock run", () => {
  it("offers a change to the page's filters, in the answer and in the shared state, for a territory the caller can see", async () => {
    const log = await events("u-msl-ne-01", "run-proposal-1", "Filter the page to territory NE-01 for the last 90 days")
    const proposal = states(log).map((s) => s.proposal).filter(Boolean)
    expect(proposal).toHaveLength(1)
    expect(sanitizeProposal(proposal[0])).toMatchObject({ id: "run-proposal-1-proposal", status: "proposed", filters: { preset: "90d", territoryId: "NE-01" } })
    const text = log.filter((e) => e.type === "TEXT_MESSAGE_CONTENT").map((e) => e.delta).join("")
    expect(text).toContain("territory NE-01, the last 90 days")
    expect(text).toContain("nothing changes until you do")
    expect(log.some((e) => e.type === "TOOL_CALL_START")).toBe(false)
  })

  it("makes no proposal for a territory outside the caller's scope", async () => {
    const log = await events("u-msl-ne-01", "run-proposal-2", "Filter the page to territory WE-04")
    expect(states(log).some((s) => s.proposal)).toBe(false)
    expect(log.filter((e) => e.type === "TEXT_MESSAGE_CONTENT").map((e) => e.delta).join("")).toContain("outside your scope")
  })

  it("lets an aggregate-only role change the date range but never filter to a territory or a question", async () => {
    const dates = await events("u-exec-all", "run-proposal-3", "Set the dashboard to the last 7 days")
    expect(states(dates).map((s) => s.proposal).filter(Boolean)).toHaveLength(1)
    const territory = await events("u-exec-all", "run-proposal-4", "Filter the page to territory NE-01")
    expect(states(territory).some((s) => s.proposal)).toBe(false)
    expect(territory.filter((e) => e.type === "TEXT_MESSAGE_CONTENT").map((e) => e.delta).join("")).toContain("aggregate-only role")
  })
})
