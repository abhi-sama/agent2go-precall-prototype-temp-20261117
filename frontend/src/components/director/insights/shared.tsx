"use client"

import { FileText, Minus, MoveDownRight, MoveUpRight, CircleHelp } from "lucide-react"
import * as React from "react"
import { CitationSheet } from "@/components/chat/citation-sheet"
import { CitationChip } from "@/components/provenance/provenance"
import { DataThroughBadge } from "@/components/landing/data-through-badge"
import { Badge } from "@/components/ui/badge"
import type { CitationItem } from "@/lib/chat/events"
import type { EmergingStatus } from "@/lib/data/director-insights"
import type { IsoDate, IsoDateTime } from "@/lib/data/types"
import { formatDay } from "@/lib/dates"
import { cn } from "@/lib/utils"

const CitationContext = React.createContext<((item: CitationItem) => void) | null>(null)

/** One source-record sheet for the whole insights page. Evidence chips open it; the BE returns the record only if it is in scope. */
export function CitationHost({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState<CitationItem | null>(null)
  return (
    <CitationContext.Provider value={setOpen}>
      {children}
      <CitationSheet citation={open} onClose={() => setOpen(null)} />
    </CitationContext.Provider>
  )
}

export function useOpenCitation() {
  const open = React.useContext(CitationContext)
  if (!open) throw new Error("useOpenCitation must be used inside <CitationHost>")
  return open
}

/** A cited response. Opens the source record; the label says where it came from. */
export function EvidenceChip({ recordId, label }: { recordId: string; label?: string }) {
  const open = useOpenCitation()
  return (
    <CitationChip
      data-testid="evidence-chip"
      data-record-id={recordId}
      aria-label={`Open source record ${recordId}`}
      onOpen={() => open({ recordId, dataset: "hcp_raw_insights", label: label ?? "Recorded HCP response" })}
      className="min-h-9 gap-1.5 rounded-lg px-2.5 font-mono"
    >
      <FileText className="size-3.5 shrink-0" aria-hidden />
      {recordId}
    </CitationChip>
  )
}

/** States the method: grouped from free text by keyword. The AI look comes from the card around it, not this pill. */
export function DerivedBadge() {
  return (
    <Badge variant="outline" data-testid="derived-badge">
      Derived
    </Badge>
  )
}

const STATUS: Record<EmergingStatus, { label: string; icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>; className: string }> = {
  EMERGING: { label: "Emerging", icon: MoveUpRight, className: "border-primary/50 bg-primary/12 text-foreground" },
  DECLINING: { label: "Declining", icon: MoveDownRight, className: "border-fact/40 bg-fact-soft text-fact" },
  STABLE: { label: "Stable", icon: Minus, className: "border-border bg-muted text-muted-foreground" },
  INSUFFICIENT_SAMPLE: { label: "Not enough responses", icon: CircleHelp, className: "border-warning/50 bg-warning/10 text-foreground" },
}

/** The status is the database's verdict. This only draws it: an icon and a word, never colour alone. */
export function StatusBadge({ status }: { status: EmergingStatus }) {
  const { label, icon: Icon, className } = STATUS[status]
  return (
    <span data-testid="status-badge" data-status={status} className={cn("inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold", className)}>
      <Icon className="size-3.5" aria-hidden />
      {label}
    </span>
  )
}

export const num = (n: number) => n.toLocaleString("en-US")
export const pctText = (n: number | null) => (n === null ? "—" : `${n.toFixed(1)}%`)

/** Dates, denominator and data-through that every chart or panel states. */
export function PanelMeta({ from, to, dataThrough, children }: { from: IsoDate; to: IsoDate; dataThrough: IsoDateTime | null; children?: React.ReactNode }) {
  return (
    <div data-testid="panel-meta" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
      <span className="tabular-nums">{formatDay(from, true)} to {formatDay(to, true)}</span>
      {children}
      <DataThroughBadge dataThrough={dataThrough} className="min-h-8 text-xs" />
    </div>
  )
}

export function InsightSection({ id, title, note, meta, children }: { id: string; title: string; note: string; meta?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section data-testid={`section-${id}`} aria-labelledby={`section-${id}-title`} className="min-w-0 animate-in fade-in-0 duration-200 ease-out motion-reduce:animate-none">
      <h2 id={`section-${id}-title`} className="text-xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">{note}</p>
      {meta && <div className="mb-3 mt-2">{meta}</div>}
      <div className={meta ? "" : "mt-3"}>{children}</div>
    </section>
  )
}

export function PanelLoading({ testId, height = "h-64" }: { testId: string; height?: string }) {
  return <div data-testid={testId} aria-busy="true" className={cn("animate-pulse rounded-2xl border bg-muted/50", height)} />
}
