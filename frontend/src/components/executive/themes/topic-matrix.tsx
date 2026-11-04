"use client"

import { AlertTriangle, BellRing, ShieldCheck, ShieldQuestion } from "lucide-react"
import * as React from "react"
import { sequentialFill } from "@/components/charts/palette"
import { formatInstant } from "@/lib/dates"
import type { ExecutiveMatrixCell, ExecutiveMatrixRegion, ExecutiveMatrixRow, ExecutiveThresholds, ExecutiveTopicMatrix } from "@/lib/data/executive-themes"
import { cn } from "@/lib/utils"
import { CountValue } from "../count"
import { pct, SampleLimitations, TrendIndicator } from "./parts"

const maxShown = (rows: ExecutiveMatrixRow[]) => Math.max(1, ...rows.flatMap((r) => r.cells.map((c) => c.responses.value ?? 0)))

function Cell({ cell, row, minCell, max }: { cell: ExecutiveMatrixCell; row: ExecutiveMatrixRow; minCell: number; max: number }) {
  const hidden = cell.responses.suppressed || cell.responses.value === null
  return (
    <div
      data-testid="matrix-cell"
      data-region={cell.regionId}
      data-topic={row.topic}
      data-trend={cell.trend}
      data-alert={cell.alert}
      className={cn(
        "flex min-h-[4.75rem] flex-col items-start justify-between gap-1 rounded-lg border border-transparent p-2",
        hidden && "border-dashed border-border bg-muted/40",
        cell.alert && "border-primary ring-2 ring-primary/70",
      )}
      style={hidden ? undefined : { backgroundColor: sequentialFill(cell.responses.value ?? 0, max) }}
    >
      <span className="flex flex-wrap items-baseline gap-x-2">
        <CountValue count={cell.responses} minCell={minCell} className="text-base font-semibold" testId="matrix-count" />
        {cell.share !== null && <span data-testid="matrix-share" className="text-xs tabular-nums text-foreground/80">{pct(cell.share)}</span>}
      </span>
      <TrendIndicator trend={cell.trend} compact />
      {cell.alert && <span data-testid="matrix-alert" className="sr-only">Meets the approved alert threshold</span>}
    </div>
  )
}

function RegionHead({ region, minCell }: { region: ExecutiveMatrixRegion; minCell: number }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <span className="text-sm font-semibold text-foreground">{region.regionName}</span>
      <span className="text-xs font-normal text-muted-foreground">
        <CountValue count={region.freeTextResponses} minCell={minCell} testId="region-denominator" className="font-medium" /> free-text
      </span>
      {!region.sampleSufficient && (
        <span data-testid="small-sample" className="inline-flex min-h-6 items-center gap-1 rounded-full border border-warning/50 bg-warning/10 px-2 text-[0.7rem] font-semibold text-foreground">
          <AlertTriangle className="size-3" aria-hidden />Small sample
        </span>
      )}
    </div>
  )
}

function RisingBadge({ row }: { row: ExecutiveMatrixRow }) {
  if (!row.crossRegion) return null
  return (
    <span data-testid="cross-region" className="inline-flex min-h-6 w-fit items-center gap-1 rounded-full border border-primary/60 bg-primary/12 px-2 text-[0.7rem] font-semibold">
      <BellRing className="size-3" aria-hidden />Rising in {row.regionsRising} regions
    </span>
  )
}

