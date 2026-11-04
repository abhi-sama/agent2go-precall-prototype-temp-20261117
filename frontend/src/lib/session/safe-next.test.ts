import { describe, expect, it } from "vitest"
import { safeNext } from "./safe-next"

const ORIGIN = "http://localhost:3210"

describe("safeNext", () => {
  it("keeps same-origin paths with query and hash", () => {
    expect(safeNext("/director?x=1#k", ORIGIN)).toBe("/director?x=1#k")
  })

  it.each([
    "//evil.test/x",
    "/\\evil.test",
    "\\\\evil.test",
    "https://evil.test/",
    "javascript:alert(1)",
    "/%0a/evil.test",
    "/\u0000x",
    "/.//evil.test",
    "/a/..//evil.test",
    "/login",
    "",
    null,
  ])("rejects %s", (next) => {
    const out = safeNext(next, ORIGIN)
    if (out !== null) expect(new URL(out, ORIGIN).origin).toBe(ORIGIN)
    expect(out === null || !out.startsWith("//")).toBe(true)
    if (next !== "/%0a/evil.test") expect(out).toBeNull()
  })
})
