"use client"

import { BarChart3, FileText, Lock } from "lucide-react"
import * as React from "react"
import { Avatar } from "@astryxdesign/core/Avatar"
import { Badge } from "@astryxdesign/core/Badge"
import { Banner } from "@astryxdesign/core/Banner"
import { Button } from "@astryxdesign/core/Button"
import { Citation } from "@astryxdesign/core/Citation"
import { ChatMessage, ChatMessageBubble, ChatToolCalls } from "@astryxdesign/core/Chat"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { Markdown } from "@astryxdesign/core/Markdown"
import { ProgressBar } from "@astryxdesign/core/ProgressBar"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import { AnswerFeedback } from "@/components/chat/answer-feedback"
import { AnswerRows } from "@/components/chat/answer-rows"
import { VisualCard } from "@/components/chat/visual-card"
import { AiSummary, CitationChip, ExportButton, SourceFact, Suggestion, type ProvenanceCitation } from "@/components/provenance/provenance"
import { useCountUp } from "@/hooks/use-count-up"
import { citationNumber, citationsForFact, factsAreComparable, isAggregateCitation, type AssistantTurn, type CitationItem, type FactItem } from "@/lib/chat/events"
import { buildProvenanceExport, downloadText, type ExportBlock } from "@/lib/provenance"

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
    <VStack data-testid={`fact-${f.factId}`} data-value={f.value} gap={3} padding={3} className="rounded-lg border border-border bg-background">
      <dt><Text type="label" weight="semibold" color="secondary">{f.label}</Text></dt>
      <dd aria-label={f.value.toLocaleString("en-US")}>
        <Text type="display-3" hasTabularNumbers>{shown.toLocaleString("en-US")}</Text>
      </dd>
      <Text as="p" type="supporting">
        {f.scope} · {f.period}
      </Text>
      {f.citationIds.length > 0 && <Text as="p" type="supporting">{f.citationIds.length} {aggregate ? "aggregate source" : "source records"}</Text>}
      {sources.length > 0 && (
        <HStack as="p" gap={1} wrap="wrap" aria-label={`Sources for ${f.label}`}>
          {sources.map((citation) => (
            <CitationLink key={`${citation.dataset}:${citation.recordId}`} citation={citation} citations={turn.citations} onOpen={onOpenCitation} />
          ))}
        </HStack>
      )}
    </VStack>
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
  return (
    <Citation
      data-testid="inline-citation"
      source={{ title: citation.label, url: `#citation-${number}` }}
      number={number}
      variant="number"
      // Dark looks put the default secondary text on the muted accent below 4.5:1, and the 20px chip is under the
      // 44pt touch minimum on tablets, so draw it in the primary text colour and grow it on coarse pointers.
      className="align-baseline text-(--color-text-primary) pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      aria-label={`Open source ${number}: ${citation.label}`}
      onClick={(event) => {
        event.preventDefault()
        onOpen(citation)
      }}
    />
  )
}

