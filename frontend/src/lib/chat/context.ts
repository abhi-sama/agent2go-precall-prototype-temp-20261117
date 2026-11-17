import type { ChatContext } from "@/lib/data/director-insights"

const ID = /^[A-Za-z0-9_.:-]{1,64}$/
const VIEW = /^[a-z0-9-]{1,40}$/
const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * The screen a chat was opened from, read from the link's query (`/chat?territory=T01-02&from=..&to=..`).
 * Only well-formed ids and dates are accepted, and the intent is never taken from a link: a summary is
 * started by the summaries panel itself. The BE validates again; this keeps junk out of the request.
 */
export function parseChatContext(params: URLSearchParams): ChatContext | undefined {
  const context: ChatContext = {}
  const view = params.get("view")
  const territory = params.get("territory")
  const question = params.get("question")
  const from = params.get("from")
  const to = params.get("to")
  if (view && VIEW.test(view)) context.view = view
  if (territory && ID.test(territory)) context.territoryId = territory
  if (question && ID.test(question)) context.questionId = question
  if (from && to && DAY.test(from) && DAY.test(to) && from <= to) {
    context.from = from
    context.to = to
  }
  return Object.keys(context).length ? context : undefined
}

/**
 * The same checks for a context that arrives as a value (the chat's AG-UI context entry, or a stored message): only
 * well-formed ids and dates survive, and never an intent. The BE validates again.
 */
export function sanitizeChatContext(value: unknown): ChatContext | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const v = value as Record<string, unknown>
  const params = new URLSearchParams()
  if (typeof v.view === "string") params.set("view", v.view)
  if (typeof v.territoryId === "string") params.set("territory", v.territoryId)
  if (typeof v.questionId === "string") params.set("question", v.questionId)
  if (typeof v.from === "string" && typeof v.to === "string") {
    params.set("from", v.from)
    params.set("to", v.to)
  }
  return parseChatContext(params)
}

/** `/chat` link that carries a screen's context. Pass only values the screen already shows. */
export function chatLink(context: Pick<ChatContext, "view" | "territoryId" | "questionId" | "from" | "to">): string {
  const params = new URLSearchParams()
  if (context.view) params.set("view", context.view)
  if (context.territoryId) params.set("territory", context.territoryId)
  if (context.questionId) params.set("question", context.questionId)
  if (context.from && context.to) {
    params.set("from", context.from)
    params.set("to", context.to)
  }
  const query = params.toString()
  return query ? `/chat?${query}` : "/chat"
}

/** Starter questions that fit the screen the chat was opened from. */
export function startersFor(context: ChatContext | undefined, defaults: string[]): string[] {
  if (!context) return defaults
  const out: string[] = []
  if (context.questionId) {
    out.push(`How did HCPs answer ${context.questionId}?`)
  }
  if (context.territoryId) {
    out.push(`Which topics are emerging in ${context.territoryId}?`, `What did HCPs record about access in ${context.territoryId}?`)
  } else if (context.view === "director-insights") {
    out.push("Which topics are emerging in my region?")
  }
  return out.length ? out.slice(0, 3) : defaults
}
