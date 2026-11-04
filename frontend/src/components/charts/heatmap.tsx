import type * as React from "react"
import { cn } from "@/lib/utils"
import { sequentialFill } from "./palette"

export interface HeatColumn {
  key: string
  label: string
  /** Full name for the header tooltip. */
  title?: string
  /** A month or period still filling: marked with an asterisk, never drawn as a drop. */
  partial?: boolean
}

export interface HeatRow {
  id: string
  label: string
  sublabel?: string
  /** One value per column, same order. */
  values: number[]
  /** Right-hand column (for example reporting completeness). */
  trailing?: React.ReactNode
}

/**
 * Row-by-period heatmap. One sequential hue, the lightest tint still visible against the card. A zero
 * is a hatched, labelled cell (never only a pale colour) so "nothing recorded" reads as missing, not as quiet.
 * Cell text is always the value, so contrast on the tint never carries the number.
 */
export function Heatmap({
  rows,
  columns,
  caption,
  rowHeader,
  trailingHeader,
  testId,
  rowTestId,
  cellTestId,
  formatValue = (n) => n.toLocaleString("en-US"),
}: {
  rows: HeatRow[]
  columns: HeatColumn[]
  caption: string
  rowHeader: string
  trailingHeader?: string
  testId?: string
  rowTestId?: string
  cellTestId?: string
  formatValue?: (n: number) => string
}) {
  const max = Math.max(1, ...rows.flatMap((r) => r.values))
  return (
    <div data-testid={testId} className="max-h-[28rem] overflow-y-auto rounded-xl border">
      <table className="w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th scope="col" className="w-[34%] px-3 py-2 font-medium sm:w-[28%]">{rowHeader}</th>
            {columns.map((c) => (
              <th key={c.key} scope="col" title={c.title ?? c.label} className="px-1 py-2 text-center font-medium">
                {c.label}
                {c.partial && <span aria-label="partial period">*</span>}
              </th>
            ))}
            {trailingHeader && <th scope="col" className="w-[22%] px-3 py-2 text-right font-medium sm:w-[18%]">{trailingHeader}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} data-testid={rowTestId} data-member={row.id} className="border-b last:border-b-0">
              <th scope="row" className="truncate px-3 py-1.5 text-left font-medium" title={row.label}>
                <span className="block truncate">{row.label}</span>
                {row.sublabel && <span className="block truncate text-xs font-normal text-muted-foreground">{row.sublabel}</span>}
              </th>
              {row.values.map((value, i) => {
                const empty = value === 0
                return (
                  <td key={columns[i]?.key ?? i} className="p-0.5 text-center">
                    <span
                      data-testid={cellTestId}
                      data-calls={value}
                      className={cn(
                        "grid h-9 place-items-center rounded-md text-xs font-medium tabular-nums",
                        empty && "border border-dashed border-warning/60 bg-[repeating-linear-gradient(135deg,transparent_0_4px,color-mix(in_oklab,var(--warning)_18%,transparent)_4px_8px)] text-muted-foreground",
                      )}
                      style={empty ? undefined : { backgroundColor: sequentialFill(value, max) }}
                    >
                      {empty ? "0" : formatValue(value)}
                    </span>
                  </td>
                )
              })}
              {trailingHeader && <td className="px-3 py-1.5 text-right tabular-nums">{row.trailing}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
