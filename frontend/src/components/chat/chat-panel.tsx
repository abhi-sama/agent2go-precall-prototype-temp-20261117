"use client"

import { MessageSquarePlus, SendHorizontal } from "lucide-react"
import * as React from "react"
import { AssistantTurnView } from "@/components/chat/assistant-turn"
import { CitationSheet } from "@/components/chat/citation-sheet"
import { ScopeLabel } from "@/components/shell/scope-label"
import { Button } from "@/components/ui/button"
import { useReducedMotion } from "@/hooks/use-reduced-motion"
import type { CitationItem } from "@/lib/chat/events"
import { MAX_QUESTION_CHARS, useChat } from "@/lib/chat/use-chat"
import { useDataAdapter } from "@/lib/data/data-provider"
import { useQuery } from "@/lib/data/use-query"
import { useSession } from "@/lib/session/session-provider"

const STARTERS = [
  "How many calls did I have in the last 90 days?",
  "What have HCPs recorded about osimertinib?",
  "Which territories can I see?",
]

export function ChatPanel() {
  const adapter = useDataAdapter()
  const { userId, ready } = useSession()
  const me = useQuery("me", userId, (ctx) => adapter.me(ctx), ready)
  const { turns, running, send, reset } = useChat(adapter)
  const [draft, setDraft] = React.useState("")
  const [open, setOpen] = React.useState<CitationItem | null>(null)
  const bottom = React.useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()

  React.useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "end" })
  }, [turns, reduced])

  const submit = (question: string) => {
    if (!question.trim() || running) return
    setDraft("")
    void send(question)
  }

  return (
    <div className="flex min-h-[calc(100dvh-13rem)] flex-col gap-4" data-testid="chat-panel">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Ask the agent</h1>
          <p className="mt-1 max-w-2xl text-muted-foreground">
            Ask in plain language. Numbers are counted from your data; the AI only explains them.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ScopeLabel label={me.status === "success" ? me.data.scopeLabel : undefined} loading={me.status !== "success"} />
          {turns.length > 0 && (
            <Button variant="outline" data-testid="chat-new" onClick={reset} disabled={running}>
              <MessageSquarePlus aria-hidden /> New conversation
            </Button>
          )}
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-6" data-testid="chat-thread">
        {turns.length === 0 && (
          <div className="flex flex-col gap-3 rounded-2xl border border-dashed p-6" data-testid="chat-empty">
            <p className="font-medium">Try a question</p>
            <ul className="flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    data-testid="starter"
                    onClick={() => submit(s)}
                    className="min-h-11 rounded-xl border bg-card px-4 text-left text-sm hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {turns.map((t) => (
          <article key={t.id} className="flex flex-col gap-3" data-testid="chat-turn">
            <p data-testid="user-message" className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-3 text-primary-foreground">
              {t.question}
            </p>
            <AssistantTurnView turn={t.answer} onAsk={submit} onOpenCitation={setOpen} canAsk={!running} />
          </article>
        ))}
        <div ref={bottom} />
      </div>

      <form
        className="safe-pb sticky bottom-0 -mx-4 flex items-end gap-2 border-t bg-background/90 px-4 py-3 backdrop-blur-md sm:mx-0 sm:rounded-2xl sm:border"
        onSubmit={(e) => {
          e.preventDefault()
          submit(draft)
        }}
      >
        <label htmlFor="chat-input" className="sr-only">
          Your question
        </label>
        <textarea
          id="chat-input"
          data-testid="chat-input"
          value={draft}
          rows={2}
          maxLength={MAX_QUESTION_CHARS}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit(draft)
            }
          }}
          placeholder="Ask about your calls, HCPs or recorded responses"
          className="min-h-11 flex-1 resize-none rounded-xl border bg-card px-3 py-2.5 text-base focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        />
        <Button type="submit" size="lg" data-testid="chat-send" disabled={running || !draft.trim()} aria-label="Send question">
          <SendHorizontal aria-hidden />
          <span className="hidden sm:inline">Ask</span>
        </Button>
      </form>

      <CitationSheet citation={open} onClose={() => setOpen(null)} />
    </div>
  )
}
