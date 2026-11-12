import type { Page } from "@playwright/test"

/**
 * Layout checks that run in the page. Each returns a list of human-readable offenders (empty means pass), so a
 * failure names the element and its box rather than "expected 0 to be 0". Opt a deliberate exception out with
 * `data-layout-ok="overlap" | "clip" | "touch"` on the element (or an ancestor) and say why in a comment.
 */

export interface LayoutReport {
  overflow: string[]
  clipped: string[]
  overlapping: string[]
  smallTargets: string[]
  badMedia: string[]
}

export async function collectLayoutReport(page: Page, opts: { touch: boolean }): Promise<LayoutReport> {
  return page.evaluate((touch) => {
    const MIN_TARGET = 44
    const EPS = 1

    const describe = (el: Element) => {
      const id = el.getAttribute("data-testid")
      const r = el.getBoundingClientRect()
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40)
      return `<${el.tagName.toLowerCase()}${id ? ` data-testid="${id}"` : ""}${el.className && typeof el.className === "string" ? ` class="${el.className.slice(0, 60)}"` : ""}> "${text}" [${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}]`
    }
    const exempt = (el: Element, kind: string) => {
      const holder = el.closest("[data-layout-ok]")
      return !!holder && (holder.getAttribute("data-layout-ok") ?? "").split(/\s+/).includes(kind)
    }
    const isScrollable = (cs: CSSStyleDeclaration) => /(auto|scroll)/.test(cs.overflowX + cs.overflowY)
    const clips = (cs: CSSStyleDeclaration) => /(hidden|clip|auto|scroll)/.test(cs.overflowX + cs.overflowY)

    /** The part of the element's box that is actually painted: intersected with every clipping ancestor. */
    const visibleRect = (el: Element): DOMRect | null => {
      let r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return null
      let left = r.left, top = r.top, right = r.right, bottom = r.bottom
      for (let p = el.parentElement; p; p = p.parentElement) {
        const cs = getComputedStyle(p)
        if (p !== document.documentElement && p !== document.body && clips(cs)) {
          const pr = p.getBoundingClientRect()
          left = Math.max(left, pr.left); top = Math.max(top, pr.top)
          right = Math.min(right, pr.right); bottom = Math.min(bottom, pr.bottom)
        }
      }
      if (right - left <= 0 || bottom - top <= 0) return null
      r = new DOMRect(left, top, right - left, bottom - top)
      return r
    }
    // A modal <dialog> (the Astryx navigation drawer) makes the rest of the page inert: only what it holds is on screen to use.
    // Dialogs can nest (a citation sheet opened from the chat drawer): the innermost modal is the one on top.
    const modals = [...document.querySelectorAll("dialog:modal")]
    const modal = modals.find((d) => !modals.some((o) => o !== d && d.contains(o))) ?? null
    const isShown = (el: Element) => {
      if (modal && !modal.contains(el)) return false
      // Tailwind's .sr-only (skip link, "Close" labels) is intentionally collapsed and clipped to 1px.
      if (el.closest(".sr-only")) return false
      // Content of a closed <details> is not rendered (content-visibility: hidden) though it keeps a stale box.
      for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null) {
        if (!d.open && !(el.closest("summary")?.parentElement === d)) return false
      }
      const cs = getComputedStyle(el)
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return false
      for (let p: Element | null = el; p; p = p.parentElement) {
        const c = getComputedStyle(p)
        if (c.display === "none" || c.visibility === "hidden" || Number(c.opacity) === 0 || p.getAttribute("aria-hidden") === "true") return false
      }
      return true
    }
    /** Visually hidden helpers (skip link, sr-only text) collapse to ~1px and are not a layout concern. */
    const isTiny = (r: DOMRect) => r.width <= 2 || r.height <= 2

    const vw = document.documentElement.clientWidth
    const overflow: string[] = []
    const scrollW = document.documentElement.scrollWidth
    if (scrollW - vw > 0) {
      overflow.push(`page scrollWidth ${scrollW} > viewport ${vw}`)
      for (const el of document.body.querySelectorAll("*")) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || !isShown(el)) continue
        if (r.right > vw + EPS || r.left < -EPS) {
          const vr = visibleRect(el)
          if (vr && (vr.right > vw + EPS || vr.left < -EPS)) overflow.push(describe(el))
        }
        if (overflow.length > 12) break
      }
    }

    // Clipping: a non-scrolling box that hides part of its own content (and is not an ellipsis truncation).
    const clipped: string[] = []
    for (const el of document.body.querySelectorAll("*")) {
      if (el.closest("svg, canvas") || !isShown(el)) continue
      // A visually hidden helper (Astryx's skip link and VisuallyHidden text) is collapsed to 1px on purpose.
      const own = el.getBoundingClientRect()
      if (isTiny(own)) continue
      const cs = getComputedStyle(el)
      if (!/(hidden|clip)/.test(cs.overflowX) || isScrollable(cs)) continue
      if (cs.textOverflow === "ellipsis" || exempt(el, "clip")) continue
      const he = el as HTMLElement
      if (he.scrollWidth - he.clientWidth > EPS) clipped.push(`${describe(el)} content ${he.scrollWidth}px in ${he.clientWidth}px`)
    }
    // Text sliced by an ancestor's overflow clip.
    for (const el of document.body.querySelectorAll("h1,h2,h3,h4,p,label,legend,th,td,li,span,a,button")) {
      if (el.closest("svg, canvas") || exempt(el, "clip") || !isShown(el)) continue
      if (!Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? "").trim())) continue
      const full = el.getBoundingClientRect()
      const vis = visibleRect(el)
      if (full.width < 2 || full.height < 2) continue
      const cs = getComputedStyle(el)
      if (cs.textOverflow === "ellipsis") continue
      if (!vis) {
        // Fully clipped away only counts when the clipper is not a scroll container (those are reachable by scrolling).
        let scrollable = false
        for (let p = el.parentElement; p; p = p.parentElement) if (isScrollable(getComputedStyle(p))) scrollable = true
        if (!scrollable && full.right > 0 && full.left < vw) clipped.push(`fully clipped ${describe(el)}`)
        continue
      }
      let inScroller = false
      for (let p = el.parentElement; p; p = p.parentElement) if (isScrollable(getComputedStyle(p))) inScroller = true
      if (!inScroller && (full.width - vis.width > EPS || full.height - vis.height > EPS)) clipped.push(`partly clipped ${describe(el)}`)
    }

    // Overlap: the painted boxes of two unrelated interactive or text-bearing elements intersect.
    type Atom = { el: Element; rect: DOMRect; lines?: DOMRect[] }
    const atoms: Atom[] = []
    const interactiveSel = "a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],[role=switch],[role=checkbox],[role=menuitem],[role=option],[tabindex]:not([tabindex='-1'])"
    for (const el of document.body.querySelectorAll("*")) {
      if (el.closest("svg, canvas, [data-layout-ok~='overlap']") || !isShown(el)) continue
      const hasOwnText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? "").trim())
      const interactive = el.matches(interactiveSel)
      if (!hasOwnText && !interactive) continue
      // Text boxes use the range rect so a wide block with short text does not overlap its neighbours falsely.
      let rect: DOMRect | null
      let lines: DOMRect[] | undefined
      if (hasOwnText && !interactive) {
        const range = document.createRange()
        range.selectNodeContents(el)
        const rects = Array.from(range.getClientRects())
        if (!rects.length) continue
        const l = Math.min(...rects.map((x) => x.left)), t = Math.min(...rects.map((x) => x.top))
        const r2 = Math.max(...rects.map((x) => x.right)), b = Math.max(...rects.map((x) => x.bottom))
        const clipRect = visibleRect(el)
        if (!clipRect) continue
        const L = Math.max(l, clipRect.left), T = Math.max(t, clipRect.top), R = Math.min(r2, clipRect.right), B = Math.min(b, clipRect.bottom)
        if (R - L <= 0 || B - T <= 0) continue
        rect = new DOMRect(L, T, R - L, B - T)
        // Wrapped inline text paints one box per line; their union also covers the other lines' free space.
        lines = rects
          .map((x) => new DOMRect(Math.max(x.left, clipRect.left), Math.max(x.top, clipRect.top), Math.min(x.right, clipRect.right) - Math.max(x.left, clipRect.left), Math.min(x.bottom, clipRect.bottom) - Math.max(x.top, clipRect.top)))
          .filter((x) => x.width > 0 && x.height > 0)
      } else {
        rect = visibleRect(el)
      }
      if (!rect || isTiny(rect)) continue
      atoms.push({ el, rect, lines })
    }
    const overlapping: string[] = []
    const stickyOrFixed = (el: Element) => {
      for (let p: Element | null = el; p; p = p.parentElement) {
        const pos = getComputedStyle(p).position
        if (pos === "fixed" || pos === "sticky") return true
      }
      return false
    }
    for (let i = 0; i < atoms.length && overlapping.length < 15; i++) {
      for (let j = i + 1; j < atoms.length; j++) {
        const a = atoms[i], b = atoms[j]
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue
        // A text area draws its own character counter in the control's corner; the control reserves that space.
        if ((a.el.matches('.astryx-text-area-counter') && b.el.matches('.astryx-text-area-control')) || (b.el.matches('.astryx-text-area-counter') && a.el.matches('.astryx-text-area-control'))) continue
        // A fixed or sticky bar legitimately floats over scrolled content; we check the page at rest (scroll 0).
        // Compare painted line boxes (the union only bounds them), so a chip sitting in a wrapped sentence is not a false overlap.
        let w = 0, h = 0
        for (const ra of a.lines ?? [a.rect]) {
          for (const rb of b.lines ?? [b.rect]) {
            const ow = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left)
            const oh = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
            if (ow > 2 && oh > 2 && ow * oh > w * h) { w = ow; h = oh }
          }
        }
        if (w > 2 && h > 2) {
          // Ignore a modal layer stacked above the page: both atoms must live in the same layer.
          const layerA = a.el.closest("[role=dialog],[data-slot=sheet-content],[data-slot=popover-content]")
          const layerB = b.el.closest("[role=dialog],[data-slot=sheet-content],[data-slot=popover-content]")
          if (layerA !== layerB) continue
          if (stickyOrFixed(a.el) !== stickyOrFixed(b.el)) continue
          // The chat dock (composer and its scroll-to-latest button) floats over the message list by design, so scrolled answers pass underneath it.
          const dock = ".astryx-chat-composer, .astryx-chat-layout-scroll-button"
          if (!!a.el.closest(dock) !== !!b.el.closest(dock)) continue
          overlapping.push(`${describe(a.el)}  x  ${describe(b.el)} (${Math.round(w)}x${Math.round(h)} shared)`)
        }
      }
    }

    // Touch targets (tablet projects only): every visible interactive element is at least 44 x 44 css px.
    const smallTargets: string[] = []
    if (touch) {
      if (!matchMedia('(pointer: coarse)').matches) smallTargets.push('pointer: coarse not emulated')
      for (const el of document.body.querySelectorAll(interactiveSel)) {
        if (!isShown(el) || exempt(el, "touch")) continue
        if ((el as HTMLInputElement).type === "hidden" || (el as HTMLInputElement).disabled) continue
        if (el.closest("svg, canvas")) continue
        if (el.tagName === "A" && el.closest("p, li") && getComputedStyle(el).display === "inline") continue // inline text link (WCAG exception)
        if (el.getAttribute("tabindex") !== null && !el.matches("a[href],button,input,select,textarea,summary,[role]")) {
          // Only generic tabindex hosts (scroll regions) are skipped; they are not tap targets.
          continue
        }
        const vr = visibleRect(el)
        if (!vr || isTiny(vr)) continue
        // A checkbox, radio or switch is tapped through its label, so the label's box is the target.
        const hit = el.matches("input[type=checkbox],input[type=radio],[role=switch],[role=checkbox]") ? (el.closest("label") ?? el) : el
        const r = hit.getBoundingClientRect()
        if (r.width < MIN_TARGET - 0.5 || r.height < MIN_TARGET - 0.5) smallTargets.push(describe(hit))
      }
    }

    // Charts and 3D views fill, but never exceed, their container, and are not collapsed.
    const badMedia: string[] = []
    for (const el of document.body.querySelectorAll("canvas, svg.recharts-surface")) {
      if (!isShown(el) || exempt(el, "clip")) continue
      const r = el.getBoundingClientRect()
      const parent = el.parentElement
      if (!parent) continue
      const pr = parent.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) { badMedia.push(`collapsed ${describe(el)}`); continue }
      if (r.right > pr.right + EPS + 1 || r.right > vw + EPS) badMedia.push(`wider than container ${describe(el)} (parent ${Math.round(pr.width)}px, viewport ${vw}px)`)
    }

    return { overflow, clipped, overlapping, smallTargets, badMedia }
  }, opts.touch)
}
