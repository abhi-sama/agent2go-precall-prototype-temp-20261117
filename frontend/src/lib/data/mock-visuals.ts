/**
 * Visuals for the mock chat adapter, in the same wire shape the agent streams (`CUSTOM visual`, snake_case).
 * Every series is split from the same fixture total the key figures show, with the largest-remainder method, so the
 * parts always add up to the whole exactly. This stands in for the SQL the real agent runs; the e2e specs compare
 * what is drawn with these functions, and the stack specs compare it with the database.
 */
import { addDays } from "@/lib/dates"
import type { IsoDate } from "./types"

export type MockVisualRequest =
  | { type: "line" | "timeline" | "bar" | "heatmap" | "table" | "distribution"; by: "month" | "week" | "product" | "territory" | "answer" }

const PRODUCTS = [
  { name: "osimertinib", weight: 0.31 },
  { name: "pembrolizumab", weight: 0.27 },
  { name: "trastuzumab deruxtecan", weight: 0.24 },
  { name: "sacituzumab govitecan", weight: 0.18 },
]
const LIKERT_WEIGHTS = [0.04, 0.1, 0.27, 0.36, 0.23]

/** Split `total` into integer parts proportional to `weights` that add up to exactly `total`. */
export function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0) || 1
  const exact = weights.map((w) => (w / sum) * total)
  const parts = exact.map(Math.floor)
  let left = total - parts.reduce((a, b) => a + b, 0)
  const order = exact.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((a, b) => b.r - a.r || a.i - b.i)
  for (const { i } of order) {
    if (left-- <= 0) break
    parts[i]++
  }
  return parts
}

const monthKey = (iso: IsoDate) => iso.slice(0, 7)
const monthName = (key: string) => new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
const dayName = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
const isWeekday = (iso: string) => ![0, 6].includes(new Date(`${iso}T00:00:00Z`).getUTCDay())
const mondayOf = (iso: string) => {
  const dow = (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7
  return addDays(iso, -dow)
}

function windowDays(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

interface Common {
  from: IsoDate
  to: IsoDate
  total: number
  scope: string
  dataThrough: string
  metric: "calls" | "responses"
}

function frame(c: Common, id: string, title: string) {
  const unit = c.metric === "calls" ? "calls" : "responses"
  return {
    phase: "ready",
    visual_id: id,
    title,
    subtitle: `${c.from} to ${c.to} · ${c.scope}`,
    metric: c.metric,
    unit,
    period: `${c.from} to ${c.to}`,
    scope: c.scope,
    definition: c.metric === "calls" ? "Distinct calls: each call counted once, however many products it covered." : "Insight responses: each recorded response counted once; excluded responses left out.",
    data_through: c.dataThrough,
    total: c.total,
    left_out: 0,
  }
}

/** Buckets (month or week) the window touches, with the weekdays in each so the total is spread over working days. */
function buckets(c: Common, by: "month" | "week") {
  const keys: string[] = []
  const weekdays = new Map<string, number>()
  for (const d of windowDays(c.from, c.to)) {
    const key = by === "month" ? monthKey(d) : mondayOf(d)
    if (!weekdays.has(key)) {
      keys.push(key)
      weekdays.set(key, 0)
    }
    if (isWeekday(d)) weekdays.set(key, weekdays.get(key)! + 1)
  }
  const values = apportion(c.total, keys.map((k) => weekdays.get(k)!))
  const partial = (key: string) => {
    if (by === "month") {
      const first = `${key}-01`
      const next = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 1)).toISOString().slice(0, 10)
      return c.from > first || c.to < addDays(next, -1)
    }
    return c.from > key || c.to < addDays(key, 6)
  }
  return keys.map((key, i) => ({ key, label: by === "month" ? monthName(key) : dayName(key), value: values[i], partial: partial(key) }))
}

export function mockVisual(request: MockVisualRequest, c: Common, id: string): Record<string, unknown> {
  const unit = c.metric === "calls" ? "Distinct calls" : "Insight responses"
  if (request.type === "line" || request.type === "timeline") {
    const by = request.type === "timeline" ? "week" : "month"
    const points = buckets(c, by).map((p) => ({ ...p, share_pct: undefined }))
    const peak = points.reduce((a, b) => (b.value > a.value ? b : a), points[0])
    return { ...frame(c, id, `${unit} by ${by}`), kind: request.type, points, peak_key: peak.value > 0 ? peak.key : undefined }
  }
  if (request.type === "bar") {
    const parts = apportion(c.total, PRODUCTS.map((p) => p.weight))
    const points = PRODUCTS.map((p, i) => ({ key: p.name, label: p.name, value: parts[i], share_pct: Math.round((1000 * parts[i]) / c.total) / 10 })).sort((a, b) => b.value - a.value || a.key.localeCompare(b.key))
    return { ...frame(c, id, `${unit} by product`), kind: "bar", points }
  }
  if (request.type === "heatmap") {
    const months = buckets(c, "month")
    const perProduct = apportion(c.total, PRODUCTS.map((p) => p.weight))
    const rows = PRODUCTS.map((p, i) => ({ key: p.name, label: p.name, values: apportion(perProduct[i], months.map((m) => m.value)) })).sort((a, b) => b.values.reduce((x, y) => x + y, 0) - a.values.reduce((x, y) => x + y, 0))
    return { ...frame(c, id, `${unit} by product and month`), kind: "heatmap", columns: months.map((m) => m.label), rows }
  }
  if (request.type === "table") {
    const months = buckets(c, "month")
    return {
      ...frame(c, id, "Activity by month"),
      kind: "table",
      metric: "activity",
      columns: ["Month", "Distinct calls", "Engaged HCPs", "Insight responses"],
      column_units: ["", "calls", "HCPs", "responses"],
      rows: months.map((m) => ({ key: m.key, label: m.label, values: [m.value, Math.round(m.value * 0.86), Math.round(m.value * 2.5)] })),
    }
  }
  const parts = apportion(c.total, LIKERT_WEIGHTS)
  return {
    ...frame({ ...c, metric: "responses" }, id, "Likert answers (1 to 5)"),
    kind: "distribution",
    points: parts.map((v, i) => ({ key: String(i + 1), label: String(i + 1), value: v, share_pct: Math.round((1000 * v) / c.total) / 10 })),
  }
}

/** Which visual a question asks for, or null for a plain count or a purely qualitative question. */
export function inferMockVisual(question: string): MockVisualRequest | null {
  const q = question.toLowerCase()
  if (/\b(heat ?map|matrix)\b/.test(q)) return { type: "heatmap", by: "product" }
  if (/\btable\b/.test(q)) return { type: "table", by: "month" }
  if (/\b(timeline|week by week|weekly)\b/.test(q)) return { type: "timeline", by: "week" }
  if (/\b(trend|over time|by month|per month|monthly)\b/.test(q)) return { type: "line", by: "month" }
  if (/\b(rate|rated|rating|likert|agree|score)\b/.test(q)) return { type: "distribution", by: "answer" }
  if (/\b(compare|by product|per product|breakdown|split|rank)\b/.test(q)) return { type: "bar", by: "product" }
  return null
}
