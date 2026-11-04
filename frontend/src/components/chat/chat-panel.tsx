"use client"

import { MessageSquarePlus } from "lucide-react"
import { useSearchParams } from "next/navigation"
import * as React from "react"
import { ChatConversation } from "@/components/chat/chat-conversation"
import { useChatSession } from "@/components/chat/chat-provider"
import { ScopeLabel } from "@/components/shell/scope-label"
import { Button } from "@/components/ui/button"
import { parseChatContext, startersFor } from "@/lib/chat/context"
import { useDataAdapter } from "@/lib/data/data-provider"
import { useQuery } from "@/lib/data/use-query"
import { useSession } from "@/lib/session/session-provider"

export const STARTERS = [
  "How many calls did I have in the last 90 days?",
  "What have HCPs recorded about osimertinib?",
  "Which territories can I see?",
]

/** The full-page chat (`/chat`, and the target of "Ask the agent" links that carry a screen's context). Same conversation as the slide-in panel. */
export function ChatPanel() {
  const adapter = useDataAdapter()
  const { userId, ready } = useSession()
  const me = useQuery("me", userId, (ctx) => adapter.me(ctx), ready)
  const { turns, running, reset } = useChatSession()
  const params = useSearchParams()
  // The screen the chat was opened from (a Director's territory or question). Defaults for the agent only.
  const context = React.useMemo(() => parseChatContext(new URLSearchParams(params.toString())), [params])
  const starters = startersFor(context, STARTERS)

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
          {context && (
            <span data-testid="chat-context" className="inline-flex min-h-8 items-center rounded-full border bg-muted px-3 text-sm text-muted-foreground">
              Asking about {[context.territoryId, context.questionId, context.from && context.to ? `${context.from} to ${context.to}` : null].filter(Boolean).join(" · ") || "this screen"}
            </span>
          )}
          {turns.length > 0 && (
            <Button variant="outline" data-testid="chat-new" onClick={reset} disabled={running}>
              <MessageSquarePlus aria-hidden /> New conversation
            </Button>
          )}
        </div>
      </header>
      <ChatConversation context={context} starters={starters} layout="page" />
    </div>
  )
}
