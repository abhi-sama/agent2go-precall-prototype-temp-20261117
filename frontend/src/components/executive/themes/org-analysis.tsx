"use client"

import { MessagesSquare, Send } from "lucide-react"
import * as React from "react"
import { AssistantTurnView } from "@/components/chat/assistant-turn"
import { useOpenCitation } from "@/components/director/insights/shared"
import { Button } from "@/components/ui/button"
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
        <label htmlFor="org-question" className="text-sm font-medium">Your question</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="org-question"
            data-testid="org-question"
            value={draft}
            maxLength={MAX_QUESTION_CHARS}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="For example: which topics are rising in more than one region?"
            className="h-11 min-w-0 flex-1 rounded-xl border bg-background px-3 text-base focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          />
          <Button type="submit" data-testid="org-ask" disabled={running || !draft.trim()} className="sm:w-auto"><Send aria-hidden />{running ? "Analysing…" : "Ask"}</Button>
        </div>
        <ul aria-label="Suggested questions" className="flex flex-wrap gap-2">
          {SUGGESTED.map((q) => (
            <li key={q}>
              <button type="button" data-testid="org-suggestion" disabled={running} onClick={() => ask(q)} className="min-h-11 rounded-xl border border-suggest/40 bg-background px-3 py-2 text-left text-sm hover:bg-suggest/10 disabled:opacity-50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                {q}
              </button>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">Answers use only your explicit scope for {range.from} to {range.to}. Counts below the disclosure threshold are withheld, and every answer states its sample limitations.</p>
      </form>

      {turns.length === 0 ? (
        <p className="flex items-center gap-2 rounded-xl border border-dashed p-4 text-sm text-muted-foreground"><MessagesSquare className="size-4" aria-hidden />Ask a question to see an answer with its sources and sample limitations.</p>
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
