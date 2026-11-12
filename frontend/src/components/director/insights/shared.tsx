"use client"

import { Badge } from "@astryxdesign/core/Badge"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { Skeleton } from "@astryxdesign/core/Skeleton"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import { FileText, Minus, MoveDownRight, MoveUpRight, CircleHelp } from "lucide-react"
import * as React from "react"
import { CitationSheet } from "@/components/chat/citation-sheet"
import { CitationChip } from "@/components/provenance/provenance"
import { DataThroughBadge } from "@/components/landing/data-through-badge"
import type { CitationItem } from "@/lib/chat/events"
import type { EmergingStatus } from "@/lib/data/director-insights"
import type { IsoDate, IsoDateTime } from "@/lib/data/types"
import { formatDay } from "@/lib/dates"

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
      <Icon icon={FileText} size="xsm" />
      {recordId}
    </CitationChip>
  )
}

/** States the method: grouped from free text by keyword. The AI look comes from the card around it, not this pill. */
export function DerivedBadge() {
  return (
    <Badge variant="neutral" label="Derived" data-testid="derived-badge" />
  )
}

const STATUS: Record<EmergingStatus, { label: string; icon: React.ComponentType<React.SVGProps<SVGSVGElement>>; variant: "info" | "purple" | "neutral" | "warning" }> = {
  EMERGING: { label: "Emerging", icon: MoveUpRight, variant: "info" },
  DECLINING: { label: "Declining", icon: MoveDownRight, variant: "purple" },
  STABLE: { label: "Stable", icon: Minus, variant: "neutral" },
  INSUFFICIENT_SAMPLE: { label: "Not enough responses", icon: CircleHelp, variant: "warning" },
}

/** The status is the database's verdict. This only draws it: an icon and a word, never colour alone. */
export function StatusBadge({ status }: { status: EmergingStatus }) {
  const { label, icon, variant } = STATUS[status]
  return <Badge variant={variant} label={label} icon={<Icon icon={icon} size="xsm" />} data-testid="status-badge" data-status={status} />
}

export const num = (n: number) => n.toLocaleString("en-US")
export const pctText = (n: number | null) => (n === null ? "—" : `${n.toFixed(1)}%`)

/** Dates, denominator and data-through that every chart or panel states. */
export function PanelMeta({ from, to, dataThrough, children }: { from: IsoDate; to: IsoDate; dataThrough: IsoDateTime | null; children?: React.ReactNode }) {
  return (
    <HStack data-testid="panel-meta" gap={3} align="center" wrap="wrap">
      <Text type="supporting" hasTabularNumbers>{formatDay(from, true)} to {formatDay(to, true)}</Text>
      {children && <Text type="supporting">{children}</Text>}
      <DataThroughBadge dataThrough={dataThrough} className="min-h-8 text-xs" />
    </HStack>
  )
}

export function InsightSection({ id, title, note, meta, children }: { id: string; title: string; note: string; meta?: React.ReactNode; children: React.ReactNode }) {
  return (
    <VStack as="section" gap={3} data-testid={`section-${id}`} aria-labelledby={`section-${id}-title`} className="min-w-0 animate-in fade-in-0 duration-200 ease-out motion-reduce:animate-none">
      <VStack gap={1}>
        <Heading level={2} id={`section-${id}-title`}>{title}</Heading>
        <Text type="supporting" as="p" className="max-w-3xl">{note}</Text>
      </VStack>
      {meta}
      {children}
    </VStack>
  )
}

/** Height in px of the loading placeholder; the real panel replaces it. */
export function PanelLoading({ testId, height = 256 }: { testId: string; height?: number }) {
  return <Skeleton data-testid={testId} aria-busy="true" width="100%" height={height} radius={4} />
}
