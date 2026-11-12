import { Badge } from "@astryxdesign/core/Badge"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { StatusDot } from "@astryxdesign/core/StatusDot"
import { ShieldAlert } from "lucide-react"
import type { EvalChange, EvalRunStatus, EvalVerdict } from "@/lib/data/evals"
import { CHANGE_LABEL } from "./format"

/** Pass or fail is said in words and an icon, never by colour alone. */
export function VerdictBadge({ verdict, leaked }: { verdict: EvalVerdict | null; leaked?: boolean; className?: string }) {
  if (!verdict) return null
  const pass = verdict === "PASS"
  const glyph = pass ? "success" : leaked ? ShieldAlert : "error"
  return (
    <HStack as="span" data-testid="verdict-badge" data-verdict={verdict}>
      <Badge variant={pass ? "success" : "error"} icon={<Icon icon={glyph} size="xsm" />} label={pass ? "Pass" : leaked ? "Fail · leak" : "Fail"} />
    </HStack>
  )
}

const STATUS_TEXT: Record<EvalRunStatus, string> = { RUNNING: "Asking the agent", SCORING: "Scoring answers", COMPLETE: "Complete", ERROR: "Did not finish" }
const STATUS_VARIANT: Record<EvalRunStatus, "accent" | "success" | "error"> = { RUNNING: "accent", SCORING: "accent", COMPLETE: "success", ERROR: "error" }

export function StatusPill({ status }: { status: EvalRunStatus; className?: string }) {
  const busy = status === "RUNNING" || status === "SCORING"
  return (
    <HStack as="span" data-testid="run-status" data-status={status}>
      <StatusDot variant={STATUS_VARIANT[status]} label={STATUS_TEXT[status]} isPulsing={busy} />
    </HStack>
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
    <HStack as="span" data-testid="change-badge" data-change={change}>
      <Badge variant={CHANGE_VARIANT[change]} label={CHANGE_LABEL[change]} />
    </HStack>
  )
}
