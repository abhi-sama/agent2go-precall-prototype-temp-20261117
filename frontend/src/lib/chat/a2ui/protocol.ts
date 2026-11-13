/**
 * A2UI v1.0 surfaces in chat answers (docs/adr/0017): the wire format and the allow-list gate.
 *
 * The agent streams a surface as the AG-UI binding for A2UI: an `ACTIVITY_SNAPSHOT` event with
 * `activityType: "a2ui-surface"` whose `content.a2ui_operations` holds v1.0 envelopes. Before anything reaches the
 * official renderer (`@a2ui/web_core` + `@a2ui/react`), {@link screenOperations} keeps only what the agent2go answer
 * catalog allows (docs/a2ui/answer-catalog.json): v1.0 `createSurface` / `updateComponents` / `updateDataModel` /
 * `deleteSurface` for that catalog, known components with known properties, known functions, and no URL or markup
 * anywhere. Everything else is dropped whole, so a malformed or hostile surface never renders half-way.
 *
 * Pure TypeScript with no renderer import, so it is unit-tested in node and costs nothing until a surface arrives.
 */

export const A2UI_VERSION = "1.0"
export const ANSWER_CATALOG_ID = "urn:agent2go:a2ui:answer-catalog:v1"
export const A2UI_ACTIVITY_TYPE = "a2ui-surface"
export const A2UI_OPERATIONS_KEY = "a2ui_operations"
/** Surface metadata extension that says where the answer shows the surface. */
export const SLOT_EXTENSION = "com_agent2go_slot"
/** The only agent actions the chat sends back. */
export const ACTIONS = ["refine_answer"] as const

export type SurfaceSlot = "evidence" | "follow_up"
export type A2uiOperation = Record<string, unknown> & { version: typeof A2UI_VERSION }

/** One surface in an answer: its operations, already screened, in arrival order. */
export interface SurfaceItem {
  /** The AG-UI activity id; a later snapshot with the same id replaces this one. */
  messageId: string
  surfaceId: string
  slot: SurfaceSlot
  operations: A2uiOperation[]
}

/** An A2UI v1.0 `action` message body, as the renderer resolves it. */
export interface SurfaceAction {
  name: string
  surfaceId: string
  sourceComponentId: string
  timestamp: string
  userMessage?: string
  context: Record<string, unknown>
}

/**
 * The catalog contract: each component and the properties it may carry (mirrors docs/a2ui/answer-catalog.json, which
 * `protocol.test.ts` checks). `@checks` and `@accessibility` are the v1.0 envelope mixins.
 */
export const COMPONENT_PROPERTIES: Readonly<Record<string, readonly string[]>> = {
  Card: ["child"],
  Column: ["children"],
  Row: ["children"],
  Text: ["text", "variant"],
  Table: ["caption", "columns", "rows"],
  Form: ["title", "description", "children"],
  ChoicePicker: ["label", "variant", "options", "value", "@checks"],
  DateTimeInput: ["label", "value", "enableDate", "min", "max", "@checks"],
  Button: ["label", "variant", "action", "@checks"],
}
export const FUNCTIONS: readonly string[] = ["required", "isOnOrBefore", "formatString", "and", "or", "not"]
const ENVELOPE = new Set(["id", "component", "@accessibility"])

const MAX_OPERATIONS = 8
const MAX_COMPONENTS = 64
/** The catalog's own size limits, checked here so a surface is dropped whole rather than rejected by the SDK. */
const MAX_OPTIONS = 31
const MAX_COLUMNS = 6
const MAX_OPERATION_CHARS = 32_000
const MAX_DEPTH = 12
const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const SURFACE_ID = /^[A-Za-z0-9_-]{1,96}$/
/** A URL scheme or a tag. No component in the catalog takes either, so neither has a reason to be on a surface. */
const UNSAFE_TEXT = /\b(?:javascript|data|vbscript|file|https?):|<\s*[a-z!/?]/i

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v)

