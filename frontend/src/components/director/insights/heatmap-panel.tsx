"use client"

import type { EChartsOption } from "echarts"
import { Banner } from "@astryxdesign/core/Banner"
import { Blockquote } from "@astryxdesign/core/Blockquote"
import { Button } from "@astryxdesign/core/Button"
import { Card } from "@astryxdesign/core/Card"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from "@astryxdesign/core/Table"
import { Text } from "@astryxdesign/core/Text"
import { ToggleButton, ToggleButtonGroup } from "@astryxdesign/core/ToggleButton"
import { VStack } from "@astryxdesign/core/VStack"
import { Box, MessageSquareText, Rows3, Table2 } from "lucide-react"
import NextLink from "next/link"
import * as React from "react"
import { EChart } from "@/components/charts/echart"
import { DashboardGrid, DashboardGridItem } from "@/components/layout/dashboard-grid"
import { AiSummary } from "@/components/provenance/provenance"
import { EmptyState, ErrorState } from "@/components/state/states"
import { useDocumentTheme, useThemeSignature } from "@/hooks/use-document-theme"
import { chatLink } from "@/lib/chat/context"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { HeatmapCell, ThemeCard, ThemeFacet, TopicHeatmap } from "@/lib/data/director-insights"
import type { DateRange, InsightFilters } from "@/lib/data/types"
import { useQuery } from "@/lib/data/use-query"
import { detectWebGL } from "@/lib/webgl"
import { resolveCssColor } from "@/lib/css-color"
import { useSession } from "@/lib/session/session-provider"
import { Heatmap3D } from "./heatmap-3d"
import { DerivedBadge, EvidenceChip, InsightSection, num, PanelLoading, PanelMeta, pctText } from "./shared"

const FACETS: { id: ThemeFacet; label: string }[] = [
  { id: "NONE", label: "All themes" },
  { id: "MOLECULE", label: "Molecule" },
  { id: "TUMOR_TYPE", label: "Tumor type" },
  { id: "STUDY", label: "Study" },
  { id: "SURVEY", label: "Survey" },
]

type HeatmapView = "chart" | "table" | "3d"

const FALLBACK_NOTICE = {
  webgl: "The 3D view needs WebGL, which this browser does not offer. Showing the 2D chart instead.",
  lost: "The graphics context for the 3D view was lost. Showing the 2D chart instead.",
  error: "The 3D view could not start. Showing the 2D chart instead.",
} as const

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string)
const shortTopic = (topic: string) => topic.replace(" (emerging)", " ↑")

/**
 * Topic-by-territory heatmap. Rows are derived themes, columns are territories, and a cell is the theme's share of
 * that territory's free-text responses (the denominator is in the tooltip and the table). The table view is the
 * accessible twin of the chart and is also where a keyboard user selects a cell.
 */