/** Keep every deterministic claim in the streamed prose adjacent to its evidence. */
function CitedParagraph({ text, turn, onOpenCitation }: { text: string; turn: AssistantTurn; onOpenCitation: (citation: CitationItem) => void }) {
  return <>{text.split(/(?<=[.!?])\s+/).map((sentence, index) => {
    const matchingFacts = turn.facts.filter((fact) => sentence.includes(fact.value.toLocaleString("en-US")) || sentence.includes(String(fact.value)))
    // Qualitative claims may not repeat a number, but still need their retrieved records beside them.
    const evidence = matchingFacts.length > 0 ? matchingFacts.flatMap((fact) => citationsForFact(fact, turn.citations)) : turn.citations
    const unique = evidence.filter((citation, itemIndex) => evidence.findIndex((item) => item.dataset === citation.dataset && item.recordId === citation.recordId) === itemIndex)
    return <React.Fragment key={`${sentence}-${index}`}>{index > 0 && " "}<Markdown display="inline" isStreaming={turn.status === "running"} className="contents">{sentence}</Markdown>{unique.map((citation) => <CitationLink key={`${citation.dataset}:${citation.recordId}`} citation={citation} citations={turn.citations} onOpen={onOpenCitation} />)}</React.Fragment>
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
    <ChatMessage sender="assistant" name="Agent" avatar={<Avatar name="Agent" size="sm" tooltip={false} />} data-testid="assistant-turn" data-status={turn.status}>
      <ChatMessageBubble variant="ghost" width="100%">
        <VStack gap={3} className="min-w-0">
      {activeTools.length > 0 && (
        <ChatToolCalls
          calls={activeTools.map((tool) => ({
            key: tool.name,
            name: tool.name,
            target: TOOL_LABELS[tool.name],
            status: running ? "running" : turn.status === "error" ? "error" : "complete",
            ...(turn.status === "error" && turn.error ? { errorMessage: turn.error } : {}),
          }))}
          label="Agent activity"
          defaultIsExpanded={running}
        />
      )}

      {turn.facts.length > 0 && (
        <SourceFact
          title="Computed from your data"
          meta={
            <>
              {through && <Text type="supporting" data-testid="fact-data-through">Data through {through}</Text>}
              <Text type="supporting">Counted by database queries, not by the AI.</Text>
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
        <VStack as="section" aria-label="Charts" data-testid="visuals" gap={3} className="min-w-0">
          {turn.visuals.map((v) => (
            <VisualCard key={v.visualId} item={v} />
          ))}
        </VStack>
      )}

      {hasAi && (
        <AiSummary
          title={turn.mode === "stub" ? undefined : "Answer"}
          citations={aiCitations}
          meta={
            turn.mode === "stub" ? (
              <Badge data-testid="stub-badge" variant="warning" label="Local stub model · no API key" />
            ) : (
              <Text type="supporting">{turn.facts.length > 0 ? "Generated by AI from the facts above. Check the sources." : "Generated by AI."}</Text>
            )
          }
        >
          <VStack data-testid="ai-summary" aria-live="polite" gap={2}>
            {paragraphs.length === 0 ? (
              <Text as="p" color="secondary">Thinking…</Text>
            ) : (
              paragraphs.map((p, i) => (
                <p key={i}>
                  <CitedParagraph text={p} turn={turn} onOpenCitation={onOpenCitation} />
                  {running && i === paragraphs.length - 1 && <span aria-hidden className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse bg-ai motion-reduce:animate-none" />}
                </p>
              ))
            )}
          </VStack>
        </AiSummary>
      )}

      {turn.status === "done" && rowSets.length > 0 && <AnswerRows runId={turn.runId} rowSets={rowSets} />}

      {limitations.length > 0 && (
        <Banner
          data-testid="sample-limitations"
          aria-label="Sample limitations"
          status="warning"
          icon={<Icon icon="info" />}
          title="Sample limitations"
          collapsible={false}
        >
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {limitations.map((item) => <li key={item}><Text color="secondary">{item}</Text></li>)}
          </ul>
        </Banner>
      )}

      {turn.numberCheck?.status === "unverified" && (
        <Banner
          data-testid="number-warning"
          role="alert"
          status="warning"
          title="Some figures in this summary could not be matched to the source facts. Rely on the numbers computed from your data."
          collapsible={false}
        />
      )}

      {turn.status === "error" && (
        <Banner data-testid="chat-error" role="alert" status="error" title={turn.error ?? "The agent could not complete this answer."} collapsible={false} />
      )}

      {(aggregateOnly || turn.rowsUnavailable) && turn.status === "done" && rowSets.length === 0 && (
        <Banner
          data-testid="aggregate-only-note"
          status="info"
          icon={<Icon icon={Lock} />}
          title="Rows are not available for this answer."
          description="Your aggregate-only access does not grant source-row access, so chat shows aggregates only, with small groups withheld. Records and exports are unavailable in chat."
          collapsible={false}
        />
      )}

      {!hasAi && turn.citations.length > 0 && (
        <VStack as="section" aria-label="Sources" data-testid="citations" gap={2}>
          <Heading level={4} color="secondary">Sources you can open</Heading>
          <HStack as="ul" gap={2} wrap="wrap">
            {turn.citations.map((c) => (
              <li key={`${c.dataset}:${c.recordId}`}>
                <CitationChip data-testid="citation" aria-label={`Open source: ${c.label}`} onOpen={() => onOpenCitation(c)} className="min-h-11 gap-2 rounded-lg px-3 text-left text-sm">
                  <Icon icon={FileText} size="sm" className="shrink-0 text-fact" />
                  <VStack as="span" gap={0}>
                    <Text type="code">{isAggregateCitation(c) ? "Aggregate source" : c.recordId}</Text>
                    <Text type="supporting">{c.label}</Text>
                  </VStack>
                </CitationChip>
              </li>
            ))}
          </HStack>
        </VStack>
      )}

      {factsAreComparable(turn.facts) && (
        <VStack as="section" data-testid="chat-fact-chart" aria-label="Computed fact comparison" gap={3} padding={3} className="rounded-xl border bg-card">
          <HStack gap={2} align="center">
            <Icon icon={BarChart3} size="sm" className="text-fact" />
            <Text weight="medium">Computed comparison</Text>
          </HStack>
          <VStack gap={2}>
            {turn.facts.map((fact) => {
              const max = Math.max(...turn.facts.map((item) => item.value), 1)
              return (
                <ProgressBar
                  key={fact.factId}
                  label={fact.label}
                  value={fact.value}
                  max={max}
                  hasValueLabel
                  formatValueLabel={(value) => value.toLocaleString("en-US")}
                />
              )
            })}
          </VStack>
        </VStack>
      )}

      {turn.status === "done" && turn.suggestions.length > 0 && (
        <Suggestion title="You could ask next">
          <HStack as="ul" gap={2} wrap="wrap">
            {turn.suggestions.map((s) => (
              <li key={s}>
                <Button
                  data-testid="suggestion"
                  label={s}
                  variant="secondary"
                  isDisabled={!canAsk}
                  onClick={() => onAsk(s)}
                />
              </li>
            ))}
          </HStack>
        </Suggestion>
      )}

      {turn.status === "done" && (turn.text || turn.facts.length > 0) && (
        <HStack hAlign="end">
          <ExportButton onExport={() => exportTurn(turn, through)} label="Download answer" />
        </HStack>
      )}

      {turn.status === "done" && turn.saved !== null && (
        <Text as="p" type="supporting" data-testid="saved-note">
          {turn.saved ? "Saved to your conversation history." : "This answer could not be saved to your history."}
        </Text>
      )}

      {turn.status === "done" && turn.text !== "" && <AnswerFeedback runId={turn.runId} />}
        </VStack>
      </ChatMessageBubble>
    </ChatMessage>
  )
}