function strings(value: unknown, depth = 0): string[] | null {
  if (depth > MAX_DEPTH) return null
  if (typeof value === "string") return [value]
  if (Array.isArray(value) || isObject(value)) {
    const out: string[] = []
    for (const [k, v] of Array.isArray(value) ? value.entries() : Object.entries(value)) {
      if (typeof k === "string") out.push(k)
      const inner = strings(v, depth + 1)
      if (!inner) return null
      out.push(...inner)
    }
    return out
  }
  return []
}

/** Every function a value invokes: v1.0 `@call`, and the pre-1.0 `call` the renderer SDK still accepts. */
function calls(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(calls)
  if (!isObject(value)) return []
  const own = (["@call", "call"] as const).filter((key) => key in value).map((key) => (typeof value[key] === "string" ? (value[key] as string) : "<invalid>"))
  return [...own, ...Object.values(value).flatMap(calls)]
}

function componentsOk(components: unknown): boolean {
  if (!Array.isArray(components) || components.length > MAX_COMPONENTS) return false
  const ids = new Set<string>()
  for (const c of components) {
    if (!isObject(c) || typeof c.id !== "string" || !IDENT.test(c.id) || ids.has(c.id)) return false
    ids.add(c.id)
    const allowed = typeof c.component === "string" ? COMPONENT_PROPERTIES[c.component] : undefined
    if (!allowed) return false
    if (!Object.keys(c).every((k) => ENVELOPE.has(k) || allowed.includes(k))) return false
    if ((Array.isArray(c.options) && c.options.length > MAX_OPTIONS) || (Array.isArray(c.columns) && c.columns.length > MAX_COLUMNS)) return false
  }
  return true
}

/** One envelope against the catalog, or null when it does not fit. */
function screenOne(op: unknown): A2uiOperation | null {
  if (!isObject(op) || op.version !== A2UI_VERSION) return null
  const keys = Object.keys(op).filter((k) => k !== "version")
  if (keys.length !== 1) return null
  const [kind] = keys
  const body = op[kind]
  if (!isObject(body) || typeof body.surfaceId !== "string" || !SURFACE_ID.test(body.surfaceId)) return null
  if (JSON.stringify(op).length > MAX_OPERATION_CHARS) return null
  const text = strings(body)
  if (!text || text.some((s) => UNSAFE_TEXT.test(s))) return null
  if (!calls(body).every((name) => FUNCTIONS.includes(name))) return null
  switch (kind) {
    case "createSurface":
      // No theme in v1.0, and the data model is never sent back to the agent.
      if (body.catalogId !== ANSWER_CATALOG_ID || "theme" in body || body.sendDataModel === true) return null
      if (body.components !== undefined && !componentsOk(body.components)) return null
      if (body.dataModel !== undefined && !isObject(body.dataModel)) return null
      return op as A2uiOperation
    case "updateComponents":
      return componentsOk(body.components) ? (op as A2uiOperation) : null
    case "updateDataModel":
      return body.path === undefined || (typeof body.path === "string" && body.path.startsWith("/")) ? (op as A2uiOperation) : null
    case "deleteSurface":
      return op as A2uiOperation
    default:
      // No renderer function calls from the agent (`callRendererFunction`) and no RPC responses: not in this chat.
      return null
  }
}

/**
 * Keep a batch of operations only if every one fits the catalog: one bad envelope drops the batch, because a surface
 * missing part of its definition would render something the agent did not send.
 */
export function screenOperations(operations: unknown): A2uiOperation[] | null {
  if (!Array.isArray(operations) || operations.length === 0 || operations.length > MAX_OPERATIONS) return null
  const out: A2uiOperation[] = []
  for (const op of operations) {
    const ok = screenOne(op)
    if (!ok) return null
    out.push(ok)
  }
  return out
}

const surfaceIdOf = (op: A2uiOperation): string | null => {
  for (const value of Object.values(op)) if (isObject(value) && typeof value.surfaceId === "string") return value.surfaceId
  return null
}

