# UI libraries for large tables, the command menu, the task board and toasts

Chosen from the curated list behind the `pick-ui-library` skill (ticket #45, phase 1 step 3).
Nothing here changes the approved stack: Next.js, React, Tailwind, shadcn components on `@base-ui/react`, Recharts and ECharts.

## Decisions

| Need | Library | Why this one |
|---|---|---|
| Large tables and lists (~3k HCPs, ~25k call rows in evidence views) | `react-virtuoso` (`TableVirtuoso` for tables, `Virtuoso` for lists) | Handles variable row heights, sticky headers and window scrolling without manual measuring. Rendering 3k rows directly janks iPad Safari. |
| Command / search menu (⌘K, "jump to HCP, territory, question") | `cmdk` | Unstyled, keyboard-first, and already the base of shadcn's `Command`. Fits the Tailwind tokens. |
| Drag and drop for the follow-up task board | `@dnd-kit/core` + `@dnd-kit/sortable` (stable 6.x / 10.x) | Touch sensor with press delay, keyboard sensor, accessible announcements. The newer `@dnd-kit/react` is pre-1.0, so we do not build on it yet. |
| Toasts | `sonner` | One `<Toaster />` in the root layout, a `toast()` call anywhere, promise toasts, themed from our tokens. Toasts built by hand are rejected in review. |
| Charts | keep `recharts` + `echarts` (already installed) | Recharts for categorical and time-series charts, ECharts for heatmaps, geo and anything Recharts lacks. One chart system wraps both (see `docs/design/charts.md`). Liveline is for live-scrolling data; we have none. |
| Dialogs, popovers, menus, selects, tabs | keep `@base-ui/react` through the shadcn wrappers in `components/ui` | Already in place. No second primitive library. |
| Class names, variants, theme switching | keep `clsx`, `cva`, `tailwind-merge`, `next-themes` | Already in place. |

## Not adding

- `motion` (Framer Motion): CSS transitions, `tw-animate-css` and a CSS `linear()` spring (`--ease-spring`) cover the planned motions, including the expressive tier (see `docs/design/motion-plan.md`).
  Add it only for a layout or exit animation CSS cannot express, and record why in the ticket.
- `@number-flow/react`: `useCountUp` already animates the KPI figures and respects reduced motion.
- `zustand`: React context plus the data hooks cover shared state today. Revisit if a ticket needs cross-route client state (the offline queue is the likely one).

## When each is installed

Only `sonner` is installed with ticket #45, because the toaster is shared infrastructure every UI ticket uses.
`react-virtuoso`, `cmdk` and `@dnd-kit/*` are installed by the ticket that first uses them (HCP list, search menu, follow-up board), at the versions below or newer within the same major.

| Package | Version checked 2026-11-04 |
|---|---|
| `sonner` | 2.0.8 |
| `react-virtuoso` | 4.18.x |
| `cmdk` | 1.1.x |
| `@dnd-kit/core` | 6.3.x |
| `@dnd-kit/sortable` | 10.x |

## Rules for using them

- Virtualized lists keep every row at 44pt or taller and keep the header sticky; the selected row stays reachable by keyboard.
- The command menu searches only data the signed-in persona may see, through the same adapter calls as the rest of the app (ADR 0001, 0003).
- Drag handles need a keyboard alternative ("Move to…" menu) and a 44pt hit area; the press delay is 150ms so scrolling a touch screen never starts a drag.
- Toasts confirm an action that finished or report a failure with a retry. They never carry the only copy of an error, and never contain HCP free text, names or emails (logging rules).
