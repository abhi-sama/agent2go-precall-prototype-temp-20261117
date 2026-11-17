/**
 * Shared state and page context between the page and the agent in Ask the agent (docs/adr/0019).
 *
 * Three things travel, and none of them is authority (the BE validates again, and every tool reads under the caller's
 * row-level security):
 *  - the page's own state, `state.page` (the page's name and the filters the person left on): the page writes it, the
 *    agent reads it with each question;
 *  - the page's headline figures, a CopilotKit context entry (`useAgentContext`): shown text the agent reads to know
 *    which number a question is about, never repeated as a fact;
 *  - what the agent writes back into state: its `progress` (the steps it takes) and a `proposal` to change the page's
 *    filters. A proposal changes nothing until the person applies it.
 *
 * Everything that arrives from the event log is checked here before it reaches CopilotKit or the page.
 */

import { z } from "zod"
import type { InsightFilters } from "@/lib/data/types"
import { formatRange, isIsoDate, presetRange, RANGE_PRESETS, todayIso, type RangePresetId } from "@/lib/dates"
import type { ChatPageInput } from "@/lib/data/types"

/** The `useAgentContext` description that carries the page's visible figures to the agent. */
export const PAGE_FIGURES_CONTEXT = "agent2go.page-figures"

export const MAX_FIGURES = 12
const ID = /^[A-Za-z0-9_.:-]{1,64}$/
const FILTER_VALUE = /^[A-Za-z0-9][A-Za-z0-9 _.:()/+-]{0,63}$/
const CONTROL = /\p{Cc}/u

// ---------------------------------------------------------------------------------------------------------------
// The page, as the agent reads it
// ---------------------------------------------------------------------------------------------------------------

/** The filters the chat can carry: the shared filter bar's, without the record-level `hcpId`. */
export const PAGE_FILTER_KEYS = ["from", "to", "territoryId", "molecule", "landscape", "study", "survey", "questionId", "theme"] as const
export type PageFilterKey = (typeof PAGE_FILTER_KEYS)[number]
export type PageFilters = Partial<Record<PageFilterKey, string>>

/** `state.page`: written by the page, read by the agent. */
export interface PageState {
  label?: string
  filters: PageFilters
}

export type PageFigure = {
  id: string
  label: string
  value: string
  definition?: string
}

const text = (max: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(max))
    .refine((value) => !CONTROL.test(value))

const filterValue = (key: PageFilterKey) => (key === "from" || key === "to" ? z.string().refine(isIsoDate) : key === "territoryId" || key === "questionId" ? z.string().regex(ID) : z.string().regex(FILTER_VALUE))

/** Only well-formed filter values survive; a range needs both ends in order. */
export function sanitizePageFilters(value: unknown): PageFilters {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {}
  const raw = value as Record<string, unknown>
  const out: PageFilters = {}
  for (const key of PAGE_FILTER_KEYS) {
    const parsed = filterValue(key).safeParse(raw[key])
    if (parsed.success) out[key] = parsed.data
  }
  if (!(out.from && out.to && out.from <= out.to)) {
    delete out.from
    delete out.to
  }
  return out
}

const figureSchema = z.object({ id: z.string().regex(ID), label: text(80), value: text(40), definition: text(160).optional() })

/** Figures the page printed, checked and capped. A malformed one is dropped, not repaired. */
export function sanitizeFigures(value: unknown): PageFigure[] {
  if (!Array.isArray(value)) return []
  const out: PageFigure[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const parsed = figureSchema.safeParse(item)
    if (!parsed.success || seen.has(parsed.data.id)) continue
    seen.add(parsed.data.id)
    out.push(parsed.data)
    if (out.length >= MAX_FIGURES) break
  }
  return out
}

/** `state.page` as the page writes it (and as stored state may hold it): checked, or `undefined`. */
export function sanitizePageState(value: unknown): PageState | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const label = text(80).safeParse(raw.label)
  return { ...(label.success ? { label: label.data } : {}), filters: sanitizePageFilters(raw.filters) }
}

/** The `page` argument of `startChatRun`, or `undefined` when there is nothing to say. */
export function pageInputOf(page: PageState | undefined, figures: PageFigure[]): ChatPageInput | undefined {
  if (!page && figures.length === 0) return undefined
  const filters = page?.filters ?? {}
  return {
    ...(page?.label ? { label: page.label } : {}),
    ...(Object.keys(filters).length ? { filters } : {}),
    ...(figures.length ? { figures } : {}),
  }
}

// ---------------------------------------------------------------------------------------------------------------
// What the agent writes back: progress
// ---------------------------------------------------------------------------------------------------------------

export const MAX_STEPS = 12
export type StepStatus = "running" | "done" | "error"

export interface ProgressStep {
  id: string
  label: string
  status: StepStatus
}

export interface AgentProgress {
  status: StepStatus
  steps: ProgressStep[]
}

const stepSchema = z.object({ id: z.string().regex(ID), label: text(80), status: z.enum(["running", "done", "error"]) })

