/**
 * Turns one run's event log, read from `chatEvents` (ADR 0007), into a well-formed AG-UI stream for CopilotKit.
 *
 * This is the trust boundary on the browser side (docs/adr/0018). It is an allow-list: only the event types and
 * custom names below reach CopilotKit, A2UI surfaces only after the answer-catalog gate (ADR 0017), and nothing can
 * start a frontend tool or an interrupt, and the only state it can change is the agent's own `progress` and a
 * `proposal` to change the page's filters (docs/adr/0019), both checked. It also repairs what the AG-UI verifier rejects, because a
 * stored event log can end early (the worker appends a bare `RUN_ERROR` when the agent is unavailable):
 *  - `RUN_STARTED` always comes first and carries this run's ids;
 *  - open text messages and tool calls are closed, and tool calls get a result, before the run ends;
 *  - nothing follows the terminal event.
 */

import { EventType, type BaseEvent } from "@ag-ui/core"
import { A2UI_ACTIVITY_TYPE, surfaceFromActivity } from "@/lib/chat/a2ui/protocol"
import type { ChatContext } from "@/lib/data/director-insights"
import { sanitizeProgress, sanitizeProposal, settleProgress, type AgentProgress } from "@/lib/chat/page-state"
import { ANSWER_ACTIVITY, EVIDENCE_EVENTS, HEAD_EVENTS, ids, type AnswerActivity, type AnswerPart, type AnswerStatus, type EvidenceEvent } from "./answer"

type Json = Record<string, unknown>

const MAX_SURFACES = 4
const MAX_EVIDENCE_EVENTS = 400
const MAX_STATE_EVENTS = 80
const MAX_ERROR_CHARS = 300
const DEFAULT_ERROR = "The agent could not complete this answer."

export interface RunIds {
  threadId: string
  runId: string
}

export interface RunMeta {
  userMessageId: string
  context?: ChatContext
}

export type RunOutcome = { status: "done" } | { status: "error"; message: string }

const str = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null)

export class RunStream {
  private started = false
  private ended = false
  private headShown = false
  private textCount = 0
  /** The agent's text message id -> the id CopilotKit sees. */
  private readonly openText = new Map<string, string>()
  private readonly openTools = new Set<string>()
  private readonly awaitingResult = new Set<string>()
  private readonly knownTools = new Set<string>()
  private readonly surfaces = new Map<string, string>()
  private readonly evidence: EvidenceEvent[] = []
  /** The agent's latest progress, kept so the answer can carry its final steps and the run can settle it. */
  private progress: AgentProgress | null = null
  private stateEvents = 0

  constructor(
    private readonly ids: RunIds,
    private readonly meta: RunMeta,
  ) {}

  get done(): boolean {
    return this.ended
  }

  /** `RUN_STARTED`, once. Sent before the run is requested, so the chat shows it running at once. */
  start(): BaseEvent[] {
    if (this.started || this.ended) return []
    this.started = true
    return [
      { type: EventType.RUN_STARTED, threadId: this.ids.threadId, runId: this.ids.runId } as BaseEvent,
      // The last run's steps and proposal give way to this run's.
      this.stateDelta([
        { op: "add", path: "/progress", value: { status: "running", steps: [] } },
        { op: "add", path: "/proposal", value: null },
      ]),
    ]
  }

