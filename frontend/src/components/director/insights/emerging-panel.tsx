"use client"

import { Info } from "lucide-react"
import * as React from "react"
import { EmptyState, ErrorState } from "@/components/state/states"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { EmergingTopic, EmergingTopics, WeekCount } from "@/lib/data/director-insights"
import type { DateRange, InsightFilters } from "@/lib/data/types"
import { useQuery } from "@/lib/data/use-query"
import { formatDay } from "@/lib/dates"
import { useSession } from "@/lib/session/session-provider"
import { cn } from "@/lib/utils"
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
        <PanelLoading testId="emerging-loading" height="h-80" />
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
    <div className="flex flex-col gap-5">
      <section data-testid="emerging-rule" aria-label="The threshold rule" className="rounded-2xl border bg-card p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Info className="size-4 text-fact" aria-hidden /> The rule, evaluated in the database</h3>
        <p data-testid="emerging-rule-text" className="mt-2 max-w-4xl text-sm">{t.rule}</p>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          {[
            ["Minimum per period", `${t.minWindowResponses} responses`],
            ["Minimum for a topic", `${t.minTopicResponses} responses`],
            ["Share must rise by", `${t.minSharePoints} points`],
            ["And at least", `${1 + t.minRelativeIncrease}× the earlier share`],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        <dl data-testid="emerging-windows" className="mt-4 grid gap-3 border-t pt-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Latest period</dt>
            <dd className="tabular-nums"><strong>{formatDay(data.current.from, true)} to {formatDay(data.current.to, true)}</strong> · <span data-testid="sample-current">{num(data.current.freeTextResponses)}</span> free-text responses</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Earlier period</dt>
            <dd className="tabular-nums"><strong>{formatDay(data.prior.from, true)} to {formatDay(data.prior.to, true)}</strong> · <span data-testid="sample-prior">{num(data.prior.freeTextResponses)}</span> free-text responses</dd>
          </div>
        </dl>
      </section>

      {!data.sampleSufficient && (
        <p data-testid="sample-warning" role="status" className="rounded-xl border border-warning/50 bg-warning/10 p-3 text-sm">
          One or both periods have fewer than {t.minWindowResponses} free-text responses, so no topic can be called emerging or declining. Choose a longer period.
        </p>
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
          <div className="overflow-x-auto rounded-xl border" role="region" aria-label="All topics, scrolls sideways" tabIndex={0}>
            <table data-testid="emerging-table" className="w-full min-w-[40rem] border-collapse text-sm">
              <caption className="sr-only">All derived themes with their status under the rule</caption>
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-medium">Theme</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Earlier</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Latest</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Change</th>
                  <th scope="col" className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {[...flagged, ...rest].map((topic) => (
                  <tr key={topic.topic} data-testid="emerging-row" data-status={topic.status} className="border-b last:border-b-0">
                    <th scope="row" className="px-3 py-2 text-left font-medium">{topic.topic}</th>
                    <td className="px-2 py-2 text-right tabular-nums">{num(topic.priorResponses)} <span className="text-xs text-muted-foreground">({pctText(topic.priorShare)})</span></td>
                    <td className="px-2 py-2 text-right tabular-nums">{num(topic.currentResponses)} <span className="text-xs text-muted-foreground">({pctText(topic.currentShare)})</span></td>
                    <td className="px-2 py-2 text-right tabular-nums">{topic.sharePointChange === null ? "—" : `${topic.sharePointChange > 0 ? "+" : ""}${topic.sharePointChange.toFixed(1)} pts`}</td>
                    <td className="px-3 py-2"><StatusBadge status={topic.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p data-testid="emerging-statement" className="max-w-4xl text-sm text-muted-foreground">{data.statement}</p>
    </div>
  )
}

function TopicCard({ topic }: { topic: EmergingTopic }) {
  return (
    <article data-testid="emerging-card" data-status={topic.status} className={cn("flex h-full min-w-0 flex-col gap-3 rounded-2xl border bg-card p-4", topic.status === "EMERGING" ? "border-primary/50" : "border-fact/30")}>
      <header className="flex flex-col gap-2">
        <h4 className="text-base font-semibold">{topic.topic}</h4>
        <div className="flex flex-wrap items-center gap-2"><StatusBadge status={topic.status} /><DerivedBadge /></div>
      </header>
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div><dt className="text-xs text-muted-foreground">Earlier</dt><dd className="tabular-nums"><strong>{num(topic.priorResponses)}</strong> of {num(topic.priorTotal)}<span className="block text-xs text-muted-foreground">{pctText(topic.priorShare)}</span></dd></div>
        <div><dt className="text-xs text-muted-foreground">Latest</dt><dd className="tabular-nums"><strong>{num(topic.currentResponses)}</strong> of {num(topic.currentTotal)}<span className="block text-xs text-muted-foreground">{pctText(topic.currentShare)}</span></dd></div>
        <div><dt className="text-xs text-muted-foreground">Change in share</dt><dd className="tabular-nums"><strong>{topic.sharePointChange === null ? "—" : `${topic.sharePointChange > 0 ? "+" : ""}${topic.sharePointChange.toFixed(1)} pts`}</strong></dd></div>
      </dl>
      <Sparkline weeks={topic.weeks} label={`Weekly responses mentioning ${topic.topic}`} />
      {topic.evidence.length > 0 && (
        <div className="flex flex-col gap-2">
          {topic.evidence.map((e) => (
            <figure key={e.recordId} className="flex flex-col gap-1.5">
              <blockquote className="border-l-2 border-ai/50 pl-3 text-sm italic text-muted-foreground">“{e.excerpt}”</blockquote>
              <figcaption className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><EvidenceChip recordId={e.recordId} /><span>{e.territoryId} · {e.interactionDate}</span></figcaption>
            </figure>
          ))}
        </div>
      )}
    </article>
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
