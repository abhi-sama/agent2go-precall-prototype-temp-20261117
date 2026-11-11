"use client"

import { BookOpen, CalendarCheck, Layers, MapPinned, Users } from "lucide-react"
import * as React from "react"
import { Card } from "@astryxdesign/core/Card"
import { Grid } from "@astryxdesign/core/Grid"
import { Heading } from "@astryxdesign/core/Heading"
import { Section as AstryxSection } from "@astryxdesign/core/Section"
import { Stack } from "@astryxdesign/core/Stack"
import { Text } from "@astryxdesign/core/Text"
import { KpiCard } from "@/components/landing/kpi-card"
import { EmptyState, ErrorState, KpiSkeleton } from "@/components/state/states"
import { Skeleton } from "@/components/ui/skeleton"
import { useEnter } from "@/hooks/use-enter"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { DateRange, DirectorOverview as Overview } from "@/lib/data/types"
import { useQuery } from "@/lib/data/use-query"
import { useSession } from "@/lib/session/session-provider"
import { cn } from "@/lib/utils"
import { ComparisonPanel } from "./comparison-panel"
import { num, pct } from "./format"
import { MixSection } from "./mix-section"
import { TeamActivity } from "./team-activity"
import { TerritoryTable } from "./territory-table"

const MAX_COMPARE = 6

/**
 * The Director's team and territory overview: KPI cards, a territory table limited to the approved
 * descendant scope, activity by team member, mix, engagement and coverage, and territory comparisons.
 * Every number is computed by the BE under row-level security; this component only lays it out.
 */
