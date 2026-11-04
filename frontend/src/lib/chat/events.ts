/**
 * AG-UI events from the agent, folded into one assistant turn for the chat panel.
 *
 * The agent streams standard AG-UI events (`RUN_STARTED`, `TEXT_MESSAGE_*`, `TOOL_CALL_*`, `RUN_FINISHED`)
 * plus `CUSTOM` events for the three kinds of content the panel keeps visually distinct:
 *  - `source_facts` / `citations`: numbers computed by SQL under RLS, and the records behind them,
 *  - the streamed text: the AI summary (generated, never the source of a number),
 *  - `suggestions`: proposals the user may act on.
 */

export interface FactItem {
  factId: string
  label: string
  value: number
  unit: string
  period: string
  scope: string
  citationIds: string[]
}

export interface CitationItem {
  recordId: string
  dataset: string
  label: string
}

export type TurnStatus = "running" | "done" | "error"

export interface NumberCheck {
  status: "verified" | "unverified"
  count: number
  /** False in stub mode: the canned stub text is not an answer, so it is not checked. */
  checked: boolean
}

export interface AssistantTurn {
  runId: string
  status: TurnStatus
  text: string
  facts: FactItem[]
  citations: CitationItem[]
  suggestions: string[]
  tools: { id: string; name: string; done: boolean }[]
  mode: "claude" | "stub" | null
  numberCheck: NumberCheck | null
  saved: boolean | null
  dataThrough: string | null
  /** Fixed, user-safe text. Never an exception message. */
  error: string | null
}

export function newTurn(runId: string): AssistantTurn {
  return {
    runId,
    status: "running",
    text: "",
    facts: [],
    citations: [],
    suggestions: [],
    tools: [],
    mode: null,
    numberCheck: null,
    saved: null,
    dataThrough: null,
    error: null,
  }
}

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v)
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback)

function parseFacts(value: unknown): FactItem[] {
  if (!isObject(value) || !Array.isArray(value.facts)) return []
  return value.facts.filter(isObject).map((f) => ({
    factId: str(f.fact_id),
    label: str(f.label),
    value: typeof f.value === "number" ? f.value : 0,
    unit: str(f.unit),
    period: str(f.period),
    scope: str(f.scope),
    citationIds: Array.isArray(f.citation_ids) ? f.citation_ids.filter((c): c is string => typeof c === "string") : [],
  }))
}

function parseCitations(value: unknown): CitationItem[] {
  if (!Array.isArray(value)) return []
  return value.filter(isObject).map((c) => ({ recordId: str(c.record_id), dataset: str(c.dataset), label: str(c.label) }))
}

/** Parse the JSON of one event; anything that is not an object with a string `type` is ignored. */
export function parseEvent(data: string): Json | null {
  try {
    const parsed: unknown = JSON.parse(data)
    return isObject(parsed) && typeof parsed.type === "string" ? parsed : null
  } catch {
    return null
  }
}

export function applyEvent(turn: AssistantTurn, event: Json): AssistantTurn {
  switch (event.type) {
    case "TEXT_MESSAGE_CONTENT":
      return { ...turn, text: turn.text + str(event.delta) }
    case "TOOL_CALL_START":
      return { ...turn, tools: [...turn.tools, { id: str(event.toolCallId), name: str(event.toolCallName), done: false }] }
    case "TOOL_CALL_END":
      return { ...turn, tools: turn.tools.map((t) => (t.id === event.toolCallId ? { ...t, done: true } : t)) }
    case "RUN_FINISHED":
      return { ...turn, status: "done" }
    case "RUN_ERROR":
      return { ...turn, status: "error", error: str(event.message, "The agent could not complete this answer.") }
    case "CUSTOM":
      return applyCustom(turn, str(event.name), event.value)
    default:
      return turn
  }
}

function applyCustom(turn: AssistantTurn, name: string, value: unknown): AssistantTurn {
  switch (name) {
    case "model_mode":
      return { ...turn, mode: isObject(value) && value.mode === "stub" ? "stub" : "claude" }
    case "source_facts": {
      const known = new Set(turn.facts.map((f) => f.factId))
      const fresh = parseFacts(value).filter((f) => !known.has(f.factId))
      const through = isObject(value) && typeof value.data_through === "string" ? value.data_through : turn.dataThrough
      return { ...turn, facts: [...turn.facts, ...fresh], dataThrough: through }
    }
    case "citations": {
      const known = new Set(turn.citations.map((c) => `${c.dataset}:${c.recordId}`))
      const fresh = parseCitations(value).filter((c) => !known.has(`${c.dataset}:${c.recordId}`))
      return { ...turn, citations: [...turn.citations, ...fresh] }
    }
    case "suggestions":
      return { ...turn, suggestions: Array.isArray(value) ? value.filter((s): s is string => typeof s === "string").slice(0, 3) : [] }
    case "number_check": {
      if (!isObject(value)) return turn
      return {
        ...turn,
        numberCheck: {
          status: value.status === "unverified" ? "unverified" : "verified",
          count: typeof value.count === "number" ? value.count : 0,
          checked: value.checked !== false,
        },
      }
    }
    case "conversation_saved":
      return { ...turn, saved: isObject(value) && value.saved === true }
    default:
      return turn
  }
}
