"use client"

import { SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  useAppearance,
  type DensityPref,
  type ModePref,
  type StylePref,
} from "@/lib/appearance/appearance-provider"
import { log } from "@/lib/log/logger"
import { cn } from "@/lib/utils"

interface Option<T extends string> {
  value: T
  label: string
}

const MODES: Option<ModePref>[] = [
  { value: "device", label: "Device" },
  { value: "light", label: "Light" },
  { value: "charcoal", label: "Charcoal" },
  { value: "black", label: "Black" },
]
const STYLES: Option<StylePref>[] = [
  { value: "auto", label: "For my role" },
  { value: "warm", label: "Warm" },
  { value: "clinical", label: "Clinical" },
]
const DENSITIES: Option<DensityPref>[] = [
  { value: "auto", label: "For my device" },
  { value: "comfortable", label: "Comfortable" },
  { value: "compact", label: "Compact" },
]

function Segmented<T extends string>({
  label,
  hint,
  options,
  value,
  onChange,
  testId,
}: {
  label: string
  hint?: string
  options: Option<T>[]
  value: T
  onChange: (value: T) => void
  testId: string
}) {
  return (
    <fieldset className="flex flex-col gap-1.5" data-testid={testId}>
      <legend className="text-sm font-semibold">{label}</legend>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={o.value === value}
            data-testid={`${testId}-${o.value}`}
            onClick={() => onChange(o.value)}
            className={cn(
              "press min-h-11 rounded-lg border px-2 text-sm font-medium transition-colors",
              o.value === value ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary" : "bg-card hover:bg-muted",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

/** One place for the three appearance switches. Defaults follow the person's role and device; every choice is saved on this device. */
export function AppearanceSettings() {
  const { mode, style, density, resolvedStyle, resolvedDensity, setMode, setStyle, setDensity } = useAppearance()
  return (
    <Popover>
      <PopoverTrigger
        data-testid="appearance-settings"
        render={<Button variant="outline" size="icon" aria-label="Appearance settings" />}
      >
        <SlidersHorizontal aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(26rem,calc(100vw-2rem))] gap-4 p-4">
        <Segmented
          testId="appearance-mode"
          label="Mode"
          hint="Device follows your iPad or computer; dark is warm charcoal."
          options={MODES}
          value={mode}
          onChange={(v) => {
            setMode(v)
            log.info("appearance changed", { setting: "mode", value: v })
          }}
        />
        <Segmented
          testId="appearance-style"
          label="Style"
          hint={`Warm is softer and rounder; clinical is flatter and neutral. Now: ${resolvedStyle}.`}
          options={STYLES}
          value={style}
          onChange={(v) => {
            setStyle(v)
            log.info("appearance changed", { setting: "style", value: v })
          }}
        />
        <Segmented
          testId="appearance-density"
          label="Density"
          hint={`Comfortable suits touch; compact fits more on a desktop. Now: ${resolvedDensity}.`}
          options={DENSITIES}
          value={density}
          onChange={(v) => {
            setDensity(v)
            log.info("appearance changed", { setting: "density", value: v })
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
