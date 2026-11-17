"use client"

/**
 * The pieces CopilotKit's chat is assembled from in Ask the agent (docs/adr/0018). CopilotKit draws the thread, the
 * messages, the composer and the suggestion pills in its own design; these slots add what this app needs on top:
 *  - one row per turn (a question and everything answered for it), with the run's status;
 *  - the answer text with numbered citations that open the record, labelled as written by AI;
 *  - ratings and a download on each finished answer;
 *  - the screen context as removable chips above the composer;
 *  - plain-language rows for the agent's tool calls.
 */

import {
  CopilotChatAssistantMessage,
  CopilotChatInput,
  CopilotChatSuggestionPill,
  CopilotChatSuggestionView,
  CopilotChatUserMessage,
  CopilotChatView,
  messageGroup,
  messageRow,
  type CopilotChatAssistantMessageProps,
  type MessageGroupWrapperProps,
  type MessageRow,
} from "@copilotkit/react-core/v2"
import type { Message } from "@ag-ui/core"
import { Check, CircleHelp, Download, FileText, FlaskConical, LayoutDashboard, ListChecks, LoaderCircle, MapPin, Microscope, Pill, CalendarRange, Tag, X } from "lucide-react"
import * as React from "react"
import { ProposalCard, TurnProgress } from "@/components/chat/agent-state"
import { KindLabel } from "@/components/chat/chat-provenance"
import { useChatSession } from "@/components/chat/chat-session"
import { useAppToast } from "@/components/state/use-app-toast"
import { evidenceOf } from "@/lib/chat/agent/answer"
import { MAX_QUESTION_CHARS, SCREEN_CONTEXT } from "@/lib/chat/agent/appsync-agent"
import { textOf, turnsOf, type Turn } from "@/lib/chat/agent/turns"
import type { SurfaceAction } from "@/lib/chat/a2ui/protocol"
import { ANSWER_MARKDOWN, citationAt, citeAnswer } from "@/lib/chat/cite"
import { citationNumber, isAggregateCitation, type AssistantTurn, type CitationItem } from "@/lib/chat/events"
import { exportAnswer, formatThrough } from "@/lib/chat/export"
import type { AgentProgress, PageProposal } from "@/lib/chat/page-state"
import { describeContext, type ContextChip } from "@/lib/chat/screen-context"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { AnswerRating } from "@/lib/data/evals"
import { newCorrelationId } from "@/lib/log/logger"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------------------------------------------
// Context: what one mounted chat shares with its slots
// ---------------------------------------------------------------------------------------------------------------

export interface ChatThreadValue {
  openCitation: (citation: CitationItem) => void
  /** The viewer's access is aggregate-only (Executive): no rows, records or exports in chat. */
  aggregateOnly: boolean
  /** Ask again from an A2UI surface (ADR 0017), through the same run path as a typed question. */
  sendSurfaceAction: (action: SurfaceAction, question: string) => void
  /** The thread has at least one question (starters give way to follow-ups). */
  hasMessages: boolean
  /** The newest turn's key: only it can still be running. */
  lastTurnKey: string | null
  /** The screen context chips above the composer; `null` where the chat has none (the full page). */
  chips: { items: ContextChip[]; remove: (kind: ContextChip["kind"]) => void } | null
  /** The agent's live progress (shared state, docs/adr/0019); only the newest turn can still be running. */
  progress: AgentProgress | null
  /** The agent's suggestion for the page's filters, and what the person did with it. */
  proposal: PageProposal | null
  applyProposal: (proposal: PageProposal) => void
  dismissProposal: (proposal: PageProposal) => void
}

export const ChatThreadContext = React.createContext<ChatThreadValue | null>(null)

export function useChatThread(): ChatThreadValue {
  const value = React.useContext(ChatThreadContext)
  if (!value) throw new Error("useChatThread must be used inside a chat")
  return value
}

export type TurnStatus = "running" | "done" | "error"

export interface TurnInfo {
  turn: Turn
  /** The answer's computed evidence: the tail once the run ended, the head while it runs. */
  evidence: AssistantTurn | null
  status: TurnStatus
}

const TurnContext = React.createContext<TurnInfo | null>(null)

