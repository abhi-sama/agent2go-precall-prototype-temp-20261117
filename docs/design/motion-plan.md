# Motion plan (ticket #45, phase 2)

Product personality: a crisp field and analytics tool used on iPad and laptop. Motion explains where something came from or confirms a tap; it never decorates data people are reading.
Sources: `find-animation-opportunities` (where motion helps and where it must not) and `improve-animations` (audit of what exists, ranked).

## Motion tokens (in `frontend/src/app/globals.css`)

| Token | Value | Use |
|---|---|---|
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | Anything entering, leaving or responding to a tap |
| `--ease-in-out` | `cubic-bezier(0.77, 0, 0.175, 1)` | Something already on screen that moves or morphs |
| `--ease-drawer` | `cubic-bezier(0.32, 0.72, 0, 1)` | Sheets and drawers |
| `--duration-fast` / `-base` / `-slow` | 120 / 200 / 450ms | Press feedback / popovers and sheets leaving / chart draw-in |

Rules: no `ease-in` on UI, no `transition: all`, animate `transform` and `opacity`, nothing over 300ms except chart draw-in (450ms) and the globe fly-in (900ms, occasional).
Reduced motion keeps fades and colour changes and drops movement (see the `prefers-reduced-motion` block in `globals.css`).

## Where motion helps (kept to six, ranked by leverage)

| # | Where | Purpose | Frequency | Motion |
|---|---|---|---|---|
| 1 | Evidence drawer and citation sheet (`ui/sheet.tsx`) | Spatial consistency: the panel comes from the edge it will leave by | Occasional | Slide full width from its edge, 300ms `--ease-drawer` in, 200ms out, opacity 0 to 1. **Applied.** |
| 2 | Globe to flat map drill-down (`map/globe-view.tsx`, `territory-map.tsx`) | Preventing a jarring change: the country you tapped grows into its map | Occasional | Camera fly-in 900ms (three-globe tween), then the flat map fades in over 300ms `ease-out`. Fade shortened from 500ms. **Applied.** Reduced motion skips the globe and shows the flat map. |
| 3 | Streaming chat answer (`chat/chat-panel.tsx`, `assistant-turn.tsx`) | State indication: the answer is still arriving | Tens per day | Blinking caret on the last paragraph (kept). A new turn scrolls in smoothly; tokens that arrive afterwards follow instantly instead of restarting a smooth scroll on every update. **Applied.** |
| 4 | Distribution bars and chart draw-in (`charts/`) | Preventing a jarring change: bars appear anchored at zero | Occasional | 450ms `--ease-out` grow from the baseline. Recharts and ECharts defaults were 1000 to 1500ms. **Applied.** |
| 5 | Button press (`ui/button.tsx`) | Feedback: the tap was heard | Tens per day | `scale(0.98)` on `:active`, 150ms `ease-out`. **Applied.** |
| 6 | KPI figures (`hooks/use-count-up.ts`) | State indication on first appearance only | Occasional | Count up once in 400ms (was 700ms and replayed on every filter change). Later changes snap. **Applied.** |
| 7 | 3D bar field (`charts/bar-field/`) | Preventing a jarring change: bars appear anchored at the floor; camera steps keep the viewer oriented | Occasional | 450ms `--ease-out` rise on first show only (no stagger); 200ms `--ease-in-out` camera step on zoom, reset and arrow keys; post-flick glide (damping). All off under reduced motion, and the scene draws only when something changes. **Applied (ticket #22).** |

## Where motion must not be added

- Command and search menu (⌘K, `cmdk` per ADR 0009): keyboard-initiated, 100+ times a day. No open or close animation.
- Table rows, virtualized lists, filter chips and saved-view buttons: tens of times a day, only `transition-colors` at 150ms.
- Chart tooltips, heatmap cells, map hover: data being read. No bounce, no follow-through.
- Globe auto-rotation: tap targets that drift are hard to hit (already off, keep it off).
- Re-drawing charts on every filter change is tolerated at 450ms; do not lengthen it, and do not add stagger to bars.
- Persona switch, theme switch: `disableTransitionOnChange` stays on.

## Audit of existing motion, ranked

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | High | Sheets used `ease-in-out` and a 2.5rem nudge, so the drawer popped rather than slid | Fixed |
| 2 | High | Recharts and ECharts drew in over 1000 to 1500ms | Fixed: 450ms `ease-out` via `useChartMotion` and `CHART_ANIMATION_MS` |
| 3 | High | Global reduced-motion rule set every transition to 0.01ms, removing fades that show state | Fixed: fades and colour stay, movement goes |
| 4 | High | Chat restarted a smooth scroll on every streamed token | Fixed |
| 5 | Medium | `transition-all` on button and toggle animated unintended properties | Fixed: explicit property list |
| 6 | Medium | KPI count-up replayed for 700ms on every filter change | Fixed |
| 7 | Medium | Flat map fade 500ms after drill-down | Fixed: 300ms |
| 8 | Low | `transition-all` remains in `ui/switch.tsx` and `ui/badge.tsx` (vendored shadcn) | Planned, see plan C |
| 9 | Low | Popovers, menus and tooltips already scale from `--transform-origin` | Correct, keep |

## Plans for what is not applied

A. **Stagger the landing KPI tiles** (delight budget, low). 40ms between three tiles, `opacity` 0 to 1 and `translateY(8px)` to 0, 250ms `--ease-out`, first view per session only, never after a filter change. Wrap in `motion-safe:`.
B. **Hierarchy rows expand** (`admin/hierarchy-view.tsx`). Today children appear instantly. Use a `grid-template-rows: 0fr` to `1fr` transition over 200ms `--ease-out` with `opacity`; chevron already rotates.
C. **Vendored shadcn leftovers.** Replace `transition-all` with explicit properties in `ui/switch.tsx` and `ui/badge.tsx` the next time those files are touched.
D. **Toasts.** Sonner's defaults (enter and exit from the bottom edge, interruptible) meet the bar; the `ask-sonner` pass in phase 3 sets position and duration per ticket.

Every ticket that adds motion runs `review-animations` on the diff (phase 4) before it ships.

## Review gate (`review-animations`, ticket #45)

Reviewed: sheet, button and toggle, motion tokens and utilities, reduced-motion block, chart draw-in, distribution bars, chat scroll, count-up, map drill-down.

| Before | After | Why |
|---|---|---|
| `.hover-lift` transitioned `box-shadow` and only inside the hover media query | Transform only, transition declared outside the media query | Shadow is a paint property, and un-hover snapped back instantly |
| `bar-grow` scaled the bar from `scaleX(0)` | `clip-path: inset(0 100% 0 0)` to `inset(0)` | `scale(0)` squashed the rounded data end; a clip reveals from the baseline without distortion |
| Flat map after a drill-down was a pure fade | Fade plus `zoom-in-95`, 300ms `ease-out` | The country you tapped grows into its map; a pure fade has no spatial story |

Accepted as is: chart draw-in at 450ms (data explanation, occasional), the 550ms spring (expressive tier, landing and empty scenes only, documented in `direction.md`), the globe fly-in at 900ms (three-globe tween, occasional, skipped under reduced motion), count-up at 400ms (once, JS because it counts).
Reduced motion: transitions keep opacity and colour; keyframe animations collapse to their end state, so a keyframed fade is lost. Prefer transitions for new work so the fade survives.

Decision: **Approve** after the three changes above. Feel-check still owed on a real iPad: sheet slide at 300ms, press scale, map drill-down.
