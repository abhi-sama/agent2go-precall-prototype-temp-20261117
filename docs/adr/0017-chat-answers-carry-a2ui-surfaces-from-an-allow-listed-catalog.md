# Chat answers carry A2UI surfaces from an allow-listed catalog

An answer in Ask the agent can carry small declarative UI surfaces next to its text and charts: a table of recorded themes, and an **Adjust this answer** form that asks the agent again with a different measure, grouping, period or territory. They follow the [A2UI](https://a2ui.org/) protocol, version 1.0 (the current specification): the agent describes the UI as data, and the browser draws it with its own trusted components.

## The agent composes surfaces; the database counts

The model never writes a surface. The runtime (`backend/agent/src/msl_agent/a2ui.py`) builds each one from tool results, exactly as `visuals.py` builds charts (ADR 0009):

- **Recorded themes** (`get_topic_trends`, two or more themes): theme, latest and earlier response counts, and the rule's flag. For an Executive (`get_org_themes`), the same table across their explicit regions, with a withheld small group shown as the word *Withheld*, never a number or zero.
- **Adjust this answer** (after a count or a chart): pre-filled with what the answer covered. Measures and groupings come from closed lists; territories come from the caller's own scope read under RLS; an aggregate-only Executive gets measure, grouping (total, month, region, territory) and period, never a territory filter or rows.

Before a surface streams it must pass two checks, or it is dropped whole (the answer text still stands):

1. **The catalog contract**: only components, properties and functions declared in `docs/a2ui/answer-catalog.json`, unique identifier ids, a `root`, no URL and no markup anywhere.
2. **The number guard** (ADR 0007): every figure on the surface, numeric cell or digits in text, must be a figure a tool returned. Dates and identifiers are not figures, as in `numbers.py`.

Aggregate-only callers never get record-level UI: no record ids, names, quotations or Show rows on any surface.

## The wire format: AG-UI carries A2UI

Surfaces travel as the AG-UI binding for A2UI that the AG-UI A2UI middleware uses: an `ACTIVITY_SNAPSHOT` event with `activityType: "a2ui-surface"`, `messageId: "a2ui-surface-<surfaceId>"`, `replace: true`, and `content.a2ui_operations` holding v1.0 envelopes. Each surface is one `createSurface` carrying its `components` and `dataModel` (v1.0 single-message instantiation), with `metadata.extensions.com_agent2go_slot` saying where the answer shows it (`evidence` beside the charts, `follow_up` before the suggestions). The route is unchanged: browser → FE AppSync → BE Lambda → agent, events appended to `chat_run_events` and read with `chatEvents` (ADR 0001, ADR 0007). The event log stores any event as JSON, so it needed no change. The turn saved to FE DynamoDB carries its surfaces.

## The browser renders only the catalog

The frontend uses the official A2UI renderer: `@a2ui/web_core` (v1.0 message processing, data binding, `formatString`, checks, actions) and `@a2ui/react`, pinned to 0.15.0. The catalog (`frontend/src/lib/chat/a2ui/catalog.tsx`) implements each component with Astryx: `Card`, `Column`, `Row` (a grid that stacks when narrow), `Text` (plain text only), `Table` (a captioned table in its own focusable scroll region), `Form` (a collapsed, named `search` form), `ChoicePicker` (radios up to five options, a menu beyond), `DateTimeInput` (Astryx `DateInput`) and `Button`. Functions are `required`, `isOnOrBefore`, `formatString`, `and`, `or` and `not`, all renderer-only. There is no image, video, audio, icon path, link, Markdown, HTML or `openUrl`, so a surface cannot load or open anything.

Defence in depth, before the SDK sees anything: `frontend/src/lib/chat/a2ui/protocol.ts` screens every activity against the same contract (v1.0 only, this catalog only, known components and properties within the catalog's size limits, known functions under either the v1.0 `@call` or the pre-1.0 `call` spelling the SDK still accepts, no `callRendererFunction`, no `sendDataModel` or `theme`, no URL or markup, size and depth limits) and drops a batch whole if one envelope fails. The SDK's own schema validation then runs on what is left, and a surface it rejects is not shown. The renderer loads lazily in its own chunk with the first surface, browser-only (`next/dynamic`, `ssr: false`), because it defines custom elements when it loads.

`@a2ui/web_core` 0.15.0 validates the v1.0 component mixins under their pre-1.0 names (`checks`, `accessibility`), so `adaptForSdk` renames `@checks` and `@accessibility` on the way in and hands the SDK a deep copy (it mutates the data model as people edit). Delete the rename when the SDK accepts the v1.0 names.

## A user action is a question

Submitting the form produces an A2UI v1.0 `action` (`refine_answer`, the surface and component ids, a timestamp and the resolved context). The browser shows it as the person's next turn ("Update this answer: Engaged HCPs · By month · …", worded from the labels the form showed) and sends it with `startChatRun(…, action: ChatSurfaceActionInput)`, the same AppSync mutation as a typed question; there is no other route to the agent. The BE Lambda checks its shape (an allow-listed name, identifier ids, an ISO timestamp, a small context of short strings) and the chat worker relays it as `a2ui_action`. The agent validates every value against its closed lists (`parse_refine_action`), turns it into the question it stands for, and runs exactly that query as a deterministic tool call under the caller's RLS; the model then only words the answer (it is given no data tools for that turn). The usual checks apply because the action is now an ordinary question: a territory outside scope gets the fixed "outside this user's scope" answer before anything is read, and an Executive's request stays aggregate-only (and, as when typed, never a single day). The period limit is the read queries' own three years. An action that fails any check gets a fixed refusal and reads nothing. An action grants nothing a typed question would not.

## Testing

- `backend/agent/tests/test_a2ui.py`: emission per tool and persona, ground-truth table values, the catalog contract against `docs/a2ui/answer-catalog.json`, the number guard, aggregate-only surfaces, and actions (exact query, closed lists, out of scope, stub mode, no data tools for the model).
- `backend/lambdas/api/tests/test_chat_unit.py`: action shape checks and the worker relay.
- `frontend/src/lib/chat/a2ui/protocol.test.ts` and `catalog.test.ts`: the gate against hostile payloads, the catalog contract, and the official processor binding, checking and dispatching the agent's own surfaces.
- `frontend/e2e/a2ui-chat.spec.ts`: a count answer's form round trip, submit-time validation, the themes table in the panel (drawer or docked pane), and aggregate-only surfaces, on every iPad project and the MacBook sizes.
