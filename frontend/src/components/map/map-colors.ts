import { resolveCssColor } from "@/lib/css-color"

/** Canvas and WebGL cannot read CSS variables or parse `oklch()`, so tokens are resolved to hex. */
export interface MapColors {
  /** Land with no activity. */
  land: string
  /** The sea behind the flat map and the globe's ocean. */
  sea: string
  border: string
  text: string
  muted: string
  /** Quietest activity tint, up to the full accent for the busiest. */
  low: string
  high: string
  popover: string
}

const FALLBACK: Record<"light" | "dark", MapColors> = {
  light: { land: "#e7e2de", sea: "#f6f3f0", border: "#d4cdc7", text: "#2a2420", muted: "#7a716a", low: "#fde4d3", high: "#ea580c", popover: "#ffffff" },
  dark: { land: "#4a443f", sea: "#2b2723", border: "#625b55", text: "#f1ede9", muted: "#a39a93", low: "#5c3a26", high: "#f97316", popover: "#3a3531" },
}

export function readMapColors(theme: "light" | "dark"): MapColors {
  const fb = FALLBACK[theme]
  return {
    land: resolveCssColor("--scene-tile", fb.land),
    sea: resolveCssColor("--scene-bg", fb.sea),
    border: resolveCssColor("--border", fb.border),
    text: resolveCssColor("--foreground", fb.text),
    muted: resolveCssColor("--muted-foreground", fb.muted),
    low: fb.low,
    high: resolveCssColor("--primary", fb.high),
    popover: resolveCssColor("--popover", fb.popover),
  }
}
