/**
 * The agent CopilotKit talks to in Ask the agent (docs/adr/0018).
 *
 * It is an AG-UI `AbstractAgent` that lives in the browser and never talks to the agent itself: a run starts with the
 * existing `startChatRun` AppSync mutation and reads the run's events with the `chatEvents` query until the BE says it
 * is done (ADR 0001, ADR 0007). Identity is verified in the BE and every figure comes from RLS-scoped SQL there; this
 * class only reshapes the event log for CopilotKit (`RunStream`). Nothing goes to CopilotKit's cloud.
 *
 * Extension points for the features built on this (they are not used here):
 *  - context: CopilotKit's `useAgentContext` entries arrive in `input.context`; the screen context is one of them.
 *  - forwarded props: an A2UI surface action rides `input.forwardedProps` (`SURFACE_ACTION_PROP`).
 *  - state and page context (docs/adr/0019): `input.state.page` (the page's name and filters) and the page's visible
 *    figures (a context entry) ride `startChatRun`'s `page`; the agent's progress and page proposals come back as state.
 *  - tools: `input.tools` reaches `run`, but the AppSync contract has no field for them yet.
 */

import { AbstractAgent, type AgentConfig, type BaseEvent, type Message, type RunAgentInput } from "@ag-ui/client"
import { Observable } from "rxjs"
import { isAllowedAction, type SurfaceAction } from "@/lib/chat/a2ui/protocol"
import { sanitizeChatContext } from "@/lib/chat/context"
import { parseEvent } from "@/lib/chat/events"
import { PAGE_FIGURES_CONTEXT, pageInputOf, sanitizeFigures, sanitizePageState } from "@/lib/chat/page-state"
import type { DataAdapter } from "@/lib/data"
import type { ChatContext } from "@/lib/data/director-insights"
import { toDataError, type ChatPageInput, type ChatSurfaceActionInput } from "@/lib/data/types"
import { log, newCorrelationId } from "@/lib/log/logger"
import { RunStream, type RunOutcome } from "./run-stream"
import { historyOf, textOf } from "./turns"

export const ASK_THE_AGENT = "ask-the-agent"
/** The `useAgentContext` description that carries the screen context (the chips) to the agent. */
export const SCREEN_CONTEXT = "agent2go.screen-context"
/** The forwarded prop that carries an action on an A2UI surface (ADR 0017). */
export const SURFACE_ACTION_PROP = "a2gSurfaceAction"
export const MAX_QUESTION_CHARS = 2_000

export const MESSAGES = {
  stopped: "Answer stopped.",
  slow: "The answer took too long. Please try again.",
  forbidden: "You do not have access to chat.",
  unavailable: "The agent is unavailable. Please try again.",
  empty: "Ask a question first.",
}

export interface AppSyncChatAgentOptions extends AgentConfig {
  adapter: DataAdapter
  pollMs?: number
  maxRunMs?: number
  maxPollFailures?: number
}

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true })
  })

/** The screen context the chat sent with this question, from its AG-UI context entry. */
export function contextOf(input: Pick<RunAgentInput, "context">): ChatContext | undefined {
  const entry = input.context?.find((c) => c.description === SCREEN_CONTEXT)
  if (!entry) return undefined
  try {
    return sanitizeChatContext(JSON.parse(entry.value))
  } catch {
    return undefined
  }
}

/** The page the question was asked from: its state (name and filters) and the figures it prints. Both are checked again. */
export function pageOf(input: Pick<RunAgentInput, "state" | "context">): ChatPageInput | undefined {
  const page = sanitizePageState((input.state as Record<string, unknown> | undefined)?.page)
  const entry = input.context?.find((c) => c.description === PAGE_FIGURES_CONTEXT)
  let figures: ReturnType<typeof sanitizeFigures> = []
  if (entry) {
    try {
      figures = sanitizeFigures(JSON.parse(entry.value))
    } catch {
      figures = []
    }
  }
  return pageInputOf(page, figures)
}

/** A surface action forwarded with this run, if it is one the BE accepts; anything else is ignored. */
export function surfaceActionOf(input: Pick<RunAgentInput, "forwardedProps">): ChatSurfaceActionInput | undefined {
  const raw = (input.forwardedProps as Record<string, unknown> | undefined)?.[SURFACE_ACTION_PROP] as SurfaceAction | undefined
  if (!raw || typeof raw !== "object" || !isAllowedAction(raw)) return undefined
  return { name: raw.name, surfaceId: raw.surfaceId, sourceComponentId: raw.sourceComponentId, timestamp: raw.timestamp, context: raw.context }
}

function lastQuestion(messages: readonly Message[]): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user") return messages[i]
  return undefined
}

