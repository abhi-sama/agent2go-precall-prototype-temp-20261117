"use client"

import { Card } from "@astryxdesign/core/Card"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
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
    return <Card data-testid="team-empty" variant="muted" padding={4}>
        <Text as="p" type="supporting">No team member recorded a call in this period.</Text>
      </Card>
  }
  const max = Math.max(1, ...members.flatMap((m) => m.months.map((x) => x.distinctCalls)))
  return (
    <VStack gap={2}>
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
              <Text data-testid="member-completeness" weight="semibold">{pct(member.reportingCompleteness)}</Text>
              <Text type="supporting" display="block">{member.activeMonths} of {member.expectedMonths} months</Text>
            </>
          ),
        }))}
      />
      <SequentialLegend label="Distinct calls per month" min="1" max={num(max)} className="justify-end" />
    </VStack>
  )
}
