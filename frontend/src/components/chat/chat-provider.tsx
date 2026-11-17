"use client"

import { usePathname } from "next/navigation"
import * as React from "react"
import { useSharedFilters } from "@/components/filters/filter-context"
import { PageFiguresProvider } from "@/components/chat/page-figures"
import { ChatSessionContext, type ChatSession } from "@/components/chat/chat-session"
import { AppSyncChatAgent } from "@/lib/chat/agent/appsync-agent"
import { clearChat, loadChat, messagesFromHistory, saveChat } from "@/lib/chat/persistence"
import { newCorrelationId } from "@/lib/log/logger"
import { screenContextFor } from "@/lib/chat/screen-context"
import { useDataAdapter } from "@/lib/data/data-provider"
import { useSession } from "@/lib/session/session-provider"

const SAVE_DELAY_MS = 300

/**
 * One conversation for the whole app shell, held by the client-side AG-UI agent CopilotKit's chat drives (ADR 0018).
 * The panel and the full `/chat` page both read it, so the thread survives the panel closing, navigating between
 * screens and a reload. A different person gets a fresh agent and conversation. CopilotKit itself is not loaded here:
 * `CopilotRoot` brings it in with the chat, the first time it is opened.
 */
export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { userId } = useSession()
  return (
    <PageFiguresProvider>
      <ChatSessionProvider key={userId} userId={userId}>
        {children}
      </ChatSessionProvider>
    </PageFiguresProvider>
  )
}

function ChatSessionProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const adapter = useDataAdapter()
  const pathname = usePathname()
  const { filters } = useSharedFilters()
  const [agent] = React.useState(() => new AppSyncChatAgent({ adapter }))
  const [threadId, setThreadId] = React.useState(() => crypto.randomUUID())
  const [hydrated, setHydrated] = React.useState(false)
  const [running, setRunning] = React.useState(false)
  // Open for one screen: a route change (or the full page, which is the same conversation) closes the panel.
  const [openPath, setOpenPath] = React.useState<string | null>(null)
  const open = openPath === pathname && pathname !== "/chat"
  const setOpen = React.useCallback((next: boolean) => setOpenPath(next ? pathname : null), [pathname])

  // Put a stored conversation back, then save shortly after each change (tokens stream in many times a second) and
  // once more when the page goes away.
  React.useEffect(() => {
    const stored = loadChat(userId)
    if (stored) {
      agent.setMessages(stored.messages)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- storage is read after hydration, never during it
      setThreadId(stored.threadId)
      setHydrated(true)
      return
    }
    let cancelled = false
    void adapter
      .myChatHistory({ correlationId: newCorrelationId() })
      .then((history) => {
        if (cancelled || history.length === 0) return
        const newest = [...history].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0]
        const messages = messagesFromHistory(history.filter((turn) => turn.threadId === newest.threadId))
        if (!messages.length) return
        agent.setMessages(messages)
        setThreadId(newest.threadId)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setHydrated(true)
      })
    return () => {
      cancelled = true
    }
  }, [adapter, agent, userId])

  React.useEffect(() => {
    if (!hydrated) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const save = () => saveChat(userId, { threadId, messages: agent.messages })
    const subscription = agent.subscribe({
      onMessagesChanged: () => {
        clearTimeout(timer)
        timer = setTimeout(save, SAVE_DELAY_MS)
      },
      onRunInitialized: () => setRunning(true),
      onRunFinalized: () => setRunning(false),
      onRunFailed: () => setRunning(false),
    })
    window.addEventListener("pagehide", save)
    return () => {
      subscription.unsubscribe()
      window.removeEventListener("pagehide", save)
      clearTimeout(timer)
      save()
    }
  }, [agent, hydrated, threadId, userId])

  // CopilotKit's chat moves the agent to the new thread and clears it when the thread id changes.
  const reset = React.useCallback(() => {
    agent.abortRun()
    agent.setMessages([])
    setThreadId(crypto.randomUUID())
    clearChat(userId)
  }, [agent, userId])

  const screen = React.useMemo(() => screenContextFor(pathname, filters), [pathname, filters])
  const value = React.useMemo<ChatSession>(
    () => ({ open, setOpen, agent, threadId, running, hydrated, reset, screen }),
    [open, setOpen, agent, threadId, running, hydrated, reset, screen],
  )

  return <ChatSessionContext.Provider value={value}>{children}</ChatSessionContext.Provider>
}

export { useChatSession } from "@/components/chat/chat-session"