function resumeOf(input: RunAgentInput): { interruptedRunId: string; approved: boolean; values?: Record<string, string> } | null {
  const entry = input.resume?.[0]
  if (!entry || !/^write-[A-Za-z0-9_-]{8,64}$/.test(entry.interruptId)) return null
  const payload = entry.payload
  const values: Record<string, string> | undefined = payload && typeof payload === "object" && !Array.isArray(payload) && payload.values && typeof payload.values === "object"
    ? Object.fromEntries(Object.entries(payload.values as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : undefined
  return { interruptedRunId: entry.interruptId.slice("write-".length), approved: entry.status === "resolved" && payload?.approved === true, ...(values ? { values } : {}) }
}

export class AppSyncChatAgent extends AbstractAgent {
  private readonly adapter: DataAdapter
  private readonly pollMs: number
  private readonly maxRunMs: number
  private readonly maxPollFailures: number
  /** Ends the run in progress as stopped; set while a run is open. */
  private stopActive: (() => void) | null = null

  constructor({ adapter, pollMs = 250, maxRunMs = 150_000, maxPollFailures = 4, ...config }: AppSyncChatAgentOptions) {
    super({ agentId: ASK_THE_AGENT, description: "Ask the agent: answers from your data, through the approved AppSync path.", ...config })
    this.adapter = adapter
    this.pollMs = pollMs
    this.maxRunMs = maxRunMs
    this.maxPollFailures = maxPollFailures
  }

  override clone(): AppSyncChatAgent {
    const copy = new AppSyncChatAgent({
      adapter: this.adapter,
      pollMs: this.pollMs,
      maxRunMs: this.maxRunMs,
      maxPollFailures: this.maxPollFailures,
      agentId: this.agentId,
      description: this.description,
      threadId: this.threadId,
      initialMessages: structuredClone(this.messages),
      initialState: structuredClone(this.state),
    })
    return copy
  }

  /** CopilotKit's stop button. The partial answer stays, marked as stopped. */
  override abortRun(): void {
    this.stopActive?.()
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const controller = new AbortController()
      const question = lastQuestion(input.messages)
      const context = contextOf(input)
      const stream = new RunStream({ threadId: input.threadId, runId: input.runId }, { userMessageId: question?.id ?? "", ...(context ? { context } : {}) })
      const emit = (events: BaseEvent[]) => {
        for (const event of events) if (!subscriber.closed) subscriber.next(event)
      }
      const complete = () => {
        controller.abort()
        if (this.stopActive === stop) this.stopActive = null
        if (!subscriber.closed) subscriber.complete()
      }
      /** Finish the answer (a no-op once the log's own terminal event has) and complete the run. */
      const end = (outcome: RunOutcome) => {
        emit(stream.finish(outcome))
        complete()
      }
      const stop = () => end({ status: "error", message: MESSAGES.stopped })
      this.stopActive = stop

      emit(stream.start())
      void this.drive(input, question, context, stream, emit, end, controller.signal)

      return () => {
        controller.abort()
        if (this.stopActive === stop) this.stopActive = null
      }
    })
  }

  private async drive(
    input: RunAgentInput,
    question: Message | undefined,
    context: ChatContext | undefined,
    stream: RunStream,
    emit: (events: BaseEvent[]) => void,
    end: (outcome: RunOutcome) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const correlationId = newCorrelationId()
    const ctx = { correlationId }
    const message = question ? textOf(question).trim().slice(0, MAX_QUESTION_CHARS) : ""
    const resume = resumeOf(input)
    if (!message && !resume) return end({ status: "error", message: MESSAGES.empty })
    const action = surfaceActionOf(input)
    const page = pageOf(input)
    // From the agent's own list: the AG-UI client leaves activity messages (the answers' outcomes) out of `input`.
    const asked = this.messages.findIndex((m) => m.id === question!.id)
    const history = historyOf(asked >= 0 ? this.messages.slice(0, asked) : this.messages)
    try {
      if (resume) {
        await this.adapter.resumeChatRun(ctx, { threadId: input.threadId, runId: input.runId, ...resume })
      } else {
        await this.adapter.startChatRun(ctx, {
          threadId: input.threadId,
          runId: input.runId,
          message,
          history,
          ...(context ? { context } : {}),
          ...(action ? { action } : {}),
          ...(page ? { page } : {}),
        })
      }
      let after = 0
      let failures = 0
      const deadline = Date.now() + this.maxRunMs
      while (!signal.aborted) {
        if (Date.now() > deadline) return end({ status: "error", message: MESSAGES.slow })
        try {
          const page = await this.adapter.chatEvents(ctx, input.runId, after)
          if (signal.aborted) return
          failures = 0
          for (const record of page.events) {
            after = Math.max(after, record.seq)
            const event = parseEvent(record.data)
            if (event) emit(stream.push(event))
            if (stream.done) break
          }
          if (stream.done) break
          // A run that ended without a terminal event must not leave the chat spinning.
          if (page.done) return end({ status: "done" })
        } catch (err) {
          if (++failures >= this.maxPollFailures) throw err
        }
        await wait(this.pollMs, signal)
      }
      if (stream.done) {
        log.child(correlationId).info("chat run done", { operation: "chat", status: "ok" })
        end({ status: "done" }) // the log's terminal event already ended the answer; this completes the run
      }
    } catch (err) {
      if (signal.aborted) return
      const error = toDataError(err, correlationId)
      log.child(correlationId).error("chat run failed", { operation: "chat", status: "error", error_code: error.code })
      end({ status: "error", message: error.code === "FORBIDDEN" ? MESSAGES.forbidden : MESSAGES.unavailable })
    }
  }
}
