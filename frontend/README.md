# agent2go frontend (a2g-shell)

Next.js (App Router) + TypeScript + Tailwind v4 + shadcn/ui. Runs entirely locally against a mock adapter; no AWS is contacted.

```bash
pnpm install
pnpm dev            # http://localhost:3000 (local mode: persona quick-switch on)
pnpm check          # typecheck + lint + unit tests
pnpm test:e2e       # Playwright smoke tests at iPad landscape + portrait (builds and serves on :3147)
```

## What is here

| Area | Where |
|---|---|
| Design tokens (orange-600 accent, white / warm charcoal, ink-teal-amber-violet palette) | `src/app/globals.css` |
| App shell (rail on desktop, swipeable tabs on iPad/phone), theme toggle | `src/components/shell/` |
| Role landings: `/msl` (full), `/director`, `/executive`, `/admin` | `src/app/(app)/` |
| KPI cards, data-through badge, scope label, shared `FilterBar` | `src/components/landing/`, `src/components/filters/`, `src/components/shell/scope-label.tsx` |
| R3F territory map with 2D fallback and reduced-motion support | `src/components/three/` |
| shadcn chart (Recharts) and Apache ECharts wrappers | `src/components/charts/` |
| Source fact / AI summary / Suggestion primitives | `src/components/provenance/` |
| Empty, error, loading states | `src/components/state/` |
| Design system showcase | `/design` |

## Data layer (the swap point)

UI code only talks to `DataAdapter` (`src/lib/data/adapter.ts`), which mirrors the GraphQL contract in
`amplify/data/schema.graphql` (`me`, `landingKpis`, `territoryActivity`). `NEXT_PUBLIC_DATA_ADAPTER` picks the adapter:

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

## Accessibility and touch

44pt minimum targets, visible focus, skip link, `prefers-reduced-motion` honoured (count-up, scene sway, chart
animation), 16px inputs to stop iOS zoom, safe-area insets, `touch-action: pan-y` on the 3D stage so vertical swipes still scroll.
Orange-600 with white text is ~3.6:1: used for large or semibold labels; small accent text uses orange-700 (`text-accent-text`).
