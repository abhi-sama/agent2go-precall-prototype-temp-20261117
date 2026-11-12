"use client"

import { Banner } from "@astryxdesign/core/Banner"
import { Button } from "@astryxdesign/core/Button"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Skeleton } from "@astryxdesign/core/Skeleton"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import { MessagesSquare, Stethoscope, Users } from "lucide-react"
import * as React from "react"
import { AnalyticsFilterBar, QuestionDiscovery, ResponseDistributions } from "@/components/filters/insight-discovery"
import { QualitativeInsights } from "@/components/insights/qualitative-insights"
import { useSharedFilters } from "@/components/filters/filter-context"
import { DataThroughBadge } from "@/components/landing/data-through-badge"
import { ParallaxScene, SceneLayers } from "@/components/motion/parallax-scene"
import { KpiCard } from "@/components/landing/kpi-card"
import { DashboardGrid, DashboardGridItem } from "@/components/layout/dashboard-grid"
import { ScopeLabel } from "@/components/shell/scope-label"
import { EmptyState, ErrorState, KpiSkeleton } from "@/components/state/states"
import { TerritoryMap } from "@/components/map/territory-map"
import { useDataAdapter } from "@/lib/data/data-provider"
import { useQuery } from "@/lib/data/use-query"
import type { DateRange, GeoActivity } from "@/lib/data/types"
import { formatRange, presetRange } from "@/lib/dates"
import { useSession } from "@/lib/session/session-provider"

const DEFAULT_PRESET = "30d" as const