export function ThresholdsPanel({ t, disclosure }: { t: ExecutiveThresholds; disclosure: ExecutiveTopicMatrix["disclosure"] }) {
  return (
    <aside data-testid="thresholds" aria-label="Alert thresholds" className="flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-4 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Alert thresholds</h3>
        {t.approved ? (
          <span data-testid="thresholds-approved" className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-fact/40 bg-fact-soft px-2.5 text-xs font-semibold text-fact">
            <ShieldCheck className="size-3.5" aria-hidden />Approved{t.version ? ` · v${t.version}` : ""}{t.approvedAt ? ` · ${formatInstant(t.approvedAt)}` : ""}
          </span>
        ) : (
          <span data-testid="thresholds-unapproved" className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-warning/50 bg-warning/10 px-2.5 text-xs font-semibold">
            <ShieldQuestion className="size-3.5" aria-hidden />Not yet approved
          </span>
        )}
      </header>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div><dt className="text-xs text-muted-foreground">Responses per period, at least</dt><dd data-testid="th-window" className="font-semibold tabular-nums">{t.minWindowResponses}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Responses on the topic, at least</dt><dd data-testid="th-topic" className="font-semibold tabular-nums">{t.minTopicResponses}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Share up by, at least</dt><dd data-testid="th-points" className="font-semibold tabular-nums">{t.minSharePoints} points</dd></div>
        <div><dt className="text-xs text-muted-foreground">Share relative to before</dt><dd data-testid="th-relative" className="font-semibold tabular-nums">×{(1 + t.minRelativeIncrease).toString()} or more</dd></div>
        <div><dt className="text-xs text-muted-foreground">Smallest group shown</dt><dd data-testid="th-mincell" className="font-semibold tabular-nums">{t.minCell}</dd></div>
      </dl>
      <p className="text-xs text-muted-foreground">{t.rule}</p>
      {disclosure.applied && (
        <p data-testid="matrix-disclosure" className="rounded-lg border border-dashed p-2 text-xs text-muted-foreground">
          {disclosure.text}
          {disclosure.suppressedCells > 0 && <strong className="ml-1 text-foreground">{disclosure.suppressedCells} values withheld in this view.</strong>}
        </p>
      )}
    </aside>
  )
}

/**
 * Topic by region. Every cell prints its count, share and trend word with an arrow; colour only deepens with the count.
 * A cell that meets the approved alert threshold is outlined and spoken as such. On a narrow screen each topic stacks
 * into its own card instead of scrolling sideways.
 */
export function TopicMatrix({ data }: { data: ExecutiveTopicMatrix }) {
  const min = data.disclosure.minCell
  const max = maxShown(data.rows)
  const rows = data.rows
  return (
    <div data-testid="topic-matrix" data-facet={data.facet} className="flex min-w-0 flex-col gap-4">
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
        <div className="min-w-0">
          <table data-testid="matrix-table" className="hidden w-full table-fixed border-separate border-spacing-0 text-sm md:table">
            <caption className="sr-only">
              Free-text responses by theme and region, {data.from} to {data.to}, compared with {data.priorFrom} to {data.priorTo}. Each cell shows the count, its share of the region&apos;s free text, and the trend.
            </caption>
            <thead>
              <tr className="text-left align-bottom">
                <th scope="col" className="w-[26%] border-b px-2 py-2 text-xs font-medium text-muted-foreground">Theme</th>
                {data.regions.map((r) => (
                  <th key={r.regionId} scope="col" data-testid="matrix-region" data-region={r.regionId} className="border-b px-1 py-2 align-bottom"><RegionHead region={r} minCell={min} /></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.topic} data-testid="matrix-row" data-topic={row.topic} data-cross-region={row.crossRegion}>
                  <th scope="row" className={cn("border-b px-2 py-1.5 text-left align-middle font-medium", row.isOther && "text-muted-foreground")}>
                    <span className="block break-words">{row.topic}</span>
                    <RisingBadge row={row} />
                  </th>
                  {row.cells.map((cell) => (
                    <td key={cell.regionId} className="border-b p-1 align-top"><Cell cell={cell} row={row} minCell={min} max={max} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <ul data-testid="matrix-stack" aria-label="Themes by region" className="flex flex-col gap-3 md:hidden">
            {rows.map((row) => (
              <li key={row.topic} data-testid="matrix-stack-row" className="flex flex-col gap-2 rounded-2xl border bg-card p-3">
                <div className="flex flex-col gap-1"><span className="font-semibold">{row.topic}</span><RisingBadge row={row} /></div>
                <div className="grid grid-cols-2 gap-2">
                  {row.cells.map((cell) => {
                    const region = data.regions.find((r) => r.regionId === cell.regionId)
                    return (
                      <div key={cell.regionId} className="flex min-w-0 flex-col gap-1">
                        <span className="text-xs font-medium text-muted-foreground">{region?.regionName}{region && !region.sampleSufficient ? " · small sample" : ""}</span>
                        <Cell cell={cell} row={row} minCell={min} max={max} />
                      </div>
                    )
                  })}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block size-3 rounded border-2 border-primary" />Outlined: meets the approved alert threshold</span>
            <span>Darker = more responses</span>
            <span>Share is of the region&apos;s free text in the period.</span>
          </p>
        </div>
        <ThresholdsPanel t={data.thresholds} disclosure={data.disclosure} />
      </div>
      <SampleLimitations items={data.sampleLimitations} />
      <p className="text-xs text-muted-foreground">{data.note}</p>
    </div>
  )
}
