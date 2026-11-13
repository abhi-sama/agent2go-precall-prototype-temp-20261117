"use client"

import { usePathname } from "next/navigation"
import * as React from "react"
import { useSharedFilters } from "@/components/filters/filter-context"
import type { SurfaceAction } from "@/lib/chat/a2ui/protocol"
import { loadChat, saveChat } from "@/lib/chat/persistence"
import { screenContextFor, type ScreenContext } from "@/lib/chat/screen-context"
import { useChat, type ChatTurn } from "@/lib/chat/use-chat"
import type { ChatContext } from "@/lib/data/director-insights"
import { useDataAdapter } from "@/lib/data/data-provider"
import { useSession } from "@/lib/session/session-provider"

export interface ChatSession {
  /** The slide-in panel is open. */
  open: boolean
  setOpen: (open: boolean) => void
  turns: ChatTurn[]
  running: boolean
  send: (question: string, context?: ChatContext) => Promise<void>
  /** Send a user action on an A2UI surface as the next question (docs/adr/0017). */
  sendAction: (action: SurfaceAction, question: string, context?: ChatContext) => Promise<void>
  stop: () => void
  reset: () => void
  /** False until a stored conversation has been put back (it is read after hydration, never during it). */
  hydrated: boolean
  /** The screen the person is on and the filters on it: what the panel sends and shows as chips. */
  screen: ScreenContext
}

const ChatSessionContext = React.createContext<ChatSession | null>(null)

const SAVE_DELAY_MS = 300

/**
 * One conversation for the whole app shell. The slide-in panel and the full `/chat` page both read it, so the
 * thread survives the panel closing, navigating between screens and a reload. A different person gets a fresh one.
 */
export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { userId } = useSession()
  return (
    <ChatSessionProvider key={userId} userId={userId}>
      {children}
    </ChatSessionProvider>
  )
}

function ChatSessionProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const adapter = useDataAdapter()
  const pathname = usePathname()
  const { filters } = useSharedFilters()
  const { turns, running, send, sendAction, stop, reset, restore, hydrated, threadId } = useChat(adapter)
  // Open for one screen: a route change (or the full page, which is the same conversation) closes the panel.
  const [openPath, setOpenPath] = React.useState<string | null>(null)
  const open = openPath === pathname && pathname !== "/chat"
  const setOpen = React.useCallback((next: boolean) => setOpenPath(next ? pathname : null), [pathname])

  React.useEffect(() => {
    restore(loadChat(userId))
  }, [userId, restore])

  // Save shortly after the last change (tokens stream in many times a second), and once more when the page goes away.
  const latest = React.useRef({ threadId, turns, hydrated })
  React.useEffect(() => {
    latest.current = { threadId, turns, hydrated }
  })
  React.useEffect(() => {
    if (!hydrated) return
    const timer = setTimeout(() => saveChat(userId, { threadId, turns }), SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [hydrated, userId, threadId, turns])
  React.useEffect(() => {
    const flush = () => {
      if (latest.current.hydrated) saveChat(userId, latest.current)
    }
    window.addEventListener("pagehide", flush)
    return () => {
      window.removeEventListener("pagehide", flush)
      flush()
    }
  }, [userId])

  const screen = React.useMemo(() => screenContextFor(pathname, filters), [pathname, filters])
  const value = React.useMemo<ChatSession>(
    () => ({ open, setOpen, turns, running, send, sendAction, stop, reset, hydrated, screen }),
    [open, setOpen, turns, running, send, sendAction, stop, reset, hydrated, screen],
  )
  return <ChatSessionContext.Provider value={value}>{children}</ChatSessionContext.Provider>
}

export function useChatSession(): ChatSession {
  const value = React.useContext(ChatSessionContext)
  if (!value) throw new Error("useChatSession must be used inside ChatProvider")
  return value
}
