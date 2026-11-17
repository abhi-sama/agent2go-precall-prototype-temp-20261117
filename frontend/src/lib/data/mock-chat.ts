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
import { inferMockVisual, mockVisual, type MockVisualRequest } from "./mock-visuals"
import { rememberRowSets, rowSetsEvent, type MockRowSet } from "./mock-chat-rows"
import { mockResponseRecord, mockTerritorySummary } from "./mock-director-insights"
import { inferMockProposal, proposalSummary, withProgress, type MockProposal } from "./mock-page-state"
import { parseRefineAction, refineQuestion, refineSurface, surfaceEvent, surfaceId, tableSurface, type RefineRequest } from "./mock-surfaces"
import type { ChatEventPage, ChatSurfaceActionInput, SourceRecord } from "./types"

interface ScheduledEvent {
  seq: number
  at: number
  data: string
}

const runs = new Map<string, { startedAt: number; events: ScheduledEvent[] }>()

const TOKEN_MS = 90
const ev = (type: string, extra: Record<string, unknown> = {}) => JSON.stringify({ type, timestamp: Date.now(), ...extra })
const custom = (name: string, value: unknown) => ev("CUSTOM", { name, value })
const SMALL_TALK = /^\s*(?:(?:hi|hello|hey)(?:\s+there)?|good\s+(?:morning|afternoon|evening)|thanks?(?:\s*,?\s*(?:that'?s|this\s+is)\s+(?:helpful|great))?|thank\s+you(?:\s+for\s+(?:the\s+)?help)?|appreciate\s+(?:it|that)|what\s+can\s+you\s+do(?:\s+today)?|how\s+can\s+you\s+help(?:\s+me)?|help(?:\s+me)?|who\s+are\s+you)\s*[.!?]*\s*$/i

function smallTalkReply(question: string): string | null {
  if (!SMALL_TALK.test(question)) return null
  const normalized = question.trim().toLowerCase()
  if (normalized.includes("thank")) return "You’re welcome. I can help with activity counts, recorded HCP perspectives, trends, and your available scope."
  if (normalized.includes("what can") || normalized.includes("how can") || normalized.startsWith("help")) return "I can help with activity counts, recorded HCP perspectives, trends, and your available scope. Ask in your own words whenever you’re ready."
  return "Hi! I can help with activity counts, recorded HCP perspectives, trends, and your available scope. What would you like to explore?"
}

const REFINE_REFUSAL = "That adjustment could not be applied. Ask the question in your own words instead."
const THEMES = [
  { topic: "ctDNA monitoring (emerging)", share: 0.1, prior: 0.04, flag: "Emerging" },
  { topic: "Access and reimbursement", share: 0.14, prior: 0.15, flag: "No change flagged" },
  { topic: "Long-term outcomes", share: 0.09, prior: 0.09, flag: "No change flagged" },
]
const weekdaysBetween = (from: string, to: string) => {
  let n = 0
  for (let d = from; d <= to; d = addDays(d, 1)) if (![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) n++
  return n
}

const AGGREGATE_ONLY_PAGE = "An aggregate-only role can change the page's date range, but not filter it to a territory or a question."

export function scriptRun(runId: string, user: FixtureUser, typed: string, now = Date.now(), context?: ChatContext, action?: ChatSurfaceActionInput): void {
  // An Adjust-form action is validated against closed lists, then asked as the question it stands for (docs/adr/0017).
  const refine: RefineRequest | null = action ? parseRefineAction(action.name, action.context, user.persona === "executive") : null
  const question = refine ? refineQuestion(refine) : typed
  const asked = question.match(/\b([A-Z]{2}-\d{2})\b/)?.[1]
  const events: string[] = [ev("RUN_STARTED", { threadId: "mock", runId }), custom("model_mode", { mode: "claude" })]
  let answer: string
  const suggestions = ["Which territories can I see?", "What have HCPs recorded about osimertinib?"]
  const directReply = action && !refine ? REFINE_REFUSAL : action ? null : smallTalkReply(question)
  const through = new Date(now - 86_400_000).toISOString()
  let surfaceCount = 0
  const nextSurface = (kind: string) => surfaceId(kind, runId, ++surfaceCount)
  /** What this answer covered, offered back as the Adjust form after the text. */
  let adjustable: RefineRequest | null = null
  const themeQuestion = !refine && /\b(?:themes?|emerging|trending)\b/i.test(question) && !/\bconcerns?\b/i.test(question)
  const scopeQuestion = /\b(?:which|what)\s+territor(?:y|ies)\s+(?:can|do)\s+i\s+(?:see|access)\b|\bmy\s+scope\b/i.test(question)
  const explicitTopic = question.match(/\b(?:recorded|said|saying)\b.*?\babout\s+(.+?)[?.!]?\s*$/i)?.[1]?.trim()
  const qualitativeQuestion = /\b(?:concerns?|themes?|topics?|perspectives?)\b|\bwhat\s+(?:are|do|did)\s+hcps?\b/i.test(question)
  const topic = explicitTopic ?? (qualitativeQuestion && user.persona !== "executive" ? "recorded HCP concerns" : undefined)
  const activityQuestion = /\b(?:calls?|engaged|hcps?|responses?|insights?|activity)\b|\bhow\s+(?:am|did)\s+i\s+do\b/i.test(question)

  const summaryTerritory = context?.intent === "TERRITORY_SUMMARY" ? context.territoryId : undefined
  // A request to change what the page shows is found by rule and offered as a proposal; nothing changes until the person
  // applies it (docs/adr/0019). A territory outside the caller's scope is refused like any other question about it.
  const proposal: MockProposal | null = action || directReply ? null : inferMockProposal(question)
  const proposedTerritory = proposal?.filters.territoryId
  const proposable = proposal && !(proposedTerritory && !user.territoryIds.includes(proposedTerritory))
  let proposalState: Record<string, unknown> | undefined
  if (directReply) {
    answer = directReply
  } else if (proposal && user.persona === "executive" && (proposedTerritory || proposal.filters.questionId)) {
    answer = AGGREGATE_ONLY_PAGE
  } else if (proposal && proposable) {
    const proposalFilters = proposal.filters
    proposalState = {
      proposal: {
        id: `${runId}-proposal`,
        status: "proposed",
        reason: proposal.reset && !Object.keys(proposalFilters).length ? "Reset the page filters to their defaults." : `Set the page to ${proposalSummary(proposal)}.`,
        filters: proposalFilters,
        ...(proposal.reset ? { reset: true } : {}),
      },
    }
    answer = `I can set the page to ${proposalSummary(proposal)}. Choose Apply on the card below to change the page filters; nothing changes until you do.`
  } else if (scopeQuestion) {
    if (user.persona === "executive") {
      answer = "Your role has aggregate-only access to its configured regions; individual territory records are not available in chat."
    } else if (user.persona === "admin") {
      answer = "This administration role has no clinical territory scope in chat."
    } else {
      const territories = user.territoryIds
      events.push(
        ev("TOOL_CALL_START", { toolCallId: "t1", toolCallName: "get_my_scope" }),
        custom("source_facts", { facts: [{ fact_id: "f1", label: "Territories in your scope", value: territories.length, unit: "territories", period: "today", scope: "your scope", citation_ids: [] }], data_through: new Date(now - 86_400_000).toISOString() }),
        ev("TOOL_CALL_END", { toolCallId: "t1" }),
      )
      answer = `You can access ${territories.join(", ")}.`
    }
  } else if (themeQuestion && !summaryTerritory && (user.persona === "msl" || user.persona === "director") && user.territoryIds.length > 0) {
    // Recorded themes by the database's rule (get_topic_trends): key figures, then the A2UI table of themes.
    const to = todayIso(new Date(now))
    const from = addDays(to, -89)
    const period = `${from} to ${to}`
    const total = user.territoryIds.reduce((sum, id) => sum + Math.round((TERRITORIES.find((t) => t.id === id)?.callsPerWorkday ?? 4) * 64 * 1.6), 0)
    const rows = THEMES.map((t) => ({ theme: t.topic, latest: Math.round(total * t.share), earlier: Math.round(total * t.prior), flag: t.flag }))
    const sid = nextSurface("themes")
    events.push(
      ev("TOOL_CALL_START", { toolCallId: "t1", toolCallName: "get_topic_trends" }),
      custom("source_facts", {
        facts: [
          { fact_id: "f1", label: "Free-text responses in the latest period", value: total, unit: "responses", period, scope: "your scope", citation_ids: [] },
          ...rows.map((r, i) => ({ fact_id: `f${i + 2}`, label: `Responses on ${r.theme}`, value: r.latest, unit: "responses", period, scope: "your scope", citation_ids: [] })),
        ],
        data_through: through,
      }),
      surfaceEvent(
        sid,
        tableSurface(sid, {
          title: "Recorded themes",
          caption: `${period} against the 90 days before · your scope · Counted by database queries; flags come from the stated rule.`,
          columns: [
            { key: "theme", label: "Theme" },
            { key: "latest", label: "Latest period", numeric: true },
            { key: "earlier", label: "Earlier period", numeric: true },
            { key: "flag", label: "Rule flag" },
          ],
          rows,
        }),
      ),
      ev("TOOL_CALL_END", { toolCallId: "t1" }),
    )
    answer = `${rows[0].theme} was flagged EMERGING by the rule, with ${rows[0].latest} responses in the latest period against ${rows[0].earlier} before.`
  } else if (topic) {
    if (user.persona === "executive") {
      answer = "That request needs source-record data, which is not available to an aggregate-only Executive."
    } else if (user.persona === "admin") {
      answer = "Record-level questions are not available for this administration role."
    } else {
      const periodEnd = todayIso(new Date(now))
      const period = `${addDays(periodEnd, -89)} to ${periodEnd}`
      const citation = { record_id: "RESP-MOCK-001", dataset: "hcp_raw_insights", label: `Recorded response mentioning ${topic}` }
      events.push(
        ev("TOOL_CALL_START", { toolCallId: "t1", toolCallName: "search_recorded_responses" }),
        custom("source_facts", { facts: [{ fact_id: "f1", label: `Recorded responses mentioning ${topic}`, value: 1, unit: "responses", period, scope: user.territoryIds[0] ?? "your scope", citation_ids: [citation.record_id] }], data_through: new Date(now - 86_400_000).toISOString() }),
        custom("citations", [citation]),
        ev("TOOL_CALL_END", { toolCallId: "t1" }),
      )
      answer = `I found 1 recorded response mentioning ${topic} in your scope. Open the source to read the recorded perspective.`
    }
  } else if (summaryTerritory && user.persona === "director" && user.territoryIds.includes(summaryTerritory)) {
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
    // Executive activity uses the same aggregate-only wire contract as the runtime. The mock deliberately omits
    // suppressed month points rather than representing them as zero, so responsive UI checks exercise the safe chart.
    const to = refine?.to ?? context?.to ?? todayIso(new Date(now))
    const range = { from: refine?.from ?? context?.from ?? addDays(to, -89), to }
    const activityQuestion = /\b(calls?|engaged|hcps?|responses?|insights?)\b/i.test(question) && !/\b(theme|topic|ctdna|sequencing|what .*say)\b/i.test(question)
    if (activityQuestion) {
      const period = `${range.from} to ${range.to}`
      const metric = refine?.metric ?? "calls"
      const label = { calls: "Distinct calls", engaged_hcps: "Engaged HCPs", responses: "Insight responses" }[metric]
      const unit = { calls: "calls", engaged_hcps: "HCPs", responses: "responses" }[metric]
      const total = { calls: 48, engaged_hcps: 36, responses: 84 }[metric]
      const citation = { record_id: `agg:executive:activity:${metric}:${range.from}:${range.to}`, dataset: "hcp_raw_insights", label: `Suppressed ${label.toLowerCase()} aggregate, ${period}`, kind: "aggregate", detail: "Aggregate-only; no source rows are available" }
      const trend = refine ? refine.groupBy === "month" : /\b(month|trend|over time|change|compare)\b/i.test(question)
      adjustable = refine ?? { metric: "calls", groupBy: trend ? "month" : "total", from: range.from, to: range.to, territoryId: "", executive: true }
      events.push(
        ev("TOOL_CALL_START", { toolCallId: "t1", toolCallName: "get_executive_activity" }),
        custom("source_facts", { facts: [{ fact_id: "f1", label, value: total, unit, period, scope: "your executive scope", citation_ids: [citation.record_id] }], data_through: new Date(now - 86_400_000).toISOString() }),
        custom("citations", [citation]),
        custom("sample_limitations", { items: ["This is an aggregate-only view; individual records, names and row exports are not available.", "Counts below 5 are withheld, with complementary suppression where needed so a small group cannot be calculated."] }),
      )
      if (trend) {
        events.push(
          custom("visual", { phase: "pending", visual_id: "exec-v1", tool: "get_executive_activity" }),
          custom("visual", {
            phase: "ready", visual_id: "exec-v1", kind: "line", title: `${label} by month (shown aggregates)`, subtitle: `${period} · your executive scope`, metric, unit, period, scope: "your executive scope", definition: `${label}; small groups and complementary values are withheld and are not plotted.`, data_through: new Date(now - 86_400_000).toISOString(), total,
            points: [{ key: "2026-08", label: "Aug 2026", value: Math.round(total * 0.31), partial: false }, { key: "2026-09", label: "Sep 2026", value: Math.round(total * 0.35), partial: false }], peak_key: "2026-09",
          }),
        )
      } else if (refine && (refine.groupBy === "region" || refine.groupBy === "territory")) {
        const groups = refine.groupBy === "region" ? ["North East", "South East", "West"] : ["NE-01", "SE-03", "WE-04"]
        const parts = [Math.round(total * 0.5), Math.round(total * 0.3)]
        events.push(
          custom("visual", { phase: "pending", visual_id: "exec-v1", tool: "get_executive_activity" }),
          custom("visual", {
            phase: "ready", visual_id: "exec-v1", kind: "bar", title: `${label} by ${refine.groupBy} (shown aggregates)`, subtitle: `${period} · your executive scope`, metric, unit, period, scope: "your executive scope", definition: `${label}; small groups and complementary values are withheld and are not plotted.`, data_through: new Date(now - 86_400_000).toISOString(), total,
            // The smallest group is withheld: it is left out of the chart, never drawn as zero.
            points: parts.map((value, i) => ({ key: groups[i], label: groups[i], value, partial: false })),
          }),
        )
      } else {
        events.push(
          custom("visual", { phase: "pending", visual_id: "exec-v1", tool: "get_executive_activity" }),
          custom("visual", {
            phase: "ready", visual_id: "exec-v1", kind: "bar", title: `${label} (shown aggregate)`, subtitle: `${period} · your executive scope`, metric, unit, period, scope: "your executive scope", definition: `${label}; small groups and complementary values are withheld and are not plotted.`, data_through: new Date(now - 86_400_000).toISOString(), total,
            points: [{ key: "total", label: "All authorized scope", value: total, partial: false }],
          }),
        )
      }
      events.push(ev("TOOL_CALL_END", { toolCallId: "t1" }))
      answer = `The shown aggregate count is ${total} ${unit === "calls" ? "distinct calls" : unit === "HCPs" ? "engaged HCPs" : "insight responses"} for ${period}. Small-group months are withheld, and individual records are not available for your role.`
      suggestions.splice(0, suggestions.length, "How have calls changed by month?", "Compare calls across my regions", "What activity groups are withheld?")
    } else {
      // Organisational theme analysis for an Executive: aggregate figures only, with cited sets described (never named).
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
      // Aggregate-only access: the answer says rows are unavailable instead of offering a Show rows control.
      custom("rows_unavailable", { reason: "aggregate_only" }),
    )
    const trendLabel: Record<string, string> = { RISING: "Rising", FALLING: "Falling", STEADY: "Steady", WITHHELD: "Withheld", INSUFFICIENT_SAMPLE: "Too few responses" }
    const themeRows = portfolio.cards.slice(0, 6).map((c) => ({
      theme: c.topic,
      // A withheld small group stays the word, never a number.
      latest: c.responses.value ?? "Withheld",
      earlier: c.priorResponses?.value ?? "Withheld",
      trend: trendLabel[String(c.trend)] ?? "Not judged",
    }))
    if (themeRows.length >= 2) {
      const sid = nextSurface("org_themes")
      events.push(
        surfaceEvent(
          sid,
          tableSurface(sid, {
            title: "Recorded themes across your regions",
            caption: `${period} · Aggregate-only; small groups are withheld; trends follow the approved threshold rule.`,
            columns: [
              { key: "theme", label: "Theme" },
              { key: "latest", label: "Latest period", numeric: true },
              { key: "earlier", label: "Earlier period", numeric: true },
              { key: "trend", label: "Trend" },
            ],
            rows: themeRows,
          }),
        ),
      )
    }
    events.push(ev("TOOL_CALL_END", { toolCallId: "t1" }))
    const lead = top.map((c) => `${c.topic} (${c.responses.value?.toLocaleString("en-US")} responses)`).join(" and ")
    answer =
      `Between ${period}, ${total === null ? "a small number of" : total.toLocaleString("en-US")} free-text responses were recorded in your regions. ` +
      (lead ? `The most recorded themes were ${lead}. ` : "") +
      (cross.length ? `${cross.map((r) => r.topic).join(" and ")} rose in two or more regions at the approved threshold; that is a change in what was recorded, not a cause.` : "No topic rose in two or more regions at the approved threshold.") +
      `\n\nSample limitations: ${matrix.sampleLimitations.join(" ")}`
    suggestions.splice(0, suggestions.length, "Which topics are rising in more than one region?", "Which regions have too few responses to judge a trend?", "What did we withhold, and why?")
    }
  } else if (user.persona === "admin" || user.territoryIds.length === 0) {
    answer = "Record-level questions are not available for your role yet. Aggregate views are on your landing page."
  } else if (asked && !user.territoryIds.includes(asked)) {
    answer = `Territory ${asked} is outside your scope, so I cannot show any data for it. I can answer for the territories you have access to.`
  } else if (activityQuestion) {
    const territory = TERRITORIES.find((t) => t.id === (asked ?? user.territoryIds[0]))!
    // A stated period (an adjusted answer) scales the fixture by its working days; otherwise the last 90 days.
    const to = refine?.to ?? todayIso(new Date(now))
    const from = refine?.from ?? addDays(to, -89)
    const calls = refine ? Math.round(territory.callsPerWorkday * weekdaysBetween(from, to)) : Math.round(territory.callsPerWorkday * 64)
    const hcps = Math.round(calls * 0.86)
    const responses = Math.round(calls * territory.responsesPerCall)
    const period = `${from} to ${to}`
    const cites = [1, 2, 3].map((n) => ({ record_id: `CALL-0000${n}`, dataset: "call_activity", label: `Call on ${addDays(to, -n)} (scientific)` }))
    // The rows behind each key figure: exactly as many as the figure says, in the viewer's territory.
    const setOf = (n: number, kind: MockRowSet["kind"], label: string, count: number): MockRowSet => ({
      rowSetId: `rs${n}`, kind, label, count, periodFrom: from, periodTo: to, scope: territory.id, sourceId: `f${n}`, territoryId: territory.id,
    })
    const rowSets = [setOf(1, "calls", "Distinct calls", calls), setOf(2, "hcps", "Engaged HCPs", hcps), setOf(3, "responses", "Insight responses", responses)]
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
      custom("row_sets", rowSetsEvent(rowSets)),
      ev("TOOL_CALL_END", { toolCallId: "t1" }),
    )
    rememberRowSets(runId, rowSets)
    const chartFor: Record<string, MockVisualRequest> = { month: { type: "line", by: "month" }, week: { type: "timeline", by: "week" }, product: { type: "bar", by: "product" } }
    const request = refine ? (chartFor[refine.groupBy] ?? null) : inferMockVisual(question)
    if (request) {
      const metric = refine?.metric ?? (request.type === "distribution" ? "responses" : "calls")
      const total = { calls, engaged_hcps: hcps, responses }[metric]
      const common = { from, to, total, scope: territory.id, dataThrough: through, metric: metric === "responses" ? ("responses" as const) : ("calls" as const) }
      const drawn = mockVisual(request, common, "v1")
      // The mock series helper knows calls and responses; HCPs reuse its arithmetic under their own name.
      const visual = metric === "engaged_hcps" ? { ...drawn, metric, unit: "HCPs", title: String(drawn.title).replace("Distinct calls", "Engaged HCPs") } : drawn
      // The placeholder streams first, then the plotted values: the same two steps as the real agent.
      events.push(ev("TOOL_CALL_START", { toolCallId: "v1", toolCallName: "show_chart" }), custom("visual", { phase: "pending", visual_id: "v1", tool: "show_chart" }), custom("visual", visual), ev("TOOL_CALL_END", { toolCallId: "v1" }))
    }
    const groupOf: Record<string, string> = { line: "month", timeline: "week", bar: "product" }
    adjustable = refine ?? { metric: "calls", groupBy: (request && groupOf[request.type]) ?? "total", from, to, territoryId: asked ?? "", executive: false }
    answer = refine
      ? `In ${territory.id} you had ${calls} distinct calls with ${hcps} engaged HCPs and ${responses} insight responses from ${from} to ${to}.`
      : `In ${territory.id} you had ${calls} distinct calls with ${hcps} engaged HCPs and ${responses} insight responses over the last 90 days.`
  } else {
    answer = "This mock preview does not have a scripted answer for that question. Switch to the live local agent to ask it against the seeded data."
  }

  events.push(ev("TEXT_MESSAGE_START", { messageId: "m1", role: "assistant" }))
  for (const part of answer.match(/\S+\s*/g) ?? []) events.push(ev("TEXT_MESSAGE_CONTENT", { messageId: "m1", delta: part }))
  events.push(ev("TEXT_MESSAGE_END", { messageId: "m1" }))
  if (adjustable && !directReply) {
    // The Adjust form follows the text: pre-filled with what this answer covered, territories from the caller's scope.
    const sid = nextSurface("refine")
    events.push(surfaceEvent(sid, refineSurface(sid, adjustable, adjustable.executive ? [] : user.territoryIds, through.slice(0, 10))))
  }
  events.push(
    custom("number_check", { status: "verified", count: 0, checked: true }),
    custom("suggestions", suggestions),
    custom("conversation_saved", { saved: true }),
    ev("RUN_FINISHED", { threadId: "mock", runId }),
  )
  // The proposal rides the run's last progress snapshot, ahead of the answer's closing events.
  const woven = withProgress(events, proposalState)
  runs.set(runId, { startedAt: now, events: woven.map((data, i) => ({ seq: i + 1, at: 150 + i * TOKEN_MS, data })) })
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
