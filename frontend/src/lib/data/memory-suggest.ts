/**
 * The preference detectors of Ask the agent's suggestions (docs/adr/0023), mirrored from the agent
 * (`backend/agent/src/msl_agent/memory_suggest.py`) for the mock adapter. A suggestion is a way of working noticed in
 * the person's own messages (a date range, tables or charts, a length, a therapeutic area from a closed list) filled
 * into a fixed template: never a name, record id or figure from the data. `memory-suggest.test.ts` runs both ends against
 * `backend/agent_memory_suggestion_cases.json`.
 */
import { checkPreference } from "./memory-guard"
import type { AgentMemoryCategory } from "./types"

export const SUGGEST_MIN_COUNT = 3
export const SUGGEST_MAX_ASKED = 3

export interface PreferenceSuggestion {
  text: string
  category: AgentMemoryCategory
  reason: string
}

const DATE = /\b(?:last|past|previous)\s+(\d{1,3})\s*[- ]?\s*(day|week|month|quarter)s?\b|\b(\d{1,3})[- ](day|week|month|quarter)s?\b/gi
const DATE_MAX: Record<string, number> = { day: 366, week: 52, month: 24, quarter: 8 }
const TABLE = /\b(?:tables?|tabular)\b/i
const CHART = /\b(?:charts?|graphs?|plots?)\b/i
const BULLETS = /\b(\d{1,2})\s+bullet(?:s|\s+points?)?\b/gi
const SHORT = /\b(?:keep (?:it|this|that|answers?|replies|them) (?:short|brief|concise)|be (?:brief|concise)|tl;?dr|(?:shorter|more concise|concise|short) (?:answers?|repl(?:y|ies)|summar(?:y|ies)|responses?))\b/i
const AREAS = ["oncology", "cardiology", "neurology", "immunology", "dermatology", "hematology", "respiratory", "diabetes", "endocrinology", "rheumatology", "gastroenterology"]
const AREA = new RegExp(`\\b(${AREAS.join("|")})\\b`, "gi")
const COMMAND = /^\s*(?:please\s+)?remember\b/i
const ASK = /^(?:please\s+)?(?:suggest\s+(?:some\s+|any\s+)?(?:preferences?|things? to remember)|what (?:have you noticed|did you notice) about how i (?:like to )?(?:work|ask)|what should you remember(?: about me| about how i work)?|(?:any )?preferences? (?:you(?:'ve| have) )?noticed)\s*[?.!]*$/i

export const SUGGEST_ASK_REPLY = "Here is what I noticed in this conversation. Nothing is saved unless you choose Remember."
export const SUGGEST_ASK_NONE = "I have not noticed a preference worth remembering yet. You can always say: remember I prefer tables."

export const isSuggestionRequest = (question: string) => ASK.test(question.trim())

/**
 * The key a dismissal is stored under in the mock: the lower-cased, single-spaced text. The BE stores a hash of the same
 * (`suggestion_key`) so it keeps no preference words; the mock lives in the person's own browser, so it keeps the text.
 */
export const normalizedPreference = (text: string) => text.split(/\s+/).filter(Boolean).join(" ").toLowerCase()

function habit<T>(messages: string[], extract: (message: string) => T[]): [T, number] | null {
  const counts = new Map<T, number>()
  for (const message of messages) for (const value of new Set(extract(message))) counts.set(value, (counts.get(value) ?? 0) + 1)
  let best: [T, number] | null = null
  for (const entry of counts) if (best === null || entry[1] > best[1]) best = entry
  return best !== null && best[1] >= SUGGEST_MIN_COUNT ? best : null
}

const ranges = (message: string): string[] =>
  [...message.matchAll(DATE)].flatMap((m) => {
    const n = Number(m[1] ?? m[3])
    const unit = (m[2] ?? m[4]).toLowerCase()
    return n >= 2 && n <= DATE_MAX[unit] ? [`${n} ${unit}`] : []
  })
const bullets = (message: string): number[] => [...message.matchAll(BULLETS)].map((m) => Number(m[1])).filter((n) => n >= 2 && n <= 10)
const areas = (message: string): string[] => [...message.matchAll(AREA)].map((m) => m[1].toLowerCase())

/** Every preference the person's own messages show, most useful first, before anything remembered or dismissed is removed. */
export function noticedPreferences(userMessages: string[]): PreferenceSuggestion[] {
  const messages = userMessages.filter((m) => typeof m === "string" && !COMMAND.test(m) && !isSuggestionRequest(m))
  const found: PreferenceSuggestion[] = []
  const date = habit(messages, ranges)
  if (date) {
    const [n, unit] = date[0].split(" ")
    found.push({ text: `Default to the last ${n} ${unit}s`, category: "DATE_RANGE", reason: `You asked for the last ${n} ${unit}s ${date[1]} times.` })
  }
  const tables = messages.filter((m) => TABLE.test(m)).length
  const charts = messages.filter((m) => CHART.test(m)).length
  if (tables >= SUGGEST_MIN_COUNT && tables > charts) found.push({ text: "I prefer tables over charts", category: "FORMAT", reason: `You asked for a table ${tables} times.` })
  else if (charts >= SUGGEST_MIN_COUNT && charts > tables) found.push({ text: "I prefer charts over tables", category: "FORMAT", reason: `You asked for a chart ${charts} times.` })
  const points = habit(messages, bullets)
  if (points) found.push({ text: `Keep answers to ${points[0]} bullets`, category: "LENGTH", reason: `You asked for ${points[0]} bullets ${points[1]} times.` })
  const short = messages.filter((m) => SHORT.test(m)).length
  if (short >= SUGGEST_MIN_COUNT) found.push({ text: "Keep answers short", category: "LENGTH", reason: `You asked for shorter answers ${short} times.` })
  const area = habit(messages, areas)
  if (area) found.push({ text: `Focus on ${area[0]}`, category: "FOCUS", reason: `You asked about ${area[0]} ${area[1]} times.` })
  return found.filter((s) => checkPreference(s.text) === null)
}

/** What to offer: what was noticed, minus what is already remembered (same text, any case) or was dismissed. */
export function suggestPreferences(userMessages: string[], remembered: { text: string }[], dismissed: ReadonlySet<string>): PreferenceSuggestion[] {
  const saved = new Set(remembered.map((item) => normalizedPreference(item.text)))
  return noticedPreferences(userMessages).filter((s) => !saved.has(normalizedPreference(s.text)) && !dismissed.has(normalizedPreference(s.text)))
}