export function DirectorOverview({ range }: { range: DateRange }) {
  const adapter = useDataAdapter()
  const { userId, ready } = useSession()
  const query = useQuery("directorOverview", `${userId}:${range.from}:${range.to}`, (ctx) => adapter.directorOverview(ctx, range), ready)
  const [selected, setSelected] = React.useState<string[]>([])

  const toggle = (id: string) =>
    setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : current.length >= MAX_COMPARE ? current : [...current, id]))

  if (query.status === "error") return <ErrorState error={query.error} onRetry={query.refetch} />
  if (query.status === "loading") {
    return (
      <div data-testid="director-loading" aria-busy="true" className="flex flex-col gap-4">
        <Grid columns={{ minWidth: 220, max: 4 }} gap={4}>
          <KpiSkeleton />
          <KpiSkeleton />
          <KpiSkeleton />
          <KpiSkeleton />
        </Grid>
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    )
  }
  const data = query.data
  if (data.kpis.distinctCalls === 0 && data.kpis.responseCount === 0) {
    return (
      <EmptyState title="No team activity in this period">
        No calls were recorded in your territories between these dates. Try a longer period.
      </EmptyState>
    )
  }
  const inScope = new Set(data.territories.map((t) => t.territoryId))
  const chosen = selected.filter((id) => inScope.has(id))

  return (
    <div data-testid="director-overview" className="flex flex-col gap-8">
      <Grid data-testid="overview-kpis" columns={{ minWidth: 220, max: 4 }} gap={4}>
        <KpiCard
          id="members"
          index={0}
          label="Reporting team members"
          value={data.kpis.reportingMembers}
          definition="Team members with at least one recorded call in this period."
          icon={Users}
          tone="ink"
        />
        <KpiCard
          id="territories"
          index={1}
          label="Territories reporting"
          value={data.kpis.territoriesWithActivity}
          definition={`Of ${data.kpis.territoriesInScope} territories in your approved scope.`}
          icon={MapPinned}
          tone="teal"
        />
        <StatCard
          id="completeness"
          index={2}
          label="Reporting completeness"
          value={pct(data.kpis.reportingCompleteness)}
          definition="Months with a recorded call over months the data has reached. It describes reporting, not performance."
          icon={CalendarCheck}
        />
        <KpiCard
          id="rows"
          index={3}
          label="Call-product rows"
          value={data.kpis.callProductRows}
          definition={`Source rows, one per product discussed. Not calls: the ${num(data.kpis.distinctCalls)} distinct calls above are the call count.`}
          icon={Layers}
          tone="orange"
        />
      </Grid>

      <Section id="territories" title="Territories" note="Only territories in your approved scope. Select two to six to compare them.">
        <TerritoryTable rows={data.territories} selected={chosen} onToggle={toggle} max={MAX_COMPARE} />
      </Section>

      <Section
        id="team"
        title="Activity by team member"
        note="Distinct calls per member per month. A hatched 0 is a month with no recorded call. An asterisk marks a partial month."
      >
        <TeamActivity overview={data} />
      </Section>

      <Section id="mix" title="Channel, topic and product mix" note="Distinct calls by value. Product counts are mentions, labelled apart from distinct calls.">
        <MixSection overview={data} />
      </Section>

      <Section id="engagement" title="Engagement and coverage" note="Distinct engaged HCPs, and coverage only where an approved target population exists.">
        <Engagement overview={data} />
      </Section>

      <Section id="compare" title="Compare territories" note="One period and one set of definitions for every territory.">
        <ComparisonPanel ids={chosen} range={{ from: data.from, to: data.to }} />
      </Section>

      <Section id="definitions" title="How these numbers are counted" note={`Definitions ${data.definitionVersion}. Counts are computed in the database, never by AI.`}>
        <dl data-testid="definitions" className="grid gap-x-8 gap-y-3 text-sm md:grid-cols-2">
          {data.definitions.map((d) => (
            <div key={d.key}>
              <dt className="font-semibold">{d.label}</dt>
              <dd className="text-muted-foreground">{d.text}</dd>
            </div>
          ))}
        </dl>
        {data.notes.length > 0 && (
          <ul data-testid="overview-notes" className="mt-4 flex list-disc flex-col gap-1 pl-5 text-xs text-muted-foreground">
            {data.notes.map((n) => (
              <li key={n.code} data-code={n.code}>{n.message}</li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}

function Engagement({ overview }: { overview: Overview }) {
  const { coverage, kpis } = overview
  return (
    <Grid columns={{ minWidth: 320, max: 2 }} gap={4}>
      <Card data-testid="engaged-hcps" padding={4}>
        <Heading level={3} color="secondary">Distinct engaged HCPs</Heading>
        <Text type="display-2" weight="semibold" hasTabularNumbers display="block" className="mt-2" data-value={kpis.distinctEngagedHcps}>{num(kpis.distinctEngagedHcps)}</Text>
        <Text as="p" type="supporting" display="block" className="mt-2">Each HCP counted once across the whole scope, even when several territories reached them.</Text>
      </Card>
      {coverage.status === "AVAILABLE" ? (
        <Card data-testid="coverage-available" padding={4}>
          <Heading level={3} color="secondary">Coverage of the target population</Heading>
          <Text data-testid="coverage-value" type="display-2" weight="semibold" hasTabularNumbers display="block" className="mt-2">{coverage.percentage}%</Text>
          <Text as="p" type="supporting" display="block" className="mt-2">
            {num(coverage.engagedTargetHcps ?? 0)} of {num(coverage.targetHcps ?? 0)} approved target HCPs engaged in this period, as of {coverage.asOf}.
            {coverage.territoriesWithTargets < coverage.territoriesInScope &&
              ` Covers ${coverage.territoriesWithTargets} of ${coverage.territoriesInScope} territories; the rest have no approved target population.`}
          </Text>
        </Card>
      ) : (
        <Card data-testid="coverage-withheld" padding={4} variant="muted">
          <Heading level={3} color="secondary"><BookOpen className="mr-2 inline size-4" aria-hidden /> Coverage is not shown</Heading>
          <Text as="p" display="block" className="mt-2">
            There is no approved target population for this scope, so a coverage percentage cannot be calculated. Engaged HCPs are not a substitute for a target list.
          </Text>
        </Card>
      )}
    </Grid>
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

function StatCard({ id, label, value, definition, icon: Icon, index = 0 }: { id: string; label: string; value: string; definition: string; icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>; index?: number }) {
  const enter = useEnter(`kpi-${id}`, index)
  return (
    <Card data-testid={`kpi-${id}`} padding={4} elevation="low" style={enter.style} className={cn("relative overflow-hidden", enter.className)}>
      <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-warning" />
      <Stack direction="horizontal" hAlign="between" vAlign="start" gap={3}>
        <Heading level={3} color="secondary">{label}</Heading>
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-warning/15">
          <Icon className="size-5" aria-hidden />
        </span>
      </Stack>
      <Text data-testid={`kpi-${id}-value`} type="display-1" weight="semibold" hasTabularNumbers display="block" className="mt-3">{value}</Text>
      <Text as="p" type="supporting" display="block" className="mt-3">{definition}</Text>
    </Card>
  )
}
