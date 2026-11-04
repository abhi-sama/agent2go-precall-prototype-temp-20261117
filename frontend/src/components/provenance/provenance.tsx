import { Database, Lightbulb, Sparkles } from "lucide-react"
import type * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Three visually distinct kinds of content. Colour is never the only signal: each carries an icon
 * and a text label, and a different border treatment (solid / glow / dashed).
 *
 *  - SourceFact: a value read straight from the data. Solid ink-blue rule, database icon.
 *  - AiSummary:  model-written prose over source data. Violet wash, sparkle icon, must show lineage.
 *  - Suggestion: a proposed action for the user to accept or dismiss. Dashed teal, lightbulb icon.
 */

interface ProvenanceProps {
  title?: string
  children: React.ReactNode
  className?: string
  /** Citations, data-through date and similar lineage; rendered as a footer. */
  meta?: React.ReactNode
  actions?: React.ReactNode
}

function Frame({
  kind,
  label,
  icon,
  className,
  frameClass,
  chipClass,
  title,
  children,
  meta,
  actions,
}: ProvenanceProps & { kind: string; label: string; icon: React.ReactNode; frameClass: string; chipClass: string }) {
  return (
    <section data-provenance={kind} aria-label={label} className={cn("relative rounded-2xl p-4 pl-5", frameClass, className)}>
      <div className="mb-2 flex items-center gap-2">
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.7rem] font-semibold tracking-wide uppercase", chipClass)}>
          {icon}
          {label}
        </span>
        {title && <h4 className="text-sm font-semibold">{title}</h4>}
      </div>
      <div className="text-sm leading-relaxed">{children}</div>
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
  return (
    <Frame
      {...props}
      kind="fact"
      label="Source"
      icon={<Database className="size-3.5" aria-hidden />}
      frameClass="border border-fact/25 border-l-[5px] border-l-fact bg-fact-soft"
      chipClass="bg-fact/12 text-fact"
    />
  )
}

export function AiSummary(props: ProvenanceProps) {
  return (
    <Frame
      {...props}
      kind="ai"
      label="AI summary"
      icon={<Sparkles className="size-3.5" aria-hidden />}
      frameClass="border border-ai/30 bg-ai-soft shadow-[0_0_0_4px_color-mix(in_oklch,var(--ai)_8%,transparent)]"
      chipClass="bg-ai/14 text-ai"
    />
  )
}

export function Suggestion(props: ProvenanceProps) {
  return (
    <Frame
      {...props}
      kind="suggestion"
      label="Suggestion"
      icon={<Lightbulb className="size-3.5" aria-hidden />}
      frameClass="border-2 border-dashed border-suggest/55 bg-suggest-soft"
      chipClass="bg-suggest/14 text-suggest"
    />
  )
}

/** Small chip for a record citation, e.g. `call:C-10442`. */
export function CitationChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[0.7rem] text-foreground/80">
      {children}
    </span>
  )
}
