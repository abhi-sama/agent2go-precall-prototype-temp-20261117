import { describe, expect, it } from "vitest"
import { createMockAdapter } from "@/lib/data/mock-adapter"
import { historyOf, type ChatTurn } from "./use-chat"
import type { ChatSurfaceActionInput } from "@/lib/data/types"
import { screenOperations } from "./a2ui/protocol"
import { newTurn } from "./events"

describe("historyOf", () => {
  it("passes only finished answers, newest few, as alternating messages", () => {
    const turn = (id: string, status: "done" | "running" | "error", text: string): ChatTurn => ({
      id,
      question: `q-${id}`,
      answer: { ...newTurn(id), status, text },
    })
    const history = historyOf([turn("1", "done", "a1"), turn("2", "error", "x"), turn("3", "done", "a3"), turn("4", "running", "")])
    expect(history).toEqual([
      { role: "user", content: "q-1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q-3" },
      { role: "assistant", content: "a3" },
    ])
  })
})

describe("mock chat", () => {
  const adapter = (userId: string) => createMockAdapter({ getUserId: () => userId, latencyMs: 0, getScenario: () => "ok" })
  const ctx = { correlationId: "c1" }
  const eventsOf = async (userId: string, question: string, action?: ChatSurfaceActionInput) => {
    const a = adapter(userId)
    const runId = `run-${Math.random().toString(16).slice(2, 10)}`
    await a.startChatRun(ctx, { threadId: "t", runId, message: question, history: [], ...(action ? { action } : {}) })
    await new Promise((r) => setTimeout(r, 0))
    // Jump ahead: ask for events long after the run started.
    const real = Date.now
    Date.now = () => real() + 60_000
    try {
      const page = await createMockAdapter({ getUserId: () => userId, latencyMs: 0, now: () => new Date(Date.now()) }).chatEvents(ctx, runId, 0)
      return page
    } finally {
      Date.now = real
    }
  }

  it("streams facts for an in-scope question", async () => {
    const page = await eventsOf("u-msl-ne-01", "How many calls did I have?")
    expect(page.done).toBe(true)
    const types = page.events.map((e) => JSON.parse(e.data).type)
    expect(types[0]).toBe("RUN_STARTED")
    expect(types.at(-1)).toBe("RUN_FINISHED")
    expect(page.events.some((e) => e.data.includes('"source_facts"'))).toBe(true)
  })

  it("routes broad HCP concerns through recorded responses instead of activity", async () => {
    const page = await eventsOf("u-msl-ne-01", "What are the main concerns of HCPs?")
    const text = page.events.map((e) => JSON.parse(e.data)).filter((e) => e.type === "TEXT_MESSAGE_CONTENT").map((e) => e.delta).join("")
    expect(page.events.some((e) => e.data.includes('"search_recorded_responses"'))).toBe(true)
    expect(page.events.some((e) => e.data.includes('"get_activity_summary"'))).toBe(false)
    expect(text).toContain("recorded HCP concerns")
  })

  it("does not invent an activity summary for an unknown mock question", async () => {
    const page = await eventsOf("u-msl-ne-01", "Can you write me a limerick about Tuesday?")
    const text = page.events.map((e) => JSON.parse(e.data)).filter((e) => e.type === "TEXT_MESSAGE_CONTENT").map((e) => e.delta).join("")
    expect(page.events.some((e) => e.data.includes('"source_facts"'))).toBe(false)
    expect(text).toContain("does not have a scripted answer")
  })

  it("returns no facts for a territory outside scope", async () => {
    const page = await eventsOf("u-msl-ne-01", "How many calls in SE-03?")
    expect(page.events.some((e) => e.data.includes('"source_facts"'))).toBe(false)
    const text = page.events.map((e) => JSON.parse(e.data)).filter((e) => e.type === "TEXT_MESSAGE_CONTENT").map((e) => e.delta).join("")
    expect(text).toContain("outside your scope")
  })

  const surfacesOf = (page: { events: { data: string }[] }) =>
    page.events.map((e) => JSON.parse(e.data)).filter((e) => e.type === "ACTIVITY_SNAPSHOT").map((e) => e.content.a2ui_operations[0].createSurface)
  const refineAction = (context: Record<string, unknown>): ChatSurfaceActionInput => ({
    name: "refine_answer", surfaceId: "refine_1_run-x", sourceComponentId: "submit", timestamp: "2026-11-12T10:00:00.000Z", context,
  })

  it("offers the Adjust form after a count answer, as the agent does, and every surface passes the gate", async () => {
    const page = await eventsOf("u-msl-ne-01", "How many calls did I have in the last 90 days?")
    const [form] = surfacesOf(page)
    expect(form.dataModel).toMatchObject({ measure: ["calls"], group: ["total"], territory: ["all"] })
    for (const e of page.events.map((x) => JSON.parse(x.data)).filter((x) => x.type === "ACTIVITY_SNAPSHOT")) {
      expect(screenOperations(e.content.a2ui_operations)).not.toBeNull()
    }
  })

  it("answers an Adjust-form action with the chosen measure, grouping and period, and a new form keeping them", async () => {
    const page = await eventsOf("u-msl-ne-01", "Update this answer: Engaged HCPs · By month", refineAction({ measure: ["engaged_hcps"], group: ["month"], territory: ["NE-01"], from: "2026-09-01", to: "2026-10-31" }))
    const events = page.events.map((e) => JSON.parse(e.data))
    const visual = events.find((e) => e.name === "visual" && e.value.phase === "ready")
    expect(visual.value).toMatchObject({ metric: "engaged_hcps", kind: "line", period: "2026-09-01 to 2026-10-31", scope: "NE-01" })
    const [form] = surfacesOf(page)
    expect(form.dataModel).toEqual({ measure: ["engaged_hcps"], group: ["month"], from: "2026-09-01", to: "2026-10-31", territory: ["NE-01"] })
  })

  it("refuses an action outside the closed lists or the caller's scope, reading nothing", async () => {
    for (const context of [{ measure: ["revenue"], group: ["month"], from: "2026-09-01", to: "2026-10-31" }, { measure: ["calls"], group: ["total"], territory: ["SE-03"], from: "2026-09-01", to: "2026-10-31" }]) {
      const page = await eventsOf("u-msl-ne-01", "Update this answer", refineAction(context))
      expect(page.events.some((e) => e.data.includes('"source_facts"'))).toBe(false)
      expect(surfacesOf(page)).toEqual([])
    }
  })

  it("gives an executive aggregate-only surfaces: a withheld word in the theme table and no territory picker", async () => {
    const themes = surfacesOf(await eventsOf("u-exec-all", "Which topics are rising across regions?"))
    expect(themes.map((s) => s.surfaceId.split("_")[0])).toEqual(["org"])
    expect(JSON.stringify(themes)).not.toMatch(/CALL-\d|RESP-\d/)
    const [form] = surfacesOf(await eventsOf("u-exec-all", "Show calls by month"))
    expect(form.dataModel).not.toHaveProperty("territory")
  })

  it("gives an executive a suppressed aggregate activity chart without source rows", async () => {
    const page = await eventsOf("u-exec-all", "Show calls by month")
    const custom = page.events.map((event) => JSON.parse(event.data)).filter((event) => event.type === "CUSTOM")
    const facts = custom.find((event) => event.name === "source_facts")
    const citations = custom.find((event) => event.name === "citations")
    const visual = custom.find((event) => event.name === "visual" && event.value?.phase === "ready")
    expect(facts.value.facts).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Distinct calls", value: 48 })]))
    expect(citations.value).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "aggregate", record_id: expect.stringMatching(/^agg:/) })]))
    expect(visual.value.points).toHaveLength(2)
    expect(JSON.stringify(page.events)).not.toMatch(/CALL-\d|RESP-\d/)
  })
})
