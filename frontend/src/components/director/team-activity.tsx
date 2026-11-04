"use client"

import type { DirectorOverview } from "@/lib/data/types"
import { formatMonth, formatMonthShort } from "@/lib/dates"
import { cn } from "@/lib/utils"
import { num, pct } from "./format"

/**
 * Member-by-month heatmap of distinct calls. A zero is drawn as a hatched, labelled cell (never just a
 * pale colour) so a month with no recorded call reads as missing reporting, not as a quiet month.
 */
export function TeamActivity({ overview }: { overview: DirectorOverview }) {
  const { members, months } = overview
  const max = Math.max(1, ...members.flatMap((m) => m.months.map((x) => x.distinctCalls)))
  if (members.length === 0) {
    return <p data-testid="team-empty" className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No team member recorded a call in this period.</p>
  }
  return (
    <div data-testid="team-heatmap" className="max-h-[28rem] overflow-y-auto rounded-xl border">
      <table className="w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">Distinct calls by team member and month, with reporting completeness</caption>
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th scope="col" className="w-[34%] px-3 py-2 font-medium sm:w-[28%]">Team member</th>
            {months.map((m) => (
              <th key={m.month} scope="col" title={m.isPartial ? `${formatMonth(m.month)} (partial)` : formatMonth(m.month)} className="px-1 py-2 text-center font-medium">
                {formatMonthShort(m.month)}
                {m.isPartial && <span aria-label="partial month">*</span>}
              </th>
            ))}
            <th scope="col" className="w-[22%] px-3 py-2 text-right font-medium sm:w-[18%]">Reporting</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.memberId} data-testid="member-row" data-member={member.memberId} className="border-b last:border-b-0">
              <th scope="row" className="truncate px-3 py-1.5 text-left font-medium" title={member.name}>
                <span className="block truncate">{member.name}</span>
                <span className="block truncate text-xs font-normal text-muted-foreground">{member.territoryIds.join(", ")}</span>
              </th>
              {member.months.map((cell) => {
                const empty = cell.distinctCalls === 0
                return (
                  <td key={cell.month} className="p-0.5 text-center">
                    <span
                      data-testid="member-cell"
                      data-calls={cell.distinctCalls}
                      className={cn(
                        "grid h-9 place-items-center rounded-md text-xs font-medium tabular-nums",
                        empty && "border border-dashed border-warning/60 bg-[repeating-linear-gradient(135deg,transparent_0_4px,color-mix(in_oklab,var(--warning)_18%,transparent)_4px_8px)] text-muted-foreground",
                      )}
                      style={empty ? undefined : { backgroundColor: `color-mix(in oklab, var(--chart-1) ${Math.round(14 + (cell.distinctCalls / max) * 62)}%, var(--card))` }}
                    >
                      {empty ? "0" : num(cell.distinctCalls)}
                    </span>
                  </td>
                )
              })}
              <td className="px-3 py-1.5 text-right tabular-nums">
                <span data-testid="member-completeness" className="font-semibold">{pct(member.reportingCompleteness)}</span>
                <span className="block text-xs text-muted-foreground">{member.activeMonths} of {member.expectedMonths} months</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
