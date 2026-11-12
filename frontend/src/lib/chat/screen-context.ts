import type { ChatContext } from "@/lib/data/director-insights"
import type { InsightFilters } from "@/lib/data/types"
import { formatRange } from "@/lib/dates"

/** What the slide-in chat panel tells the agent, and the chips that show the person exactly that. */
export interface ContextChip {
  kind: "screen" | "range" | "territory" | "product" | "question"
  label: string
}

export interface ScreenContext {
  /** Sent through the approved path (`ChatContextInput`). Defaults for the agent, never authority. */
  context: ChatContext
  chips: ContextChip[]
}

interface ScreenInfo {
  label: string
  /** The screen reads the shared filter bar, so the filters on it are what the person is looking at. */
  filtered: boolean
}

/** Routes in the app shell. Anything not listed is described from its path, with no filters. */
const SCREENS: Record<string, ScreenInfo> = {
  "/msl": { label: "My territory", filtered: true },
  "/msl/activity": { label: "My activity", filtered: false },
  "/msl/briefs": { label: "Pre-call brief", filtered: false },
  "/msl/follow-up": { label: "Post-call workflow", filtered: false },
  "/director": { label: "My region", filtered: true },
  "/director/insights": { label: "Director insights", filtered: true },
  "/executive": { label: "Overview", filtered: true },
  "/admin": { label: "Administration", filtered: false },
  "/admin/governance": { label: "Data governance", filtered: false },
}

/** `/director/insights` becomes `director-insights`: the `view` the BE accepts (`^[a-z0-9-]{1,40}$`). */
export function viewOf(pathname: string): string {
  const slug = pathname
    .toLowerCase()
    .split("/")
    .filter(Boolean)
    .join("-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 40)
  return slug || "home"
}

function labelOf(pathname: string): string {
  const known = SCREENS[pathname]
  if (known) return known.label
  const last = pathname.split("/").filter(Boolean).at(-1) ?? "home"
  const text = last.replace(/[-_]+/g, " ")
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** True when the shared filters are what this screen shows. */
export function isFilteredScreen(pathname: string): boolean {
  return SCREENS[pathname]?.filtered ?? false
}

/**
 * The context for the screen the person is on: its route, plus the filter state when the screen shows
 * filters. Only values the BE accepts are produced, so a stale or odd filter can never fail the request.
 */
export function screenContextFor(pathname: string, filters: InsightFilters): ScreenContext {
  const context: ChatContext = { view: viewOf(pathname) }
  const chips: ContextChip[] = [{ kind: "screen", label: labelOf(pathname) }]
  if (!isFilteredScreen(pathname)) return { context, chips }

  if (filters.from && filters.to && filters.from <= filters.to) {
    context.from = filters.from
    context.to = filters.to
    chips.push({ kind: "range", label: formatRange({ from: filters.from, to: filters.to }) })
  }
  if (filters.territoryId && /^[A-Za-z0-9_.:-]{1,64}$/.test(filters.territoryId)) {
    context.territoryId = filters.territoryId
    chips.push({ kind: "territory", label: `Territory ${filters.territoryId}` })
  }
  // The chat API deliberately has no molecule field. Keep the active product visible and removable rather than
  // widening the approved request contract in this layout-only change.
  if (filters.molecule) chips.push({ kind: "product", label: `Product ${filters.molecule}` })
  if (filters.questionId && /^[A-Za-z0-9_.:-]{1,64}$/.test(filters.questionId)) {
    context.questionId = filters.questionId
    chips.push({ kind: "question", label: `Question ${filters.questionId}` })
  }
  return { context, chips }
}

/** One line for a past turn: where the question was asked from. */
export function describeContext(context: ChatContext | undefined): string | null {
  if (!context) return null
  const parts: string[] = []
  if (context.view) parts.push(screenLabelForView(context.view))
  if (context.territoryId) parts.push(context.territoryId)
  if (context.questionId) parts.push(context.questionId)
  if (context.from && context.to) parts.push(formatRange({ from: context.from, to: context.to }))
  return parts.length ? parts.join(" · ") : null
}

function screenLabelForView(view: string): string {
  for (const [path, info] of Object.entries(SCREENS)) if (viewOf(path) === view) return info.label
  const text = view.replace(/-/g, " ")
  return text.charAt(0).toUpperCase() + text.slice(1)
}
