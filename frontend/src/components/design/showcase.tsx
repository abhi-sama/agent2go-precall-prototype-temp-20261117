"use client"

import { Stethoscope } from "lucide-react"
import * as React from "react"
import { DistributionBars } from "@/components/charts/distribution-bars"
import { EChart } from "@/components/charts/echart"
import { Heatmap } from "@/components/charts/heatmap"
import { KpiTile } from "@/components/charts/kpi-tile"
import { Legend, SequentialLegend } from "@/components/charts/legend"
import { Timeline } from "@/components/charts/timeline"
import { TrendAreaChart } from "@/components/charts/trend-area-chart"
import { DataThroughBadge } from "@/components/landing/data-through-badge"
import { AiSummary, CitationChip, SourceFact, Suggestion } from "@/components/provenance/provenance"
import { ScopeLabel } from "@/components/shell/scope-label"
import { EmptyState, ErrorState } from "@/components/state/states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataError } from "@/lib/data/types"

const WEEKS = Array.from({ length: 12 }, (_, i) => ({
  label: `W${i + 1}`,
  calls: 14 + ((i * 7) % 9) + i,
  hcps: 9 + ((i * 5) % 6) + Math.floor(i / 2),
}))

const SWATCHES = [
  ["primary", "bg-primary"],
  ["chart 1", "bg-chart-1"],
  ["chart 2", "bg-chart-2"],
  ["chart 3", "bg-chart-3"],
  ["chart 4", "bg-chart-4"],
  ["chart 5", "bg-chart-5"],
  ["chart 6", "bg-chart-6"],
  ["chart other", "bg-chart-other"],
  ["success", "bg-success"],
  ["warning", "bg-warning"],
  ["destructive", "bg-destructive"],
] as const

const HEAT_COLUMNS = ["Aug", "Sep", "Oct", "Nov"].map((label) => ({ key: label, label }))
const HEAT_ROWS = [
  { id: "a", label: "Synthetic MSL A", sublabel: "NE-01", values: [14, 20, 18, 6] },
  { id: "b", label: "Synthetic MSL B", sublabel: "NE-02", values: [9, 0, 12, 4] },
  { id: "c", label: "Synthetic MSL C", sublabel: "NE-03", values: [17, 19, 22, 8] },
]