export function useTurn(): TurnInfo | null {
  return React.useContext(TurnContext)
}

// ---------------------------------------------------------------------------------------------------------------
// One row per turn
// ---------------------------------------------------------------------------------------------------------------

/** Rows for CopilotKit's message list: each question with everything answered for it. */
export function groupTurns(messages: Message[]): MessageRow[] {
  return turnsOf(messages).flatMap((turn) =>
    turn.questionId ? [messageGroup({ key: turn.key, messages: turn.messages, wrapper: TurnGroup })] : turn.messages.map(messageRow),
  )
}

function TurnGroup({ messages, children }: MessageGroupWrapperProps) {
  const { running } = useChatSession()
  const thread = React.useContext(ChatThreadContext)
  const info = React.useMemo<TurnInfo>(() => {
    const [turn] = turnsOf(messages)
    const answer = turn.tail ?? turn.head
    const status: TurnStatus = turn.tail ? turn.tail.status : running && turn.key === thread?.lastTurnKey ? "running" : "error"
    return { turn, evidence: answer ? evidenceOf({ ...answer, status, error: turn.tail?.error ?? null }) : null, status }
  }, [messages, running, thread?.lastTurnKey])
  const proposal = info.turn.runId && thread?.proposal?.id.startsWith(info.turn.runId) ? thread.proposal : null
  return (
    <div data-testid="chat-turn" data-status={info.status} className="flex min-w-0 flex-col gap-3">
      <TurnContext.Provider value={info}>{children}</TurnContext.Provider>
      <TurnProgress running={info.status === "running"} live={info.turn.key === thread?.lastTurnKey ? (thread?.progress ?? null) : null} finished={info.turn.tail?.steps} />
      {proposal && thread && <ProposalCard proposal={proposal} onApply={thread.applyProposal} onDismiss={thread.dismissProposal} />}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// The question
// ---------------------------------------------------------------------------------------------------------------

export function QuestionMessage(props: React.ComponentProps<typeof CopilotChatUserMessage>) {
  const info = useTurn()
  const { agent, running } = useChatSession()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(() => textOf(props.message))
  const asked = describeContext((info?.turn.head ?? info?.turn.tail)?.context)
  const revise = React.useCallback(() => {
    const message = draft.trim().slice(0, MAX_QUESTION_CHARS)
    if (!message || running || agent.isRunning) return
    const at = agent.messages.findIndex((item) => item.id === props.message.id)
    if (at < 0) return
    const context = (info?.turn.head ?? info?.turn.tail)?.context
    agent.abortRun()
    agent.setMessages([...agent.messages.slice(0, at), { ...props.message, content: message }])
    setEditing(false)
    void agent.runAgent({
      runId: crypto.randomUUID(),
      ...(context ? { context: [{ description: SCREEN_CONTEXT, value: JSON.stringify(context) }] } : {}),
    })
  }, [agent, draft, info?.turn.head, info?.turn.tail, props.message, running])
  return (
    <div className="flex min-w-0 flex-col">
      <CopilotChatUserMessage {...props} data-testid="user-message" toolbar={VisibleUserToolbar} onEditMessage={() => setEditing(true)} />
      {editing && (
        <form
          className="mt-2 flex min-w-0 flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            revise()
          }}
        >
          <label htmlFor={`edit-question-${props.message.id}`} className="sr-only">Edit question</label>
          <textarea
            id={`edit-question-${props.message.id}`}
            value={draft}
            maxLength={MAX_QUESTION_CHARS}
            onChange={(event) => setDraft(event.target.value)}
            className="min-h-20 w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
          <div className="flex gap-2">
            <button type="submit" data-testid="chat-edit-send" disabled={!draft.trim() || running || agent.isRunning} className="min-h-9 rounded-full border border-border px-3 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50 pointer-coarse:min-h-11">
              Send revised question
            </button>
            <button type="button" onClick={() => setEditing(false)} className="min-h-9 rounded-full border border-border px-3 text-sm text-foreground hover:bg-accent pointer-coarse:min-h-11">
              Cancel
            </button>
          </div>
        </form>
      )}
      {asked && (
        <p data-testid="turn-context" className="-mt-1 px-1 text-right text-xs text-muted-foreground">
          Asked from {asked}
        </p>
      )}
    </div>
  )
}

