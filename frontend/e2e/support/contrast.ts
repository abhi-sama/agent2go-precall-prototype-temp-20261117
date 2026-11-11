import type { Page } from "@playwright/test"

/**
 * WCAG 2.x AA contrast checks that run in the page, on what is actually painted (computed colours, composited over
 * the real backgrounds), so they hold for any style x mode combination without knowing the tokens.
 *
 * - Text: 4.5:1, or 3:1 for large text (24px+, or 18.66px+ bold).
 * - Form-control boundaries and the focus ring: 3:1 (WCAG 1.4.11 non-text contrast), checked on inputs, selects and
 *   textareas that carry a border, because their border is what identifies them.
 *
 * Disabled controls are exempt (WCAG 1.4.3). Text over a background image or gradient cannot be measured here; those
 * elements are listed under `unmeasured` so a screen with many of them is visible rather than silently passing.
 * Opt a deliberate exception out with `data-contrast-ok` on the element (or an ancestor) and say why in a comment.
 */
export interface ContrastReport {
  failures: string[]
  checked: number
  unmeasured: number
}

export async function collectContrastReport(page: Page): Promise<ContrastReport> {
  return page.evaluate(() => {
    type RGBA = [number, number, number, number]
    const canvas = document.createElement("canvas")
    canvas.width = canvas.height = 1
    const g = canvas.getContext("2d", { willReadFrequently: true })!
    const parsed = new Map<string, RGBA>()
    /** Any CSS colour (oklch, color-mix, rgb...) to sRGB, through the browser's own parser. */
    const parse = (css: string): RGBA => {
      const hit = parsed.get(css)
      if (hit) return hit
      g.clearRect(0, 0, 1, 1)
      g.fillStyle = "#000"
      g.fillStyle = css
      g.fillRect(0, 0, 1, 1)
      const [r, gr, b, a] = g.getImageData(0, 0, 1, 1).data
      const out: RGBA = [r, gr, b, a / 255]
      parsed.set(css, out)
      return out
    }
    const over = (top: RGBA, bottom: RGBA): RGBA => {
      const a = top[3] + bottom[3] * (1 - top[3])
      if (a === 0) return [0, 0, 0, 0]
      const ch = (i: number) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a
      return [ch(0), ch(1), ch(2), a]
    }
    const lin = (v: number) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    const lum = (c: RGBA) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
    const ratio = (a: RGBA, b: RGBA) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
      return (hi + 0.05) / (lo + 0.05)
    }

    const exempt = (el: Element) => !!el.closest("[data-contrast-ok]") || !!el.closest(".sr-only")
    const hidden = (el: Element) => {
      for (let p: Element | null = el; p; p = p.parentElement) {
        const cs = getComputedStyle(p)
        if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0 || p.getAttribute("aria-hidden") === "true") return true
      }
      return false
    }
    const disabled = (el: Element) => !!el.closest(":disabled, [aria-disabled='true'], [data-disabled]")

    /** Colour behind an element: backgrounds composited upward until one is opaque; null when an image or gradient is involved. */
    const backdrop = (el: Element): RGBA | null => {
      const layers: RGBA[] = []
      for (let p: Element | null = el; p; p = p.parentElement) {
        const cs = getComputedStyle(p)
        if (cs.backgroundImage !== "none") return null
        const c = parse(cs.backgroundColor)
        // An ancestor's opacity fades its own background as well as everything inside it.
        const o = Number(cs.opacity)
        if (c[3] > 0) layers.push([c[0], c[1], c[2], c[3] * o])
        if (c[3] * o >= 1) break
      }
      let out: RGBA = parse(getComputedStyle(document.documentElement).backgroundColor)
      if (out[3] === 0) out = [255, 255, 255, 1]
      for (const layer of layers.reverse()) out = over(layer, out)
      return out
    }
    const opacityOf = (el: Element) => {
      let o = 1
      for (let p: Element | null = el; p; p = p.parentElement) o *= Number(getComputedStyle(p).opacity)
      return o
    }

    const describe = (el: Element) => {
      const id = el.getAttribute("data-testid")
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 36)
      return `<${el.tagName.toLowerCase()}${id ? ` data-testid="${id}"` : ""}> "${text}"`
    }
    const rgb = (c: RGBA) => `rgb(${c.slice(0, 3).map(Math.round).join(",")})`

    const failures: string[] = []
    const seen = new Set<string>()
    let checked = 0
    let unmeasured = 0

    const hasOwnText = (el: Element) => [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "")
    for (const el of document.body.querySelectorAll("*")) {
      if (["SCRIPT", "STYLE", "NOSCRIPT", "OPTION"].includes(el.tagName)) continue
      const isInput = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      const placeholder = isInput && el.placeholder && !el.value
      if (!hasOwnText(el) && !placeholder) continue
      if (exempt(el) || hidden(el) || disabled(el)) continue
      const r = el.getBoundingClientRect()
      if (r.width <= 2 || r.height <= 2) continue

      const cs = placeholder ? getComputedStyle(el, "::placeholder") : getComputedStyle(el)
      const isSvg = el instanceof SVGElement
      const bg = backdrop(el)
      if (!bg) {
        unmeasured++
        continue
      }
      const rawFg = parse(isSvg ? getComputedStyle(el).fill : cs.color)
      const fg = over([rawFg[0], rawFg[1], rawFg[2], rawFg[3] * (placeholder ? 1 : opacityOf(el))], bg)
      const size = parseFloat(cs.fontSize)
      const bold = Number(cs.fontWeight) >= 700
      const large = size >= 24 || (size >= 18.66 && bold)
      const need = large ? 3 : 4.5
      const got = ratio(fg, bg)
      checked++
      if (got + 0.005 >= need) continue
      const key = `${rgb(fg)}|${rgb(bg)}|${need}|${(el.textContent ?? "").trim().slice(0, 20)}`
      if (seen.has(key)) continue
      seen.add(key)
      failures.push(`${got.toFixed(2)}:1 < ${need}:1 ${describe(el)} text ${rgb(fg)} on ${rgb(bg)} (${size}px)`)
    }

    // Form controls: the border (or, failing that, the fill) is what tells a person where to type or tap.
    for (const el of document.body.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea")) {
      if (exempt(el) || hidden(el) || disabled(el)) continue
      const r = el.getBoundingClientRect()
      if (r.width <= 2 || r.height <= 2) continue
      const cs = getComputedStyle(el)
      const bg = backdrop(el.parentElement ?? el)
      if (!bg) continue
      const edgeOf = (c: CSSStyleDeclaration) => parse(c.borderTopWidth !== "0px" && c.borderTopStyle !== "none" ? c.borderTopColor : "rgba(0,0,0,0)")
      let edge = edgeOf(cs)
      let fill = parse(cs.backgroundColor)
      // An Astryx field draws its border and fill on the control box around the native input, so read the box.
      if (edge[3] === 0 && fill[3] === 0) {
        const box = el.closest<HTMLElement>("[class*='astryx-'][class*='-input'], [class*='astryx-'][class*='-segment']")
        if (box) {
          const bcs = getComputedStyle(box)
          edge = edgeOf(bcs)
          fill = parse(bcs.backgroundColor)
        }
      }
      const boundary = edge[3] > 0 ? over(edge, bg) : fill[3] > 0 ? over(fill, bg) : null
      checked++
      if (!boundary) {
        failures.push(`no visible boundary ${describe(el)}`)
        continue
      }
      const got = ratio(boundary, bg)
      if (got + 0.005 < 3) failures.push(`${got.toFixed(2)}:1 < 3:1 control boundary ${describe(el)} ${rgb(boundary)} on ${rgb(bg)}`)
    }

    return { failures, checked, unmeasured }
  })
}

