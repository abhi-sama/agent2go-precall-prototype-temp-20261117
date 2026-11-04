import { afterEach, describe, expect, it } from "vitest"
import { createLogger, sanitizeFields, setLogSink, type LogRecord } from "./logger"

const records: LogRecord[] = []
setLogSink((r) => records.push(r))
afterEach(() => {
  records.length = 0
})

describe("logger", () => {
  it("emits the contract fields", () => {
    createLogger("corr-1").info("hello", { route: "/msl" })
    expect(Object.keys(records[0]).sort()).toEqual(["correlation_id", "level", "msg", "route", "service", "ts"])
    expect(records[0].correlation_id).toBe("corr-1")
    expect(records[0].service).toBe("agent2go-frontend")
  })

  it("drops every field that is not on the allowlist", () => {
    const out = sanitizeFields({
      email: "priya.raman@example.test",
      fullName: "Priya Raman",
      token: "abc",
      authorization: "Bearer xyz",
      hcp_note: "free text",
      count: 3,
    } as never)
    expect(out).toEqual({ count: 3 })
  })

  it("scrubs emails, JWTs and bearer tokens from allowed string fields and messages", () => {
    createLogger("c").error("failed for priya.raman@example.test", {
      error_code: "Bearer abc.def.ghi eyJhbGciOi.eyJzdWIi.sig",
      route: "/msl?x=a@b.co",
    })
    const line = JSON.stringify(records[0])
    expect(line).not.toMatch(/@example\.test|a@b\.co|eyJ|Bearer abc/)
    expect(line).toContain("[redacted]")
  })

  it("never logs a person's name even when passed under an allowed key's neighbour", () => {
    createLogger("c").info("x", { user_id: "u-msl-ne-01", full_name: "Priya Raman" } as never)
    expect(JSON.stringify(records[0])).not.toContain("Priya")
    expect(records[0].user_id).toBe("u-msl-ne-01")
  })
})
