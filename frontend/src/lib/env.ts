/**
 * Build-time flags. `NEXT_PUBLIC_*` values are inlined by Next, so a non-local production build
 * dead-code-eliminates everything gated on `IS_LOCAL_BUILD` (persona quick-switch, scenario forcing).
 */
export const IS_LOCAL_BUILD = process.env.NEXT_PUBLIC_APP_ENV === "local"
export const DATA_ADAPTER = process.env.NEXT_PUBLIC_DATA_ADAPTER ?? "mock"
