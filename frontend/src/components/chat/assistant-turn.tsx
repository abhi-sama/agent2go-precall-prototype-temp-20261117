"use client"

import { AlertTriangle, BarChart3, FileText, Info, Loader2, Lock } from "lucide-react"
import * as React from "react"
import { AnswerFeedback } from "@/components/chat/answer-feedback"
import { AnswerRows } from "@/components/chat/answer-rows"
import { VisualCard } from "@/components/chat/visual-card"
import { AiSummary, CitationChip, ExportButton, SourceFact, Suggestion, type ProvenanceCitation } from "@/components/provenance/provenance"
import { Badge } from "@/components/ui/badge"
import { useCountUp } from "@/hooks/use-count-up"
import { citationNumber, citationsForFact, factsAreComparable, isAggregateCitation, type AssistantTurn, type CitationItem, type FactItem } from "@/lib/chat/events"
import { buildProvenanceExport, downloadText, type ExportBlock } from "@/lib/provenance"
import { cn } from "@/lib/utils"

const TOOL_LABELS: Record<string, string> = {
  get_activity_summary: "Counting calls, HCPs and responses",
  search_recorded_responses: "Searching recorded responses",
  get_my_scope: "Checking your scope",
  show_chart: "Drawing a chart from your data",
  show_answer_distribution: "Counting answers for a chart",
}

/** A key figure: counted by the database, so it eases up to the exact value and then shows it. */
function KpiTile({ f, turn, onOpenCitation }: { f: FactItem; turn: AssistantTurn; onOpenCitation: (citation: CitationItem) => void }) {
  const shown = useCountUp(f.value, 600)
  const sources = citationsForFact(f, turn.citations)
  const aggregate = sources.length > 0 && sources.every(isAggregateCitation)
  return (
    <div data-testid={`fact-${f.factId}`} data-value={f.value} className="rounded-lg border border-border bg-background p-3">
      <dt className="text-xs font-semibold text-muted-foreground">{f.label}</dt>
      <dd className="mt-1 text-3xl font-semibold tracking-tight tabular-nums" aria-label={f.value.toLocaleString("en-US")}>
        {shown.toLocaleString("en-US")}
      </dd>
      <p className="mt-1 text-xs text-muted-foreground">
        {f.scope} · {f.period}
      </p>
      {f.citationIds.length > 0 && <p className="text-xs text-muted-foreground">{f.citationIds.length} {aggregate ? "aggregate source" : "source records"}</p>}
      {sources.length > 0 && (
        <p className="mt-2 flex flex-wrap gap-1" aria-label={`Sources for ${f.label}`}>
          {sources.map((citation) => (
            <CitationLink key={`${citation.dataset}:${citation.recordId}`} citation={citation} citations={turn.citations} onOpen={onOpenCitation} />
          ))}
        </p>
      )}
    </div>
  )
}

function formatThrough(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
}

function CitationLink({ citation, citations, onOpen }: { citation: CitationItem; citations: CitationItem[]; onOpen: (citation: CitationItem) => void }) {
  const number = citationNumber(citations, citation)
  if (number < 1) return null
  return <button type="button" data-testid="inline-citation" onClick={() => onOpen(citation)} className="ml-1 inline-flex min-h-6 items-center justify-center rounded-md px-1 align-middle pointer-coarse:min-h-11 pointer-coarse:min-w-11 font-mono text-xs font-semibold text-fact underline decoration-fact/40 underline-offset-2 hover:bg-fact/10 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none" aria-label={`Open source ${number}: ${citation.label}`}>[{number}]</button>
}

/** Keep every deterministic claim in the streamed prose adjacent to its evidence. */
function CitedParagraph({ text, turn, onOpenCitation }: { text: string; turn: AssistantTurn; onOpenCitation: (citation: CitationItem) => void }) {
  return <>{text.split(/(?<=[.!?])\s+/).map((sentence, index) => {
    const matchingFacts = turn.facts.filter((fact) => sentence.includes(fact.value.toLocaleString("en-US")) || sentence.includes(String(fact.value)))
    // Qualitative claims may not repeat a number, but still need their retrieved records beside them.
    const evidence = matchingFacts.length > 0 ? matchingFacts.flatMap((fact) => citationsForFact(fact, turn.citations)) : turn.citations
    const unique = evidence.filter((citation, itemIndex) => evidence.findIndex((item) => item.dataset === citation.dataset && item.recordId === citation.recordId) === itemIndex)
    return <React.Fragment key={`${sentence}-${index}`}>{index > 0 && " "}{sentence}{unique.map((citation) => <CitationLink key={`${citation.dataset}:${citation.recordId}`} citation={citation} citations={turn.citations} onOpen={onOpenCitation} />)}</React.Fragment>
  })}</>
}

