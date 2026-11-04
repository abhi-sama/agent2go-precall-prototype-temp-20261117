"use client"

import { CalendarRange, RotateCcw } from "lucide-react"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { DateRange } from "@/lib/data/types"
import { isIsoDate, matchPreset, presetRange, RANGE_PRESETS, type RangePresetId } from "@/lib/dates"
import { cn } from "@/lib/utils"

export interface SelectFilter {
  id: string
  label: string
  value: string
  options: ReadonlyArray<{ value: string; label: string }>
  onChange: (value: string) => void
}

export interface FilterBarProps {
  range: DateRange
  onRangeChange: (range: DateRange) => void
  defaultRange: DateRange
  /** Extra filters (territory, product, theme...) added by later tickets. Native selects: best on touch. */
  selects?: SelectFilter[]
  disabled?: boolean
  className?: string
}

/**
 * Shared filter bar. Date presets are one tap; a custom range uses native date inputs so iPad shows
 * its own picker. Invalid ranges are explained inline and never emitted.
 */
export function FilterBar({ range, onRangeChange, defaultRange, selects, disabled, className }: FilterBarProps) {
  const activePreset = matchPreset(range)
  const [custom, setCustom] = React.useState(activePreset === null)
  const showCustom = custom || activePreset === null
  // Holds in-progress (possibly invalid) typing; cleared as soon as a valid range is emitted.
  const [edit, setEdit] = React.useState<DateRange | null>(null)
  const draft = edit ?? range
  const draftValid = isIsoDate(draft.from) && isIsoDate(draft.to) && draft.from <= draft.to

  const setDraftField = (field: keyof DateRange, value: string) => {
    const next = { ...draft, [field]: value }
    if (isIsoDate(next.from) && isIsoDate(next.to) && next.from <= next.to) {
      setEdit(null)
      onRangeChange(next)
    } else {
      setEdit(next)
    }
  }

  const pick = (id: RangePresetId) => {
    setCustom(false)
    onRangeChange(presetRange(id))
  }

  const isDefault = range.from === defaultRange.from && range.to === defaultRange.to

  return (
    <section
      aria-label="Filters"
      data-testid="filter-bar"
      className={cn("flex flex-col gap-3 rounded-2xl border bg-card p-3 shadow-card sm:p-4", className)}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <CalendarRange className="size-4 text-accent-text" aria-hidden /> Date range
        </span>
        <div role="group" aria-label="Date range presets" className="scroll-snap-x -mx-1 flex max-w-full gap-1.5 overflow-x-auto px-1 py-0.5">
          {RANGE_PRESETS.map((p) => {
            const on = !showCustom && activePreset === p.id
            return (
              <button
                key={p.id}
                type="button"
                disabled={disabled}
                aria-pressed={on}
                data-testid={`range-${p.id}`}
                onClick={() => pick(p.id)}
                className={cn(
                  "snap-item min-h-11 shrink-0 rounded-xl border px-4 text-sm font-medium transition-colors disabled:opacity-50",
                  on ? "border-primary bg-primary text-primary-foreground shadow-card" : "border-border bg-background hover:bg-accent",
                )}
              >
                {p.label}
              </button>
            )
          })}
          <button
            type="button"
            disabled={disabled}
            aria-pressed={showCustom}
            data-testid="range-custom"
            onClick={() => setCustom(true)}
            className={cn(
              "snap-item min-h-11 shrink-0 rounded-xl border px-4 text-sm font-medium transition-colors disabled:opacity-50",
              showCustom ? "border-primary bg-primary text-primary-foreground shadow-card" : "border-border bg-background hover:bg-accent",
            )}
          >
            Custom
          </button>
        </div>
        {!isDefault && (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => { setCustom(false); onRangeChange(defaultRange) }}>
            <RotateCcw aria-hidden /> Reset
          </Button>
        )}
      </div>

      {(showCustom || (selects && selects.length > 0)) && (
        <div className="flex flex-wrap items-end gap-3">
          {showCustom && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="range-from" className="text-xs">From</Label>
                <Input
                  id="range-from"
                  type="date"
                  className="h-11 w-44"
                  value={draft.from}
                  max={draft.to || undefined}
                  disabled={disabled}
                  aria-invalid={!draftValid}
                  onChange={(e) => setDraftField("from", e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="range-to" className="text-xs">To</Label>
                <Input
                  id="range-to"
                  type="date"
                  className="h-11 w-44"
                  value={draft.to}
                  min={draft.from || undefined}
                  disabled={disabled}
                  aria-invalid={!draftValid}
                  onChange={(e) => setDraftField("to", e.target.value)}
                />
              </div>
              {!draftValid && (
                <p role="alert" className="pb-3 text-sm text-destructive">
                  Pick a start date on or before the end date.
                </p>
              )}
            </>
          )}
          {selects?.map((s) => (
            <div key={s.id} className="flex flex-col gap-1.5">
              <Label htmlFor={`filter-${s.id}`} className="text-xs">{s.label}</Label>
              <select
                id={`filter-${s.id}`}
                value={s.value}
                disabled={disabled}
                onChange={(e) => s.onChange(e.target.value)}
                className="h-11 min-w-44 rounded-lg border border-input bg-background px-3 text-sm"
              >
                {s.options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
