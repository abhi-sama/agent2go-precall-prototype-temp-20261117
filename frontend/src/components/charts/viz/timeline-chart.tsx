"use client"

import * as React from "react"
import { seriesColor } from "@/components/charts/palette"
import { fmt, Readout, useWidth } from "./shared"
import type { LinePoint } from "./line-chart"

const H = 150
const PAD = { left: 16, right: 16, top: 30, bottom: 34 }

/**
 * Activity timeline: one dated marker per day or week on a single axis, marker size following the count, the busiest
 * marker labelled. The axis is a calendar, so quiet stretches show as gaps rather than being squeezed out.
 */
export function TimelineChart({ points, unit, peakKey, testId = "timeline-chart" }: { points: LinePoint[]; unit: string; peakKey?: string | null; testId?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = React.useState<number | null>(null)
  const w = Math.max(width, 240)
  const innerW = w - PAD.left - PAD.right
  const max = Math.max(1, ...points.map((p) => p.value))
  const x = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW)
  const radius = (v: number) => (v === 0 ? 3 : 5 + (v / max) * 11)
  const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(innerW / 70))))
  const current = active != null ? points[active] : null
  const axisY = H - PAD.bottom
  const step = points.length > 1 ? innerW / (points.length - 1) : innerW
  return (
    <div data-testid={testId} className="flex flex-col gap-2">
      <Readout idle="Hover or tap a marker for its exact count.">
        {current && (
          <>
            <strong className="font-semibold">{fmt(current.value)}</strong> {unit} · {current.label}
            {current.partial && <span className="text-muted-foreground"> (partial period)</span>}
          </>
        )}
      </Readout>
      <div ref={ref} className="w-full">
        {width > 0 && (
          <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="group" aria-label={`Timeline with ${points.length} markers`} className="block max-w-full" onPointerLeave={() => setActive(null)}>
            <line x1={PAD.left} x2={w - PAD.right} y1={axisY} y2={axisY} stroke="var(--border)" strokeWidth={2} strokeLinecap="round" />
            {points.map((p, i) => (
              <g key={p.key}>
                <line x1={x(i)} x2={x(i)} y1={axisY} y2={axisY + 5} stroke="var(--muted-foreground)" strokeWidth={1} />
                {(i % every === 0 || i === points.length - 1) && (
                  <text x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} className="fill-muted-foreground text-[11px]">
                    {p.label}
                  </text>
                )}
                <circle
                  data-testid="timeline-point"
                  data-key={p.key}
                  data-value={p.value}
                  cx={x(i)}
                  cy={axisY - radius(p.value) - 4}
                  r={active === i ? radius(p.value) + 2 : radius(p.value)}
                  fill={p.value === 0 ? "var(--card)" : seriesColor(1)}
                  stroke={p.value === 0 ? "var(--muted-foreground)" : "var(--card)"}
                  strokeWidth={2}
                  fillOpacity={p.partial ? 0.55 : 1}
                  className="viz-pop"
                  style={{ ["--viz-delay" as string]: `${Math.min(i * 18, 360)}ms` }}
                />
                {(p.key === peakKey || points.length <= 16) && (
                  <text x={x(i)} y={axisY - radius(p.value) * 2 - 12} textAnchor="middle" className={`fill-foreground text-[11px] tabular-nums ${p.key === peakKey ? "font-semibold" : "fill-muted-foreground"}`}>
                    {fmt(p.value)}
                  </text>
                )}
                <rect x={x(i) - Math.max(step / 2, 1)} y={0} width={Math.max(step, 2)} height={H} fill="transparent" onPointerEnter={() => setActive(i)} onPointerDown={() => setActive(i)} />
              </g>
            ))}
          </svg>
        )}
      </div>
    </div>
  )
}
