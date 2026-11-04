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

UI code only talks to `DataAdapter` (`src/lib/data/adapter.ts`), which mirrors the foundation GraphQL contract
(`me`, `landingKpis`).

- `mock-adapter.ts`: deterministic fixtures. Local builds accept `?scenario=empty|error|forbidden|slow|stale`.
- `graphql-adapter.ts`: the real adapter against the contract documents in `operations.ts`. The wiring worker supplies
  only a `GraphQLTransport` (Amplify `client.graphql` plus the Cognito token and an `x-correlation-id` header), then
  changes the one branch in `createDefaultAdapter()` in `src/lib/data/index.ts`.
- `territoryActivity` is a shell-local extension (not in the contract) feeding the 3D map; adapters may omit it.

## Local-only features

`NEXT_PUBLIC_APP_ENV=local` (set in `.env.development`) enables the persona quick-switch and scenario forcing. In any
other build the switcher is not rendered and a stored identity is ignored (the code still ships; it is inert).

## Logging

`src/lib/log/logger.ts` emits JSON lines (`ts`, `level`, `msg`, `correlation_id`, `service`). Fields pass through an
allowlist, so tokens, emails, names and free text cannot be logged. Log ids, counts and durations only.

## Accessibility and touch

44pt minimum targets, visible focus, skip link, `prefers-reduced-motion` honoured (count-up, scene sway, chart
animation), 16px inputs to stop iOS zoom, safe-area insets, `touch-action: pan-y` on the 3D stage so vertical swipes still scroll.
Orange-600 with white text is ~3.6:1: used for large or semibold labels; small accent text uses orange-700 (`text-accent-text`).
