import type { DateRange, IsoDate } from "./data/types"

const DAY_MS = 86_400_000

function parse(iso: IsoDate): Date {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function format(d: Date): IsoDate {
  return d.toISOString().slice(0, 10)
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && format(parse(value)) === value
}

/** Local calendar date, so "today" matches what the viewer sees. */
export function todayIso(now: Date = new Date()): IsoDate {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  return format(new Date(parse(iso).getTime() + days * DAY_MS))
}

/** Inclusive day count. */
export function daysInRange(range: DateRange): number {
  return Math.round((parse(range.to).getTime() - parse(range.from).getTime()) / DAY_MS) + 1
}

/** Monday to Friday days in the inclusive range. */
export function weekdaysInRange(range: DateRange): number {
  let count = 0
  const total = daysInRange(range)
  for (let i = 0; i < total; i++) {
    const dow = parse(range.from).getUTCDay() + i
    const day = dow % 7
    if (day !== 0 && day !== 6) count++
  }
  return count
}

export type RangePresetId = "7d" | "30d" | "90d" | "qtd" | "ytd"

export const RANGE_PRESETS: ReadonlyArray<{ id: RangePresetId; label: string }> = [
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
  { id: "qtd", label: "Quarter to date" },
  { id: "ytd", label: "Year to date" },
]

export function presetRange(id: RangePresetId, today: IsoDate = todayIso()): DateRange {
  const [y, m] = today.split("-").map(Number)
  switch (id) {
    case "7d":
      return { from: addDays(today, -6), to: today }
    case "30d":
      return { from: addDays(today, -29), to: today }
    case "90d":
      return { from: addDays(today, -89), to: today }
    case "qtd": {
      const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1
      return { from: `${y}-${String(qStartMonth).padStart(2, "0")}-01`, to: today }
    }
    case "ytd":
      return { from: `${y}-01-01`, to: today }
  }
}

export function matchPreset(range: DateRange, today: IsoDate = todayIso()): RangePresetId | null {
  for (const p of RANGE_PRESETS) {
    const r = presetRange(p.id, today)
    if (r.from === range.from && r.to === range.to) return p.id
  }
  return null
}

const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
const fmtYear = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })

export function formatDay(iso: IsoDate, withYear = false): string {
  return (withYear ? fmtYear : fmt).format(parse(iso))
}

export function formatRange(range: DateRange): string {
  const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4)
  return `${formatDay(range.from, !sameYear)} – ${formatDay(range.to, true)}`
}

const fmtMonth = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
const fmtMonthShort = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" })

/** `2026-10-01` -> `Oct 2026`. */
export function formatMonth(iso: IsoDate): string {
  return fmtMonth.format(parse(iso))
}

/** `2026-10-01` -> `Oct`, for chart axes. */
export function formatMonthShort(iso: IsoDate): string {
  return fmtMonthShort.format(parse(iso))
}

/** First day of the month `delta` months from `iso`'s month. */
export function addMonths(iso: IsoDate, delta: number): IsoDate {
  const [y, m] = iso.split("-").map(Number)
  const index = y * 12 + (m - 1) + delta
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`
}

const fmtDateTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
})

/** An instant as `Nov 3, 2026, 12:00 PM UTC`. Load times are always shown in UTC. */
export function formatInstant(iso: string): string {
  return fmtDateTime.format(new Date(iso))
}
