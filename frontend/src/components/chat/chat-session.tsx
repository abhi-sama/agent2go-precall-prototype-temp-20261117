"use client"

import * as React from "react"
import type { AppSyncChatAgent } from "@/lib/chat/agent/appsync-agent"
import type { ScreenContext } from "@/lib/chat/screen-context"

export type OpenThreadResult = "opened" | "busy" | "empty" | "unavailable"

export interface ChatSession {
  /** The panel (sheet, drawer or docked sidebar) is open. */
  open: boolean
  setOpen: (open: boolean) => void
  /** The CopilotKit agent for this person's conversation (docs/adr/0018). */
  agent: AppSyncChatAgent
  /** The conversation's thread id; it changes when the person starts over or reopens another conversation. */
  threadId: string
  /**
   * Changes whenever a different saved conversation is put in the chat. The chat is keyed by it: CopilotKit clears a
   * chat's messages when its thread id changes under it, so a reopened conversation needs a fresh chat, not a new id.
   */
  chatKey: number
  /** An answer is being written. */
  running: boolean
  /** False until a stored conversation has been put back (it is read after hydration, never during it). */
  hydrated: boolean
  /** Start over: stop any answer, clear the thread and forget it in storage. */
  reset: () => void
  /**
   * Reopen one of the person's earlier conversations: its saved turns become the thread, and the next question
   * continues it. `busy`: an answer is being written. `empty`: nothing of it can be shown (its turns left the person's scope).
   */
  openThread: (threadId: string) => Promise<OpenThreadResult>
  /** The conversation list is showing in the panel, in place of the conversation. */
  historyOpen: boolean
  setHistoryOpen: (open: boolean) => void
  /** The screen the person is on and the filters on it: what the panel sends and shows as chips. */
  screen: ScreenContext
}

export const ChatSessionContext = React.createContext<ChatSession | null>(null)

export function useChatSession(): ChatSession {
  const value = React.useContext(ChatSessionContext)
  if (!value) throw new Error("useChatSession must be used inside ChatProvider")
  return value
}
