"use client"

import { CalendarCheck, Layers, MessagesSquare, Stethoscope, Users } from "lucide-react"
import * as React from "react"
import { Banner } from "@astryxdesign/core/Banner"
import { Card } from "@astryxdesign/core/Card"
import { Grid } from "@astryxdesign/core/Grid"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { List, ListItem } from "@astryxdesign/core/List"
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList"
import { Section as AstryxSection } from "@astryxdesign/core/Section"
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl"
import { Selector } from "@astryxdesign/core/Selector"
import { Skeleton } from "@astryxdesign/core/Skeleton"
import { Stack } from "@astryxdesign/core/Stack"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import { DataThroughBadge } from "@/components/landing/data-through-badge"
import { EmptyState, ErrorState, KpiSkeleton } from "@/components/state/states"
import { useEnter } from "@/hooks/use-enter"
import { useDataAdapter } from "@/lib/data/data-provider"
import { EXECUTIVE_RANK_BY, type ExecutiveOverview as Overview, type ExecutiveRankBy, type ExecutiveUnit } from "@/lib/data/types"
import { useQuery } from "@/lib/data/use-query"
import { addMonths, formatDay } from "@/lib/dates"
import { useSession } from "@/lib/session/session-provider"
import { cn } from "@/lib/utils"
import { CountValue, percent } from "./count"
import { RANK_LABEL, RankedUnits } from "./ranked-units"
import { RecordDrilldown, type DrillTarget } from "./record-drilldown"
import { TrendColumns } from "./trend-columns"

const PERIODS = [
  { id: "6", label: "6 months", months: 6 },
  { id: "12", label: "12 months", months: 12 },
  { id: "24", label: "24 months", months: 24 },
] as const

/**
 * The Executive's aggregate-only enterprise overview. Scope comes from explicit executive assignments (the BE
 * decides); every figure is a count the BE computed, with small groups withheld. Nothing identifiable is
 * requested unless the viewer holds record-level permission, and then only through the drill-down sheet.
 */
export function ExecutiveOverview() {
  const adapter = useDataAdapter()
  const { userId, ready } = useSession()
  const [period, setPeriod] = React.useState<(typeof PERIODS)[number]["id"]>("12")
  const [rankBy, setRankBy] = React.useState<ExecutiveRankBy>("CALLS")
  const [drill, setDrill] = React.useState<DrillTarget | null>(null)
  const query = useQuery("executiveOverview", `${userId}:${period}:${rankBy}`, (ctx) => adapter.executiveOverview(ctx, { rankBy, ...windowFor(period) }), ready)
  // Keep the previous overview on screen while a new period or ranking loads, but never across people.
  const [kept, setKept] = React.useState<{ userId: string; data: Overview } | null>(null)
  if (query.status === "success" && kept?.data !== query.data) setKept({ userId, data: query.data })
  const data = kept?.userId === userId ? kept.data : null

  if (query.status === "error" && !data) return <ErrorState error={query.error} onRetry={query.refetch} />
  if (!data) {
    return (
      <VStack data-testid="executive-loading" aria-busy="true" gap={4}>
        <Grid columns={{ minWidth: 220, max: 4 }} gap={4}>
          <KpiSkeleton />
          <KpiSkeleton />
          <KpiSkeleton />
          <KpiSkeleton />
        </Grid>
        <Skeleton width="100%" height="16rem" radius={4} />
      </VStack>
    )
  }
  const min = data.disclosure.minCell
  const noActivity = data.kpis.calls.value === 0 && data.kpis.responses.value === 0
  const busy = query.status === "loading"

  return (
    <VStack data-testid="executive-overview" aria-busy={busy} gap={8} className={cn("transition-opacity", busy && "opacity-70")}>
      <Stack direction="horizontal" gap={2} vAlign="center" wrap="wrap">
        <SegmentedControl label="Period" value={period} onChange={(value) => setPeriod(value as (typeof PERIODS)[number]["id"])} size="lg">
          {PERIODS.map((p) => <SegmentedControlItem key={p.id} value={p.id} label={p.label} data-testid={`period-${p.id}`} />)}
        </SegmentedControl>
        <Selector
          data-testid="rank-by"
          label="Rank by"
          value={rankBy}
          onChange={(value) => setRankBy(value as ExecutiveRankBy)}
          options={EXECUTIVE_RANK_BY.map((rank) => ({ value: rank, label: RANK_LABEL[rank] }))}
          variant="secondary"
          presentation="adaptive"
        />
        <DataThroughBadge dataThrough={data.dataThrough} className="ml-auto" />
        <Text data-testid="exec-range" type="supporting">{formatDay(data.from, true)} to {formatDay(data.to, true)}</Text>
      </Stack>

      <AccessBanner data={data} />

      {noActivity ? (
        <EmptyState title="No activity in this period">No calls or responses were recorded in your authorized regions between these dates. Try a longer period.</EmptyState>
      ) : (
        <>
          <Grid data-testid="exec-kpis" columns={{ minWidth: 220, max: 4 }} gap={4}>
            <Kpi id="calls" index={0} label="Distinct calls" icon={Stethoscope} count={data.kpis.calls} min={min} note="Each call counted once, however many products it covers." />
            <Kpi id="hcps" index={1} label="Engaged HCPs" icon={Users} count={data.kpis.engagedHcps} min={min} note={data.engagement.callsPerEngagedHcp !== null ? `${data.engagement.callsPerEngagedHcp.toFixed(2)} calls per engaged HCP` : "HCPs reached at least once, counted once."} />
            <Kpi id="responses" index={2} label="Responses" icon={MessagesSquare} count={data.kpis.responses} min={min} note="Insight responses recorded in the period." />
            <CompletenessCard value={data.kpis.reportingCompleteness} />
          </Grid>

          <Section id="trends" title="Monthly trends" note="Distinct calls, responses and engaged HCPs per month across your authorized regions.">
            <Freshness data={data} />
            <TrendColumns months={data.months} minCell={min} />
          </Section>

          <Section id="regions" title="Regional comparison" note={`Ranked by ${RANK_LABEL[data.rankBy].toLowerCase()}. One period and one set of definitions for every region and territory.`}>
            <Grid columns={{ minWidth: 360, max: 2 }} gap={4}>
              <RankedUnits id="regions" title={`Regions (${data.regions.length})`} units={data.regions} rankBy={data.rankBy} minCell={min} onDrill={data.drilldownAllowed ? (u) => setDrill(target(u)) : undefined} />
              <RankedUnits id="territories" title={`Territories (${data.territories.length})`} units={data.territories} rankBy={data.rankBy} minCell={min} onDrill={data.drilldownAllowed ? (u) => setDrill(target(u)) : undefined} />
            </Grid>
          </Section>

          <Section id="engagement" title="Engagement patterns" note="How many HCPs were reached how often, and through which channel. Counts of HCPs only, never who they are.">
            <Engagement data={data} />
          </Section>
        </>
      )}

      <Section id="definitions" title="How these numbers are counted" note={`Definitions ${data.definitionVersion}. Counts are computed in the database, never by AI.`}>
        <MetadataList data-testid="definitions" columns="multi">
          {data.definitions.map((d) => (
            <MetadataListItem key={d.key} label={d.label}>{d.text}</MetadataListItem>
          ))}
        </MetadataList>
        {data.notes.length > 0 && (
          <List data-testid="overview-notes" listStyle="disc" density="compact" className="mt-4">
            {data.notes.map((n) => (
              <ListItem key={n.code} data-code={n.code} label={n.message} />
            ))}
          </List>
        )}
      </Section>

      <RecordDrilldown target={drill} months={data.months} onClose={() => setDrill(null)} />
    </VStack>
  )
}

