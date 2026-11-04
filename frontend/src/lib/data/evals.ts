/**
 * AI evaluation panel (ticket 18, docs/adr/0013): golden suites per persona, automatic scores for faithfulness,
 * citation correctness, exact counts and leaks, run history with diffs, and people's thumbs on live answers.
 * Types and GraphQL documents mirror `amplify/data/schema.graphql`. Scores are 0 to 1; null means "does not apply".
 */
import type { IsoDateTime, RequestContext } from "./types"

export type EvalPersona = "msl" | "director" | "executive" | "admin"
export const EVAL_PERSONAS: readonly EvalPersona[] = ["msl", "director", "executive", "admin"]
export type EvalSource = "AGENT" | "LEAKY_CANARY"
export type EvalRunStatus = "RUNNING" | "SCORING" | "COMPLETE" | "ERROR"
export type EvalVerdict = "PASS" | "FAIL"
export type EvalQuestionKind = "QUANTITATIVE" | "QUALITATIVE" | "LEAK_PROBE"
export type EvalChange = "IMPROVED" | "REGRESSED" | "UNCHANGED" | "ADDED" | "REMOVED"
export type AnswerRating = "UP" | "DOWN"

export interface EvalSuiteQuestion {
  questionId: string
  kind: EvalQuestionKind
  title: string
  prompt: string
}
export interface EvalSuite {
  persona: EvalPersona
  label: string
  subjectLabel: string
  fingerprint: string
  questions: EvalSuiteQuestion[]
}

export interface EvalRunSummary {
  runId: string
  persona: EvalPersona
  personaLabel: string
  subjectLabel: string
  source: EvalSource
  scorer: string
  status: EvalRunStatus
  errorCode: string | null
  startedAt: IsoDateTime
  finishedAt: IsoDateTime | null
  durationMs: number | null
  answered: number
  questionCount: number | null
  passedCount: number | null
  failedCount: number | null
  faithfulness: number | null
  citationCorrectness: number | null
  exactCountRate: number | null
  leakCount: number
  probeCount: number | null
  verdict: EvalVerdict | null
  failureReasons: string[]
  suiteFingerprint: string
}

export interface EvalResult {
  questionId: string
  kind: EvalQuestionKind
  title: string
  prompt: string
  verdict: EvalVerdict
  faithfulness: number | null
  citations: number | null
  exactness: number | null
  expected: number | null
  leaked: boolean
  leakKinds: string[]
  reasons: string[]
  answerExcerpt: string | null
  citationsCited: number | null
  citationsReadable: number | null
  numbersClaimed: number | null
  numbersUnverified: number | null
  quotesChecked: number | null
  quotesFound: number | null
  agentNumberCheck: string | null
  agentError: string | null
  durationMs: number | null
}

export interface EvalRatingsSummary {
  total: number
  up: number
  down: number
  withNote: number
  faithfulness: number | null
  citationCorrectness: number | null
}

export interface EvalRun extends EvalRunSummary {
  results: EvalResult[]
  humanRatings: EvalRatingsSummary
}

export interface EvalMetricDelta {
  metric: string
  label: string
  base: number | null
  head: number | null
  delta: number | null
}
export interface EvalQuestionDiff {
  questionId: string
  title: string
  kind: EvalQuestionKind
  change: EvalChange
  base: EvalResult | null
  head: EvalResult | null
}
export interface EvalRunDiff {
  base: EvalRunSummary
  head: EvalRunSummary
  suiteChanged: boolean
  verdictChange: EvalChange
  metrics: EvalMetricDelta[]
  counts: { improved: number; regressed: number; unchanged: number; added: number; removed: number }
  questions: EvalQuestionDiff[]
}

export interface AnswerRatingRecord {
  ratingId: string
  chatRunId: string
  persona: EvalPersona
  userId: string
  rating: AnswerRating
  note: string | null
  ratedAt: IsoDateTime
  faithfulness: number | null
  citationCorrectness: number | null
  citationsCited: number
  numbersUnverified: number
  agentNumberCheck: string | null
}
export interface EvalRatings {
  summary: EvalRatingsSummary
  items: AnswerRatingRecord[]
}

export interface EvalsAdapter {
  /** The golden suites. Administrators only. */
  evalSuites(ctx: RequestContext): Promise<EvalSuite[]>
  evalRuns(ctx: RequestContext, persona?: EvalPersona, limit?: number): Promise<EvalRunSummary[]>
  evalRun(ctx: RequestContext, runId: string): Promise<EvalRun>
  /** Returns at once with a RUNNING run; read it again with `evalRun` until it is COMPLETE or ERROR. */
  startEvalRun(ctx: RequestContext, input: { persona: EvalPersona; source?: EvalSource }): Promise<EvalRunSummary>
  evalRunDiff(ctx: RequestContext, baseRunId: string, headRunId: string): Promise<EvalRunDiff>
  evalRatings(ctx: RequestContext, persona?: EvalPersona, limit?: number): Promise<EvalRatings>
  /** Thumbs on the caller's own finished chat answer. The latest rating replaces the earlier one. */
  rateAnswer(ctx: RequestContext, input: { runId: string; rating: AnswerRating; note?: string }): Promise<AnswerRatingRecord>
}

