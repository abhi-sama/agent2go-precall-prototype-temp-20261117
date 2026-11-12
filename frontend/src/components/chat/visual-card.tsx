"use client"

import { Maximize2, Table2, BarChart3 } from "lucide-react"
import * as React from "react"
import { Button } from "@astryxdesign/core/Button"
import { Card } from "@astryxdesign/core/Card"
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Layout, LayoutContent } from "@astryxdesign/core/Layout"
import { Section } from "@astryxdesign/core/Section"
import { Skeleton as AstryxSkeleton } from "@astryxdesign/core/Skeleton"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import { DataTable } from "@/components/charts/viz/data-table"
import { DistributionBars, Heatmap } from "@/components/charts"
import { LineChart } from "@/components/charts/viz/line-chart"
import { RankedBars, type BarDatum } from "@/components/charts/viz/ranked-bars"
import { TimelineChart } from "@/components/charts/viz/timeline-chart"
import { fmt } from "@/components/charts/viz/shared"
import type { VisualItem, VisualSpec } from "@/lib/chat/events"

function barData(spec: VisualSpec): BarDatum[] {
  return spec.points.map((p) => ({ key: p.key, label: p.label, value: p.value, sharePct: p.sharePct }))
}

/** Long, free-text answer labels read better as ranked bars than as columns. */
const wordy = (spec: VisualSpec) => spec.points.some((p) => p.label.length > 8)

function Chart({ spec, tall }: { spec: VisualSpec; tall?: boolean }) {
  const unit = spec.unit
  switch (spec.kind) {
    case "line":
      return <LineChart points={spec.points} unit={unit} peakKey={spec.peakKey} height={tall ? 360 : undefined} />
    case "timeline":
      return <TimelineChart points={spec.points} unit={unit} peakKey={spec.peakKey} />
    case "heatmap":
      return (
        <Heatmap
          testId="heatmap-chart"
          cellTestId="heat-cell"
          caption={spec.title}
          rowHeader={spec.title.match(/ by (\w+) and month/)?.[1] ?? "Row"}
          columns={spec.columns.map((c) => ({ key: c, label: c.replace(/ \d{4}$/, ""), title: c }))}
          rows={spec.rows.map((r) => ({ id: r.key, label: r.label, values: r.values }))}
        />
      )
    case "distribution":
      return wordy(spec) ? (
        <RankedBars data={barData(spec)} unit={unit} />
      ) : (
        <Section data-testid="distribution-chart" variant="transparent" padding={0}>
          <DistributionBars
            ordinal
            denominator={spec.total ?? 0}
            rows={spec.points.map((p) => ({ label: p.label, count: p.value, percent: p.sharePct ?? 0 }))}
          />
        </Section>
      )
    case "table":
      return <TableView spec={spec} />
    case "bar":
    default:
      return <RankedBars data={barData(spec)} unit={unit} />
  }
}

/** The same numbers as a table: every chart has one, so no value depends on seeing a mark or hovering. */
function TableView({ spec }: { spec: VisualSpec }) {
  if (spec.kind === "table" || spec.kind === "heatmap") {
    const columns = spec.kind === "heatmap" ? ["", ...spec.columns] : spec.columns
    const rows = spec.rows.map((r) => ({ key: r.key, label: r.label, cells: r.values }))
    return <DataTable caption={spec.title} columns={columns} rows={rows} testId="visual-table" />
  }
  const withShare = spec.points.some((p) => p.sharePct != null)
  return (
    <DataTable
      caption={spec.title}
      columns={[spec.kind === "distribution" ? "Answer" : "Group", spec.unit ? spec.unit.charAt(0).toUpperCase() + spec.unit.slice(1) : "Count", ...(withShare ? ["Share"] : [])]}
      rows={spec.points.map((p) => ({ key: p.key, label: p.label + (p.partial ? " (partial)" : ""), cells: [p.value, ...(withShare ? [p.sharePct != null ? `${p.sharePct}%` : ""] : [])] }))}
      testId="visual-table"
    />
  )
}