/** The surface an AG-UI `ACTIVITY_SNAPSHOT` event carries, screened; null for any other activity or a rejected one. */
export function surfaceFromActivity(event: Json): SurfaceItem | null {
  if (event.type !== "ACTIVITY_SNAPSHOT" || event.activityType !== A2UI_ACTIVITY_TYPE || typeof event.messageId !== "string") return null
  const content = isObject(event.content) ? event.content : null
  const operations = screenOperations(content?.[A2UI_OPERATIONS_KEY])
  if (!operations) return null
  const ids = new Set(operations.map(surfaceIdOf))
  if (ids.size !== 1) return null // one activity, one surface
  const [surfaceId] = ids
  const create = operations.find((op) => "createSurface" in op)?.createSurface
  const slot = isObject(create) && isObject(create.metadata) && isObject(create.metadata.extensions) ? create.metadata.extensions[SLOT_EXTENSION] : undefined
  return { messageId: event.messageId, surfaceId: surfaceId as string, slot: slot === "follow_up" ? "follow_up" : "evidence", operations }
}

/**
 * `@a2ui/web_core` 0.15.0 validates component envelope mixins under their pre-1.0 names (`checks`, `accessibility`) and
 * rejects the v1.0 `@`-prefixed keys the specification and our agent use. This renames them on the way into the SDK and
 * drops `@metadata` (unused here). Pinned to that SDK version; `catalog.test.ts` proves the round trip.
 *
 * The result is a deep copy: the SDK keeps and mutates the data model it is given as the person edits a form, and the
 * operations here are chat state (stored for the session), which must not change underneath React.
 */
export function adaptForSdk(original: A2uiOperation): A2uiOperation {
  const op = structuredClone(original)
  const adaptComponent = (c: unknown) => {
    if (!isObject(c)) return c
    const rest = Object.fromEntries(Object.entries(c).filter(([key]) => !key.startsWith("@")))
    const checks = c["@checks"]
    const accessibility = c["@accessibility"]
    return { ...rest, ...(checks !== undefined ? { checks } : {}), ...(accessibility !== undefined ? { accessibility } : {}) }
  }
  const out: Json = { ...op }
  for (const kind of ["createSurface", "updateComponents"] as const) {
    const body = op[kind]
    if (isObject(body) && Array.isArray(body.components)) out[kind] = { ...body, components: body.components.map(adaptComponent) }
  }
  return out as A2uiOperation
}

/**
 * The words the chat shows as the person's turn when they submit a surface: the action's own `userMessage`, then each
 * choice by the label the surface showed for it (never the raw value), in the order of the action's context.
 */
export function describeAction(operations: A2uiOperation[], action: SurfaceAction): string {
  const components = operations.flatMap((op) => {
    const body = (op.createSurface ?? op.updateComponents) as Json | undefined
    return Array.isArray(body?.components) ? (body.components.filter(isObject) as Json[]) : []
  })
  const source = components.find((c) => c.id === action.sourceComponentId)
  const event = isObject(source?.action) && isObject(source.action.event) ? source.action.event : null
  const bindings = isObject(event?.context) ? event.context : {}
  const parts: string[] = []
  for (const [key, binding] of Object.entries(bindings)) {
    const path = isObject(binding) && typeof binding["@path"] === "string" ? binding["@path"] : null
    const input = path ? components.find((c) => isObject(c.value) && c.value["@path"] === path) : undefined
    const value = action.context[key]
    const values = Array.isArray(value) ? value : [value]
    const options = Array.isArray(input?.options) ? (input.options.filter(isObject) as Json[]) : []
    const shown = values
      .map((v) => {
        const option = options.find((o) => o.value === v)
        return typeof option?.label === "string" ? option.label : typeof v === "string" ? v : ""
      })
      .filter(Boolean)
    if (shown.length) parts.push(input?.component === "DateTimeInput" && typeof input.label === "string" ? `${input.label} ${shown.join(", ")}` : shown.join(", "))
  }
  const lead = action.userMessage?.trim() || "Update this answer"
  return parts.length ? `${lead}: ${parts.join(" · ")}` : lead
}

/** Only well-formed actions on the allow-list leave the browser. */
export function isAllowedAction(action: SurfaceAction): boolean {
  return (ACTIONS as readonly string[]).includes(action.name) && SURFACE_ID.test(action.surfaceId) && IDENT.test(action.sourceComponentId)
}
