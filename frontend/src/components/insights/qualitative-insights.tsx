"use client"

import { Badge } from "@astryxdesign/core/Badge"
import { Blockquote } from "@astryxdesign/core/Blockquote"
import { Card } from "@astryxdesign/core/Card"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { IconButton } from "@astryxdesign/core/IconButton"
import { Text } from "@astryxdesign/core/Text"
import { TextInput } from "@astryxdesign/core/TextInput"
import { VStack } from "@astryxdesign/core/VStack"
import * as React from "react"
import { CitationSheet } from "@/components/chat/citation-sheet"
import { AiSummary, CitationChip, Suggestion } from "@/components/provenance/provenance"
import type { CitationItem } from "@/lib/chat/events"
import { useDataAdapter } from "@/lib/data/data-provider"
import { useQuery } from "@/lib/data/use-query"
import type { InsightDiscovery } from "@/lib/data/types"
import { useSession } from "@/lib/session/session-provider"

export function QualitativeInsights({ discovery }: { discovery: InsightDiscovery }) {
  const adapter = useDataAdapter()
  const { userId, ready } = useSession()
  const [query, setQuery] = React.useState("")
  const [submitted, setSubmitted] = React.useState("")
  const [citation, setCitation] = React.useState<CitationItem | null>(null)
  const cite = (recordId: string) => () => setCitation({ recordId, dataset: "hcp_raw_insights", label: "Recorded HCP response" })
  const search = useQuery("semanticInsightSearch", `${userId}:${submitted}`, (ctx) => adapter.semanticInsightSearch(ctx, submitted), ready && submitted.length >= 2)
  return (
    <VStack as="section" gap={4} className="@container" aria-labelledby="qualitative-insights-heading">
      <VStack gap={1}>
        <Heading level={2} id="qualitative-insights-heading">Qualitative insights</Heading>
        <Text type="supporting" as="p">Derived themes and possible topics remain separate from source records and confirmed actions.</Text>
      </VStack>
      <div className="grid gap-4 @2xl:grid-cols-2">
        {discovery.themes.map((theme) => (
          <AiSummary
            key={theme.name}
            data-testid="theme-card"
            title={theme.name}
            citations={[{ key: theme.recordId, label: theme.recordId, detail: theme.questionText ?? "Supporting excerpt", onOpen: cite(theme.recordId) }]}
            meta={<><Badge variant="neutral" label="Derived" /><span>{theme.responseCount} recorded responses</span></>}
          >
            <Blockquote>“{theme.excerpt}”</Blockquote>
          </AiSummary>
        ))}
      </div>
      <div className="grid gap-4 @2xl:grid-cols-2">
        <VStack gap={3}>
          <Heading level={3}>Possible follow-up topics</Heading>
          {discovery.followUpTopics.map((topic) => (
            <Suggestion key={topic.topic} title="Possible topic" meta={<><span>{topic.evidenceCount} supporting responses</span><CitationChip aria-label={`Open source record ${topic.recordId}`} onOpen={cite(topic.recordId)}>{topic.recordId}</CitationChip></>}>
              <VStack gap={1}>
                <Text weight="medium" as="p">{topic.topic}</Text>
                <Text type="supporting" as="p">“{topic.excerpt}”</Text>
                <Text size="xsm" weight="medium" as="p">For review — not a confirmed commitment or task.</Text>
              </VStack>
            </Suggestion>
          ))}
          {discovery.followUpTopics.length === 0 && <Card variant="muted"><Text type="supporting" as="p">No evidence-backed follow-up topics match these filters.</Text></Card>}
        </VStack>
        <Card data-testid="semantic-search">
          <VStack gap={3}>
            <VStack gap={1}>
              <Heading level={3}>Search recorded perspectives</Heading>
              <Text type="supporting" as="p">Searches only responses your current scope permits.</Text>
            </VStack>
            <form onSubmit={(event) => { event.preventDefault(); setSubmitted(query.trim()) }}>
              <HStack gap={2} align="end">
                <div className="min-w-0 flex-1">
                  <TextInput label="Search insight responses" isLabelHidden value={query} placeholder="e.g. evidence access" onChange={setQuery} width="100%" />
                </div>
                <IconButton type="submit" label="Search insights" variant="primary" icon={<Icon icon="search" />} isDisabled={query.trim().length < 2} />
              </HStack>
            </form>
            {search.status === "loading" && <Text type="supporting" as="p">Searching recorded responses…</Text>}
            {search.status === "success" && (search.data.length ? (
              <ul className="flex flex-col gap-2">
                {search.data.map((result) => (
                  <li key={result.responseId}>
                    <Card padding={3}>
                      <VStack gap={1}>
                        <Text as="p">{result.responseText}</Text>
                        <Text type="supporting" as="p" size="xsm">{result.questionText} · {result.interactionDate} · <CitationChip aria-label={`Open source record ${result.responseId}`} onOpen={cite(result.responseId)}>{result.responseId}</CitationChip></Text>
                      </VStack>
                    </Card>
                  </li>
                ))}
              </ul>
            ) : <Text type="supporting" as="p">No in-scope responses matched this search.</Text>)}
          </VStack>
        </Card>
      </div>
      <CitationSheet citation={citation} onClose={() => setCitation(null)} />
    </VStack>
  )
}
