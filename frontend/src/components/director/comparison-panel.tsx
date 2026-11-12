"use client"

import { Scale } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts"
import { Banner } from "@astryxdesign/core/Banner"
import { Card } from "@astryxdesign/core/Card"
import { Grid } from "@astryxdesign/core/Grid"
import { Heading } from "@astryxdesign/core/Heading"
import { Icon } from "@astryxdesign/core/Icon"
import { List, ListItem } from "@astryxdesign/core/List"
import { Skeleton } from "@astryxdesign/core/Skeleton"
import { Table, proportional } from "@astryxdesign/core/Table"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import { ErrorState } from "@/components/state/states"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { useReducedMotion } from "@/hooks/use-reduced-motion"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { DateRange, TerritoryComparison, TerritoryRow } from "@/lib/data/types"
import { useQuery } from "@/lib/data/use-query"
import { formatRange } from "@/lib/dates"
import { useSession } from "@/lib/session/session-provider"
import { isUnequal, num, pct } from "./format"

type Metric = { id: string; title: string; note: string; value: (t: TerritoryRow) => number | null; format: (n: number) => string }
type ComparisonTableRow = TerritoryRow & Record<string, unknown>

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
      <Card data-testid="compare-hint" variant="muted" padding={4}>
        <Text as="p" type="supporting">
          Choose two to six territories in the table above to compare them over the same period and with the same definitions.
        </Text>
      </Card>
    )
  }
  if (query.status === "error") return <ErrorState error={query.error} onRetry={query.refetch} />
  if (query.status === "loading") return <Skeleton aria-busy="true" data-testid="compare-loading" width="100%" height="18rem" radius={4} />
  return <ComparisonBody data={query.data} />
}

function ComparisonBody({ data }: { data: TerritoryComparison }) {
  const reduced = useReducedMotion()
  const withCoverage = data.territories.every((t) => t.coverage.status === "AVAILABLE")
  return (
    <VStack data-testid="comparison" gap={5} className="drill-in">
      <Text as="p" type="supporting" data-testid="compare-basis">
        <Icon icon={Scale} size="sm" className="mr-2 inline align-text-bottom" />
        Same period for every territory: <Text weight="semibold" color="primary">{formatRange(data)}</Text> · Same definitions ({data.definitionVersion})
      </Text>

      {data.populationsUnequal && (
        <Banner data-testid="compare-unequal" role="note" status="warning" title="These territories are not like-for-like" collapsible={false}>
          <List listStyle="disc" density="compact">
            {data.disclosures.filter(isUnequal).map((d) => (
              <ListItem key={d.code} data-testid="compare-disclosure" data-code={d.code} label={d.message} />
            ))}
          </List>
        </Banner>
      )}

      <Grid columns={{ minWidth: 320, max: 2 }} gap={5}>
        {METRICS.map((metric) => (
          <MetricBars key={metric.id} metric={metric} rows={data.territories} reduced={reduced} />
        ))}
      </Grid>

      <Card data-testid="compare-coverage" padding={3}>
        <Heading level={4}>Coverage</Heading>
        {withCoverage ? (
          <List listStyle="none" density="compact" edge="flush">
            {data.territories.map((t) => (
              <ListItem
                key={t.territoryId}
                label={
                  <Text hasTabularNumbers>
                    {t.name}: <Text weight="semibold">{t.coverage.percentage}%</Text> ({t.coverage.engagedTargetHcps} of {t.coverage.targetHcps} target HCPs)
                  </Text>
                }
              />
            ))}
          </List>
        ) : (
          <Text as="p" type="supporting" display="block" className="mt-1">
            {data.territories.some((t) => t.coverage.status === "AVAILABLE")
              ? "Coverage is not compared: only some of these territories have an approved target population."
              : "Coverage is not shown: no approved target population exists for these territories."}
          </Text>
        )}
      </Card>

      <Table<ComparisonTableRow>
        data-testid="compare-table"
        data={data.territories as ComparisonTableRow[]}
        idKey="territoryId"
        density="balanced"
        dividers="rows"
        textOverflow="truncate"
        columns={[
          { key: "territoryId", header: "Territory", width: proportional(2, { minWidth: 200 }), renderCell: (row) => <span data-testid="compare-row" data-territory={row.territoryId}>{row.territoryId} · {row.name}</span> },
          { key: "distinctCalls", header: "Calls", align: "end", renderCell: (row) => num(row.distinctCalls) },
          { key: "distinctEngagedHcps", header: "HCPs", align: "end", renderCell: (row) => num(row.distinctEngagedHcps) },
          { key: "reportingMembers", header: "Members", align: "end" },
          { key: "rosteredMembers", header: "Rostered", align: "end" },
          { key: "reportingCompleteness", header: "Complete", align: "end", renderCell: (row) => pct(row.reportingCompleteness) },
        ]}
      />

      {data.disclosures.filter((d) => !isUnequal(d)).length > 0 && (
        <List listStyle="disc" density="compact">
          {data.disclosures.filter((d) => !isUnequal(d)).map((d) => (
            <ListItem key={d.code} data-testid="compare-note" label={<Text type="supporting">{d.message}</Text>} />
          ))}
        </List>
      )}
    </VStack>
  )
}

function MetricBars({ metric, rows, reduced }: { metric: Metric; rows: TerritoryRow[]; reduced: boolean }) {
  const data = rows.map((t, i) => ({ name: t.territoryId, value: metric.value(t), index: i }))
  const config = { value: { label: metric.title, color: "var(--chart-1)" } } satisfies ChartConfig
  return (
    <figure data-testid={`compare-chart-${metric.id}`} className="min-w-0">
      <Card padding={4}>
        <figcaption>
          <Text type="label" weight="semibold" display="block">{metric.title}</Text>
          <Text type="supporting" display="block">{metric.note}</Text>
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
      </Card>
    </figure>
  )
}
