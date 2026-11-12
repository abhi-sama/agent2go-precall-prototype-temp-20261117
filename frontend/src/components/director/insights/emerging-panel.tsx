"use client"

import { Banner } from "@astryxdesign/core/Banner"
import { Blockquote } from "@astryxdesign/core/Blockquote"
import { Card } from "@astryxdesign/core/Card"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList"
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from "@astryxdesign/core/Table"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import * as React from "react"
import { EmptyState, ErrorState } from "@/components/state/states"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { EmergingTopic, EmergingTopics, WeekCount } from "@/lib/data/director-insights"
import type { DateRange, InsightFilters } from "@/lib/data/types"
import { useQuery } from "@/lib/data/use-query"
import { formatDay } from "@/lib/dates"
import { useSession } from "@/lib/session/session-provider"
import { DerivedBadge, EvidenceChip, InsightSection, num, PanelLoading, PanelMeta, pctText, StatusBadge } from "./shared"

/**
 * Emerging-topic monitoring. Every status on this panel is the database's verdict under the rule shown at the top;
 * the screen never computes one. The rule, both periods and their sample sizes are always visible, and nothing here
 * says why a topic moved.
 */
export function EmergingPanel({ range, filters }: { range: DateRange; filters: InsightFilters }) {
  const adapter = useDataAdapter()
  const { userId, ready } = useSession()
  const query = useQuery("emergingTopics", `${userId}:${range.from}:${range.to}:${JSON.stringify(filters)}`, (ctx) => adapter.emergingTopics(ctx, { range, filters }), ready)
  const data = query.status === "success" ? query.data : null

  return (
    <InsightSection
      id="emerging"
      title="Emerging topics"
      note="Each theme's share of free-text responses in this period against the period of equal length before it."
      meta={data && <PanelMeta from={data.current.from} to={data.current.to} dataThrough={data.dataThrough} />}
    >
      {query.status === "error" ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : !data ? (
        <PanelLoading testId="emerging-loading" height={320} />
      ) : (
        <Body data={data} />
      )}
    </InsightSection>
  )
}