function windowFor(period: string): { from: string; to?: string } | Record<string, never> {
  // The BE defaults to twelve months ending at data-through; a shorter or longer period only moves the start.
  if (period === "12") return {}
  const months = Number(period)
  const today = new Date().toISOString().slice(0, 10)
  return { from: addMonths(`${today.slice(0, 7)}-01`, -(months - 1)) }
}

const target = (u: ExecutiveUnit): DrillTarget => ({ scopeId: u.id, label: u.name })

function AccessBanner({ data }: { data: Overview }) {
  if (data.accessLevel === "RECORD_DRILLDOWN") {
    return (
      <Banner data-testid="access-banner" data-level="RECORD_DRILLDOWN" status="success" title="Record-level access" description="You hold record-level permission, so small groups are not withheld and each region or territory opens its supporting records." />
    )
  }
  return (
    <Banner data-testid="access-banner" data-level="AGGREGATE_ONLY" status="info" title="Aggregate-only access" description={<span data-testid="disclosure-text">
        Aggregate-only view for {data.scopeLabel}. {data.disclosure.text} Individual records are not available to your role.
        {data.disclosure.suppressedCells > 0 && <strong data-testid="suppressed-cells" className="ml-1 text-foreground">{data.disclosure.suppressedCells} values withheld in this view.</strong>}
      </span>} />
  )
}

function Freshness({ data }: { data: Overview }) {
  const f = data.freshness
  return (
    <Text as="p" type="supporting" data-testid="freshness" data-status={f.status} className="mb-3">
      {f.monthsShown} months shown.{" "}
      {f.status === "PARTIAL" ? "The period runs past the latest load, so later months are left out rather than shown as zero." : f.status === "NO_DATA" ? "No data has been loaded yet." : "Every month in the period has been loaded."}
      {f.sourceLagDays ? ` Calls and responses were loaded ${f.sourceLagDays} days apart.` : ""}
    </Text>
  )
}

