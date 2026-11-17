"use client"

/**
 * Ask the agent on CopilotKit (docs/adr/0018). `AskTheAgentFrame` wires one mounted chat to this app: the screen
 * context it sends, its suggestion pills, how tool calls and surface actions behave, and the record sheet citations
 * open. The three placements (panel, docked sidebar, full page) wrap CopilotKit's own components in it and share
 * `CHAT_PROPS`, so they look and behave the same.
 */

import {
  CopilotChatAssistantMessage,
  CopilotChatConfigurationProvider,
  CopilotChatUserMessage,
  CopilotChatView,
  CopilotChatToggleButton,
  CopilotModalHeader,
  UseAgentUpdate,
  useAgent,
  useAgentContext,
  useConfigureSuggestions,
  useCopilotKit,
  useDefaultRenderTool,
  type CopilotModalHeaderProps,
} from "@copilotkit/react-core/v2"
import { MessageSquarePlus, Maximize2, Sparkles } from "lucide-react"
import Link from "next/link"
import * as React from "react"
import { useChatSession } from "@/components/chat/chat-session"
import {
  AnswerMessage,
  ChatThreadContext,
  groupTurns,
  QuestionMessage,
  RatingProvider,
  ScopedInput,
  SuggestionsView,
  ToolActivity,
  type ChatThreadValue,
} from "@/components/chat/chat-thread"
import { CitationSheet } from "@/components/chat/citation-sheet"
import { evidenceOf } from "@/lib/chat/agent/answer"
import { ASK_THE_AGENT, SCREEN_CONTEXT, SURFACE_ACTION_PROP } from "@/lib/chat/agent/appsync-agent"
import { turnsOf } from "@/lib/chat/agent/turns"
import type { SurfaceAction } from "@/lib/chat/a2ui/protocol"
import type { CitationItem } from "@/lib/chat/events"
import type { ChatContext } from "@/lib/data/director-insights"
import { useDataAdapter } from "@/lib/data/data-provider"
import { useQuery } from "@/lib/data/use-query"
import { useSession } from "@/lib/session/session-provider"
import { cn } from "@/lib/utils"

export const STARTERS = ["How many calls did I have in the last 90 days?", "What have HCPs recorded about osimertinib?", "Which territories can I see?"]

export const CHAT_LABELS = {
  modalHeaderTitle: "Ask the agent",
  sidebarLabel: "Ask the agent",
  chatInputPlaceholder: "Ask about your calls, HCPs or recorded responses",
  chatInputToolbarSendButtonLabel: "Send question",
  chatInputToolbarStopButtonLabel: "Stop the answer",
  modalHeaderCloseButtonLabel: "Close",
  chatDisclaimerText: "Numbers are counted from your data; the AI only explains them.",
  assistantMessageToolbarCopyMessageLabel: "Copy answer",
}

/** Slots shared by every placement. Module-level, so CopilotKit sees the same components on every render. */
export const CHAT_PROPS = {
  agentId: ASK_THE_AGENT,
  labels: CHAT_LABELS,
  messageView: {
    // The slots carry CopilotKit's statics too (its message view may read them).
    assistantMessage: Object.assign(AnswerMessage, CopilotChatAssistantMessage),
    userMessage: Object.assign(QuestionMessage, CopilotChatUserMessage),
    groupMessages: groupTurns,
    toolCallDisplay: "separate" as const,
  },
  input: ScopedInput,
  suggestionView: SuggestionsView,
  scrollView: { scrollToBottomButton: ScrollToLatest },
}

/** CopilotKit's "scroll to the latest" button floats over the thread by design, like the composer. */
function ScrollToLatest(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <CopilotChatView.ScrollToBottomButton {...props} data-layout-ok="overlap" />
}

const toSuggestion = (text: string) => ({ title: text, message: text })

interface FrameProps {
  /** Sent with each question as the agent's context: the screen (panel) or the link that opened the page. */
  context: ChatContext | undefined
  starters: string[]
  chips?: ChatThreadValue["chips"]
  children: React.ReactNode
}

