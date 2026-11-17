"use client"

import { Database, Lightbulb, Sparkles } from "lucide-react"
import * as React from "react"
import { KIND_LABEL, type ProvenanceKind } from "@/lib/provenance"
import { cn } from "@/lib/utils"

/**
 * The three kinds of content inside Ask the agent, drawn in CopilotKit's design (its neutral `--background`,
 * `--muted`, `--border` tokens, which CopilotKit sets on the chat). The rule from the rest of the app holds: colour is
 * never the only signal. Each kind carries an icon, its words and a different outline, and `data-provenance` names it.
 *
 *  - fact: counted by the database. Hairline card.
 *  - ai: written by the model. A sparkle label over the answer text.
 *  - suggestion: something the person may ask next. Dashed outline.
 */

const ICON = { fact: Database, ai: Sparkles, suggestion: Lightbulb } satisfies Record<ProvenanceKind, React.ComponentType<{ className?: string }>>

export function KindLabel({ kind, label, className }: { kind: ProvenanceKind; label?: string; className?: string }) {
  const Glyph = ICON[kind]
  return (
    <span data-kind-badge={kind} className={cn("inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-foreground", className)}>
      <Glyph aria-hidden className="size-3.5" />
      {label ?? KIND_LABEL[kind]}
    </span>
  )
}

const FRAME: Record<ProvenanceKind, string> = {
  fact: "rounded-2xl border border-border bg-background",
  ai: "",
  suggestion: "rounded-2xl border border-dashed border-border",
}

export function ProvenanceBlock({
  kind,
  label,
  title,
  meta,
  className,
  children,
  ...rest
}: { kind: ProvenanceKind; label?: string; title?: string; meta?: React.ReactNode } & Omit<React.ComponentProps<"section">, "title">) {
  return (
    <section aria-label={label ?? KIND_LABEL[kind]} {...rest} data-provenance={kind} className={cn("min-w-0", kind !== "ai" && "p-3", FRAME[kind], className)}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <KindLabel kind={kind} label={label} />
        {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
      </div>
      {children}
      {meta && <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">{meta}</div>}
    </section>
  )
}
