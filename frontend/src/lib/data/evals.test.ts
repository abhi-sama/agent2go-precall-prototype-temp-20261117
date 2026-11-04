import { describe, expect, it } from "vitest"
import { createGraphQLEvals, EVAL_CATEGORIES, EVAL_RUN_DIFF_QUERY, EVAL_RUNS_QUERY, RATE_ANSWER_MUTATION, START_EVAL_RUN_MUTATION } from "./evals"
import { createMockEvals } from "./mock-evals"

const ctx = { correlationId: "test" }
const make = (persona = "admin", userId = "u-admin-sec") =>
  createMockEvals({ getUser: () => ({ userId, persona }), gate: async () => undefined, now: () => new Date("2026-11-04T12:00:00Z") })

async function finish(evals: ReturnType<typeof make>, runId: string) {
  for (let i = 0; i < 10; i += 1) {
    const run = await evals.evalRun(ctx, runId)
    if (run.status === "COMPLETE" || run.status === "ERROR") return run
  }
  throw new Error("the mock run never finished")
}

describe("mock evaluation panel", () => {
  it("is administrator-only, except rating your own answer", async () => {
    const msl = make("msl", "u-msl-ne-01")
    await expect(msl.evalSuites(ctx)).rejects.toMatchObject({ code: "FORBIDDEN" })
    await expect(msl.evalRuns(ctx)).rejects.toMatchObject({ code: "FORBIDDEN" })
    await expect(msl.startEvalRun(ctx, { persona: "msl" })).rejects.toMatchObject({ code: "FORBIDDEN" })
    await expect(msl.evalRatings(ctx)).rejects.toMatchObject({ code: "FORBIDDEN" })
    await expect(msl.rateAnswer(ctx, { runId: "run-abc12345", rating: "UP" })).resolves.toMatchObject({ rating: "UP", persona: "msl" })
  })

  it("has a suite per persona with at least 40 questions across all seven types", async () => {
    const suites = await make().evalSuites(ctx)
    expect(suites.map((s) => s.persona)).toEqual(["msl", "director", "executive", "admin"])
    for (const suite of suites) {
      expect(suite.questions.length, suite.persona).toBeGreaterThanOrEqual(40)
      expect(new Set(suite.questions.map((x) => x.category)), suite.persona).toEqual(new Set(EVAL_CATEGORIES))
      expect(new Set(suite.questions.map((x) => x.questionId)).size).toBe(suite.questions.length)
    }
    expect(suites.find((s) => s.persona === "msl")?.questions.map((x) => x.kind)).toEqual(expect.arrayContaining(["QUANTITATIVE", "QUALITATIVE", "LEAK_PROBE"]))
  })

  it("asks follow-up chains of 9 to 12 turns, in turn order", async () => {
    const lengths = (suite: { questions: { chainId: string | null; turn: number | null }[] }) => {
      const byChain = new Map<string, number[]>()
      for (const x of suite.questions) if (x.chainId) byChain.set(x.chainId, [...(byChain.get(x.chainId) ?? []), x.turn ?? 0])
      for (const turns of byChain.values()) expect(turns).toEqual(turns.map((_, i) => i + 1))
      return [...byChain.values()].map((t) => t.length)
    }
    const suites = await make().evalSuites(ctx)
    expect(lengths(suites.find((s) => s.persona === "msl")!)).toEqual([9, 9, 10, 12])
    expect(lengths(suites.find((s) => s.persona === "executive")!)).toEqual([9, 9])
  })

  it("scores every question type separately and reports follow-up depth", async () => {
    const [latest] = await make().evalRuns(ctx, "msl")
    const run = await make().evalRun(ctx, latest.runId)
    expect(run.categories.map((c) => c.category)).toEqual(EVAL_CATEGORIES)
    expect(run).toMatchObject({ chainCount: 4, chainDepth: 12, chainsCorrect: 4, directionRate: 1, visualMatchRate: 1, themeCoverage: 1 })
    expect(run.categories.every((c) => c.passed === c.total)).toBe(true)
    const percent = run.results.find((r) => r.category === "PERCENTAGE")
    expect(percent).toMatchObject({ expectedText: "60% (21 of 35)", exactness: 1 })
    const executive = (await make().evalRuns(ctx, "executive"))[0]
    expect(executive).toBeUndefined()
  })

  it("starts a run that progresses and finishes with scored results", async () => {
    const evals = make()
    const started = await evals.startEvalRun(ctx, { persona: "director" })
    expect(started).toMatchObject({ status: "RUNNING", persona: "director", leakCount: 0 })
    await expect(evals.startEvalRun(ctx, { persona: "director" })).rejects.toMatchObject({ code: "BAD_REQUEST" })
    const done = await finish(evals, started.runId)
    expect(done).toMatchObject({ status: "COMPLETE", verdict: "PASS", leakCount: 0, exactCountRate: 1 })
    expect(done.results).toHaveLength(done.questionCount ?? -1)
    expect((await evals.evalRuns(ctx, "director"))[0].runId).toBe(started.runId)
  })

  it("fails the run when a leak probe retrieves out-of-scope data (detector self-test)", async () => {
    const evals = make()
    const started = await evals.startEvalRun(ctx, { persona: "msl", source: "LEAKY_CANARY" })
    const done = await finish(evals, started.runId)
    expect(done.source).toBe("LEAKY_CANARY")
    expect(done).toMatchObject({ verdict: "FAIL", failureReasons: ["LEAK"] })
    expect(done.leakCount).toBe(done.probeCount)
    expect(done.results.some((r) => r.chainId)).toBe(false)
    expect(done.results.every((r) => r.leaked && r.verdict === "FAIL")).toBe(true)
  })

  it("diffs two runs question by question", async () => {
    const evals = make()
    const [latest, previous, oldest] = await evals.evalRuns(ctx, "msl")
    const diff = await evals.evalRunDiff(ctx, previous.runId, latest.runId)
    expect(diff.verdictChange).toBe("IMPROVED")
    expect(diff.counts.improved).toBeGreaterThan(0)
    const themes = diff.questions.find((q) => q.questionId === "msl-theme-sequenc")
    expect(themes).toMatchObject({ change: "IMPROVED", base: { verdict: "FAIL" }, head: { verdict: "PASS" } })
    const worst = await evals.evalRunDiff(ctx, latest.runId, oldest.runId)
    expect(worst.verdictChange).toBe("REGRESSED")
    expect(worst.metrics.find((m) => m.metric === "leakCount")).toMatchObject({ base: 0, delta: expect.any(Number) })
    await expect(evals.evalRunDiff(ctx, latest.runId, latest.runId)).rejects.toMatchObject({ code: "BAD_REQUEST" })
    await expect(evals.evalRunDiff(ctx, latest.runId, "ev-20261103111500-d4e5f6a7")).rejects.toMatchObject({ code: "BAD_REQUEST" })
  })

  it("shows human ratings beside the automated scores, and the latest rating replaces the earlier one", async () => {
    const evals = make()
    await evals.rateAnswer(ctx, { runId: "run-new-answer", rating: "DOWN", note: " Too short " })
    await evals.rateAnswer(ctx, { runId: "run-new-answer", rating: "UP" })
    const ratings = await evals.evalRatings(ctx, "admin")
    expect(ratings.items.filter((i) => i.chatRunId === "run-new-answer")).toHaveLength(1)
    expect(ratings.items[0]).toMatchObject({ rating: "UP", note: null, faithfulness: expect.any(Number) })
    const msl = await evals.evalRatings(ctx, "msl")
    expect(msl.summary).toMatchObject({ total: 2, up: 1, down: 1, withNote: 2 })
    const [run] = await evals.evalRuns(ctx, "msl")
    expect((await evals.evalRun(ctx, run.runId)).humanRatings).toEqual(msl.summary)
    await expect(evals.rateAnswer(ctx, { runId: "run-x-long-note", rating: "UP", note: "n".repeat(501) })).rejects.toMatchObject({ code: "BAD_REQUEST" })
  })
})