function Body({ data }: { data: EmergingTopics }) {
  const flagged = data.topics.filter((t) => t.status === "EMERGING" || t.status === "DECLINING")
  const rest = data.topics.filter((t) => t.status !== "EMERGING" && t.status !== "DECLINING")
  const t = data.thresholds
  return (
    <VStack gap={5}>
      <Card role="region" data-testid="emerging-rule" aria-label="The threshold rule">
        <VStack gap={3}>
          <HStack gap={2} align="center">
            <Icon icon="info" size="sm" color="info" />
            <Heading level={3}>The rule, evaluated in the database</Heading>
          </HStack>
          <Text as="p" data-testid="emerging-rule-text" className="max-w-4xl">{t.rule}</Text>
          <MetadataList columns={4} label={{ position: "top" }}>
            <MetadataListItem label="Minimum per period">{`${t.minWindowResponses} responses`}</MetadataListItem>
            <MetadataListItem label="Minimum for a topic">{`${t.minTopicResponses} responses`}</MetadataListItem>
            <MetadataListItem label="Share must rise by">{`${t.minSharePoints} points`}</MetadataListItem>
            <MetadataListItem label="And at least">{`${1 + t.minRelativeIncrease}× the earlier share`}</MetadataListItem>
          </MetadataList>
          <div data-testid="emerging-windows" className="border-t pt-3">
            <MetadataList columns={2} label={{ position: "top" }}>
              <MetadataListItem label="Latest period"><strong>{formatDay(data.current.from, true)} to {formatDay(data.current.to, true)}</strong> · <span data-testid="sample-current">{num(data.current.freeTextResponses)}</span> free-text responses</MetadataListItem>
              <MetadataListItem label="Earlier period"><strong>{formatDay(data.prior.from, true)} to {formatDay(data.prior.to, true)}</strong> · <span data-testid="sample-prior">{num(data.prior.freeTextResponses)}</span> free-text responses</MetadataListItem>
            </MetadataList>
          </div>
        </VStack>
      </Card>

      {!data.sampleSufficient && (
        <Banner status="warning" data-testid="sample-warning" role="status" title={`One or both periods have fewer than ${t.minWindowResponses} free-text responses, so no topic can be called emerging or declining. Choose a longer period.`} />
      )}

      {data.topics.length === 0 ? (
        <EmptyState title="No free-text responses to compare">There are no recorded free-text responses in either period.</EmptyState>
      ) : (
        <>
          {flagged.length > 0 && (
            <ul data-testid="flagged-topics" className="grid gap-4 lg:grid-cols-2">
              {flagged.map((topic) => (
                <li key={topic.topic}><TopicCard topic={topic} /></li>
              ))}
            </ul>
          )}
          <Table data-testid="emerging-table" aria-label="All derived themes with their status under the rule">
            <TableHeader>
              <TableRow isHeaderRow>
                <TableHeaderCell scope="col">Theme</TableHeaderCell>
                <TableHeaderCell scope="col" className="text-right">Earlier</TableHeaderCell>
                <TableHeaderCell scope="col" className="text-right">Latest</TableHeaderCell>
                <TableHeaderCell scope="col" className="text-right">Change</TableHeaderCell>
                <TableHeaderCell scope="col">Status</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...flagged, ...rest].map((topic) => (
                <TableRow key={topic.topic} data-testid="emerging-row" data-status={topic.status}>
                  <TableCell scope="row"><Text weight="medium">{topic.topic}</Text></TableCell>
                  <TableCell className="text-right tabular-nums">{num(topic.priorResponses)} <Text type="supporting" size="xsm">({pctText(topic.priorShare)})</Text></TableCell>
                  <TableCell className="text-right tabular-nums">{num(topic.currentResponses)} <Text type="supporting" size="xsm">({pctText(topic.currentShare)})</Text></TableCell>
                  <TableCell className="text-right tabular-nums">{topic.sharePointChange === null ? "—" : `${topic.sharePointChange > 0 ? "+" : ""}${topic.sharePointChange.toFixed(1)} pts`}</TableCell>
                  <TableCell><StatusBadge status={topic.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
      <Text type="supporting" as="p" data-testid="emerging-statement" className="max-w-4xl">{data.statement}</Text>
    </VStack>
  )
}

function TopicCard({ topic }: { topic: EmergingTopic }) {
  return (
    <Card data-testid="emerging-card" data-status={topic.status} role="article" height="100%" className={topic.status === "EMERGING" ? "border border-primary/50" : "border border-fact/30"}>
      <VStack gap={3}>
        <VStack as="header" gap={2}>
          <Heading level={4}>{topic.topic}</Heading>
          <HStack gap={2} align="center" wrap="wrap"><StatusBadge status={topic.status} /><DerivedBadge /></HStack>
        </VStack>
        <MetadataList columns={3} label={{ position: "top" }}>
          <MetadataListItem label="Earlier"><strong>{num(topic.priorResponses)}</strong> of {num(topic.priorTotal)} · {pctText(topic.priorShare)}</MetadataListItem>
          <MetadataListItem label="Latest"><strong>{num(topic.currentResponses)}</strong> of {num(topic.currentTotal)} · {pctText(topic.currentShare)}</MetadataListItem>
          <MetadataListItem label="Change in share"><strong>{topic.sharePointChange === null ? "—" : `${topic.sharePointChange > 0 ? "+" : ""}${topic.sharePointChange.toFixed(1)} pts`}</strong></MetadataListItem>
        </MetadataList>
        <Sparkline weeks={topic.weeks} label={`Weekly responses mentioning ${topic.topic}`} />
        {topic.evidence.length > 0 && (
          <VStack gap={2}>
            {topic.evidence.map((e) => (
              <figure key={e.recordId} className="flex flex-col gap-1.5">
                <Blockquote>“{e.excerpt}”</Blockquote>
                <figcaption className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><EvidenceChip recordId={e.recordId} /><span>{e.territoryId} · {e.interactionDate}</span></figcaption>
              </figure>
            ))}
          </VStack>
        )}
      </VStack>
    </Card>
  )
}

/** Weekly counts across both periods. Earlier weeks are grey, latest weeks orange; the axis starts at zero. */
function Sparkline({ weeks, label }: { weeks: WeekCount[]; label: string }) {
  if (weeks.length < 2) return null
  const W = 280
  const H = 56
  const max = Math.max(1, ...weeks.map((w) => w.responses))
  const x = (i: number) => (i / (weeks.length - 1)) * W
  const y = (v: number) => H - 4 - (v / max) * (H - 10)
  const half = Math.floor(weeks.length / 2)
  const path = (from: number, to: number) => weeks.slice(from, to).map((w, i) => `${i === 0 ? "M" : "L"}${x(from + i).toFixed(1)},${y(w.responses).toFixed(1)}`).join(" ")
  return (
    <figure className="min-w-0">
      <svg role="img" aria-label={`${label}: ${weeks.reduce((n, w) => n + w.responses, 0)} responses across ${weeks.length} weeks`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-14 w-full" data-testid="sparkline">
        <line x1="0" x2={W} y1={H - 4} y2={H - 4} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <path d={path(0, half + 1)} fill="none" stroke="var(--muted-foreground)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <path d={path(half, weeks.length)} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="flex justify-between text-[0.7rem] text-muted-foreground"><span>Weeks from {formatDay(weeks[0].weekStart)} (earlier, grey)</span><span>latest (orange)</span></figcaption>
    </figure>
  )
}
