"use client"

import * as React from "react"
import { Button } from "@astryxdesign/core/Button"
import { EmptyState } from "@astryxdesign/core/EmptyState"
import { HStack } from "@astryxdesign/core/HStack"
import { Text } from "@astryxdesign/core/Text"
import { ChatComposer, ChatComposerInput, ChatLayout, ChatMessage, ChatMessageBubble, ChatMessageList, ChatMessageMetadata, ChatSendButton, ChatSystemMessage } from "@astryxdesign/core/Chat"
import { AssistantTurnView } from "@/components/chat/assistant-turn"
import { useChatSession } from "@/components/chat/chat-provider"
import { CitationSheet } from "@/components/chat/citation-sheet"
import type { CitationItem } from "@/lib/chat/events"
import { describeContext } from "@/lib/chat/screen-context"
import { MAX_QUESTION_CHARS } from "@/lib/chat/use-chat"
import type { ChatContext } from "@/lib/data/director-insights"
import { useDataAdapter } from "@/lib/data/data-provider"
import { useQuery } from "@/lib/data/use-query"
import { useSession } from "@/lib/session/session-provider"

interface ChatConversationProps {
  /** Sent with each question: the screen the person is on (panel) or the link they followed (full page). */
  context: ChatContext | undefined
  starters: string[]
  /** `page`: full route; `panel`: slide-in conversation. */
  layout: "page" | "panel"
  /**
   * Puts the cursor in the composer when the surrounding Astryx `Drawer` opens (it focuses the `data-autofocus` element).
   * Fine pointers only: a touch screen would raise the keyboard before the person asked for it.
   */
  autoFocusInput?: boolean
  /** Context the person can review or remove directly above the question composer. */
  composerDrawer?: React.ReactNode
}

/** The thread, the empty state and the composer. Shared by the full `/chat` page and the slide-in panel. */
export function ChatConversation({ context, starters, layout, autoFocusInput, composerDrawer }: ChatConversationProps) {
  const adapter = useDataAdapter()
  const { userId, ready } = useSession()
  const me = useQuery("me", userId, (ctx) => adapter.me(ctx), ready)
  const { turns, running, send, stop, hydrated } = useChatSession()
  const [draft, setDraft] = React.useState("")
  const [citation, setCitation] = React.useState<CitationItem | null>(null)

  const setComposerInput = React.useCallback(
    (root: HTMLDivElement | null) => {
      const editable = root?.querySelector<HTMLElement>("[contenteditable=true]") ?? null
      if (!editable) return
      editable.dataset.testid = "chat-input"
      editable.classList.add("a2g-chat-composer-editor")
      if (autoFocusInput && window.matchMedia("(pointer: fine)").matches) editable.setAttribute("data-autofocus", "")
    },
    [autoFocusInput],
  )

  const submit = (question: string) => {
    if (!question.trim() || running) return
    setDraft("")
    void send(question, context)
  }
  const emptyState = (
    <EmptyState
      data-testid="chat-empty"
      headingLevel={2}
      title="Try a question"
      description="Ask about your calls, HCPs or recorded responses."
      actions={
        <HStack gap={2} hAlign="center" wrap="wrap">
          {starters.map((starter) => (
            <Button key={starter} data-testid="starter" label={starter} variant="secondary" onClick={() => submit(starter)} />
          ))}
        </HStack>
      }
    />
  )

  return (
    <>
      <ChatLayout
        data-testid="chat-thread"
        className={layout === "panel" ? "min-h-0 flex-1" : "min-h-[32rem] flex-1"}
        density={layout === "panel" ? "compact" : "balanced"}
        emptyState={hydrated && turns.length === 0 ? emptyState : undefined}
        composer={
          <ChatComposer
            value={draft}
            onChange={(value) => setDraft(value.slice(0, MAX_QUESTION_CHARS))}
            onSubmit={submit}
            onStop={stop}
            isStopShown={running}
            placeholder="Ask about your calls, HCPs or recorded responses"
            drawer={composerDrawer}
            input={
              <ChatComposerInput
                ref={setComposerInput}
                label="Your question"
                maxRows={6}
              />
            }
            sendButton={<ChatSendButton data-testid="chat-send" />}
          />
        }
      >
        {hydrated && turns.length === 0 ? (
          <ChatMessageList isStreaming={running} align="top" gap={4} emptyState={emptyState}>{null}</ChatMessageList>
        ) : (
          <ChatMessageList isStreaming={running} align="top" gap={4}>
          <ChatSystemMessage variant="divider">Conversation</ChatSystemMessage>
          {turns.map((turn) => {
            const asked = describeContext(turn.context)
            return (
              // One turn is the question and its answer; `contents` keeps the two messages direct layout children of the list.
              <div key={turn.id} data-testid="chat-turn" className="contents">
                <ChatMessage sender="user">
                  <ChatMessageBubble
                    data-testid="user-message"
                    metadata={asked ? <ChatMessageMetadata footer={<Text as="span" type="supporting" data-testid="turn-context">{asked}</Text>} status="sent" /> : undefined}
                  >
                    {turn.question}
                  </ChatMessageBubble>
                </ChatMessage>
                <AssistantTurnView
                  turn={turn.answer}
                  onAsk={submit}
                  onOpenCitation={setCitation}
                  canAsk={!running}
                  aggregateOnly={me.status === "success" && me.data.persona === "executive"}
                />
              </div>
            )
          })}
          </ChatMessageList>
        )}
      </ChatLayout>

      <CitationSheet citation={citation} onClose={() => setCitation(null)} />
    </>
  )
}
