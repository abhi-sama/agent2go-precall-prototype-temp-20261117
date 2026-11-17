import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { checkPreference } from "./memory-guard"
import { isSuggestionRequest, noticedPreferences, normalizedPreference, suggestPreferences } from "./memory-suggest"

/** The agent's detectors and this mirror run the same cases, so the mock cannot drift from the real thing (docs/adr/0023). */
const CASES = JSON.parse(readFileSync(join(__dirname, "../../../../backend/agent_memory_suggestion_cases.json"), "utf8")) as {
  noticed: { name: string; messages: string[]; expect: [string, string, string][] }[]
  asks: { yes: string[]; no: string[] }
}

describe("what the person keeps asking for", () => {
  for (const c of CASES.noticed) {
    it(c.name, () => expect(noticedPreferences(c.messages).map((s) => [s.text, s.category, s.reason])).toEqual(c.expect))
  }
  it("every noticed text passes the memory guard", () => {
    for (const c of CASES.noticed) for (const s of noticedPreferences(c.messages)) expect(checkPreference(s.text)).toBeNull()
  })
})

describe("asking what the agent noticed", () => {
  it.each(CASES.asks.yes)("recognises %s", (q) => expect(isSuggestionRequest(q)).toBe(true))
  it.each(CASES.asks.no)("does not take %s for a request", (q) => expect(isSuggestionRequest(q)).toBe(false))
})

describe("what is offered", () => {
  const messages = ["last 90 days", "last 90 days", "last 90 days"]
  it("leaves out what is remembered or dismissed", () => {
    expect(suggestPreferences(messages, [], new Set()).map((s) => s.text)).toEqual(["Default to the last 90 days"])
    expect(suggestPreferences(messages, [{ text: "default to the LAST 90 days" }], new Set())).toEqual([])
    expect(suggestPreferences(messages, [], new Set([normalizedPreference("Default  to the last 90 days")]))).toEqual([])
  })
})
