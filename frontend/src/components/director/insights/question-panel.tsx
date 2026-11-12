"use client"

import { Badge } from "@astryxdesign/core/Badge"
import { Button } from "@astryxdesign/core/Button"
import { Card } from "@astryxdesign/core/Card"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { List, ListItem } from "@astryxdesign/core/List"
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList"
import { ProgressBar } from "@astryxdesign/core/ProgressBar"
import { Selector } from "@astryxdesign/core/Selector"
import { Text } from "@astryxdesign/core/Text"
import { TextInput } from "@astryxdesign/core/TextInput"
import { VStack } from "@astryxdesign/core/VStack"
import { MessageSquareText } from "lucide-react"
import NextLink from "next/link"
import * as React from "react"
import { EmptyState, ErrorState } from "@/components/state/states"
import { chatLink } from "@/lib/chat/context"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { QuestionAnalytics, QuestionDetail, QuestionOption } from "@/lib/data/director-insights"
import type { DateRange, InsightFilters } from "@/lib/data/types"
import { useQuery } from "@/lib/data/use-query"
import { useSession } from "@/lib/session/session-provider"
import { InsightSection, num, PanelLoading, PanelMeta, pctText } from "./shared"

const TYPE_LABEL: Record<string, string> = {
  open_text: "Free text",
  single_choice: "Single choice",
  multi_select: "Select all",
  yes_no: "Yes / no",
  likert_5: "Likert 1-5",
  rating_0_10: "Rating 0-10",
  numeric: "Number",
  date: "Date",
  ranking: "Ranking",
}
const ALL_TYPES = "__all__"
const typeLabel = (t: string | null) => (t ? (TYPE_LABEL[t] ?? t) : "Unknown type")

/**
 * Question-level analytics: pick one question, read its answers as bars. Counts are distinct responses to that one
 * question (never mixed with another), distinct HCPs are counted apart, and a follow-up is shown next to its parent.
 */
export function QuestionPanel({ range, filters }: { range: DateRange; filters: InsightFilters }) {
  const adapter = useDataAdapter()
  const { userId, ready } = useSession()
  const [questionId, setQuestionId] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState("")
  const [type, setType] = React.useState("")
  const query = useQuery("questionAnalytics", `${userId}:${range.from}:${range.to}:${JSON.stringify(filters)}:${questionId ?? ""}`, (ctx) => adapter.questionAnalytics(ctx, { range, filters, questionId }), ready)
  const [kept, setKept] = React.useState<{ userId: string; data: QuestionAnalytics } | null>(null)
  if (query.status === "success" && kept?.data !== query.data) setKept({ userId, data: query.data })
  const data = query.status === "success" ? query.data : kept?.userId === userId ? kept.data : null

  const options = React.useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (data?.options ?? []).filter((o) => (!type || o.questionType === type) && (!needle || o.questionId.toLowerCase().includes(needle) || o.questionText.toLowerCase().includes(needle)))
  }, [data, search, type])
  const types = React.useMemo(() => [...new Set((data?.options ?? []).map((o) => o.questionType).filter((t): t is string => Boolean(t)))].sort(), [data])

  return (
    <InsightSection
      id="questions"
      title="Question analytics"
      note="Pick a question to see how HCPs answered it. Bars count distinct responses to that question only."
      meta={data && <PanelMeta from={data.from} to={data.to} dataThrough={data.dataThrough}><span>{num(data.options.length)} questions answered</span></PanelMeta>}
    >
      {query.status === "error" && !data ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : !data ? (
        <PanelLoading testId="questions-loading" height={384} />
      ) : data.options.length === 0 ? (
        <EmptyState title="No answered questions in this period">No HCP responses were recorded for your territories between these dates.</EmptyState>
      ) : (
        <div className="a2g-question-scope">
        <div className="a2g-question-layout grid min-w-0 gap-5" aria-busy={query.status === "loading"}>
          <Card data-testid="question-selector" className="min-w-0" padding={3}>
            <VStack gap={3}>
              <TextInput label="Find a question" data-testid="question-search" value={search} placeholder="Text or id, e.g. Q-0013" startIcon="search" onChange={setSearch} />
              <Selector
                label="Answer type"
                data-testid="question-type"
                value={type || ALL_TYPES}
                options={[{ value: ALL_TYPES, label: "All types" }, ...types.map((t) => ({ value: t, label: typeLabel(t) }))]}
                onChange={(value) => setType(value === ALL_TYPES ? "" : value)}
                width="100%"
              />
              <List density="compact" header={<Text type="label">Questions</Text>} className="max-h-96 overflow-y-auto">
                {options.length === 0 && <Text type="supporting" as="p" className="p-3">No question matches.</Text>}
                {options.map((o) => (
                  <OptionItem key={o.questionId} option={o} on={o.questionId === (data.selected?.questionId ?? null)} onPick={() => setQuestionId(o.questionId)} />
                ))}
              </List>
            </VStack>
          </Card>
          <div className="min-w-0">
            {data.selected ? <Detail q={data.selected} range={range} /> : <EmptyState title="That question has no responses here">Pick another question from the list.</EmptyState>}
          </div>
        </div>
        </div>
      )}
    </InsightSection>
  )
}