/** CopilotKit hides a user-message toolbar until hover by default, which makes edit unavailable to touch users. */
function VisibleUserToolbar(props: React.ComponentProps<typeof CopilotChatUserMessage.Toolbar>) {
  return <CopilotChatUserMessage.Toolbar {...props} className={cn(props.className, "cpk:visible")} />
}

// ---------------------------------------------------------------------------------------------------------------
// The answer text
// ---------------------------------------------------------------------------------------------------------------

const EMPTY: Pick<AssistantTurn, "facts" | "citations" | "sampleLimitations"> = { facts: [], citations: [], sampleLimitations: [] }

/** A numbered marker inside a sentence that opens the record it cites. */
function CitationMarker({ citation, citations }: { citation: CitationItem; citations: CitationItem[] }) {
  const { openCitation } = useChatThread()
  const number = citationNumber(citations, citation)
  return (
    <button
      type="button"
      data-testid="inline-citation"
      aria-label={`Open source ${number}: ${citation.label}`}
      onClick={() => openCitation(citation)}
      // A marker inside a sentence is an inline target (WCAG 2.5.8 exception); it also opens from the Sources row.
      className="mx-0.5 inline-flex h-5 min-w-5 -translate-y-px items-center justify-center rounded-full border border-border bg-muted px-1.5 align-middle text-[0.7rem] font-semibold tabular-nums text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {number}
    </button>
  )
}

/**
 * CopilotKit's markdown renderer, with three changes for model-written text: raw HTML is not rendered (no rehype
 * plugins), links render only as citation markers (any other link is plain text), and images are not loaded.
 */
function CitedMarkdown({ content, ...rest }: React.ComponentProps<typeof CopilotChatAssistantMessage.MarkdownRenderer>) {
  const info = useTurn()
  const evidence = info?.evidence ?? EMPTY
  const text = React.useMemo(() => citeAnswer(content ?? "", evidence), [content, evidence])
  const components = React.useMemo(
    () => ({
      a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
        const citation = citationAt(href, evidence.citations)
        return citation ? <CitationMarker citation={citation} citations={evidence.citations} /> : <span>{children}</span>
      },
      img: () => null,
    }),
    [evidence],
  )
  return <CopilotChatAssistantMessage.MarkdownRenderer {...rest} {...ANSWER_MARKDOWN} content={text} components={components} />
}

/** The records behind an answer, as chips that open them. */
export function SourcesRow({ citations, label = "Sources" }: { citations: CitationItem[]; label?: string }) {
  const { openCitation } = useChatThread()
  if (!citations.length) return null
  return (
    <div data-testid="citations" role="group" aria-label={label} className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {citations.map((c) => {
        const number = citationNumber(citations, c)
        const aggregate = isAggregateCitation(c)
        return (
          <button
            key={`${c.dataset}:${c.recordId}`}
            type="button"
            data-testid="citation"
            aria-label={`Open source ${number}: ${c.label}`}
            onClick={() => openCitation(c)}
            className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border border-border bg-background px-2.5 text-xs text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11"
          >
            <FileText aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="font-semibold tabular-nums">[{number}]</span>
            <span className="truncate font-mono text-[0.7rem]">{aggregate ? "Aggregate source" : c.recordId}</span>
            <span className="hidden truncate text-muted-foreground sm:inline">{c.label}</span>
          </button>
        )
      })}
    </div>
  )
}

const RatingContext = React.createContext<{ ratings: Record<string, AnswerRating>; setRating: (runId: string, rating: AnswerRating) => void } | null>(null)

export function RatingProvider({ children }: { children: React.ReactNode }) {
  const [ratings, setRatings] = React.useState<Record<string, AnswerRating>>({})
  const setRating = React.useCallback((runId: string, rating: AnswerRating) => setRatings((current) => ({ ...current, [runId]: rating })), [])
  const value = React.useMemo(() => ({ ratings, setRating }), [ratings, setRating])
  return <RatingContext.Provider value={value}>{children}</RatingContext.Provider>
}

