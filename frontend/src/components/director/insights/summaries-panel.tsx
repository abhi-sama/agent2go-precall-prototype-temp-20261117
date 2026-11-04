"use client"

import { Sparkles } from "lucide-react"
import * as React from "react"
import { AssistantTurnView } from "@/components/chat/assistant-turn"
import { SourceFact } from "@/components/provenance/provenance"
import { EmptyState, ErrorState } from "@/components/state/states"
import { Button } from "@/components/ui/button"
import { useChat } from "@/lib/chat/use-chat"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { ChatContext, TerritorySummaryEvidence } from "@/lib/data/director-insights"
import type { DateRange } from "@/lib/data/types"
import { useQuery } from "@/lib/data/use-query"
import { useSession } from "@/lib/session/session-provider"
import { DerivedBadge, EvidenceChip, InsightSection, num, PanelLoading, PanelMeta, pctText, StatusBadge, useOpenCitation } from "./shared"

const INITIAL_CARDS = 4

/**
 * Territory summaries. Each card shows the source figures and cited responses first, in plain facts. The summary
 * text is generated on request by the agent over the approved path, labelled as AI, and cites the same evidence.
 */
export function SummariesPanel({ range }: { range: DateRange }) {
  const adapter = useDataAdapter()
  const { userId, ready } = useSession()
  const [showAll, setShowAll] = React.useState(false)
  const query = useQuery("territorySummaryEvidence", `${userId}:${range.from}:${range.to}`, (ctx) => adapter.territorySummaryEvidence(ctx, range), ready)
  const data = query.status === "success" ? query.data : null
  const cards = data ? (showAll ? data.territories : data.territories.slice(0, INITIAL_CARDS)) : []

  return (
    <InsightSection
      id="summaries"
      title="Territory summaries"
      note="What each territory's recorded responses mention and what changed since the period before. Figures are counted from your data; summary text is written by AI on request."
      meta={data && <PanelMeta from={data.from} to={data.to} dataThrough={data.dataThrough}><span>Compared with {data.priorFrom} to {data.priorTo}</span></PanelMeta>}
    >
      {query.status === "error" ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : !data ? (
        <PanelLoading testId="summaries-loading" height="h-72" />
      ) : data.territories.length === 0 ? (
        <EmptyState title="No territories to summarise">No territory in your scope has activity in this period.</EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <ul data-testid="summary-cards" className="grid gap-4 xl:grid-cols-2">
            {cards.map((t) => (
              <li key={t.territoryId} className="min-w-0"><SummaryCard t={t} range={range} /></li>
            ))}
          </ul>
          {data.territories.length > INITIAL_CARDS && (
            <div>
              <Button variant="outline" data-testid="summaries-toggle" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Show fewer territories" : `Show all ${data.territories.length} territories`}
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{data.note}</p>
        </div>
      )}
    </InsightSection>
  )
}

function SummaryCard({ t, range }: { t: TerritorySummaryEvidence; range: DateRange }) {
  const adapter = useDataAdapter()
  const openCitation = useOpenCitation()
  const { turns, running, send } = useChat(adapter)
  const turn = turns[turns.length - 1]
  const context = (intent: ChatContext["intent"]): ChatContext => ({ intent, view: "director-insights", territoryId: t.territoryId, from: range.from, to: range.to })
  const generate = () => void send(`Summarize the recorded themes and changes in ${t.territoryId} for ${range.from} to ${range.to}.`, context("TERRITORY_SUMMARY"))

  return (
    <article data-testid="summary-card" data-territory={t.territoryId} className="flex h-full min-w-0 flex-col gap-4 rounded-2xl border bg-card p-4 sm:p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">{t.territoryId}{t.name ? <span className="font-normal text-muted-foreground"> · {t.name}</span> : null}</h3>
        <span className="text-xs text-muted-foreground">{t.regionName}</span>
      </header>

      <SourceFact title="Source figures" meta={<span>Counted by database queries, not by the AI.</span>}>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[["Distinct calls", t.distinctCalls], ["Engaged HCPs", t.distinctEngagedHcps], ["Responses", t.responses], ["Free-text responses", t.freeTextResponses]].map(([k, v]) => (
            <div key={k as string}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="text-xl font-semibold tabular-nums">{num(v as number)}</dd></div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">{num(t.priorFreeTextResponses)} free-text responses in the earlier period.</p>
      </SourceFact>

      <section aria-label="Most recorded themes" className="flex flex-col gap-3">
        <h4 className="flex flex-wrap items-center gap-2 text-sm font-semibold">Most recorded themes <DerivedBadge /> <span className="font-normal text-muted-foreground">grouped from free text by keyword</span></h4>
        {t.topThemes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No free-text responses in this period.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {t.topThemes.map((theme) => (
              <li key={theme.topic} data-testid="summary-theme" className="flex flex-col gap-1.5 rounded-xl border bg-background p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{theme.topic}</span>
                  <StatusBadge status={theme.status} />
                </div>
                <p className="text-sm text-muted-foreground tabular-nums">{num(theme.currentResponses)} of {num(theme.currentTotal)} ({pctText(theme.currentShare)}) now, {num(theme.priorResponses)} of {num(theme.priorTotal)} ({pctText(theme.priorShare)}) before</p>
                {theme.evidence.length > 0 && <div className="flex flex-wrap gap-2">{theme.evidence.map((e) => <EvidenceChip key={e.recordId} recordId={e.recordId} />)}</div>}
              </li>
            ))}
          </ul>
        )}
        {t.flagged.length > 0 && (
          <p data-testid="summary-flagged" className="text-sm"><strong>Flagged by the rule:</strong> {t.flagged.map((f) => `${f.topic} (${f.status.toLowerCase()})`).join(", ")}.</p>
        )}
      </section>

      <div className="mt-auto flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button data-testid="generate-summary" onClick={generate} disabled={running}>
            <Sparkles aria-hidden /> {running ? "Generating…" : turn ? "Regenerate AI summary" : "Generate AI summary"}
          </Button>
          <span className="text-xs text-muted-foreground">AI-generated on request. It cites the responses above.</span>
        </div>
        {/* Inline [n] citation markers sit inside a sentence (the WCAG 2.5.8 inline-target exception) and also open from the citation list. */}
        {turn && (
          <div data-testid="summary-result" data-layout-ok="touch" aria-live="polite">
            <AssistantTurnView aggregateOnly={false} turn={turn.answer} onAsk={(q) => void send(q, context("FREE"))} onOpenCitation={openCitation} canAsk={!running} />
          </div>
        )}
      </div>
    </article>
  )
}
