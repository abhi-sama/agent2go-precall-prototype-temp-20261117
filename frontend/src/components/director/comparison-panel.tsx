"use client"

import { Info, Scale } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts"
import { ErrorState } from "@/components/state/states"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { useReducedMotion } from "@/hooks/use-reduced-motion"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { DateRange, TerritoryComparison, TerritoryRow } from "@/lib/data/types"
import { useQuery } from "@/lib/data/use-query"
import { formatRange } from "@/lib/dates"
import { useSession } from "@/lib/session/session-provider"
import { Skeleton } from "@/components/ui/skeleton"
import { isUnequal, num, pct } from "./format"

type Metric = { id: string; title: string; note: string; value: (t: TerritoryRow) => number | null; format: (n: number) => string }

const METRICS: Metric[] = [
  { id: "calls", title: "Distinct calls", note: "Each call once.", value: (t) => t.distinctCalls, format: num },
  { id: "hcps", title: "Distinct engaged HCPs", note: "Each HCP once per territory.", value: (t) => t.distinctEngagedHcps, format: num },
  { id: "per-member", title: "Calls per reporting member", note: "Evens out different team sizes.", value: (t) => t.callsPerReportingMember, format: (n) => n.toFixed(1) },
  { id: "completeness", title: "Reporting completeness", note: "Months with a recorded call.", value: (t) => (t.reportingCompleteness === null ? null : Math.round(t.reportingCompleteness * 100)), format: (n) => `${n}%` },
]

/**
 * Side-by-side territory bars. The period and the metric definitions are fixed once for every bar;
 * there is no per-territory period to choose. Differences in team size, target data or reporting
 * completeness are stated beside the bars, so unequal populations are never presented as like-for-like.
 */
export function ComparisonPanel({ ids, range }: { ids: string[]; range: DateRange }) {
  const adapter = useDataAdapter()
  const { userId, ready } = useSession()
  const enabled = ready && ids.length >= 2
  const query = useQuery("territoryComparison", `${userId}:${ids.join(",")}:${range.from}:${range.to}`, (ctx) => adapter.territoryComparison(ctx, ids, range), enabled)

  if (ids.length < 2) {
    return (
      <p data-testid="compare-hint" className="rounded-xl border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground">
        Choose two to six territories in the table above to compare them over the same period and with the same definitions.
      </p>
    )
  }
  if (query.status === "error") return <ErrorState error={query.error} onRetry={query.refetch} />
  if (query.status === "loading") return <Skeleton aria-busy="true" data-testid="compare-loading" className="h-72 w-full rounded-xl" />
  return <ComparisonBody data={query.data} />
}

function ComparisonBody({ data }: { data: TerritoryComparison }) {
  const reduced = useReducedMotion()
  const withCoverage = data.territories.every((t) => t.coverage.status === "AVAILABLE")
  return (
    <div data-testid="comparison" className="drill-in flex flex-col gap-5">
      <p data-testid="compare-basis" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <Scale className="size-4" aria-hidden />
        <span>
          Same period for every territory: <strong className="text-foreground">{formatRange(data)}</strong>
        </span>
        <span>· Same definitions ({data.definitionVersion})</span>
      </p>

      {data.populationsUnequal && (
        <div data-testid="compare-unequal" role="note" className="flex gap-3 rounded-xl border border-warning/50 bg-warning/10 p-4 text-sm">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">These territories are not like-for-like</p>
            <ul className="mt-1 list-disc pl-5">
              {data.disclosures.filter(isUnequal).map((d) => (
                <li key={d.code} data-testid="compare-disclosure" data-code={d.code}>
                  {d.message}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        {METRICS.map((metric) => (
          <MetricBars key={metric.id} metric={metric} rows={data.territories} reduced={reduced} />
        ))}
      </div>

      <div data-testid="compare-coverage" className="rounded-xl border p-4 text-sm">
        <h4 className="font-semibold">Coverage</h4>
        {withCoverage ? (
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {data.territories.map((t) => (
              <li key={t.territoryId} className="tabular-nums">
                {t.name}: <strong>{t.coverage.percentage}%</strong> ({t.coverage.engagedTargetHcps} of {t.coverage.targetHcps} target HCPs)
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-muted-foreground">
            {data.territories.some((t) => t.coverage.status === "AVAILABLE")
              ? "Coverage is not compared: only some of these territories have an approved target population."
              : "Coverage is not shown: no approved target population exists for these territories."}
          </p>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table data-testid="compare-table" className="w-full table-fixed text-sm">
          <caption className="sr-only">Territory comparison values</caption>
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th scope="col" className="w-[26%] px-3 py-2 font-medium">Territory</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">Calls</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">HCPs</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">Members</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">Rostered</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Complete</th>
            </tr>
          </thead>
          <tbody>
            {data.territories.map((t) => (
              <tr key={t.territoryId} data-testid="compare-row" data-territory={t.territoryId} className="border-b last:border-b-0">
                <th scope="row" className="truncate px-3 py-2 text-left font-medium">{t.territoryId} · {t.name}</th>
                <td className="px-2 py-2 text-right tabular-nums">{num(t.distinctCalls)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{num(t.distinctEngagedHcps)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{t.reportingMembers}</td>
                <td className="px-2 py-2 text-right tabular-nums">{t.rosteredMembers}</td>
                <td className="px-3 py-2 text-right tabular-nums">{pct(t.reportingCompleteness)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.disclosures.filter((d) => !isUnequal(d)).length > 0 && (
        <ul className="list-disc pl-5 text-xs text-muted-foreground">
          {data.disclosures.filter((d) => !isUnequal(d)).map((d) => (
            <li key={d.code} data-testid="compare-note">{d.message}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function MetricBars({ metric, rows, reduced }: { metric: Metric; rows: TerritoryRow[]; reduced: boolean }) {
  const data = rows.map((t, i) => ({ name: t.territoryId, value: metric.value(t), index: i }))
  const config = { value: { label: metric.title, color: "var(--chart-1)" } } satisfies ChartConfig
  return (
    <figure data-testid={`compare-chart-${metric.id}`} className="min-w-0 rounded-xl border p-4">
      <figcaption>
        <span className="text-sm font-semibold">{metric.title}</span>
        <span className="block text-xs text-muted-foreground">{metric.note}</span>
      </figcaption>
      <ChartContainer config={config} className="mt-2 aspect-[16/9] w-full">
        <BarChart data={data.map((d) => ({ ...d, value: d.value ?? 0 }))} margin={{ left: 4, right: 8, top: 8 }} accessibilityLayer>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 11 }} />
          <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} />
          <ChartTooltip cursor={false} content={<ChartTooltipContent formatter={(v) => metric.format(Number(v))} />} />
          <Bar dataKey="value" radius={[6, 6, 0, 0]} isAnimationActive={!reduced}>
            {data.map((d) => (
              <Cell key={d.name} fill={`var(--chart-${(d.index % 6) + 1})`} fillOpacity={d.value === null ? 0.25 : 1} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </figure>
  )
}
