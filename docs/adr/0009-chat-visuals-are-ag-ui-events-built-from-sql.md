# Chat visuals are AG-UI events built from deterministic SQL

Ticket #30. A chat answer can carry a chart, heatmap, timeline, distribution or small table next to its text.

## The model chooses, the database counts

The agent has two chart tools, `show_chart` and `show_answer_distribution`.
The model picks a metric (calls, engaged HCPs, responses), a grouping (day, week, month, territory, product, call type, answer type, program), a chart type and a period, all from closed lists.
`chart_data.py` turns that choice into SQL, run as `app_user` under the caller's RLS session.
Nothing the model sends is interpolated into SQL: metric, grouping and answer type are looked up in whitelists, and dates, territory, product and topic are bound parameters.
The plotted values never pass through the model.
It reads back the same values as a compact summary so its prose can quote them, and `numbers.py` flags any figure it states that is not in a tool result.

A territory the caller cannot read gets the same fixed "outside your scope" answer as every other tool, and no visual.
Aggregate-only personas (Executive) get no visual from these tools, matching the record-level tools.

## The wire format

Visuals travel as `CUSTOM` AG-UI events named `visual`, through the same AppSync -> BE Lambda -> agent path and polled event log as the text (ADR 0007).
Two phases stream in order: `pending` (a place is reserved the moment the tool starts) and `ready` (the kind, title, period, scope, definition, data-through date and the values).
A tool that ends without a `ready` visual (refused, out of scope, no data) leaves no placeholder behind.
The event log needs no change: it stores any event as JSON.
The turn saved to FE DynamoDB carries its visuals, so history can redraw them (floats become `Decimal`).

## Rules for when a visual appears

- A plain count is already shown as key figures (the source-facts tiles, with a count-up).
- A trend, comparison, ranking, breakdown, distribution or table always gets a chart. The system prompt says so, and `intent.py` is a deterministic floor: if the model skipped the tool, the runtime runs the same chart query from the question's own words. In stub mode (no API key) the same floor runs up front.
- A purely qualitative question stays text, unless the model adds a small response-count chart (`show_chart` with `topic`).
- Heatmaps are limited to 13 month columns, tables to 16 time rows, daily timelines to 62 days; ranked groups are capped at 10 bars or 12 rows and say how many were left out.

## Drawing

The interface draws from the spec with the shared chart system in `frontend/src/components/charts/` (`Heatmap`, `DistributionBars`, the palette and sequential fill). Where it has no equivalent, chat adds ranked bars, a line chart with partial-period handling, an activity timeline and a data table in `charts/viz/`, built on the same palette.
All use the design tokens (`seriesColor`, `--border`, ...), tabular numbers and a single hue; a zero is a hatched, labelled cell, and a time bucket the period covers only in part is dashed and hollow and called partial.
Every chart has hover, tap and keyboard readouts, a table twin, a full-screen view, and entrance motion that respects reduced motion.
Targets are at least 44pt, and the e2e viewport matrix covers every size in `e2e/support/viewports.ts`.

## Testing

- `backend/agent/tests/test_visuals.py`: values against hand-written ground truth, scope, refusals, the floor, the number check.
- `backend/agent/tests/test_visuals_db.py`: against real Postgres, per persona, every chart shape recounted from raw rows in Python (set `A2G_AGENT_DB_URL` and `A2G_OWNER_DB_URL`; `test.sh` does).
- `tests/api/test_chat_visuals.py`: through AppSync as seeded personas, compared with owner-role SQL.
- `frontend/e2e/chat.spec.ts` and the `chat-visual-*` screens in `e2e/support/screens.ts`: rendering, interaction and layout at every viewport.
