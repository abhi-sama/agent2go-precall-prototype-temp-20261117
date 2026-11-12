"use client"

import * as React from "react"
import { Card } from "@astryxdesign/core/Card"
import { Heading } from "@astryxdesign/core/Heading"
import { Text } from "@astryxdesign/core/Text"
import { DerivedBadge, num } from "@/components/director/insights/shared"
import { useCountUp } from "@/hooks/use-count-up"
import type { ExecutiveThemeCard, ExecutiveThemeGroup, ExecutiveThemes } from "@/lib/data/executive-themes"
import type { SuppressedCount } from "@/lib/data/types"
import { cn } from "@/lib/utils"
import { CountValue } from "../count"
import { CitationList, pct, SampleLimitations, TrendIndicator } from "./parts"

/** A figure that eases up to its exact value when it first appears; a withheld count is a labelled placeholder instead. */
export function Figure({ count, minCell, className, testId }: { count: SuppressedCount; minCell: number; className?: string; testId?: string }) {
  if (count.suppressed || count.value === null) return <CountValue count={count} minCell={minCell} className={className} testId={testId} />
  return <AnimatedNumber value={count.value} className={className} testId={testId} />
}

function AnimatedNumber({ value, className, testId }: { value: number; className?: string; testId?: string }) {
  const shown = useCountUp(value, 400)
  return (
    <span data-testid={testId} data-value={value} aria-label={value.toLocaleString("en-US")} className={cn("tabular-nums", className)}>
      {shown.toLocaleString("en-US")}
    </span>
  )
}

function ThemeCard({ card, minCell, index }: { card: ExecutiveThemeCard; minCell: number; index: number }) {
  return (
    <Card
      data-testid="theme-card"
      data-topic={card.topic}
      data-trend={card.trend}
      style={{ animationDelay: `${Math.min(index, 5) * 45}ms` }}
      padding={4}
      elevation="low"
      className="flex min-w-0 flex-col gap-3 animate-in fade-in-0 slide-in-from-bottom-1 duration-200 fill-mode-backwards motion-reduce:animate-none"
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <Heading level={4} className="min-w-0">{card.topic}</Heading>
        <TrendIndicator trend={card.trend} />
      </header>
      <Text as="p" type="supporting" display="block"><DerivedBadge />Grouped from free text by keyword</Text>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Text as="p" type="display-2" weight="semibold" hasTabularNumbers><Figure count={card.responses} minCell={minCell} testId="card-responses" /></Text>
        <Text as="p" type="supporting">free-text responses{card.share !== null && <span data-testid="card-share" className="ml-1 tabular-nums">· {pct(card.share)} of the group</span>}</Text>
      </div>
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div><dt className="text-xs text-muted-foreground">Distinct HCPs</dt><dd className="font-semibold"><CountValue count={card.distinctHcps} minCell={minCell} testId="card-hcps" /></dd></div>
        <div><dt className="text-xs text-muted-foreground">Regions</dt><dd className="font-semibold tabular-nums">{card.regionCount}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Earlier period</dt><dd className="font-semibold"><CountValue count={card.priorResponses} minCell={minCell} /></dd></div>
      </dl>
      <div className="mt-auto"><CitationList citations={card.citations} label={`Sources for ${card.topic}`} /></div>
    </Card>
  )
}

function Group({ group, minCell, showHeading }: { group: ExecutiveThemeGroup; minCell: number; showHeading: boolean }) {
  return (
    <section data-testid="theme-group" data-facet-value={group.facetValue} aria-label={group.facetValue} className="flex min-w-0 flex-col gap-3">
      {showHeading && (
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Heading level={3}>{group.facetValue}</Heading>
          <Text as="p" type="supporting">
            <Figure count={group.freeTextResponses} minCell={minCell} className="font-semibold text-foreground" /> free-text responses in {group.regionCount} region{group.regionCount === 1 ? "" : "s"}
          </Text>
        </header>
      )}
      {group.cards.length === 0 ? (
        <Card variant="muted" padding={4}><Text as="p" type="supporting">No free-text responses in this period for {group.facetValue}.</Text></Card>
      ) : (
        <div className="a2g-exec-themes-grid">
          {group.cards.map((card, i) => <ThemeCard key={card.cardId} card={card} minCell={minCell} index={i} />)}
        </div>
      )}
    </section>
  )
}

/** Theme cards per facet value. Counts are the BE's; a withheld count is a placeholder, and every card cites its source set. */
export function ThemeCards({ data }: { data: ExecutiveThemes }) {
  const min = data.disclosure.minCell
  return (
    <div data-testid="theme-cards" data-facet={data.facet} className="a2g-exec-themes-scope flex flex-col gap-4">
      {data.groups.map((g) => <Group key={g.facetValue} group={g} minCell={min} showHeading={data.facet !== "PORTFOLIO"} />)}
      {data.groupsLeftOut > 0 && <Text as="p" type="supporting">{num(data.groupsLeftOut)} more {data.facetLabel.toLowerCase()} values are not shown.</Text>}
      <SampleLimitations items={data.sampleLimitations} />
      <Text as="p" type="supporting">{data.note}</Text>
    </div>
  )
}
