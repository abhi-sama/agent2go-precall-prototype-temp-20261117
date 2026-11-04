import { CircleCheck, CircleX, Loader2, ShieldAlert } from "lucide-react"
import type { EvalChange, EvalRunStatus, EvalVerdict } from "@/lib/data/evals"
import { cn } from "@/lib/utils"
import { CHANGE_LABEL } from "./format"

/** Pass or fail is said in words and an icon, never by colour alone. */
export function VerdictBadge({ verdict, leaked, className }: { verdict: EvalVerdict | null; leaked?: boolean; className?: string }) {
  if (!verdict) return null
  const pass = verdict === "PASS"
  const Icon = pass ? CircleCheck : leaked ? ShieldAlert : CircleX
  return (
    <span
      data-testid="verdict-badge"
      data-verdict={verdict}
      className={cn(
        "inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold",
        pass ? "border-success/40 bg-success/10 text-foreground" : "border-destructive/40 bg-destructive/10 text-foreground",
        className,
      )}
    >
      <Icon className={cn("size-3.5", pass ? "text-success" : "text-destructive")} aria-hidden />
      {pass ? "Pass" : leaked ? "Fail · leak" : "Fail"}
    </span>
  )
}

const STATUS_TEXT: Record<EvalRunStatus, string> = { RUNNING: "Asking the agent", SCORING: "Scoring answers", COMPLETE: "Complete", ERROR: "Did not finish" }

export function StatusPill({ status, className }: { status: EvalRunStatus; className?: string }) {
  const busy = status === "RUNNING" || status === "SCORING"
  return (
    <span data-testid="run-status" data-status={status} className={cn("inline-flex min-h-7 items-center gap-1.5 rounded-full border bg-muted px-2.5 text-xs font-semibold", status === "ERROR" && "border-destructive/40", className)}>
      {busy && <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />}
      {STATUS_TEXT[status]}
    </span>
  )
}

const CHANGE_STYLE: Record<EvalChange, string> = {
  IMPROVED: "border-success/40 bg-success/10",
  REGRESSED: "border-destructive/40 bg-destructive/10",
  UNCHANGED: "border-border bg-muted text-muted-foreground",
  ADDED: "border-fact/30 bg-fact-soft text-fact",
  REMOVED: "border-border bg-muted text-muted-foreground",
}

export function ChangeBadge({ change }: { change: EvalChange }) {
  return (
    <span data-testid="change-badge" data-change={change} className={cn("inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs font-semibold", CHANGE_STYLE[change])}>
      {CHANGE_LABEL[change]}
    </span>
  )
}
