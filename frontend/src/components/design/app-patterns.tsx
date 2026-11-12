"use client"

import { Button } from "@astryxdesign/core/Button"
import { Card } from "@astryxdesign/core/Card"
import { Grid } from "@astryxdesign/core/Grid"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Table, pixel } from "@astryxdesign/core/Table"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
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
import { EmptyState, ErrorState, FirstRunState, NoAccessState } from "@/components/state/states"
import { useAppToast } from "@/components/state/use-app-toast"
import { DataError } from "@/lib/data/types"
import { useThemeSignature } from "@/hooks/use-document-theme"
import { GuideGroup, GuideSection } from "./guide-section"

const WEEKS = Array.from({ length: 12 }, (_, i) => ({
  label: `W${i + 1}`,
  calls: 14 + ((i * 7) % 9) + i,
  hcps: 9 + ((i * 5) % 6) + Math.floor(i / 2),
}))

const HEAT_COLUMNS = ["Aug", "Sep", "Oct", "Nov"].map((label) => ({ key: label, label }))
const HEAT_ROWS = [
  { id: "a", label: "Synthetic MSL A", sublabel: "NE-01", values: [14, 20, 18, 6] },
  { id: "b", label: "Synthetic MSL B", sublabel: "NE-02", values: [9, 0, 12, 4] },
  { id: "c", label: "Synthetic MSL C", sublabel: "NE-03", values: [17, 19, 22, 8] },
]

export function ProvenanceSection() {
  const toast = useAppToast()
  const open = () => toast.info("A citation opens its source record in a side panel")
  return (
    <GuideSection
      id="provenance"
      title="Fact, AI summary, suggestion"
      description="Every AI surface uses one family. Facts are plain cards. AI summaries sit on a soft accent wash with a sparkle badge and citation chips that open the source record. Suggestions have a dashed outline. Each differs by label, icon and outline, not colour alone."
      code={`import {SourceFact, AiSummary, Suggestion} from "@/components/provenance/provenance"

<AiSummary title="Emerging theme" citations={[{key: "r1", label: "RESP-0114", onOpen}]}>…</AiSummary>`}
    >
      <Grid columns={{ minWidth: 280, max: 3 }} gap={4}>
        <SourceFact title="Calls this quarter" meta={<><CitationChip>call:C-10442</CitationChip><CitationChip>call:C-10457</CitationChip></>}>
          41 distinct calls reached 29 HCPs. Counted from the call log, once per call.
        </SourceFact>
        <AiSummary
          title="Emerging theme"
          citations={[
            { key: "r1", label: "RESP-0114", detail: "Recorded HCP response", onOpen: open },
            { key: "r2", label: "RESP-0207", detail: "Recorded HCP response", onOpen: open },
          ]}
          meta={<Text type="inherit">Based on 18 responses · data through Nov 2</Text>}
        >
          Several HCPs asked about sequencing after progression. Treat as a pattern to verify, not a conclusion.
        </AiSummary>
        <Suggestion
          title="Follow up"
          actions={<><Button label="Dismiss" size="sm" variant="secondary" /><Button label="Add task" size="sm" /></>}
        >
          Two HCPs with open questions have not been contacted in 45 days.
        </Suggestion>
      </Grid>
    </GuideSection>
  )
}

interface Row extends Record<string, unknown> {
  name: string
  where: string
}

const CHART_ROWS: Row[] = [
  { name: "KpiTile", where: "Headline figure with a definition line; one hue per measure" },
  { name: "TrendAreaChart", where: "Recharts area chart for weekly trends" },
  { name: "EChart", where: "Apache ECharts wrapper; reads colours through resolveCssColor" },
  { name: "DistributionBars, Heatmap, Timeline, Legend", where: "Dense, labelled, keyboard-readable alternatives" },
]