/** The focus ring against the page and card surfaces (3:1), read from the tokens so it covers every state without focusing everything. */
export async function collectFocusRingReport(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const probe = document.createElement("div")
    document.body.append(probe)
    const read = (token: string, prop: "color" | "backgroundColor") => {
      probe.style.cssText = `position:fixed;${prop === "color" ? "color" : "background-color"}:var(${token})`
      return getComputedStyle(probe)[prop]
    }
    const canvas = document.createElement("canvas")
    canvas.width = canvas.height = 1
    const g = canvas.getContext("2d", { willReadFrequently: true })!
    const px = (css: string) => {
      g.clearRect(0, 0, 1, 1)
      g.fillStyle = css
      g.fillRect(0, 0, 1, 1)
      return [...g.getImageData(0, 0, 1, 1).data.slice(0, 3)]
    }
    const lin = (v: number) => ((v / 255) <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)
    const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
    const ratio = (a: number[], b: number[]) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
      return (hi + 0.05) / (lo + 0.05)
    }
    const ring = px(read("--ring", "backgroundColor"))
    const out: string[] = []
    for (const surface of ["--background", "--card", "--popover", "--muted"]) {
      const got = ratio(ring, px(read(surface, "backgroundColor")))
      if (got < 3) out.push(`focus ring on ${surface}: ${got.toFixed(2)}:1 < 3:1`)
    }
    probe.remove()
    return out
  })
}