export function HeatmapPanel({ range, filters }: { range: DateRange; filters: InsightFilters }) {
  const adapter = useDataAdapter()
  const { userId, ready } = useSession()
  const [facet, setFacet] = React.useState<ThemeFacet>("NONE")
  const [view, setView] = React.useState<HeatmapView>("chart")
  // Why the 3D view is not showing, when the person asked for it: the 2D chart stands in and says so.
  const [fallback, setFallback] = React.useState<keyof typeof FALLBACK_NOTICE | null>(null)
  const chooseView = (next: HeatmapView) => {
    if (next === "3d" && !detectWebGL()) {
      setFallback("webgl")
      setView("chart")
      return
    }
    setFallback(null)
    setView(next)
  }
  const fallBackTo2D = React.useCallback((reason: keyof typeof FALLBACK_NOTICE) => {
    setFallback(reason)
    setView((v) => (v === "3d" ? "chart" : v))
  }, [])
  const [selected, setSelected] = React.useState<{ territoryId: string; topic: string } | null>(null)
  const query = useQuery("topicHeatmap", `${userId}:${range.from}:${range.to}:${facet}:${JSON.stringify(filters)}`, (ctx) => adapter.topicHeatmap(ctx, { range, filters, facet }), ready)
  // Keep the last map while a facet reloads, so the page does not jump.
  const [kept, setKept] = React.useState<{ userId: string; data: TopicHeatmap } | null>(null)
  if (query.status === "success" && kept?.data !== query.data) setKept({ userId, data: query.data })
  const data = query.status === "success" ? query.data : kept?.userId === userId ? kept.data : null

  return (
    <InsightSection
      id="heatmap"
      title="Topics by territory"
      note="Which themes recorded responses raise, territory by territory. Themes are derived by keyword from free-text answers; each card cites the responses behind it."
      meta={data && <PanelMeta from={data.from} to={data.to} dataThrough={data.dataThrough}><span data-testid="heatmap-denominator">{num(data.freeTextResponses)} free-text responses</span></PanelMeta>}
    >
      {query.status === "error" && !data ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : !data ? (
        <PanelLoading testId="heatmap-loading" height={384} />
      ) : data.cells.length === 0 ? (
        <EmptyState title="No free-text responses in this period">There are no recorded free-text responses for your territories between these dates. Try a longer period.</EmptyState>
      ) : (
        <VStack gap={6} aria-busy={query.status === "loading"}>
          <HStack gap={3} align="center" justify="between" wrap="wrap">
            <ToggleButtonGroup label="Group theme cards by" type="single" value={facet} onChange={(v) => { if (v) setFacet(v as ThemeFacet) }}>
              {FACETS.map((f) => <ToggleButton key={f.id} value={f.id} label={f.label} data-testid={`facet-${f.id}`} />)}
            </ToggleButtonGroup>
            <ToggleButtonGroup label="Heatmap view" type="single" value={view} onChange={(v) => { if (v) chooseView(v as HeatmapView) }}>
              {([["chart", "Chart", Rows3], ["3d", "3D", Box], ["table", "Table", Table2]] as const).map(([id, label, glyph]) => (
                <ToggleButton key={id} value={id} label={label} icon={<Icon icon={glyph} />} data-testid={`heatmap-view-${id}`} />
              ))}
            </ToggleButtonGroup>
          </HStack>

          {fallback && (
            <Banner status="info" role="status" data-testid="heatmap-3d-notice" title={FALLBACK_NOTICE[fallback]} />
          )}

          <DashboardGrid>
            <DashboardGridItem area="primary">
              <VStack gap={4}>
                <Card data-testid="topic-heatmap" data-view={view} padding={3} className="min-w-0">
                  {view === "chart" ? <HeatmapChart data={data} selected={selected} onSelect={setSelected} /> : view === "3d" ? <Heatmap3D data={data} selected={selected} onSelect={setSelected} onUnavailable={fallBackTo2D} /> : <HeatmapTable data={data} selected={selected} onSelect={setSelected} />}
                  <Legend max={Math.max(...data.cells.map((c) => c.share))} />
                </Card>
                {selected && <CellDetail data={data} selected={selected} range={range} onClear={() => setSelected(null)} />}
              </VStack>
            </DashboardGridItem>

            <DashboardGridItem area="secondary">
              <VStack gap={4} data-testid="theme-cards" data-facet={data.facet}>
                <Heading level={3}>{data.facetLabel ? `Theme cards by ${data.facetLabel.toLowerCase()}` : "Theme cards"}</Heading>
                <CardGroups cards={data.themeCards} grouped={data.facet !== "NONE"} />
              </VStack>
            </DashboardGridItem>
          </DashboardGrid>
        </VStack>
      )}
    </InsightSection>
  )
}

function Legend({ max }: { max: number }) {
  return (
    <HStack gap={3} align="center" wrap="wrap" className="mt-3" data-testid="heatmap-legend">
      <Text type="supporting" size="xsm">Share of the territory&apos;s free-text responses</Text>
      <span aria-hidden className="h-2.5 w-28 rounded-full bg-gradient-to-r from-muted to-primary" />
      <Text type="supporting" size="xsm" hasTabularNumbers>0% to {max.toFixed(1)}%</Text>
      <Text type="supporting" size="xsm">↑ marks a theme on the emerging-topic watch list</Text>
    </HStack>
  )
}

