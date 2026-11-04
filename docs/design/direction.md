# Visual direction (ticket #45)

One product, two styles, three modes, two densities. Every screen reads as the same product because they share one set of components and one set of tokens; a style, mode or density changes the tokens, never the components.
Decided by the captain on 2026-11-04 (grilling session), built on the existing orange-600 / white / warm-charcoal theme.

## The idea

MSL Agent is a calm, trustworthy workspace for people who talk to doctors about evidence. The orange-600 accent is the warmth in it: it marks the action you can take and the thing you are looking at, and nothing else.
Numbers are plain, sourced facts. AI content is visibly different and always cites its sources.

## Styles

| | Warm professional | Clinical precise |
|---|---|---|
| Default for | MSL | Director, Executive, Administrator |
| Feel | Calm, friendly, soft | Restrained, neutral, dense |
| Radius | `0.875rem` | `0.5rem` |
| Elevation | Soft lifted cards | Flat, hairline edges |
| Hover and wash | Orange-tinted | Neutral gray |
| Active navigation | Solid orange block | Neutral chip with an orange icon |
| Orange is spent on | Active items, primary buttons, accents, micro-interactions | Primary action and focus only |
| Surfaces (light) | Warm neutrals | Cool neutrals |

Anyone can change style in the appearance settings (header, sliders icon): **For my role** (default), **Warm** or **Clinical**.
Style lives on `<html data-style="warm|clinical">` and changes tokens (`--radius`, `--elev-*`, `--accent`, `--secondary`, `--muted`, `--border`, `--nav-active*`). Components read tokens only.

## Modes

| Mode | Background | Notes |
|---|---|---|
| Light | White | Orange-600 accent |
| Warm charcoal | `#1C1917` | Accent lifts to orange-500 so labels keep contrast. Device dark maps here. |
| True black | `#000000` | OLED. Surfaces separate by lightness and hairlines, not shadows. `.dark[data-mode="black"]`. |
| Device | Follows the OS | Light or warm charcoal, never true black |

The header's sun/moon button flips light and dark; the appearance settings pick Device, Light, Charcoal or Black.
The chart palette was validated on white, charcoal card and black card surfaces (see `charts.md`).

## Density

| Density | Default for | Control height | Card padding |
|---|---|---|---|
| Comfortable | iPad and any touch device (`pointer: coarse`) | 44px | 1rem |
| Compact | Desktop (`pointer: fine`) | 36px | 0.75rem |

Touch targets stay 44pt or larger on touch devices; compact is reachable on a touch device only by choosing it. Tokens: `--control-h`, `--card-pad`, `--page-gap`, on `<html data-density>`.

## Type

Inter (variable, self-hosted through `@fontsource-variable/inter`) with tabular figures on for the whole app (`font-feature-settings: "tnum"`), so columns of numbers align and live counts do not jitter. Geist Mono stays for record ids and code.
Scale: page title 30 to 36px semibold, section title 20px semibold, body 14 to 16px, captions 12px. No all-caps labels except the existing short scope and status chips.

## Motion

Two tiers, one rule: it must always feel fast and never distract.

- **Purposeful base (150 to 250ms, `--ease-out`):** drill-downs, globe-to-map zoom, drawers, press feedback, popovers.
- **Expressive delight (springy, up to 550ms):** springy cards (`spring-in`, `--ease-spring`), animated counters, 3D parallax on landing scenes. May be fairly heavy on landing and empty states; never on data being read, never on keyboard-driven actions.
- Reduced motion keeps fades and colour changes and drops movement. Details and the audit are in `motion-plan.md`.

Primitives in `globals.css`: `--ease-out`, `--ease-in-out`, `--ease-drawer`, `--ease-spring`, `--duration-*`, `.press`, `.hover-lift`, `.spring-in`, `.fade-up`, and from ticket #56 `.drill-in`, `.page-in`, `.expand` and `.parallax-layer` (with `ParallaxScene` and `Expand` in `components/motion/`). Where each is applied is in `motion-plan.md`.

## AI content

One component family, `frontend/src/components/provenance/provenance.tsx`, marks the three kinds of content everywhere they appear: chat answers, pre-call briefs, theme cards, territory summaries, and exports. Words and labels live in `frontend/src/lib/provenance.ts`.

| Kind | Component | Look | Always carries |
|---|---|---|---|
| Source fact | `SourceFact` | Plain card, hairline edge, no tint | "Source" label, database icon |
| AI summary | `AiSummary` | Soft orange wash (`--ai-soft`), solid orange-tinted edge | Sparkle "AI summary" badge, and citation chips (`citations` prop) that open the source record, 44px on touch |
| Suggestion | `Suggestion` | Dashed teal outline | Lightbulb, the word "Suggestion" |

Rules: never carry colour alone (icon, label and outline differ); AI never introduces a figure that is not in the source facts beside it; every AI summary shows the records behind it.
`--ai` / `--ai-soft` are orange in light, warm charcoal and true black (6:1 or better on the wash); `--fact-soft` is neutral on purpose. Both styles share the look; radius, elevation and density come from tokens.

**Exports** use the same words. `buildProvenanceExport` writes `[SOURCE]`, `[AI SUMMARY]` and `[SUGGESTION]` headings with a one-line key and the sources of each AI block (chat answers and pre-call briefs have a Download action). The source-row CSV has a `kind` column. `@media print` keeps the wash and the dashed outline (`print-color-adjust: exact`) and avoids splitting a block across pages.

New AI surface? Use `AiSummary` with `citations`; do not hand-roll a tinted card.

## Navigation and chat

A collapsible left sidebar: icons only when collapsed, a slide-over sheet in iPad portrait.
The AI chat is a slide-in right panel that keeps the current filters as context, and a full-screen sheet in iPad portrait.

## Icons, empty states, brand

- Icons: Lucide, one stroke weight (1.75), 16px inline and 20px in tiles. No emoji or glyphs as icons.
- Empty states and onboarding: a small 3D or illustrated scene, helpful copy, and one next action.
- Brand: the name "MSL Agent" and a simple orange-600 mark.

## What ticket #45 built, and what follow-ups apply

Built here (foundation): style, mode and density tokens; the appearance provider with persona defaults and the settings control; Inter with tabular figures; motion primitives; the validated chart palette and shared chart components; the sonner toaster; the audit fixes and high-priority motion fixes.
Left to follow-up tickets, per-feature: the collapsible sidebar rebuild, the right-hand chat panel, empty-state scenes and onboarding, the brand mark, springy cards and parallax on landing scenes.

## Decisions recorded from the grilling

1. Two styles through tokens; persona defaults; user can switch.
2. Light, warm charcoal around `#1C1917`, true black; follow-device maps to charcoal.
3. Density adapts by device: comfortable on iPad, compact on desktop.
4. Inter with tabular numbers.
5. Motion: purposeful base plus expressive delight; always fast, never distracting; reduced motion honoured.
6. AI content: sparkle badge, soft orange card, visible citations; dashed outline for suggestions; facts plain.
7. Collapsible left sidebar; slide-in right chat panel keeping filters; sheets in iPad portrait.
8. Icons: Lucide, consistent.
9. Empty states: small 3D or illustrated scenes with copy and a next action.
10. Brand: "MSL Agent" plus a simple orange-600 mark.
11. No sign-off gate: applied and merged; the captain reviews the before/after report later.
