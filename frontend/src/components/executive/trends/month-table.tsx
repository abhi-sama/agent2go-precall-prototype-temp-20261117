"use client"

import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from "@astryxdesign/core/Table"
import { CountValue } from "@/components/executive/count"
import type { ExecutiveRegionTrend, ExecutiveTrendMetric } from "@/lib/data/executive-trends"
import { TREND_METRIC_LABEL } from "@/lib/data/executive-trends"
import { formatMonth } from "@/lib/dates"

const FIELD = { CALLS: "calls", ENGAGED_HCPS: "engagedHcps", RESPONSES: "responses" } as const

/** The chart's figures as a table: months down, regions across. Withheld cells say so; they are never blank or zero. */
export function MonthTable({ regions, metric, minCell }: { regions: ExecutiveRegionTrend[]; metric: ExecutiveTrendMetric; minCell: number }) {
  const months = regions[0]?.months ?? []
  return (
    <Table data-testid="month-table" aria-label={`${TREND_METRIC_LABEL[metric]} by month and region`}>
      <TableHeader>
        <TableRow isHeaderRow>
          <TableHeaderCell scope="col">Month</TableHeaderCell>
          {regions.map((r) => <TableHeaderCell key={r.regionId} scope="col" className="text-right">{r.regionName}</TableHeaderCell>)}
        </TableRow>
      </TableHeader>
      <TableBody>
        {months.map((m, i) => (
          <TableRow key={m.month} data-testid="month-row" data-month={m.month}>
            <TableHeaderCell scope="row">{formatMonth(m.month)}{m.isPartial ? " (partial)" : ""}</TableHeaderCell>
            {regions.map((r) => (
              <TableCell key={r.regionId} className="text-right"><CountValue count={r.months[i][FIELD[metric]]} minCell={minCell} /></TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
