"use client"

import * as React from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { assignSeries } from "@/components/charts/palette"
import { useChartMotion } from "@/components/charts/use-chart-motion"
import type { DirectorOverview, MixDimension } from "@/lib/data/types"
import { formatMonthShort } from "@/lib/dates"
import { cn } from "@/lib/utils"
import { num, valueLabel } from "./format"

/**
 * Channel, topic, disease-state and product mix as ranked bars plus a monthly trend. The product view
 * counts mentions, not calls: a call that covers two products appears under both, so the bars can sum to
 * more than the distinct calls. Both numbers are always on screen and labelled apart.
 */
export function MixSection({ overview }: { overview: DirectorOverview }) {
  const [kind, setKind] = React.useState<MixDimension["dimension"]>("CHANNEL")
  const motion = useChartMotion()
  const mix = overview.mix.find((m) => m.dimension === kind) ?? overview.mix[0]
  if (!mix) return null
  const ranked = mix.values.map((v) => ({ name: valueLabel(v.value), calls: v.distinctCalls }))
  const trend = overview.months.map((m, i) => ({
    label: formatMonthShort(m.month),
    ...Object.fromEntries(mix.values.map((v, vi) => [`v${vi}`, v.months[i]?.distinctCalls ?? 0])),
  }))
  const { colors } = assignSeries(mix.values.map((_, i) => `v${i}`))
  const config = {
    calls: { label: "Distinct calls", color: "var(--chart-1)" },
    ...Object.fromEntries(mix.values.map((v, i) => [`v${i}`, { label: valueLabel(v.value), color: colors[`v${i}`] }])),
  } satisfies ChartConfig
  const unit = kind === "PRODUCT" ? "product mentions" : "value mentions"

  return (
    <div data-testid="mix-section" className="flex flex-col gap-4">
      <div role="tablist" aria-label="Mix dimension" className="flex flex-wrap gap-2">
        {overview.mix.map((m) => (
          <button
            key={m.dimension}
            type="button"
            role="tab"
            aria-selected={m.dimension === kind}
            data-testid={`mix-tab-${m.dimension}`}
            onClick={() => setKind(m.dimension)}
            className={cn(
              "min-h-11 rounded-full border px-4 text-sm font-medium transition-colors",
              m.dimension === kind ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p data-testid="mix-totals" className="text-sm text-muted-foreground">
        <strong className="text-foreground tabular-nums">{num(mix.totalDistinctCalls)}</strong> distinct calls
        {mix.valuesOverlap ? (
          <>
            {" · "}
            <strong className="text-foreground tabular-nums">{num(mix.valueTotal)}</strong> {unit}. A call recorded under several values counts once in each, so the bars add up to more than the calls.
          </>
        ) : (
          ". Each call has one value here, so the bars add up to the calls."
        )}
      </p>
      {mix.values.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No calls to break down in this period.</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <figure data-testid="mix-ranked" className="min-w-0">
            <figcaption className="mb-2 text-sm font-semibold">Ranked by distinct calls</figcaption>
            <ChartContainer config={config} className="aspect-[16/9] w-full">
              <BarChart data={ranked} layout="vertical" margin={{ left: 4, right: 16 }} accessibilityLayer>
                <CartesianGrid horizontal={false} />
                <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={104} tick={{ fontSize: 12 }} />
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                <Bar dataKey="calls" fill="var(--color-calls)" radius={[0, 6, 6, 0]} {...motion} />
              </BarChart>
            </ChartContainer>
          </figure>
          <figure data-testid="mix-trend" className="min-w-0">
            <figcaption className="mb-2 text-sm font-semibold">Monthly distinct calls by value</figcaption>
            <ChartContainer config={config} className="aspect-[16/9] w-full">
              <BarChart data={trend} margin={{ left: 4, right: 8 }} accessibilityLayer>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} interval={0} />
                <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} />
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                {mix.values.map((v, i) => (
                  <Bar key={v.value} dataKey={`v${i}`} stackId="mix" fill={`var(--color-v${i})`} {...motion} />
                ))}
                <ChartLegend content={<ChartLegendContent />} />
              </BarChart>
            </ChartContainer>
          </figure>
        </div>
      )}
    </div>
  )
}