  /** One event from the log, as zero or more events for CopilotKit. */
  push(event: Json): BaseEvent[] {
    if (this.ended) return []
    const out = this.start()
    switch (event.type) {
      case "RUN_STARTED":
        return out
      case "TEXT_MESSAGE_START": {
        const id = str(event.messageId)
        if (id) out.push(...this.openTextMessage(id))
        return out
      }
      case "TEXT_MESSAGE_CONTENT": {
        const id = str(event.messageId)
        const delta = str(event.delta)
        if (!id || !delta) return out
        out.push(...this.openTextMessage(id))
        out.push({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: this.openText.get(id), delta } as BaseEvent)
        return out
      }
      case "TEXT_MESSAGE_END": {
        const id = str(event.messageId)
        const mapped = id ? this.openText.get(id) : undefined
        if (id && mapped) {
          this.openText.delete(id)
          out.push({ type: EventType.TEXT_MESSAGE_END, messageId: mapped } as BaseEvent)
        }
        return out
      }
      case "TOOL_CALL_START": {
        const id = str(event.toolCallId)
        if (!id || this.knownTools.has(id)) return out
        this.knownTools.add(id)
        this.openTools.add(id)
        out.push({
          type: EventType.TOOL_CALL_START,
          toolCallId: id,
          toolCallName: str(event.toolCallName) ?? "tool",
          parentMessageId: ids.tools(this.ids.runId),
        } as BaseEvent)
        return out
      }
      case "TOOL_CALL_ARGS": {
        const id = str(event.toolCallId)
        const delta = str(event.delta)
        if (id && delta && this.openTools.has(id)) out.push({ type: EventType.TOOL_CALL_ARGS, toolCallId: id, delta } as BaseEvent)
        return out
      }
      case "TOOL_CALL_END": {
        const id = str(event.toolCallId)
        if (!id) return out
        out.push(...this.endTool(id))
        // A chart tool that ended without a ready chart leaves no placeholder (lib/chat/events.ts).
        out.push(...this.keepEvidence({ type: "TOOL_CALL_END", toolCallId: id }))
        return out
      }
      case "TOOL_CALL_RESULT": {
        const id = str(event.toolCallId)
        if (!id || !this.knownTools.has(id)) return out
        out.push(...this.endTool(id))
        if (this.awaitingResult.delete(id)) out.push(this.toolResult(id, str(event.content) ?? "complete"))
        return out
      }
      case "CUSTOM": {
        const name = str(event.name)
        if (!name || !EVIDENCE_EVENTS.has(name)) return out
        out.push(...this.keepEvidence({ type: "CUSTOM", name, value: event.value }, HEAD_EVENTS.has(name)))
        out.push({ type: EventType.CUSTOM, name, value: event.value } as BaseEvent)
        return out
      }
      case "ACTIVITY_SNAPSHOT":
        out.push(...this.surface(event))
        return out
      case "STATE_SNAPSHOT":
        out.push(...this.agentState(event.snapshot))
        return out
      case "RUN_FINISHED":
        out.push(...this.finish({ status: "done" }))
        return out
      case "RUN_ERROR":
        out.push(...this.finish({ status: "error", message: str(event.message)?.slice(0, MAX_ERROR_CHARS) ?? DEFAULT_ERROR }))
        return out
      default:
        // State deltas, message snapshots, raw, step and reasoning events are not part of this contract.
        return out
    }
  }

  /** Close everything that is open, add the answer's tail, and end the run. Idempotent. */
  finish(outcome: RunOutcome): BaseEvent[] {
    if (this.ended) return []
    const out = this.start()
    for (const [, mapped] of this.openText) out.push({ type: EventType.TEXT_MESSAGE_END, messageId: mapped } as BaseEvent)
    this.openText.clear()
    for (const id of [...this.openTools]) out.push(...this.endTool(id))
    for (const id of [...this.awaitingResult]) out.push(this.toolResult(id, outcome.status === "done" ? "complete" : "stopped"))
    this.awaitingResult.clear()
    const status: AnswerStatus = outcome.status
    const error = outcome.status === "error" ? outcome.message : null
    // Nothing is left "running" once the run is over, whatever the agent last said.
    this.progress = settleProgress(this.progress, outcome.status)
    out.push(this.stateDelta([{ op: "add", path: "/progress", value: this.progress }]))
    if (this.headShown) out.push(this.snapshot("head", status, error))
    out.push(this.snapshot("tail", status, error))
    this.ended = true
    out.push(
      outcome.status === "done"
        ? ({ type: EventType.RUN_FINISHED, threadId: this.ids.threadId, runId: this.ids.runId } as BaseEvent)
        : ({ type: EventType.RUN_ERROR, message: outcome.message, code: "ANSWER_FAILED" } as BaseEvent),
    )
    return out
  }

