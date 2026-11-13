import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { refineSurface, tableSurface } from "@/lib/data/mock-surfaces"
import {
  ANSWER_CATALOG_ID,
  COMPONENT_PROPERTIES,
  FUNCTIONS,
  adaptForSdk,
  describeAction,
  isAllowedAction,
  screenOperations,
  surfaceFromActivity,
  type A2uiOperation,
} from "./protocol"

/** The catalog document the agent's tests read too: one contract, two implementations. */
const CATALOG = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../../docs/a2ui/answer-catalog.json"), "utf8"))

const refine = refineSurface("refine_1_run-1", { metric: "calls", groupBy: "total", from: "2026-08-06", to: "2026-11-03", territoryId: "", executive: false }, ["NE-01"], "2026-11-03")
const table = tableSurface("themes_1_run-1", {
  title: "Recorded themes",
  caption: "2026-08-06 to 2026-11-03 · your scope",
  columns: [{ key: "theme", label: "Theme" }, { key: "latest", label: "Latest period", numeric: true }],
  rows: [{ theme: "Access and reimbursement", latest: 99 }],
})
const text = (overrides: Record<string, unknown>) => ({
  version: "1.0",
  createSurface: { surfaceId: "s_1", catalogId: ANSWER_CATALOG_ID, components: [{ id: "root", component: "Text", text: "Hi", ...overrides }] },
})
const activity = (operations: unknown[], extra: Record<string, unknown> = {}) => ({
  type: "ACTIVITY_SNAPSHOT",
  messageId: "a2ui-surface-s_1",
  activityType: "a2ui-surface",
  content: { a2ui_operations: operations },
  replace: true,
  ...extra,
})

describe("the answer catalog contract", () => {
  it("is the same list of components, properties and functions as docs/a2ui/answer-catalog.json", () => {
    expect(CATALOG.catalogId).toBe(ANSWER_CATALOG_ID)
    expect(CATALOG.protocolVersion).toBe("1.0")
    expect(Object.keys(CATALOG.components).sort()).toEqual(Object.keys(COMPONENT_PROPERTIES).sort())
    for (const [name, props] of Object.entries(COMPONENT_PROPERTIES)) {
      const spec = CATALOG.components[name]
      expect(props.filter((p) => p !== "@checks").sort(), name).toEqual(Object.keys(spec.properties).filter((p) => p !== "component").sort())
      expect(props.includes("@checks"), name).toBe("allOf" in spec)
    }
    expect([...FUNCTIONS].sort()).toEqual(Object.keys(CATALOG.functions).sort())
    // Nothing that loads a URL, plays media, renders markup or opens a link exists in this catalog.
    for (const banned of ["Image", "Video", "AudioPlayer", "Icon", "Modal", "TextField", "Surface"]) expect(CATALOG.components[banned]).toBeUndefined()
    expect(CATALOG.functions.openUrl).toBeUndefined()
  })
})

describe("screenOperations (the allow-list gate)", () => {
  it("keeps the agent's surfaces whole", () => {
    expect(screenOperations([refine])).toEqual([refine])
    expect(screenOperations([table])).toEqual([table])
    expect(screenOperations([{ version: "1.0", updateDataModel: { surfaceId: "s_1", path: "/rows", value: [] } }, { version: "1.0", deleteSurface: { surfaceId: "s_1" } }])).not.toBeNull()
  })

  it.each([
    ["a component outside the catalog", { version: "1.0", createSurface: { surfaceId: "s_1", catalogId: ANSWER_CATALOG_ID, components: [{ id: "root", component: "Image", url: "x" }] } }],
    ["an unknown property", text({ html: "<b>x</b>" })],
    ["a URL in text", text({ text: "Open https://evil.test" })],
    ["a javascript: URL", text({ text: "javascript:alert(1)" })],
    ["markup in text", text({ text: "<img src=x onerror=alert(1)>" })],
    ["a function outside the catalog", text({ text: { "@call": "openUrl", args: { url: "x" } } })],
    ["a malformed function call", text({ text: { "@call": 42 } })],
    ["the pre-1.0 call spelling of a function outside the catalog", text({ text: { call: "openUrl", args: { url: "x" } } })],
    ["more options than the catalog allows", { version: "1.0", createSurface: { surfaceId: "s_1", catalogId: ANSWER_CATALOG_ID, components: [{ id: "root", component: "ChoicePicker", label: "x", options: Array.from({ length: 32 }, (_, i) => ({ label: `o${i}`, value: `o${i}` })), value: [] }] } }],
    ["another catalog", { version: "1.0", createSurface: { surfaceId: "s_1", catalogId: "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json", components: [] } }],
    ["a v1.0 theme", { version: "1.0", createSurface: { surfaceId: "s_1", catalogId: ANSWER_CATALOG_ID, theme: { primaryColor: "#f00" } } }],
    ["sending the data model back", { version: "1.0", createSurface: { surfaceId: "s_1", catalogId: ANSWER_CATALOG_ID, sendDataModel: true } }],
    ["an older protocol", { version: "v0.9", createSurface: { surfaceId: "s_1", catalogId: ANSWER_CATALOG_ID } }],
    ["a renderer function call from the agent", { version: "1.0", callRendererFunction: { surfaceId: "s_1", functionCallId: "f", callFunction: { "@call": "required", catalogId: ANSWER_CATALOG_ID } } }],
    ["two messages in one envelope", { version: "1.0", createSurface: { surfaceId: "s_1", catalogId: ANSWER_CATALOG_ID }, deleteSurface: { surfaceId: "s_1" } }],
    ["a component id that is not an identifier", text({ id: "root-1" })],
    ["a malformed surface id", { version: "1.0", deleteSurface: { surfaceId: "../x" } }],
    ["a relative data path", { version: "1.0", updateDataModel: { surfaceId: "s_1", path: "rows", value: [] } }],
  ])("drops %s", (_, op) => {
    expect(screenOperations([op])).toBeNull()
    // One bad envelope drops the batch: a surface is never half-rendered.
    expect(screenOperations([refine, op])).toBeNull()
  })

  it("drops oversized surfaces and deeply nested values", () => {
    const many = Array.from({ length: 65 }, (_, i) => ({ id: `t${i}`, component: "Text", text: "x" }))
    expect(screenOperations([{ version: "1.0", createSurface: { surfaceId: "s_1", catalogId: ANSWER_CATALOG_ID, components: many } }])).toBeNull()
    let deep: unknown = "x"
    for (let i = 0; i < 20; i++) deep = { a: deep }
    expect(screenOperations([{ version: "1.0", updateDataModel: { surfaceId: "s_1", value: deep } }])).toBeNull()
    expect(screenOperations([])).toBeNull()
    expect(screenOperations("nope")).toBeNull()
  })
})

