/**
 * The three kinds of content the app shows, and how each one is labelled everywhere: on screen
 * (`components/provenance`), in text exports and in print. One list of words, so the distinction
 * learned on a card is the same one an exported file carries.
 */
export type ProvenanceKind = "fact" | "ai" | "suggestion"

export const KIND_LABEL: Record<ProvenanceKind, string> = {
  fact: "Source",
  ai: "AI summary",
  suggestion: "Suggestion",
}

/** The one line that says what the label means. Shown beside the content and repeated in exports. */
export const KIND_NOTE: Record<ProvenanceKind, string> = {
  fact: "Counted from source records, not written by the AI.",
  ai: "Written by AI from the records cited. Check the sources.",
  suggestion: "A proposal to accept or dismiss, not a confirmed commitment.",
}

export interface ExportCitation {
  /** The number shown on screen, when the content cites by number. */
  number?: number
  recordId: string
  label?: string
}

export interface ExportBlock {
  kind: ProvenanceKind
  title?: string
  /** One entry per paragraph, bullet or row. */
  lines: string[]
  citations?: ExportCitation[]
}

export interface ExportInput {
  title: string
  /** ISO timestamp of the export. */
  exportedAt: string
  /** Free-text scope line, e.g. the territory and date range. */
  scope?: string
  dataThrough?: string | null
  blocks: ExportBlock[]
}

const tag = (kind: ProvenanceKind) => `[${KIND_LABEL[kind].toUpperCase()}]`

/**
 * Plain-text (Markdown-safe) export. Every block keeps its kind in its heading and states what the kind
 * means, so an AI summary can never be read as a source fact once it leaves the app.
 */
export function buildProvenanceExport(input: ExportInput): string {
  const out: string[] = [`# ${input.title}`, ""]
  if (input.scope) out.push(`Scope: ${input.scope}`)
  out.push(`Exported: ${input.exportedAt}`)
  if (input.dataThrough) out.push(`Data through: ${input.dataThrough}`)
  out.push("", "Key:")
  for (const kind of ["fact", "ai", "suggestion"] as const) out.push(`- ${tag(kind)} ${KIND_NOTE[kind]}`)

  for (const block of input.blocks) {
    if (block.lines.length === 0) continue
    out.push("", `## ${tag(block.kind)}${block.title ? ` ${block.title}` : ""}`, KIND_NOTE[block.kind], "")
    for (const line of block.lines) out.push(block.kind === "ai" ? line : `- ${line}`)
    if (block.citations?.length) {
      out.push("", "Sources:")
      for (const c of block.citations) out.push(`- ${c.number ? `[${c.number}] ` : ""}${c.recordId}${c.label ? ` (${c.label})` : ""}`)
    }
  }
  return `${out.join("\n")}\n`
}

/** Delimiter-safe CSV for one source row, with the kind in the first column of every line. */
export function buildFactCsv(rows: { label: string; value: string }[]): string {
  return ["kind,field,value", ...rows.map((r) => `${JSON.stringify(KIND_LABEL.fact)},${JSON.stringify(r.label)},${JSON.stringify(r.value)}`)].join("\n")
}

export function downloadText(filename: string, text: string, mime = "text/markdown;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
