import { CircleCheck, CircleDashed, CircleDot, CircleSlash, type LucideIcon } from "lucide-react"
import type { FlagKind, FlagStatus, FlagTargetType } from "@/lib/data/types"

/** `in_person` -> `In person`, `field` -> `Field`. Channels come from the source as written. */
export function channelLabel(channel: string): string {
  const spaced = channel.replace(/[_-]+/g, " ").trim()
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : channel
}

export const FLAG_KIND_LABEL: Record<FlagKind, string> = {
  IDENTIFIER: "Incorrect identifier",
  TERRITORY_ASSIGNMENT: "Incorrect territory assignment",
  SUMMARY: "Incorrect summary",
}

export const FLAG_TARGET_LABEL: Record<FlagTargetType, string> = {
  CALL: "Call",
  HCP: "HCP",
  TERRITORY: "Territory",
  SUMMARY: "Summary",
}

/** Which kinds of record each flag kind may point at (mirrors the BE, which enforces it). */
export const TARGETS_FOR_KIND: Record<FlagKind, FlagTargetType[]> = {
  IDENTIFIER: ["HCP", "CALL"],
  TERRITORY_ASSIGNMENT: ["TERRITORY", "CALL", "HCP"],
  SUMMARY: ["SUMMARY"],
}

/**
 * Review status. Colour is never the only signal: each status has its own icon and a word.
 * Nothing here is red or green because a flag's status is not a judgement of the person who raised it.
 */
export const FLAG_STATUS_META: Record<FlagStatus, { label: string; hint: string; icon: LucideIcon; className: string }> = {
  OPEN: {
    label: "Open",
    hint: "Received, waiting for a reviewer.",
    icon: CircleDashed,
    className: "border-warning/50 bg-warning/12 text-foreground",
  },
  IN_REVIEW: {
    label: "In review",
    hint: "A reviewer is looking at it.",
    icon: CircleDot,
    className: "border-ink/35 bg-fact-soft text-fact",
  },
  RESOLVED: {
    label: "Resolved",
    hint: "The issue was fixed or answered.",
    icon: CircleCheck,
    className: "border-success/40 bg-success/10 text-foreground",
  },
  DISMISSED: {
    label: "Dismissed",
    hint: "Reviewed; no change was needed.",
    icon: CircleSlash,
    className: "border-border bg-muted text-muted-foreground",
  },
}
