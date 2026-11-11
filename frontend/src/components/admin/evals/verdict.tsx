import { Badge } from "@astryxdesign/core/Badge"
import { StatusDot } from "@astryxdesign/core/StatusDot"
import { CircleCheck, CircleX, ShieldAlert } from "lucide-react"
import type { EvalChange, EvalRunStatus, EvalVerdict } from "@/lib/data/evals"
import { CHANGE_LABEL } from "./format"

const BADGE_ICON = "[&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5"

/** Pass or fail is said in words and an icon, never by colour alone. */
export function VerdictBadge({ verdict, leaked }: { verdict: EvalVerdict | null; leaked?: boolean; className?: string }) {
  if (!verdict) return null
  const pass = verdict === "PASS"
  const Icon = pass ? CircleCheck : leaked ? ShieldAlert : CircleX
  return (
    <span data-testid="verdict-badge" data-verdict={verdict} className="inline-flex">
      <Badge variant={pass ? "success" : "error"} icon={<Icon aria-hidden />} label={pass ? "Pass" : leaked ? "Fail · leak" : "Fail"} className={BADGE_ICON} />
    </span>
  )
}

const STATUS_TEXT: Record<EvalRunStatus, string> = { RUNNING: "Asking the agent", SCORING: "Scoring answers", COMPLETE: "Complete", ERROR: "Did not finish" }
const STATUS_VARIANT: Record<EvalRunStatus, "accent" | "success" | "error"> = { RUNNING: "accent", SCORING: "accent", COMPLETE: "success", ERROR: "error" }

export function StatusPill({ status }: { status: EvalRunStatus; className?: string }) {
  const busy = status === "RUNNING" || status === "SCORING"
  return (
    <span data-testid="run-status" data-status={status} className="inline-flex">
      <StatusDot variant={STATUS_VARIANT[status]} label={STATUS_TEXT[status]} isPulsing={busy} />
    </span>
  )
}

const CHANGE_VARIANT: Record<EvalChange, "success" | "error" | "neutral" | "info"> = {
  IMPROVED: "success",
  REGRESSED: "error",
  UNCHANGED: "neutral",
  ADDED: "info",
  REMOVED: "neutral",
}

export function ChangeBadge({ change }: { change: EvalChange }) {
  return (
    <span data-testid="change-badge" data-change={change} className="inline-flex">
      <Badge variant={CHANGE_VARIANT[change]} label={CHANGE_LABEL[change]} />
    </span>
  )
}
