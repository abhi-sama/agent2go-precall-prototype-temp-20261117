"use client"

import { Heatmap } from "@/components/charts/heatmap"
import { SequentialLegend } from "@/components/charts/legend"
import type { DirectorOverview } from "@/lib/data/types"
import { formatMonth, formatMonthShort } from "@/lib/dates"
import { num, pct } from "./format"

/**
 * Member-by-month heatmap of distinct calls, drawn by the shared chart system. A zero is a hatched,
 * labelled cell (never just a pale colour) so a month with no recorded call reads as missing reporting.
 */
export function TeamActivity({ overview }: { overview: DirectorOverview }) {
  const { members, months } = overview
  if (members.length === 0) {
    return <p data-testid="team-empty" className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No team member recorded a call in this period.</p>
  }
  const max = Math.max(1, ...members.flatMap((m) => m.months.map((x) => x.distinctCalls)))
  return (
    <div className="flex flex-col gap-2">
      <Heatmap
        testId="team-heatmap"
        rowTestId="member-row"
        cellTestId="member-cell"
        caption="Distinct calls by team member and month, with reporting completeness"
        rowHeader="Team member"
        trailingHeader="Reporting"
        columns={months.map((m) => ({ key: m.month, label: formatMonthShort(m.month), title: m.isPartial ? `${formatMonth(m.month)} (partial)` : formatMonth(m.month), partial: m.isPartial }))}
        formatValue={num}
        rows={members.map((member) => ({
          id: member.memberId,
          label: member.name,
          sublabel: member.territoryIds.join(", "),
          values: member.months.map((cell) => cell.distinctCalls),
          trailing: (
            <>
              <span data-testid="member-completeness" className="font-semibold">{pct(member.reportingCompleteness)}</span>
              <span className="block text-xs text-muted-foreground">{member.activeMonths} of {member.expectedMonths} months</span>
            </>
          ),
        }))}
      />
      <SequentialLegend label="Distinct calls per month" min="1" max={num(max)} className="justify-end" />
    </div>
  )
}
