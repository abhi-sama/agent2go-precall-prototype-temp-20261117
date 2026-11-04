"use client"

import * as React from "react"
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
    <article
      data-testid="theme-card"
      data-topic={card.topic}
      data-trend={card.trend}
      style={{ animationDelay: `${Math.min(index, 5) * 45}ms` }}
      className="flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-4 shadow-card animate-in fade-in-0 slide-in-from-bottom-1 duration-200 fill-mode-backwards motion-reduce:animate-none sm:p-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <h4 className="min-w-0 break-words text-base font-semibold">{card.topic}</h4>
        <TrendIndicator trend={card.trend} />
      </header>
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><DerivedBadge />Grouped from free text by keyword</p>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-4xl font-semibold tracking-tight"><Figure count={card.responses} minCell={minCell} testId="card-responses" /></p>
        <p className="text-sm text-muted-foreground">free-text responses{card.share !== null && <span data-testid="card-share" className="ml-1 tabular-nums">· {pct(card.share)} of the group</span>}</p>
      </div>
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div><dt className="text-xs text-muted-foreground">Distinct HCPs</dt><dd className="font-semibold"><CountValue count={card.distinctHcps} minCell={minCell} testId="card-hcps" /></dd></div>
        <div><dt className="text-xs text-muted-foreground">Regions</dt><dd className="font-semibold tabular-nums">{card.regionCount}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Earlier period</dt><dd className="font-semibold"><CountValue count={card.priorResponses} minCell={minCell} /></dd></div>
      </dl>
      <div className="mt-auto"><CitationList citations={card.citations} label={`Sources for ${card.topic}`} /></div>
    </article>
  )
}

function Group({ group, minCell, showHeading }: { group: ExecutiveThemeGroup; minCell: number; showHeading: boolean }) {
  return (
    <section data-testid="theme-group" data-facet-value={group.facetValue} aria-label={group.facetValue} className="flex min-w-0 flex-col gap-3">
      {showHeading && (
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-lg font-semibold capitalize">{group.facetValue}</h3>
          <p className="text-sm text-muted-foreground">
            <Figure count={group.freeTextResponses} minCell={minCell} className="font-semibold text-foreground" /> free-text responses in {group.regionCount} region{group.regionCount === 1 ? "" : "s"}
          </p>
        </header>
      )}
      {group.cards.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No free-text responses in this period for {group.facetValue}.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
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
    <div data-testid="theme-cards" data-facet={data.facet} className="flex flex-col gap-6">
      {data.groups.map((g) => <Group key={g.facetValue} group={g} minCell={min} showHeading={data.facet !== "PORTFOLIO"} />)}
      {data.groupsLeftOut > 0 && <p className="text-sm text-muted-foreground">{num(data.groupsLeftOut)} more {data.facetLabel.toLowerCase()} values are not shown.</p>}
      <SampleLimitations items={data.sampleLimitations} />
      <p className="text-xs text-muted-foreground">{data.note}</p>
    </div>
  )
}
