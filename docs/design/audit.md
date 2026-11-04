# Audit of the merged screens (ticket #45, phase 1 step 2)

Method: `impeccable` audit and critique. Every merged screen was captured at 1280x800 and 1180x820 in light and warm charcoal (before screenshots), the detector ran over `frontend/src` (no findings), touch targets were measured at 820x1180, and the code was swept for hard-coded colours and unthemed controls.
Screens: MSL, Director and Executive landing (filters, map or globe, KPIs, distributions, qualitative insights, question catalog, HCP search), My activity, Chat, Administration with data quality, Hierarchy and coverage.

Audit health: Accessibility 3, Performance 3, Theming 3, Responsive 3, Implementation integrity 3 (15 of 20, "good"). After the fixes below: Accessibility 3, Performance 3, Theming 4, Responsive 4, Integrity 4.

| # | Sev | Finding | Status |
|---|---|---|---|
| 1 | P1 | MSL nav showed "My territory" and "Insights" both active (same route); Director "My region" and "Themes" likewise | Fixed: only the first matching item is current (`app-shell.tsx`) |
| 2 | P1 | Chart palette failed validation: light slot 2 below the lightness band and chroma floor, a gray slot, dark slots above the lightness band, blue and teal 11.0 apart in dark | Fixed: new validated palette (`charts.md`) |
| 3 | P1 | Text inputs 32px high and native selects and date fields below 44px on iPad (Saved view name, search, admin forms) | Fixed: `--control-h`, base rule for select and date fields |
| 4 | P1 | Admin pipeline table scrolled sideways inside a half-width card at 1280 | Fixed: table card now full width |
| 5 | P2 | Eyebrow labels ("Governed access controls", "Hierarchy governance") above page titles | Fixed: removed; the title carries the page |
| 6 | P2 | Distribution bars, heat cells and load timeline were bespoke markup in three places | Fixed: shared `DistributionBars`, `Heatmap`, `Timeline` |
| 7 | P2 | Mix and channel charts cycled colours with `i % 6`, repainting series when a filter changed the count | Fixed: `assignSeries` folds to Other, never cycles |
| 8 | P2 | Activity charts looked empty for 1.5s while bars drew in | Fixed: 450ms draw-in (also in the motion plan) |
| 9 | P2 | Sidebar active item was a solid orange block on every persona, so orange stopped meaning "action" | Fixed through the clinical style: neutral chip with an orange icon for Director, Executive, Admin |
| 10 | P2 | Geist everywhere with numerals not tabular | Fixed: Inter with tabular figures |
| 11 | P3 | Page titles on admin pages use two `h1`s on `/admin` (Administration, Data quality) | Listed: the data-quality block is a second page section embedded by the data-quality ticket; make it an `h2` when the admin landing is next touched |
| 12 | P3 | Native `<select>` and date inputs keep browser chrome in the admin forms and filter bar | Listed: they now meet the touch floor and theme colours; replacing them with the shadcn `Select` is a per-feature follow-up (filters ticket) to avoid conflicts with open work |
| 13 | P3 | KPI cards are a three-up "big number" template | Kept on purpose: these are the headline figures for the persona; the definition line makes each one legible |
| 14 | P3 | Light mode slots 3, 5, 6 under 3:1 on white | Kept: relief rule (visible labels or a table view) applies and is documented |
| 15 | P3 | Next.js dev indicator overlaps the sidebar in dev builds only | Not an app issue; absent in production builds |

Positive findings: tokens and Tailwind names are used everywhere (no raw palette classes), reduced motion is read in JS and CSS, safe areas and tap highlight and input zoom are handled, status never relies on colour alone (icons and words), definitions are visible without hover, the globe falls back to the flat map.
