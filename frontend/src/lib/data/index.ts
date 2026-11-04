import type { DataAdapter } from "./adapter"
import { appsyncTransport } from "./appsync-transport"
import { createGraphQLAdapter } from "./graphql-adapter"
import { createMockAdapter } from "./mock-adapter"
import { DATA_ADAPTER } from "@/lib/env"

export type { DataAdapter } from "./adapter"
export * from "./types"

/**
 * THE swap point. `appsync` = FE AppSync -> BE Lambda -> RLS Postgres (the local floci stack
 * or AWS); `mock` = fixtures, for UI work without a backend.
 */
export function createDefaultAdapter(getUserId: () => string): DataAdapter {
  if (DATA_ADAPTER === "appsync") return createGraphQLAdapter(appsyncTransport)
  if (DATA_ADAPTER !== "mock") {
    throw new Error(`NEXT_PUBLIC_DATA_ADAPTER="${DATA_ADAPTER}" is not an adapter. Use "appsync" or "mock".`)
  }
  return createMockAdapter({ getUserId })
}
