/**
 * AG-UI events from the agent, folded into one assistant turn for the chat panel.
 *
 * The agent streams standard AG-UI events (`RUN_STARTED`, `TEXT_MESSAGE_*`, `TOOL_CALL_*`, `RUN_FINISHED`)
 * plus `CUSTOM` events for the three kinds of content the panel keeps visually distinct:
 *  - `source_facts` / `citations`: numbers computed by SQL under RLS, and the records behind them,
 *  - the streamed text: the AI summary (generated, never the source of a number),
 *  - `suggestions`: proposals the user may act on,
 *  - `visual`: a chart, heatmap, timeline or small table (generative UI). A `pending` event reserves its place the
 *    moment the agent starts the query; the `ready` event carries the plotted values, all computed by SQL under RLS.
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

/** A comparison bar is meaningful only when every fact shares the same measure. */
export function factsAreComparable(facts: FactItem[]): boolean {
  return facts.length > 1 && new Set(facts.map((fact) => fact.unit.trim().toLocaleLowerCase())).size === 1
}

export interface CitationItem {
  recordId: string
  dataset: string
  label: string
  /**
   * "aggregate" describes a set of responses (filters and size) instead of naming one record, so there is nothing to
   * open: it never calls the record query. Executives without record-level permission get only these.
   */
  kind?: "record" | "aggregate"
  detail?: string
}

/** Aggregate citations carry an `agg:` id; the agent also sends `kind` explicitly. */
export const isAggregateCitation = (citation: CitationItem) => citation.kind === "aggregate" || citation.recordId.startsWith("agg:")

/** A citation keeps one display number for the complete answer. */
export function citationNumber(citations: CitationItem[], citation: CitationItem): number {
  return citations.findIndex((item) => item.dataset === citation.dataset && item.recordId === citation.recordId) + 1
}

export function citationsForFact(fact: FactItem, citations: CitationItem[]): CitationItem[] {
  const ids = new Set(fact.citationIds)
  return citations.filter((citation) => ids.has(citation.recordId))
}

export type VisualKind = "bar" | "line" | "distribution" | "heatmap" | "timeline" | "table"

export interface VisualPoint {
  key: string
  label: string
  value: number
  /** Share of the period total (one decimal), computed by the query; null where groups can overlap. */
  sharePct: number | null
  /** A time bucket the period only partly covers. */
  partial: boolean
}

export interface VisualRow {
  key: string
  label: string
  values: number[]
}

export interface VisualSpec {
  visualId: string
  kind: VisualKind
  title: string
  subtitle: string
  metric: string
  unit: string
  period: string
  scope: string
  definition: string
  dataThrough: string | null
  total: number | null
  leftOut: number
  points: VisualPoint[]
  columns: string[]
  columnUnits: string[]
  rows: VisualRow[]
  peakKey: string | null
}

/** One visual in a turn: a reserved place while the query runs, then the plotted values. */
export interface VisualItem {
  visualId: string
  status: "pending" | "ready"
  spec: VisualSpec | null
}

/** The kind of row behind a figure: a call, an HCP or a recorded response. Matches the rows query. */
export type RowSetKind = "calls" | "hcps" | "responses"

/**
 * The rows behind one figure the agent computed (docs/adr/0015). It names the rows; the table itself is read from the
 * BE by id, under the viewer's access, so nothing here can widen what is shown. `count` is the figure in the answer.
 */
export interface RowSetItem {
  rowSetId: string
  kind: RowSetKind
  label: string
  unit: string
  count: number
  periodFrom: string
  periodTo: string
  scope: string
  /** The key figure (`factId`) or chart (`visualId`) this set sits behind. */
  sourceId: string
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
  /** Why these figures may not generalise (window, small samples, withheld groups). Set for Executive analysis. */
  sampleLimitations: string[]
  visuals: VisualItem[]
  /** The rows behind each count, share or chart. Empty for aggregate-only access. */
  rowSets: RowSetItem[]
  /** True when the agent said rows are unavailable because the viewer's access is aggregate-only. */
  rowsUnavailable: boolean
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
    sampleLimitations: [],
    visuals: [],
    rowSets: [],
    rowsUnavailable: false,
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
  return value.filter(isObject).map((c) => {
    const recordId = str(c.record_id)
    const aggregate = c.kind === "aggregate" || recordId.startsWith("agg:")
    return {
      recordId,
      dataset: str(c.dataset),
      label: str(c.label),
      ...(aggregate ? { kind: "aggregate" as const } : {}),
      ...(typeof c.detail === "string" && c.detail ? { detail: c.detail } : {}),
    }
  })
}

const ROW_KINDS: readonly RowSetKind[] = ["calls", "hcps", "responses"]

