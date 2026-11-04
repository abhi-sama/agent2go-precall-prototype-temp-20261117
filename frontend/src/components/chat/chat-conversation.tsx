"use client"

import { SendHorizontal } from "lucide-react"
import * as React from "react"
import { AssistantTurnView } from "@/components/chat/assistant-turn"
import { useChatSession } from "@/components/chat/chat-provider"
import { CitationSheet } from "@/components/chat/citation-sheet"
import { Button } from "@/components/ui/button"
import { useReducedMotion } from "@/hooks/use-reduced-motion"
import type { CitationItem } from "@/lib/chat/events"
import { describeContext } from "@/lib/chat/screen-context"
import { MAX_QUESTION_CHARS } from "@/lib/chat/use-chat"
import type { ChatContext } from "@/lib/data/director-insights"
import { useDataAdapter } from "@/lib/data/data-provider"
import { useQuery } from "@/lib/data/use-query"
import { useSession } from "@/lib/session/session-provider"
import { cn } from "@/lib/utils"

interface ChatConversationProps {
  /** Sent with each question: the screen the person is on (panel) or the link they followed (full page). */
  context: ChatContext | undefined
  starters: string[]
  /** `page`: the window scrolls and the composer sticks to its bottom. `panel`: the thread scrolls inside its own box. */
  layout: "page" | "panel"
  /** Where the cursor goes when the panel opens (fine pointers only: a touch screen would raise the keyboard). */
  inputRef?: React.Ref<HTMLTextAreaElement>
}

/** The thread, the empty state and the composer. Shared by the full `/chat` page and the slide-in panel. */
export function ChatConversation({ context, starters, layout, inputRef }: ChatConversationProps) {
  const adapter = useDataAdapter()
  const { userId, ready } = useSession()
  const me = useQuery("me", userId, (ctx) => adapter.me(ctx), ready)
  const { turns, running, send, hydrated } = useChatSession()
  const [draft, setDraft] = React.useState("")
  const [citation, setCitation] = React.useState<CitationItem | null>(null)
  const bottom = React.useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()

  // A new turn scrolls smoothly into view; tokens streaming into it follow instantly, so the thread does not
  // restart a smooth scroll on every update. A thread put back after a reload jumps straight to its end.
  const turnCount = React.useRef<number | null>(null)
  React.useEffect(() => {
    if (!hydrated) return
    const first = turnCount.current === null
    const isNewTurn = !first && turns.length !== turnCount.current
    turnCount.current = turns.length
    bottom.current?.scrollIntoView({ behavior: reduced || !isNewTurn ? "auto" : "smooth", block: "end" })
  }, [turns, reduced, hydrated])

  const submit = (question: string) => {
    if (!question.trim() || running) return
    setDraft("")
    void send(question, context)
  }
  const panel = layout === "panel"

  return (
    <>
      <div
        data-testid="chat-thread"
        className={cn("flex flex-col gap-6", panel ? "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4" : "flex-1")}
      >
        {hydrated && turns.length === 0 && (
          <div className="flex flex-col gap-3 rounded-2xl border border-dashed p-4 sm:p-6" data-testid="chat-empty">
            <p className="font-medium">Try a question</p>
            <ul className="flex flex-wrap gap-2">
              {starters.map((s) => (
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
        {turns.map((t) => {
          const asked = describeContext(t.context)
          return (
            <article key={t.id} className="flex flex-col gap-3" data-testid="chat-turn">
              <div className="ml-auto flex max-w-[85%] flex-col items-end gap-1">
                <p data-testid="user-message" className="rounded-2xl rounded-br-md bg-primary px-4 py-3 text-primary-foreground">
                  {t.question}
                </p>
                {asked && (
                  <p data-testid="turn-context" className="max-w-full truncate text-xs text-muted-foreground">
                    {asked}
                  </p>
                )}
              </div>
              <AssistantTurnView
                turn={t.answer}
                onAsk={submit}
                onOpenCitation={setCitation}
                canAsk={!running}
                aggregateOnly={me.status === "success" && me.data.persona === "executive"}
              />
            </article>
          )
        })}
        <div ref={bottom} />
      </div>

      <form
        className={cn(
          "safe-pb flex items-end gap-2 border-t bg-background/90 py-3 backdrop-blur-md",
          panel ? "px-4" : "sticky bottom-0 -mx-4 px-4 sm:mx-0 sm:rounded-2xl sm:border",
        )}
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
          ref={inputRef}
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
          className="min-h-11 flex-1 resize-none rounded-xl border border-input bg-card px-3 py-2.5 text-base focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        />
        <Button type="submit" size="lg" data-testid="chat-send" disabled={running || !draft.trim()} aria-label="Send question">
          <SendHorizontal aria-hidden />
          <span className="hidden sm:inline">Ask</span>
        </Button>
      </form>

      <CitationSheet citation={citation} onClose={() => setCitation(null)} />
    </>
  )
}
