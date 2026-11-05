"use client"

import { MessagesSquare, Stethoscope, Users } from "lucide-react"
import * as React from "react"
import { AnalyticsFilterBar, QuestionDiscovery, ResponseDistributions } from "@/components/filters/insight-discovery"
import { QualitativeInsights } from "@/components/insights/qualitative-insights"
import { useSharedFilters } from "@/components/filters/filter-context"
import { DataThroughBadge } from "@/components/landing/data-through-badge"
import { ParallaxScene, SceneLayers } from "@/components/motion/parallax-scene"
import { KpiCard } from "@/components/landing/kpi-card"
import { ScopeLabel } from "@/components/shell/scope-label"
import { EmptyState, ErrorState, KpiSkeleton } from "@/components/state/states"
import { TerritoryMap } from "@/components/map/territory-map"
import { Button } from "@/components/ui/button"
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
  children,
}: {
  title: string
  description: string
  showMap?: boolean
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
      <ParallaxScene as="header" layers={<SceneLayers />} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
            <p className="mt-1 max-w-2xl text-muted-foreground">{description}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ScopeLabel label={scopeLabel} loading={loading || (kpis.status === "error" && !aggregateOnly)} />
          {kpis.status === "success" && <DataThroughBadge dataThrough={kpis.data.dataThrough} />}
          {aggregateOnly && <DataThroughBadge dataThrough={geo.dataThrough} />}
          <span className="text-sm text-muted-foreground" data-testid="range-label">
            {formatRange(range)}
          </span>
        </div>
      </ParallaxScene>

      <AnalyticsFilterBar discovery={discovery.status === "success" ? discovery.data : undefined} loading={loading || discovery.status === "loading"} unavailable={discoveryForbidden} />

      {showMap &&
        (geo ? (
          <div aria-busy={geoQuery.status === "loading"} className={geoQuery.status === "loading" ? "opacity-70 transition-opacity" : "transition-opacity"}>
            <TerritoryMap activity={geo} persona={user.persona} />
          </div>
        ) : geoQuery.status === "error" ? (
          <ErrorState error={geoQuery.error} onRetry={geoQuery.refetch} />
        ) : (
          <div data-testid="territory-loading" aria-busy="true" className="h-[22rem] animate-pulse rounded-2xl border bg-muted/60" />
        ))}

      {aggregateOnly ? (
        <p data-testid="aggregate-only-note" className="rounded-2xl border border-dashed bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Record-level totals are not shown to this role. The map above shows aggregate counts for your scope only.
        </p>
      ) : kpis.status === "error" ? (
        <ErrorState error={kpis.error} onRetry={kpis.refetch} />
      ) : allZero ? (
        <EmptyState
          actions={
            <Button variant="outline" onClick={() => setFilters((current) => ({ ...current, ...presetRange("90d") }))}>
              Show 90 days
            </Button>
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

      {children?.({ range })}

      {discovery.status === "error" ? (aggregateOnly && discoveryForbidden ? null : <ErrorState error={discovery.error} onRetry={discovery.refetch} />) : discovery.status === "success" && (
        <div className="flex flex-col gap-10">
          <ResponseDistributions discovery={discovery.data} />
          <QualitativeInsights discovery={discovery.data} />
          <QuestionDiscovery discovery={discovery.data} />
        </div>
      )}
    </div>
  )
}
