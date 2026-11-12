"use client"

import { FileSearch } from "lucide-react"
import { Card } from "@astryxdesign/core/Card"
import { Heading } from "@astryxdesign/core/Heading"
import { Icon } from "@astryxdesign/core/Icon"
import { IconButton } from "@astryxdesign/core/IconButton"
import type { ExecutiveRankBy, ExecutiveUnit } from "@/lib/data/types"
import { cn } from "@/lib/utils"
import { CountValue, num, percent } from "./count"

export const RANK_LABEL: Record<ExecutiveRankBy, string> = {
  CALLS: "Distinct calls",
  RESPONSES: "Responses",
  ENGAGED_HCPS: "Engaged HCPs",
  CALLS_PER_TERRITORY: "Calls per territory",
  COMPLETENESS: "Reporting completeness",
}

function metricOf(u: ExecutiveUnit, by: ExecutiveRankBy): number | null {
  return { CALLS: u.calls.value, RESPONSES: u.responses.value, ENGAGED_HCPS: u.engagedHcps.value, CALLS_PER_TERRITORY: u.callsPerTerritory, COMPLETENESS: u.reportingCompleteness }[by]
}

/**
 * Ranked horizontal bars, one row per region or territory, for a single metric under one definition set.
 * Bars share one scale (the largest shown value); a withheld unit has no bar and no rank. When the viewer holds
 * record-level permission each row opens the record drill-down; otherwise there is no control at all.
 */
export function RankedUnits({
  id,
  title,
  units,
  rankBy,
  minCell,
  onDrill,
}: {
  id: string
  title: string
  units: ExecutiveUnit[]
  rankBy: ExecutiveRankBy
  minCell: number
  onDrill?: (unit: ExecutiveUnit) => void
}) {
  const max = Math.max(1, ...units.map((u) => metricOf(u, rankBy) ?? 0))
  return (
    <Card data-testid={`ranked-${id}`} padding={4} className="min-w-0">
      <Heading level={3} className="mb-3">{title}</Heading>
      <ol className="flex flex-col gap-1">
        {units.map((u) => {
          const value = metricOf(u, rankBy)
          return (
            <li key={u.id} data-testid="ranked-row" data-unit={u.id} data-rank={u.rank ?? ""} className="grid grid-cols-[2rem_minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-1 sm:grid-cols-[2rem_minmax(0,12rem)_minmax(0,1fr)_auto]">
              <span className="text-right text-sm font-semibold tabular-nums text-muted-foreground" aria-label={u.rank ? `Rank ${u.rank}` : "Not ranked"}>
                {u.rank ?? "—"}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{u.name}</span>
                {u.level === "REGION" && <span className="block truncate text-xs text-muted-foreground">{u.territoriesInScope} territories</span>}
              </span>
              <span className="h-5 min-w-0 rounded-md bg-muted/50" aria-hidden>
                {value !== null && (
                  <span
                    className={cn("block h-full rounded-md bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none")}
                    style={{ width: `${Math.max(1.5, (100 * value) / max)}%` }}
                  />
                )}
              </span>
              <span className="flex items-center justify-end gap-2 text-sm font-semibold">
                {rankBy === "COMPLETENESS" ? (
                  <span className="tabular-nums" data-testid="ranked-value">{percent(u.reportingCompleteness)}</span>
                ) : rankBy === "CALLS_PER_TERRITORY" ? (
                  <span className="tabular-nums" data-testid="ranked-value">
                    {u.callsPerTerritory === null ? <CountValue count={{ value: null, suppressed: true }} minCell={minCell} /> : num(u.callsPerTerritory)}
                  </span>
                ) : (
                  <CountValue
                    testId="ranked-value"
                    minCell={minCell}
                    count={rankBy === "CALLS" ? u.calls : rankBy === "RESPONSES" ? u.responses : u.engagedHcps}
                  />
                )}
                {onDrill && (
                  <IconButton
                    data-testid="drill-open"
                    variant="secondary"
                    size="lg"
                    onClick={() => onDrill(u)}
                    label={`Open the records behind ${u.name}`}
                    icon={<Icon icon={FileSearch} />}
                  />
                )}
              </span>
            </li>
          )
        })}
      </ol>
    </Card>
  )
}
