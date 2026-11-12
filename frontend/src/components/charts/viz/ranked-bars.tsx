"use client"

import { Button } from "@astryxdesign/core/Button"
import * as React from "react"
import { seriesColor } from "@/components/charts/palette"
import { fmt, Readout, stagger } from "./shared"

export interface BarDatum {
  key: string
  label: string
  value: number
  sharePct?: number | null
}

/**
 * Ranked horizontal bars: one hue, longest first, the value printed at the end of every bar (so nothing depends on
 * hover). Each row is a button: hover, focus or tap puts its exact value and share in the readout above.
 */
export function RankedBars({ data, unit, testId = "ranked-bars" }: { data: BarDatum[]; unit: string; testId?: string }) {
  const [active, setActive] = React.useState<string | null>(null)
  const max = Math.max(1, ...data.map((d) => d.value))
  const current = data.find((d) => d.key === active)
  return (
    <div data-testid={testId} className="flex flex-col gap-2">
      <Readout idle="Hover or tap a bar for its exact value.">
        {current && (
          <>
            <strong className="font-semibold">{fmt(current.value)}</strong> {unit} · {current.label}
            {current.sharePct != null && <> · {current.sharePct}% of the total</>}
          </>
        )}
      </Readout>
      <ul className="flex flex-col" onPointerLeave={() => setActive(null)}>
        {data.map((d, i) => (
          <li key={d.key}>
            <Button
              data-testid="bar-row"
              data-key={d.key}
              data-value={d.value}
              label={`${d.label}: ${fmt(d.value)} ${unit}${d.sharePct != null ? `, ${d.sharePct}% of the total` : ""}`}
              variant={active === d.key ? "secondary" : "ghost"}
              width="100%"
              onPointerEnter={() => setActive(d.key)}
              onFocus={() => setActive(d.key)}
              onClick={() => setActive(d.key)}
            >
              <span className="grid w-full min-w-0 grid-cols-[minmax(4.5rem,30%)_minmax(0,1fr)_auto] items-center gap-3 text-left">
                <span className="truncate" title={d.label}>
                  {d.label}
                </span>
                <span className="h-3 rounded-r-md bg-muted/50" aria-hidden>
                  <span
                    className="viz-grow-x block h-full rounded-r-md"
                    style={{ width: `${Math.max(1, (d.value / max) * 100)}%`, backgroundColor: seriesColor(1), opacity: active && active !== d.key ? 0.55 : 1, ...stagger(i) }}
                  />
                </span>
                <span className="min-w-12 text-right font-semibold tabular-nums">{fmt(d.value)}</span>
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
