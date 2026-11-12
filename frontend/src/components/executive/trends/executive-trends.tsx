"use client"

import * as React from "react"
import { Banner } from "@astryxdesign/core/Banner"
import { Badge } from "@astryxdesign/core/Badge"
import { Card } from "@astryxdesign/core/Card"
import { Heading } from "@astryxdesign/core/Heading"
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList"
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl"
import { Stack } from "@astryxdesign/core/Stack"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import { SampleLimitations } from "@/components/executive/themes/parts"
import { InsightSection, PanelLoading } from "@/components/director/insights/shared"
import { DataThroughBadge } from "@/components/landing/data-through-badge"
import { DashboardGrid, DashboardGridItem } from "@/components/layout/dashboard-grid"
import { ScopeLabel } from "@/components/shell/scope-label"
import { EmptyState, ErrorState } from "@/components/state/states"
import { useDataAdapter } from "@/lib/data/data-provider"
import { EXECUTIVE_TREND_METRICS, TREND_METRIC_LABEL, type ExecutiveTrendMetric, type ExecutiveTrends } from "@/lib/data/executive-trends"
import { useQuery } from "@/lib/data/use-query"
import { addMonths, formatDay } from "@/lib/dates"
import { useSession } from "@/lib/session/session-provider"
import { cn } from "@/lib/utils"
import { MonthTable } from "./month-table"
import { RegionArrows } from "./region-arrows"
import { RegionTrendChart } from "./region-trend-chart"

const PERIODS = [
  { id: "6", label: "6 months", months: 6 },
  { id: "12", label: "12 months", months: 12 },
  { id: "24", label: "24 months", months: 24 },
] as const
type Period = (typeof PERIODS)[number]["id"]

/** The BE defaults to twelve months ending at data-through; a shorter or longer period only moves the start. */
function windowFor(period: Period): { from?: string } {
  if (period === "12") return {}
  const today = new Date().toISOString().slice(0, 10)
  return { from: addMonths(`${today.slice(0, 7)}-01`, -(Number(period) - 1)) }
}

function AccessBanner({ data }: { data: ExecutiveTrends }) {
  if (data.accessLevel === "RECORD_DRILLDOWN") {
    return <Banner data-testid="access-banner" data-level="RECORD_DRILLDOWN" status="success" title="Record-level access" description="You hold record-level permission, so nothing is withheld in this view. Trends stay aggregate: open the records from the overview." />
  }
  return (
    <Banner
      data-testid="access-banner"
      data-level="AGGREGATE_ONLY"
      status="info"
      title="Aggregate-only access"
      description={
        <span data-testid="disclosure-text">
          Aggregate-only view for {data.scopeLabel}. {data.disclosure.text} Individual records are not available to your role.
          {data.disclosure.suppressedCells > 0 && <strong data-testid="suppressed-cells" className="ml-1 text-foreground">{data.disclosure.suppressedCells} values withheld in this view.</strong>}
        </span>
      }
    />
  )
}

function RuleCard({ data }: { data: ExecutiveTrends }) {
  const t = data.thresholds
  return (
    <Card data-testid="trend-rule" padding={4}>
      <VStack gap={3}>
        <Stack direction="horizontal" gap={2} vAlign="center" wrap="wrap">
          <Heading level={3}>How arrows are judged</Heading>
          <Badge data-testid="thresholds-approved" variant={t.approved ? "success" : "warning"} label={t.approved ? `Approved rule v${t.version}` : "Not yet approved"} />
        </Stack>
        <Text as="p" type="supporting" data-testid="trend-rule-text">{t.rule}</Text>
        <MetadataList columns="single">
          <MetadataListItem label="Latest period"><span data-testid="trend-latest">{formatDay(data.trendFrom, true)} to {formatDay(data.trendTo, true)}</span></MetadataListItem>
          <MetadataListItem label="Compared with"><span data-testid="trend-prior">{formatDay(data.priorFrom, true)} to {formatDay(data.priorTo, true)}</span></MetadataListItem>
          <MetadataListItem label="Responses needed in each period"><span data-testid="th-window">{t.minWindowResponses}</span></MetadataListItem>
          <MetadataListItem label="Smallest change that counts"><span data-testid="th-change">{t.minChange} and {Math.round(t.minRelativeChange * 100)}%</span></MetadataListItem>
          <MetadataListItem label="Counts withheld below"><span data-testid="th-mincell">{t.minCell}</span></MetadataListItem>
        </MetadataList>
      </VStack>
    </Card>
  )
}

