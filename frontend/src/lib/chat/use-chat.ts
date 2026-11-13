"use client"

import * as React from "react"
import type { DataAdapter } from "@/lib/data"
import type { ChatContext } from "@/lib/data/director-insights"
import { toDataError, type ChatMessageInput, type ChatSurfaceActionInput } from "@/lib/data/types"
import { log, newCorrelationId } from "@/lib/log/logger"
import type { SurfaceAction } from "./a2ui/protocol"
import { applyEvent, newTurn, parseEvent, type AssistantTurn } from "./events"

export interface ChatTurn {
  id: string
  question: string
  answer: AssistantTurn
  /** The screen the question was asked from, kept so a later turn can say where it came from. */
  context?: ChatContext
}

const POLL_MS = 250
const MAX_RUN_MS = 150_000
const MAX_POLL_FAILURES = 4
const HISTORY_TURNS = 3
export const MAX_QUESTION_CHARS = 2_000

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function newId(): string {
  return crypto.randomUUID()
}

/** Prior turns as chat history for the agent: only finished answers, newest few. */
export function historyOf(turns: ChatTurn[]): ChatMessageInput[] {
  return turns
    .filter((t) => t.answer.status === "done" && t.answer.text.trim())
    .slice(-HISTORY_TURNS)
    .flatMap((t) => [
      { role: "user" as const, content: t.question },
      { role: "assistant" as const, content: t.answer.text },
    ])
}

/**
 * One conversation thread. `send` starts a run through the data adapter (AppSync mutation) and then
 * reads the run's events in order until the BE reports it done. Everything the user sees is derived
 * from those events, so the same code renders the mock adapter and the real BE.
 */
export function useChat(adapter: DataAdapter) {
  const [turns, setTurns] = React.useState<ChatTurn[]>([])
  const [threadId, setThreadId] = React.useState(newId)
  const [hydrated, setHydrated] = React.useState(false)
  const turnsRef = React.useRef<ChatTurn[]>([])
  const abort = React.useRef<AbortController | null>(null)
  const running = turns.some((t) => t.answer.status === "running")

  const commit = React.useCallback((next: ChatTurn[]) => {
    turnsRef.current = next
    setTurns(next)
  }, [])

  const patch = React.useCallback(
    (id: string, update: (turn: AssistantTurn) => AssistantTurn) => {
      commit(turnsRef.current.map((t) => (t.id === id ? { ...t, answer: update(t.answer) } : t)))
    },
    [commit],
  )

  React.useEffect(() => () => abort.current?.abort(), [])

  const run = React.useCallback(
    async (question: string, context?: ChatContext, action?: ChatSurfaceActionInput) => {
      const text = question.trim().slice(0, MAX_QUESTION_CHARS)
      if (!text || turnsRef.current.some((t) => t.answer.status === "running")) return
      const runId = newId()
      const correlationId = newCorrelationId()
      const ctx = { correlationId }
      const history = historyOf(turnsRef.current)
      commit([...turnsRef.current, { id: runId, question: text, answer: newTurn(runId), ...(context ? { context } : {}) }])
      const controller = new AbortController()
      abort.current = controller
      const fail = (message: string) => patch(runId, (a) => ({ ...a, status: "error", error: message }))

      try {
        await adapter.startChatRun(ctx, { threadId, runId, message: text, history, ...(context ? { context } : {}), ...(action ? { action } : {}) })
        let after = 0
        let failures = 0
        const deadline = Date.now() + MAX_RUN_MS
        for (;;) {
          if (controller.signal.aborted) return
          if (Date.now() > deadline) return fail("The answer took too long. Please try again.")
          try {
            const page = await adapter.chatEvents(ctx, runId, after)
            failures = 0
            if (page.events.length) {
              after = page.events[page.events.length - 1].seq
              patch(runId, (a) =>
                page.events.reduce((turn, e) => {
                  const event = parseEvent(e.data)
                  return event ? applyEvent(turn, event) : turn
                }, a),
              )
            }
            if (page.done) break
          } catch (err) {
            if (++failures >= MAX_POLL_FAILURES) throw err
          }
          await wait(POLL_MS)
        }
        // A run that ended without a terminal event must not leave the panel spinning.
        patch(runId, (a) => (a.status === "running" ? { ...a, status: "done" } : a))
        log.child(correlationId).info("chat run done", { operation: "chat", status: "ok" })
      } catch (err) {
        const error = toDataError(err, correlationId)
        log.child(correlationId).error("chat run failed", { operation: "chat", status: "error", error_code: error.code })
        fail(error.code === "FORBIDDEN" ? "You do not have access to chat." : "The agent is unavailable. Please try again.")
      }
    },
    [adapter, commit, patch, threadId],
  )

  const send = React.useCallback((question: string, context?: ChatContext) => run(question, context), [run])

  /**
   * A user action on an A2UI surface (docs/adr/0017): a new turn whose question is what the person chose, sent
   * through the same `startChatRun` path with the action attached. The agent validates it and asks it for them.
   */
  const sendAction = React.useCallback(
    (action: SurfaceAction, question: string, context?: ChatContext) =>
      run(question, context, {
        name: action.name,
        surfaceId: action.surfaceId,
        sourceComponentId: action.sourceComponentId,
        timestamp: action.timestamp,
        context: action.context,
      }),
    [run],
  )

  const reset = React.useCallback(() => {
    abort.current?.abort()
    commit([])
    setThreadId(newId())
  }, [commit])

  /** Stop the current local polling loop and leave its partial answer visible. */
  const stop = React.useCallback(() => {
    abort.current?.abort()
    abort.current = null
    commit(
      turnsRef.current.map((turn) =>
        turn.answer.status === "running"
          ? { ...turn, answer: { ...turn.answer, status: "error", error: "Answer stopped." } }
          : turn,
      ),
    )
  }, [commit])

  /** Put a stored conversation back after a reload (or `null` when there is none). Until then `hydrated` is false. */
  const restore = React.useCallback(
    (stored: { turns: ChatTurn[]; threadId: string } | null) => {
      if (stored) {
        commit(stored.turns)
        setThreadId(stored.threadId)
      }
      setHydrated(true)
    },
    [commit],
  )

  return { turns, running, send, sendAction, reset, stop, restore, hydrated, threadId }
}
