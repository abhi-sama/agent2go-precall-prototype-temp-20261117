"use client"

import * as React from "react"
import { BarField, type BarFieldUnavailable } from "@/components/charts/bar-field/bar-field"
import type { TopicHeatmap } from "@/lib/data/director-insights"

const shortTopic = (topic: string) => topic.replace(" (emerging)", " ↑")

export interface HeatmapSelection {
  territoryId: string
  topic: string
}

/**
 * The topic-by-territory heatmap as a 3D bar field: themes along one side, territories along the other, bar height the
 * theme's share of that territory's free-text responses (the same number the 2D chart colours). Tapping a bar selects the
 * same cell as the 2D chart and table, so the detail card below the chart is shared.
 */
export function Heatmap3D({ data, selected, onSelect, onUnavailable }: { data: TopicHeatmap; selected: HeatmapSelection | null; onSelect: (s: HeatmapSelection) => void; onUnavailable: (reason: BarFieldUnavailable) => void }) {
  const rows = React.useMemo(() => data.topics.map((t) => ({ id: t.topic, label: shortTopic(t.topic) })), [data.topics])
  const cols = React.useMemo(() => data.territories.map((t) => ({ id: t.territoryId, label: t.territoryId })), [data.territories])
  const cells = React.useMemo(() => data.cells.map((c) => ({ rowId: c.topic, colId: c.territoryId, value: c.share })), [data.cells])
  const byKey = React.useMemo(() => new Map(data.cells.map((c) => [`${c.territoryId}|${c.topic}`, c])), [data.cells])
  const max = Math.max(...data.cells.map((c) => c.share), 1)

  return (
    <BarField
      rows={rows}
      cols={cols}
      cells={cells}
      max={max}
      unit="%"
      selected={selected ? { rowId: selected.topic, colId: selected.territoryId } : null}
      onSelect={(rowId, colId) => onSelect({ topic: rowId, territoryId: colId })}
      readout={(rowId, colId) => {
        const cell = byKey.get(`${colId}|${rowId}`)
        return cell
          ? `${rowId} in ${colId}: ${cell.responses} of ${cell.territoryResponses} free-text responses (${cell.share.toFixed(1)}%)`
          : `${rowId} in ${colId}: no responses`
      }}
      onUnavailable={onUnavailable}
    />
  )
}