describe("surfaceFromActivity", () => {
  it("reads the AG-UI binding: an a2ui-surface activity snapshot with a2ui_operations", () => {
    const item = surfaceFromActivity(activity([refine]))
    expect(item).toMatchObject({ messageId: "a2ui-surface-s_1", surfaceId: "refine_1_run-1", slot: "follow_up" })
    expect(surfaceFromActivity(activity([table]))?.slot).toBe("evidence")
  })

  it("ignores other activities, rejected surfaces and activities that mix surfaces", () => {
    expect(surfaceFromActivity(activity([refine], { activityType: "plan" }))).toBeNull()
    expect(surfaceFromActivity({ ...activity([refine]), type: "CUSTOM" })).toBeNull()
    expect(surfaceFromActivity(activity([text({ text: "<script>" })]))).toBeNull()
    expect(surfaceFromActivity(activity([refine, table]))).toBeNull()
  })
})

describe("adaptForSdk", () => {
  it("renames the v1.0 envelope mixins to the names @a2ui/web_core 0.15.0 validates, and drops @metadata", () => {
    const [adapted] = [refine].map((op) => adaptForSdk(op as A2uiOperation))
    const to = (adapted.createSurface as { components: Record<string, unknown>[] }).components.find((c) => c.id === "to")!
    expect(to.checks).toHaveLength(2)
    expect("@checks" in to).toBe(false)
    const withA11y = adaptForSdk(text({ "@accessibility": { label: "Greeting" }, "@metadata": { extensions: {} } }) as A2uiOperation)
    const root = (withA11y.createSurface as { components: Record<string, unknown>[] }).components[0]
    expect(root).toEqual({ id: "root", component: "Text", text: "Hi", accessibility: { label: "Greeting" } })
  })

  it("hands the SDK a deep copy, so editing a form never changes the stored answer", () => {
    const adapted = adaptForSdk(refine as A2uiOperation)
    ;(adapted.createSurface as { dataModel: { to: string } }).dataModel.to = "2026-01-01"
    expect(refine.createSurface.dataModel.to).toBe("2026-11-03")
  })
})

describe("describeAction", () => {
  it("shows each choice by the label the form showed, never the raw value", () => {
    const action = {
      name: "refine_answer",
      surfaceId: "refine_1_run-1",
      sourceComponentId: "submit",
      timestamp: "2026-11-12T10:00:00.000Z",
      userMessage: "Update this answer",
      context: { measure: ["engaged_hcps"], group: ["month"], territory: ["NE-01"], from: "2026-09-01", to: "2026-10-31" },
    }
    expect(describeAction([refine as A2uiOperation], action)).toBe("Update this answer: Engaged HCPs · By month · NE-01 · From 2026-09-01 · To 2026-10-31")
    expect(describeAction([refine as A2uiOperation], { ...action, context: { ...action.context, territory: ["all"] } })).toContain("All of my scope")
  })

  it("lets only allow-listed, well-formed actions leave the browser", () => {
    const action = { name: "refine_answer", surfaceId: "refine_1_run-1", sourceComponentId: "submit", timestamp: "t", context: {} }
    expect(isAllowedAction(action)).toBe(true)
    expect(isAllowedAction({ ...action, name: "openUrl" })).toBe(false)
    expect(isAllowedAction({ ...action, surfaceId: "a b" })).toBe(false)
  })
})
