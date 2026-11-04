# agent2go frontend (a2g-shell)

Next.js (App Router) + TypeScript + Tailwind v4 + shadcn/ui. Runs entirely locally against a mock adapter; no AWS is contacted.

```bash
pnpm install
pnpm dev            # http://localhost:3000 (local mode: persona quick-switch on)
pnpm check          # typecheck + lint + unit tests
pnpm test:e2e       # Playwright: functional specs at iPad Air 11, plus the responsive matrix at every viewport (builds and serves on :3147)
```

## What is here

| Area | Where |
|---|---|
| Design tokens (orange-600 accent, white / warm charcoal, ink-teal-amber-violet palette) | `src/app/globals.css` |
| App shell (rail on desktop, swipeable tabs on iPad/phone), theme toggle | `src/components/shell/` |
| Role landings: `/msl` (full), `/director`, `/executive`, `/admin` | `src/app/(app)/` |
| KPI cards, data-through badge, scope label, shared filter state, saved views, response distributions and question discovery | `src/components/landing/`, `src/components/filters/`, `src/components/shell/scope-label.tsx` |
| R3F territory map with 2D fallback and reduced-motion support | `src/components/three/` |
| shadcn chart (Recharts) and Apache ECharts wrappers | `src/components/charts/` |
| Source fact / AI summary / Suggestion primitives | `src/components/provenance/` |
| Empty, error, loading states | `src/components/state/` |
| Design system showcase | `/design` |

## Data layer (the swap point)

UI code only talks to `DataAdapter` (`src/lib/data/adapter.ts`), which mirrors the GraphQL contract in
`amplify/data/schema.graphql` (`me`, `landingKpis`, `geoActivity`, `insightDiscovery`, `savedViews`, `saveView`). `NEXT_PUBLIC_DATA_ADAPTER` picks the adapter:

- `appsync`: `graphql-adapter.ts` over `appsync-transport.ts` (Cognito ID token, IdP name/email and `x-correlation-id`
  headers) against the FE AppSync API. Sign-in is Cognito through Amplify (`src/lib/session/cognito-session.tsx`,
  `/login`). `backend/infra/scripts/up.sh` writes the `.env.local` that selects it for the local floci stack.
- `mock`: deterministic fixtures. Local builds accept `?scenario=empty|error|forbidden|slow|stale`.

The local floci stack answers no CORS preflights, so local builds reach it through the same-origin rewrite `/_floci/*`
in `next.config.ts`.

## Local-only features

`NEXT_PUBLIC_APP_ENV=local` (set in `.env.development`) enables the persona quick-switch, the seeded-user sign-in list
and scenario forcing. Other builds drop them: `pnpm check:local-only` builds a deployed-style bundle and fails if any
quick-switch UI, seeded identity or local password is in it.

Against the local stack, `pnpm test:e2e:stack` signs in as seeded users for real (Cognito -> AppSync -> RLS Postgres).

## Logging

`src/lib/log/logger.ts` emits JSON lines (`ts`, `level`, `msg`, `correlation_id`, `service`). Fields pass through an
allowlist, so tokens, emails, names and free text cannot be logged. Log ids, counts and durations only.

## Responsive test matrix

Every screen is checked at every viewport the captain named (2026-11-04): MacBook Air 13 (1280x800, 1470x956), MacBook Pro 14
(1512x982), MacBook Pro 16 (1728x1117), 1920x1080, 2560x1440, and iPad Air 11, iPad Pro 11, iPad Air 13 and iPad Pro 13,
each in portrait and landscape. That is 20 Playwright projects, generated from one list.

| File | Role |
|---|---|
| `e2e/support/viewports.ts` | The viewport list. One Playwright project per entry (`playwright.config.ts`); tablet entries emulate touch and a coarse pointer. |
| `e2e/support/screens.ts` | The screen registry: path, persona, a `ready` wait and an optional `prepare` that opens a drawer, runs a search or sends a chat message. |
| `e2e/support/layout-checks.ts` | In-page checks that return named offenders. |
| `e2e/responsive.spec.ts` | Runs every registered screen at the project's viewport. |

Each screen at each viewport fails on:

- horizontal overflow of the page (the offending elements are listed);
- clipped content, text sliced by an `overflow` ancestor that is not a scroller;
- two unrelated interactive or text elements overlapping;
- on tablet viewports, any interactive element under 44 x 44 css px (a checkbox or switch counts through its `<label>`);
- a `<canvas>` or Recharts surface that is collapsed or wider than its container or the viewport.

A full-page screenshot per screen and viewport is attached to every run (`test-results/screenshots/<viewport>/<screen>.png`, and
the HTML report in `playwright-report/`). Only `responsive.spec.ts` runs on all 20 projects; the functional specs
(`smoke`, `activity`, `chat`, `territory-map`) run on the two iPad Air 11 projects.

```bash
pnpm test:e2e                                                      # everything
pnpm exec playwright test e2e/responsive.spec.ts                   # the matrix only
pnpm exec playwright test e2e/responsive.spec.ts --project=ipad-pro-13-portrait -g "admin"
```

**Adding your screen (every ticket that ships UI):** append an entry to `SCREENS` in `e2e/support/screens.ts`, one per
meaningful state (landing, drawer open, error). If a check fails, fix the shared component rather than the page. The
only escape hatch is `data-layout-ok="overlap | clip | touch"` on the element, with a comment saying why.

The suite runs 4 workers (2 in CI): the globe renders in software WebGL and taps time out when too many pages compete. Raise it with `--workers` only on a fast machine.

Notes for writing fixes: shared controls (`Input`, `Button`) are 44px; small buttons use `pointer-coarse:` to reach 44px on
tablets, so a native `<select>` or custom button needs `h-11`/`min-h-11`. Do not call `page.emulateMedia` in a matrix test
(it resets the coarse-pointer emulation), and measure before a full-page screenshot (it resizes the viewport).

## Accessibility and touch

44pt minimum targets, visible focus, skip link, `prefers-reduced-motion` honoured (count-up, scene sway, chart
animation), 16px inputs to stop iOS zoom, safe-area insets, `touch-action: pan-y` on the 3D stage so vertical swipes still scroll.
Orange-600 with white text is ~3.6:1: used for large or semibold labels; small accent text uses orange-700 (`text-accent-text`).