/** The answer as a file. Facts, the AI summary and suggestions stay in separate, labelled blocks. */
function exportTurn(turn: AssistantTurn, through: string | null) {
  const blocks: ExportBlock[] = [
    {
      kind: "fact",
      title: "Computed from your data",
      lines: turn.facts.map((f) => `${f.label}: ${f.value.toLocaleString("en-US")} (${f.scope}, ${f.period})`),
    },
    {
      kind: "ai",
      title: "Answer",
      lines: turn.text.split(/\n{2,}/).filter(Boolean),
      citations: turn.citations.map((c, i) => ({ number: i + 1, recordId: c.recordId, label: c.label })),
    },
    { kind: "suggestion", title: "You could ask next", lines: turn.suggestions },
  ]
  const text = buildProvenanceExport({ title: "MSL Agent answer", exportedAt: new Date().toISOString(), dataThrough: through, blocks })
  downloadText(`msl-agent-answer-${turn.runId}.md`, text)
}

/**
 * One assistant answer. The three kinds of content are kept apart on purpose:
 *  - Source facts: numbers computed by SQL under the user's access, each with the records behind it.
 *  - AI summary: generated prose, labelled as such; it never introduces a number of its own.
 *  - Suggestions: proposals to act on, never facts.
 */
export function AssistantTurnView({
  turn,
  onAsk,
  onOpenCitation,
  canAsk,
  aggregateOnly,
}: {
  turn: AssistantTurn
  onAsk: (question: string) => void
  onOpenCitation: (citation: CitationItem) => void
  canAsk: boolean
  aggregateOnly: boolean
}) {
  const running = turn.status === "running"
  // A turn restored from an older session copy has no row sets.
  const rowSets = turn.rowSets ?? []
  const through = formatThrough(turn.dataThrough)
  const limitations = turn.sampleLimitations
  // The limitations have their own labelled block; the agent also writes them into the answer text, so don't show them twice.
  const paragraphs = turn.text.split(/\n{2,}/).filter((p) => p && !(limitations.length > 0 && /^sample limitations\b/i.test(p.trim())))
  const activeTools = turn.tools.filter((t) => TOOL_LABELS[t.name])
  const hasAi = Boolean(turn.text) || (running && turn.facts.length === 0 && activeTools.length === 0)
  // Every AI summary carries the records behind it as chips that open them; answers with no prose list them as plain sources.
  const aiCitations: ProvenanceCitation[] = turn.citations.map((c) => ({
    key: `${c.dataset}:${c.recordId}`,
    label: isAggregateCitation(c) ? "Aggregate source" : c.recordId,
    detail: c.label,
    number: citationNumber(turn.citations, c),
    onOpen: () => onOpenCitation(c),
  }))

  return (
    <div data-testid="assistant-turn" data-status={turn.status} className="flex flex-col gap-3">
      {running && activeTools.length > 0 && turn.text === "" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          {TOOL_LABELS[activeTools[activeTools.length - 1].name]}…
        </p>
      )}

      {turn.facts.length > 0 && (
        <SourceFact
          title="Computed from your data"
          meta={
            <>
              {through && <span data-testid="fact-data-through">Data through {through}</span>}
              <span>Counted by database queries, not by the AI.</span>
            </>
          }
        >
          <dl data-testid="source-facts" className="grid gap-3 sm:grid-cols-3">
            {turn.facts.map((f) => (
              <KpiTile key={f.factId} f={f} turn={turn} onOpenCitation={onOpenCitation} />
            ))}
          </dl>
        </SourceFact>
      )}

      {turn.visuals.length > 0 && (
        <section aria-label="Charts" data-testid="visuals" className="grid min-w-0 gap-3">
          {turn.visuals.map((v) => (
            <VisualCard key={v.visualId} item={v} />
          ))}
        </section>
      )}

      {hasAi && (
        <AiSummary
          title={turn.mode === "stub" ? undefined : "Answer"}
          citations={aiCitations}
          meta={
            turn.mode === "stub" ? (
              <Badge data-testid="stub-badge" variant="outline" className="border-warning/50 text-warning">
                Local stub model · no API key
              </Badge>
            ) : (
              <span>{turn.facts.length > 0 ? "Generated by AI from the facts above. Check the sources." : "Generated by AI."}</span>
            )
          }
        >
          <div data-testid="ai-summary" aria-live="polite" className="flex flex-col gap-2">
            {paragraphs.length === 0 ? (
              <p className="text-muted-foreground">Thinking…</p>
            ) : (
              paragraphs.map((p, i) => (
                <p key={i}>
                  <CitedParagraph text={p} turn={turn} onOpenCitation={onOpenCitation} />
                  {running && i === paragraphs.length - 1 && <span aria-hidden className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse bg-ai motion-reduce:animate-none" />}
                </p>
              ))
            )}
          </div>
        </AiSummary>
      )}

      {turn.status === "done" && rowSets.length > 0 && <AnswerRows runId={turn.runId} rowSets={rowSets} />}

      {limitations.length > 0 && (
        <section data-testid="sample-limitations" aria-label="Sample limitations" className="rounded-xl border border-warning/40 bg-warning/8 p-3 text-sm">
          <h4 className="flex items-center gap-2 text-sm font-semibold"><Info className="size-4 text-warning" aria-hidden />Sample limitations</h4>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
            {limitations.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      )}

      {turn.numberCheck?.status === "unverified" && (
        <p data-testid="number-warning" role="alert" className="flex items-start gap-2 rounded-xl border border-warning/50 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          Some figures in this summary could not be matched to the source facts. Rely on the numbers computed from your data.
        </p>
      )}

      {turn.status === "error" && (
        <p data-testid="chat-error" role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm">
          {turn.error ?? "The agent could not complete this answer."}
        </p>
      )}

      {(aggregateOnly || turn.rowsUnavailable) && turn.status === "done" && rowSets.length === 0 && (
        <p data-testid="aggregate-only-note" className="flex items-start gap-2 rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <strong className="font-semibold text-foreground">Rows are not available for this answer.</strong> Your aggregate-only access does not grant
            source-row access, so chat shows aggregates only, with small groups withheld. Records and exports are unavailable in chat.
          </span>
        </p>
      )}

      {!hasAi && turn.citations.length > 0 && (
        <section aria-label="Sources" data-testid="citations" className="flex flex-col gap-2">
          <h4 className="text-xs font-semibold text-muted-foreground">Sources you can open</h4>
          <ul className="flex flex-wrap gap-2">
            {turn.citations.map((c) => (
              <li key={`${c.dataset}:${c.recordId}`}>
                <CitationChip data-testid="citation" aria-label={`Open source: ${c.label}`} onOpen={() => onOpenCitation(c)} className="min-h-11 gap-2 rounded-lg px-3 text-left text-sm">
                  <FileText className="size-4 shrink-0 text-fact" aria-hidden />
                  <span className="flex flex-col leading-tight">
                    <span className="font-mono text-xs">{isAggregateCitation(c) ? "Aggregate source" : c.recordId}</span>
                    <span className="text-xs text-muted-foreground">{c.label}</span>
                  </span>
                </CitationChip>
              </li>
            ))}
          </ul>
        </section>
      )}

      {factsAreComparable(turn.facts) && (
        <section data-testid="chat-fact-chart" aria-label="Computed fact comparison" className="rounded-xl border bg-card p-3">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium"><BarChart3 className="size-4 text-fact" aria-hidden />Computed comparison</div>
          <div className="flex flex-col gap-2">
            {turn.facts.map((fact) => {
              const max = Math.max(...turn.facts.map((item) => item.value), 1)
              return <div key={fact.factId} className="grid grid-cols-[minmax(7rem,1fr)_3rem] items-center gap-3 text-xs"><span className="truncate text-muted-foreground">{fact.label}</span><span className="text-right font-medium tabular-nums">{fact.value.toLocaleString("en-US")}</span><div className="col-span-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-fact" style={{ width: `${Math.max(3, (fact.value / max) * 100)}%` }} /></div></div>
            })}
          </div>
        </section>
      )}

      {turn.status === "done" && turn.suggestions.length > 0 && (
        <Suggestion title="You could ask next">
          <ul className="flex flex-col gap-2">
            {turn.suggestions.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  data-testid="suggestion"
                  disabled={!canAsk}
                  onClick={() => onAsk(s)}
                  className={cn(
                    "min-h-11 w-full rounded-xl border border-suggest/40 bg-background/70 px-3 py-2 text-left text-sm hover:bg-suggest/10 disabled:opacity-50",
                    "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  )}
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </Suggestion>
      )}

      {turn.status === "done" && (turn.text || turn.facts.length > 0) && (
        <div className="flex justify-end">
          <ExportButton onExport={() => exportTurn(turn, through)} label="Download answer" />
        </div>
      )}

      {turn.status === "done" && turn.saved !== null && (
        <p data-testid="saved-note" className="text-xs text-muted-foreground">
          {turn.saved ? "Saved to your conversation history." : "This answer could not be saved to your history."}
        </p>
      )}

      {turn.status === "done" && turn.text !== "" && <AnswerFeedback runId={turn.runId} />}
    </div>
  )
}
