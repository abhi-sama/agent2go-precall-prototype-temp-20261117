"use client"

import * as React from "react"
import { formatMonth, formatMonthShort } from "@/lib/dates"
import type { ExecutiveMonth, SuppressedCount } from "@/lib/data/types"
import { cn } from "@/lib/utils"
import { CountValue, num, percent } from "./count"

type Metric = "calls" | "responses" | "engagedHcps"
const METRICS: { id: Metric; label: string }[] = [
  { id: "calls", label: "Calls" },
  { id: "responses", label: "Responses" },
  { id: "engagedHcps", label: "Engaged HCPs" },
]

/**
 * Monthly columns for one metric. Heights are percentages of the tallest shown month, so the chart
 * resizes with its container. A withheld month is a hatched stub, never a zero-height bar. Partial months
 * (cut short by the dates or by data-through) are outlined. Each column carries its reporting completeness.
 */
export function TrendColumns({ months, minCell }: { months: ExecutiveMonth[]; minCell: number }) {
  const [metric, setMetric] = React.useState<Metric>("calls")
  const [tableOpen, setTableOpen] = React.useState(false)
  const values = months.map((m) => (m[metric] as SuppressedCount).value)
  const max = Math.max(1, ...values.filter((v): v is number => v !== null))
  const dense = months.length > 12
  return (
    <div data-testid="trend" className="rounded-2xl border bg-card p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Trend metric" className="flex gap-1 rounded-xl border bg-muted/40 p-1">
          {METRICS.map((m) => (
            <button
              key={m.id}
              type="button"
              data-testid={`trend-metric-${m.id}`}
              aria-pressed={metric === m.id}
              onClick={() => setMetric(m.id)}
              className={cn("min-h-11 rounded-lg px-3 text-sm font-medium transition-colors", metric === m.id ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Outlined columns are partial months. Hatched columns are withheld small groups.</p>
      </div>
      <ol className="flex h-56 items-end gap-1 sm:gap-1.5" data-testid="trend-columns" aria-label={`${METRICS.find((m) => m.id === metric)?.label} by month`}>
        {months.map((m, i) => {
          const count = m[metric] as SuppressedCount
          const height = count.value === null ? 14 : Math.max(2, (100 * count.value) / max)
          return (
            <li key={m.month} className="flex h-full min-w-0 flex-1 flex-col justify-end" data-testid="trend-month" data-month={m.month} data-suppressed={count.suppressed}>
              <span className="mb-1 truncate text-center text-[11px] font-medium tabular-nums text-muted-foreground">
                {count.value !== null && !dense ? num(count.value) : ""}
              </span>
              <div
                title={`${formatMonth(m.month)}: ${count.value === null ? "withheld (small group)" : num(count.value)}${m.isPartial ? " · partial month" : ""} · ${percent(m.reportingCompleteness)} of territories reported`}
                style={{ height: `${height}%` }}
                className={cn(
                  "w-full rounded-t-md transition-[height] duration-300 ease-out motion-reduce:transition-none",
                  count.suppressed
                    ? "border border-dashed border-muted-foreground/50 bg-[repeating-linear-gradient(45deg,transparent_0_4px,var(--muted)_4px_8px)]"
                    : m.isPartial
                      ? "border-2 border-dashed border-primary bg-primary/25"
                      : "bg-primary",
                )}
              />
              <span className={cn("mt-1.5 truncate text-center text-[11px] text-muted-foreground", dense && i % 2 === 1 && "invisible")}>{formatMonthShort(m.month)}</span>
            </li>
          )
        })}
      </ol>
      <button
        type="button"
        data-testid="trend-table-toggle"
        aria-expanded={tableOpen}
        onClick={() => setTableOpen((v) => !v)}
        className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        {tableOpen ? "Hide table view" : "Table view"}
      </button>
      {tableOpen && (
        <div className="mt-2 overflow-x-auto rounded-xl border">
          <table data-testid="trend-table" className="w-full min-w-[34rem] text-left text-sm">
            <caption className="sr-only">Monthly activity across your authorized regions</caption>
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Month</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Calls</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Responses</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Engaged HCPs</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Territories reporting</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month} className="border-t">
                  <th scope="row" className="px-3 py-1.5 font-medium">{formatMonth(m.month)}{m.isPartial ? " (partial)" : ""}</th>
                  <td className="px-3 py-1.5 text-right"><CountValue count={m.calls} minCell={minCell} /></td>
                  <td className="px-3 py-1.5 text-right"><CountValue count={m.responses} minCell={minCell} /></td>
                  <td className="px-3 py-1.5 text-right"><CountValue count={m.engagedHcps} minCell={minCell} /></td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{m.territoriesReporting} of {m.territoriesInScope}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
