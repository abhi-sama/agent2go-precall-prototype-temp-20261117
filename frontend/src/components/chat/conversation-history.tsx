"use client"

/**
 * Earlier conversations in Ask the agent (docs/adr/0021): a list of the person's saved conversations, newest first,
 * each titled by its first question, and a way back into one. It is drawn in CopilotKit's own design (its tokens and
 * the same controls as the panel header), in three places that share one list:
 *
 * - the panel and the docked sidebar: a view that replaces the conversation inside the panel, opened from the header;
 * - the full page: a column beside the chat from tablet width, the same view over the chat below it.
 *
 * The view follows the web platform's guidance for list-to-detail navigation (modern-web-guidance `stack-drill-down`):
 * real buttons, a visible back control named after where it returns to, everything behind it `inert` while it shows,
 * focus moved into it and handed back when it closes, and Escape goes back one step.
 */

import { ArrowLeft, History, MessageSquarePlus } from "lucide-react"
import * as React from "react"
import { useChatSession } from "@/components/chat/chat-session"
import { listThreads, threadDate, threadTitle, turnCountLabel } from "@/lib/chat/threads"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { ChatThreadSummary } from "@/lib/data"
import { newCorrelationId } from "@/lib/log/logger"
import { cn } from "@/lib/utils"

type Threads = { status: "loading" } | { status: "error" } | { status: "ready"; threads: ChatThreadSummary[] }

/**
 * The person's conversations. It loads when `enabled`, and again whenever `refreshKey` changes (an answer finished,
 * the conversation changed); the list stays on screen while it refreshes, so it never flashes empty.
 */
function useConversations(enabled: boolean, refreshKey: string) {
  const adapter = useDataAdapter()
  const [state, setState] = React.useState<Threads>({ status: "loading" })
  const [attempt, setAttempt] = React.useState(0)
  React.useEffect(() => {
    if (!enabled) return
    let cancelled = false
    adapter
      .myChatThreads({ correlationId: newCorrelationId() })
      .then((threads) => !cancelled && setState({ status: "ready", threads: listThreads(threads) }))
      .catch(() => !cancelled && setState((current) => (current.status === "ready" ? current : { status: "error" })))
    return () => {
      cancelled = true
    }
  }, [adapter, enabled, refreshKey, attempt])
  const retry = React.useCallback(() => {
    setState({ status: "loading" })
    setAttempt((n) => n + 1)
  }, [])
  return { state, retry }
}

const NOTES = {
  busy: "An answer is being written. Stop it or wait for it to finish, then open a conversation.",
  empty: "That conversation is no longer available.",
  unavailable: "That conversation could not be opened. Try again.",
} as const

