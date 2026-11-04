import type { EvalChange, EvalPersona, EvalQuestionKind, EvalRunSummary } from "@/lib/data/evals"

export const PERSONA_LABEL: Record<EvalPersona, string> = { msl: "MSL", director: "Director", executive: "Executive", admin: "Administrator" }

export const KIND_LABEL: Record<EvalQuestionKind, string> = { QUANTITATIVE: "Exact count", QUALITATIVE: "Qualitative", LEAK_PROBE: "Leak probe" }

/** 0..1 as a whole percent; null (does not apply) as an em dash. */
export function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${Math.round(value * 100)}%`
}

export function seconds(ms: number | null | undefined): string {
  if (!ms && ms !== 0) return "—"
  return ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`
}

export function when(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

export const CHANGE_LABEL: Record<EvalChange, string> = { IMPROVED: "Improved", REGRESSED: "Regressed", UNCHANGED: "Unchanged", ADDED: "New question", REMOVED: "Dropped" }

export function isFinished(run: Pick<EvalRunSummary, "status">): boolean {
  return run.status === "COMPLETE" || run.status === "ERROR"
}

/** Scores are met or not by the same bars the captain set: counts exact, faithfulness and citations at least 90%. */
export const BAR = { faithfulness: 0.9, citationCorrectness: 0.9, exactCountRate: 1 } as const