function useRating(runId: string | null) {
  const store = React.useContext(RatingContext)
  return { rating: runId ? store?.ratings[runId] ?? null : null, setRating: store?.setRating }
}

const MAX_NOTE = 500

/** The optional note after a rating. It goes to the evaluation panel; it is never shown in a toast or logged. */
function RatingNote({ runId, rating }: { runId: string; rating: AnswerRating }) {
  const adapter = useDataAdapter()
  const toast = useAppToast()
  const [note, setNote] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const id = React.useId()
  return (
    <form
      data-testid="answer-feedback"
      aria-label="Rate this answer"
      className="mt-2 flex min-w-0 flex-col gap-2"
      onSubmit={async (event) => {
        event.preventDefault()
        if (saving || !note.trim()) return
        setSaving(true)
        try {
          await adapter.rateAnswer({ correlationId: newCorrelationId() }, { runId, rating, note: note.trim() })
          setSaved(true)
        } catch {
          toast.error("Your note could not be saved")
        } finally {
          setSaving(false)
        }
      }}
    >
      <label htmlFor={id} className="text-xs text-muted-foreground">
        Add a note (optional). Do not include patient or HCP details.
      </label>
      <div className="flex min-w-0 flex-wrap items-end gap-2">
        <textarea
          id={id}
          data-testid="rating-note-input"
          value={note}
          rows={2}
          onChange={(event) => setNote(event.target.value.slice(0, MAX_NOTE))}
          className="min-h-11 min-w-0 flex-1 resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        />
        <button
          type="submit"
          data-testid="rating-note-save"
          disabled={saving || note.trim() === ""}
          className="min-h-9 rounded-full border border-border px-3 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50 pointer-coarse:min-h-11"
        >
          Save note
        </button>
        {saved && (
          <span role="status" className="text-xs text-muted-foreground">
            Note saved
          </span>
        )}
      </div>
    </form>
  )
}

function useRate(runId: string | null) {
  const adapter = useDataAdapter()
  const toast = useAppToast()
  const { rating, setRating } = useRating(runId)
  const [saved, setSaved] = React.useState(false)
  const rate = React.useCallback(
    async (next: AnswerRating) => {
      if (!runId) return
      setRating?.(runId, next)
      setSaved(false)
      try {
        await adapter.rateAnswer({ correlationId: newCorrelationId() }, { runId, rating: next })
        setSaved(true)
      } catch {
        toast.error("Your rating could not be saved")
      }
    },
    [adapter, runId, setRating, toast],
  )
  return { rating, rate, saved }
}

const RateContext = React.createContext<AnswerRating | null>(null)

function RateUpButton(props: React.ComponentProps<typeof CopilotChatAssistantMessage.ThumbsUpButton>) {
  const rating = React.useContext(RateContext)
  return <CopilotChatAssistantMessage.ThumbsUpButton {...props} data-testid="rate-up" aria-label="Helpful" aria-pressed={rating === "UP"} />
}

function RateDownButton(props: React.ComponentProps<typeof CopilotChatAssistantMessage.ThumbsDownButton>) {
  const rating = React.useContext(RateContext)
  return <CopilotChatAssistantMessage.ThumbsDownButton {...props} data-testid="rate-down" aria-label="Not helpful" aria-pressed={rating === "DOWN"} />
}

/**
 * An assistant message. A message that only carries tool calls is CopilotKit's own; one with text is the answer:
 * labelled as AI-written, with citation markers, its sources, ratings and a download once it is finished.
 */
