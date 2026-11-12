"use client"

import { MessagesSquare, Send } from "lucide-react"
import * as React from "react"
import { Button } from "@astryxdesign/core/Button"
import { Card } from "@astryxdesign/core/Card"
import { Icon } from "@astryxdesign/core/Icon"
import { Text } from "@astryxdesign/core/Text"
import { TextInput } from "@astryxdesign/core/TextInput"
import { AssistantTurnView } from "@/components/chat/assistant-turn"
import { useOpenCitation } from "@/components/director/insights/shared"
import { MAX_QUESTION_CHARS, useChat } from "@/lib/chat/use-chat"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { ChatContext } from "@/lib/data/director-insights"
import type { DateRange } from "@/lib/data/types"

const SUGGESTED = [
  "Which topics are rising in more than one region?",
  "Which regions have too few responses to judge a trend?",
  "What are the most recorded themes across the portfolio?",
]

/**
 * Natural-language analysis over the Executive's explicit scope. It runs on the approved path (AppSync, BE Lambda,
 * agent, Bedrock) with the page's date range as default context. Answers are aggregate-only: they state their sample
 * limitations and cite the sets of responses behind each figure.
 */
export function OrgAnalysis({ range, aggregateOnly = true }: { range: DateRange; aggregateOnly?: boolean }) {
  const adapter = useDataAdapter()
  const openCitation = useOpenCitation()
  const { turns, running, send } = useChat(adapter)
  const [draft, setDraft] = React.useState("")
  const context = React.useMemo<ChatContext>(() => ({ intent: "FREE", view: "executive-themes", from: range.from, to: range.to }), [range.from, range.to])

  const ask = (question: string) => {
    if (!question.trim() || running) return
    setDraft("")
    void send(question, context)
  }

  return (
    <div data-testid="org-analysis" className="flex flex-col gap-4">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          ask(draft)
        }}
        className="flex flex-col gap-3"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <TextInput
              data-testid="org-question"
              label="Your question"
              value={draft}
              onChange={(value) => setDraft(value.slice(0, MAX_QUESTION_CHARS))}
              placeholder="For example: which topics are rising in more than one region?"
              enterKeyHint="send"
              width="100%"
            />
          </div>
          <Button type="submit" data-testid="org-ask" isDisabled={running || !draft.trim()} variant="primary" icon={<Icon icon={Send} />} label={running ? "Analysing…" : "Ask"} />
        </div>
        <ul aria-label="Suggested questions" className="flex flex-wrap gap-2">
          {SUGGESTED.map((q) => (
            <li key={q}>
              <Button data-testid="org-suggestion" isDisabled={running} onClick={() => ask(q)} variant="secondary" label={q} />
            </li>
          ))}
        </ul>
        <Text as="p" type="supporting">Answers use only your explicit scope for {range.from} to {range.to}. Counts below the disclosure threshold are withheld, and every answer states its sample limitations.</Text>
      </form>

      {turns.length === 0 ? (
        <Card variant="muted" padding={4}>
          <Text as="p" type="supporting" className="flex items-center gap-2"><Icon icon={MessagesSquare} size="sm" />Ask a question to see an answer with its sources and sample limitations.</Text>
        </Card>
      ) : (
        <ol className="flex flex-col gap-5" aria-label="Conversation">
          {turns.map((t) => (
            <li key={t.id} data-testid="org-turn" className="flex flex-col gap-3">
              <p data-testid="org-turn-question" className="w-fit max-w-full self-end rounded-2xl rounded-br-md bg-primary/12 px-4 py-2 text-sm">{t.question}</p>
              <div><AssistantTurnView aggregateOnly={aggregateOnly} turn={t.answer} onAsk={ask} onOpenCitation={openCitation} canAsk={!running} /></div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
