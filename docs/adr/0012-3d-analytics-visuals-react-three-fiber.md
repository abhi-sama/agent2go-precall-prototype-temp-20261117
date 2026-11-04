# 3D analytics visuals use react-three-fiber, opt-in, and always have a 2D twin

Ticket 21 (#22). The spec asks for interactive 3D where it adds insight in analytics, touch-controllable on iPad, with a 2D fallback and reduced-motion support, using only clearly free components.

## Decision

- **Library:** `@react-three/fiber` (MIT) on the `three` we already ship for the globe (MIT), with three's own `OrbitControls` from `three/addons` (MIT).
  We do not add `@react-three/drei`: it would pull in many more packages (and licences to audit) for two helpers we write in about fifty lines (orbit controls wiring and DOM labels).
- **Where:** the Director's "Topics by territory" heatmap gets a third view, **3D**, beside **Chart** and **Table**.
  A bar per theme and territory, height and colour the theme's share of that territory's free-text responses, the same number the 2D chart colours.
  Turning the field reveals a tall bar hidden behind another, which a flat grid cannot.
  Other analytics screens (trend columns, ranked bars, the Executive overview) stay 2D: a third dimension there would only add occlusion.
- **Opt-in, never the default.** The 3D view loads on demand (its own chunk), so a Director who never taps 3D never downloads it, and the 2D chart and the table stay the canonical, accessible views.
- **2D fallback.** No WebGL, a lost graphics context (iPad Safari does this under memory pressure) or a render error returns to the 2D chart with a plain-language notice.
  Tapping a bar selects the same cell as the chart and the table, so the detail card, the "Ask the agent" link and the table are shared.
- **Reduced motion.** No bar rise-in, no glide after a flick (damping off), no animated button steps; the view is still until moved.
  Rendering is on demand (`frameloop="demand"`), so a still scene draws nothing, which also saves battery.
- **Touch.** One finger rotates, two fingers pinch and pan, a tap picks a bar. A tap that lands beside a slim bar takes the nearest bar within 24 CSS px (a 48px target); a ray hit always wins.
  The wheel scrolls the page past the chart (only Ctrl or Cmd + wheel, which is what a trackpad pinch sends, zooms it) so the chart never traps scrolling.
  44px buttons zoom in, zoom out and reset; arrow keys, plus, minus and zero do the same from the keyboard.
- **Frame budget on iPad.** One instanced mesh (one draw call for any number of bars), about 1,000 triangles for 84 bars, pixel ratio capped at 2, nothing drawn while still.
  The e2e suite asserts at most 6 draw calls and 5,000 triangles, and that no frames are drawn once settled.

## Consequences

- Colours come from the design tokens (`--primary`, `--card`, `--foreground`, `--chart-grid`) and are re-read when the mode changes. Lit shading means a bar's colour is approximate to the legend; the printed value in the readout and the table is exact.
- Axis names are DOM labels positioned each frame, so text stays crisp. They thin out (every n-th) rather than overlap.
- Local builds publish each bar's screen position as `data-bars` on the chart element so tests can tap a specific bar. Deployed builds drop it (`IS_LOCAL_BUILD`).
- Follow-ups: a 3D region-by-month view for the Executive once region-by-period counts exist; remembering the chosen view per person.
