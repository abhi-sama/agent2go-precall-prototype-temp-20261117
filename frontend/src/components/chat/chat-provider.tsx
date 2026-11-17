"use client"

import { usePathname } from "next/navigation"
import * as React from "react"
import { useSharedFilters } from "@/components/filters/filter-context"
import { PageFiguresProvider } from "@/components/chat/page-figures"
import { ChatSessionContext, type ChatSession, type OpenThreadResult } from "@/components/chat/chat-session"
import { AppSyncChatAgent } from "@/lib/chat/agent/appsync-agent"
import { clearChat, loadChat, saveChat } from "@/lib/chat/persistence"
import { loadThreadMessages } from "@/lib/chat/threads"
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
  // The thread the saved messages belong to, moved in the same step as the messages (never a render later).
  const threadRef = React.useRef(threadId)
  const [chatKey, setChatKey] = React.useState(0)
  const [hydrated, setHydrated] = React.useState(false)
  const [running, setRunning] = React.useState(false)
  // Open for one screen: a route change (or the full page, which is the same conversation) closes the panel.
  const [openPath, setOpenPath] = React.useState<string | null>(null)
  const open = openPath === pathname && pathname !== "/chat"
  // The conversation list belongs to one screen too, and a closed panel always reopens on the conversation.
  const [historyPath, setHistoryPath] = React.useState<string | null>(null)
  const historyOpen = historyPath === pathname
  const setHistoryOpen = React.useCallback((next: boolean) => setHistoryPath(next ? pathname : null), [pathname])
  const setOpen = React.useCallback(
    (next: boolean) => {
      setOpenPath(next ? pathname : null)
      if (!next) setHistoryPath(null)
    },
    [pathname],
  )

  // Put a stored conversation back, then save shortly after each change (tokens stream in many times a second) and
  // once more when the page goes away.
  React.useEffect(() => {
    const stored = loadChat(userId)
    if (stored) {
      agent.setMessages(stored.messages)
      threadRef.current = stored.threadId
      // eslint-disable-next-line react-hooks/set-state-in-effect -- storage is read after hydration, never during it
      setThreadId(stored.threadId)
      setHydrated(true)
      return
    }
    let cancelled = false
    void adapter
      .myChatThreads({ correlationId: newCorrelationId() }, 1)
      .then(async ([newest]) => {
        if (cancelled || !newest) return
        const messages = await loadThreadMessages(adapter, newest.threadId)
        if (cancelled || !messages.length) return
        agent.setMessages(messages)
        threadRef.current = newest.threadId
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
    const save = () => saveChat(userId, { threadId: threadRef.current, messages: agent.messages })
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
  }, [agent, hydrated, userId])

  // CopilotKit's chat moves the agent to the new thread and clears it when the thread id changes.
  const reset = React.useCallback(() => {
    agent.abortRun()
    agent.setMessages([])
    const next = crypto.randomUUID()
    threadRef.current = next
    setThreadId(next)
    setHistoryOpen(false)
    clearChat(userId)
  }, [agent, userId, setHistoryOpen])

  const openThread = React.useCallback(
    async (id: string): Promise<OpenThreadResult> => {
      if (agent.isRunning) return "busy"
      if (id === threadRef.current && agent.messages.length) {
        setHistoryOpen(false)
        return "opened"
      }
      let messages
      try {
        messages = await loadThreadMessages(adapter, id)
      } catch {
        return "unavailable"
      }
      if (!messages.length) return "empty"
      // The person may have asked something while the turns were on their way.
      if (agent.isRunning) return "busy"
      agent.setMessages(messages)
      threadRef.current = id
      setChatKey((key) => key + 1)
      setThreadId(id)
      setHistoryOpen(false)
      saveChat(userId, { threadId: id, messages })
      return "opened"
    },
    [adapter, agent, userId, setHistoryOpen],
  )

  const screen = React.useMemo(() => screenContextFor(pathname, filters), [pathname, filters])
  const value = React.useMemo<ChatSession>(
    () => ({ open, setOpen, agent, threadId, chatKey, running, hydrated, reset, openThread, historyOpen, setHistoryOpen, screen }),
    [open, setOpen, agent, threadId, chatKey, running, hydrated, reset, openThread, historyOpen, setHistoryOpen, screen],
  )

  return <ChatSessionContext.Provider value={value}>{children}</ChatSessionContext.Provider>
}

export { useChatSession } from "@/components/chat/chat-session"
