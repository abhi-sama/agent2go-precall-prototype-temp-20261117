"use client"

/**
 * CopilotKit activity renderers for Ask the agent (docs/adr/0018): how the computed side of an answer is drawn in the
 * thread. They are registered once, on the provider (`renderActivityMessages`), and receive only content that passed
 * their schema; the evidence inside is parsed again by `lib/chat/events.ts` on every render.
 *
 *  - `a2g-answer`, head: the figures counted by the database and the charts drawn from SQL (ADR 0007, 0009).
 *  - `a2g-answer`, tail: the exact rows behind a figure (ADR 0015), the sample limitations, the number check, the
 *    run's outcome, a preference the agent suggests remembering (ADR 0023), the aggregate-only note, and the sources of an answer that has no text.
 *  - `a2ui-surface`: an A2UI surface from the allow-listed answer catalog (ADR 0017).
 */

import type { ReactActivityMessageRenderer } from "@copilotkit/react-core/v2"
import { AlertTriangle, BarChart3, Info, Lock, Download } from "lucide-react"
import dynamic from "next/dynamic"
import * as React from "react"
import { z } from "zod"
import { AnswerRows } from "@/components/chat/answer-rows"
import { KindLabel, ProvenanceBlock } from "@/components/chat/chat-provenance"
import { MemorySuggestionCard } from "@/components/chat/memory-suggestion"
import { useChatSession } from "@/components/chat/chat-session"
import { SourcesRow, useChatThread, useTurn } from "@/components/chat/chat-thread"
import { VisualCard } from "@/components/chat/visual-card"
import { useCountUp } from "@/hooks/use-count-up"
import { ANSWER_ACTIVITY, answerActivitySchema, evidenceOf, type AnswerActivity } from "@/lib/chat/agent/answer"
import { A2UI_ACTIVITY_TYPE, A2UI_OPERATIONS_KEY, surfaceFromActivity } from "@/lib/chat/a2ui/protocol"
import { citationsForFact, factsAreComparable, isAggregateCitation, type AssistantTurn, type FactItem } from "@/lib/chat/events"
import { exportAnswer, formatThrough } from "@/lib/chat/export"
import { cn } from "@/lib/utils"

/**
 * The A2UI renderer and catalog load with the first answer that has a surface (ADR 0017), in their own chunk and only
 * in the browser: the renderer defines custom elements when it loads, which a server render cannot do.
 */
const AnswerSurfaces = dynamic(() => import("@/components/chat/answer-surfaces"), { ssr: false, loading: () => null })

// ---------------------------------------------------------------------------------------------------------------
// Head: what the database counted
// ---------------------------------------------------------------------------------------------------------------

/** A key figure: counted by the database, so it eases up to the exact value and then shows it. */
function KpiTile({ fact, turn }: { fact: FactItem; turn: AssistantTurn }) {
  const shown = useCountUp(fact.value, 600)
  const sources = citationsForFact(fact, turn.citations)
  const aggregate = sources.length > 0 && sources.every(isAggregateCitation)
  return (
    <div data-testid={`fact-${fact.factId}`} data-value={fact.value} className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-muted/40 p-3">
      <dt className="text-xs font-medium text-muted-foreground">{fact.label}</dt>
      <dd aria-label={fact.value.toLocaleString("en-US")} className="text-2xl font-semibold tabular-nums text-foreground">
        {shown.toLocaleString("en-US")}
      </dd>
      <dd className="text-xs text-muted-foreground">
        {fact.scope} · {fact.period}
      </dd>
      {fact.citationIds.length > 0 && (
        <dd className="text-xs text-muted-foreground">
          {fact.citationIds.length} {aggregate ? "aggregate source" : "source records"}
        </dd>
      )}
    </div>
  )
}

