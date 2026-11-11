"use client"

import { Check, Plus } from "lucide-react"
import { Button } from "@astryxdesign/core/Button"
import { Stack } from "@astryxdesign/core/Stack"
import { Table, proportional } from "@astryxdesign/core/Table"
import { Text } from "@astryxdesign/core/Text"
import type { TerritoryRow } from "@/lib/data/types"
import { num, pct } from "./format"

type TableRow = TerritoryRow & Record<string, unknown>

/** Territory table. Coverage shows a dash with a reason, never a percentage, when there is no target population. */
export function TerritoryTable({ rows, selected, onToggle, max }: { rows: TerritoryRow[]; selected: string[]; onToggle: (id: string) => void; max: number }) {
  return (
    <Table<TableRow>
      data-testid="territory-table"
      data={rows as TableRow[]}
      idKey="territoryId"
      density="balanced"
      dividers="rows"
      hasHover
      textOverflow="truncate"
      columns={[
        {
          key: "territoryId",
          header: "Territory",
          width: proportional(1, { minWidth: 120 }),
          renderCell: (row) => (
            <span data-testid="territory-row" data-territory={row.territoryId}>
              <strong className="block">{row.territoryId}</strong>
              <span className="block text-xs text-muted-foreground">{row.name}</span>
            </span>
          ),
        },
        {
          key: "distinctCalls",
          header: "Activity & reporting",
          width: proportional(2, { minWidth: 180 }),
          renderCell: (row) => (
            <Stack gap={0.5}>
              <Text type="supporting" hasTabularNumbers>
                <span data-testid="cell-calls">{num(row.distinctCalls)} calls</span> · <span data-testid="cell-hcps">{num(row.distinctEngagedHcps)} HCPs</span> · <span data-testid="cell-responses">{num(row.responseCount)} responses</span>
              </Text>
              <Text type="supporting" hasTabularNumbers>
                {row.reportingMembers} of {row.rosteredMembers} reporting · <span data-testid="cell-completeness">{pct(row.reportingCompleteness)}</span> complete · {" "}
                <span data-testid="cell-coverage" data-status={row.coverage.status}>
                  {row.coverage.status === "AVAILABLE" ? `${row.coverage.percentage}% coverage` : <span title="No approved target population" aria-label="Coverage not shown: no approved target population">Coverage not shown</span>}
                </span>
              </Text>
            </Stack>
          ),
        },
        {
          key: "compare",
          header: "Compare",
          align: "end",
          width: proportional(1, { minWidth: 132 }),
          renderCell: (row) => {
            const isSelected = selected.includes(row.territoryId)
            return <Button data-testid="compare-toggle" label={isSelected ? "Selected" : "Compare"} icon={isSelected ? <Check aria-hidden /> : <Plus aria-hidden />} variant={isSelected ? "primary" : "secondary"} size="sm" isDisabled={!isSelected && selected.length >= max} onClick={() => onToggle(row.territoryId)} />
          },
        },
      ]}
    />
  )
}
