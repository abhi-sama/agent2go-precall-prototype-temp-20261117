"use client"

import { Button } from "@astryxdesign/core/Button"
import type { ISODateString } from "@astryxdesign/core/Calendar"
import { Card } from "@astryxdesign/core/Card"
import { DateInput } from "@astryxdesign/core/DateInput"
import { Grid } from "@astryxdesign/core/Grid"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { Selector } from "@astryxdesign/core/Selector"
import { Text } from "@astryxdesign/core/Text"
import { ToggleButton, ToggleButtonGroup } from "@astryxdesign/core/ToggleButton"
import { VStack } from "@astryxdesign/core/VStack"
import { RotateCcw } from "lucide-react"
import * as React from "react"
import type { DateRange } from "@/lib/data/types"
import { isIsoDate, matchPreset, presetRange, RANGE_PRESETS, type RangePresetId } from "@/lib/dates"

/** The Selector has no empty-string option value, so the "all" option travels as this sentinel. */
const ALL = "__all__"

/** Only a complete calendar date reaches the DateInput; in-progress typing is shown as empty. */
const asDate = (value: string | undefined) => (value && isIsoDate(value) ? (value as ISODateString) : undefined)

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
  onReset?: () => void
  /** Extra filters (territory, product, theme...) added by later tickets. Native selects: best on touch. */
  selects?: SelectFilter[]
  disabled?: boolean
  /** Disables only the extra selects (their options are unavailable to this role); the date range stays usable. */
  selectsDisabled?: boolean
  className?: string
}

/**
 * Shared filter bar. Date presets are one tap; a custom range uses native date inputs so iPad shows
 * its own picker. Invalid ranges are explained inline and never emitted.
 */
export function FilterBar({ range, onRangeChange, defaultRange, onReset, selects, disabled, selectsDisabled, className }: FilterBarProps) {
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
    <Card data-testid="filter-bar" padding={3} elevation="low" className={className}>
      <section aria-label="Filters">
        <VStack gap={2}>
          <HStack gap={2} wrap="wrap" align="center" justify="between">
            <HStack gap={4} wrap="wrap" align="center">
              <HStack gap={2} align="center">
                <Icon icon="calendar" size="sm" color="accent" />
                <Text weight="semibold">Date range</Text>
              </HStack>
              <HStack isScrollable maxWidth="100%">
                <ToggleButtonGroup
                  label="Date range presets"
                  value={showCustom ? "custom" : activePreset}
                  isDisabled={disabled}
                  onChange={(next) => {
                    if (next === "custom") setCustom(true)
                    else if (typeof next === "string") pick(next as RangePresetId)
                  }}
                >
                  {RANGE_PRESETS.map((p) => (
                    <ToggleButton key={p.id} value={p.id} label={p.label} data-testid={`range-${p.id}`} />
                  ))}
                  <ToggleButton value="custom" label="Custom" data-testid="range-custom" />
                </ToggleButtonGroup>
              </HStack>
            </HStack>
            {(!isDefault || selects?.some((select) => Boolean(select.value))) && (
              <Button
                label="Reset"
                variant="ghost"
                size="sm"
                icon={<Icon icon={RotateCcw} />}
                onClick={() => {
                  setCustom(false)
                  if (onReset) onReset()
                  else onRangeChange(defaultRange)
                }}
              />
            )}
          </HStack>

          {(showCustom || (selects && selects.length > 0)) && (
            <Grid columns={{ minWidth: 144, repeat: "fit" }} columnGap={3} rowGap={2} align="end">
              {showCustom && (
                <>
                  <DateInput
                    label="From"
                    id="range-from"
                    width="100%"
                    value={asDate(draft.from)}
                    max={asDate(draft.to)}
                    isDisabled={disabled}
                    status={draftValid ? undefined : { type: "error" }}
                    onChange={(next) => setDraftField("from", next ?? "")}
                  />
                  <DateInput
                    label="To"
                    id="range-to"
                    width="100%"
                    value={asDate(draft.to)}
                    min={asDate(draft.from)}
                    isDisabled={disabled}
                    status={draftValid ? undefined : { type: "error", message: "Pick a start date on or before the end date." }}
                    statusVariant="detached"
                    onChange={(next) => setDraftField("to", next ?? "")}
                  />
                </>
              )}
              {selects?.map((s) => (
                <Selector
                  key={s.id}
                  id={`filter-${s.id}`}
                  label={s.label}
                  width="100%"
                  presentation="adaptive"
                  value={s.value === "" ? ALL : s.value}
                  isDisabled={disabled || selectsDisabled}
                  onChange={(next) => s.onChange(next === ALL ? "" : next)}
                  options={s.options.map((o) => ({ value: o.value === "" ? ALL : o.value, label: o.label }))}
                />
              ))}
            </Grid>
          )}
        </VStack>
      </section>
    </Card>
  )
}