/** The figures side by side, when they share a measure. */
function FactComparison({ facts }: { facts: FactItem[] }) {
  const max = Math.max(...facts.map((f) => f.value), 1)
  return (
    <section data-testid="chat-fact-chart" aria-label="Computed fact comparison" className="mt-3 flex flex-col gap-2">
      <h4 className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <BarChart3 aria-hidden className="size-3.5" /> Computed comparison
      </h4>
      <dl className="flex flex-col gap-2">
        {facts.map((fact) => (
          <div key={fact.factId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
            <dt className="truncate text-xs text-foreground">{fact.label}</dt>
            <dd className="text-xs font-semibold tabular-nums text-foreground">{fact.value.toLocaleString("en-US")}</dd>
            <dd aria-hidden className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-foreground/70" style={{ width: `${(fact.value / max) * 100}%` }} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function AnswerHead({ turn }: { turn: AssistantTurn }) {
  const through = formatThrough(turn.dataThrough)
  if (turn.facts.length === 0 && turn.visuals.length === 0) return null
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {turn.facts.length > 0 && (
        <ProvenanceBlock
          kind="fact"
          title="Computed from your data"
          meta={
            <>
              {through && <span data-testid="fact-data-through">Data through {through}</span>}
              <span>Counted by database queries, not by the AI.</span>
            </>
          }
        >
          <dl data-testid="source-facts" className="grid gap-2 sm:grid-cols-3">
            {turn.facts.map((fact) => (
              <KpiTile key={fact.factId} fact={fact} turn={turn} />
            ))}
          </dl>
          {factsAreComparable(turn.facts) && <FactComparison facts={turn.facts} />}
        </ProvenanceBlock>
      )}
      {turn.visuals.length > 0 && (
        <section aria-label="Charts" data-testid="visuals" className="flex min-w-0 flex-col gap-3">
          {turn.visuals.map((v) => (
            <VisualCard key={v.visualId} item={v} />
          ))}
        </section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Tail: the outcome, the rows and the warnings
// ---------------------------------------------------------------------------------------------------------------

function Notice({ tone, icon: Glyph, title, children, ...rest }: { tone: "info" | "warning" | "error"; icon: React.ComponentType<{ className?: string }>; title: string; children?: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={cn(
        "flex min-w-0 gap-2 rounded-xl border px-3 py-2 text-sm text-foreground",
        tone === "error" ? "border-destructive/50 bg-destructive/10" : tone === "warning" ? "border-amber-500/50 bg-amber-500/10" : "border-border bg-muted/50",
      )}
    >
      <Glyph aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-medium">{title}</p>
        {children}
      </div>
    </div>
  )
}

function AnswerTail({ turn, activity }: { turn: AssistantTurn; activity: AnswerActivity }) {
  const info = useTurn()
  const { aggregateOnly } = useChatThread()
  const done = turn.status === "done"
  const text = info?.turn.text ?? ""
  const rowSets = turn.rowSets
  const limitations = turn.sampleLimitations
  const through = formatThrough(turn.dataThrough)
  return (
    <div data-testid="answer-tail" data-run-id={activity.runId} className="flex min-w-0 flex-col gap-3">
      {done && rowSets.length > 0 && <AnswerRows runId={turn.runId} rowSets={rowSets} />}

      {limitations.length > 0 && (
        <Notice data-testid="sample-limitations" aria-label="Sample limitations" tone="warning" icon={Info} title="Sample limitations">
          <ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
            {limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Notice>
      )}

      {turn.numberCheck?.status === "unverified" && (
        <Notice
          data-testid="number-warning"
          role="alert"
          tone="warning"
          icon={AlertTriangle}
          title="Some figures in this summary could not be matched to the source facts. Rely on the numbers computed from your data."
        />
      )}

      {turn.status === "error" && <Notice data-testid="chat-error" role="alert" tone="error" icon={AlertTriangle} title={turn.error ?? "The agent could not complete this answer."} />}

      {(aggregateOnly || turn.rowsUnavailable) && done && rowSets.length === 0 && (
        <Notice data-testid="aggregate-only-note" tone="info" icon={Lock} title="Rows are not available for this answer.">
          <p className="text-muted-foreground">
            Your aggregate-only access does not grant source-row access, so chat shows aggregates only, with small groups withheld. Records and exports are unavailable in chat.
          </p>
        </Notice>
      )}

      {!text.trim() && turn.citations.length > 0 && (
        <section aria-label="Sources" className="min-w-0">
          <KindLabel kind="fact" label="Sources you can open" />
          <SourcesRow citations={turn.citations} label="Sources you can open" />
        </section>
      )}

      {done && !text.trim() && turn.facts.length > 0 && (
        <div>
          <button
            type="button"
            data-testid="export-answer"
            onClick={() => exportAnswer(turn, "", through)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border px-3 text-sm text-foreground hover:bg-accent pointer-coarse:min-h-11"
          >
            <Download aria-hidden className="size-4" /> Download answer
          </button>
        </div>
      )}

      {done && turn.memorySuggestions.map((suggestion) => <MemorySuggestionCard key={suggestion.text} runId={turn.runId} suggestion={suggestion} />)}

      {done && turn.saved !== null && (
        <p data-testid="saved-note" className="text-xs text-muted-foreground">
          {turn.saved ? "Saved to your conversation history." : "This answer could not be saved to your history."}
        </p>
      )}
    </div>
  )
}

function AnswerActivityView({ content }: { content: AnswerActivity }) {
  const turn = React.useMemo(() => evidenceOf(content), [content])
  return content.part === "head" ? <AnswerHead turn={turn} /> : <AnswerTail turn={turn} activity={content} />
}

// ---------------------------------------------------------------------------------------------------------------
// A2UI surfaces
// ---------------------------------------------------------------------------------------------------------------

const surfaceContentSchema = z.object({ [A2UI_OPERATIONS_KEY]: z.array(z.record(z.unknown())).max(64) })

function SurfaceActivityView({ content, message }: { content: z.infer<typeof surfaceContentSchema>; message: { id: string } }) {
  const info = useTurn()
  const { running } = useChatSession()
  const { sendSurfaceAction } = useChatThread()
  // Screened again here: a restored conversation passes the same gate as a live one.
  const item = React.useMemo(() => surfaceFromActivity({ type: "ACTIVITY_SNAPSHOT", activityType: A2UI_ACTIVITY_TYPE, messageId: message.id, content }), [content, message.id])
  const surfaces = React.useMemo(() => (item ? [item] : []), [item])
  if (!item) return null
  // A form that asks again appears once its answer has finished, before the suggestions.
  if (item.slot === "follow_up" && info?.status !== "done") return null
  return (
    <section
      aria-label={item.slot === "evidence" ? "Tables from your data" : "Refine this answer"}
      data-testid={item.slot === "evidence" ? "answer-surfaces" : "answer-follow-up-surfaces"}
      className="flex min-w-0 flex-col gap-3"
    >
      <AnswerSurfaces surfaces={surfaces} canAct={!running} onAction={sendSurfaceAction} />
    </section>
  )
}

/** Each renderer is typed against its own schema, then listed together for the provider. */
const renderer = <T,>(r: ReactActivityMessageRenderer<T>) => r as unknown as ReactActivityMessageRenderer<unknown>

export const ANSWER_RENDERERS: ReactActivityMessageRenderer<unknown>[] = [
  renderer({ activityType: ANSWER_ACTIVITY, content: answerActivitySchema, render: AnswerActivityView }),
  renderer({ activityType: A2UI_ACTIVITY_TYPE, content: surfaceContentSchema, render: SurfaceActivityView }),
]
