# Design tokens

All tokens are CSS custom properties in `frontend/src/app/globals.css`, mapped to Tailwind utilities in its `@theme inline` block. Components use the Tailwind names (`bg-card`, `text-muted-foreground`, `rounded-lg`) or `var(--token)`; they never carry colour literals. The only literals allowed are canvas and WebGL fallbacks (`map/map-colors.ts`, `charts/echart.tsx`), which read the tokens at runtime and keep a fallback hex for when a token cannot be resolved.

## Switches on `<html>`

| Attribute | Values | Set by |
|---|---|---|
| `class="dark"` | present in warm charcoal and true black | `next-themes` |
| `data-mode="black"` | true black (only with `.dark`) | `AppearanceProvider` |
| `data-style` | `warm`, `clinical` | `AppearanceProvider`; default from persona |
| `data-density` | `comfortable`, `compact` | `AppearanceProvider`; default from `pointer: coarse` |

A boot script in the root layout applies saved choices before first paint.

## Groups

| Group | Tokens |
|---|---|
| Surface and text | `--background`, `--foreground`, `--card`, `--popover`, `--secondary`, `--muted`, `--muted-foreground`, `--border`, `--input`, `--ring`, `--sidebar*` |
| Accent | `--primary` (orange-600 light, orange-500 dark), `--primary-foreground`, `--accent-text` (small orange text), `--accent` (hover wash) |
| Navigation | `--nav-active`, `--nav-active-foreground` |
| Meaning | `--fact*` (computed from source data), `--ai*` (AI-written), `--suggest*` (proposals), `--success`, `--warning`, `--destructive` |
| Chart | `--chart-1` to `--chart-6` (categorical, fixed order), `--chart-other`, `--chart-grid`; sequential ramps come from `sequentialFill` |
| Scene | `--scene-bg`, `--scene-tile`, `--scene-tile-locked` (map and globe) |
| Shape and depth | `--radius` and the `rounded-*` scale derived from it, `--elev-card`, `--elev-lift` |
| Density | `--control-h`, `--card-pad`, `--page-gap` |
| Motion | `--ease-out`, `--ease-in-out`, `--ease-drawer`, `--ease-spring`, `--duration-fast`, `--duration-base`, `--duration-slow`, `--duration-spring` |

## Consolidation done in ticket #45

- Chart palette replaced by a validated one; chart colour decisions moved into `charts/palette.ts`.
- Hard-coded hexes in `echart.tsx` now match the tokens (fallbacks only).
- KPI tile colour comes from the chart slot of the measure, not from separate `ink` and `teal` tones.
- Hover and active states read `--accent` and `--nav-active*`, so the two styles differ by tokens alone.
- Fixed pixel and `ease-in-out` values in sheets replaced by motion tokens.
- `--ink`, `--teal`, `--amber`, `--violet` remain for badges and meaning tokens (`--fact`, `--suggest`); they are not chart colours.
