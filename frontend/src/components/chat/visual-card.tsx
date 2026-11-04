"use client"

import { Maximize2, Table2, BarChart3 } from "lucide-react"
import * as React from "react"
import { DataTable } from "@/components/charts/viz/data-table"
import { DistributionBars, Heatmap } from "@/components/charts"
import { LineChart } from "@/components/charts/viz/line-chart"
import { RankedBars, type BarDatum } from "@/components/charts/viz/ranked-bars"
import { TimelineChart } from "@/components/charts/viz/timeline-chart"
import { fmt } from "@/components/charts/viz/shared"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import type { VisualItem, VisualSpec } from "@/lib/chat/events"

function barData(spec: VisualSpec): BarDatum[] {
  return spec.points.map((p) => ({ key: p.key, label: p.label, value: p.value, sharePct: p.sharePct }))
}

/** Long, free-text answer labels read better as ranked bars than as columns. */
const wordy = (spec: VisualSpec) => spec.points.some((p) => p.label.length > 8)

function Chart({ spec, tall }: { spec: VisualSpec; tall?: boolean }) {
  const unit = spec.unit
  switch (spec.kind) {
    case "line":
      return <LineChart points={spec.points} unit={unit} peakKey={spec.peakKey} height={tall ? 360 : undefined} />
    case "timeline":
      return <TimelineChart points={spec.points} unit={unit} peakKey={spec.peakKey} />
    case "heatmap":
      return (
        <Heatmap
          testId="heatmap-chart"
          cellTestId="heat-cell"
          caption={spec.title}
          rowHeader={spec.title.match(/ by (\w+) and month/)?.[1] ?? "Row"}
          columns={spec.columns.map((c) => ({ key: c, label: c.replace(/ \d{4}$/, ""), title: c }))}
          rows={spec.rows.map((r) => ({ id: r.key, label: r.label, values: r.values }))}
        />
      )
    case "distribution":
      return wordy(spec) ? (
        <RankedBars data={barData(spec)} unit={unit} />
      ) : (
        <div data-testid="distribution-chart">
          <DistributionBars
            ordinal
            denominator={spec.total ?? 0}
            rows={spec.points.map((p) => ({ label: p.label, count: p.value, percent: p.sharePct ?? 0 }))}
          />
        </div>
      )
    case "table":
      return <TableView spec={spec} />
    case "bar":
    default:
      return <RankedBars data={barData(spec)} unit={unit} />
  }
}

/** The same numbers as a table: every chart has one, so no value depends on seeing a mark or hovering. */
function TableView({ spec }: { spec: VisualSpec }) {
  if (spec.kind === "table" || spec.kind === "heatmap") {
    const columns = spec.kind === "heatmap" ? ["", ...spec.columns] : spec.columns
    const rows = spec.rows.map((r) => ({ key: r.key, label: r.label, cells: r.values }))
    return <DataTable caption={spec.title} columns={columns} rows={rows} testId="visual-table" />
  }
  const withShare = spec.points.some((p) => p.sharePct != null)
  return (
    <DataTable
      caption={spec.title}
      columns={[spec.kind === "distribution" ? "Answer" : "Group", spec.unit ? spec.unit.charAt(0).toUpperCase() + spec.unit.slice(1) : "Count", ...(withShare ? ["Share"] : [])]}
      rows={spec.points.map((p) => ({ key: p.key, label: p.label + (p.partial ? " (partial)" : ""), cells: [p.value, ...(withShare ? [p.sharePct != null ? `${p.sharePct}%` : ""] : [])] }))}
      testId="visual-table"
    />
  )
}

function throughLabel(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
}

function Skeleton() {
  return (
    <div data-testid="visual-pending" role="status" aria-label="Preparing a chart from your data" className="viz-rise rounded-2xl border bg-card p-4">
      <div className="h-4 w-48 rounded bg-muted" />
      <div className="viz-shimmer mt-4 h-36 rounded-xl bg-muted/60" />
      <p className="mt-3 text-xs text-muted-foreground">Counting from your data…</p>
    </div>
  )
}

/**
 * One generative-UI visual in a chat answer. The values are exactly what the database query returned; the card adds
 * the frame: title, period and scope, the metric definition, a table twin, and a full-screen view.
 */
export function VisualCard({ item }: { item: VisualItem }) {
  const [asTable, setAsTable] = React.useState(false)
  const [expanded, setExpanded] = React.useState(false)
  if (item.status === "pending" || !item.spec) return <Skeleton />
  const spec = item.spec
  const through = throughLabel(spec.dataThrough)
  const isTable = spec.kind === "table"
  return (
    <>
      <article
        data-testid="visual"
        data-kind={spec.kind}
        data-visual-id={spec.visualId}
        data-total={spec.total ?? undefined}
        aria-label={spec.title}
        className="viz-rise flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-4 shadow-card"
      >
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 data-testid="visual-title" className="text-sm font-semibold">
              {spec.title}
            </h4>
            <p className="mt-0.5 truncate text-xs text-muted-foreground" title={spec.subtitle}>
              {spec.subtitle}
            </p>
          </div>
          <div className="flex shrink-0 gap-1.5">
            {!isTable && (
              <Button variant="outline" size="sm" data-testid="visual-toggle" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
                {asTable ? <BarChart3 aria-hidden /> : <Table2 aria-hidden />}
                {asTable ? "Chart" : "Table"}
              </Button>
            )}
            <Button variant="outline" size="icon" data-testid="visual-expand" aria-label={`Expand ${spec.title}`} onClick={() => setExpanded(true)}>
              <Maximize2 aria-hidden />
            </Button>
          </div>
        </header>
        <div className="min-w-0">{asTable ? <TableView spec={spec} /> : <Chart spec={spec} />}</div>
        <footer className="flex flex-col gap-1 text-xs text-muted-foreground">
          {spec.definition && <p>{spec.definition}</p>}
          <p className="flex flex-wrap gap-x-3">
            {spec.total != null && !isTable && (
              <span data-testid="visual-total">
                Total in period: <strong className="font-semibold text-foreground tabular-nums">{fmt(spec.total)}</strong> {spec.unit}
              </span>
            )}
            {spec.leftOut > 0 && <span>{spec.leftOut} more not shown</span>}
            {through && <span>Data through {through}</span>}
            <span>Counted by database queries, not by the AI.</span>
          </p>
        </footer>
      </article>
      <Sheet open={expanded} onOpenChange={setExpanded}>
        <SheetContent side="bottom" data-testid="visual-sheet" className="h-dvh w-screen overflow-y-auto data-[side=bottom]:h-dvh">
          <SheetHeader>
            <SheetTitle>{spec.title}</SheetTitle>
            <SheetDescription>{spec.subtitle}</SheetDescription>
          </SheetHeader>
          <div className="mx-auto w-full max-w-5xl px-4 pb-8">
            <div className="rounded-2xl border bg-card p-4 sm:p-6">
              <Chart spec={spec} tall />
            </div>
            {spec.kind !== "table" && (
              <div className="mt-4">
                <h5 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">The same numbers as a table</h5>
                <TableView spec={spec} />
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">{spec.definition}</p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