function HeatmapChart({ data, selected, onSelect }: { data: TopicHeatmap; selected: { territoryId: string; topic: string } | null; onSelect: (s: { territoryId: string; topic: string }) => void }) {
  const docTheme = useDocumentTheme()
  const themeSignature = useThemeSignature()
  const topics = data.topics.map((t) => t.topic)
  const territories = data.territories.map((t) => t.territoryId)
  const byKey = React.useMemo(() => new Map(data.cells.map((c) => [`${c.territoryId}|${c.topic}`, c])), [data.cells])
  const max = Math.max(...data.cells.map((c) => c.share), 1)
  const option = React.useMemo<EChartsOption>(() => {
    void themeSignature // tokens are re-read whenever the Astryx theme or scheme changes
    const low = resolveCssColor("--muted", docTheme === "dark" ? "#2a2420" : "#f3eeea")
    const high = resolveCssColor("--primary", "#ea580c")
    const ink = resolveCssColor("--foreground", docTheme === "dark" ? "#f1ede9" : "#2a2420")
    const points = topics.flatMap((topic, y) =>
      territories.map((tid, x) => {
        const cell = byKey.get(`${tid}|${topic}`)
        return { value: [x, y, cell ? cell.share : 0], itemStyle: selected && selected.territoryId === tid && selected.topic === topic ? { borderColor: ink, borderWidth: 2 } : undefined }
      }),
    )
    return {
      grid: { left: 8, right: 8, top: 8, bottom: 40, containLabel: true },
      tooltip: {
        position: "top",
        formatter: (p: unknown) => {
          const [x, y] = (p as { value: number[] }).value
          const cell = byKey.get(`${territories[x]}|${topics[y]}`)
          return cell
            ? `<strong>${esc(topics[y])}</strong><br/>${esc(territories[x])}: ${cell.responses} of ${cell.territoryResponses} free-text responses (${cell.share.toFixed(1)}%)`
            : `<strong>${esc(topics[y])}</strong><br/>${esc(territories[x])}: no responses`
        },
      },
      xAxis: { type: "category", data: territories, splitArea: { show: false }, axisLabel: { interval: 0, fontSize: 12, color: ink }, axisTick: { show: false } },
      yAxis: { type: "category", data: topics.map(shortTopic), inverse: true, axisLabel: { interval: 0, fontSize: 12, color: ink, width: 180, overflow: "truncate" }, axisTick: { show: false } },
      visualMap: { show: false, min: 0, max, inRange: { color: [low, high] }, dimension: 2 },
      series: [
        {
          type: "heatmap",
          data: points,
          label: { show: true, fontSize: 10, color: ink, formatter: (p: unknown) => ((p as { value: number[] }).value[2] > 0 ? `${(p as { value: number[] }).value[2].toFixed(0)}%` : "") },
          itemStyle: { borderColor: "transparent", borderWidth: 1 },
          emphasis: { itemStyle: { borderColor: ink, borderWidth: 2 } },
        },
      ],
    }
  }, [topics, territories, byKey, max, selected, docTheme, themeSignature])

  return (
    <EChart
      option={option}
      height={Math.max(260, topics.length * 30 + 70)}
      ariaLabel={`Heatmap of ${topics.length} derived themes by ${territories.length} territories. Each cell is the theme's percentage of that territory's free-text responses. Open the table view for the same numbers as text.`}
      onReady={(chart) => {
        chart.on("click", (p) => {
          const v = (p as { value?: number[] }).value
          if (v) onSelect({ territoryId: territories[v[0]], topic: topics[v[1]] })
        })
      }}
    />
  )
}