  private openTextMessage(agentId: string): BaseEvent[] {
    if (this.openText.has(agentId)) return []
    const mapped = ids.text(this.ids.runId, this.textCount++)
    this.openText.set(agentId, mapped)
    return [{ type: EventType.TEXT_MESSAGE_START, messageId: mapped, role: "assistant" } as BaseEvent]
  }

  private endTool(id: string): BaseEvent[] {
    if (!this.openTools.delete(id)) return []
    this.awaitingResult.add(id)
    return [{ type: EventType.TOOL_CALL_END, toolCallId: id } as BaseEvent]
  }

  private toolResult(id: string, content: string): BaseEvent {
    // The tool's output stays on the server; the chat only learns that the call finished.
    return { type: EventType.TOOL_CALL_RESULT, messageId: ids.toolResult(this.ids.runId, id), toolCallId: id, content: content.slice(0, 40), role: "tool" } as BaseEvent
  }

  private keepEvidence(event: EvidenceEvent, headWorthy = false): BaseEvent[] {
    if (this.evidence.length >= MAX_EVIDENCE_EVENTS) return []
    this.evidence.push(event)
    if (!this.headShown && !headWorthy) return []
    this.headShown = true
    return [this.snapshot("head", "running", null)]
  }

  private snapshot(part: AnswerPart, status: AnswerStatus, error: string | null): BaseEvent {
    const content: AnswerActivity = {
      v: 1,
      runId: this.ids.runId,
      part,
      userMessageId: this.meta.userMessageId,
      ...(this.meta.context ? { context: this.meta.context } : {}),
      status,
      error,
      events: [...this.evidence],
      ...(part === "tail" && this.progress?.steps.length ? { steps: this.progress.steps } : {}),
    }
    return {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: part === "head" ? ids.head(this.ids.runId) : ids.tail(this.ids.runId),
      activityType: ANSWER_ACTIVITY,
      content,
      replace: true,
    } as BaseEvent
  }

  private stateDelta(delta: { op: "add"; path: string; value: unknown }[]): BaseEvent {
    this.stateEvents++
    return { type: EventType.STATE_DELTA, delta } as BaseEvent
  }

  /**
   * The agent's own part of the shared state: its progress and a proposal for the page. Anything else in the snapshot
   * (including the page's own `page` key) is ignored, so the agent can never write the page's state or the person's.
   */
  private agentState(snapshot: unknown): BaseEvent[] {
    if (typeof snapshot !== "object" || snapshot === null || this.stateEvents >= MAX_STATE_EVENTS) return []
    const raw = snapshot as Record<string, unknown>
    const delta: { op: "add"; path: string; value: unknown }[] = []
    const progress = sanitizeProgress(raw.progress)
    if (progress) {
      this.progress = progress
      delta.push({ op: "add", path: "/progress", value: progress })
    }
    const proposal = sanitizeProposal(raw.proposal)
    if (proposal) delta.push({ op: "add", path: "/proposal", value: { ...proposal, status: "proposed" } })
    return delta.length ? [this.stateDelta(delta)] : []
  }

  /** An A2UI surface that passes the answer-catalog gate (ADR 0017); anything else is dropped whole. */
  private surface(event: Json): BaseEvent[] {
    if (event.activityType !== A2UI_ACTIVITY_TYPE) return []
    const item = surfaceFromActivity(event)
    if (!item) return []
    const known = this.surfaces.get(item.messageId)
    if (known !== undefined ? known !== item.surfaceId : this.surfaces.size >= MAX_SURFACES || [...this.surfaces.values()].includes(item.surfaceId)) return []
    this.surfaces.set(item.messageId, item.surfaceId)
    return [
      {
        type: EventType.ACTIVITY_SNAPSHOT,
        // Scoped to the run, so a surface can never replace a message from another answer.
        messageId: ids.surface(this.ids.runId, item.surfaceId),
        activityType: A2UI_ACTIVITY_TYPE,
        content: { a2ui_operations: item.operations },
        replace: true,
      } as BaseEvent,
    ]
  }
}
