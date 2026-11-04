import { resolveCssColor } from "@/lib/css-color"

/** three.js cannot read CSS variables or parse `oklch()`; tokens are resolved to hex. Fallbacks keep the scene readable. */
export interface SceneColors {
  tile: string
  tileLocked: string
  own: string
  calls: string
  hcps: string
  responses: string
  selected: string
}

const FALLBACK: Record<"light" | "dark", SceneColors> = {
  light: { tile: "#e7e2de", tileLocked: "#efecea", own: "#ea580c", calls: "#ea580c", hcps: "#2f4f87", responses: "#2f9d98", selected: "#ea580c" },
  dark: { tile: "#4a443f", tileLocked: "#38332f", own: "#f97316", calls: "#f97316", hcps: "#7ea6e6", responses: "#5fd0c8", selected: "#f97316" },
}

export function readSceneColors(theme: "light" | "dark"): SceneColors {
  const fb = FALLBACK[theme]
  return {
    tile: resolveCssColor("--scene-tile", fb.tile),
    tileLocked: resolveCssColor("--scene-tile-locked", fb.tileLocked),
    own: resolveCssColor("--primary", fb.own),
    calls: resolveCssColor("--chart-1", fb.calls),
    hcps: resolveCssColor("--chart-2", fb.hcps),
    responses: resolveCssColor("--chart-3", fb.responses),
    selected: resolveCssColor("--primary", fb.selected),
  }
}
