import { describe, expect, it } from "vitest"
import { ANSWER_MARKDOWN, CITATION_HREF, citationAt, citeAnswer } from "./cite"
import type { CitationItem, FactItem } from "./events"

const fact = (factId: string, value: number, citationIds: string[]): FactItem => ({ factId, label: factId, value, unit: "calls", period: "p", scope: "s", citationIds })
const citation = (recordId: string): CitationItem => ({ recordId, dataset: "calls", label: recordId })

describe("citeAnswer", () => {
  const turn = { facts: [fact("f1", 1320, ["C1"]), fact("f2", 7, ["C2"])], citations: [citation("C1"), citation("C2")], sampleLimitations: [] }

  it("puts the records behind a figure right after the sentence that repeats it", () => {
    expect(citeAnswer("You had 1,320 calls. And 7 HCPs.", turn)).toBe("You had 1,320 calls. [1](#a2g-cite-1) And 7 HCPs. [2](#a2g-cite-2)")
  })

  it("cites every record after a qualitative sentence", () => {
    expect(citeAnswer("HCPs value evidence.", turn)).toBe("HCPs value evidence. [1](#a2g-cite-1) [2](#a2g-cite-2)")
  })

  it("leaves text without citations, code and tables alone", () => {
    expect(citeAnswer("No records here.", { facts: [], citations: [], sampleLimitations: [] })).toBe("No records here.")
    expect(citeAnswer("```\n1,320 calls.\n```", turn)).toBe("```\n1,320 calls.\n```")
  })

  it("leaves out the sample limitations paragraph when the answer shows them in their own block", () => {
    expect(citeAnswer("Answer.\n\nSample limitations: small groups.", { facts: [], citations: [], sampleLimitations: ["small groups"] })).toBe("Answer.")
  })

  it("uses links the renderer can recognise and nothing else", () => {
    expect(CITATION_HREF.exec("#a2g-cite-12")?.[1]).toBe("12")
    expect(CITATION_HREF.test("https://example.com/#a2g-cite-1")).toBe(false)
    expect(CITATION_HREF.test("javascript:alert(1)")).toBe(false)
  })
})

describe("answer markdown", () => {
  const citations = [citation("C1"), citation("C2")]
  it("turns only this answer's own markers into citations", () => {
    expect(citationAt("#a2g-cite-2", citations)?.recordId).toBe("C2")
    expect(citationAt("#a2g-cite-9", citations)).toBeUndefined()
    expect(citationAt("https://evil.example", citations)).toBeUndefined()
    expect(citationAt("javascript:alert(1)", citations)).toBeUndefined()
    expect(citationAt(undefined, citations)).toBeUndefined()
  })
  it("parses no raw HTML", () => {
    expect(ANSWER_MARKDOWN.rehypePlugins).toEqual([])
  })
})
