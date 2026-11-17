"use client"

import * as React from "react"
import type { AppSyncChatAgent } from "@/lib/chat/agent/appsync-agent"
import type { ScreenContext } from "@/lib/chat/screen-context"

export interface ChatSession {
  /** The panel (sheet, drawer or docked sidebar) is open. */
  open: boolean
  setOpen: (open: boolean) => void
  /** The CopilotKit agent for this person's conversation (docs/adr/0018). */
  agent: AppSyncChatAgent
  /** The conversation's thread id; it changes when the person starts over. */
  threadId: string
  /** An answer is being written. */
  running: boolean
  /** False until a stored conversation has been put back (it is read after hydration, never during it). */
  hydrated: boolean
  /** Start over: stop any answer, clear the thread and forget it in storage. */
  reset: () => void
  /** The screen the person is on and the filters on it: what the panel sends and shows as chips. */
  screen: ScreenContext
}

export const ChatSessionContext = React.createContext<ChatSession | null>(null)

export function useChatSession(): ChatSession {
  const value = React.useContext(ChatSessionContext)
  if (!value) throw new Error("useChatSession must be used inside ChatProvider")
  return value
}
