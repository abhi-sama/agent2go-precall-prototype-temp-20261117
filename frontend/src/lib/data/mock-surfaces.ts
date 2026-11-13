/**
 * A2UI v1.0 surfaces for the mock chat adapter, in exactly the shape the agent streams (backend/agent/src/msl_agent/
 * a2ui.py): one `createSurface` per surface, carried by an AG-UI `ACTIVITY_SNAPSHOT` with `activityType: a2ui-surface`.
 * The values come from the same fixture arithmetic as the mock's key figures. `mock-surfaces.test.ts` checks every
 * surface here against the answer catalog and the allow-list gate.
 */
import { A2UI_ACTIVITY_TYPE, A2UI_OPERATIONS_KEY, A2UI_VERSION, ANSWER_CATALOG_ID, SLOT_EXTENSION, type SurfaceSlot } from "@/lib/chat/a2ui/protocol"

export const REFINE_ACTION = "refine_answer"
export const MEASURES = { calls: "Distinct calls", engaged_hcps: "Engaged HCPs", responses: "Insight responses" } as const
export const RECORD_GROUPS = { total: "Total only", month: "By month", week: "By week", territory: "By territory", product: "By product" } as const
export const EXECUTIVE_GROUPS = { total: "Total only", month: "By month", region: "By region", territory: "By territory" } as const
const ALL = "all"

export type Measure = keyof typeof MEASURES
export interface RefineRequest {
  metric: Measure
  groupBy: string
  from: string
  to: string
  territoryId: string
  executive: boolean
}

type Component = Record<string, unknown> & { id: string; component: string }

export function surfaceId(kind: string, runId: string, index: number): string {
  return `${kind}_${index}_${runId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "run"}`
}

function createSurface(sid: string, components: Component[], dataModel: Record<string, unknown>, slot: SurfaceSlot) {
  return {
    version: A2UI_VERSION,
    createSurface: { surfaceId: sid, catalogId: ANSWER_CATALOG_ID, components, dataModel, metadata: { extensions: { [SLOT_EXTENSION]: slot } } },
  }
}

/** The AG-UI event (JSON) that carries one surface. */
export function surfaceEvent(sid: string, operation: ReturnType<typeof createSurface>): string {
  return JSON.stringify({
    type: "ACTIVITY_SNAPSHOT",
    timestamp: Date.now(),
    messageId: `a2ui-surface-${sid}`,
    activityType: A2UI_ACTIVITY_TYPE,
    content: { [A2UI_OPERATIONS_KEY]: [operation] },
    replace: true,
  })
}

export function tableSurface(
  sid: string,
  input: { title: string; caption: string; columns: { key: string; label: string; numeric?: boolean }[]; rows: Record<string, string | number>[] },
) {
  return createSurface(
    sid,
    [
      { id: "root", component: "Card", child: "body" },
      { id: "body", component: "Column", children: ["title", "caption", "table"] },
      { id: "title", component: "Text", text: input.title, variant: "title" },
      { id: "caption", component: "Text", text: input.caption, variant: "caption" },
      { id: "table", component: "Table", caption: input.title, columns: input.columns, rows: { "@path": "/rows" } },
    ],
    { rows: input.rows.slice(0, 24) },
    "evidence",
  )
}