/**
 * The Executive's activity trends: monthly distinct calls, engaged HCPs and responses by the regions they are explicitly
 * authorized for, and an arrow per region and metric judged by the approved thresholds. Aggregate-only: the BE decides what
 * is withheld, and nothing on this page opens a record.
 */
export function ExecutiveTrendsWorkspace() {
  const adapter = useDataAdapter()
  const { userId, ready } = useSession()
  const [period, setPeriod] = React.useState<Period>("12")
  const [metric, setMetric] = React.useState<ExecutiveTrendMetric>("CALLS")
  const query = useQuery("executiveTrends", `${userId}:${period}`, (ctx) => adapter.executiveTrends(ctx, windowFor(period)), ready)
  // Keep the last result on screen while a new period loads, but never across people.
  const [kept, setKept] = React.useState<{ userId: string; data: ExecutiveTrends } | null>(null)
  if (query.status === "success" && kept?.data !== query.data) setKept({ userId, data: query.data })
  const data = kept?.userId === userId ? kept.data : null
  const busy = query.status === "loading"

  const noActivity = data !== null && data.regions.every((r) => r.months.every((m) => m.calls.value === 0 && m.responses.value === 0))
  const min = data?.disclosure.minCell ?? 5

  return (
    <div data-testid="executive-trends" aria-busy={busy} className="flex flex-col gap-6">
      <VStack as="header" gap={3}>
        <div>
          <Heading level={1} type="display-2" textWrap="balance">Trends</Heading>
          <Text as="p" type="supporting" display="block" className="mt-1 max-w-2xl">Monthly distinct calls, engaged HCPs and responses in your authorized regions, and which way each region moved against the period before.</Text>
        </div>
        <Stack direction="horizontal" gap={2} vAlign="center" wrap="wrap">
          <ScopeLabel label={data?.scopeLabel} loading={!data} />
          <SegmentedControl label="Period" value={period} onChange={(value) => setPeriod(value as Period)} size="lg">
            {PERIODS.map((p) => <SegmentedControlItem key={p.id} value={p.id} label={p.label} data-testid={`period-${p.id}`} />)}
          </SegmentedControl>
          {data && <DataThroughBadge dataThrough={data.dataThrough} className="ml-auto" />}
          {data && <Text data-testid="trends-range" type="supporting">{formatDay(data.from, true)} to {formatDay(data.to, true)}</Text>}
        </Stack>
        {data && <AccessBanner data={data} />}
      </VStack>

      {query.status === "error" && !data ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : !data ? (
        <PanelLoading testId="trends-loading" height={384} />
      ) : noActivity ? (
        <EmptyState title="No activity in this period">No calls or responses were recorded in your authorized regions between these dates. Try a longer period.</EmptyState>
      ) : (
        <div className={cn("flex flex-col gap-6 transition-opacity", busy && "opacity-70")}>
          <InsightSection
            id="arrows"
            title="Latest period against the period before"
            note={`Each region's last ${data.thresholds.trendDays} days against the ${data.thresholds.trendDays} before. An arrow reports a change in what was recorded, never a cause.`}
          >
            <Card padding={0}><RegionArrows regions={data.regions} minCell={min} /></Card>
          </InsightSection>

          <DashboardGrid>
            <DashboardGridItem area="primary">
              <InsightSection
                id="monthly"
                title="Month by month"
                note="One line per region. A withheld small group is a gap in the line, never a zero. An asterisk marks a partial month."
                meta={
                  <SegmentedControl label="Metric" value={metric} onChange={(value) => setMetric(value as ExecutiveTrendMetric)} size="lg">
                    {EXECUTIVE_TREND_METRICS.map((m) => <SegmentedControlItem key={m} value={m} label={TREND_METRIC_LABEL[m]} data-testid={`metric-${m}`} />)}
                  </SegmentedControl>
                }
              >
                <Card padding={4}>
                  <RegionTrendChart regions={data.regions} metric={metric} label={`${TREND_METRIC_LABEL[metric]} by month for each authorized region`} />
                </Card>
              </InsightSection>
            </DashboardGridItem>
            <DashboardGridItem area="secondary">
              <VStack gap={4}>
                <RuleCard data={data} />
                <SampleLimitations items={data.sampleLimitations} />
              </VStack>
            </DashboardGridItem>
            <DashboardGridItem area="full">
              <InsightSection id="table" title="The same figures as a table" note={`${TREND_METRIC_LABEL[metric]} for each month and region. Engaged HCPs are counted at each level, so they do not add up across months or regions.`}>
                <Card padding={0}><MonthTable regions={data.regions} metric={metric} minCell={min} /></Card>
              </InsightSection>
            </DashboardGridItem>
          </DashboardGrid>
        </div>
      )}
    </div>
  )
}
