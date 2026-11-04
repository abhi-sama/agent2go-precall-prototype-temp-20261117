/**
 * Scripted chat runs for the mock adapter (UI work and iPad smoke tests without a backend).
 *
 * It mirrors the BE contract: a run is a list of AG-UI events, revealed over time so the panel
 * streams. Numbers come from the same fixture arithmetic as the KPI cards, never from "the model".
 */
import { todayIso, addDays } from "@/lib/dates"
import type { ChatContext } from "./director-insights"
import { TERRITORIES, type FixtureUser } from "./fixtures"
import { buildMatrix, buildThemes } from "./mock-executive-themes"
import { inferMockVisual, mockVisual } from "./mock-visuals"
import { mockResponseRecord, mockTerritorySummary } from "./mock-director-insights"
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

export function scriptRun(runId: string, user: FixtureUser, question: string, now = Date.now(), context?: ChatContext): void {
  const asked = question.match(/\b([A-Z]{2}-\d{2})\b/)?.[1]
  const events: string[] = [ev("RUN_STARTED", { threadId: "mock", runId }), custom("model_mode", { mode: "claude" })]
  let answer: string
  const suggestions = ["Which territories can I see?", "What have HCPs recorded about osimertinib?"]

  const summaryTerritory = context?.intent === "TERRITORY_SUMMARY" ? context.territoryId : undefined
  if (summaryTerritory && user.persona === "director" && user.territoryIds.includes(summaryTerritory)) {
    // An AI territory summary: only figures from the evidence the panel shows, each with the responses behind it.
    const to = context?.to ?? todayIso(new Date(now))
    const range = { from: context?.from ?? addDays(to, -89), to }
    const summary = mockTerritorySummary(summaryTerritory, range)
    const period = `${range.from} to ${range.to}`
    const cites = summary.citations.map((c) => ({ record_id: c.record, dataset: "hcp_raw_insights", label: c.label }))
    events.push(
      ev("TOOL_CALL_START", { toolCallId: "t1", toolCallName: "get_topic_trends" }),
      custom("source_facts", {
        facts: summary.facts.map((f, i) => ({ fact_id: `f${i + 1}`, label: f.label, value: f.value, unit: f.unit, period, scope: summaryTerritory, citation_ids: [] })),
        data_through: new Date(now - 86_400_000).toISOString(),
      }),
      custom("citations", cites),
      ev("TOOL_CALL_END", { toolCallId: "t1" }),
    )
    answer = summary.text
  } else if (summaryTerritory) {
    answer = `Territory ${summaryTerritory} is outside your scope, so I cannot summarise it.`
  } else if (user.persona === "executive" && user.territoryIds.length > 0) {
    // Organisational analysis for an Executive: aggregate figures only, with the sample limitations stated and the
    // cited sets described (never named). Same shape as the agent's executive tools.
    const to = context?.to ?? todayIso(new Date(now))
    const range = { from: context?.from ?? addDays(to, -89), to }
    const input = {
      territories: TERRITORIES.filter((t) => user.territoryIds.includes(t.id)),
      range,
      dataThrough: new Date(now - 86_400_000).toISOString(),
      scopeLabel: user.scopeLabel,
      records: false,
      empty: false,
    }
    const portfolio = buildThemes(input, "PORTFOLIO").groups[0]
    const matrix = buildMatrix(input, "PORTFOLIO", null)
    const top = portfolio.cards.filter((c) => c.responses.value !== null).slice(0, 2)
    const cross = matrix.rows.filter((r) => r.crossRegion && !r.isOther)
    const period = `${range.from} to ${range.to}`
    const cites = top.flatMap((c) => c.citations).map((c) => ({ record_id: c.citationId, dataset: c.dataset, label: c.label, kind: "aggregate", detail: `Described by its filters and size. Window ${period}.` }))
    const total = portfolio.freeTextResponses.value
    events.push(
      ev("TOOL_CALL_START", { toolCallId: "t1", toolCallName: "get_org_themes" }),
      custom("source_facts", {
        facts: [
          ...(total !== null ? [{ fact_id: "f1", label: "Free-text responses", value: total, unit: "responses", period, scope: "your regions", citation_ids: [] }] : []),
          { fact_id: "f2", label: "Topics rising in 2+ regions", value: cross.length, unit: "topics", period, scope: "your regions", citation_ids: [] },
        ],
        data_through: new Date(now - 86_400_000).toISOString(),
      }),
      custom("citations", cites),
      custom("sample_limitations", { items: matrix.sampleLimitations }),
      ev("TOOL_CALL_END", { toolCallId: "t1" }),
    )
    const lead = top.map((c) => `${c.topic} (${c.responses.value?.toLocaleString("en-US")} responses)`).join(" and ")
    answer =
      `Between ${period}, ${total === null ? "a small number of" : total.toLocaleString("en-US")} free-text responses were recorded in your regions. ` +
      (lead ? `The most recorded themes were ${lead}. ` : "") +
      (cross.length ? `${cross.map((r) => r.topic).join(" and ")} rose in two or more regions at the approved threshold; that is a change in what was recorded, not a cause.` : "No topic rose in two or more regions at the approved threshold.") +
      `\n\nSample limitations: ${matrix.sampleLimitations.join(" ")}`
    suggestions.splice(0, suggestions.length, "Which topics are rising in more than one region?", "Which regions have too few responses to judge a trend?", "What did we withhold, and why?")
  } else if (user.persona === "admin" || user.territoryIds.length === 0) {
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
    const request = inferMockVisual(question)
    if (request) {
      const through = new Date(now - 86_400_000).toISOString()
      const common = { from: addDays(to, -89), to, total: request.type === "distribution" ? responses : calls, scope: territory.id, dataThrough: through, metric: request.type === "distribution" ? ("responses" as const) : ("calls" as const) }
      // The placeholder streams first, then the plotted values: the same two steps as the real agent.
      events.push(ev("TOOL_CALL_START", { toolCallId: "v1", toolCallName: "show_chart" }), custom("visual", { phase: "pending", visual_id: "v1", tool: "show_chart" }), custom("visual", mockVisual(request, common, "v1")), ev("TOOL_CALL_END", { toolCallId: "v1" }))
    }
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

export function mockCitation(dataset: string, recordId: string, user: FixtureUser, now: Date = new Date(), recordAccess = false): SourceRecord | null {
  // An Executive opens a record only with explicit record-level permission (the `records` mock scenario).
  if (user.territoryIds.length === 0 || (user.persona === "executive" && !recordAccess)) return null
  if (dataset === "hcp_raw_insights") {
    const to = todayIso(now)
    const record = mockResponseRecord(recordId, { from: addDays(to, -89), to })
    if (record) {
      // A Director-insights response: it opens only inside the viewer's scope.
      if (!record.territoryId || !user.territoryIds.includes(record.territoryId)) return null
      return {
        dataset,
        recordId,
        title: "Recorded HCP response",
        fields: [
          { label: "Interaction date", value: record.interactionDate ?? "" },
          { label: "Territory", value: record.territoryId },
          { label: "Question", value: record.questionText ?? "" },
          { label: "Recorded response", value: record.excerpt },
        ],
        dataThrough: new Date(now.getTime() - 86_400_000).toISOString(),
      }
    }
    if (!/^RESP-[A-Z0-9-]+$/.test(recordId)) return null
    return {
      dataset,
      recordId,
      title: "Recorded HCP response",
      fields: [
        { label: "Territory", value: user.territoryIds[0] },
        { label: "Question", value: "What evidence would be most useful?" },
        { label: "Recorded response", value: "Long-term outcomes and access considerations are important." },
      ],
      dataThrough: new Date(now.getTime() - 86_400_000).toISOString(),
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
