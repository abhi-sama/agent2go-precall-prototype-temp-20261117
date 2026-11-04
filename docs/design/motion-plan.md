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
| `--duration-drill` / `-drawer` | 220 / 250ms | Drill-down swaps, map reveal, route change / sheets coming in |
| `--duration-fly` | 560ms | Globe camera flying in to a country (read by JS through `tokenMs`) |
| `--duration-stagger` | 50ms | Gap between sibling cards entering together |
| `--ease-spring`, `--duration-spring` | damped spring, 550ms | Expressive tier only: landing cards and empty-state scenes |
| `--parallax-tilt` / `-depth` / `-perspective` | 2.5deg / 10px / 900px | Light 3D parallax on landing scenes |

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


---

# Ticket #56 (D8): motion applied across the app

Everything in the plan above that was marked "Planned", plus the expressive tier from `direction.md`, is now built. All of it uses the tokens above; no new easing values.

## Found and fixed: sheets never slid, presses never animated

Tailwind v4 compiles `translate-x-full` and `scale-[0.98]` to the CSS properties `translate` and `scale`, not `transform`. The sheet and button transition lists named `transform`, so the drawer only faded (its translate jumped at the first frame) and the press scale snapped. Both lists now name `translate` / `scale` explicitly; the drawer measurably travels from 100% to 0 in 250ms. The shared `transition-all` leftovers in `switch`, `badge` and `tabs` now list their properties (plan C).

## What was built

| # | Motion | Where | Spec |
|---|---|---|---|
| 1 | Globe to map zoom | `map/territory-map.tsx`, `globe-view.tsx` | Camera fly-in 560ms (`--duration-fly`, was 900), then the flat map grows in (`.drill-in`, 220ms) while the globe fades out underneath for the same beat, so the handoff overlaps instead of waiting. Tapping the globe or a breadcrumb mid-flight stops the camera where it is and hands control back. Marker press scales to 0.95 in 120ms. |
| 2 | Drill-down transitions | Map levels and the map side panel; Director drill-down (region, territory, HCP); Executive record sheet; territory comparison | `.drill-in`: opacity plus `scale(0.97)` to 1, 220ms `--ease-out`. Going deeper grows in; going up (`data-dir="out"`) settles back from `scale(1.03)`. Content swaps animate on their own key, so stale rows never replay. |
| 3 | Drawers and sheets | `ui/sheet.tsx` (evidence drawer, citation sheet, executive records) | Slide from the edge 250ms `--ease-drawer`, leave in 200ms. Transitions, so closing mid-open retargets. |
| 4 | KPI counters | `charts/kpi-tile.tsx`, `executive/count.tsx` | Count up once per screen per page load (400ms); filter changes and skeleton remounts snap. Executive figures now count too. |
| 5 | Card springs | Landing, Director, Activity and Executive KPI tiles | `.spring-in` with a 50ms stagger (`--i`), first view per screen only (`useEnter`). Plan A. |
| 6 | Light 3D parallax | Landing header scene (`motion/parallax-scene.tsx`) | The decorative stage tilts up to 2.5deg and layers drift up to 10px toward a fine pointer; leaving springs back. Content never moves. Off for touch and reduced motion. |
| 7 | Hierarchy expand | `admin/hierarchy-view.tsx` via `motion/expand.tsx` | `grid-template-rows` 0fr to 1fr plus fade, 200ms; unmounts after the close. Plan B. |
| 8 | Route change | `app/(app)/template.tsx` | `.page-in`: opacity and 4px rise, 120ms (tens of times a day, so near-imperceptible). The shell does not re-animate. |
| 9 | Toasts | `ui/sonner.tsx` (plan D) | 4s, three visible, safe-area offset on desktop and mobile. Sonner's own transitions are kept. |

Empty-state and first-run scenes are ticket #75's (`state-family`): they already enter with a `--duration-base` fade through `@starting-style` and lose the movement under reduced motion, so this ticket leaves them alone.

Not animated, on purpose (unchanged): command menu, table rows, tooltips and heatmap cells, globe auto-rotation, theme and persona switch.

## Reduced motion

`prefers-reduced-motion: reduce` keeps opacity, colour and shadow, and removes everything that moves. Entrances (`.spring-in`, `.fade-up`, `.drill-in`, `.page-in`, `.viz-*`) become a 200ms fade (`reveal-fade`); Tailwind's `animate-in` keeps its fade with the translate and scale variables zeroed; `:active` scale and hover lift are cancelled; parallax layers are fixed; the globe is not used. Verified by `e2e/motion.spec.ts`, which fails if any running animation or transition touches `transform`, `translate`, `scale` or `rotate`.

## Interactions stay live

No transition blocks input: nothing sets `pointer-events: none` on content while it plays (the globe on handoff is the exception, because it is leaving). Entrances use `backwards` fill, so no transform is left on a container after it finishes. Tested: close a drawer the instant it opens, reopen it immediately, cancel the camera mid-flight from a breadcrumb or a tap, then open another country.

## Review gate (`review-animations`, ticket #56)

Reviewed against the ten standards and the escalation triggers: sheet, button, KPI tile entrance and counter, parallax scene, drill-in, expand, page-in, globe fly-in and handoff, toaster, reduced-motion block.

| Before | After | Why |
| --- | --- | --- |
| Sheet and button transitions named `transform` while Tailwind v4 animates `translate` and `scale` | Property lists name `translate`, `scale`, `transform`, `opacity` | The drawer only faded and the press snapped; measured translate now travels 100% to 0 in 250ms |
| Globe marker press `active:scale-90` | `active:scale-95` | 0.9 is too deep for a 44pt target; the rest of the product presses to 0.97 to 0.98 |
| Route change fade-up 220ms | 120ms (`--duration-fast`) | Tens of times a day: near-imperceptible only |
| Entrance keyframes with `both` fill left `transform` on the card | `backwards` fill | A lingering transform traps fixed children and keeps a stacking context for nothing |
| Reduced motion: keyframed entrances collapsed to nothing, and `:active` still scaled | Entrances become a 200ms `reveal-fade`; `scale: none` on `:active` | Reduced motion means gentler, not none; and a press that scales is still movement |
| Second country tapped mid-flight snapped the camera to the first target before heading to the second | Camera is frozen in place, then redirected | three-globe completes a replaced tween; the current view is read first |

Accepted as is, with the reason:

- Spring entrance (550ms, a little overshoot) on landing KPI cards: the captain's expressive tier, rare (first view per screen per page load), stagger 50ms, never on data being read, and a plain fade under reduced motion.
- Globe fly-in 560ms: a camera crossing a sphere, occasional, `Cubic.InOut` (on-screen movement), interruptible, skipped entirely under reduced motion.
- `.expand` animates `grid-template-rows`: the accordion exception (no transform equivalent), 200ms, fade alongside, only fade under reduced motion.
- Parallax: decorative layers only, pointer-fine only, `transform` written per layer from one rAF, spring return on leave, off under reduced motion; nothing the person reads or taps moves.
- KPI count-up 400ms in JS: counts, so it cannot be CSS; once per screen per page load.
- Not changed: `shadow-lift` on KPI tile hover is a paint-property transition inherited from #45; flagged for the next time that tile is touched.

Decision: **Approve.** Feel-check still owed on a real iPad: sheet slide at 250ms, press scale, the globe handoff overlap, and the spring entrance on the landing.