export function refineSurface(sid: string, request: RefineRequest, territories: string[], dataThrough: string | null) {
  const groups = request.executive ? EXECUTIVE_GROUPS : RECORD_GROUPS
  const fields = ["measure", "group", ...(request.executive ? [] : ["territory"]), "dates", "submit"]
  const components: Component[] = [
    { id: "root", component: "Card", child: "form" },
    {
      id: "form",
      component: "Form",
      title: "Adjust this answer",
      description: `Change the measure, grouping, period${request.executive ? "" : " or territory"}, then update. Counts come from database queries under your access.`,
      children: fields,
    },
    { id: "measure", component: "ChoicePicker", label: "Measure", variant: "mutuallyExclusive", options: Object.entries(MEASURES).map(([value, label]) => ({ label, value })), value: { "@path": "/measure" } },
    { id: "group", component: "ChoicePicker", label: "Grouping", variant: "mutuallyExclusive", options: Object.entries(groups).map(([value, label]) => ({ label, value })), value: { "@path": "/group" } },
    { id: "dates", component: "Row", children: ["from", "to"] },
    {
      id: "from",
      component: "DateTimeInput",
      label: "From",
      enableDate: true,
      value: { "@path": "/from" },
      max: { "@path": "/to" },
      "@checks": [{ condition: { "@call": "required", args: { value: { "@path": "/from" } } }, message: "Choose a start date." }],
    },
    {
      id: "to",
      component: "DateTimeInput",
      label: "To",
      enableDate: true,
      value: { "@path": "/to" },
      min: { "@path": "/from" },
      ...(dataThrough ? { max: dataThrough } : {}),
      "@checks": [
        { condition: { "@call": "required", args: { value: { "@path": "/to" } } }, message: "Choose an end date." },
        { condition: { "@call": "isOnOrBefore", args: { value: { "@path": "/from" }, limit: { "@path": "/to" } } }, message: "Choose an end date on or after the start date." },
      ],
    },
    {
      id: "submit",
      component: "Button",
      label: "Update answer",
      variant: "primary",
      action: {
        event: {
          name: REFINE_ACTION,
          userMessage: "Update this answer",
          context: {
            measure: { "@path": "/measure" },
            group: { "@path": "/group" },
            ...(request.executive ? {} : { territory: { "@path": "/territory" } }),
            from: { "@path": "/from" },
            to: { "@path": "/to" },
          },
        },
      },
    },
  ]
  if (!request.executive) {
    const options = [ALL, ...[...territories].sort().slice(0, 29)]
    if (request.territoryId && !options.includes(request.territoryId)) options.push(request.territoryId)
    components.splice(4, 0, {
      id: "territory",
      component: "ChoicePicker",
      label: "Territory",
      variant: "mutuallyExclusive",
      options: options.map((t) => ({ label: t === ALL ? "All of my scope" : t, value: t })),
      value: { "@path": "/territory" },
    })
  }
  return createSurface(
    sid,
    components,
    {
      measure: [request.metric],
      group: [request.groupBy],
      from: request.from,
      to: request.to,
      ...(request.executive ? {} : { territory: [request.territoryId || ALL] }),
    },
    "follow_up",
  )
}

const single = (value: unknown): string | null =>
  Array.isArray(value) && value.length === 1 && typeof value[0] === "string" ? value[0] : typeof value === "string" ? value : null
const ISO = /^\d{4}-\d{2}-\d{2}$/

/** The same closed-list validation the agent applies (a2ui.parse_refine_action), against the mock's own territories. */
export function parseRefineAction(name: string, context: Record<string, unknown>, executive: boolean): RefineRequest | null {
  if (name !== REFINE_ACTION) return null
  const allowed = new Set(["measure", "group", "from", "to", ...(executive ? [] : ["territory"])])
  if (!Object.keys(context).every((k) => allowed.has(k))) return null
  const metric = single(context.measure)
  const group = single(context.group)
  const has = (table: object, key: string | null) => key !== null && Object.prototype.hasOwnProperty.call(table, key)
  if (!has(MEASURES, metric) || !has(executive ? EXECUTIVE_GROUPS : RECORD_GROUPS, group)) return null
  const { from, to } = context
  if (typeof from !== "string" || typeof to !== "string" || !ISO.test(from) || !ISO.test(to) || from > to) return null
  // The agent's limits: the read queries' three years, and no single day for an aggregate-only Executive.
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 366 * 3 || (executive && from === to)) return null
  const territory = executive ? ALL : single(context.territory) || ALL
  if (territory !== ALL && !/^[A-Z]{2}-\d{2}$/.test(territory)) return null
  return { metric: metric as Measure, groupBy: group as string, from, to, territoryId: territory === ALL ? "" : territory, executive }
}

/** The question an adjustment stands for, worded as the agent words it. */
export function refineQuestion(r: RefineRequest): string {
  const measure = { calls: "calls", engaged_hcps: "engaged HCPs", responses: "insight responses" }[r.metric]
  const grouping = r.groupBy === "total" ? "in total" : `by ${r.groupBy}`
  return `How many ${measure} ${grouping}${r.territoryId ? ` in territory ${r.territoryId}` : ""} from ${r.from} to ${r.to}?`
}
