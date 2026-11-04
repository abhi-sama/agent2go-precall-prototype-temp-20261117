/**
 * Scripted chat runs for the mock adapter (UI work and iPad smoke tests without a backend).
 *
 * It mirrors the BE contract: a run is a list of AG-UI events, revealed over time so the panel
 * streams. Numbers come from the same fixture arithmetic as the KPI cards, never from "the model".
 */
import { todayIso, addDays } from "@/lib/dates"
import { TERRITORIES, type FixtureUser } from "./fixtures"
import type { ChatEventPage, SourceRecord } from "./types"

interface ScheduledEvent {
  seq: number
  at: number
  data: string
}

const runs = new Map<string, { startedAt: number; events: ScheduledEvent[] }>()

const TOKEN_MS = 90
const ev = (type: string, extra: Record<string, unknown> = {}) => JSON.stringify({ type, timestamp: Date.now(), ...extra })
const custom = (name: string, value: unknown) => ev("CUSTOM", { name, value })

export function scriptRun(runId: string, user: FixtureUser, question: string, now = Date.now()): void {
  const asked = question.match(/\b([A-Z]{2}-\d{2})\b/)?.[1]
  const events: string[] = [ev("RUN_STARTED", { threadId: "mock", runId }), custom("model_mode", { mode: "claude" })]
  let answer: string
  const suggestions = ["Which territories can I see?", "What have HCPs recorded about osimertinib?"]

  if (user.persona === "executive" || user.persona === "admin" || user.territoryIds.length === 0) {
    answer = "Record-level questions are not available for your role yet. Aggregate views are on your landing page."
  } else if (asked && !user.territoryIds.includes(asked)) {
    answer = `Territory ${asked} is outside your scope, so I cannot show any data for it. I can answer for the territories you have access to.`
  } else {
    const territory = TERRITORIES.find((t) => t.id === (asked ?? user.territoryIds[0]))!
    const calls = Math.round(territory.callsPerWorkday * 64)
    const hcps = Math.round(calls * 0.86)
    const responses = Math.round(calls * territory.responsesPerCall)
    const to = todayIso(new Date(now))
    const period = `${addDays(to, -89)} to ${to}`
    const cites = [1, 2, 3].map((n) => ({ record_id: `CALL-0000${n}`, dataset: "call_activity", label: `Call on ${addDays(to, -n)} (scientific)` }))
    events.push(
      ev("TOOL_CALL_START", { toolCallId: "t1", toolCallName: "get_activity_summary" }),
      custom("source_facts", {
        facts: [
          { fact_id: "f1", label: "Distinct calls", value: calls, unit: "calls", period, scope: territory.id, citation_ids: cites.map((c) => c.record_id) },
          { fact_id: "f2", label: "Engaged HCPs", value: hcps, unit: "HCPs", period, scope: territory.id, citation_ids: cites.map((c) => c.record_id) },
          { fact_id: "f3", label: "Insight responses", value: responses, unit: "responses", period, scope: territory.id, citation_ids: [] },
        ],
        data_through: new Date(now - 86_400_000).toISOString(),
      }),
      custom("citations", cites),
      ev("TOOL_CALL_END", { toolCallId: "t1" }),
    )
    answer = `In ${territory.id} you had ${calls} distinct calls with ${hcps} engaged HCPs and ${responses} insight responses over the last 90 days.`
  }

  events.push(ev("TEXT_MESSAGE_START", { messageId: "m1", role: "assistant" }))
  for (const part of answer.match(/\S+\s*/g) ?? []) events.push(ev("TEXT_MESSAGE_CONTENT", { messageId: "m1", delta: part }))
  events.push(
    ev("TEXT_MESSAGE_END", { messageId: "m1" }),
    custom("number_check", { status: "verified", count: 0, checked: true }),
    custom("suggestions", suggestions),
    custom("conversation_saved", { saved: true }),
    ev("RUN_FINISHED", { threadId: "mock", runId }),
  )
  runs.set(runId, { startedAt: now, events: events.map((data, i) => ({ seq: i + 1, at: 150 + i * TOKEN_MS, data })) })
}

export function readRun(runId: string, after: number, now = Date.now()): ChatEventPage | null {
  const run = runs.get(runId)
  if (!run) return null
  const elapsed = now - run.startedAt
  const events = run.events.filter((e) => e.seq > after && e.at <= elapsed).map(({ seq, data }) => ({ seq, data }))
  const last = run.events[run.events.length - 1]
  const finished = elapsed >= last.at
  return { events, done: finished && events.length === run.events.filter((e) => e.seq > after).length, status: finished ? "FINISHED" : "RUNNING" }
}

export function mockCitation(dataset: string, recordId: string, user: FixtureUser): SourceRecord | null {
  if (user.territoryIds.length === 0 || user.persona === "executive") return null
  if (dataset === "hcp_raw_insights" && /^RESP-[A-Z0-9-]+$/.test(recordId)) {
    return {
      dataset,
      recordId,
      title: "Recorded HCP response",
      fields: [
        { label: "Territory", value: user.territoryIds[0] },
        { label: "Question", value: "What evidence would be most useful?" },
        { label: "Recorded response", value: "Long-term outcomes and access considerations are important." },
      ],
      dataThrough: new Date(Date.now() - 86_400_000).toISOString(),
    }
  }
  if (!/^CALL-\d+$/.test(recordId) || dataset !== "call_activity") return null
  return {
    dataset,
    recordId,
    title: "Call activity",
    fields: [
      { label: "Territory", value: user.territoryIds[0] },
      { label: "Type", value: "scientific" },
      { label: "Channel", value: "field" },
    ],
    dataThrough: new Date(Date.now() - 86_400_000).toISOString(),
  }
}
