import type { DataAdapter } from "./adapter"
import { createMockAdapter } from "./mock-adapter"
import { DATA_ADAPTER } from "@/lib/env"

export type { DataAdapter } from "./adapter"
export * from "./types"

/**
 * THE swap point. The wiring worker replaces the `mock` branch result with
 * `createGraphQLAdapter(amplifyTransport)` (see graphql-adapter.ts); no UI code changes.
 */
export function createDefaultAdapter(getUserId: () => string): DataAdapter {
  if (DATA_ADAPTER !== "mock") {
    throw new Error(`NEXT_PUBLIC_DATA_ADAPTER="${DATA_ADAPTER}" has no adapter wired yet. Use "mock" locally.`)
  }
  return createMockAdapter({ getUserId })
}
