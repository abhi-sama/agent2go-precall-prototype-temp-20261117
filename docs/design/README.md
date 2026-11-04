# Design system and UI quality process

Everything about how the interface looks and moves lives here. Read this before you change any screen.

| File | What it holds |
|---|---|
| `direction.md` | The visual direction: styles, modes, density, type, motion tiers, AI content, navigation |
| `tokens.md` | Where each design token lives and how to use it |
| `charts.md` | The chart system: shared components, validated palette, conventions |
| `motion-plan.md` | Motion tokens, where motion helps and where it must not, the audit and open plans |
| `audit.md` | The phase 1 audit of the merged screens, each finding fixed or listed with a reason |
| `report/index.html` | The before and after design report for the captain (open in a browser) |
| `../../frontend/e2e/__visual__/<viewport>/` | Visual regression baselines: key screens in all six style x mode looks at every size in the matrix (`pnpm test:visual`) |
| `screenshots/<viewport>/` | Key screens at every size in the matrix (MSL, Director, Admin, chat, design system, two appearance variants) |
| `../adr/0009-ui-library-choices.md` | Libraries for virtualization, the command menu, drag and drop, toasts |

## The standing process for every UI ticket

Phases 1 and 2 (direction, audit, libraries, chart system, motion audit) were done once in ticket #45. **Phases 3 and 4 apply to every UI change.** Use the installed skills named below.

### Phase 3: build

1. **`animate`** for any planned motion. Take curves, durations and the two tiers from `motion-plan.md` and `direction.md`; no new easing values.
2. **`ask-sonner`** for toasts. Use the one `<Toaster />` from the root layout; call `toast()` from `sonner`. Toasts confirm or report and never carry names, emails or HCP text.
3. **`emil-design-eng`** for detail polish: spacing, states (hover, active, disabled, loading, error, empty), focus rings, number alignment.
4. **`mobile-native`** for iPad-native feel: no tap highlight, 16px minimum input text (no zoom on focus), `100dvh` not `100vh`, safe-area insets, no sticky hover, installable app.

Also: layout and charts follow `impeccable` and `dataviz`. Use the shared components in `frontend/src/components/charts/` and the tokens in `globals.css`; do not hard-code colours, radii or durations.

### Phase 4: verify

5. **Run and look.** Use `run` and `chrome-devtools-axi`: launch the app, screenshot every screen you touched at every size in the matrix below, and check the console for errors and the page for performance problems.
6. **`review-animations` gate.** Any motion you added or changed goes through it before the PR.
7. **`impeccable` final polish** before the end-to-end acceptance testers, run once at the end of the ticket.
8. **`lavish`** before and after report for the captain to annotate, attached to the PR.

Not used: `animate-expo` (React Native only), `claude-in-chrome` (drives the captain's own browser), `animation-vocabulary` (naming only).

### Viewport matrix (captain, 2026-11-04)

Nothing may overflow, overlap or need horizontal scrolling at any of these. Touch targets stay 44pt or larger on iPad sizes. Charts and the 3D views must resize correctly.

| Device | Sizes |
|---|---|
| MacBook Air 13 | 1280x800, 1470x956 |
| MacBook Pro 14 | 1512x982 |
| MacBook Pro 16 | 1728x1117 |
| Desktop | 1920x1080, 2560x1440 |
| iPad Air 11 | 820x1180, 1180x820 |
| iPad Pro 11 | 834x1194, 1194x834 |
| iPad Air 13 | 1024x1366, 1366x1024 |
| iPad Pro 13 | 1032x1376, 1376x1032 |

The list is `frontend/e2e/support/viewports.ts` and the screens are `frontend/e2e/support/screens.ts` (the shared responsive matrix from ticket #46; Playwright builds one project per viewport). `pnpm test:e2e` runs every screen at every size and fails on sideways scrolling, clipped or overlapping content, touch targets under 44pt on iPad sizes, and charts or 3D views that do not fit.
A full-page screenshot per screen and size lands in `frontend/test-results/screenshots/<viewport>/<screen>.png`. Add your screen to `SCREENS` when you add a route.
`frontend/e2e/appearance.spec.ts` covers style, mode and density (persona defaults, persistence, no flash); extend it when you add a token that changes with them.
`pnpm test:visual` compares the key screens (MSL, Director, Admin, chat, design system, and the first-run card) in all six looks at every viewport against the committed screenshots in `frontend/e2e/__visual__/<viewport>/` (above the fold, reduced motion, WebGL canvases masked). It is opt-in because pixels depend on the machine: the baselines are macOS + the bundled Chromium. After an intended look change run `pnpm test:visual:update` (it also recompresses the PNGs losslessly), review the image diff in the PR and commit. Add a screen to `KEY_SCREENS` in `e2e/visual-regression.spec.ts` when it introduces a new look.
`frontend/e2e/appearance-matrix.spec.ts` runs the key screens in all six style x mode looks at every viewport and fails on layout problems and on WCAG AA contrast (`e2e/support/contrast.ts`). Add a screen to `KEY_SCREENS` when it introduces new colour combinations.

### Before you open the PR

- [ ] Used the shared chart components and tokens; no hard-coded colours
- [ ] Looked at light, warm charcoal and true black, and at warm and clinical styles
- [ ] Looked at comfortable and compact density
- [ ] `pnpm check` and `pnpm test:e2e` pass
- [ ] Motion added: `review-animations` run, reduced motion checked
- [ ] Screenshots at the matrix attached or linked, and the before/after report linked in the PR body