function OptionItem({ option, on, onPick }: { option: QuestionOption; on: boolean; onPick: () => void }) {
  return (
    <ListItem
      data-testid="question-option"
      data-question-id={option.questionId}
      isSelected={on}
      onClick={onPick}
      label={<Text maxLines={2}>{option.questionText}</Text>}
      description={<HStack gap={2} justify="between"><span className="font-mono">{option.questionId}</span><span>{typeLabel(option.questionType)} · {num(option.responses)}</span></HStack>}
    />
  )
}

function Detail({ q, range }: { q: QuestionDetail; range: DateRange }) {
  const maxCount = Math.max(1, ...q.bars.map((b) => b.responses))
  return (
    <Card role="article" data-testid="question-detail" data-question-id={q.questionId} className="min-w-0">
      <VStack gap={5}>
        <VStack as="header" gap={2}>
          <Text type="supporting" as="p"><span className="font-mono">{q.questionId}</span> · {typeLabel(q.questionType)}{q.molecule ? ` · ${q.molecule}` : ""}</Text>
          <Heading level={3}>{q.questionText}</Heading>
          <MetadataList columns={3} label={{ position: "top" }}>
            <MetadataListItem label="Responses"><Text size="2xl" weight="semibold" hasTabularNumbers data-testid="question-responses">{num(q.responses)}</Text></MetadataListItem>
            <MetadataListItem label="Distinct HCPs"><Text size="2xl" weight="semibold" hasTabularNumbers data-testid="question-hcps">{num(q.distinctHcps)}</Text></MetadataListItem>
            <MetadataListItem label="Denominator"><Text size="2xl" weight="semibold" hasTabularNumbers data-testid="question-denominator">{num(q.denominator)}</Text></MetadataListItem>
          </MetadataList>
        </VStack>

        {q.parent && <ParentBlock parent={q.parent} />}

        <VStack as="section" gap={2} aria-label="Response bars" data-testid="response-bars">
          <Heading level={4}>How HCPs answered</Heading>
          <ul className="flex flex-col gap-2">
            {q.bars.map((b) => (
              <li key={b.label} data-testid="response-bar" data-label={b.label} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]">
                <span className="min-w-0 break-words">{b.label}</span>
                <ProgressBar label={b.label} isLabelHidden value={b.responses} max={maxCount} />
                <span className="text-right tabular-nums"><strong>{num(b.responses)}</strong> <span className="text-muted-foreground">· {pctText(b.percentage)} · {num(b.distinctHcps)} HCPs</span></span>
              </li>
            ))}
          </ul>
          <Text type="supporting" as="p" size="xsm">Percentages are of the {num(q.denominator)} distinct responses to this question. {q.barNote}</Text>
          {q.numericSummary && (
            <Text type="supporting" as="p" data-testid="numeric-summary">Lowest {q.numericSummary.min} · median {q.numericSummary.median} · highest {q.numericSummary.max} (from {num(q.numericSummary.answered)} answers)</Text>
          )}
        </VStack>

        {q.territories.length > 0 && (
          <VStack as="section" gap={2} aria-label="By territory">
            <Heading level={4}>By territory</Heading>
            <ul data-testid="question-territories" className="flex flex-wrap gap-2">
              {q.territories.map((t) => (
                <li key={t.territoryId}><Badge variant="neutral" label={`${t.territoryId} ${num(t.responses)} · ${num(t.distinctHcps)} HCPs`} /></li>
              ))}
            </ul>
          </VStack>
        )}

        {q.followUps.length > 0 && (
          <VStack as="section" gap={2} aria-label="Follow-up questions" data-testid="follow-ups">
            <Heading level={4}>Follow-up questions</Heading>
            <ul className="flex flex-col gap-1.5 text-sm">
              {q.followUps.map((f) => <li key={f.questionId}><span className="font-mono text-xs">{f.questionId}</span> {f.questionText} <span className="text-muted-foreground">· {num(f.responses)} responses</span></li>)}
            </ul>
          </VStack>
        )}

        <HStack>
          <Button href={chatLink({ view: "director-insights", questionId: q.questionId, from: range.from, to: range.to })} as={NextLink} data-testid="ask-agent-question" variant="secondary" label="Ask the agent about this question" icon={<Icon icon={MessageSquareText} />} />
        </HStack>
      </VStack>
    </Card>
  )
}

function ParentBlock({ parent }: { parent: NonNullable<QuestionDetail["parent"]> }) {
  return (
    <Card role="region" variant={parent.inCatalog ? "muted" : "yellow"} padding={3} data-testid="parent-context" data-in-catalog={parent.inCatalog} aria-label="Parent question">
      <VStack gap={2}>
        <Text type="label" as="p">Parent question</Text>
        <Text as="p"><span className="font-mono text-xs">{parent.questionId}</span> {parent.questionText ?? <em>Not in the catalog</em>}</Text>
        {parent.answerBreakdown.length > 0 && (
          <Text type="supporting" as="p">Parent answers in the same interactions: {parent.answerBreakdown.map((a) => `${a.answer} (${num(a.responses)})`).join(", ")}</Text>
        )}
        <Text type="supporting" as="p" size="xsm">{parent.note}</Text>
      </VStack>
    </Card>
  )
}
