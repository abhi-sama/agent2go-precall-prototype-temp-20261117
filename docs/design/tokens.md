# Design tokens

All tokens are CSS custom properties in `frontend/src/app/globals.css`, mapped to Tailwind utilities in its `@theme inline` block. Components use the Tailwind names (`bg-card`, `text-muted-foreground`, `rounded-lg`) or `var(--token)`; they never carry colour literals. The only literals allowed are canvas and WebGL fallbacks (`map/map-colors.ts`, `charts/echart.tsx`), which read the tokens at runtime and keep a fallback hex for when a token cannot be resolved.

## Switches on `<html>`

| Attribute | Values | Set by |
|---|---|---|
| `class="dark"` | present in warm charcoal and true black | `next-themes` |
| `data-mode="black"` | true black (only with `.dark`) | `AppearanceProvider` |
| `data-style` | `warm`, `clinical` | `AppearanceProvider`; default from persona |
| `data-density` | `comfortable`, `compact` | `AppearanceProvider`; default from `pointer: coarse` |

A boot script in the root layout applies the saved choice (device copy, tagged with the user id) before first paint; the server copy is per user in FE DynamoDB. See `direction.md`, "Saving and applying the choice".

## Groups

| Group | Tokens |
|---|---|
| Surface and text | `--background`, `--foreground`, `--card`, `--popover`, `--secondary`, `--muted`, `--muted-foreground`, `--border`, `--input`, `--ring`, `--sidebar*` |
| Accent | `--primary` (orange-600 light, orange-500 dark), `--primary-foreground` (warm ink in every mode: white is under 4.5:1 on orange-600), `--accent-text` (small orange text), `--accent` (hover wash) |
| Navigation | `--nav-active`, `--nav-active-foreground` |
| Meaning | `--fact*` (computed from source data; `--fact-soft` is the neutral muted surface, no tint), `--ai*` (AI-written; orange wash, see `direction.md`), `--suggest*` (proposals), `--success`, `--warning`, `--destructive` |
| Chart | `--chart-1` to `--chart-6` (categorical, fixed order), `--chart-other`, `--chart-grid`; sequential ramps come from `sequentialFill` |
| Scene | `--scene-bg`, `--scene-tile`, `--scene-tile-locked` (map and globe) |
| Shape and depth | `--radius` and the `rounded-*` scale derived from it, `--elev-card`, `--elev-lift` |
| Density | `--control-h`, `--card-pad`, `--page-gap` |
| Motion | `--ease-out`, `--ease-in-out`, `--ease-drawer`, `--ease-spring`, `--duration-fast`, `--duration-base`, `--duration-slow`, `--duration-spring`, and from ticket #56 `--duration-drill`, `--duration-drawer`, `--duration-fly`, `--duration-stagger`, `--parallax-tilt`, `--parallax-depth`, `--parallax-perspective` |

JS-driven motion (the globe camera, the expand unmount timer) reads these through `lib/motion.ts` `tokenMs()`; it never carries its own numbers.

## Consolidation done in ticket #45

- Chart palette replaced by a validated one; chart colour decisions moved into `charts/palette.ts`.
- Hard-coded hexes in `echart.tsx` now match the tokens (fallbacks only).
- KPI tile colour comes from the chart slot of the measure, not from separate `ink` and `teal` tones.
- Hover and active states read `--accent` and `--nav-active*`, so the two styles differ by tokens alone.
- Fixed pixel and `ease-in-out` values in sheets replaced by motion tokens.
- `--ink`, `--teal`, `--amber`, `--violet` remain for badges and meaning tokens (`--fact`, `--suggest`); they are not chart colours.

## Contrast rules for tokens (ticket #49)

Any new or changed token must keep `e2e/appearance-matrix.spec.ts` green in all six looks. In short: text tokens hold 4.5:1 on the surfaces and tints they appear on, `--input` and `--ring` hold 3:1 on `--background`, `--card`, `--popover` and `--muted`, and `--border` is decorative only (never the sole boundary of a control).
