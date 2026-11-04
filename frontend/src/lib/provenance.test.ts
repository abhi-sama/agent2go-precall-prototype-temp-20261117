import { describe, expect, it } from "vitest"
import { buildFactCsv, buildProvenanceExport, KIND_LABEL } from "./provenance"

describe("provenance export", () => {
  const text = buildProvenanceExport({
    title: "Answer",
    exportedAt: "2026-11-04T10:00:00Z",
    scope: "Territory NE-01",
    dataThrough: "Nov 2, 2026",
    blocks: [
      { kind: "fact", title: "Computed from your data", lines: ["Distinct calls: 130"] },
      { kind: "ai", title: "Answer", lines: ["You had 130 calls."], citations: [{ number: 1, recordId: "CALL-1", label: "Call" }] },
      { kind: "suggestion", title: "Ask next", lines: ["How many HCPs?"] },
      { kind: "suggestion", title: "Empty", lines: [] },
    ],
  })

  it("labels every kind in a heading and in the key", () => {
    for (const kind of Object.values(KIND_LABEL)) expect(text).toContain(`[${kind.toUpperCase()}]`)
    expect(text).toContain("## [SOURCE] Computed from your data")
    expect(text).toContain("## [AI SUMMARY] Answer")
    expect(text).toContain("## [SUGGESTION] Ask next")
  })

  it("keeps citations with the AI summary and skips empty blocks", () => {
    expect(text).toContain("- [1] CALL-1 (Call)")
    expect(text).not.toContain("Empty")
  })

  it("marks source rows in the CSV", () => {
    expect(buildFactCsv([{ label: "Region", value: "NE, US" }])).toBe('kind,field,value\n"Source","Region","NE, US"')
  })
})
