"use client"

import { Button } from "@astryxdesign/core/Button"
import { Card } from "@astryxdesign/core/Card"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import { Sparkles } from "lucide-react"
import * as React from "react"
import { AssistantTurnView } from "@/components/chat/assistant-turn"
import { SourceFact } from "@/components/provenance/provenance"
import { EmptyState, ErrorState } from "@/components/state/states"
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
        <PanelLoading testId="summaries-loading" height={288} />
      ) : data.territories.length === 0 ? (
        <EmptyState title="No territories to summarise">No territory in your scope has activity in this period.</EmptyState>
      ) : (
        <VStack gap={4} className="a2g-summary-scope">
          <ul data-testid="summary-cards" className="a2g-summary-cards grid gap-4">
            {cards.map((t) => (
              <li key={t.territoryId} className="min-w-0"><SummaryCard t={t} range={range} /></li>
            ))}
          </ul>
          {data.territories.length > INITIAL_CARDS && (
            <HStack>
              <Button variant="secondary" data-testid="summaries-toggle" onClick={() => setShowAll((v) => !v)} label={showAll ? "Show fewer territories" : `Show all ${data.territories.length} territories`} />
            </HStack>
          )}
          <Text type="supporting" as="p" size="xsm">{data.note}</Text>
        </VStack>
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
    <Card role="article" data-testid="summary-card" data-territory={t.territoryId} height="100%" className="min-w-0">
      <VStack gap={4} height="100%">
        <HStack as="header" gap={2} justify="between" align="center" wrap="wrap">
          <Heading level={3}>{t.territoryId}{t.name ? <Text color="secondary"> · {t.name}</Text> : null}</Heading>
          <Text type="supporting" size="xsm">{t.regionName}</Text>
        </HStack>

        <SourceFact title="Source figures" meta={<span>Counted by database queries, not by the AI.</span>}>
          <MetadataList columns={4} label={{ position: "top" }}>
            {[["Distinct calls", t.distinctCalls], ["Engaged HCPs", t.distinctEngagedHcps], ["Responses", t.responses], ["Free-text responses", t.freeTextResponses]].map(([k, v]) => (
              <MetadataListItem key={k as string} label={k as string}><Text size="xl" weight="semibold" hasTabularNumbers>{num(v as number)}</Text></MetadataListItem>
            ))}
          </MetadataList>
          <Text type="supporting" as="p" size="xsm" className="mt-2">{num(t.priorFreeTextResponses)} free-text responses in the earlier period.</Text>
        </SourceFact>

        <VStack as="section" gap={3} aria-label="Most recorded themes">
          <HStack gap={2} align="center" wrap="wrap">
            <Heading level={4}>Most recorded themes</Heading> <DerivedBadge /> <Text type="supporting">grouped from free text by keyword</Text>
          </HStack>
          {t.topThemes.length === 0 ? (
            <Text type="supporting" as="p">No free-text responses in this period.</Text>
          ) : (
            <ul className="flex flex-col gap-3">
              {t.topThemes.map((theme) => (
                <li key={theme.topic}>
                  <Card variant="muted" padding={3} data-testid="summary-theme">
                    <VStack gap={1.5}>
                      <HStack gap={2} align="center" justify="between" wrap="wrap">
                        <Text weight="medium">{theme.topic}</Text>
                        <StatusBadge status={theme.status} />
                      </HStack>
                      <Text type="supporting" as="p" hasTabularNumbers>{num(theme.currentResponses)} of {num(theme.currentTotal)} ({pctText(theme.currentShare)}) now, {num(theme.priorResponses)} of {num(theme.priorTotal)} ({pctText(theme.priorShare)}) before</Text>
                      {theme.evidence.length > 0 && <HStack gap={2} wrap="wrap">{theme.evidence.map((e) => <EvidenceChip key={e.recordId} recordId={e.recordId} />)}</HStack>}
                    </VStack>
                  </Card>
                </li>
              ))}
            </ul>
          )}
          {t.flagged.length > 0 && (
            <Text as="p" data-testid="summary-flagged"><strong>Flagged by the rule:</strong> {t.flagged.map((f) => `${f.topic} (${f.status.toLowerCase()})`).join(", ")}.</Text>
          )}
        </VStack>

        <VStack gap={3} className="mt-auto">
          <HStack gap={3} align="center" wrap="wrap">
            <Button data-testid="generate-summary" variant="primary" onClick={generate} isDisabled={running} icon={<Icon icon={Sparkles} />} label={running ? "Generating…" : turn ? "Regenerate AI summary" : "Generate AI summary"} />
            <Text type="supporting" size="xsm">AI-generated on request. It cites the responses above.</Text>
          </HStack>
          {/* Inline [n] citation markers sit inside a sentence (the WCAG 2.5.8 inline-target exception) and also open from the citation list. */}
          {turn && (
            <div data-testid="summary-result" data-layout-ok="touch" aria-live="polite">
              <AssistantTurnView aggregateOnly={false} turn={turn.answer} onAsk={(q) => void send(q, context("FREE"))} onOpenCitation={openCitation} canAsk={!running} />
            </div>
          )}
        </VStack>
      </VStack>
    </Card>
  )
}
