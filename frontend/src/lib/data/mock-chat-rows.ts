/**
 * "Show rows" for the mock adapter (docs/adr/0015): the rows behind a figure in a scripted chat run, in the same
 * shape the BE returns. Each row set lists exactly `count` rows, so the table adds up to the figure by construction;
 * the real adapter proves the same thing against SQL (tests/api/test_chat_rows.py). Rows are deterministic from the
 * set id and row number, sorted and paged the way the BE does it (ties break on the row id).
 */
import { addDays } from "@/lib/dates"
import type { ChatRow, ChatRowColumn, ChatRowKind, ChatRowSortDir, ChatRowsExport, ChatRowsPage, ChatRowsQuery } from "./types"

export interface MockRowSet {
  rowSetId: string
  kind: "calls" | "hcps" | "responses"
  label: string
  count: number
  periodFrom: string
  periodTo: string
  scope: string
  sourceId: string
  territoryId: string
}

const runSets = new Map<string, MockRowSet[]>()

export function rememberRowSets(runId: string, sets: MockRowSet[]): void {
  runSets.set(runId, sets)
}

/** The `row_sets` event value: snake_case, like the agent's. */
export function rowSetsEvent(sets: MockRowSet[]): { row_sets: Record<string, unknown>[] } {
  const units = { calls: "calls", hcps: "HCPs", responses: "responses" } as const
  return {
    row_sets: sets.map((s) => ({
      row_set_id: s.rowSetId,
      kind: s.kind,
      label: s.label,
      unit: units[s.kind],
      count: s.count,
      period_from: s.periodFrom,
      period_to: s.periodTo,
      scope: s.scope,
      source_id: s.sourceId,
      territory_id: s.territoryId,
    })),
  }
}

const COLUMNS: Record<MockRowSet["kind"], ChatRowColumn[]> = {
  calls: [
    { key: "id", label: "Call", type: "TEXT" },
    { key: "date", label: "Date", type: "DATE" },
    { key: "type", label: "Type", type: "TEXT" },
    { key: "channel", label: "Channel", type: "TEXT" },
    { key: "minutes", label: "Minutes", type: "NUMBER" },
    { key: "territory", label: "Territory", type: "TEXT" },
    { key: "hcp", label: "HCP", type: "TEXT" },
    { key: "products", label: "Products", type: "TEXT" },
  ],
  hcps: [
    { key: "id", label: "HCP", type: "TEXT" },
    { key: "specialty", label: "Specialty", type: "TEXT" },
    { key: "territory", label: "Territory", type: "TEXT" },
    { key: "calls", label: "Calls", type: "NUMBER" },
    { key: "first", label: "First call", type: "DATE" },
    { key: "last", label: "Latest call", type: "DATE" },
  ],
  responses: [
    { key: "id", label: "Response", type: "TEXT" },
    { key: "date", label: "Date", type: "DATE" },
    { key: "territory", label: "Territory", type: "TEXT" },
    { key: "hcp", label: "HCP", type: "TEXT" },
    { key: "product", label: "Product", type: "TEXT" },
    { key: "question", label: "Question", type: "TEXT" },
    { key: "answer", label: "Recorded answer", type: "TEXT" },
  ],
}

const DEFINITIONS: Record<MockRowSet["kind"], string> = {
  calls: "One row per distinct call in the period and filters. A call that covered several products is one row.",
  hcps: "One row per distinct HCP engaged by at least one call in the period and filters.",
  responses: "One row per recorded response in the period and filters; excluded responses are left out.",
}
const DEFAULT_SORT: Record<MockRowSet["kind"], [string, ChatRowSortDir]> = { calls: ["date", "DESC"], hcps: ["calls", "DESC"], responses: ["date", "DESC"] }

const PRODUCTS = ["osimertinib", "pembrolizumab", "trastuzumab deruxtecan", "sacituzumab govitecan"]
const SPECIALTIES = ["Medical oncology", "Thoracic surgery", "Pulmonology", "Radiation oncology"]
const QUESTIONS = ["What evidence would be most useful?", "Which access consideration should be discussed first?", "How are you sequencing therapies?"]
const ANSWERS = ["Long-term outcomes and access considerations matter.", "Coverage criteria should be clear.", "Yes", "Mostly first line.", "Unsure"]

/** A small deterministic hash so the same row is the same on every read. */
function mix(a: number, b: number): number {
  let h = (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0
  return (h ^ (h >>> 12)) >>> 0
}
const seedOf = (id: string) => [...id].reduce((acc, ch) => Math.imul(acc, 31) + ch.charCodeAt(0), 7) >>> 0

function daysBetween(from: string, to: string): number {
  return Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000))
}