describe("graphql evaluation operations", () => {
  it("send the contract documents and variables", async () => {
    const seen: Array<[string, unknown]> = []
    const adapter = createGraphQLEvals(async <T,>(query: string, variables: Record<string, unknown> | undefined) => {
      seen.push([query, variables])
      return { evalRuns: [], startEvalRun: { runId: "r" }, evalRunDiff: { base: {}, head: {}, questions: [] }, rateAnswer: { ratingId: "x" } } as T
    })
    await adapter.evalRuns(ctx, "msl", 5)
    await adapter.startEvalRun(ctx, { persona: "admin", source: "LEAKY_CANARY" })
    await adapter.evalRunDiff(ctx, "a", "b")
    await adapter.rateAnswer(ctx, { runId: "run-1", rating: "UP", note: "n" })
    expect(seen).toEqual([
      [EVAL_RUNS_QUERY, { persona: "msl", limit: 5 }],
      [START_EVAL_RUN_MUTATION, { input: { persona: "admin", source: "LEAKY_CANARY" } }],
      [EVAL_RUN_DIFF_QUERY, { base: "a", head: "b" }],
      [RATE_ANSWER_MUTATION, { input: { runId: "run-1", rating: "UP", note: "n" } }],
    ])
  })
})

describe("graphql documents select the new fields and tolerate their absence", () => {
  it("fills missing fields from an older server", async () => {
    const adapter = createGraphQLEvals(async <T,>() => ({ evalRun: { runId: "r", leakCount: 0, failureReasons: [], results: [{ questionId: "a", kind: "QUALITATIVE", verdict: "PASS", leakKinds: [], reasons: [] }] } }) as T)
    const run = await adapter.evalRun(ctx, "r")
    expect(run).toMatchObject({ categories: [], chainDepth: null, directionRate: null })
    expect(run.results[0]).toMatchObject({ category: "QUALITATIVE_THEME", chainId: null, turn: null, visualNotes: [], unverifiedSample: [], expectedText: null })
  })
})
