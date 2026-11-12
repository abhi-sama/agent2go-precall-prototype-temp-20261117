import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from "@astryxdesign/core/Table"
import { Text } from "@astryxdesign/core/Text"
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
      <Table aria-label={caption} density="compact" dividers="rows">
        <TableHeader>
          <TableRow isHeaderRow>
            <TableHeaderCell scope="col" className="w-[34%] sm:w-[28%]">{rowHeader}</TableHeaderCell>
            {columns.map((c) => (
              <TableHeaderCell key={c.key} scope="col" className="px-1 text-center">
                <span title={c.title ?? c.label}>
                  {c.label}
                  {c.partial && <span aria-label="partial period">*</span>}
                </span>
              </TableHeaderCell>
            ))}
            {trailingHeader && <TableHeaderCell scope="col" className="w-[22%] text-right sm:w-[18%]">{trailingHeader}</TableHeaderCell>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} data-testid={rowTestId} data-member={row.id}>
              <TableHeaderCell scope="row" className="max-w-0 truncate">
                <span className="block truncate" title={row.label}>{row.label}</span>
                {row.sublabel && <Text as="span" type="supporting" display="block" className="truncate">{row.sublabel}</Text>}
              </TableHeaderCell>
              {row.values.map((value, i) => {
                const empty = value === 0
                return (
                  <TableCell key={columns[i]?.key ?? i} className="p-0.5 text-center">
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
                  </TableCell>
                )
              })}
              {trailingHeader && <TableCell className="text-right tabular-nums">{row.trailing}</TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
