"use client"

import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from "@astryxdesign/core/Table"
import { fmt } from "./shared"

/** The accessible twin of every chart, and the "table" visual itself: counts per row with right-aligned tabular numbers. */
export function DataTable({
  caption,
  columns,
  rows,
  testId = "data-table",
}: {
  caption: string
  columns: string[]
  rows: { key: string; label: string; cells: (number | string)[] }[]
  testId?: string
}) {
  return (
    <div data-testid={testId} className="rounded-xl border">
      <Table aria-label={caption} density="balanced" dividers="rows">
        <TableHeader>
          <TableRow isHeaderRow>
            {columns.map((c, i) => (
              <TableHeaderCell key={c} scope="col" className={i === 0 ? "w-[34%]" : "text-right"}>
                {c}
              </TableHeaderCell>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key} data-testid="table-row" data-key={r.key}>
              <TableHeaderCell scope="row" className="max-w-0 truncate">
                <span className="block truncate" title={r.label}>{r.label}</span>
              </TableHeaderCell>
              {r.cells.map((cell, i) => (
                <TableCell key={i} data-value={typeof cell === "number" ? cell : undefined} className="text-right tabular-nums">
                  {typeof cell === "number" ? fmt(cell) : cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