function Engagement({ data }: { data: Overview }) {
  const min = data.disclosure.minCell
  const { engagement } = data
  const maxBand = Math.max(1, ...engagement.depth.map((d) => d.hcps.value ?? 0))
  const maxChannel = Math.max(1, ...engagement.channels.map((c) => c.calls.value ?? 0))
  return (
    <Grid columns={{ minWidth: 320, max: 2 }} gap={4}>
      <Card data-testid="depth" padding={4}>
        <Heading level={3} color="secondary">HCPs by number of calls received</Heading>
        <ul className="mt-3 flex flex-col gap-2">
          {engagement.depth.map((d) => (
            <li key={d.band} data-testid="depth-row" className="grid grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-3 text-sm">
              <span>{d.band}</span>
              <span className="h-4 rounded bg-muted/50" aria-hidden>{d.hcps.value !== null && <span className="block h-full rounded bg-chart-2" style={{ width: `${Math.max(1.5, (100 * d.hcps.value) / maxBand)}%` }} />}</span>
              <CountValue count={d.hcps} minCell={min} className="font-semibold" />
            </li>
          ))}
        </ul>
      </Card>
      <Card data-testid="channels" padding={4}>
        <Heading level={3} color="secondary">Calls by channel</Heading>
        <ul className="mt-3 flex flex-col gap-2">
          {engagement.channels.map((c) => (
            <li key={c.channel} className="grid grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-3 text-sm">
              <span className="truncate capitalize">{c.channel.replace(/_/g, " ")}</span>
              <span className="h-4 rounded bg-muted/50" aria-hidden>{c.calls.value !== null && <span className="block h-full rounded bg-chart-3" style={{ width: `${Math.max(1.5, (100 * c.calls.value) / maxChannel)}%` }} />}</span>
              <CountValue count={c.calls} minCell={min} className="font-semibold" />
            </li>
          ))}
        </ul>
      </Card>
      {engagement.coverage.status === "AVAILABLE" ? (
        <Card data-testid="coverage-available" padding={4}>
          <Heading level={3} color="secondary">Coverage of the target population</Heading>
          <Text data-testid="coverage-value" type="display-2" weight="semibold" hasTabularNumbers display="block" className="mt-2">{engagement.coverage.percentage}%</Text>
          <Text as="p" type="supporting" display="block" className="mt-2">Engaged target HCPs over the approved target population, for {engagement.coverage.territoriesWithTargets} of {engagement.coverage.territoriesInScope} territories.</Text>
        </Card>
      ) : (
        <Card data-testid="coverage-withheld" padding={4} variant="muted">
          <Heading level={3} color="secondary"><Icon icon={Layers} size="sm" className="mr-2 inline" /> Coverage is not shown</Heading>
          <Text as="p" display="block" className="mt-2">
            {engagement.coverage.status === "SUPPRESSED" ? "The target population is too small to show without identifying individuals." : "There is no approved target population for this scope, so a coverage percentage cannot be calculated. Engaged HCPs are not a substitute for a target list."}
          </Text>
        </Card>
      )}
    </Grid>
  )
}

function Kpi({ id, label, icon, count, min, note, index = 0 }: { id: string; label: string; icon: React.ComponentType<React.SVGProps<SVGSVGElement>>; count: Overview["kpis"]["calls"]; min: number; note: string; index?: number }) {
  const enter = useEnter(`exec-kpi-${id}`, index)
  return (
    <Card data-testid={`exec-kpi-${id}`} padding={4} elevation="low" style={enter.style} className={cn("relative overflow-hidden", enter.className)}>
      <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-primary" />
      <HStack justify="between" align="start" gap={3}>
        <Heading level={3} color="secondary">{label}</Heading>
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/12 text-accent-text"><Icon icon={icon} size="md" /></span>
      </HStack>
      <Text type="display-1" weight="semibold" hasTabularNumbers display="block" className="mt-3"><CountValue testId={`exec-kpi-${id}-value`} count={count} minCell={min} countUp={`exec-${id}`} /></Text>
      <Text as="p" type="supporting" display="block" className="mt-3">{note}</Text>
    </Card>
  )
}

function CompletenessCard({ value }: { value: number | null }) {
  const enter = useEnter("exec-kpi-completeness", 3)
  return (
    <Card data-testid="exec-kpi-completeness" padding={4} elevation="low" style={enter.style} className={cn("relative overflow-hidden", enter.className)}>
      <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-warning" />
      <HStack justify="between" align="start" gap={3}>
        <Heading level={3} color="secondary">Reporting completeness</Heading>
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-warning/15"><Icon icon={CalendarCheck} size="md" /></span>
      </HStack>
      <Text data-testid="exec-kpi-completeness-value" type="display-1" weight="semibold" hasTabularNumbers display="block" className="mt-3">{percent(value)}</Text>
      <Text as="p" type="supporting" display="block" className="mt-3">Territory-months with a recorded call. It describes reporting, not performance.</Text>
    </Card>
  )
}

function Section({ id, title, note, children }: { id: string; title: string; note: string; children: React.ReactNode }) {
  return (
    <AstryxSection data-testid={`section-${id}`} aria-labelledby={`section-${id}-title`} variant="transparent" padding={0}>
      <Heading id={`section-${id}-title`} level={2}>{title}</Heading>
      <Text as="p" type="supporting" display="block" className="mb-3 mt-1 max-w-3xl">{note}</Text>
      {children}
    </AstryxSection>
  )
}