export function ChartsSection() {
  // Charts paint through canvas, so they re-read the tokens whenever the theme or scheme changes.
  const signature = useThemeSignature()
  const [now] = React.useState(() => Date.now())
  const bar = React.useMemo(
    () => ({
      xAxis: { type: "category" as const, data: WEEKS.map((w) => w.label) },
      yAxis: { type: "value" as const },
      tooltip: { trigger: "axis" as const },
      series: [{ type: "bar" as const, name: "Calls", data: WEEKS.map((w) => w.calls), itemStyle: { borderRadius: [6, 6, 0, 0] } }],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the signature changes when theme tokens do
    [signature],
  )
  return (
    <GuideSection
      id="charts"
      title="Charts and data components"
      description="Canvas and WebGL cannot read CSS variables, so charts resolve Astryx tokens into plain colours and redraw when the theme or scheme changes. Series keep the same hue everywhere: a measure is the same colour in its tile, its trend and its legend."
      code={`import {KpiTile} from "@/components/charts/kpi-tile"
import {EChart} from "@/components/charts/echart"
import {useThemeSignature} from "@/hooks/use-document-theme"   // re-read tokens on theme change`}
    >
      <Grid columns={{ minWidth: 320, max: 2 }} gap={4}>
        <Card padding={4}>
          <VStack gap={2}>
            <Heading level={4}>Recharts area</Heading>
            <TrendAreaChart data={WEEKS} series={[{ key: "calls", label: "Calls", colorIndex: 1 }, { key: "hcps", label: "HCPs", colorIndex: 2 }]} />
          </VStack>
        </Card>
        <Card padding={4}>
          <VStack gap={2}>
            <Heading level={4}>Apache ECharts</Heading>
            <EChart option={bar} ariaLabel="Bar chart of weekly calls over twelve weeks" />
          </VStack>
        </Card>
      </Grid>
      <Grid columns={{ minWidth: 260, max: 3 }} gap={4}>
        <KpiTile id="ds-kpi" label="Distinct calls" value={1070} definition="Each call counted once, however many rows it has." caption="1.8 calls per HCP" icon={Stethoscope} series={1} />
        <Card padding={4}>
          <VStack gap={3}>
            <Heading level={4}>Distribution</Heading>
            <DistributionBars denominator={32} rows={[{ label: "Evidence and access", count: 18, percent: 56.3 }, { label: "Practical guidance", count: 9, percent: 28.1 }, { label: "None recorded", count: 5, percent: 15.6 }]} />
          </VStack>
        </Card>
        <Card padding={4}>
          <VStack gap={3}>
            <Heading level={4}>Legend</Heading>
            <Legend items={[{ label: "In person", series: 1 }, { label: "Virtual", series: 2 }, { label: "Phone", series: 3 }, { label: "Other", series: "other" }]} />
          </VStack>
        </Card>
      </Grid>
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
      <GuideGroup title="Scope and freshness" note="Every analytic screen says whose data it is and how fresh it is.">
        <HStack gap={3} wrap="wrap" align="center">
          <ScopeLabel label="Territory NE-01 · Boston Metro" />
          <DataThroughBadge dataThrough={new Date(now - 86_400_000).toISOString()} />
          <DataThroughBadge dataThrough={new Date(now - 9 * 86_400_000).toISOString()} />
        </HStack>
      </GuideGroup>
      <Table<Row>
        data={CHART_ROWS}
        idKey="name"
        density="compact"
        columns={[
          { key: "name", header: "Component", width: pixel(260) },
          { key: "where", header: "Role" },
        ]}
      />
    </GuideSection>
  )
}

export function StatesSection() {
  return (
    <GuideSection
      id="states"
      title="States"
      description="One family separates a quiet empty range, an entitlement boundary, a recoverable failure and first-run orientation. Each says what happened, what is unchanged and what to do next."
      code={`import {EmptyState, ErrorState, NoAccessState} from "@/components/state/states"

<ErrorState error={error} onRetry={refetch} />`}
    >
      <Grid data-testid="state-family-preview" columns={{ minWidth: 360, max: 2 }} gap={4}>
        <EmptyState />
        <NoAccessState />
        <ErrorState error={new DataError("UNAVAILABLE", "x", "3f2a9c1e-0000")} onRetry={() => {}} />
        <FirstRunState action={<Button label="Open MSL workspace" href="/msl" />} />
      </Grid>
    </GuideSection>
  )
}

const RULES: { rule: string; detail: string }[] = [
  { rule: "Touch first", detail: "Every control is at least 44 by 44 px under a coarse pointer, and fields stay at 16px so iPad Safari does not zoom." },
  { rule: "Reduced motion", detail: "Movement is dropped and a plain fade stays. Durations and easing come from --duration-* and --ease-* tokens." },
  { rule: "No colour alone", detail: "Status, pass or fail and provenance always carry a word or icon as well." },
  { rule: "No horizontal scroll", detail: "Pages reflow to one column on narrow widths; wide tables scroll inside their own region." },
  { rule: "Tokens only", detail: "No hex or px literals in pages. Layout uses spacing steps, colour uses --color-* tokens." },
]

export function RulesSection() {
  return (
    <GuideSection id="rules" title="Touch, motion and access rules" description="The rules every page is checked against before it ships, in every theme, in light and dark, at 1024 by 1366 and 1366 by 1024.">
      <Table<{ rule: string; detail: string } & Record<string, unknown>>
        data={RULES}
        idKey="rule"
        columns={[
          { key: "rule", header: "Rule", width: pixel(180), renderCell: (r) => <Text weight="semibold">{r.rule}</Text> },
          { key: "detail", header: "What it means" },
        ]}
      />
    </GuideSection>
  )
}
