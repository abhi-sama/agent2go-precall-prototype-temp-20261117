"use client"

import { Stethoscope, Users } from "lucide-react"
import * as React from "react"
import { Button } from "@astryxdesign/core/Button"
import { Card } from "@astryxdesign/core/Card"
import { Grid } from "@astryxdesign/core/Grid"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Skeleton } from "@astryxdesign/core/Skeleton"
import { DashboardGrid, DashboardGridItem } from "@/components/layout/dashboard-grid"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import { DataThroughBadge } from "@/components/landing/data-through-badge"
import { KpiCard } from "@/components/landing/kpi-card"
import { ScopeLabel } from "@/components/shell/scope-label"
import { EmptyState, ErrorState, KpiSkeleton } from "@/components/state/states"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { ActivityMetric } from "@/lib/data/types"
import { useQuery } from "@/lib/data/use-query"
import { formatMonth } from "@/lib/dates"
import { useSession } from "@/lib/session/session-provider"
import { ChannelStackChart, MonthlyBarChart } from "./activity-charts"
import { EvidenceDrawer, type DrawerState } from "./evidence-drawer"
import { FlagsPanel } from "./flags-panel"

/**
 * Personal activity trends: monthly distinct calls, distinct HCPs and channel mix, with the scope,
 * the data-through date and the denominator on screen. These are counts only. There is no target,
 * ranking, colour-coded good/bad or score, because none of them is defined for this data.
 */
