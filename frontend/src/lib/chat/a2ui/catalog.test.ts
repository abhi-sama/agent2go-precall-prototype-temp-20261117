import { beforeAll, describe, expect, it } from "vitest"
import { ComponentContext, GenericBinder, MessageProcessor, type ActionPayload } from "@a2ui/web_core/v1_0"
import { refineSurface, tableSurface } from "@/lib/data/mock-surfaces"
import { ANSWER_CATALOG_ID, COMPONENT_PROPERTIES, FUNCTIONS, adaptForSdk, type A2uiOperation } from "./protocol"

// `@a2ui/react` declares its custom-element host class when it loads. The browser has HTMLElement; this node test
// only processes messages (nothing renders), so a bare stand-in is enough, and the catalog is imported after it.
let catalog: typeof import("./catalog")
beforeAll(async () => {
  const g = globalThis as Record<string, unknown>
  g.HTMLElement ??= class {}
  g.customElements ??= { get: () => undefined, define: () => undefined }
  catalog = await import("./catalog")
})

/** The official v1.0 processor, with only the answer catalog registered, exactly as the chat creates it. */
function processor(actions: ActionPayload[] = []) {
  return new MessageProcessor([catalog.answerCatalog], (a) => void actions.push(a), { version: "1.0", reportErrorsOnly: true })
}
const process = (p: ReturnType<typeof processor>, ops: unknown[]) => p.processMessagesWithErrors(ops.map((op) => adaptForSdk(op as A2uiOperation)))

const refine = refineSurface("refine_1_run-1", { metric: "calls", groupBy: "month", from: "2026-08-06", to: "2026-11-03", territoryId: "NE-01", executive: false }, ["NE-01"], "2026-11-03")
const table = tableSurface("themes_1_run-1", {
  title: "Recorded themes across your regions",
  caption: "Aggregate-only",
  columns: [{ key: "theme", label: "Theme" }, { key: "latest", label: "Latest period", numeric: true }, { key: "trend", label: "Trend" }],
  rows: [{ theme: "ctDNA monitoring", latest: 72, trend: "Rising" }, { theme: "Pulmonary surveillance", latest: "Withheld", trend: "Withheld" }],
})

describe("the answer catalog on the official renderer", () => {
  it("implements exactly the components and functions of the contract", () => {
    expect(catalog.answerCatalog.id).toBe(ANSWER_CATALOG_ID)
    expect(catalog.ANSWER_COMPONENTS.map((c) => c.name).sort()).toEqual(Object.keys(COMPONENT_PROPERTIES).sort())
    expect(catalog.ANSWER_FUNCTIONS.map((f) => f.name).sort()).toEqual([...FUNCTIONS].sort())
    expect(catalog.ANSWER_FUNCTIONS.every((f) => (f.allowedCallers ?? "rendererOnly") === "rendererOnly")).toBe(true)
  })

  it("accepts the agent's surfaces, v1.0 checks included, and builds their data models", () => {
    const p = processor()
    expect(process(p, [refine])).toEqual([])
    expect(process(p, [table])).toEqual([])
    expect([...p.getSurfaces().keys()]).toEqual(["refine_1_run-1", "themes_1_run-1"])
  })

  it("refuses what the catalog does not hold, even past the gate", () => {
    const p = processor()
    const errors = process(p, [
      { version: "1.0", createSurface: { surfaceId: "x_1", catalogId: "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json", components: [] } },
      { version: "1.0", createSurface: { surfaceId: "x_2", catalogId: ANSWER_CATALOG_ID, components: [{ id: "root", component: "Text", text: "x", markdown: true }] } },
      { version: "1.0", createSurface: { surfaceId: "x_3", catalogId: ANSWER_CATALOG_ID, components: [{ id: "root", component: "Table", caption: "c", columns: [{ key: "a", label: "A", href: "x" }], rows: [] }] } },
    ])
    expect(errors).toHaveLength(3)
    expect(errors.map((e) => (e as { error: { code: string } }).error.code)).toEqual(expect.arrayContaining(["VALIDATION_FAILED"]))
    expect(p.getSurfaces().has("x_1")).toBe(false)
  })

  it("binds every input to the data model and runs the v1.0 checks (the binder reads each prop's schema)", () => {
    const p = processor()
    process(p, [refine])
    const surface = p.getSurfaces().get("refine_1_run-1")!
    const props = (id: string) => {
      const schema = catalog.answerCatalog.components.get(surface.componentsModel.get(id)!.type)!.schema
      const binder = new GenericBinder(new ComponentContext(surface, id), schema)
      binder.subscribe(() => undefined) // the first subscriber connects it, as a rendered component does
      return binder.snapshot as Record<string, unknown>
    }
    expect(props("measure").value).toEqual(["calls"])
    expect(typeof props("measure").setValue).toBe("function")
    expect(props("to")).toMatchObject({ value: "2026-11-03", min: "2026-08-06", isValid: true })
    surface.dataModel.set("/to", "")
    expect(props("to")).toMatchObject({ isValid: false, validationErrors: ["Choose an end date."] })
    surface.dataModel.set("/to", "2026-08-01")
    expect(props("to")).toMatchObject({ isValid: false, validationErrors: ["Choose an end date on or after the start date."] })
  })

  it("dispatches the form's action with the values the person chose, resolved from the data model", async () => {
    const actions: ActionPayload[] = []
    const p = processor(actions)
    process(p, [refine])
    const surface = p.getSurfaces().get("refine_1_run-1")!
    surface.dataModel.set("/measure", ["engaged_hcps"])
    surface.dataModel.set("/from", "2026-09-01")
    const button = (refine.createSurface.components as { id: string; action?: unknown }[]).find((c) => c.id === "submit")!
    // What the binder does on a press: resolve the action's bindings against the data model, then dispatch it.
    const context = new ComponentContext(surface, "submit")
    await context.dispatchAction(context.dataContext.resolveAction(button.action as Record<string, unknown>, { userActivation: true }) as never)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      name: "refine_answer",
      surfaceId: "refine_1_run-1",
      sourceComponentId: "submit",
      userMessage: "Update this answer",
      context: { measure: ["engaged_hcps"], group: ["month"], territory: ["NE-01"], from: "2026-09-01", to: "2026-11-03" },
    })
  })
})
