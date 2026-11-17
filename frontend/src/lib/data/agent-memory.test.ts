import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
import { createGraphQLAdapter } from "./graphql-adapter"
import { MEMORY_EMPTY, MEMORY_REFUSAL, categorize, checkPreference, parseMemoryRequest } from "./memory-guard"
import { createMockAdapter } from "./mock-adapter"
import { readRun, scriptResume, scriptRun } from "./mock-chat"
import { resetMockAgentMemory } from "./mock-memory"
import { CLEAR_AGENT_MEMORY_MUTATION, DELETE_AGENT_MEMORY_MUTATION, MY_AGENT_MEMORY_QUERY, SAVE_AGENT_MEMORY_MUTATION } from "./operations"
import { findUser } from "./fixtures"
import { DataError } from "./types"

const ctx = { correlationId: "test" }
const NOW = () => new Date("2026-11-16T12:00:00Z")
const make = (userId: string) => createMockAdapter({ getUserId: () => userId, latencyMs: 0, now: NOW })

// The same cases the BE and the agent run (backend/agent_memory_guard_cases.json), so the three guards cannot drift.
const CASES = JSON.parse(readFileSync(resolve(__dirname, "../../../../backend/agent_memory_guard_cases.json"), "utf8")) as { accepted: string[]; rejected: Record<string, string[]> }

describe("the preference guard (the BE's rules, mirrored)", () => {
  it.each(CASES.accepted)("accepts a preference about how to work: %s", (text) => expect(checkPreference(text)).toBeNull())
  it.each(Object.entries(CASES.rejected).flatMap(([reason, texts]) => texts.map((text) => [reason, text] as const)))("refuses (%s): %j", (reason, text) => expect(checkPreference(text)).toBe(reason))

  it("picks a category by rule", () => {
    expect(categorize("I prefer tables over charts")).toBe("FORMAT")
    expect(categorize("Default to the last 90 days")).toBe("DATE_RANGE")
    expect(categorize("Keep briefs to 5 bullets")).toBe("LENGTH")
    expect(categorize("Focus on oncology")).toBe("FOCUS")
    expect(categorize("Be nice")).toBe("OTHER")
  })

  it("reads only an imperative remember as a save request", () => {
    expect(parseMemoryRequest("Remember I prefer tables over charts.")).toEqual({ kind: "propose", values: { text: "I prefer tables over charts", category: "FORMAT" } })
    expect(parseMemoryRequest("please remember that: default to the last 90 days")).toMatchObject({ kind: "propose" })
    for (const chat of ["Do you remember what I asked?", "What do you remember about me?", "remembered tables", "How many calls did I have?"]) expect(parseMemoryRequest(chat)).toBeNull()
    expect(parseMemoryRequest("Remember HCP-0001 prefers email")).toEqual({ kind: "refuse", reply: MEMORY_REFUSAL })
    expect(parseMemoryRequest("remember")).toEqual({ kind: "refuse", reply: MEMORY_EMPTY })
  })
})

describe("remembered preferences (mock of the FE DynamoDB items)", () => {
  beforeEach(resetMockAgentMemory)

  it("starts empty and round-trips an item, oldest first", async () => {
    const adapter = make("u-msl-ne-01")
    await expect(adapter.myAgentMemory(ctx)).resolves.toEqual([])
    const first = await adapter.saveAgentMemory(ctx, { text: "I prefer tables", category: "FORMAT" })
    const second = await adapter.saveAgentMemory(ctx, { text: "Default to the last 90 days", category: "DATE_RANGE" })
    expect(first).toMatchObject({ text: "I prefer tables", category: "FORMAT", createdAt: "2026-11-16T12:00:00.000Z" })
    await expect(adapter.myAgentMemory(ctx)).resolves.toEqual([first, second])
  })

  it("is private to each person", async () => {
    await make("u-dir-ne").saveAgentMemory(ctx, { text: "I prefer tables", category: "FORMAT" })
    await expect(make("u-msl-ne-01").myAgentMemory(ctx)).resolves.toEqual([])
    const theirs = (await make("u-dir-ne").myAgentMemory(ctx))[0]
    await expect(make("u-msl-ne-01").deleteAgentMemory(ctx, theirs.memoryId)).rejects.toMatchObject({ code: "NOT_FOUND" })
    await expect(make("u-dir-ne").myAgentMemory(ctx)).resolves.toHaveLength(1)
  })

  it("keeps one item per distinct text", async () => {
    const adapter = make("u-msl-ne-01")
    const first = await adapter.saveAgentMemory(ctx, { text: "I prefer tables", category: "FORMAT" })
    await expect(adapter.saveAgentMemory(ctx, { text: "i PREFER   tables", category: "FORMAT" })).resolves.toEqual(first)
    await expect(adapter.myAgentMemory(ctx)).resolves.toHaveLength(1)
  })

  it("refuses a record fact, an unknown category and a full list, and stores nothing", async () => {
    const adapter = make("u-msl-ne-01")
    await expect(adapter.saveAgentMemory(ctx, { text: "HCP-0001 prefers email", category: "OTHER" })).rejects.toBeInstanceOf(DataError)
    await expect(adapter.saveAgentMemory(ctx, { text: "I prefer tables", category: "NOPE" as never })).rejects.toBeInstanceOf(DataError)
    await expect(adapter.myAgentMemory(ctx)).resolves.toEqual([])
    for (let i = 0; i < 30; i++) await adapter.saveAgentMemory(ctx, { text: `Prefer style ${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`, category: "OTHER" })
    await expect(adapter.saveAgentMemory(ctx, { text: "One more preference", category: "OTHER" })).rejects.toMatchObject({ code: "BAD_REQUEST" })
  })

  it("deletes one item and clears the rest", async () => {
    const adapter = make("u-msl-ne-01")
    const first = await adapter.saveAgentMemory(ctx, { text: "I prefer tables", category: "FORMAT" })
    await adapter.saveAgentMemory(ctx, { text: "Keep briefs to 5 bullets", category: "LENGTH" })
    await adapter.deleteAgentMemory(ctx, first.memoryId)
    expect((await adapter.myAgentMemory(ctx)).map((item) => item.text)).toEqual(["Keep briefs to 5 bullets"])
    await expect(adapter.clearAgentMemory(ctx)).resolves.toBe(1)
    await expect(adapter.myAgentMemory(ctx)).resolves.toEqual([])
  })
})

