"use client"

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import { assignSeries } from "@/components/charts"
import { useChartMotion } from "@/components/charts/use-chart-motion"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import type { ExecutiveRegionTrend, ExecutiveTrendMetric } from "@/lib/data/executive-trends"
import { formatMonthShort } from "@/lib/dates"

const FIELD = { CALLS: "calls", ENGAGED_HCPS: "engagedHcps", RESPONSES: "responses" } as const

/** The plotted value of one region in one month, or null for a withheld count (a gap, never a zero). */
export function monthValue(region: ExecutiveRegionTrend, index: number, metric: ExecutiveTrendMetric): number | null {
  return region.months[index]?.[FIELD[metric]].value ?? null
}

/**
 * One line per region across the months. A withheld small group is a gap in the line, never a zero; the table below
 * the chart carries the same figures (and says "Withheld") for anyone who cannot read a chart.
 */
export function RegionTrendChart({ regions, metric, label }: { regions: ExecutiveRegionTrend[]; metric: ExecutiveTrendMetric; label: string }) {
  const motion = useChartMotion()
  const { colors } = assignSeries(regions.map((r) => r.regionId))
  const config = Object.fromEntries(regions.map((r) => [r.regionId, { label: r.regionName, color: colors[r.regionId] }])) satisfies ChartConfig
  const months = regions[0]?.months ?? []
  const data = months.map((m, i) => ({
    label: `${formatMonthShort(m.month)}${m.isPartial ? "*" : ""}`,
    ...Object.fromEntries(regions.map((r) => [r.regionId, monthValue(r, i, metric)])),
  }))
  return (
    <ChartContainer config={config} className="aspect-[16/8] min-h-64 w-full" role="img" aria-label={label} data-testid="region-trend-chart" data-metric={metric}>
      <LineChart data={data} margin={{ left: 4, right: 12, top: 8 }} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval="preserveStartEnd" />
        <YAxis tickLine={false} axisLine={false} width={44} allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
        {regions.map((r) => (
          <Line key={r.regionId} dataKey={r.regionId} type="monotone" stroke={`var(--color-${r.regionId})`} strokeWidth={2} dot={{ r: 2.5 }} connectNulls={false} {...motion} />
        ))}
        <ChartLegend content={<ChartLegendContent />} />
      </LineChart>
    </ChartContainer>
  )
}