export function DesignSystemShowcase() {
  const [now] = React.useState(() => Date.now())
  const bar = React.useMemo(
    () => ({
      xAxis: { type: "category" as const, data: WEEKS.map((w) => w.label) },
      yAxis: { type: "value" as const },
      tooltip: { trigger: "axis" as const },
      series: [{ type: "bar" as const, name: "Calls", data: WEEKS.map((w) => w.calls), itemStyle: { borderRadius: [6, 6, 0, 0] } }],
    }),
    [],
  )
  return (
    <div data-testid="design-showcase" className="flex flex-col gap-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Design system</h1>
        <p className="mt-1 max-w-2xl text-muted-foreground">Tokens and primitives every feature builds on. Synthetic data only.</p>
      </header>

      <section aria-labelledby="ds-color" className="flex flex-col gap-3">
        <h2 id="ds-color" className="text-xl font-semibold">Colour</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {SWATCHES.map(([name, cls]) => (
            <div key={name} className="overflow-hidden rounded-xl border bg-card">
              <div className={`h-14 ${cls}`} />
              <p className="px-3 py-2 text-sm font-medium">{name}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="ds-actions" className="flex flex-col gap-3">
        <h2 id="ds-actions" className="text-xl font-semibold">Controls (44pt minimum)</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Badge>Badge</Badge>
          <ScopeLabel label="Territory NE-01 · Boston Metro" />
          <DataThroughBadge dataThrough={new Date(now - 86_400_000).toISOString()} />
          <DataThroughBadge dataThrough={new Date(now - 9 * 86_400_000).toISOString()} />
        </div>
      </section>

      <section aria-labelledby="ds-prov" className="flex flex-col gap-3">
        <h2 id="ds-prov" className="text-xl font-semibold">Fact, AI summary, suggestion</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">Each type differs by label, icon and border, not colour alone.</p>
        <div className="grid gap-4 lg:grid-cols-3">
          <SourceFact title="Calls this quarter" meta={<><CitationChip>call:C-10442</CitationChip><CitationChip>call:C-10457</CitationChip></>}>
            41 distinct calls reached 29 HCPs. Counted from the call log, once per call.
          </SourceFact>
          <AiSummary title="Emerging theme" meta={<span>Based on 18 responses · data through Nov 2</span>}>
            Several HCPs asked about sequencing after progression. Treat as a pattern to verify, not a conclusion.
          </AiSummary>
          <Suggestion
            title="Follow up"
            actions={<><Button size="sm" variant="outline">Dismiss</Button><Button size="sm">Add task</Button></>}
          >
            Two HCPs with open questions have not been contacted in 45 days.
          </Suggestion>
        </div>
      </section>

      <section aria-labelledby="ds-charts" className="flex flex-col gap-3">
        <h2 id="ds-charts" className="text-xl font-semibold">Charts</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <figure className="rounded-2xl border bg-card p-4 shadow-card">
            <figcaption className="mb-2 text-sm font-semibold">shadcn chart (Recharts)</figcaption>
            <TrendAreaChart data={WEEKS} series={[{ key: "calls", label: "Calls", colorIndex: 1 }, { key: "hcps", label: "HCPs", colorIndex: 2 }]} />
          </figure>
          <figure className="rounded-2xl border bg-card p-4 shadow-card">
            <figcaption className="mb-2 text-sm font-semibold">Apache ECharts</figcaption>
            <EChart option={bar} ariaLabel="Bar chart of weekly calls over twelve weeks" />
          </figure>
        </div>
      </section>

      <section aria-labelledby="ds-chart-kit" className="flex flex-col gap-4">
        <h2 id="ds-chart-kit" className="text-xl font-semibold">Chart components</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <KpiTile id="ds-kpi" label="Distinct calls" value={1070} definition="Each call counted once, however many rows it has." caption="1.8 calls per HCP" icon={Stethoscope} series={1} />
          <div className="rounded-2xl border bg-card p-4 shadow-card">
            <p className="mb-3 text-sm font-semibold">Distribution</p>
            <DistributionBars denominator={32} rows={[{ label: "Evidence and access", count: 18, percent: 56.3 }, { label: "Practical guidance", count: 9, percent: 28.1 }, { label: "None recorded", count: 5, percent: 15.6 }]} />
          </div>
          <div className="rounded-2xl border bg-card p-4 shadow-card">
            <p className="mb-3 text-sm font-semibold">Legend</p>
            <Legend items={[{ label: "In person", series: 1 }, { label: "Virtual", series: 2 }, { label: "Phone", series: 3 }, { label: "Other", series: "other" }]} />
          </div>
        </div>
        <Heatmap caption="Distinct calls by member and month" rowHeader="Team member" columns={HEAT_COLUMNS} rows={HEAT_ROWS} />
        <SequentialLegend label="Distinct calls per month" min="1" max="22" />
        <Timeline
          layout="row"
          events={[
            { id: "1", label: "Call activity", at: "Nov 3, 8:30 AM UTC", status: "ok", statusLabel: "Completed" },
            { id: "2", label: "HCP raw insights", at: "Jan 1, 8:30 AM UTC", status: "warning", statusLabel: "Stale" },
            { id: "3", label: "Question tag", at: "Nov 3, 9:01 AM UTC", status: "critical", statusLabel: "Failed" },
          ]}
        />
      </section>

      <section aria-labelledby="ds-motion" className="flex flex-col gap-3">
        <h2 id="ds-motion" className="text-xl font-semibold">Motion primitives</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">Press, hover lift (pointer devices only) and a spring entrance. Reduced motion keeps the fade and drops the movement.</p>
        <div className="flex flex-wrap gap-4">
          <button type="button" className="press min-h-11 rounded-xl border bg-card px-5 text-sm font-medium shadow-card">Press me</button>
          <div className="hover-lift rounded-xl border bg-card px-5 py-3 text-sm font-medium shadow-card">Hover lift</div>
          <div className="spring-in rounded-xl border bg-card px-5 py-3 text-sm font-medium shadow-card">Spring in</div>
        </div>
      </section>

      <section aria-labelledby="ds-states" className="flex flex-col gap-3">
        <h2 id="ds-states" className="text-xl font-semibold">States</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <EmptyState />
          <ErrorState error={new DataError("UNAVAILABLE", "x", "3f2a9c1e-0000")} onRetry={() => {}} />
        </div>
      </section>
    </div>
  )
}
