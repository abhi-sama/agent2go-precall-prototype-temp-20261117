"use client"

import type { LucideIcon } from "lucide-react"
import { useCountUp } from "@/hooks/use-count-up"
import { cn } from "@/lib/utils"

const TONES = {
  orange: { tile: "bg-primary/12 text-accent-text", bar: "bg-primary" },
  ink: { tile: "bg-ink/12 text-fact", bar: "bg-ink" },
  teal: { tile: "bg-teal/15 text-suggest", bar: "bg-teal" },
} as const

export interface KpiCardProps {
  id: string
  label: string
  value: number
  /** One visible line saying exactly what is counted (no hover needed on touch screens). */
  definition: string
  caption?: string
  icon: LucideIcon
  tone: keyof typeof TONES
}

export function KpiCard({ id, label, value, definition, caption, icon: Icon, tone }: KpiCardProps) {
  const shown = useCountUp(value)
  const t = TONES[tone]
  return (
    <article
      data-testid={`kpi-${id}`}
      className="group relative snap-item overflow-hidden rounded-2xl border bg-card p-5 shadow-card transition-shadow hover:shadow-lift"
    >
      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1", t.bar)} />
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-muted-foreground">{label}</h3>
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", t.tile)}>
          <Icon className="size-5" aria-hidden />
        </span>
      </div>
      <p
        data-testid={`kpi-${id}-value`}
        data-value={value}
        className="mt-3 text-5xl font-semibold tracking-tight tabular-nums"
        aria-label={`${label}: ${value.toLocaleString("en-US")}`}
      >
        {shown.toLocaleString("en-US")}
      </p>
      <p className="mt-3 text-sm text-muted-foreground">{definition}</p>
      {caption && <p className="mt-1 text-xs font-medium text-foreground/70">{caption}</p>}
    </article>
  )
}
