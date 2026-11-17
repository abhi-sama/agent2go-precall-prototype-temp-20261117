"use client"

import { MessageSquarePlus, Sparkles } from "lucide-react"
import dynamic from "next/dynamic"
import { useSearchParams } from "next/navigation"
import * as React from "react"
import { useChatSession } from "@/components/chat/chat-session"
import { ScopeLabel } from "@/components/shell/scope-label"
import { parseChatContext } from "@/lib/chat/context"
import { useDataAdapter } from "@/lib/data/data-provider"
import { useQuery } from "@/lib/data/use-query"
import { useSession } from "@/lib/session/session-provider"

/** CopilotKit and the chat load in their own chunk (docs/adr/0018). */
const PageChat = dynamic(() => import("@/components/chat/chat-page-body"), { ssr: false, loading: () => null })

/**
 * The full-screen chat (`/chat`, and the target of "Ask the agent" links that carry a screen's context): CopilotKit's
 * chat across the page. Same conversation as the panel.
 */
export function ChatPanel() {
  const adapter = useDataAdapter()
  const { userId, ready } = useSession()
  const me = useQuery("me", userId, (ctx) => adapter.me(ctx), ready)
  const { hydrated, reset, running, agent } = useChatSession()
  const params = useSearchParams()
  // The screen the chat was opened from (a Director's territory or question). Defaults for the agent only.
  const context = React.useMemo(() => parseChatContext(new URLSearchParams(params.toString())), [params])
  const [hasMessages, setHasMessages] = React.useState(false)
  React.useEffect(() => {
    const sync = () => setHasMessages(agent.messages.length > 0)
    sync()
    return agent.subscribe({ onMessagesChanged: sync }).unsubscribe
  }, [agent])

  return (
    <div data-testid="chat-panel" data-a2g-chat="page" data-copilotkit className="flex h-[calc(100dvh-var(--a2g-topbar-height,4rem))] min-h-[32rem] min-w-0 flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="inline-flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Sparkles aria-hidden className="size-5" /> Ask the agent
          </h1>
          <p className="text-sm text-muted-foreground">Ask in plain language. Numbers are counted from your data; the AI only explains them.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ScopeLabel label={me.status === "success" ? me.data.scopeLabel : undefined} loading={me.status !== "success"} />
          {context && (
            <span data-testid="chat-context" className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-foreground">
              Asking about {[context.territoryId, context.questionId, context.from && context.to ? `${context.from} to ${context.to}` : null].filter(Boolean).join(" · ") || "this screen"}
            </span>
          )}
          {hasMessages && (
            <button
              type="button"
              data-testid="chat-new"
              onClick={reset}
              disabled={running}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border px-3 text-sm font-medium hover:bg-muted disabled:opacity-40 pointer-coarse:min-h-11"
            >
              <MessageSquarePlus aria-hidden className="size-4" /> New conversation
            </button>
          )}
        </div>
      </header>
      <div data-testid="chat-thread" className="min-h-0 flex-1">
        {hydrated && <PageChat context={context} />}
      </div>
    </div>
  )
}
