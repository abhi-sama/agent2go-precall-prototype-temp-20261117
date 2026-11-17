import { buildProvenanceExport, downloadText, type ExportBlock } from "@/lib/provenance"
import type { AssistantTurn } from "./events"

/** The answer as a file. Facts, the AI summary and suggestions stay in separate, labelled blocks. */
export function exportAnswer(turn: Pick<AssistantTurn, "runId" | "facts" | "citations" | "suggestions">, text: string, dataThrough: string | null): void {
  const blocks: ExportBlock[] = [
    {
      kind: "fact",
      title: "Computed from your data",
      lines: turn.facts.map((f) => `${f.label}: ${f.value.toLocaleString("en-US")} (${f.scope}, ${f.period})`),
    },
    {
      kind: "ai",
      title: "Answer",
      lines: text.split(/\n{2,}/).filter(Boolean),
      citations: turn.citations.map((c, i) => ({ number: i + 1, recordId: c.recordId, label: c.label })),
    },
    { kind: "suggestion", title: "You could ask next", lines: turn.suggestions },
  ]
  const file = buildProvenanceExport({ title: "MSL Agent answer", exportedAt: new Date().toISOString(), dataThrough, blocks })
  downloadText(`msl-agent-answer-${turn.runId}.md`, file)
}

/** "Nov 3, 2026" for a data-through date, or null. */
export function formatThrough(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
}