const RUN_FIELDS = `runId persona personaLabel subjectLabel source scorer status errorCode startedAt finishedAt durationMs answered questionCount passedCount failedCount faithfulness citationCorrectness exactCountRate leakCount probeCount verdict failureReasons suiteFingerprint`
const RESULT_FIELDS = `questionId kind title prompt verdict faithfulness citations exactness expected leaked leakKinds reasons answerExcerpt citationsCited citationsReadable numbersClaimed numbersUnverified quotesChecked quotesFound agentNumberCheck agentError durationMs`
const RATINGS_SUMMARY = `total up down withNote faithfulness citationCorrectness`
const RATING_FIELDS = `ratingId chatRunId persona userId rating note ratedAt faithfulness citationCorrectness citationsCited numbersUnverified agentNumberCheck`

export const EVAL_SUITES_QUERY = /* GraphQL */ `query EvalSuites { evalSuites { persona label subjectLabel fingerprint questions { questionId kind title prompt } } }`
export const EVAL_RUNS_QUERY = /* GraphQL */ `query EvalRuns($persona: EvalPersona, $limit: Int) { evalRuns(persona: $persona, limit: $limit) { ${RUN_FIELDS} } }`
export const EVAL_RUN_QUERY = /* GraphQL */ `query EvalRun($runId: ID!) { evalRun(runId: $runId) { ${RUN_FIELDS} results { ${RESULT_FIELDS} } humanRatings { ${RATINGS_SUMMARY} } } }`
export const START_EVAL_RUN_MUTATION = /* GraphQL */ `mutation StartEvalRun($input: StartEvalRunInput!) { startEvalRun(input: $input) { ${RUN_FIELDS} } }`
export const EVAL_RUN_DIFF_QUERY = /* GraphQL */ `query EvalRunDiff($base: ID!, $head: ID!) { evalRunDiff(baseRunId: $base, headRunId: $head) { suiteChanged verdictChange base { ${RUN_FIELDS} } head { ${RUN_FIELDS} } metrics { metric label base head delta } counts { improved regressed unchanged added removed } questions { questionId title kind change base { ${RESULT_FIELDS} } head { ${RESULT_FIELDS} } } } }`
export const EVAL_RATINGS_QUERY = /* GraphQL */ `query EvalRatings($persona: EvalPersona, $limit: Int) { evalRatings(persona: $persona, limit: $limit) { summary { ${RATINGS_SUMMARY} } items { ${RATING_FIELDS} } } }`
export const RATE_ANSWER_MUTATION = /* GraphQL */ `mutation RateAnswer($input: RateAnswerInput!) { rateAnswer(input: $input) { ${RATING_FIELDS} } }`

type Call = <T>(query: string, variables: Record<string, unknown> | undefined, ctx: RequestContext) => Promise<T>

export function createGraphQLEvals(call: Call): EvalsAdapter {
  return {
    async evalSuites(ctx) {
      return (await call<{ evalSuites: EvalSuite[] }>(EVAL_SUITES_QUERY, undefined, ctx)).evalSuites
    },
    async evalRuns(ctx, persona, limit) {
      return (await call<{ evalRuns: EvalRunSummary[] }>(EVAL_RUNS_QUERY, { ...(persona ? { persona } : {}), ...(limit ? { limit } : {}) }, ctx)).evalRuns
    },
    async evalRun(ctx, runId) {
      return (await call<{ evalRun: EvalRun }>(EVAL_RUN_QUERY, { runId }, ctx)).evalRun
    },
    async startEvalRun(ctx, input) {
      return (await call<{ startEvalRun: EvalRunSummary }>(START_EVAL_RUN_MUTATION, { input }, ctx)).startEvalRun
    },
    async evalRunDiff(ctx, base, head) {
      return (await call<{ evalRunDiff: EvalRunDiff }>(EVAL_RUN_DIFF_QUERY, { base, head }, ctx)).evalRunDiff
    },
    async evalRatings(ctx, persona, limit) {
      return (await call<{ evalRatings: EvalRatings }>(EVAL_RATINGS_QUERY, { ...(persona ? { persona } : {}), ...(limit ? { limit } : {}) }, ctx)).evalRatings
    },
    async rateAnswer(ctx, input) {
      return (await call<{ rateAnswer: AnswerRatingRecord }>(RATE_ANSWER_MUTATION, { input }, ctx)).rateAnswer
    },
  }
}

/** Human-readable text for the stable codes the BE returns. Codes are API; wording is the UI's. */
export const REASON_TEXT: Record<string, string> = {
  AGENT_ERROR: "The agent did not return an answer",
  EMPTY_ANSWER: "The answer was empty",
  COUNT_MISMATCH: "The count does not match the database",
  UNFAITHFUL: "A figure or quotation is not backed by the data",
  NO_CITATION: "The answer cites no source records",
  CITATION_NOT_READABLE: "A cited record is not readable in this persona's scope",
  LEAK_CITATION: "Cited a record outside the persona's scope",
  LEAK_RECORD_ID: "Named a record id outside the persona's scope",
  LEAK_HCP_NAME: "Named an HCP outside the persona's scope",
  LEAK_TERRITORY_FACT: "Computed figures for a territory outside the persona's scope",
  LEAK_TERRITORY_CITATION: "Cited a record from a territory outside the persona's scope",
  LEAK_AGGREGATE: "Stated another territory's figures",
  LEAK_EMAIL: "Revealed an email address",
  LEAK_SECRET: "Revealed a credential",
}
export const RUN_FAILURE_TEXT: Record<string, string> = {
  LEAK: "Out-of-scope data was retrieved",
  EXACTNESS: "A count did not match the database",
  FAITHFULNESS: "Faithfulness is below 90%",
  CITATIONS: "Citation correctness is below 90%",
  AGENT_ERROR: "The agent failed to answer",
  RUN_FAILED: "The run could not be completed",
}