/** The agent's progress, checked: only closed statuses and short plain labels, at most `MAX_STEPS` steps. */
export function sanitizeProgress(value: unknown): AgentProgress | null {
  if (typeof value !== "object" || value === null) return null
  const raw = value as Record<string, unknown>
  const status = z.enum(["running", "done", "error"]).safeParse(raw.status)
  if (!status.success || !Array.isArray(raw.steps)) return null
  const steps: ProgressStep[] = []
  for (const item of raw.steps) {
    const parsed = stepSchema.safeParse(item)
    if (parsed.success) steps.push(parsed.data)
    if (steps.length >= MAX_STEPS) break
  }
  return { status: status.data, steps }
}

/** The same progress with nothing left running: the run ended as `status`. */
export function settleProgress(progress: AgentProgress | null, status: "done" | "error"): AgentProgress {
  const steps = (progress?.steps ?? []).map((step) => (step.status === "running" ? { ...step, status } : step))
  return { status, steps }
}

// ---------------------------------------------------------------------------------------------------------------
// What the agent writes back: a proposal to change the page
// ---------------------------------------------------------------------------------------------------------------

export type ProposalStatus = "proposed" | "applied" | "dismissed"

export interface ProposalFilters {
  preset?: RangePresetId
  from?: string
  to?: string
  territoryId?: string
  questionId?: string
}

export interface PageProposal {
  id: string
  status: ProposalStatus
  /** Fixed text from the agent saying what it proposes. */
  reason: string
  filters: ProposalFilters
  /** Clear every filter back to the page's default. */
  reset?: boolean
}

const PRESETS = new Set<string>(RANGE_PRESETS.map((preset) => preset.id))
const MAX_SPAN_DAYS = 1830

const proposalSchema = z.object({
  id: z.string().regex(ID),
  status: z.enum(["proposed", "applied", "dismissed"]),
  reason: text(300),
  filters: z.object({
    preset: z.string().refine((id) => PRESETS.has(id)).optional(),
    from: z.string().refine(isIsoDate).optional(),
    to: z.string().refine(isIsoDate).optional(),
    territoryId: z.string().regex(ID).optional(),
    questionId: z.string().regex(ID).optional(),
  }),
  reset: z.literal(true).optional(),
})

/**
 * A proposal from the agent, checked: a closed shape, a preset or an ordered range (not both), and something to change.
 * The BE has already checked the territory against the caller's scope; this keeps a malformed one off the page.
 */
export function sanitizeProposal(value: unknown): PageProposal | null {
  const parsed = proposalSchema.safeParse(value)
  if (!parsed.success) return null
  const { filters, reset, ...rest } = parsed.data
  const { preset, from, to } = filters
  if (preset && (from || to)) return null
  if (Boolean(from) !== Boolean(to)) return null
  if (from && to) {
    if (from > to) return null
    if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 > MAX_SPAN_DAYS) return null
  }
  if (!reset && Object.keys(filters).length === 0) return null
  return { ...rest, filters: filters as ProposalFilters, ...(reset ? { reset: true as const } : {}) }
}

/** The filters after applying a proposal: its changes on top of the current ones, or the default when it resets. */
export function applyProposal(proposal: PageProposal, current: InsightFilters, today = todayIso()): InsightFilters {
  const base: InsightFilters = proposal.reset ? { ...presetRange("30d", today) } : { ...current }
  const { preset, from, to, territoryId, questionId } = proposal.filters
  const range = preset ? presetRange(preset, today) : from && to ? { from, to } : null
  return { ...base, ...(range ?? {}), ...(territoryId ? { territoryId } : {}), ...(questionId ? { questionId } : {}) }
}

/** One plain line for the proposal card: what the page would show. */
export function describeProposal(proposal: PageProposal, today = todayIso()): string {
  const { preset, from, to, territoryId, questionId } = proposal.filters
  const parts: string[] = []
  if (proposal.reset) parts.push("Default filters")
  if (preset) parts.push(formatRange(presetRange(preset, today)))
  else if (from && to) parts.push(formatRange({ from, to }))
  if (territoryId) parts.push(`Territory ${territoryId}`)
  if (questionId) parts.push(`Question ${questionId}`)
  return parts.join(" · ")
}

// ---------------------------------------------------------------------------------------------------------------
// The shared state as a whole
// ---------------------------------------------------------------------------------------------------------------

/** What `agent.state` holds. Every key is optional: a conversation starts with `{}`. */
export interface SharedState {
  page?: PageState
  progress?: AgentProgress | null
  proposal?: PageProposal | null
}

export function sharedStateOf(state: unknown): SharedState {
  if (typeof state !== "object" || state === null) return {}
  const raw = state as Record<string, unknown>
  return {
    ...(sanitizePageState(raw.page) ? { page: sanitizePageState(raw.page)! } : {}),
    progress: sanitizeProgress(raw.progress),
    proposal: sanitizeProposal(raw.proposal),
  }
}