function HeatmapTable({ data, selected, onSelect }: { data: TopicHeatmap; selected: { territoryId: string; topic: string } | null; onSelect: (s: { territoryId: string; topic: string }) => void }) {
  const byKey = new Map(data.cells.map((c) => [`${c.territoryId}|${c.topic}`, c]))
  return (
    <Table data-testid="heatmap-table" aria-label="Share of each territory's free-text responses by derived theme">
      <TableHeader>
        <TableRow isHeaderRow>
          <TableHeaderCell scope="col">Theme</TableHeaderCell>
          {data.territories.map((t) => (
            <TableHeaderCell key={t.territoryId} scope="col" className="text-center">
              {t.territoryId}
              <Text type="supporting" as="div" size="2xs">n = {t.freeTextResponses}</Text>
            </TableHeaderCell>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.topics.map((topic) => (
          <TableRow key={topic.topic}>
            <TableCell scope="row"><Text weight="medium">{topic.topic}</Text></TableCell>
            {data.territories.map((t) => {
              const cell = byKey.get(`${t.territoryId}|${topic.topic}`)
              const on = selected?.territoryId === t.territoryId && selected.topic === topic.topic
              return (
                <TableCell key={t.territoryId} className="text-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    width="100%"
                    data-testid="heatmap-cell"
                    data-territory={t.territoryId}
                    data-topic={topic.topic}
                    aria-pressed={on}
                    label={`${topic.topic} in ${t.territoryId}: ${cell ? `${cell.responses} of ${cell.territoryResponses} responses, ${cell.share.toFixed(1)} percent` : "no responses"}`}
                    onClick={() => onSelect({ territoryId: t.territoryId, topic: topic.topic })}
                    className={on ? "min-w-11 tabular-nums ring-2 ring-foreground" : "min-w-11 tabular-nums"}
                    style={{ background: `color-mix(in oklch, var(--primary) ${Math.min(100, Math.round(((cell?.share ?? 0) / 25) * 100))}%, var(--muted))` }}
                  >
                    {cell ? cell.share.toFixed(1) : "–"}
                  </Button>
                </TableCell>
              )
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function CellDetail({ data, selected, range, onClear }: { data: TopicHeatmap; selected: { territoryId: string; topic: string }; range: DateRange; onClear: () => void }) {
  const cell: HeatmapCell | undefined = data.cells.find((c) => c.territoryId === selected.territoryId && c.topic === selected.topic)
  const territory = data.territories.find((t) => t.territoryId === selected.territoryId)
  return (
    <Card data-testid="cell-detail" role="complementary" aria-label="Selected heatmap cell" className="border border-primary/40">
      <HStack gap={3} align="center" justify="between" wrap="wrap">
        <VStack gap={1} className="min-w-0">
          <Text weight="semibold" as="p">{selected.topic} <DerivedBadge /></Text>
          <Text type="supporting" as="p">
            {selected.territoryId}{territory?.name ? ` · ${territory.name}` : ""}:{" "}
            {cell ? <><strong className="text-foreground tabular-nums">{num(cell.responses)}</strong> of {num(cell.territoryResponses)} free-text responses ({pctText(cell.share)}) from {num(cell.distinctHcps)} HCPs.</> : "no responses recorded."}
          </Text>
        </VStack>
        <HStack gap={2} wrap="wrap">
          <Button href={chatLink({ view: "director-insights", territoryId: selected.territoryId, from: range.from, to: range.to })} as={NextLink} data-testid="ask-agent-cell" variant="secondary" label={`Ask the agent about ${selected.territoryId}`} icon={<Icon icon={MessageSquareText} />} />
          <Button variant="ghost" label="Clear" onClick={onClear} />
        </HStack>
      </HStack>
    </Card>
  )
}

function CardGroups({ cards, grouped }: { cards: ThemeCard[]; grouped: boolean }) {
  if (cards.length === 0) return <Card variant="muted" className="border border-dashed"><Text type="supporting" as="p">No theme cards for these filters.</Text></Card>
  const groups = grouped ? [...new Set(cards.map((c) => c.facetValue ?? ""))] : [""]
  return (
    <div className="a2g-theme-cards-scope flex flex-col gap-6">
      {groups.map((value) => {
        const list = cards.filter((c) => (c.facetValue ?? "") === value)
        return (
          <div key={value} className="flex flex-col gap-3">
            {grouped && (
              <Heading level={4} data-testid="facet-group" color="secondary">
                {value} <Text weight="normal">· {num(list[0]?.facetResponses ?? 0)} free-text responses</Text>
              </Heading>
            )}
            <div className="a2g-theme-cards-grid grid gap-4">
              {list.map((card) => (
                <ThemeCardView key={card.cardId} card={card} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ThemeCardView({ card }: { card: ThemeCard }) {
  return (
    <AiSummary
      data-testid="theme-card"
      data-topic={card.topic}
      title={card.topic}
      className="h-full transition-shadow hover:shadow-lift"
      meta={<DerivedBadge />}
    >
      <div className="flex flex-col gap-3">
        <Text type="supporting" as="p">
          <strong className="text-foreground tabular-nums">{num(card.responses)}</strong> responses ({pctText(card.share)} of {num(card.facetResponses)}) · {num(card.distinctHcps)} HCPs · {card.territoryCount} territories
        </Text>
        {card.evidence.map((e) => (
          <figure key={e.recordId} className="flex flex-col gap-2">
            <Blockquote>“{e.excerpt}”</Blockquote>
            <figcaption className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <EvidenceChip recordId={e.recordId} />
              <span>{e.territoryId}{e.interactionDate ? ` · ${e.interactionDate}` : ""}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </AiSummary>
  )
}
