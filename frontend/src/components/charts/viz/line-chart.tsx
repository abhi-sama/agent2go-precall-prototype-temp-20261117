"use client"

import * as React from "react"
import { seriesColor } from "@/components/charts/palette"
import { cn } from "@/lib/utils"
import { fmt, niceScale, Readout, useWidth } from "./shared"

export interface LinePoint {
  key: string
  label: string
  value: number
  partial?: boolean
}

const DEFAULT_H = 220
const PAD = { left: 44, right: 16, top: 14, bottom: 30 }

/**
 * Single-series line over time. A crosshair snaps to the nearest bucket for pointer, touch and arrow keys, and the
 * readout above gives the exact value. A bucket the period only partly covers is drawn dashed and hollow and is said
 * to be partial, so a short last month never reads as a drop.
 */
export function LineChart({ points, unit, peakKey, height = DEFAULT_H, testId = "line-chart" }: { points: LinePoint[]; unit: string; peakKey?: string | null; height?: number; testId?: string }) {
  const H = height
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = React.useState<number | null>(null)
  const w = Math.max(width, 240)
  const innerW = w - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const { top, ticks } = niceScale(Math.max(0, ...points.map((p) => p.value)))
  const x = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW)
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH
  const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(innerW / 64))))
  const solid = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ")
  const area = `${solid} L${x(points.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`
  const current = active != null ? points[active] : null
  const peak = points.findIndex((p) => p.key === peakKey)

  const nearest = (clientX: number, rect: DOMRect) => {
    const rel = clientX - rect.left - PAD.left
    return Math.min(points.length - 1, Math.max(0, Math.round((rel / innerW) * (points.length - 1))))
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault()
      setActive((a) => Math.min(points.length - 1, Math.max(0, (a ?? (e.key === "ArrowRight" ? -1 : points.length)) + (e.key === "ArrowRight" ? 1 : -1))))
    } else if (e.key === "Escape") setActive(null)
  }

  return (
    <div data-testid={testId} className="flex flex-col gap-2">
      <Readout idle="Hover, tap or use the arrow keys for a value.">
        {current && (
          <>
            <strong className="font-semibold">{fmt(current.value)}</strong> {unit} · {current.label}
            {current.partial && <span className="text-muted-foreground"> (partial period)</span>}
          </>
        )}
      </Readout>
      <div ref={ref} className="w-full">
        {width > 0 && (
          <svg
            width={w}
            height={H}
            viewBox={`0 0 ${w} ${H}`}
            role="group"
            aria-label={`Line chart, ${points.length} points. Use the left and right arrow keys to read values.`}
            tabIndex={0}
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
            className="block max-w-full touch-pan-y rounded-md focus-visible:outline-2 focus-visible:outline-ring"
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={w - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
                <text x={PAD.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground text-[11px] tabular-nums">
                  {fmt(t)}
                </text>
              </g>
            ))}
            {points.map((p, i) =>
              i % every === 0 || i === points.length - 1 ? (
                <text key={p.key} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} className="fill-muted-foreground text-[11px]">
                  {p.label}
                </text>
              ) : null,
            )}
            <defs>
              <linearGradient id={`${testId}-fill`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={seriesColor(1)} stopOpacity={0.22} />
                <stop offset="100%" stopColor={seriesColor(1)} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <path d={area} fill={`url(#${testId}-fill)`} className="viz-fade" />
            {points.slice(1).map((p, i) => {
              const dashed = p.partial || points[i].partial
              return (
                <line
                  key={p.key}
                  x1={x(i)}
                  y1={y(points[i].value)}
                  x2={x(i + 1)}
                  y2={y(p.value)}
                  stroke={seriesColor(1)}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeDasharray={dashed ? "4 4" : undefined}
                  className="viz-fade"
                />
              )
            })}
            {points.map((p, i) => (
              <circle
                key={p.key}
                data-testid="line-point"
                data-key={p.key}
                data-value={p.value}
                cx={x(i)}
                cy={y(p.value)}
                r={active === i ? 5 : points.length <= 14 ? 3.5 : 0}
                fill={p.partial ? "var(--card)" : seriesColor(1)}
                stroke={p.partial ? seriesColor(1) : "var(--card)"}
                strokeWidth={p.partial ? 2 : 2}
                className="viz-fade"
              />
            ))}
            {peak >= 0 && active == null && (
              <text x={x(peak)} y={y(points[peak].value) - 10} textAnchor="middle" className="fill-foreground text-[11px] font-semibold tabular-nums">
                {fmt(points[peak].value)}
              </text>
            )}
            {current && <line x1={x(active!)} x2={x(active!)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--muted-foreground)" strokeWidth={1} strokeDasharray="3 3" />}
            <rect
              data-testid="line-hit"
              x={PAD.left}
              y={0}
              width={innerW}
              height={H}
              fill="transparent"
              className={cn("cursor-crosshair")}
              onPointerMove={(e) => setActive(nearest(e.clientX, e.currentTarget.ownerSVGElement!.getBoundingClientRect()))}
              onPointerDown={(e) => setActive(nearest(e.clientX, e.currentTarget.ownerSVGElement!.getBoundingClientRect()))}
              onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
            />
          </svg>
        )}
      </div>
    </div>
  )
}
