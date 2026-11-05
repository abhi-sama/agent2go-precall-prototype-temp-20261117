"use client"

import * as React from "react"
import { log, newCorrelationId } from "@/lib/log/logger"
import { toDataError, type DataError, type RequestContext } from "./types"

export type QueryState<T> =
  | { status: "loading"; data?: undefined; error?: undefined }
  | { status: "success"; data: T; error?: undefined }
  | { status: "error"; data?: undefined; error: DataError }

type Settled<T> = { key: string; state: Exclude<QueryState<T>, { status: "loading" }> }

/**
 * Minimal fetch hook: one request per key change, stale responses dropped, explicit refetch.
 * Each fetch gets its own correlation id which is logged (ids only) and forwarded to the adapter.
 * "Loading" is derived (no settled result for the current key), so no state is set synchronously.
 */
export function useQuery<T>(
  operation: string,
  key: string,
  fetcher: (ctx: RequestContext) => Promise<T>,
  enabled = true,
): QueryState<T> & { refetch: () => void } {
  const [settled, setSettled] = React.useState<Settled<T> | null>(null)
  const [nonce, setNonce] = React.useState(0)
  const run = React.useEffectEvent(fetcher)
  const fullKey = `${key}#${nonce}`

  React.useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const correlationId = newCorrelationId()
    const started = performance.now()
    run({ correlationId })
      .then((data) => {
        if (cancelled) return
        log.child(correlationId).info("query ok", { operation, status: "ok", duration_ms: Math.round(performance.now() - started) })
        setSettled({ key: fullKey, state: { status: "success", data } })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const error = toDataError(err, correlationId)
        // A denied optional query is an expected part of aggregate-only pages, not a browser error.
        // Keep it traceable at warning level without turning a healthy Executive overview into a failed console audit.
        const logger = log.child(correlationId)
        const message = "query failed"
        const fields = {
          operation,
          status: "error",
          error_code: error.code,
          duration_ms: Math.round(performance.now() - started),
        }
        if (error.code === "FORBIDDEN") logger.warn(message, fields)
        else logger.error(message, fields)
        setSettled({ key: fullKey, state: { status: "error", error } })
      })
    return () => {
      cancelled = true
    }
  }, [operation, fullKey, enabled])

  const refetch = React.useCallback(() => setNonce((n) => n + 1), [])
  const state: QueryState<T> = settled && settled.key === fullKey ? settled.state : { status: "loading" }
  return { ...state, refetch } as QueryState<T> & { refetch: () => void }
}
