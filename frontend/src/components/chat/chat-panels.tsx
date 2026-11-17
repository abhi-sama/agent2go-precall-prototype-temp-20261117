"use client"

/**
 * The Ask the agent panels, on CopilotKit (docs/adr/0018). Loaded lazily by `ChatPanels` in `chat-drawer.tsx`.
 */

import { CopilotPopup, CopilotPopupView, CopilotSidebar, CopilotSidebarView } from "@copilotkit/react-core/v2"
import { usePathname } from "next/navigation"
import * as React from "react"
import { AskTheAgentFrame, CHAT_PROPS, NoToggle, PanelHeader, STARTERS } from "@/components/chat/ask-the-agent"
import { useChatSession } from "@/components/chat/chat-session"
import { WelcomeMessage, type ChatThreadValue } from "@/components/chat/chat-thread"
import { CopilotRoot } from "@/components/chat/copilot-root"
import { useKeepMounted } from "@/components/chat/use-keep-mounted"
import { useChatPresentation } from "@/hooks/use-chat-presentation"
import { startersFor } from "@/lib/chat/context"
import { pageWithout, type ContextChip } from "@/lib/chat/screen-context"
import type { ChatContext } from "@/lib/data/director-insights"

function contextWithout(hidden: Set<ContextChip["kind"]>, context: ChatContext): ChatContext | undefined {
  const next: ChatContext = {}
  if (!hidden.has("screen")) next.view = context.view
  if (!hidden.has("range")) {
    next.from = context.from
    next.to = context.to
  }
  if (!hidden.has("territory")) next.territoryId = context.territoryId
  if (!hidden.has("question")) next.questionId = context.questionId
  const defined = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) as ChatContext
  return Object.keys(defined).length ? defined : undefined
}

/** The screen context as chips, each removable for the questions asked from this panel while it stays open. */
function useScreenChips(open: boolean) {
  const { screen } = useChatSession()
  const [hidden, setHidden] = React.useState<Set<ContextChip["kind"]>>(() => new Set())
  // A removed chip stays removed while the panel is open; each opening starts from the screen again.
  const [wasOpen, setWasOpen] = React.useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (open) setHidden(new Set())
  }
  const remove = React.useCallback((kind: ContextChip["kind"]) => setHidden((current) => new Set([...current, kind])), [])
  const context = React.useMemo(() => contextWithout(hidden, screen.context), [screen, hidden])
  const chips = React.useMemo<ChatThreadValue["chips"]>(() => ({ items: screen.chips.filter((chip) => !hidden.has(chip.kind)), remove }), [screen, hidden, remove])
  const page = React.useMemo(() => pageWithout(hidden, screen.page), [screen, hidden])
  return { context, page, chips, starters: startersFor(context, STARTERS) }
}

const PopupWelcome = (props: React.ComponentProps<typeof CopilotPopupView.WelcomeScreen>) => <CopilotPopupView.WelcomeScreen {...props} welcomeMessage={WelcomeMessage} />
const SidebarWelcome = (props: React.ComponentProps<typeof CopilotSidebarView.WelcomeScreen>) => <CopilotSidebarView.WelcomeScreen {...props} welcomeMessage={WelcomeMessage} />

/**
 * Below the docking width, CopilotKit's popup, opened from the top bar: a side panel at intermediate widths and a tall
 * panel in iPad portrait and on phones. Closing it keeps the conversation (it lives in the agent, `ChatProvider`).
 */
function ChatDrawer() {
  const pathname = usePathname()
  const { open, setOpen, hydrated } = useChatSession()
  const presentation = useChatPresentation()
  const { context, page, chips, starters } = useScreenChips(open)
  // Not before the stored conversation is back: CopilotKit's chat clears the thread when its id changes under it.
  if (!hydrated || pathname === "/chat" || presentation === "docked") return null
  const sheet = presentation === "sheet"
  return (
    <div data-a2g-chat={presentation} data-testid={open ? "chat-drawer" : undefined} data-presentation={presentation} className="contents">
      <AskTheAgentFrame context={context} page={page} starters={starters} chips={chips}>
        <CopilotPopup
          {...CHAT_PROPS}
          open={open}
          onOpenChange={setOpen}
          toggleButton={NoToggle}
          header={PanelHeader}
          welcomeScreen={PopupWelcome}
          width={sheet ? "calc(100vw - 3rem)" : 440}
          height="calc(100dvh - 7.5rem)"
        />
      </AskTheAgentFrame>
    </div>
  )
}

/**
 * At docking width, CopilotKit's sidebar beside the page. CopilotKit narrows the page by the sidebar's width while it
 * is open, so the workspace reflows instead of being covered. It is mounted only while open (and while it slides out),
 * so nothing in it can take focus while it is hidden.
 */
function ChatDock() {
  const pathname = usePathname()
  const { open, setOpen, hydrated } = useChatSession()
  const presentation = useChatPresentation()
  const docked = hydrated && presentation === "docked" && pathname !== "/chat"
  const mounted = useKeepMounted(open && docked)
  const { context, page, chips, starters } = useScreenChips(open)
  if (!docked || !mounted) return null
  return (
    <div data-a2g-chat="docked" data-testid={open ? "chat-dock" : undefined} className="contents">
      <AskTheAgentFrame context={context} page={page} starters={starters} chips={chips}>
        <CopilotSidebar {...CHAT_PROPS} open={open} onOpenChange={setOpen} toggleButton={NoToggle} header={PanelHeader} welcomeScreen={SidebarWelcome} width={420} />
      </AskTheAgentFrame>
    </div>
  )
}

export default function ChatPanelsRoot() {
  return (
    <CopilotRoot>
      <ChatDock />
      <ChatDrawer />
    </CopilotRoot>
  )
}
