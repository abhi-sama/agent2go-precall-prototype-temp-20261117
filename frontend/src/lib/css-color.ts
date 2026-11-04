/**
 * Resolve a CSS custom property to `#rrggbb` for libraries that cannot read CSS variables or parse
 * `oklch()` (three.js, ECharts canvas). A 1x1 canvas accepts any syntax the browser does.
 */
export function resolveCssColor(token: string, fallback: string): string {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
    if (!raw) return fallback
    const canvas = document.createElement("canvas")
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    if (!ctx) return fallback
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = raw
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    if (a === 0) return fallback
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`
  } catch {
    return fallback
  }
}

/** Canvas text cannot resolve `var()`, so read the font stack the page actually uses (Inter, then the system stack). */
export function canvasFontFamily(): string {
  try {
    return getComputedStyle(document.body).fontFamily || "system-ui, sans-serif"
  } catch {
    return "system-ui, sans-serif"
  }
}
