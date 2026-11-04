"use client"

import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { useReducedMotion } from "@/hooks/use-reduced-motion"
import type { ActivityMonth } from "@/lib/data/types"
import { formatMonth, formatMonthShort } from "@/lib/dates"
import { channelLabel } from "./format"

type ColorIndex = 1 | 2 | 3 | 4 | 5 | 6

interface MonthPoint {
  month: string
  label: string
  full: string
  partial: boolean
}

const point = (m: ActivityMonth): MonthPoint => ({
  month: m.month,
  label: formatMonthShort(m.month),
  full: m.isPartial ? `${formatMonth(m.month)} (month to date)` : formatMonth(m.month),
  partial: m.isPartial,
})

/** One bar per month for a single count. A month still loading is drawn lighter, never as a drop. */
export function MonthlyBarChart({
  months,
  field,
  label,
  colorIndex,
  onSelect,
  testId,
}: {
  months: ActivityMonth[]
  field: "distinctCalls" | "distinctEngagedHcps"
  label: string
  colorIndex: ColorIndex
  onSelect: (month: string) => void
  testId: string
}) {
  const reduced = useReducedMotion()
  const data = months.map((m) => ({ ...point(m), value: m[field] }))
  const config = { value: { label, color: `var(--chart-${colorIndex})` } } satisfies ChartConfig
  return (
    <ChartContainer config={config} className="aspect-[16/8] w-full" data-testid={testId}>
      <BarChart data={data} margin={{ left: 4, right: 8, top: 8 }} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval={0} />
        <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={(_, p) => p?.[0]?.payload?.full} />} />
        <Bar
          dataKey="value"
          radius={[6, 6, 0, 0]}
          isAnimationActive={!reduced}
          cursor="pointer"
          onClick={(_, index) => onSelect(data[index].month)}
        >
          {data.map((d) => (
            <Cell key={d.month} fill="var(--color-value)" fillOpacity={d.partial ? 0.5 : 1} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

/** Stacked distinct calls per channel per month. Each segment opens the records behind it. */
export function ChannelStackChart({
  months,
  channels,
  onSelect,
  testId,
}: {
  months: ActivityMonth[]
  channels: string[]
  onSelect: (month: string, channel: string) => void
  testId: string
}) {
  const reduced = useReducedMotion()
  const key = (c: string) => `ch_${c.replace(/[^A-Za-z0-9]/g, "_")}`
  const data = months.map((m) => ({
    ...point(m),
    ...Object.fromEntries(channels.map((c) => [key(c), m.channels.find((x) => x.channel === c)?.distinctCalls ?? 0])),
  }))
  const config = Object.fromEntries(
    channels.map((c, i) => [key(c), { label: channelLabel(c), color: `var(--chart-${(i % 6) + 1})` }]),
  ) satisfies ChartConfig
  return (
    <ChartContainer config={config} className="aspect-[16/8] w-full" data-testid={testId}>
      <BarChart data={data} margin={{ left: 4, right: 8, top: 8 }} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval={0} />
        <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={(_, p) => p?.[0]?.payload?.full} />} />
        {channels.map((c, i) => (
          <Bar
            key={c}
            dataKey={key(c)}
            stackId="calls"
            fill={`var(--color-${key(c)})`}
            radius={i === channels.length - 1 ? [6, 6, 0, 0] : 0}
            isAnimationActive={!reduced}
            cursor="pointer"
            onClick={(_, index) => onSelect(data[index].month, c)}
          />
        ))}
        <ChartLegend content={<ChartLegendContent />} />
      </BarChart>
    </ChartContainer>
  )
}
