"use client"

import { AlertOctagon, AlertTriangle, Info } from "lucide-react"
import * as React from "react"
import { EmptyState, ErrorState } from "@/components/state/states"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { DirectorException, ExceptionCategoryCode } from "@/lib/data/director-insights"
import type { DateRange } from "@/lib/data/types"
import { useQuery } from "@/lib/data/use-query"
import { useSession } from "@/lib/session/session-provider"
import { cn } from "@/lib/utils"
import { InsightSection, num, PanelLoading, PanelMeta } from "./shared"

const SEVERITY = {
  high: { label: "High", icon: AlertOctagon, className: "border-destructive/40 bg-destructive/10 text-foreground" },
  medium: { label: "Medium", icon: AlertTriangle, className: "border-warning/50 bg-warning/10 text-foreground" },
  low: { label: "Low", icon: Info, className: "border-border bg-muted text-muted-foreground" },
} as const

/**
 * Exceptions in your scope: stale or failed loads, missing joins, unresolved identities, duplicate keys and status
 * differences. Each row names the fixed rule that found it. A finding says data is missing or ambiguous, never that
 * a person did something wrong.
 */
export function ExceptionsPanel({ range }: { range: DateRange }) {
  const adapter = useDataAdapter()
  const { userId, ready } = useSession()
  const [category, setCategory] = React.useState<ExceptionCategoryCode | "ALL">("ALL")
  const query = useQuery("directorExceptions", `${userId}:${range.from}:${range.to}`, (ctx) => adapter.directorExceptions(ctx, range), ready)
  const data = query.status === "success" ? query.data : null
  const rows = data ? data.exceptions.filter((e) => category === "ALL" || e.category === category) : []

  return (
    <InsightSection
      id="exceptions"
      title="Exceptions"
      note="Data problems inside your scope that can change how far a number can be trusted."
      meta={data && <PanelMeta from={data.from} to={data.to} dataThrough={data.dataThrough}><span data-testid="exception-total">{num(data.exceptions.length)} exceptions</span></PanelMeta>}
    >
      {query.status === "error" ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : !data ? (
        <PanelLoading testId="exceptions-loading" height="h-72" />
      ) : (
        <div className="flex flex-col gap-4">
          <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-2">
            <Chip on={category === "ALL"} id="ALL" label="All" count={data.exceptions.length} onPick={() => setCategory("ALL")} />
            {data.categories.map((c) => <Chip key={c.category} on={category === c.category} id={c.category} label={c.label} count={c.count} onPick={() => setCategory(c.category)} />)}
          </div>
          {rows.length === 0 ? (
            <EmptyState title="No exceptions in this category">Nothing was detected by the rules below.</EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-xl border" role="region" aria-label="Exceptions, scrolls sideways" tabIndex={0}>
              <table data-testid="exceptions-table" className="w-full min-w-[46rem] border-collapse text-sm">
                <caption className="sr-only">Exceptions in your approved scope</caption>
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th scope="col" className="px-3 py-2 font-medium">Severity</th>
                    <th scope="col" className="px-2 py-2 font-medium">Category</th>
                    <th scope="col" className="px-2 py-2 font-medium">Territory</th>
                    <th scope="col" className="px-2 py-2 font-medium">Finding</th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">Affected</th>
                    <th scope="col" className="px-3 py-2 font-medium">Sample records</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => <Row key={row.exceptionId} row={row} />)}
                </tbody>
              </table>
            </div>
          )}
          <section aria-label="How exceptions are detected" data-testid="exception-rules" className="rounded-2xl border bg-card p-4">
            <h3 className="text-sm font-semibold">How each exception is detected</h3>
            <dl className="mt-2 grid gap-x-8 gap-y-3 text-sm md:grid-cols-2">
              {data.categories.map((c) => (
                <div key={c.category}><dt className="font-medium">{c.label}</dt><dd className="text-muted-foreground">{c.rule}</dd></div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">{data.note}</p>
          </section>
        </div>
      )}
    </InsightSection>
  )
}

function Chip({ on, id, label, count, onPick }: { on: boolean; id: string; label: string; count: number; onPick: () => void }) {
  return (
    <button type="button" aria-pressed={on} data-testid={`exception-filter-${id}`} onClick={onPick} className={cn("inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}>
      {label} <span className={cn("rounded-full px-1.5 text-xs tabular-nums", on ? "bg-primary-foreground/20" : "bg-muted")}>{count}</span>
    </button>
  )
}

function Row({ row }: { row: DirectorException }) {
  const sev = SEVERITY[row.severity]
  const Icon = sev.icon
  return (
    <tr data-testid="exception-row" data-category={row.category} data-severity={row.severity} className="border-b align-top last:border-b-0">
      <td className="px-3 py-2"><span className={cn("inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold", sev.className)}><Icon className="size-3.5" aria-hidden />{sev.label}</span></td>
      <td className="px-2 py-2 font-medium">{row.categoryLabel}</td>
      <td className="px-2 py-2 tabular-nums">{row.territoryId ?? <span className="text-muted-foreground">All</span>}</td>
      <td className="max-w-md px-2 py-2"><p className="font-medium">{row.title}</p><p className="mt-0.5 text-muted-foreground">{row.detail}</p></td>
      <td className="px-2 py-2 text-right tabular-nums">{row.affectedCount > 0 ? num(row.affectedCount) : "—"}</td>
      <td className="px-3 py-2"><ul className="flex flex-wrap gap-1">{row.sampleRecordIds.map((id) => <li key={id} className="rounded-md border bg-background px-1.5 py-0.5 font-mono text-[0.7rem]">{id}</li>)}</ul>{row.sourceTable && <p className="mt-1 text-xs text-muted-foreground">{row.sourceTable}</p>}</td>
    </tr>
  )
}