function throughLabel(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
}

function Skeleton() {
  return (
    <Section data-testid="visual-pending" role="status" aria-label="Preparing a chart from your data" padding={4}>
      <VStack gap={3}>
        <AstryxSkeleton width={192} height={16} radius={2} />
        <AstryxSkeleton height={144} radius={3} index={1} />
        <Text type="supporting">Counting from your data…</Text>
      </VStack>
    </Section>
  )
}

/**
 * One generative-UI visual in a chat answer. The values are exactly what the database query returned; the card adds
 * the frame: title, period and scope, the metric definition, a table twin, and a full-screen view.
 */
export function VisualCard({ item }: { item: VisualItem }) {
  const [asTable, setAsTable] = React.useState(false)
  const [expanded, setExpanded] = React.useState(false)
  if (item.status === "pending" || !item.spec) return <Skeleton />
  const spec = item.spec
  const through = throughLabel(spec.dataThrough)
  const isTable = spec.kind === "table"
  return (
    <>
      <article
        data-testid="visual"
        data-kind={spec.kind}
        data-visual-id={spec.visualId}
        data-total={spec.total ?? undefined}
        aria-label={spec.title}
        className="viz-rise flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-4 shadow-card"
      >
        <header>
          <HStack hAlign="between" vAlign="start" gap={3} wrap="wrap">
            <VStack gap={0.5}>
              <Heading level={4} data-testid="visual-title">{spec.title}</Heading>
              <Text type="supporting" maxLines={1}>{spec.subtitle}</Text>
            </VStack>
            <HStack gap={1}>
            {!isTable && (
              <Button label={asTable ? "Chart" : "Table"} variant="secondary" size="sm" data-testid="visual-toggle" aria-pressed={asTable} icon={asTable ? <BarChart3 aria-hidden /> : <Table2 aria-hidden />} onClick={() => setAsTable((v) => !v)} />
            )}
            <Button label={`Expand ${spec.title}`} variant="secondary" size="sm" data-testid="visual-expand" icon={<Maximize2 aria-hidden />} isIconOnly onClick={() => setExpanded(true)} />
            </HStack>
          </HStack>
        </header>
        <section>{asTable ? <TableView spec={spec} /> : <Chart spec={spec} />}</section>
        <footer>
          <VStack gap={1}>
          {spec.definition && <Text type="supporting">{spec.definition}</Text>}
          <HStack gap={3} wrap="wrap">
            {spec.total != null && !isTable && (
              <Text data-testid="visual-total" type="supporting">Total in period: <strong>{fmt(spec.total)}</strong> {spec.unit}</Text>
            )}
            {spec.leftOut > 0 && <Text type="supporting">{spec.leftOut} more not shown</Text>}
            {through && <Text type="supporting">Data through {through}</Text>}
            <Text type="supporting">Counted by database queries, not by the AI.</Text>
          </HStack>
          </VStack>
        </footer>
      </article>
      {expanded && <Dialog isOpen={expanded} onOpenChange={setExpanded} variant="fullscreen" padding={0} data-testid="visual-sheet">
        <Layout
          height="fill"
          header={<DialogHeader title={spec.title} subtitle={spec.subtitle} onOpenChange={setExpanded} />}
          content={<LayoutContent padding={4} isScrollable>
          <Section variant="transparent" padding={0} maxWidth={1200}>
            <VStack gap={4}>
            <Card padding={4}>
              <Chart spec={spec} tall />
            </Card>
            {spec.kind !== "table" && (
              <VStack gap={2}>
                <Heading level={5}>The same numbers as a table</Heading>
                <TableView spec={spec} />
              </VStack>
            )}
            {spec.definition && <Text type="supporting">{spec.definition}</Text>}
            </VStack>
          </Section>
          </LayoutContent>}
        />
      </Dialog>}
    </>
  )
}
