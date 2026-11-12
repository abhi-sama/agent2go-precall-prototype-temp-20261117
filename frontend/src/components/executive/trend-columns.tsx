"use client"

import * as React from "react"
import { Button } from "@astryxdesign/core/Button"
import { Card } from "@astryxdesign/core/Card"
import { HStack } from "@astryxdesign/core/HStack"
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl"
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from "@astryxdesign/core/Table"
import { Text } from "@astryxdesign/core/Text"
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
    <Card data-testid="trend" padding={4}>
      <HStack justify="between" align="center" wrap="wrap" gap={2} className="mb-4">
        <SegmentedControl label="Trend metric" value={metric} onChange={(value) => setMetric(value as Metric)} size="lg">
          {METRICS.map((m) => <SegmentedControlItem key={m.id} value={m.id} label={m.label} data-testid={`trend-metric-${m.id}`} />)}
        </SegmentedControl>
        <Text as="p" type="supporting">Outlined columns are partial months. Hatched columns are withheld small groups.</Text>
      </HStack>
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
      <Button
        variant="ghost"
        data-testid="trend-table-toggle"
        aria-expanded={tableOpen}
        onClick={() => setTableOpen((v) => !v)}
        label={tableOpen ? "Hide table view" : "Table view"}
        className="mt-4"
      />
      {tableOpen && (
        <Card padding={0} className="mt-2">
          <Table data-testid="trend-table" aria-label="Monthly activity across your authorized regions">
            <TableHeader>
              <TableRow isHeaderRow>
                <TableHeaderCell scope="col">Month</TableHeaderCell>
                <TableHeaderCell scope="col" className="text-right">Calls</TableHeaderCell>
                <TableHeaderCell scope="col" className="text-right">Responses</TableHeaderCell>
                <TableHeaderCell scope="col" className="text-right">Engaged HCPs</TableHeaderCell>
                <TableHeaderCell scope="col" className="text-right">Territories reporting</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {months.map((m) => (
                <TableRow key={m.month}>
                  <TableHeaderCell scope="row">{formatMonth(m.month)}{m.isPartial ? " (partial)" : ""}</TableHeaderCell>
                  <TableCell className="text-right"><CountValue count={m.calls} minCell={minCell} /></TableCell>
                  <TableCell className="text-right"><CountValue count={m.responses} minCell={minCell} /></TableCell>
                  <TableCell className="text-right"><CountValue count={m.engagedHcps} minCell={minCell} /></TableCell>
                  <TableCell className="text-right tabular-nums">{m.territoriesReporting} of {m.territoriesInScope}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </Card>
  )
}
