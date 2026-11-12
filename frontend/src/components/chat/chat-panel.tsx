"use client"

import { MessageSquarePlus } from "lucide-react"
import { useSearchParams } from "next/navigation"
import * as React from "react"
import { Button } from "@astryxdesign/core/Button"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Layout, LayoutContent, LayoutHeader } from "@astryxdesign/core/Layout"
import { Text } from "@astryxdesign/core/Text"
import { Token } from "@astryxdesign/core/Token"
import { VStack } from "@astryxdesign/core/VStack"
import { ChatConversation } from "@/components/chat/chat-conversation"
import { useChatSession } from "@/components/chat/chat-provider"
import { ScopeLabel } from "@/components/shell/scope-label"
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
    <Layout
      height="auto"
      data-testid="chat-panel"
      header={
        <LayoutHeader hasDivider>
          <HStack hAlign="between" vAlign="end" gap={3} wrap="wrap">
            <VStack gap={1}>
              <Heading level={1}>Ask the agent</Heading>
              <Text type="body" color="secondary">
                Ask in plain language. Numbers are counted from your data; the AI only explains them.
              </Text>
            </VStack>
            <HStack gap={2} wrap="wrap" vAlign="center">
          <ScopeLabel label={me.status === "success" ? me.data.scopeLabel : undefined} loading={me.status !== "success"} />
          {context && (
            <Token
              data-testid="chat-context"
              label={`Asking about ${[context.territoryId, context.questionId, context.from && context.to ? `${context.from} to ${context.to}` : null].filter(Boolean).join(" · ") || "this screen"}`}
              size="sm"
            />
          )}
          {turns.length > 0 && (
            <Button label="New conversation" variant="secondary" data-testid="chat-new" icon={<MessageSquarePlus aria-hidden />} onClick={reset} isDisabled={running} />
          )}
            </HStack>
          </HStack>
        </LayoutHeader>
      }
      content={<LayoutContent><ChatConversation context={context} starters={starters} layout="page" /></LayoutContent>}
    />
  )
}