/** Heading, scope, freshness, filters, KPI cards and (optionally) the territory map for one persona. */
export function LandingSection({
  title,
  description,
  showMap = true,
  supporting,
  children,
}: {
  title: string
  description: string
  showMap?: boolean
  /** Optional supporting pane for a dashboard's primary visual; used by the MSL workspace for fast HCP lookup. */
  supporting?: React.ReactNode
  /** Persona-specific sections rendered after the headline KPIs, given the active date range. */
  children?: (context: { range: DateRange }) => React.ReactNode
}) {
  const adapter = useDataAdapter()
  const { userId, ready, user } = useSession()
  const { filters, setFilters } = useSharedFilters()
  const defaultRange = React.useMemo(() => presetRange(DEFAULT_PRESET), [])
  const range: DateRange = { from: filters.from ?? defaultRange.from, to: filters.to ?? defaultRange.to }

  const key = `${userId}:${JSON.stringify(filters)}`
  const kpis = useQuery("landingKpis", key, (ctx) => adapter.landingKpis(ctx, range, filters), ready)
  const geoQuery = useQuery("geoActivity", key, (ctx) => adapter.geoActivity(ctx, range, filters), ready && showMap)
  // Keep the last map while a new range loads, so a drill-down is not lost; never across people.
  const [kept, setKept] = React.useState<{ userId: string; data: GeoActivity } | null>(null)
  if (geoQuery.status === "success" && kept?.data !== geoQuery.data) setKept({ userId, data: geoQuery.data })
  const geo = kept?.userId === userId ? kept.data : null
  const discovery = useQuery("insightDiscovery", key, (ctx) => adapter.insightDiscovery(ctx, filters), ready)

  const loading = kpis.status === "loading"
  // Catalog options and distributions are record-level reads: an aggregate-only role is refused them by design.
  const discoveryForbidden = discovery.status === "error" && discovery.error.code === "FORBIDDEN"
  const allZero = kpis.status === "success" && kpis.data.distinctCalls === 0 && kpis.data.distinctEngagedHcps === 0 && kpis.data.responseCount === 0
  // An aggregate-only viewer has no record-level KPIs but does have a scoped map.
  const aggregateOnly = kpis.status === "error" && kpis.error.code === "FORBIDDEN" && geo !== null
  const scopeLabel =
    kpis.status === "success" ? kpis.data.scopeLabel : aggregateOnly ? geo.scopeLabel : kpis.status === "error" && kpis.error.code === "FORBIDDEN" ? "No access" : undefined

  return (
    <div className="flex flex-col gap-6">
      <ParallaxScene as="header" layers={<SceneLayers />} className="flex flex-col gap-3" stageClassName="inset-x-0">
        <VStack gap={1}>
          <Heading level={1} type="display-3">{title}</Heading>
          <Text as="p" type="large" color="secondary" display="block" className="max-w-2xl">{description}</Text>
        </VStack>
        <HStack gap={2} align="center" wrap="wrap">
          <ScopeLabel label={scopeLabel} loading={loading || (kpis.status === "error" && !aggregateOnly)} />
          {kpis.status === "success" && <DataThroughBadge dataThrough={kpis.data.dataThrough} />}
          {aggregateOnly && <DataThroughBadge dataThrough={geo.dataThrough} />}
          <Text type="supporting" data-testid="range-label">
            {formatRange(range)}
          </Text>
        </HStack>
      </ParallaxScene>

      <AnalyticsFilterBar discovery={discovery.status === "success" ? discovery.data : undefined} loading={loading || discovery.status === "loading"} unavailable={discoveryForbidden} />

      {aggregateOnly ? (
        <Banner
          data-testid="aggregate-only-note"
          status="info"
          title="Record-level totals are not shown to this role."
          description="The map shows aggregate counts for your scope only."
          collapsible={false}
        />
      ) : kpis.status === "error" ? (
        <ErrorState error={kpis.error} onRetry={kpis.refetch} />
      ) : allZero ? (
        <EmptyState
          actions={
            <Button variant="secondary" label="Show 90 days" onClick={() => setFilters((current) => ({ ...current, ...presetRange("90d") }))} />
          }
        />
      ) : (
        <div
          data-testid="kpi-grid"
          className="scroll-snap-x -mx-4 grid auto-cols-[minmax(15rem,82%)] grid-flow-col gap-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:auto-cols-auto sm:grid-flow-row sm:grid-cols-3 sm:overflow-visible sm:px-0"
        >
          {kpis.status === "success" ? (
            <>
              <KpiCard
                id="calls"
                index={0}
                label="Distinct calls"
                value={kpis.data.distinctCalls}
                definition="Each call counted once, however many rows it has."
                icon={Stethoscope}
                tone="orange"
              />
              <KpiCard
                id="hcps"
                index={1}
                label="Distinct engaged HCPs"
                value={kpis.data.distinctEngagedHcps}
                definition="Healthcare professionals reached at least once."
                caption={kpis.data.distinctEngagedHcps > 0 ? `${(kpis.data.distinctCalls / kpis.data.distinctEngagedHcps).toFixed(1)} calls per HCP` : undefined}
                icon={Users}
                tone="ink"
              />
              <KpiCard
                id="responses"
                index={2}
                label="Responses"
                value={kpis.data.responseCount}
                definition="Insight responses captured from those calls."
                caption={kpis.data.distinctCalls > 0 ? `${(kpis.data.responseCount / kpis.data.distinctCalls).toFixed(1)} per call` : undefined}
                icon={MessagesSquare}
                tone="teal"
              />
            </>
          ) : (
            <>
              <KpiSkeleton />
              <KpiSkeleton />
              <KpiSkeleton />
            </>
          )}
        </div>
      )}

      {showMap &&
        <DashboardGrid>
          <DashboardGridItem area={supporting ? "focus" : "full"}>
            {geo ? (
              <div aria-busy={geoQuery.status === "loading"} className={geoQuery.status === "loading" ? "opacity-70 transition-opacity" : "transition-opacity"}>
                <TerritoryMap activity={geo} persona={user.persona} />
              </div>
            ) : geoQuery.status === "error" ? (
              <ErrorState error={geoQuery.error} onRetry={geoQuery.refetch} />
            ) : (
              <Skeleton data-testid="territory-loading" aria-busy="true" height={352} radius={4} />
            )}
          </DashboardGridItem>
          {supporting && <DashboardGridItem area="detail">{supporting}</DashboardGridItem>}
        </DashboardGrid>}

      {children?.({ range })}

      {discovery.status === "error" ? (aggregateOnly && discoveryForbidden ? null : <ErrorState error={discovery.error} onRetry={discovery.refetch} />) : discovery.status === "success" && (
        <DashboardGrid>
          <DashboardGridItem area="primary"><ResponseDistributions discovery={discovery.data} /></DashboardGridItem>
          <DashboardGridItem area="secondary"><QualitativeInsights discovery={discovery.data} /></DashboardGridItem>
          <DashboardGridItem area="full"><QuestionDiscovery discovery={discovery.data} /></DashboardGridItem>
        </DashboardGrid>
      )}
    </div>
  )
}
