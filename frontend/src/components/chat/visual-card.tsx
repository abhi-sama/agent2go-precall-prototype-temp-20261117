"use client"

import { Button } from "@astryxdesign/core/Button"
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { IconButton } from "@astryxdesign/core/IconButton"
import { Heading } from "@astryxdesign/core/Heading"
import { Skeleton } from "@astryxdesign/core/Skeleton"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import { Maximize2, Table2, BarChart3 } from "lucide-react"
import * as React from "react"
import { Layout, LayoutContent } from "@astryxdesign/core/Layout"
import { useKeepMounted } from "@/components/chat/use-keep-mounted"
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
        <VStack data-testid="distribution-chart">
          <DistributionBars
            ordinal
            denominator={spec.total ?? 0}
            rows={spec.points.map((p) => ({ label: p.label, count: p.value, percent: p.sharePct ?? 0 }))}
          />
        </VStack>
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

function VisualPending() {
  return (
    <VStack data-testid="visual-pending" role="status" aria-label="Preparing a chart from your data" gap={3} padding={4} className="viz-rise rounded-2xl border bg-card">
      <Skeleton height="1rem" width="12rem" />
      <Skeleton height="9rem" width="100%" radius={4} />
      <Text as="p" type="supporting">Counting from your data…</Text>
    </VStack>
  )
}

/**
 * One generative-UI visual in a chat answer. The values are exactly what the database query returned; the card adds
 * the frame: title, period and scope, the metric definition, a table twin, and a full-screen view.
 */
export function VisualCard({ item }: { item: VisualItem }) {
  const [asTable, setAsTable] = React.useState(false)
  const [expanded, setExpanded] = React.useState(false)
  const mounted = useKeepMounted(expanded)
  if (item.status === "pending" || !item.spec) return <VisualPending />
  const spec = item.spec
  const through = throughLabel(spec.dataThrough)
  const isTable = spec.kind === "table"
  return (
    <>
      <VStack
        as="article"
        data-testid="visual"
        data-kind={spec.kind}
        data-visual-id={spec.visualId}
        data-total={spec.total ?? undefined}
        aria-label={spec.title}
        gap={3}
        padding={4}
        className="viz-rise min-w-0 rounded-2xl border bg-card shadow-card"
      >
        <HStack as="header" gap={3} align="start" hAlign="between" wrap="wrap">
          <VStack gap={0.5} className="min-w-0">
            <Heading level={4} data-testid="visual-title">
              {spec.title}
            </Heading>
            <Text as="p" type="supporting" maxLines={1}>
              {spec.subtitle}
            </Text>
          </VStack>
          <HStack gap={1.5} className="shrink-0">
            {!isTable && (
              <Button
                variant="secondary"
                size="sm"
                data-testid="visual-toggle"
                aria-pressed={asTable}
                label={asTable ? "Chart" : "Table"}
                icon={<Icon icon={asTable ? BarChart3 : Table2} />}
                onClick={() => setAsTable((v) => !v)}
              />
            )}
            <IconButton
              variant="secondary"
              size="sm"
              data-testid="visual-expand"
              label={`Expand ${spec.title}`}
              icon={<Icon icon={Maximize2} />}
              onClick={() => setExpanded(true)}
            />
          </HStack>
        </HStack>
        <VStack className="min-w-0">{asTable ? <TableView spec={spec} /> : <Chart spec={spec} />}</VStack>
        <VStack as="footer" gap={1}>
          {spec.definition && <Text as="p" type="supporting">{spec.definition}</Text>}
          <HStack as="p" gap={3} wrap="wrap">
            {spec.total != null && !isTable && (
              <Text as="span" type="supporting" data-testid="visual-total">
                Total in period: <Text weight="semibold" color="primary" hasTabularNumbers>{fmt(spec.total)}</Text> {spec.unit}
              </Text>
            )}
            {spec.leftOut > 0 && <Text type="supporting">{spec.leftOut} more not shown</Text>}
            {through && <Text type="supporting">Data through {through}</Text>}
            <Text type="supporting">Counted by database queries, not by the AI.</Text>
          </HStack>
        </VStack>
      </VStack>
      {mounted && <Dialog isOpen={expanded} onOpenChange={setExpanded} variant="fullscreen" data-testid={expanded ? "visual-sheet" : undefined}>
        {mounted && (
          <Layout
            height="fill"
            header={<DialogHeader title={spec.title} subtitle={spec.subtitle} onOpenChange={setExpanded} />}
            content={
              <LayoutContent padding={4} isScrollable>
                <VStack gap={4} className="mx-auto w-full max-w-5xl">
                  <VStack padding={4} className="rounded-2xl border bg-card">
                    <Chart spec={spec} tall />
                  </VStack>
                  {spec.kind !== "table" && (
                    <VStack gap={2}>
                      <Heading level={5} color="secondary">The same numbers as a table</Heading>
                      <TableView spec={spec} />
                    </VStack>
                  )}
                  {spec.definition && <Text as="p" type="supporting">{spec.definition}</Text>}
                </VStack>
              </LayoutContent>
            }
          />
        )}
      </Dialog>}
    </>
  )
}