export function ActivityTrendsSection() {
  const adapter = useDataAdapter()
  const { userId, ready } = useSession()
  const trends = useQuery("activityTrends", userId, (ctx) => adapter.activityTrends(ctx, 12), ready)
  const flags = useQuery("myFlags", userId, (ctx) => adapter.myFlags(ctx), ready)
  const [drawer, setDrawer] = React.useState<DrawerState | null>(null)

  const data = trends.status === "success" ? trends.data : null
  const lastComplete = data ? ([...data.months].reverse().find((m) => !m.isPartial) ?? data.months.at(-1)) : undefined
  const openEvidence = (metric: ActivityMetric, month: string | undefined, channel: string | null = null) =>
    month && setDrawer({ view: "evidence", metric, month, channel })
  const empty = data !== null && data.totalDistinctCalls === 0
  const flagsPanel = (
    <FlagsPanel
      flags={flags.status === "loading" ? { status: "loading" } : flags.status === "error" ? { status: "error", error: flags.error } : { status: "success", data: flags.data }}
      onRetry={flags.refetch}
      onNew={() => setDrawer({ view: "flag" })}
    />
  )
  const partial = data?.months.find((m) => m.isPartial)

  return (
    <VStack data-testid="activity-trends" gap={4}>
      <VStack as="header" gap={2} align="start">
        <VStack gap={1}>
          <Heading level={1}>My activity</Heading>
          <Text as="p" color="secondary">
            Monthly counts of the calls you recorded and the HCPs you engaged. These are counts only: there is no target, ranking or score here.
          </Text>
        </VStack>
        <HStack gap={2} wrap="wrap" align="center">
          <ScopeLabel
            label={data?.scopeLabel ?? (trends.status === "error" && trends.error.code === "FORBIDDEN" ? "No access" : undefined)}
            loading={trends.status !== "success" && !(trends.status === "error" && trends.error.code === "FORBIDDEN")}
          />
          {data && <DataThroughBadge dataThrough={data.dataThrough} />}
          {data && (
            <Text data-testid="window-label" type="supporting">
              {formatMonth(data.from)} – {formatMonth(data.to)} · {data.months.length} months
              {partial && ` · ${formatMonth(partial.month)} is month to date`}
            </Text>
          )}
        </HStack>
      </VStack>

      {trends.status === "error" ? (
        <ErrorState error={trends.error} onRetry={trends.refetch} />
      ) : empty ? (
        <EmptyState title="No calls in these months">No calls were recorded for your scope in the last 12 months.</EmptyState>
      ) : (
        <DashboardGrid>
          <DashboardGridItem area="full">
            <Grid columns={{ minWidth: 300, max: 2 }} gap={4} data-testid="trend-totals">
              {data ? (
                <>
                  <KpiCard
                    id="calls"
                    label="Distinct calls, 12 months"
                    value={data.totalDistinctCalls}
                    definition="Each call counted once, however many product rows it has."
                    icon={Stethoscope}
                    tone="orange"
                  />
                  <KpiCard
                    id="hcps"
                    index={1}
                    label="Distinct HCPs, 12 months"
                    value={data.totalDistinctEngagedHcps}
                    definition="Each HCP counted once across the window, so months do not add up to this."
                    icon={Users}
                    tone="ink"
                  />
                </>
              ) : (
                <>
                  <KpiSkeleton />
                  <KpiSkeleton />
                </>
              )}
            </Grid>
          </DashboardGridItem>

          <DashboardGridItem area="half">
            <ChartCard
              id="calls"
              title="Distinct calls per month"
              note="Each call counted once. A month still loading is drawn lighter."
              onEvidence={() => openEvidence("CALLS", lastComplete?.month)}
              ready={data !== null}
            >
              {data && <MonthlyBarChart months={data.months} field="distinctCalls" label="Distinct calls" colorIndex={1} testId="chart-calls" onSelect={(m) => openEvidence("CALLS", m)} />}
            </ChartCard>
          </DashboardGridItem>

          <DashboardGridItem area="half">
            <ChartCard
              id="hcps"
              title="Distinct HCPs per month"
              note="HCPs engaged at least once that month. The same HCP in two months counts in both."
              onEvidence={() => openEvidence("HCPS", lastComplete?.month)}
              ready={data !== null}
            >
              {data && <MonthlyBarChart months={data.months} field="distinctEngagedHcps" label="Distinct HCPs" colorIndex={2} testId="chart-hcps" onSelect={(m) => openEvidence("HCPS", m)} />}
            </ChartCard>
          </DashboardGridItem>

          <DashboardGridItem area="primary">
            <ChartCard
              id="channels"
              title="Channel mix"
              note="Distinct calls by channel. A call recorded under several channels counts once in each."
              onEvidence={() => openEvidence("CALLS", lastComplete?.month, data?.channels[0] ?? null)}
              ready={data !== null}
            >
              {data && <ChannelStackChart months={data.months} channels={data.channels} testId="chart-channels" onSelect={(m, c) => openEvidence("CALLS", m, c)} />}
            </ChartCard>
          </DashboardGridItem>

          <DashboardGridItem area="secondary">{flagsPanel}</DashboardGridItem>
        </DashboardGrid>
      )}

      {(trends.status === "error" || empty) && flagsPanel}

      {data && (
        <EvidenceDrawer
          state={drawer}
          onStateChange={setDrawer}
          onClose={() => setDrawer(null)}
          trends={data}
          onFlagged={() => flags.refetch()}
        />
      )}
    </VStack>
  )
}

function ChartCard({
  id,
  title,
  note,
  onEvidence,
  ready,
  children,
}: {
  id: string
  title: string
  note: string
  onEvidence: () => void
  ready: boolean
  children: React.ReactNode
}) {
  return (
    <Card data-testid={`chart-card-${id}`} padding={5} elevation="low">
      <section aria-labelledby={`chart-${id}-title`}>
        <VStack gap={4}>
          <HStack gap={3} wrap="wrap" align="start" justify="between">
            <VStack gap={1}>
              <Heading id={`chart-${id}-title`} level={2}>
                {title}
              </Heading>
              <Text type="supporting" as="p">
                {note}
              </Text>
            </VStack>
            <Button label="View evidence" variant="secondary" onClick={onEvidence} isDisabled={!ready} data-testid={`evidence-open-${id}`} />
          </HStack>
          {ready ? children : <Skeleton aria-busy="true" data-testid="state-loading" height="14rem" radius={3} />}
          <Text type="supporting" as="p" size="xsm">
            Tap a bar to see the records behind it.
          </Text>
        </VStack>
      </section>
    </Card>
  )
}