/** The list itself, for the view and the page's column. */
export function ConversationList({ enabled = true }: { enabled?: boolean }) {
  const { threadId, running, openThread, agent } = useChatSession()
  const { state, retry } = useConversations(enabled, `${threadId}:${running}`)
  const [opening, setOpening] = React.useState<string | null>(null)
  const [note, setNote] = React.useState<keyof typeof NOTES | null>(null)
  const busy = running || agent.isRunning

  const open = async (id: string) => {
    setNote(null)
    setOpening(id)
    const result = await openThread(id)
    setOpening(null)
    if (result !== "opened") setNote(result)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 py-2" aria-busy={opening !== null}>
      {busy && (
        <p data-testid="chat-history-busy" className="px-2 text-xs text-muted-foreground">
          {NOTES.busy}
        </p>
      )}
      <div role="status" aria-live="polite" data-testid="chat-history-note" className={cn("px-2 text-sm text-foreground", !note && "sr-only")}>
        {note ? NOTES[note] : ""}
      </div>
      {state.status === "loading" && (
        <p role="status" data-testid="chat-history-loading" className="px-2 py-3 text-sm text-muted-foreground">
          Loading conversations…
        </p>
      )}
      {state.status === "error" && (
        <div role="alert" data-testid="chat-history-error" className="flex flex-col items-start gap-2 px-2 py-3 text-sm">
          <p className="text-foreground">Earlier conversations could not be loaded.</p>
          <button type="button" onClick={retry} className="inline-flex min-h-9 items-center rounded-full border border-border px-3 font-medium hover:bg-muted pointer-coarse:min-h-11">
            Try again
          </button>
        </div>
      )}
      {state.status === "ready" && state.threads.length === 0 && (
        <p data-testid="chat-history-empty" className="px-2 py-3 text-sm text-muted-foreground">
          No earlier conversations yet. Each question you ask is saved here, so you can come back to it.
        </p>
      )}
      {state.status === "ready" && state.threads.length > 0 && (
        <ul aria-label="Earlier conversations" className="m-0 flex list-none flex-col gap-0.5 p-0">
          {state.threads.map((thread) => {
            const current = thread.threadId === threadId
            return (
              <li key={thread.threadId}>
                <button
                  type="button"
                  data-testid="chat-thread-item"
                  data-thread-id={thread.threadId}
                  aria-current={current ? "true" : undefined}
                  disabled={busy || opening !== null}
                  onClick={() => void open(thread.threadId)}
                  className={cn(
                    "group flex w-full min-w-0 flex-col gap-0.5 rounded-lg px-3 py-2.5 text-left transition hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 pointer-coarse:min-h-14",
                    current && "bg-muted",
                  )}
                >
                  <span className="line-clamp-2 text-sm font-medium text-foreground [overflow-wrap:anywhere]">{threadTitle(thread)}</span>
                  {/* The muted text colour is 4.35:1 on the muted fill the open and hovered rows use, so those rows use the full text colour (WCAG 1.4.3). */}
                  <span className="text-xs text-muted-foreground group-hover:text-foreground group-aria-[current=true]:text-foreground">
                    <time dateTime={thread.updatedAt}>{threadDate(thread.updatedAt)}</time> · {turnCountLabel(thread.turnCount)}
                    {current && " · Open now"}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** The header's "Conversations" control: it opens the list over the conversation, and the view's Back closes it. */
export function HistoryToggle({ className }: { className: string }) {
  const { historyOpen, setHistoryOpen } = useChatSession()
  return (
    <button
      type="button"
      aria-label="Conversations"
      title="Conversations"
      aria-expanded={historyOpen}
      data-testid="chat-history-toggle"
      onClick={() => setHistoryOpen(!historyOpen)}
      className={className}
    >
      <History aria-hidden className="size-4" />
    </button>
  )
}

/**
 * The list as a view over the whole panel (the nearest positioned ancestor). Everything else in that panel is `inert`
 * while it shows, so focus and screen readers cannot reach the conversation hidden behind it.
 */
export function ConversationHistoryView({ className }: { className?: string }) {
  const { reset, running, agent, setHistoryOpen } = useChatSession()
  const view = React.useRef<HTMLElement>(null)
  const back = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    const element = view.current
    const behind = element?.parentElement ? [...element.parentElement.children].filter((child) => child !== element && !child.hasAttribute("inert")) : []
    for (const child of behind) child.setAttribute("inert", "")
    back.current?.focus({ preventScroll: true })
    return () => {
      for (const child of behind) child.removeAttribute("inert")
      // Back to the control that opened the view, unless focus has already moved on to something else.
      const active = document.activeElement
      if (!active || active === document.body || element?.contains(active)) document.querySelector<HTMLElement>('[data-testid="chat-history-toggle"]')?.focus({ preventScroll: true })
    }
  }, [])

  return (
    <section
      ref={view}
      data-testid="chat-history"
      aria-labelledby="chat-history-title"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return
        event.stopPropagation()
        setHistoryOpen(false)
      }}
      className={cn("absolute inset-0 z-30 flex min-h-0 flex-col bg-background text-foreground", className)}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-1">
          <button
            ref={back}
            type="button"
            aria-label="Back to conversation"
            title="Back to conversation"
            data-testid="chat-history-back"
            onClick={() => setHistoryOpen(false)}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:size-11"
          >
            <ArrowLeft aria-hidden className="size-4" />
          </button>
          <h2 id="chat-history-title" className="truncate text-base font-medium">
            Conversations
          </h2>
        </div>
        <button
          type="button"
          data-testid="chat-history-new"
          disabled={running || agent.isRunning}
          onClick={reset}
          className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border border-border px-3 text-sm font-medium transition hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40 pointer-coarse:min-h-11"
        >
          <MessageSquarePlus aria-hidden className="size-4" /> New conversation
        </button>
      </header>
      <ConversationList />
    </section>
  )
}