describe("a remember request in the mock chat (the agent's flow)", () => {
  const user = findUser("u-msl-ne-01")
  const eventsOf = (runId: string) => (readRun(runId, 0, Date.now() + 60_000)?.events ?? []).map((e) => JSON.parse(e.data) as Record<string, unknown>)

  it("ends at the approval card, and approving hands the browser one closed tool call", () => {
    scriptRun("run-remember-1", user, "Remember I prefer tables over charts")
    const finished = eventsOf("run-remember-1").at(-1) as { outcome: { type: string; interrupts: { metadata: { kind: string; values: Record<string, string> } }[] } }
    expect(finished.outcome.type).toBe("interrupt")
    expect(finished.outcome.interrupts[0].metadata).toMatchObject({ kind: "save_preference", values: { text: "I prefer tables over charts", category: "FORMAT" } })

    expect(scriptResume({ runId: "run-remember-2", interruptedRunId: "run-remember-1", approved: true, values: { text: "I prefer tables" } })).toBe(true)
    const args = eventsOf("run-remember-2").find((e) => e.type === "TOOL_CALL_ARGS") as { delta: string }
    expect(JSON.parse(args.delta)).toEqual({ kind: "save_preference", values: { text: "I prefer tables", category: "FORMAT" } })
  })

  it("saves nothing when the approval is rejected or the edit turns it into a record fact", () => {
    scriptRun("run-remember-3", user, "Remember I prefer tables")
    for (const [runId, approved, values] of [["run-r-4", false, undefined], ["run-r-5", true, { text: "HCP-0001 prefers email" }], ["run-r-6", true, { category: "SECRET" }]] as const) {
      expect(scriptResume({ runId, interruptedRunId: "run-remember-3", approved, values })).toBe(true)
      const events = eventsOf(runId)
      expect(events.some((e) => e.type === "TOOL_CALL_START")).toBe(false)
      expect(events.find((e) => e.type === "TEXT_MESSAGE_CONTENT")).toMatchObject({ delta: "No changes were saved." })
    }
  })

  it("refuses a record fact with a fixed reply and no approval card", () => {
    scriptRun("run-remember-7", user, "Remember Dr. Smith had 12 calls")
    const events = eventsOf("run-remember-7")
    expect(events.some((e) => e.type === "RUN_FINISHED" && (e.outcome as { type?: string } | undefined)?.type === "interrupt")).toBe(false)
    expect(events.map((e) => (e.type === "TEXT_MESSAGE_CONTENT" ? e.delta : "")).join("").trim()).toBe(MEMORY_REFUSAL)
  })
})

describe("remembered preferences over AppSync", () => {
  it("sends one operation per call and never an owner", async () => {
    const sent: { query: string; variables?: Record<string, unknown> }[] = []
    const item = { memoryId: "20261116120000-0000000a", text: "I prefer tables", category: "FORMAT", createdAt: "2026-11-16T12:00:00Z" }
    const replies: Record<string, unknown> = {
      [MY_AGENT_MEMORY_QUERY]: { myAgentMemory: [item] },
      [SAVE_AGENT_MEMORY_MUTATION]: { saveAgentMemory: item },
      [DELETE_AGENT_MEMORY_MUTATION]: { deleteAgentMemory: true },
      [CLEAR_AGENT_MEMORY_MUTATION]: { clearAgentMemory: 1 },
    }
    const adapter = createGraphQLAdapter(async (req) => {
      sent.push(req)
      return { data: replies[req.query] as never }
    })
    await expect(adapter.myAgentMemory(ctx)).resolves.toEqual([item])
    await expect(adapter.saveAgentMemory(ctx, { text: "I prefer tables", category: "FORMAT" })).resolves.toEqual(item)
    await expect(adapter.deleteAgentMemory(ctx, item.memoryId)).resolves.toBeUndefined()
    await expect(adapter.clearAgentMemory(ctx)).resolves.toBe(1)
    expect(sent.map((request) => Object.keys(request.variables ?? {}))).toEqual([[], ["input"], ["memoryId"], []])
    expect(JSON.stringify(sent)).not.toMatch(/owner|userId/i)
  })
})
