import { describe, expect, it } from "vitest"
import { createFiguresStore } from "./page-figures"

describe("the figures store", () => {
  it("lists what is registered, in order, and forgets a figure when its tile goes", () => {
    const store = createFiguresStore()
    const heard: number[] = []
    store.subscribe(() => heard.push(store.snapshot().length))
    const a = store.register({ id: "a", label: "Calls", value: "1" })
    const b = store.register({ id: "b", label: "HCPs", value: "2" })
    expect(store.snapshot().map((f) => f.id)).toEqual(["a", "b"])
    a()
    expect(store.snapshot().map((f) => f.id)).toEqual(["b"])
    b()
    expect(store.snapshot()).toEqual([])
    expect(heard).toEqual([1, 2, 1, 0])
  })

  it("keeps the newer registration when an older one's cleanup runs late", () => {
    const store = createFiguresStore()
    const old = store.register({ id: "a", label: "Calls", value: "1" })
    store.register({ id: "a", label: "Calls", value: "2" })
    old()
    expect(store.snapshot()).toEqual([{ id: "a", label: "Calls", value: "2" }])
  })

  it("is stable between changes, so a reader does not re-render for nothing", () => {
    const store = createFiguresStore()
    store.register({ id: "a", label: "Calls", value: "1" })
    expect(store.snapshot()).toBe(store.snapshot())
  })
})
