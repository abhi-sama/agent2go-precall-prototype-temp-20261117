/**
 * The preference guard for what Ask the agent remembers (docs/adr/0022), mirrored from the BE (`a2g_api.agent_memory`,
 * authoritative) for the mock adapter and the browser's own pre-checks. Memory is how a person likes to work, never a
 * data fact about HCPs, calls or figures. `memory-guard.test.ts` runs both ends against `backend/agent_memory_guard_cases.json`.
 */
import type { AgentMemoryCategory } from "./types"

export const MEMORY_CATEGORIES: readonly AgentMemoryCategory[] = ["FORMAT", "LENGTH", "DATE_RANGE", "FOCUS", "OTHER"]
export const MEMORY_MAX_TEXT = 160
export const MEMORY_MAX_ITEMS = 30

const RECORD_NOUNS = "(?:calls?|hcps?|kols?|responses?|respondents?|visits?|meetings?|interactions?|patients?|prescriptions?|records?|territor(?:y|ies)|insights?|scripts?)"
const REJECT: readonly (readonly [string, RegExp])[] = [
  ["identifier", /\b(?:HCP|NPI|CALL|RESP|TERR|T)-[A-Za-z0-9_-]*\d|\b[A-Z]{2}-\d{2}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b\d{5,}\b/i],
  ["contact", /\S+@\S+\.\S+|\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/],
  ["person", /\b(?:Dr|Mr|Ms|Mrs)\b\.?\s+[A-Z]|\b(?:Doctor|Prof|Professor)\b\.?\s+[A-Z]/],
  ["date", /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i],
  [
    "figure",
    new RegExp(`[%$€£]|\\bpercent\\b|\\d+\\.\\d+|\\d{1,3}(?:,\\d{3})+|\\b\\d+\\s*${RECORD_NOUNS}\\b|\\b${RECORD_NOUNS}\\s*(?:was|were|is|are|=|:)\\s*\\d|\\d{4,}`, "i"),
  ],
  ["record_fact", /\b(?:met with|spoke (?:to|with)|told me|said (?:that|no|yes)|my (?:call|meeting|visit)\b|call(?:ed)? with|opinion leader)\b/i],
  ["instruction", /\b(?:ignore|disregard|override|bypass|jailbreak)\b|system prompt|previous instructions|\breveal\b|other users?\b|all (?:territories|hcps?|records)\b|everything\b/i],
]

/** The reason a preference is refused, or null when it only says how the person likes to work. */
export function checkPreference(text: unknown): string | null {
  if (typeof text !== "string") return "empty"
  const stripped = text.trim()
  if (!stripped) return "empty"
  if (stripped.length > MEMORY_MAX_TEXT) return "too_long"
  if (/[\u0000-\u001f]/.test(stripped)) return "multiline"
  for (const [reason, pattern] of REJECT) if (pattern.test(stripped)) return reason
  return null
}

const CATEGORY_RULES: readonly (readonly [AgentMemoryCategory, RegExp])[] = [
  ["DATE_RANGE", /\b(?:days?|weeks?|months?|quarters?|years?|date range|period|timeframe|time frame|window)\b/i],
  ["LENGTH", /\b(?:short|shorter|brief|briefs|concise|detail(?:ed)?|long|longer|bullets?|sentences?|words?|length|summary|summaries)\b/i],
  ["FORMAT", /\b(?:tables?|charts?|graphs?|plots?|visuals?|lists?|format|layout|plain language|language|tone|style|lead with)\b/i],
  ["FOCUS", /\b(?:focus|oncology|therapeutic|area|molecule|indication|disease|study|topic|topics|priority|priorities)\b/i],
]

export function categorize(text: string): AgentMemoryCategory {
  return CATEGORY_RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? "OTHER"
}

export const cleanMemoryText = (text: string) => text.split(/\s+/).filter(Boolean).join(" ")

// "Remember I prefer tables", "remember that I want 90 days", "remember this: keep briefs short" (an imperative at the start).
const REMEMBER = /^(?:please\s+)?remember\b(?:\s+(?:that|this)\b)?\s*[:,-]?\s*([\s\S]*)$/i

export const MEMORY_REFUSAL =
  "I remember how you like to work, such as tables over charts or a default 90-day range. I do not save names, record IDs, calls or figures: those are always read fresh from your data. Rephrase it as a preference to try again."
export const MEMORY_EMPTY = "Tell me what to remember, for example: remember I prefer tables."

export type MemoryRequest = { kind: "propose"; values: { text: string; category: AgentMemoryCategory } } | { kind: "refuse"; reply: string }

/** A remember request in a chat message: a preference to propose, a fixed refusal, or null for ordinary chat. */
export function parseMemoryRequest(question: string): MemoryRequest | null {
  const match = REMEMBER.exec(question.trim())
  if (!match) return null
  const text = cleanMemoryText(match[1]).replace(/[ .!]+$/, "")
  if (!text) return { kind: "refuse", reply: MEMORY_EMPTY }
  if (checkPreference(text) !== null) return { kind: "refuse", reply: MEMORY_REFUSAL }
  return { kind: "propose", values: { text, category: categorize(text) } }
}
