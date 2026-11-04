"use client"

import * as React from "react"
import { EChart } from "@/components/charts/echart"
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
  ["ink", "bg-ink"],
  ["teal", "bg-teal"],
  ["amber", "bg-amber"],
  ["violet", "bg-violet"],
  ["success", "bg-success"],
  ["warning", "bg-warning"],
  ["destructive", "bg-destructive"],
] as const

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
    <div className="flex flex-col gap-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Design system</h1>
        <p className="mt-1 max-w-2xl text-muted-foreground">Tokens and primitives every feature builds on. Synthetic data only.</p>
      </header>

      <section aria-labelledby="ds-color" className="flex flex-col gap-3">
        <h2 id="ds-color" className="text-xl font-semibold">Colour</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
