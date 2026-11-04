import { Database, Download, FileText, Lightbulb, Sparkles } from "lucide-react"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { KIND_LABEL, type ProvenanceKind } from "@/lib/provenance"
import { cn } from "@/lib/utils"

/**
 * The one component family for the three kinds of content. Every AI surface (chat answers, pre-call briefs,
 * theme cards, territory and leadership summaries) uses it, and the exports reuse its words (`lib/provenance.ts`).
 * Colour is never the only signal: each kind carries an icon, a text label and a different outline.
 *
 *  - SourceFact: a value read straight from the data. Plain card, hairline edge, no tint.
 *  - AiSummary:  model-written prose over source data. Soft orange card, sparkle "AI summary" badge, citation chips.
 *  - Suggestion: a proposal for the user to accept or dismiss. Dashed outline, lightbulb, the word "Suggestion".
 *
 * Tokens only (`--ai*`, `--suggest*`, `--elev-card`, `--radius`), so both styles and all three modes work unchanged.
 */

export interface ProvenanceCitation {
  /** Stable key, usually `dataset:recordId`. */
  key: string
  /** Short text on the chip: a record id or a label. */
  label: string
  /** Longer text for the accessible name, e.g. what the record is. */
  detail?: string
  /** The number used by inline `[n]` markers in the prose, if any. */
  number?: number
  onOpen: () => void
}

interface ProvenanceProps extends Omit<React.ComponentProps<"section">, "title"> {
  title?: string
  children: React.ReactNode
  /** Lineage notes and similar, rendered as a footer line. */
  meta?: React.ReactNode
  actions?: React.ReactNode
  /** Records behind the content. Each opens its source record. Shown on every AI summary. */
  citations?: ProvenanceCitation[]
  /** Replaces the default badge text, e.g. "Derived theme". The kind stays the same. */
  label?: string
}

const ICON = {
  fact: Database,
  ai: Sparkles,
  suggestion: Lightbulb,
} satisfies Record<ProvenanceKind, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>>

const FRAME: Record<ProvenanceKind, string> = {
  fact: "border border-border bg-card shadow-card",
  ai: "border border-ai/35 bg-ai-soft shadow-card",
  suggestion: "border-2 border-dashed border-suggest/60 bg-suggest-soft",
}

const CHIP: Record<ProvenanceKind, string> = {
  fact: "border border-border bg-muted text-muted-foreground",
  ai: "border border-ai/35 bg-ai/12 text-ai",
  suggestion: "border border-suggest/40 bg-suggest/14 text-suggest",
}

/** The kind's badge: icon plus words. Also used on its own on small cards (`AiBadge`). */
export function KindBadge({ kind, label, className, ...rest }: { kind: ProvenanceKind; label?: string } & React.ComponentProps<"span">) {
  const Icon = ICON[kind]
  return (
    <span {...rest} data-kind-badge={kind} className={cn("inline-flex min-h-6 w-fit shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap", CHIP[kind], className)}>
      <Icon className="size-3.5" aria-hidden />
      {label ?? KIND_LABEL[kind]}
    </span>
  )
}

/** The sparkle badge for AI-derived content that is not a whole `AiSummary`, e.g. a derived-theme pill. */
export function AiBadge({ label, className, ...rest }: { label?: string } & React.ComponentProps<"span">) {
  return <KindBadge {...rest} kind="ai" label={label} className={className} />
}

/** A record cited by a claim. A button that opens the record when `onOpen` is given, a plain chip otherwise. */
export function CitationChip({
  children,
  onOpen,
  className,
  ...rest
}: { onOpen?: () => void } & Omit<React.ComponentProps<"button">, "onClick" | "type">) {
  const cls = cn(
    "inline-flex min-h-8 max-w-full items-center gap-1 rounded-md border border-border bg-background px-2 text-xs text-foreground/80",
    onOpen && "transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none pointer-coarse:min-h-11 pointer-coarse:px-3",
    className,
  )
  if (!onOpen) {
    return <span className={cn(cls, "font-mono text-[0.7rem]")}>{children}</span>
  }
  return (
    <button type="button" {...rest} onClick={onOpen} className={cls}>
      {children}
    </button>
  )
}

function Citations({ items, kind }: { items: ProvenanceCitation[]; kind: ProvenanceKind }) {
  return (
    <div data-testid="citations" role="group" aria-label={`Sources for this ${KIND_LABEL[kind].toLowerCase()}`} className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-current/10 pt-3">
      <span className="text-xs font-medium text-muted-foreground">Sources</span>
      {items.map((c) => (
        <CitationChip key={c.key} data-testid="citation" aria-label={`Open source${c.number ? ` ${c.number}` : ""}: ${c.detail ?? c.label}`} onOpen={c.onOpen}>
          <FileText className="size-3 shrink-0" aria-hidden />
          {c.number ? <span className="font-semibold tabular-nums">[{c.number}]</span> : null}
          <span className="truncate font-mono text-[0.7rem]">{c.label}</span>
          {c.detail && <span className="hidden truncate text-muted-foreground sm:inline">{c.detail}</span>}
        </CitationChip>
      ))}
    </div>
  )
}

function Frame({ kind, title, label, className, children, meta, actions, citations, ...rest }: ProvenanceProps & { kind: ProvenanceKind }) {
  return (
    <section aria-label={label ?? KIND_LABEL[kind]} {...rest} data-provenance={kind} className={cn("relative min-w-0 rounded-xl p-(--card-pad) sm:p-4", FRAME[kind], className)}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <KindBadge kind={kind} label={label} />
        {title && <h4 className="text-sm font-semibold">{title}</h4>}
      </div>
      <div className="text-sm leading-relaxed">{children}</div>
      {citations && citations.length > 0 && <Citations items={citations} kind={kind} />}
      {(meta || actions) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-1.5">{meta}</div>
          {actions && <div className="flex gap-2">{actions}</div>}
        </div>
      )}
    </section>
  )
}

export function SourceFact(props: ProvenanceProps) {
  return <Frame {...props} kind="fact" />
}

export function AiSummary(props: ProvenanceProps) {
  return <Frame {...props} kind="ai" />
}

export function Suggestion(props: ProvenanceProps) {
  return <Frame {...props} kind="suggestion" />
}

/** The same Export action wherever AI content can leave the app. The file keeps the kind of every block. */
export function ExportButton({ onExport, label = "Download", testId = "export-answer", disabled }: { onExport: () => void; label?: string; testId?: string; disabled?: boolean }) {
  return (
    <Button type="button" variant="outline" size="sm" data-testid={testId} disabled={disabled} onClick={onExport} className="print:hidden">
      <Download aria-hidden /> {label}
    </Button>
  )
}
