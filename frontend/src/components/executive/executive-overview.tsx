"use client"

import { CalendarCheck, EyeOff, Layers, MessagesSquare, ShieldCheck, Stethoscope, Users } from "lucide-react"
import * as React from "react"
import { DataThroughBadge } from "@/components/landing/data-through-badge"
import { EmptyState, ErrorState, KpiSkeleton } from "@/components/state/states"
import { Skeleton } from "@/components/ui/skeleton"
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
      <div data-testid="executive-loading" aria-busy="true" className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiSkeleton />
          <KpiSkeleton />
          <KpiSkeleton />
          <KpiSkeleton />
        </div>
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    )
  }
  const min = data.disclosure.minCell
  const noActivity = data.kpis.calls.value === 0 && data.kpis.responses.value === 0
  const busy = query.status === "loading"

  return (
    <div data-testid="executive-overview" aria-busy={busy} className={cn("flex flex-col gap-8 transition-opacity", busy && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Period" className="flex gap-1 rounded-xl border bg-muted/40 p-1">
          {PERIODS.map((p) => (
            <button key={p.id} type="button" data-testid={`period-${p.id}`} aria-pressed={period === p.id} onClick={() => setPeriod(p.id)} className={cn("min-h-11 rounded-lg px-3.5 text-sm font-medium", period === p.id ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {p.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Rank by
          <select data-testid="rank-by" value={rankBy} onChange={(e) => setRankBy(e.target.value as ExecutiveRankBy)} className="h-11 rounded-lg border bg-background px-3 text-sm text-foreground">
            {EXECUTIVE_RANK_BY.map((r) => (
              <option key={r} value={r}>{RANK_LABEL[r]}</option>
            ))}
          </select>
        </label>
        <DataThroughBadge dataThrough={data.dataThrough} className="ml-auto" />
        <span data-testid="exec-range" className="text-sm text-muted-foreground">{formatDay(data.from, true)} to {formatDay(data.to, true)}</span>
      </div>

      <AccessBanner data={data} />

      {noActivity ? (
        <EmptyState title="No activity in this period">No calls or responses were recorded in your authorized regions between these dates. Try a longer period.</EmptyState>
      ) : (
        <>
          <div data-testid="exec-kpis" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi id="calls" label="Distinct calls" icon={Stethoscope} count={data.kpis.calls} min={min} note="Each call counted once, however many products it covers." />
            <Kpi id="hcps" label="Engaged HCPs" icon={Users} count={data.kpis.engagedHcps} min={min} note={data.engagement.callsPerEngagedHcp !== null ? `${data.engagement.callsPerEngagedHcp.toFixed(2)} calls per engaged HCP` : "HCPs reached at least once, counted once."} />
            <Kpi id="responses" label="Responses" icon={MessagesSquare} count={data.kpis.responses} min={min} note="Insight responses recorded in the period." />
            <article data-testid="exec-kpi-completeness" className="relative overflow-hidden rounded-2xl border bg-card p-5 shadow-card">
              <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-warning" />
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-sm font-semibold text-muted-foreground">Reporting completeness</h3>
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-warning/15"><CalendarCheck className="size-5" aria-hidden /></span>
              </div>
              <p data-testid="exec-kpi-completeness-value" className="mt-3 text-5xl font-semibold tracking-tight tabular-nums">{percent(data.kpis.reportingCompleteness)}</p>
              <p className="mt-3 text-sm text-muted-foreground">Territory-months with a recorded call. It describes reporting, not performance.</p>
            </article>
          </div>

          <Section id="trends" title="Monthly trends" note="Distinct calls, responses and engaged HCPs per month across your authorized regions.">
            <Freshness data={data} />
            <TrendColumns months={data.months} minCell={min} />
          </Section>

          <Section id="regions" title="Regional comparison" note={`Ranked by ${RANK_LABEL[data.rankBy].toLowerCase()}. One period and one set of definitions for every region and territory.`}>
            <div className="grid gap-4 xl:grid-cols-2">
              <RankedUnits id="regions" title={`Regions (${data.regions.length})`} units={data.regions} rankBy={data.rankBy} minCell={min} onDrill={data.drilldownAllowed ? (u) => setDrill(target(u)) : undefined} />
              <RankedUnits id="territories" title={`Territories (${data.territories.length})`} units={data.territories} rankBy={data.rankBy} minCell={min} onDrill={data.drilldownAllowed ? (u) => setDrill(target(u)) : undefined} />
            </div>
          </Section>

          <Section id="engagement" title="Engagement patterns" note="How many HCPs were reached how often, and through which channel. Counts of HCPs only, never who they are.">
            <Engagement data={data} />
          </Section>
        </>
      )}

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

      <RecordDrilldown target={drill} months={data.months} onClose={() => setDrill(null)} />
    </div>
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
      <p data-testid="access-banner" data-level="RECORD_DRILLDOWN" className="flex items-start gap-2 rounded-2xl border border-fact/30 bg-fact-soft px-4 py-3 text-sm">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>You hold record-level permission, so small groups are not withheld and each region or territory opens its supporting records.</span>
      </p>
    )
  }
  return (
    <p data-testid="access-banner" data-level="AGGREGATE_ONLY" className="flex items-start gap-2 rounded-2xl border border-dashed bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
      <EyeOff className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span data-testid="disclosure-text">
        Aggregate-only view for {data.scopeLabel}. {data.disclosure.text} Individual records are not available to your role.
        {data.disclosure.suppressedCells > 0 && <strong data-testid="suppressed-cells" className="ml-1 text-foreground">{data.disclosure.suppressedCells} values withheld in this view.</strong>}
      </span>
    </p>
  )
}

function Freshness({ data }: { data: Overview }) {
  const f = data.freshness
  return (
    <p data-testid="freshness" data-status={f.status} className="mb-3 text-sm text-muted-foreground">
      {f.monthsShown} months shown.{" "}
      {f.status === "PARTIAL" ? "The period runs past the latest load, so later months are left out rather than shown as zero." : f.status === "NO_DATA" ? "No data has been loaded yet." : "Every month in the period has been loaded."}
      {f.sourceLagDays ? ` Calls and responses were loaded ${f.sourceLagDays} days apart.` : ""}
    </p>
  )
}

function Engagement({ data }: { data: Overview }) {
  const min = data.disclosure.minCell
  const { engagement } = data
  const maxBand = Math.max(1, ...engagement.depth.map((d) => d.hcps.value ?? 0))
  const maxChannel = Math.max(1, ...engagement.channels.map((c) => c.calls.value ?? 0))
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <article data-testid="depth" className="rounded-2xl border bg-card p-5">
        <h3 className="text-sm font-semibold text-muted-foreground">HCPs by number of calls received</h3>
        <ul className="mt-3 flex flex-col gap-2">
          {engagement.depth.map((d) => (
            <li key={d.band} data-testid="depth-row" className="grid grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-3 text-sm">
              <span>{d.band}</span>
              <span className="h-4 rounded bg-muted/50" aria-hidden>{d.hcps.value !== null && <span className="block h-full rounded bg-chart-2" style={{ width: `${Math.max(1.5, (100 * d.hcps.value) / maxBand)}%` }} />}</span>
              <CountValue count={d.hcps} minCell={min} className="font-semibold" />
            </li>
          ))}
        </ul>
      </article>
      <article data-testid="channels" className="rounded-2xl border bg-card p-5">
        <h3 className="text-sm font-semibold text-muted-foreground">Calls by channel</h3>
        <ul className="mt-3 flex flex-col gap-2">
          {engagement.channels.map((c) => (
            <li key={c.channel} className="grid grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-3 text-sm">
              <span className="truncate capitalize">{c.channel.replace(/_/g, " ")}</span>
              <span className="h-4 rounded bg-muted/50" aria-hidden>{c.calls.value !== null && <span className="block h-full rounded bg-chart-3" style={{ width: `${Math.max(1.5, (100 * c.calls.value) / maxChannel)}%` }} />}</span>
              <CountValue count={c.calls} minCell={min} className="font-semibold" />
            </li>
          ))}
        </ul>
      </article>
      {engagement.coverage.status === "AVAILABLE" ? (
        <article data-testid="coverage-available" className="rounded-2xl border bg-card p-5 md:col-span-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Coverage of the target population</h3>
          <p className="mt-2 text-4xl font-semibold tabular-nums" data-testid="coverage-value">{engagement.coverage.percentage}%</p>
          <p className="mt-2 text-sm text-muted-foreground">Engaged target HCPs over the approved target population, for {engagement.coverage.territoriesWithTargets} of {engagement.coverage.territoriesInScope} territories.</p>
        </article>
      ) : (
        <article data-testid="coverage-withheld" className="rounded-2xl border border-dashed bg-muted/40 p-5 md:col-span-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground"><Layers className="size-4" aria-hidden /> Coverage is not shown</h3>
          <p className="mt-2 text-sm">
            {engagement.coverage.status === "SUPPRESSED" ? "The target population is too small to show without identifying individuals." : "There is no approved target population for this scope, so a coverage percentage cannot be calculated. Engaged HCPs are not a substitute for a target list."}
          </p>
        </article>
      )}
    </div>
  )
}

function Kpi({ id, label, icon: Icon, count, min, note }: { id: string; label: string; icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>; count: Overview["kpis"]["calls"]; min: number; note: string }) {
  return (
    <article data-testid={`exec-kpi-${id}`} className="relative overflow-hidden rounded-2xl border bg-card p-5 shadow-card">
      <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-primary" />
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-muted-foreground">{label}</h3>
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/12 text-accent-text"><Icon className="size-5" aria-hidden /></span>
      </div>
      <p className="mt-3 text-5xl font-semibold tracking-tight"><CountValue testId={`exec-kpi-${id}-value`} count={count} minCell={min} /></p>
      <p className="mt-3 text-sm text-muted-foreground">{note}</p>
    </article>
  )
}

function Section({ id, title, note, children }: { id: string; title: string; note: string; children: React.ReactNode }) {
  return (
    <section data-testid={`section-${id}`} aria-labelledby={`section-${id}-title`} className="min-w-0">
      <h2 id={`section-${id}-title`} className="text-xl font-semibold tracking-tight">{title}</h2>
      <p className="mb-3 mt-0.5 max-w-3xl text-sm text-muted-foreground">{note}</p>
      {children}
    </section>
  )
}

