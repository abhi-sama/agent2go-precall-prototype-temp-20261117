/**
 * The mock runtime's side of the shared state (docs/adr/0019): the agent's progress steps and its proposals for the page
 * filters. It mirrors the BE agent (`progress.py`, `page_proposals.py`) so UI work and the iPad smoke tests see the same
 * event shapes: closed, data-free step labels; a proposal found by rule, never by a model.
 */

const TOOL_LABELS: Record<string, string> = {
  get_activity_summary: "Counting your activity",
  search_recorded_responses: "Reading recorded responses",
  get_topic_trends: "Finding topic trends",
  get_question_breakdown: "Breaking down a question",
  show_chart: "Drawing a chart",
  show_answer_distribution: "Drawing a chart",
  get_my_scope: "Checking your scope",
  suggest_follow_ups: "Preparing follow-up questions",
}
const LABELS = { scope: "Checking what you can see", write: "Writing the answer", check: "Checking every number against your data" }

interface Step {
  id: string
  label: string
  status: "running" | "done" | "error"
}

const snapshot = (value: Record<string, unknown>) => JSON.stringify({ type: "STATE_SNAPSHOT", timestamp: Date.now(), snapshot: value })

/**
 * The run's events with the agent's progress woven in: the scope check first, a step per tool call, writing the
 * answer, then the number check, and a final snapshot saying it is done. Mirrors `backend/agent/src/msl_agent/progress.py`.
 */
export function withProgress(raw: string[], extra?: Record<string, unknown>): string[] {
  const steps: Step[] = []
  const out: string[] = []
  const emit = (status: Step["status"] = "running", more?: Record<string, unknown>) => out.push(snapshot({ progress: { status, steps: steps.map((s) => ({ ...s })) }, ...more }))
  const set = (id: string, label: string, status: Step["status"]) => {
    const found = steps.find((s) => s.id === id)
    if (found) found.status = status
    else if (steps.length < 12) steps.push({ id, label, status })
  }
  let first = true
  for (const data of raw) {
    out.push(data)
    const event = JSON.parse(data) as Record<string, unknown>
    switch (event.type) {
      case "CUSTOM":
        if (first && event.name === "model_mode") {
          first = false
          set("scope", LABELS.scope, "running")
          emit()
          set("scope", LABELS.scope, "done")
          emit()
        }
        if (event.name === "number_check") {
          set("check", LABELS.check, "done")
          emit("done", extra)
        }
        break
      case "TOOL_CALL_START":
        set(`tool:${event.toolCallId}`, TOOL_LABELS[String(event.toolCallName)] ?? "Looking something up", "running")
        emit()
        break
      case "TOOL_CALL_END":
        set(`tool:${event.toolCallId}`, "", "done")
        emit()
        break
      case "TEXT_MESSAGE_START":
        set("write", LABELS.write, "running")
        emit()
        break
      case "TEXT_MESSAGE_END":
        set("write", LABELS.write, "done")
        set("check", LABELS.check, "running")
        emit()
        break
    }
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// Proposals for the page's filters
// ---------------------------------------------------------------------------------------------------------------

export interface MockProposal {
  filters: { preset?: string; from?: string; to?: string; territoryId?: string; questionId?: string }
  reset?: true
}

const VERB = /^\s*(?:please\s+|can you\s+|could you\s+|would you\s+|i want to\s+|let'?s\s+)*(?:filter|switch|set|change|narrow|limit|focus|apply|update|move|reset|clear)\b/i
const PAGE_WORD = /\b(?:page|screen|dashboard|filters?|view|date range)\b/i
const PRESETS: [RegExp, string][] = [
  [/\blast\s+7\s+days\b/i, "7d"],
  [/\blast\s+30\s+days\b/i, "30d"],
  [/\blast\s+90\s+days\b/i, "90d"],
  [/\b(?:quarter to date|this quarter)\b/i, "qtd"],
  [/\b(?:year to date|this year)\b/i, "ytd"],
]
const SPAN_DAYS = 1830

/** A request to change what the page shows, found by rule. `null` for every other question. */
export function inferMockProposal(question: string): MockProposal | null {
  if (!VERB.test(question) || !PAGE_WORD.test(question)) return null
  const filters: MockProposal["filters"] = {}
  const dates = question.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? []
  if (dates.length >= 2) {
    const from = dates[0]!
    const to = dates[1]!
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
    if (!(from <= to) || days > SPAN_DAYS) return null
    filters.from = from
    filters.to = to
  } else {
    const preset = PRESETS.find(([pattern]) => pattern.test(question))
    if (preset) filters.preset = preset[1]
  }
  const territory = question.match(/\b([A-Z]{2}-\d{2})\b/)?.[1]
  if (territory) filters.territoryId = territory
  const q = question.match(/\b(Q-\d{1,6})\b/)?.[1]
  if (q) filters.questionId = q
  const reset = /\b(?:reset|clear)\b/i.test(question)
  if (!reset && Object.keys(filters).length === 0) return null
  return { filters, ...(reset ? { reset: true as const } : {}) }
}

/** The proposal's plain summary, as the agent words it. */
export function proposalSummary(proposal: MockProposal): string {
  const { preset, from, to, territoryId, questionId } = proposal.filters
  const parts: string[] = []
  if (proposal.reset && !Object.keys(proposal.filters).length) return "the default filters"
  if (territoryId) parts.push(`territory ${territoryId}`)
  if (questionId) parts.push(`question ${questionId}`)
  if (from && to) parts.push(`${from} to ${to}`)
  else if (preset) parts.push({ "7d": "the last 7 days", "30d": "the last 30 days", "90d": "the last 90 days", qtd: "quarter to date", ytd: "year to date" }[preset] ?? preset)
  return parts.join(", ")
}

/**
 * The page each mock run was asked from, newest last, on `globalThis` so a browser test can prove what the chat sent
 * (the mock has no network to watch). The mock adapter only runs in local mode.
 */
export function recordMockPage(page: unknown): void {
  const store = globalThis as { __a2gMockChatPages?: unknown[] }
  ;(store.__a2gMockChatPages ??= []).push(page ?? null)
}
