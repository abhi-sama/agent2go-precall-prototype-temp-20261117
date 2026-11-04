"use client"

import { ArrowDownRight, ArrowUpRight, CircleHelp, EyeOff, FileText, Info, Minus } from "lucide-react"
import * as React from "react"
import { EvidenceChip } from "@/components/director/insights/shared"
import type { ExecutiveCitation, ExecutiveTrend } from "@/lib/data/executive-themes"
import { cn } from "@/lib/utils"

const TREND: Record<ExecutiveTrend, { label: string; short: string; icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>; className: string }> = {
  RISING: { label: "Rising", short: "Rising", icon: ArrowUpRight, className: "border-primary/50 bg-primary/12 text-foreground" },
  FALLING: { label: "Falling", short: "Falling", icon: ArrowDownRight, className: "border-fact/40 bg-fact-soft text-fact" },
  STEADY: { label: "Steady", short: "Steady", icon: Minus, className: "border-border bg-muted text-muted-foreground" },
  WITHHELD: { label: "Withheld: small group", short: "Withheld", icon: EyeOff, className: "border-dashed border-border bg-muted/60 text-muted-foreground" },
  INSUFFICIENT_SAMPLE: { label: "Not enough responses", short: "Few responses", icon: CircleHelp, className: "border-warning/50 bg-warning/10 text-foreground" },
}

/**
 * The trend verdict is the database's. This only draws it: an arrow shape plus a word, never colour alone. A rising
 * arrow lifts into place once (a short, purposeful cue that something moved); reduced motion removes it.
 */
export function TrendIndicator({ trend, compact = false, className }: { trend: ExecutiveTrend; compact?: boolean; className?: string }) {
  const { label, short, icon: Icon, className: tone } = TREND[trend]
  return (
    <span
      data-testid="trend"
      data-trend={trend}
      title={label}
      className={cn("inline-flex w-fit items-center gap-1 rounded-full border font-semibold", compact ? "min-h-6 px-1.5 text-[0.7rem]" : "min-h-7 px-2.5 text-xs", tone, className)}
    >
      <Icon className={cn("shrink-0", compact ? "size-3.5" : "size-4", trend === "RISING" && "animate-in slide-in-from-bottom-1 fade-in-0 duration-200 motion-reduce:animate-none", trend === "FALLING" && "animate-in slide-in-from-top-1 fade-in-0 duration-200 motion-reduce:animate-none")} aria-hidden />
      <span>{compact ? short : label}</span>
    </span>
  )
}

/** The limits of what the figures can say: window, small samples, withheld groups. Always visible, never in a tooltip. */
export function SampleLimitations({ items, className }: { items: string[]; className?: string }) {
  if (items.length === 0) return null
  return (
    <section data-testid="sample-limitations" aria-label="Sample limitations" className={cn("rounded-xl border border-warning/40 bg-warning/8 p-3 text-sm", className)}>
      <h4 className="flex items-center gap-2 text-sm font-semibold"><Info className="size-4 text-warning" aria-hidden />Sample limitations</h4>
      <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </section>
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
            <FileText className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 break-words">{c.label}</span>
          </li>
        ),
      )}
    </ul>
  )
}

export const pct = (n: number | null) => (n === null ? "—" : `${n.toFixed(1)}%`)
