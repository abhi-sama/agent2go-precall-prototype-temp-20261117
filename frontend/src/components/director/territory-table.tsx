"use client"

import { Check, Plus } from "lucide-react"
import type { TerritoryRow } from "@/lib/data/types"
import { cn } from "@/lib/utils"
import { num, pct } from "./format"

/** Territory table. Coverage shows a dash with a reason, never a percentage, when there is no target population. */
export function TerritoryTable({ rows, selected, onToggle, max }: { rows: TerritoryRow[]; selected: string[]; onToggle: (id: string) => void; max: number }) {
  return (
    <div className="rounded-xl border">
      <table data-testid="territory-table" className="w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">Territories in your approved scope</caption>
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th scope="col" className="w-[22%] px-3 py-2 font-medium">Territory</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Calls</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">HCPs</th>
            <th scope="col" className="hidden px-2 py-2 text-right font-medium md:table-cell">Responses</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Members</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Complete</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Coverage</th>
            <th scope="col" className="w-[17%] px-3 py-2 text-right font-medium">Compare</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const on = selected.includes(row.territoryId)
            const blocked = !on && selected.length >= max
            return (
              <tr key={row.territoryId} data-testid="territory-row" data-territory={row.territoryId} className={cn("border-b last:border-b-0", on && "bg-accent/40")}>
                <th scope="row" className="px-3 py-1.5 text-left font-medium">
                  <span className="block truncate">{row.territoryId}</span>
                  <span className="block truncate text-xs font-normal text-muted-foreground">{row.name}</span>
                </th>
                <td className="px-2 py-1.5 text-right tabular-nums" data-testid="cell-calls">{num(row.distinctCalls)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums" data-testid="cell-hcps">{num(row.distinctEngagedHcps)}</td>
                <td className="hidden px-2 py-1.5 text-right tabular-nums md:table-cell" data-testid="cell-responses">{num(row.responseCount)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums" title={`${row.rosteredMembers} rostered`}>{row.reportingMembers}</td>
                <td className="px-2 py-1.5 text-right tabular-nums" data-testid="cell-completeness">{pct(row.reportingCompleteness)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums" data-testid="cell-coverage" data-status={row.coverage.status}>
                  {row.coverage.status === "AVAILABLE" ? (
                    `${row.coverage.percentage}%`
                  ) : (
                    <span title="No approved target population" aria-label="Coverage not shown: no approved target population">—</span>
                  )}
                </td>
                <td className="px-3 py-1 text-right">
                  <button
                    type="button"
                    data-testid="compare-toggle"
                    aria-pressed={on}
                    disabled={blocked}
                    onClick={() => onToggle(row.territoryId)}
                    className={cn(
                      "inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg border px-2 text-xs font-medium disabled:opacity-40",
                      on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
                    )}
                  >
                    {on ? <Check className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
                    <span className="hidden sm:inline">{on ? "Selected" : "Compare"}</span>
                    <span className="sr-only sm:hidden">{on ? "Selected" : "Compare"}</span>
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
