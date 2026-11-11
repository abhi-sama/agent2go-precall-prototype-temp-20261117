# Modern Web Guidance audit

Date: 2026-11-10

## Scope and method

This closing pass ran `npx modern-web-guidance@latest legacy-scan frontend --json` across the complete frontend.
It reported zero findings across its 35 rules (33 guides); this scanner intentionally covers only a subset of
the guidance corpus. The pass also reviewed the focused guides for accessibility, forms, motion, overlays,
responsive layout, dark mode, Core Web Vitals, HTML sanitisation, and dates/time zones against the Astryx
components and the application shell.

## Fixed

- Added `<meta name="text-scale" content="scale">` through Next metadata. Supporting browsers now apply the
  operating system text-size preference to the app's existing `rem`/`em`-based layout; other browsers retain
  normal browser zoom as the specified fallback.

## Verified or intentionally kept

- **Focus, labels, errors, and motion:** the shell supplies a visible `:focus-visible` treatment; Astryx inputs
  own their label, status, and IME-safe Enter behavior; existing form errors use alert/status semantics; and the
  app and Astryx components already honor reduced motion. No replacement was made because hand-rolled behavior
  would duplicate or weaken the component-library contract.
- **Dialogs and popovers:** Astryx `Dialog` and `Popover` provide focus handling, dismissal, top-layer/adaptive
  presentation, and dynamic-viewport bounds. The remaining Base UI sheets are intentional adapters documented in
  `astryx-migration.md`; replacing them in this final audit would be a behavior-changing migration, not a safe
  standards fix.
- **Forms and autofill:** the sign-in form has stable names and `username`/`current-password` autocomplete;
  Astryx field components preserve labels and semantic controls. Existing client-side forms are scoped state
  controls rather than server-submitted documents, so adding actions or methods would change their behavior.
- **Responsive layout and viewport units:** the shell already uses safe-area padding and `dvh` where viewport
  height matters, with flexible layouts and contained horizontal scrolling for essential wide tables. Existing
  viewport breakpoints describe whole-app navigation, so container queries would not improve their semantics.
- **Dark mode:** the root declares `color-scheme`, the server viewport metadata declares both schemes, and the
  pre-hydration appearance script pins a saved override before first paint. This is intentionally retained as the
  documented Astryx theme integration.
- **Core Web Vitals:** the app has no content image LCP candidate to reprioritize; the bundled root fallback font
  uses `font-display: swap`; long data views preserve their previous result while fetching; and intrinsic canvas/chart
  regions reserve their own layout. `content-visibility` was not added because it could hide charts, live regions,
  or focus targets from assistive technology.
- **Untrusted HTML:** agent and markdown-like responses are rendered as React text and structured components;
  there is no untrusted `innerHTML`/`dangerouslySetInnerHTML` sink. The two `dangerouslySetInnerHTML` uses inject
  only source-controlled appearance boot scripts, so adding an HTML sanitizer there would be irrelevant.
- **Dates and time zones:** date-only business values are formatted using explicit UTC `Intl.DateTimeFormat`
  instances; timestamp/audit values deliberately use the viewer's locale. There are no user-scheduled civil-time
  inputs that would justify adding Temporal or changing the established display semantics.

## Evidence

- `legacy-scan frontend --json`: 0 findings.
- Browser Lighthouse audits and exact-iPad accessibility trees cover login, one page per persona, and chat at
  iPad and desktop viewports; the before/after score table is recorded in the pull request because the local
  audit artifacts are intentionally kept outside the disposable worktree.
