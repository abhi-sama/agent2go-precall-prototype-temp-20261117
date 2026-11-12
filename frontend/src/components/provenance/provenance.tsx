import { Badge } from "@astryxdesign/core/Badge"
import { Button } from "@astryxdesign/core/Button"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { Text } from "@astryxdesign/core/Text"
import { Database, Download, FileText, Lightbulb, Sparkles } from "lucide-react"
import * as React from "react"
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
 * The badge is an Astryx `Badge` and the title an Astryx `Heading`; the frames use tokens only (`--ai*`, `--suggest*`,
 * `--elev-card`, `--radius`), which follow every Astryx theme and colour scheme.
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
} satisfies Record<ProvenanceKind, React.ComponentType<React.SVGProps<SVGSVGElement>>>

const FRAME: Record<ProvenanceKind, string> = {
  fact: "border border-border bg-card shadow-card",
  ai: "border border-ai/35 bg-ai-soft shadow-card",
  suggestion: "border-2 border-dashed border-suggest/60 bg-suggest-soft",
}

/**
 * The badge text stays on the theme's neutral badge (always AA); the kind shows in its icon. A source fact uses the Icon's
 * `secondary` colour; AI and suggestion use the app's `--ai` / `--suggest` tints (mixed per theme to stay legible), which
 * Astryx `Icon` has no `color` value for, so they ride on the glyph's class.
 */
const ICON_TONE: Partial<Record<ProvenanceKind, string>> = { ai: "text-ai", suggestion: "text-suggest" }

/** The kind's badge: icon plus words. Also used on its own on small cards (`AiBadge`). */
export function KindBadge({ kind, label, className, ...rest }: { kind: ProvenanceKind; label?: string } & Omit<React.ComponentProps<"span">, "children">) {
  return <Badge {...rest} data-kind-badge={kind} className={cn("w-fit shrink-0 whitespace-nowrap", className)} variant="neutral" icon={<Icon icon={ICON[kind]} color={kind === "fact" ? "secondary" : undefined} className={ICON_TONE[kind]} />} label={label ?? KIND_LABEL[kind]} />
}

/** The sparkle badge for AI-derived content that is not a whole `AiSummary`, e.g. a derived-theme pill. */
export function AiBadge({ label, className, ...rest }: { label?: string } & React.ComponentProps<"span">) {
  return <KindBadge {...rest} kind="ai" label={label} className={className} />
}

/**
 * A record cited by a claim. An Astryx `Button` that opens the record when `onOpen` is given, a plain `Badge` chip otherwise.
 * The accessible name comes from `aria-label` (callers always pass one on the interactive chip), else the text itself.
 */
export function CitationChip({
  children,
  onOpen,
  className,
  "aria-label": ariaLabel,
  ...rest
}: { onOpen?: () => void; children?: React.ReactNode; className?: string; "aria-label"?: string; "data-testid"?: string }) {
  if (!onOpen) {
    return <Badge {...rest} variant="neutral" className={cn("max-w-full font-mono", className)} label={children} />
  }
  return (
    <Button
      {...rest}
      variant="secondary"
      size="sm"
      label={ariaLabel ?? (typeof children === "string" ? children : "Open source")}
      aria-label={ariaLabel}
      onClick={onOpen}
      className={cn("max-w-full pointer-coarse:min-h-11", className)}
    >
      {children}
    </Button>
  )
}

function Citations({ items, kind }: { items: ProvenanceCitation[]; kind: ProvenanceKind }) {
  return (
    <HStack data-testid="citations" role="group" aria-label={`Sources for this ${KIND_LABEL[kind].toLowerCase()}`} gap={1.5} wrap="wrap" align="center" paddingBlockStart={3} className="mt-3 border-t border-current/10">
      <Text type="supporting" weight="medium">
        Sources
      </Text>
      {items.map((c) => (
        <CitationChip key={c.key} data-testid="citation" aria-label={`Open source${c.number ? ` ${c.number}` : ""}: ${c.detail ?? c.label}`} onOpen={c.onOpen}>
          <Icon icon={FileText} size="xsm" />
          {/* Inline runs inside the chip (not Text blocks): the chip is a single flex row that truncates. */}
          {c.number ? <span className="font-semibold tabular-nums">[{c.number}]</span> : null}
          <span className="truncate font-mono text-[0.7rem]">{c.label}</span>
          {c.detail && <span className="hidden truncate sm:inline">{c.detail}</span>}
        </CitationChip>
      ))}
    </HStack>
  )
}

function Frame({ kind, title, label, className, children, meta, actions, citations, ...rest }: ProvenanceProps & { kind: ProvenanceKind }) {
  return (
    <section aria-label={label ?? KIND_LABEL[kind]} {...rest} data-provenance={kind} className={cn("relative min-w-0 rounded-xl p-(--card-pad) sm:p-4", FRAME[kind], className)}>
      <HStack gap={2} wrap="wrap" align="center" className="mb-2">
        <KindBadge kind={kind} label={label} />
        {title && <Heading level={4}>{title}</Heading>}
      </HStack>
      {/* Plain block: the children are running prose with inline citation chips; a Text wrapper would set its own line-height and display. */}
      <div className="text-sm leading-relaxed">{children}</div>
      {citations && citations.length > 0 && <Citations items={citations} kind={kind} />}
      {(meta || actions) && (
        <HStack gap={2} wrap="wrap" align="center" justify="between" className="mt-3 text-xs text-muted-foreground">
          <HStack gap={1.5} wrap="wrap" align="center">{meta}</HStack>
          {actions && <HStack gap={2}>{actions}</HStack>}
        </HStack>
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
    <Button variant="secondary" size="sm" icon={<Icon icon={Download} />} label={label} data-testid={testId} isDisabled={disabled} onClick={onExport} className="print:hidden" />
  )
}
