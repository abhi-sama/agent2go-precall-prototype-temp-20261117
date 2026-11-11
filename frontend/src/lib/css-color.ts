/**
 * Resolve a CSS custom property to `#rrggbb` for libraries that cannot read CSS variables (three.js, ECharts canvas).
 *
 * Astryx tokens are `light-dark()` pairs and some are translucent washes, and neither means anything to a canvas.
 * So the token is resolved by the browser on a hidden probe inside the themed page (which applies the active theme
 * and colour scheme), then painted over the page surface on a 1x1 canvas: a translucent token comes back as the
 * opaque colour a person actually sees.
 */
export function resolveCssColor(token: string, fallback: string): string {
  try {
    const probe = document.createElement("span")
    probe.setAttribute("aria-hidden", "true")
    probe.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none"
    probe.style.color = `var(${token})`
    probe.style.backgroundColor = "var(--color-background-surface, var(--background, #fff))"
    const host = document.querySelector("[data-astryx-theme]:not(html)") ?? document.body
    host.appendChild(probe)
    const style = getComputedStyle(probe)
    const color = style.color
    const surface = style.backgroundColor
    const declared = getComputedStyle(probe).getPropertyValue(token).trim()
    probe.remove()
    if (!declared || !color) return fallback

    const canvas = document.createElement("canvas")
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    if (!ctx) return fallback
    // A token that paints nothing keeps the caller's fallback.
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = color
    ctx.fillRect(0, 0, 1, 1)
    if (ctx.getImageData(0, 0, 1, 1).data[3] === 0) return fallback
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = surface || "#fff"
    ctx.fillRect(0, 0, 1, 1)
    ctx.fillStyle = color
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`
  } catch {
    return fallback
  }
}

/** Canvas text cannot resolve `var()`, so read the font stack the page actually uses (the theme's body face). */
export function canvasFontFamily(): string {
  try {
    return getComputedStyle(document.body).fontFamily || "system-ui, sans-serif"
  } catch {
    return "system-ui, sans-serif"
  }
}