function rowAt(set: MockRowSet, runId: string, i: number): (string | null)[] {
  const seed = seedOf(`${runId}:${set.rowSetId}`)
  const h = mix(seed, i)
  const span = daysBetween(set.periodFrom, set.periodTo)
  const day = addDays(set.periodFrom, h % (span + 1))
  const pad = String(i + 1).padStart(5, "0")
  const hcp = `HCP-${String(mix(seed, i + 9000) % 4000).padStart(4, "0")}`
  if (set.kind === "calls") return [`CALL-${pad}`, day, "scientific", ["in_person", "virtual", "phone"][h % 3], String(10 + (h % 50)), set.territoryId, hcp, PRODUCTS.slice(0, 1 + (h % 2)).join(", ")]
  if (set.kind === "hcps") return [`HCP-${pad}`, SPECIALTIES[h % SPECIALTIES.length], set.territoryId, String(1 + (h % 6)), addDays(day, -(h % 20)), day]
  return [`RESP-${pad}`, day, set.territoryId, hcp, PRODUCTS[h % PRODUCTS.length], QUESTIONS[h % QUESTIONS.length], ANSWERS[(h >> 3) % ANSWERS.length]]
}

function sortedRows(set: MockRowSet, runId: string, sortBy: string, sortDir: ChatRowSortDir): ChatRow[] {
  const columns = COLUMNS[set.kind]
  const col = columns.findIndex((c) => c.key === sortBy)
  const type = columns[col].type
  const all = Array.from({ length: set.count }, (_, i) => ({ id: rowAt(set, runId, i)[0] as string, cells: rowAt(set, runId, i) }))
  const sign = sortDir === "ASC" ? 1 : -1
  return all.sort((a, b) => {
    const x = a.cells[col]
    const y = b.cells[col]
    if (x === y) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    if (x === null) return 1 // nulls last, like the BE
    if (y === null) return -1
    const order = type === "NUMBER" ? Number(x) - Number(y) : x < y ? -1 : 1
    return sign * order
  })
}

export type MockRowsError = "unknown_run" | "unknown_row_set" | "aggregate_only" | "invalid_sort" | "export_not_permitted"

export function findRowSet(runId: string, rowSetId: string): MockRowSet | MockRowsError {
  const sets = runSets.get(runId)
  if (!sets) return "unknown_run"
  return sets.find((s) => s.rowSetId === rowSetId) ?? "unknown_row_set"
}

export function mockRowsPage(set: MockRowSet, runId: string, query: ChatRowsQuery, canExport: boolean, dataThrough: string): ChatRowsPage | "invalid_sort" {
  const columns = COLUMNS[set.kind]
  const [defaultBy, defaultDir] = DEFAULT_SORT[set.kind]
  const sortBy = query.sortBy ?? defaultBy
  if (!columns.some((c) => c.key === sortBy)) return "invalid_sort"
  const sortDir = query.sortBy ? (query.sortDir ?? "ASC") : defaultDir
  const offset = query.offset ?? 0
  const limit = query.limit ?? 25
  const rows = sortedRows(set, runId, sortBy, sortDir).slice(offset, offset + limit)
  return {
    rowSetId: set.rowSetId,
    kind: set.kind.toUpperCase() as ChatRowKind,
    label: set.label,
    scope: set.scope,
    period: `${set.periodFrom} to ${set.periodTo}`,
    definition: DEFINITIONS[set.kind],
    total: set.count,
    answerCount: set.count,
    columns,
    rows,
    offset,
    limit,
    sortBy,
    sortDir,
    canExport,
    dataThrough,
  }
}

const csvCell = (value: string | null, type: ChatRowColumn["type"]): string => {
  const text = value ?? ""
  const safe = type === "TEXT" && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

export function mockRowsExport(set: MockRowSet, runId: string, query: ChatRowsQuery, exportedAt: string, dataThrough: string): ChatRowsExport | "invalid_sort" {
  const page = mockRowsPage(set, runId, { ...query, offset: 0, limit: Math.max(1, set.count) }, true, dataThrough)
  if (page === "invalid_sort") return page
  const lines = [
    "# [SOURCE] Counted from source records by database queries, not written by the AI.",
    `# Rows behind a chat answer: ${set.label}`,
    `# Scope: ${set.scope}; period: ${page.period}`,
    `# Figure in the answer: ${set.count}; rows in the data now: ${set.count}`,
    `# Exported: ${exportedAt}; data through: ${dataThrough}`,
    page.columns.map((c) => c.label).join(","),
    ...page.rows.map((r) => r.cells.map((cell, i) => csvCell(cell, page.columns[i].type)).join(",")),
  ]
  return {
    rowSetId: set.rowSetId,
    fileName: `msl-agent-rows-${set.kind}-${runId.slice(0, 8)}-${set.rowSetId}.csv`,
    mimeType: "text/csv;charset=utf-8",
    content: `${lines.join("\n")}\n`,
    rowCount: page.rows.length,
    total: set.count,
    truncated: false,
    exportedAt,
  }
}
