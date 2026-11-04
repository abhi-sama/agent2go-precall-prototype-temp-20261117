"use client"

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
      <table className="w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            {columns.map((c, i) => (
              <th key={c} scope="col" className={i === 0 ? "w-[34%] px-3 py-2 font-medium" : "px-3 py-2 text-right font-medium"}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} data-testid="table-row" data-key={r.key} className="border-b last:border-b-0">
              <th scope="row" className="truncate px-3 py-2 text-left font-medium" title={r.label}>
                {r.label}
              </th>
              {r.cells.map((cell, i) => (
                <td key={i} data-value={typeof cell === "number" ? cell : undefined} className="px-3 py-2 text-right tabular-nums">
                  {typeof cell === "number" ? fmt(cell) : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