export function AnswerMessage(props: CopilotChatAssistantMessageProps) {
  const info = useTurn()
  const { agent, running } = useChatSession()
  const runId = info?.turn.runId ?? null
  const { rating, rate, saved } = useRate(runId)
  const regenerate = () => {
    if (!info?.turn.questionId || running || agent.isRunning) return
    const at = agent.messages.findIndex((message) => message.id === info.turn.questionId)
    if (at < 0) return
    const context = (info.turn.head ?? info.turn.tail)?.context
    agent.abortRun()
    // Keep the question and every earlier turn. The old response is not used as history for the retry.
    agent.setMessages(agent.messages.slice(0, at + 1))
    void agent.runAgent({
      runId: crypto.randomUUID(),
      ...(context ? { context: [{ description: SCREEN_CONTEXT, value: JSON.stringify(context) }] } : {}),
    })
  }
  if (!props.message.content?.trim()) return <CopilotChatAssistantMessage {...props} toolbarVisible={false} />
  const evidence = info?.evidence ?? null
  const done = info?.status === "done"
  const stub = evidence?.mode === "stub"
  const through = formatThrough(evidence?.dataThrough ?? null)
  const download = (
    <CopilotChatAssistantMessage.ToolbarButton
      title="Download answer"
      data-testid="export-answer"
      onClick={() => evidence && exportAnswer(evidence, info?.turn.text ?? props.message.content ?? "", through)}
    >
      <Download aria-hidden className="size-[18px]" />
    </CopilotChatAssistantMessage.ToolbarButton>
  )
  return (
    <section data-provenance="ai" aria-label="AI summary" className="min-w-0">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <KindLabel kind="ai" />
        {stub ? (
          <span data-testid="stub-badge" className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground">
            Local stub model · no API key
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            {evidence && evidence.facts.length > 0 ? "Generated by AI from the figures above. Check the sources." : "Generated by AI."}
          </span>
        )}
      </div>
      <div data-testid="ai-summary" aria-live="polite" className="min-w-0">
        <RateContext.Provider value={rating}>
          <CopilotChatAssistantMessage
            {...props}
            markdownRenderer={CitedMarkdown}
            toolbarVisible={done}
            onThumbsUp={() => void rate("UP")}
            onThumbsDown={() => void rate("DOWN")}
            thumbsUpButton={RateUpButton}
            thumbsDownButton={RateDownButton}
            onRegenerate={regenerate}
            additionalToolbarItems={download}
          />
        </RateContext.Provider>
      </div>
      {evidence && <SourcesRow citations={evidence.citations} />}
      {done && saved && (
        <p data-testid="rating-saved" role="status" className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Check aria-hidden className="size-3.5" /> Saved, thank you
        </p>
      )}
      {done && rating && runId && <RatingNote key={rating} runId={runId} rating={rating} />}
    </section>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Tool calls
// ---------------------------------------------------------------------------------------------------------------

const TOOL_LABELS: Record<string, string> = {
  get_activity_summary: "Counting calls, HCPs and responses",
  search_recorded_responses: "Searching recorded responses",
  get_my_scope: "Checking your scope",
  show_chart: "Drawing a chart from your data",
  show_answer_distribution: "Counting answers for a chart",
  get_topic_trends: "Counting recorded themes",
  get_question_breakdown: "Counting answers to a question",
  get_org_themes: "Counting themes across your regions",
}

/** One tool call as a quiet row: what the agent is doing, in words, and whether it finished. */
export function ToolActivity({ name, status }: { name: string; status: "inProgress" | "executing" | "complete" }) {
  const complete = status === "complete"
  return (
    <div
      data-testid="tool-call"
      data-tool={name}
      data-status={status}
      className="flex w-fit max-w-full items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground"
    >
      {complete ? <Check aria-hidden className="size-3.5 shrink-0" /> : <LoaderCircle aria-hidden className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />}
      <span className="truncate">{TOOL_LABELS[name] ?? "Working with your data"}</span>
      <span className="sr-only">{complete ? "done" : "in progress"}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// The composer: the screen context above CopilotKit's input
// ---------------------------------------------------------------------------------------------------------------

const CHIP_ICONS: Record<ContextChip["kind"], React.ComponentType<{ className?: string }>> = {
  screen: LayoutDashboard,
  range: CalendarRange,
  territory: MapPin,
  product: Pill,
  question: CircleHelp,
  landscape: Microscope,
  study: FlaskConical,
  survey: ListChecks,
  theme: Tag,
}

/** The context sent with the next question, each item removable. Rendered in the input's disclaimer slot, above it. */
function ScopeChips({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  const thread = React.useContext(ChatThreadContext)
  const items = thread?.chips?.items ?? []
  if (!thread?.chips || items.length === 0) return null
  const { remove } = thread.chips
  return (
    <div {...rest} className={cn("pointer-events-auto order-first mx-auto mb-2 flex w-full max-w-3xl flex-wrap items-center gap-1.5 px-4", className)}>
      <span id="chat-chips-label" className="text-xs text-muted-foreground">
        Sent with your question:
      </span>
      <ul data-testid="chat-chips" aria-labelledby="chat-chips-label" className="flex min-w-0 flex-wrap gap-1.5">
        {items.map((chip) => {
          const Glyph = CHIP_ICONS[chip.kind]
          return (
            <li key={chip.kind} data-testid="chat-chip" data-kind={chip.kind} className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-background py-0.5 pr-0.5 pl-2.5 text-xs text-foreground">
              <Glyph aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{chip.label}</span>
              <button
                type="button"
                aria-label={`Remove ${chip.label}`}
                title="Remove from this question's context"
                onClick={() => remove(chip.kind)}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:size-11 pointer-coarse:-my-2.5"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const QuestionTextArea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<typeof CopilotChatInput.TextArea>>(function QuestionTextArea(props, ref) {
  return <CopilotChatInput.TextArea {...props} ref={ref} data-testid="chat-input" aria-label="Your question" maxLength={MAX_QUESTION_CHARS} />
})

function SendButton(props: React.ComponentProps<typeof CopilotChatInput.SendButton>) {
  return <CopilotChatInput.SendButton {...props} data-testid="chat-send" />
}

/** No attachments or tools menu: questions are text, and the agent reads data only through its own tools. */
const NoAddMenu = React.forwardRef<HTMLButtonElement, React.ComponentProps<typeof CopilotChatInput.AddMenuButton>>(function NoAddMenu() {
  return null
})

/**
 * CopilotKit's composer, with the context chips in its disclaimer slot (laid out first) so its height covers them.
 * It floats over the bottom of the thread by CopilotKit's design: the thread is padded by the composer's height, so
 * its end always scrolls clear, and only content scrolled past sits beneath it (hence `data-layout-ok="overlap"`).
 */
export function ScopedInput(props: React.ComponentProps<typeof CopilotChatInput>) {
  return (
    <CopilotChatInput
      {...props}
      data-layout-ok="overlap"
      className={cn(props.className, "a2g-chat-input flex flex-col")}
      showDisclaimer
      disclaimer={ScopeChips}
      textArea={QuestionTextArea}
      sendButton={SendButton}
      addMenuButton={NoAddMenu}
    />
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Suggestions and the welcome screen
// ---------------------------------------------------------------------------------------------------------------

const SuggestionPill = React.forwardRef<HTMLButtonElement, React.ComponentProps<typeof CopilotChatSuggestionPill>>(function SuggestionPill(props, ref) {
  const thread = React.useContext(ChatThreadContext)
  return <CopilotChatSuggestionPill {...props} ref={ref} data-testid={thread?.hasMessages ? "suggestion" : "starter"} />
})

/** CopilotKit's suggestion pills, labelled as suggestions: starters before the first question, follow-ups after. */
export const SuggestionsView = React.forwardRef<HTMLDivElement, React.ComponentProps<typeof CopilotChatSuggestionView>>(function SuggestionsView(props, ref) {
  const thread = React.useContext(ChatThreadContext)
  if (!props.suggestions?.length) return null
  const label = thread?.hasMessages ? "You could ask next" : "Try a question"
  return (
    <section data-provenance="suggestion" aria-label={label} className="flex min-w-0 flex-col items-start gap-2">
      <KindLabel kind="suggestion" label={label} />
      <CopilotChatSuggestionView {...props} ref={ref} suggestion={SuggestionPill} />
    </section>
  )
})

export function WelcomeMessage({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} data-testid="chat-empty" className={cn("flex max-w-md flex-col items-center gap-1 text-center", className)}>
      <h2 className="text-lg font-semibold text-foreground">Ask about your data</h2>
      <p className="text-sm text-muted-foreground">Ask about your calls, HCPs or recorded responses. Numbers are counted from your data; the AI only explains them.</p>
    </div>
  )
}

export const ChatWelcome = {
  chat: (props: React.ComponentProps<typeof CopilotChatView.WelcomeScreen>) => <CopilotChatView.WelcomeScreen {...props} welcomeMessage={WelcomeMessage} />,
}
