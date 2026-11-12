"use client"

import { AlertTriangle, BellRing, ShieldCheck, ShieldQuestion } from "lucide-react"
import * as React from "react"
import { Badge } from "@astryxdesign/core/Badge"
import { Card } from "@astryxdesign/core/Card"
import { Heading } from "@astryxdesign/core/Heading"
import { Icon } from "@astryxdesign/core/Icon"
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList"
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from "@astryxdesign/core/Table"
import { Text } from "@astryxdesign/core/Text"
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
        <Badge data-testid="small-sample" variant="warning" icon={<Icon icon={AlertTriangle} size="xsm" />} label="Small sample" />
      )}
    </div>
  )
}

function RisingBadge({ row }: { row: ExecutiveMatrixRow }) {
  if (!row.crossRegion) return null
  return (
    <Badge data-testid="cross-region" variant="info" icon={<Icon icon={BellRing} size="xsm" />} label={`Rising in ${row.regionsRising} regions`} className="w-fit" />
  )
}

export function ThresholdsPanel({ t, disclosure }: { t: ExecutiveThresholds; disclosure: ExecutiveTopicMatrix["disclosure"] }) {
  return (
    <aside data-testid="thresholds" aria-label="Alert thresholds" className="min-w-0">
    <Card padding={4} className="flex min-w-0 flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <Heading level={3}>Alert thresholds</Heading>
        {t.approved ? (
          <Badge data-testid="thresholds-approved" variant="success" icon={<Icon icon={ShieldCheck} size="sm" />} label={`Approved${t.version ? ` · v${t.version}` : ""}${t.approvedAt ? ` · ${formatInstant(t.approvedAt)}` : ""}`} />
        ) : (
          <Badge data-testid="thresholds-unapproved" variant="warning" icon={<Icon icon={ShieldQuestion} size="sm" />} label="Not yet approved" />
        )}
      </header>
      <MetadataList columns={2} label={{ position: "top" }}>
        <MetadataListItem label="Responses per period, at least"><Text data-testid="th-window" weight="semibold" hasTabularNumbers>{t.minWindowResponses}</Text></MetadataListItem>
        <MetadataListItem label="Responses on the topic, at least"><Text data-testid="th-topic" weight="semibold" hasTabularNumbers>{t.minTopicResponses}</Text></MetadataListItem>
        <MetadataListItem label="Share up by, at least"><Text data-testid="th-points" weight="semibold" hasTabularNumbers>{t.minSharePoints} points</Text></MetadataListItem>
        <MetadataListItem label="Share relative to before"><Text data-testid="th-relative" weight="semibold" hasTabularNumbers>×{(1 + t.minRelativeIncrease).toString()} or more</Text></MetadataListItem>
        <MetadataListItem label="Smallest group shown"><Text data-testid="th-mincell" weight="semibold" hasTabularNumbers>{t.minCell}</Text></MetadataListItem>
      </MetadataList>
      <Text as="p" type="supporting">{t.rule}</Text>
      {disclosure.applied && (
        <Card variant="muted" padding={2} data-testid="matrix-disclosure">
          <Text as="p" type="supporting">
            {disclosure.text}
            {disclosure.suppressedCells > 0 && <strong className="ml-1 text-foreground">{disclosure.suppressedCells} values withheld in this view.</strong>}
          </Text>
        </Card>
      )}
    </Card>
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
          <div data-testid="matrix-table" className="hidden md:block">
            <Table dividers="rows" density="compact" textOverflow="wrap" verticalAlign="top">
              <caption className="sr-only">
                Free-text responses by theme and region, {data.from} to {data.to}, compared with {data.priorFrom} to {data.priorTo}. Each cell shows the count, its share of the region&apos;s free text, and the trend.
              </caption>
              <TableHeader>
                <TableRow isHeaderRow>
                  <TableHeaderCell scope="col" className="w-[26%]">Theme</TableHeaderCell>
                  {data.regions.map((r) => (
                    <TableHeaderCell key={r.regionId} scope="col" data-testid="matrix-region" data-region={r.regionId}><RegionHead region={r} minCell={min} /></TableHeaderCell>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.topic} data-testid="matrix-row" data-topic={row.topic} data-cross-region={row.crossRegion}>
                    <TableHeaderCell scope="row" className={cn(row.isOther && "text-muted-foreground")}>
                      <span className="block break-words">{row.topic}</span>
                      <RisingBadge row={row} />
                    </TableHeaderCell>
                    {row.cells.map((cell) => (
                      <TableCell key={cell.regionId}><Cell cell={cell} row={row} minCell={min} max={max} /></TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul data-testid="matrix-stack" aria-label="Themes by region" className="flex flex-col gap-3 md:hidden">
            {rows.map((row) => (
              <li key={row.topic} data-testid="matrix-stack-row">
                <Card padding={3} className="flex flex-col gap-2">
                <div className="flex flex-col gap-1"><Text weight="semibold">{row.topic}</Text><RisingBadge row={row} /></div>
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
                </Card>
              </li>
            ))}
          </ul>
          <Text as="p" type="supporting" className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block size-3 rounded border-2 border-primary" />Outlined: meets the approved alert threshold</span>
            <span>Darker = more responses</span>
            <span>Share is of the region&apos;s free text in the period.</span>
          </Text>
        </div>
        <ThresholdsPanel t={data.thresholds} disclosure={data.disclosure} />
      </div>
      <SampleLimitations items={data.sampleLimitations} />
      <Text as="p" type="supporting">{data.note}</Text>
    </div>
  )
}
