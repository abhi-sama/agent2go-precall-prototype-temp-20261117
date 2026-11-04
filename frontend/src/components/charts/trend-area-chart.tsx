"use client"

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { useReducedMotion } from "@/hooks/use-reduced-motion"

export interface TrendPoint {
  label: string
  [series: string]: string | number
}

export interface TrendAreaChartProps {
  data: TrendPoint[]
  /** Series keys in `data` mapped to a label and a design-token colour index (1 to 6). */
  series: ReadonlyArray<{ key: string; label: string; colorIndex?: 1 | 2 | 3 | 4 | 5 | 6 }>
  className?: string
}

/** shadcn chart (Recharts) wrapper: token colours, accessible tooltip/legend, animation off for reduced motion. */
export function TrendAreaChart({ data, series, className }: TrendAreaChartProps) {
  const reduced = useReducedMotion()
  const config = Object.fromEntries(
    series.map((s, i) => [s.key, { label: s.label, color: `var(--chart-${s.colorIndex ?? i + 1})` }]),
  ) satisfies ChartConfig

  return (
    <ChartContainer config={config} className={className ?? "aspect-[16/7] w-full"}>
      <AreaChart data={data} margin={{ left: 4, right: 8, top: 8 }} accessibilityLayer>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={`var(--color-${s.key})`} stopOpacity={0.45} />
              <stop offset="95%" stopColor={`var(--color-${s.key})`} stopOpacity={0.04} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} width={36} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
        {series.map((s) => (
          <Area
            key={s.key}
            dataKey={s.key}
            type="monotone"
            stroke={`var(--color-${s.key})`}
            strokeWidth={2}
            fill={`url(#fill-${s.key})`}
            isAnimationActive={!reduced}
          />
        ))}
        <ChartLegend content={<ChartLegendContent />} />
      </AreaChart>
    </ChartContainer>
  )
}