export function AskTheAgentFrame({ context, starters, chips = null, children }: FrameProps) {
  const adapter = useDataAdapter()
  const { userId, ready } = useSession()
  const me = useQuery("me", userId, (ctx) => adapter.me(ctx), ready)
  const { agent, threadId } = useChatSession()
  const { copilotkit } = useCopilotKit()
  const { agent: live } = useAgent({ agentId: ASK_THE_AGENT, updates: [UseAgentUpdate.OnMessagesChanged, UseAgentUpdate.OnRunStatusChanged], throttleMs: 150 })
  const [citation, setCitation] = React.useState<CitationItem | null>(null)

  const turns = React.useMemo(() => turnsOf(live.messages), [live.messages])
  const latest = turns.at(-1)
  const latestTail = latest?.tail ?? null
  const followUps = React.useMemo(() => (latestTail?.status === "done" ? evidenceOf(latestTail).suggestions : []), [latestTail])

  // The context travels as CopilotKit agent context; the client agent reads and checks it (lib/chat/agent).
  useAgentContext({ description: SCREEN_CONTEXT, value: (context ?? {}) as Record<string, string> })
  useConfigureSuggestions({ suggestions: starters.map(toSuggestion), available: "before-first-message", consumerAgentId: ASK_THE_AGENT }, [starters.join("\n")])
  useConfigureSuggestions(
    followUps.length ? { suggestions: followUps.map(toSuggestion), available: "after-first-message", consumerAgentId: ASK_THE_AGENT } : null,
    [followUps.join("\n")],
  )
  useDefaultRenderTool({ render: (props) => <ToolActivity name={props.name} status={props.status} /> }, [])

  const sendSurfaceAction = React.useCallback(
    (action: SurfaceAction, question: string) => {
      if (agent.isRunning) return
      agent.addMessage({ id: crypto.randomUUID(), role: "user", content: question })
      void copilotkit.runAgent({ agent, forwardedProps: { [SURFACE_ACTION_PROP]: action } })
    },
    [agent, copilotkit],
  )

  const aggregateOnly = me.status === "success" && me.data.persona === "executive"
  const hasMessages = turns.length > 0
  const lastTurnKey = latest?.key ?? null
  const value = React.useMemo<ChatThreadValue>(
    () => ({ openCitation: setCitation, aggregateOnly, sendSurfaceAction, hasMessages, lastTurnKey, chips }),
    [aggregateOnly, sendSurfaceAction, hasMessages, lastTurnKey, chips],
  )

  return (
    <CopilotChatConfigurationProvider agentId={ASK_THE_AGENT} threadId={threadId} hasExplicitThreadId={false} labels={CHAT_LABELS}>
      <ChatThreadContext.Provider value={value}>
        <RatingProvider>{children}</RatingProvider>
        <CitationSheet citation={citation} onClose={() => setCitation(null)} />
      </ChatThreadContext.Provider>
    </CopilotChatConfigurationProvider>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// The panel header: CopilotKit's header, with this app's actions beside its close button
// ---------------------------------------------------------------------------------------------------------------

function HeaderAction({ label, testId, onClick, href, disabled, children }: { label: string; testId?: string; onClick?: () => void; href?: string; disabled?: boolean; children: React.ReactNode }) {
  const className =
    "inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40 pointer-coarse:size-11"
  return href ? (
    <Link href={href} aria-label={label} title={label} data-testid={testId} className={className}>
      {children}
    </Link>
  ) : (
    <button type="button" aria-label={label} title={label} data-testid={testId} onClick={onClick} disabled={disabled} className={className}>
      {children}
    </button>
  )
}

export function PanelHeader(props: CopilotModalHeaderProps) {
  const { reset, running, agent } = useChatSession()
  const thread = React.useContext(ChatThreadContext)
  return (
    <CopilotModalHeader {...props}>
      {({ closeButton }) => (
        <header data-slot="copilot-modal-header" className="flex items-center justify-between gap-2 border-b border-border bg-background/95 px-4 py-2 backdrop-blur">
          <h2 className="inline-flex min-w-0 items-center gap-2 text-base font-medium text-foreground">
            <Sparkles aria-hidden className="size-4 shrink-0" />
            <span className="truncate">Ask the agent</span>
          </h2>
          <div className="flex items-center gap-1">
            <HeaderAction label="Open full chat" href="/chat" testId="chat-full">
              <Maximize2 aria-hidden className="size-4" />
            </HeaderAction>
            {thread?.hasMessages && (
              <HeaderAction label="New conversation" testId="chat-new" disabled={running || agent.isRunning} onClick={reset}>
                <MessageSquarePlus aria-hidden className="size-4" />
              </HeaderAction>
            )}
            <span className={cn("[&>button]:pointer-coarse:size-11")}>{closeButton}</span>
          </div>
        </header>
      )}
    </CopilotModalHeader>
  )
}

/** The panels open from the top bar's "Ask the agent", so CopilotKit's floating toggle is not shown. */
export const NoToggle = React.forwardRef<HTMLButtonElement, React.ComponentProps<typeof CopilotChatToggleButton>>(function NoToggle() {
  return null
})
