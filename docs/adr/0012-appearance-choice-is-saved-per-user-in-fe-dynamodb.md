# The appearance choice is saved per user in FE DynamoDB, through AppSync

A person's style (Warm or Clinical), mode (Device, Light, Warm charcoal, True black) and density are saved with them, not with the browser, so the choice follows them to another iPad or desktop (ticket #49).

## Path

Browser -> FE AppSync (`setAppearance`, `myAppearance`) -> BE API Lambda -> FE DynamoDB (ADR 0001, 0006). The Lambda takes the user id from the verified identity; the input has no user id, so nobody can read or write another person's choice. Values are validated in the Lambda (style `auto|warm|clinical`, mode `device|light|charcoal|black`, density `auto|comfortable|compact`); anything else is `BadRequest` and the old choice stays.

## Where it lives

One item in the existing owner-keyed table (`SavedViews`): partition `ownerUserId = <user id>`, sort `savedViewId = PREF#appearance`. A separate table would need a new role, CDK, infrastructure and compose changes for a few bytes per user; the table's access (the BE Lambda's role, owner-keyed) already fits. The `PREF#` prefix keeps the item out of the saved-view list (`savedViews` filters it), and the `PREF#` sort key can never collide with a saved view's UUID.

No item means the person never chose: `myAppearance` returns null and the client uses the persona defaults (MSL Warm; Director, Executive and Administrator Clinical). Selecting the "For my role" or "For my device" options saves `auto`, so a later change of persona default still reaches them.

## Applying it with no flash

The server copy cannot be read before first paint, so the browser keeps a copy (`localStorage["a2g.appearance"]`, tagged with the user id) and an inline boot script applies it before anything paints (`appearance-provider.tsx`). The server is the record: after sign-in the client loads it and overwrites the copy if it differs. A copy tagged with another user is ignored. A copy made before this ticket (no user id) is adopted and uploaded once. The cost: the first visit on a device with no copy shows the persona default until the saved choice arrives.

## Consequences

- The header theme button and the settings popover both go through the provider, so every change is saved.
- A failed save does not undo the change on this device; a toast says so, and the next change saves the full choice again (the whole choice is sent every time, newest wins).
- Local mock builds keep the saved choice in `localStorage["a2g.mock.appearance"]`, per user, so reload and "new device" behave as with the real store.