/** Only well-formed row sets are kept; a malformed one is dropped rather than half-shown. */
export function parseRowSets(value: unknown): RowSetItem[] {
  if (!isObject(value) || !Array.isArray(value.row_sets)) return []
  const out: RowSetItem[] = []
  for (const raw of value.row_sets) {
    if (!isObject(raw)) continue
    const kind = ROW_KINDS.find((k) => k === raw.kind)
    const count = raw.count
    if (!kind || typeof raw.row_set_id !== "string" || !/^rs\d{1,3}$/.test(raw.row_set_id) || typeof count !== "number" || !Number.isInteger(count) || count < 0) continue
    out.push({
      rowSetId: raw.row_set_id,
      kind,
      label: str(raw.label),
      unit: str(raw.unit),
      count,
      periodFrom: str(raw.period_from),
      periodTo: str(raw.period_to),
      scope: str(raw.scope),
      sourceId: str(raw.source_id),
    })
  }
  return out
}

const VISUAL_KINDS: readonly VisualKind[] = ["bar", "line", "distribution", "heatmap", "timeline", "table"]
const nums = (v: unknown): number[] => (Array.isArray(v) ? v.filter((n): n is number => typeof n === "number" && Number.isFinite(n)) : [])
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])

/** Only well-formed visuals are drawn; anything else is dropped rather than half-rendered. */
export function parseVisual(value: unknown): VisualSpec | null {
  if (!isObject(value) || typeof value.visual_id !== "string") return null
  const kind = VISUAL_KINDS.find((k) => k === value.kind)
  if (!kind) return null
  const points = (Array.isArray(value.points) ? value.points : []).filter(isObject).map((p) => ({
    key: str(p.key),
    label: str(p.label),
    value: typeof p.value === "number" ? p.value : 0,
    sharePct: typeof p.share_pct === "number" ? p.share_pct : null,
    partial: p.partial === true,
  }))
  const rows = (Array.isArray(value.rows) ? value.rows : []).filter(isObject).map((r) => ({ key: str(r.key), label: str(r.label), values: nums(r.values) }))
  return {
    visualId: value.visual_id,
    kind,
    title: str(value.title),
    subtitle: str(value.subtitle),
    metric: str(value.metric),
    unit: str(value.unit),
    period: str(value.period),
    scope: str(value.scope),
    definition: str(value.definition),
    dataThrough: typeof value.data_through === "string" ? value.data_through : null,
    total: typeof value.total === "number" ? value.total : null,
    leftOut: typeof value.left_out === "number" ? value.left_out : 0,
    points,
    columns: strs(value.columns),
    columnUnits: strs(value.column_units),
    rows,
    peakKey: typeof value.peak_key === "string" ? value.peak_key : null,
  }
}

function applyVisual(turn: AssistantTurn, value: unknown): AssistantTurn {
  if (!isObject(value)) return turn
  const id = str(value.visual_id)
  if (!id) return turn
  if (value.phase === "pending") {
    return turn.visuals.some((v) => v.visualId === id) ? turn : { ...turn, visuals: [...turn.visuals, { visualId: id, status: "pending", spec: null }] }
  }
  const spec = parseVisual(value)
  if (!spec) {
    // A visual that cannot be drawn must not leave a placeholder behind.
    return { ...turn, visuals: turn.visuals.filter((v) => v.visualId !== id || v.status === "ready") }
  }
  const ready: VisualItem = { visualId: id, status: "ready", spec }
  return turn.visuals.some((v) => v.visualId === id)
    ? { ...turn, visuals: turn.visuals.map((v) => (v.visualId === id ? ready : v)) }
    : { ...turn, visuals: [...turn.visuals, ready] }
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
      return {
        ...turn,
        tools: turn.tools.map((t) => (t.id === event.toolCallId ? { ...t, done: true } : t)),
        // A chart tool that ended without a ready visual (refused or no data) leaves no empty placeholder.
        visuals: turn.visuals.filter((v) => v.status === "ready" || v.visualId !== event.toolCallId),
      }
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
    case "visual":
      return applyVisual(turn, value)
    case "row_sets": {
      const known = new Set(turn.rowSets.map((r) => r.rowSetId))
      const fresh = parseRowSets(value).filter((r) => !known.has(r.rowSetId))
      return fresh.length ? { ...turn, rowSets: [...turn.rowSets, ...fresh] } : turn
    }
    case "rows_unavailable":
      return { ...turn, rowsUnavailable: true }
    case "sample_limitations": {
      const items = isObject(value) && Array.isArray(value.items) ? value.items.filter((i): i is string => typeof i === "string" && i.trim() !== "") : []
      const merged = [...new Set([...turn.sampleLimitations, ...items])]
      return items.length ? { ...turn, sampleLimitations: merged } : turn
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
