"use client"

import { ArrowDownRight, ArrowUpRight, CircleHelp, EyeOff, FileText, Minus } from "lucide-react"
import * as React from "react"
import { Badge } from "@astryxdesign/core/Badge"
import { Banner } from "@astryxdesign/core/Banner"
import { Icon } from "@astryxdesign/core/Icon"
import { EvidenceChip } from "@/components/director/insights/shared"
import type { ExecutiveCitation, ExecutiveTrend } from "@/lib/data/executive-themes"
import { cn } from "@/lib/utils"

type TrendIcon = React.ComponentType<React.SVGProps<SVGSVGElement>>

const TREND: Record<ExecutiveTrend, { label: string; short: string; icon: TrendIcon; variant: "info" | "success" | "neutral" | "warning" }> = {
  RISING: { label: "Rising", short: "Rising", icon: ArrowUpRight, variant: "info" },
  FALLING: { label: "Falling", short: "Falling", icon: ArrowDownRight, variant: "success" },
  STEADY: { label: "Steady", short: "Steady", icon: Minus, variant: "neutral" },
  WITHHELD: { label: "Withheld: small group", short: "Withheld", icon: EyeOff, variant: "neutral" },
  INSUFFICIENT_SAMPLE: { label: "Not enough responses", short: "Few responses", icon: CircleHelp, variant: "warning" },
}

/**
 * The trend verdict is the database's. This only draws it: an arrow shape plus a word, never colour alone. A rising
 * arrow lifts into place once (a short, purposeful cue that something moved); reduced motion removes it.
 */
export function TrendIndicator({ trend, compact = false, className }: { trend: ExecutiveTrend; compact?: boolean; className?: string }) {
  const { label, short, icon, variant } = TREND[trend]
  const motion = trend === "RISING" ? "animate-in slide-in-from-bottom-1 fade-in-0 duration-200 motion-reduce:animate-none" : trend === "FALLING" ? "animate-in slide-in-from-top-1 fade-in-0 duration-200 motion-reduce:animate-none" : undefined
  return (
    <Badge
      data-testid="trend"
      data-trend={trend}
      variant={variant}
      icon={<Icon icon={icon} size="sm" className={motion} />}
      label={compact ? short : label}
      className={cn("w-fit", className)}
    />
  )
}

/** The limits of what the figures can say: window, small samples, withheld groups. Always visible, never in a tooltip. */
export function SampleLimitations({ items, className }: { items: string[]; className?: string }) {
  if (items.length === 0) return null
  return (
    <Banner data-testid="sample-limitations" aria-label="Sample limitations" status="warning" title="Sample limitations" collapsible={false} className={className}>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </Banner>
  )
}

/**
 * What a figure rests on. An AGGREGATE citation describes a set of responses (its filters and size); there is no single
 * record to open, so it is plain text, not a button. A RECORD citation (record-level permission only) opens the response.
 */
export function CitationList({ citations, label = "Sources" }: { citations: ExecutiveCitation[]; label?: string }) {
  if (citations.length === 0) return null
  return (
    <ul aria-label={label} data-testid="citation-list" className="flex flex-col gap-1.5">
      {citations.map((c) =>
        c.kind === "RECORD" && c.recordId ? (
          <li key={c.citationId} data-testid="source-record" className="flex min-w-0 flex-col gap-1">
            <span className="flex flex-wrap items-center gap-2"><EvidenceChip recordId={c.recordId} label={c.label} />{c.interactionDate && <span className="text-xs text-muted-foreground">{c.interactionDate}</span>}</span>
            {c.excerpt && <q className="text-sm text-muted-foreground">{c.excerpt}</q>}
          </li>
        ) : (
          <li key={c.citationId} data-testid="source-chip" data-citation-id={c.citationId} data-kind="AGGREGATE" className="flex min-w-0 items-start gap-1.5 rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-muted-foreground">
            <Icon icon={FileText} size="sm" className="mt-0.5 shrink-0" />
            <span className="min-w-0 break-words">{c.label}</span>
          </li>
        ),
      )}
    </ul>
  )
}

export const pct = (n: number | null) => (n === null ? "—" : `${n.toFixed(1)}%`)
