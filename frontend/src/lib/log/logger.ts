/**
 * Front-end structured logger (foundation contract):
 * JSON lines with `ts`, `level`, `msg`, `correlation_id`, `service`.
 *
 * Privacy is enforced by an ALLOWLIST, not a denylist: a field is emitted only if its key is in
 * ALLOWED_FIELDS and its value is a short scalar. Tokens, emails, names and HCP free text have no
 * key that passes, and string values are additionally scrubbed for token/email shapes.
 * Log ids, counts, durations and enums only. Never log user input or payload bodies.
 */

export type LogLevel = "debug" | "info" | "warn" | "error"
export type LogScalar = string | number | boolean | null
export type LogFields = Record<string, LogScalar | undefined>

export interface LogRecord {
  ts: string
  level: LogLevel
  msg: string
  correlation_id: string
  service: string
  [field: string]: LogScalar
}

export const SERVICE_NAME = "agent2go-frontend"

/** The only keys that may reach a log line. Extend deliberately, never with free-text keys. */
export const ALLOWED_FIELDS: ReadonlySet<string> = new Set([
  "route",
  "persona",
  "user_id",
  "territory_id",
  "operation",
  "status",
  "error_code",
  "duration_ms",
  "count",
  "kpi_distinct_calls",
  "kpi_distinct_hcps",
  "kpi_responses",
  "range_days",
  "theme",
  "renderer",
  "adapter",
  "scenario",
  "reduced_motion",
  "webgl",
  "stale",
])

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g
const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]*/g
const BEARER = /\b(bearer|basic)\s+[\w.~+/=-]+/gi
const MAX_VALUE_LENGTH = 120

export function scrubValue(value: LogScalar): LogScalar {
  if (typeof value !== "string") return value
  const scrubbed = value
    .replace(JWT, "[redacted]")
    .replace(BEARER, "[redacted]")
    .replace(EMAIL, "[redacted]")
  return scrubbed.length > MAX_VALUE_LENGTH ? `${scrubbed.slice(0, MAX_VALUE_LENGTH)}…` : scrubbed
}

export function sanitizeFields(fields: LogFields = {}): Record<string, LogScalar> {
  const out: Record<string, LogScalar> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || !ALLOWED_FIELDS.has(key)) continue
    out[key] = scrubValue(value)
  }
  return out
}

export type LogSink = (record: LogRecord) => void

const consoleSink: LogSink = (record) => {
  const line = JSON.stringify(record)
  switch (record.level) {
    case "error":
      console.error(line)
      break
    case "warn":
      console.warn(line)
      break
    case "debug":
      console.debug(line)
      break
    default:
      console.info(line)
  }
}

let sink: LogSink = consoleSink
let sessionCorrelationId: string | undefined

/** Replace the sink (tests, or a shipper once the foundation logging library lands). */
export function setLogSink(next: LogSink | null) {
  sink = next ?? consoleSink
}

export function newCorrelationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** One id per browser page load; per-operation ids come from `newCorrelationId()`. */
export function pageCorrelationId(): string {
  sessionCorrelationId ??= newCorrelationId()
  return sessionCorrelationId
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void
  info(msg: string, fields?: LogFields): void
  warn(msg: string, fields?: LogFields): void
  error(msg: string, fields?: LogFields): void
  child(correlationId: string): Logger
}

function emit(level: LogLevel, msg: string, correlationId: string, fields?: LogFields) {
  const record: LogRecord = {
    ts: new Date().toISOString(),
    level,
    msg: scrubValue(msg) as string,
    correlation_id: correlationId,
    service: SERVICE_NAME,
    ...sanitizeFields(fields),
  }
  sink(record)
}

export function createLogger(correlationId?: string): Logger {
  const id = () => correlationId ?? pageCorrelationId()
  return {
    debug: (msg, fields) => emit("debug", msg, id(), fields),
    info: (msg, fields) => emit("info", msg, id(), fields),
    warn: (msg, fields) => emit("warn", msg, id(), fields),
    error: (msg, fields) => emit("error", msg, id(), fields),
    child: (child) => createLogger(child),
  }
}

export const log = createLogger()
