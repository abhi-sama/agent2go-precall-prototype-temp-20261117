/**
 * Mock of the Director insights fields, shaped like the BE (backend/lambdas/api/src/a2g_api/director_insights.py).
 * Synthetic and deterministic: every number derives from the fixture territories, and the emerging-topic statuses
 * come from the same rule the database evaluates (`insight-rules.ts`). Nothing here is real data.
 */
import { addDays, daysInRange, todayIso, weekdaysInRange } from "@/lib/dates"
import {
  type DirectorDrilldown,
  type DirectorException,
  type DirectorExceptions,
  type DirectorInsightsAdapter,
  type DrillChild,
  type EmergingTopic,
  type EmergingTopics,
  type ExceptionCategory,
  type ExceptionCategoryCode,
  type HeatmapCell,
  type InsightEvidence,
  type QuestionAnalytics,
  type QuestionDetail,
  type QuestionOption,
  type ResponseBar,
  type SummaryTheme,
  type TerritorySummaries,
  type ThemeCard,
  type ThemeFacet,
  type TopicHeatmap,
  type WeekCount,
} from "./director-insights"
import { fixtureHash, REGIONS, TERRITORIES, type FixtureTerritory, type FixtureUser } from "./fixtures"
import { allocate, EMERGING_THRESHOLDS, emergingRuleText, emergingStatus } from "./insight-rules"
import { DataError, type DateRange, type InsightFilters, type IsoDate, type RequestContext } from "./types"

export const MOCK_INSIGHTS_VERSION = "director-insights-v1"
const MAX_WINDOW_DAYS = 366
const DEFAULT_WINDOW_DAYS = 90
const OTHER = "Other perspectives"
const STATEMENT =
  "These figures describe what recorded responses mention and how that changed between two equal periods. They do not say why, and a theme is a keyword grouping of free text, not a source fact."

interface ThemeDef {
  name: string
  /** Relative weight in the earlier and the latest period. A different pair is a planted shift. */
  prior: number
  current: number
  excerpts: [string, string, string]
  question: string
}

/** The 14 themes the database classifier produces, with the three planted emerging topics first. */
export const THEMES: ThemeDef[] = [
  { name: "ctDNA monitoring (emerging)", prior: 3, current: 10, question: "What are you watching for after the first scan?", excerpts: ["Asking more about ctDNA clearance as an early read, hard to get it paid for though.", "Liquid biopsy at 6 weeks is becoming routine for two of my partners.", "MRD-guided decisions came up again; they want to know what to do with a positive result."] },
  { name: "Pulmonary surveillance (emerging)", prior: 3.5, current: 7, question: "How do you monitor tolerability on treatment?", excerpts: ["Pneumonitis monitoring comes up at every tumor board now, CT every 6 weeks.", "Wants a clearer ILD workflow before starting anyone with prior lung disease.", "Pulmonary toxicity surveillance is the first question their nurses ask."] },
  { name: "Earlier-stage use (emerging)", prior: 7, current: 7, question: "Where could this fit earlier in the pathway?", excerpts: ["Curious about neoadjuvant data, none of the committee members had seen it yet.", "Perioperative setting is where the discussion is going, early-stage patients are the unmet need.", "Asked whether adjuvant use is on the horizon for fit patients."] },
  { name: "Access and reimbursement", prior: 14, current: 14, question: "What limits use in your practice?", excerpts: ["Prior auth takes about two weeks, denials mostly cite compendia only.", "Payer wants step therapy first; pharmacy appeals every time.", "Infusion chair capacity and buy-and-bill margin are the real barriers."] },
  { name: "Biomarker testing", prior: 13, current: 13, question: "How is testing handled today?", excerpts: ["NGS turnaround is still 10 days, so they start treatment before results.", "HER2-low IHC scoring varies between labs; reflex testing would help.", "PD-L1 testing is done on biopsy only, tissue is the bottleneck."] },
  { name: "Guidelines and pathways", prior: 5, current: 5, question: "What guides your recommendations?", excerpts: ["Follows NCCN closely and waits for the next update before changing practice.", "ESMO pathway came up as a reason to hold off on new sequencing.", "Local pathway committee meets quarterly, so change is slow."] },
  { name: "Trial design and evidence gaps", prior: 6, current: 6, question: "What would you want from the next study?", excerpts: ["Crossover in the comparator arm limits how they read the survival data.", "Wants subgroup data for older patients with comorbidities.", "Not enough head-to-head data to guide the choice."] },
  { name: "Safety and tolerability", prior: 10, current: 10, question: "What concerns you about tolerability?", excerpts: ["Nausea and neutropenia drive dose reductions in the first two cycles.", "Discontinuations from rash are higher than the label suggests in their clinic.", "Antiemetic plan is part of every start now."] },
  { name: "Treatment sequencing", prior: 6, current: 6, question: "Where does this sit in the sequence?", excerpts: ["Unsure what to use after progression on first line.", "Second line is where they use it most, third line rarely.", "Switch decisions depend on how fast the patient progressed."] },
  { name: "Competitor comparisons", prior: 3, current: 3, question: "How does this compare with alternatives?", excerpts: ["Compared it with the alternative antibody-drug conjugate in the last meeting.", "Colleagues prefer the other option for brain metastases.", "Versus oral agents, convenience is the deciding factor."] },
  { name: "Patient selection", prior: 6, current: 6, question: "Who is the right patient?", excerpts: ["Good performance status and no brain mets are the candidates today.", "Elderly or frail patients are the open question.", "Which patients benefit most is still unclear to them."] },
  { name: "Unmet need", prior: 2, current: 2, question: "What is still missing for your patients?", excerpts: ["Few options after resistance develops, quality of life matters.", "Limited options once they run out of targeted therapies.", "Unmet need is clearest in patients who cannot tolerate chemo."] },
  { name: "Efficacy and durability", prior: 7, current: 6, question: "What do you make of the data?", excerpts: ["Durable responses past two years change how they talk to patients.", "PFS benefit looks real but follow-up is still short.", "Results impress, they want mature overall survival."] },
  { name: OTHER, prior: 18, current: 18, question: "Anything else from the exchange?", excerpts: ["Mostly logistics for the next visit.", "Shared a personal view on conference timing.", "Asked to be sent the poster."] },
]

const THEME_INDEX = new Map(THEMES.map((t, i) => [t.name, i]))
const TERRITORY_INDEX = new Map(TERRITORIES.map((t, i) => [t.id, i]))
const pad = (n: number, width: number) => String(n).padStart(width, "0")

/** `RESP-5` + theme (2) + variant (1) + territory (2): a record id the mock can open again as a citation. */
export const evidenceId = (theme: string, variant: number, territoryId: string) =>
  `RESP-5${pad(THEME_INDEX.get(theme) ?? 0, 2)}${variant}${pad(TERRITORY_INDEX.get(territoryId) ?? 0, 2)}`

export function mockResponseRecord(recordId: string, range: DateRange): (InsightEvidence & { theme: string }) | null {
  const m = /^RESP-5(\d{2})(\d)(\d{2})$/.exec(recordId)
  if (!m) return null
  const theme = THEMES[Number(m[1])]
  const territory = TERRITORIES[Number(m[3])]
  const variant = Number(m[2])
  if (!theme || !territory || variant > 2) return null
  return {
    theme: theme.name,
    recordId,
    excerpt: theme.excerpts[variant],
    questionText: theme.question,
    interactionDate: addDays(range.to, -(variant * 4 + (Number(m[3]) % 5))),
    territoryId: territory.id,
  }
}

const evidenceFor = (theme: string, variant: number, territoryId: string, range: DateRange): InsightEvidence => {
  const def = THEMES[THEME_INDEX.get(theme) ?? 0]
  return {
    recordId: evidenceId(theme, variant, territoryId),
    excerpt: def.excerpts[variant],
    questionText: def.question,
    interactionDate: addDays(range.to, -(variant * 4 + ((TERRITORY_INDEX.get(territoryId) ?? 0) % 5))),
    territoryId,
  }
}

/** Territory metrics used for drill-down and summary figures (same arithmetic family as the overview mock). */
function metricsFor(t: FixtureTerritory, range: DateRange) {
  const calls = Math.round(t.callsPerWorkday * weekdaysInRange(range))
  const hcps = Math.min(t.hcpPool, Math.round(t.hcpPool * (1 - Math.exp(-calls / (t.hcpPool * 1.6)))))
  return { calls, hcps, responses: Math.round(calls * t.responsesPerCall) }
}

function priorOf(range: DateRange): DateRange {
  const days = daysInRange(range)
  return { from: addDays(range.from, -days), to: addDays(range.from, -1) }
}

interface TerritoryThemes {
  territory: FixtureTerritory
  current: Record<string, number>
  prior: Record<string, number>
  currentTotal: number
  priorTotal: number
}

/** Free-text theme counts for the window and the equal window before it. */
function themeModel(territories: FixtureTerritory[], range: DateRange): TerritoryThemes[] {
  const prior = priorOf(range)
  return territories.map((territory) => {
    const currentTotal = Math.round(territory.callsPerWorkday * weekdaysInRange(range) * 1.4)
    const priorTotal = Math.round(territory.callsPerWorkday * weekdaysInRange(prior) * 1.4 * (0.96 + 0.08 * fixtureHash(`${territory.id}:prior`)))
    const weights = (period: "prior" | "current") => THEMES.map((th) => th[period] * (0.75 + 0.5 * fixtureHash(`${territory.id}:${th.name}`)))
    const split = (total: number, period: "prior" | "current") => Object.fromEntries(THEMES.map((th, i) => [th.name, allocate(total, weights(period))[i]]))
    return { territory, currentTotal, priorTotal, current: split(currentTotal, "current"), prior: split(priorTotal, "prior") }
  })
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const share = (n: number, total: number) => (total ? Math.round((1000 * n) / total) / 10 : null)

function windowCheck(ctx: RequestContext, range: DateRange) {
  if (daysInRange(range) < 1 || daysInRange(range) > MAX_WINDOW_DAYS) throw new DataError("BAD_REQUEST", "That request was not accepted.", ctx.correlationId)
}

const FACET_VALUES: Record<Exclude<ThemeFacet, "NONE">, { label: string; values: [string, number][] }> = {
  MOLECULE: { label: "Molecule", values: [["trastuzumab deruxtecan", 0.34], ["osimertinib", 0.28], ["pembrolizumab", 0.22], ["sacituzumab govitecan", 0.16]] },
  TUMOR_TYPE: { label: "Tumor type", values: [["breast cancer", 0.34], ["non-small cell lung cancer", 0.28], ["gastric cancer", 0.22], ["urothelial cancer", 0.16]] },
  STUDY: { label: "Study", values: [["DESTINY-Breast06", 0.34], ["FLAURA2", 0.28], ["KEYNOTE-671", 0.22], ["TROPiCS-02", 0.16]] },
  SURVEY: { label: "Survey", values: [["MSL pulse", 0.82], ["Post-launch tracker", 0.18]] },
}

// --- questions ---------------------------------------------------------------------------------------------------
interface QuestionDef {
  id: string
  text: string
  type: string
  molecule: string | null
  parent: string | null
  base: number
  labels: string[]
  weights: number[]
  /** Select-all: each option has its own share of respondents. */
  multi?: boolean
  numeric?: { min: number; median: number; max: number }
  catalog: { status: string; tumorType: string; survey: string; study: string }
}

const catalogOf = (tumor: string, study: string) => ({ status: "Active", tumorType: tumor, survey: "MSL pulse", study })

export const QUESTIONS: QuestionDef[] = [
  { id: "Q-0002", text: "Where does osimertinib sit in your sequencing today?", type: "single_choice", molecule: "osimertinib", parent: null, base: 142, labels: ["Second line", "First line", "Not currently using", "Later line"], weights: [0.34, 0.29, 0.21, 0.16], catalog: catalogOf("non-small cell lung cancer", "FLAURA2") },
  { id: "Q-0005", text: "How confident are you in the evidence for earlier use? (1 to 5)", type: "likert_5", molecule: "trastuzumab deruxtecan", parent: null, base: 128, labels: ["1", "2", "3", "4", "5"], weights: [0.05, 0.14, 0.34, 0.31, 0.16], numeric: { min: 1, median: 3, max: 5 }, catalog: catalogOf("breast cancer", "DESTINY-Breast06") },
  { id: "Q-0013", text: "Have you started a patient on trastuzumab deruxtecan in the last month?", type: "yes_no", molecule: "trastuzumab deruxtecan", parent: null, base: 118, labels: ["Yes", "No", "Unsure"], weights: [0.5, 0.38, 0.12], catalog: catalogOf("breast cancer", "DESTINY-Breast06") },
  { id: "Q-0333", text: "What is the main barrier to starting patients on trastuzumab deruxtecan?", type: "single_choice", molecule: "trastuzumab deruxtecan", parent: "Q-0013", base: 59, labels: ["Cost / coverage", "Prior authorization burden", "Biomarker turnaround", "Patient selection"], weights: [0.36, 0.3, 0.2, 0.14], catalog: catalogOf("breast cancer", "DESTINY-Breast06") },
  { id: "Q-0127", text: "Which supportive measures do you use for immune-related adverse events? Select all that apply.", type: "multi_select", molecule: "pembrolizumab", parent: null, base: 96, labels: ["Patient education handout", "Dose reduction protocol", "Symptom triage line", "Steroid protocol", "Scheduled imaging"], weights: [0.68, 0.53, 0.44, 0.31, 0.22], multi: true, catalog: catalogOf("gastric cancer", "KEYNOTE-671") },
  { id: "Q-0017", text: "What stands out most from the latest data?", type: "open_text", molecule: "sacituzumab govitecan", parent: null, base: 88, labels: [], weights: [], catalog: catalogOf("urothelial cancer", "TROPiCS-02") },
  { id: "Q-0226", text: "Roughly how many patients per month would be candidates? (number)", type: "numeric", molecule: "osimertinib", parent: null, base: 74, labels: ["5 to 11", "12 to 18", "19 to 25", "26 to 32", "33 to 39"], weights: [0.22, 0.35, 0.24, 0.13, 0.06], numeric: { min: 5, median: 15, max: 35 }, catalog: catalogOf("non-small cell lung cancer", "FLAURA2") },
  { id: "Q-0237", text: "Rank what matters most when choosing a regimen.", type: "ranking", molecule: "pembrolizumab", parent: null, base: 66, labels: ["Ranked first: Efficacy", "Ranked first: Safety / tolerability", "Ranked first: Access / coverage", "Ranked first: Convenience"], weights: [0.5, 0.26, 0.17, 0.07], catalog: catalogOf("gastric cancer", "KEYNOTE-671") },
  { id: "Q-0100", text: "What is the main barrier to starting patients on sacituzumab govitecan?", type: "open_text", molecule: "sacituzumab govitecan", parent: "Q-NOT-IN-CATALOG", base: 31, labels: [], weights: [], catalog: catalogOf("urothelial cancer", "TROPiCS-02") },
]

// --- exceptions --------------------------------------------------------------------------------------------------
const CATEGORY_LABELS: Record<ExceptionCategoryCode, string> = {
  STALE_LOAD: "Stale or failed load",
  MISSING_JOIN: "Missing join",
  UNRESOLVED_IDENTITY: "Unresolved identity",
  DUPLICATE_KEY: "Duplicate key",
  STATUS_DIFFERENCE: "Status difference",
  MISSING_REPORTING: "Missing reporting",
}
const CATEGORY_RULES: Record<ExceptionCategoryCode, string> = {
  STALE_LOAD: "A source whose latest completed load is more than 30 days old, whose latest attempt failed, or that has no recorded load.",
  MISSING_JOIN: "Responses whose parent question is not in the catalog, and call-feed team members that match no roster member.",
  UNRESOLVED_IDENTITY: "Roster rows that share one login email, so the login cannot be matched to a single person, and HCP identifiers with no canonical HCP.",
  DUPLICATE_KEY: "Responses sharing one response key (uniq_rspns_id).",
  STATUS_DIFFERENCE: "Responses whose recorded question status differs from the catalog's status for that question.",
  MISSING_REPORTING: "Territory-months that data has reached with no recorded call.",
}

/** The HCP ids the drill-down lists: 40 per territory, in territory order, so `HCP-0001` is the first NE-01 HCP. */
const HCPS_PER_TERRITORY = 40
export function mockHcpTerritory(hcpId: string): string | null {
  const m = /^HCP-(\d{4})$/.exec(hcpId)
  if (!m) return null
  const n = Number(m[1])
  if (n < 1) return null
  return TERRITORIES[Math.floor((n - 1) / HCPS_PER_TERRITORY)]?.id ?? null
}

export interface MockInsightsOptions {
  getUser: () => FixtureUser
  gate: (ctx: RequestContext, operation: string) => Promise<unknown>
  now: () => Date
}

export function createMockDirectorInsights(options: MockInsightsOptions): DirectorInsightsAdapter {
  const forbidden = (ctx: RequestContext) => new DataError("FORBIDDEN", "You do not have access to this data.", ctx.correlationId)

  async function open(ctx: RequestContext, operation: string, range?: Partial<DateRange>) {
    const scenario = String(await options.gate(ctx, operation))
    const user = options.getUser()
    if (scenario === "forbidden" || (user.persona !== "director" && user.persona !== "admin")) throw forbidden(ctx)
    if (user.territoryIds.length === 0) throw new DataError("NO_SCOPE", "No territory is assigned to your account.", ctx.correlationId)
    const to = range?.to ?? todayIso(options.now())
    const resolved: DateRange = { from: range?.from ?? addDays(to, -(DEFAULT_WINDOW_DAYS - 1)), to }
    windowCheck(ctx, resolved)
    const base = options.now()
    const back = scenario === "stale" ? 9 : 1
    const dataThrough = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() - back, 5, 30)).toISOString()
    return {
      user,
      range: resolved,
      prior: priorOf(resolved),
      empty: scenario === "empty",
      dataThrough,
      territories: TERRITORIES.filter((t) => user.territoryIds.includes(t.id)),
    }
  }

  const modelOf = (c: Awaited<ReturnType<typeof open>>, filters?: InsightFilters): TerritoryThemes[] => {
    const scoped = filters?.territoryId ? c.territories.filter((t) => t.id === filters.territoryId) : c.territories
    return c.empty ? themeModel(scoped, c.range).map((m) => ({ ...m, currentTotal: 0, priorTotal: 0, current: {}, prior: {} })) : themeModel(scoped, c.range)
  }

  function scopeThemes(model: TerritoryThemes[]) {
    return THEMES.map((th) => ({
      theme: th.name,
      current: sum(model.map((m) => m.current[th.name] ?? 0)),
      prior: sum(model.map((m) => m.prior[th.name] ?? 0)),
    }))
  }

  return {
    async topicHeatmap(ctx, args) {
      const c = await open(ctx, "topicHeatmap", args?.range)
      const facet: ThemeFacet = args?.facet ?? "NONE"
      const model = modelOf(c, args?.filters)
      const totals = scopeThemes(model)
      const cells: HeatmapCell[] = []
      for (const m of model) {
        for (const th of THEMES) {
          const n = m.current[th.name] ?? 0
          if (n > 0) cells.push({ territoryId: m.territory.id, topic: th.name, responses: n, distinctHcps: Math.max(1, Math.round(n * 0.9)), share: share(n, m.currentTotal) ?? 0, territoryResponses: m.currentTotal })
        }
      }
      const topics = totals
        .filter((t) => t.current > 0)
        .map((t) => ({ topic: t.theme, responses: t.current, distinctHcps: Math.max(1, Math.round(t.current * 0.9)), isOther: t.theme === OTHER }))
        .sort((a, b) => Number(a.isOther) - Number(b.isOther) || b.responses - a.responses || a.topic.localeCompare(b.topic))
      const grandTotal = sum(model.map((m) => m.currentTotal))

      const cards: ThemeCard[] = []
      const bestTerritory = (theme: string) => [...model].sort((a, b) => (b.current[theme] ?? 0) - (a.current[theme] ?? 0))[0]?.territory.id ?? model[0]?.territory.id
      const cardFor = (facetValue: string | null, theme: string, n: number, facetTotal: number): ThemeCard => ({
        cardId: `${facet === "NONE" ? "ALL" : facet}:${facetValue ?? ""}:${theme}`,
        facetValue,
        topic: theme,
        responses: n,
        distinctHcps: Math.max(1, Math.round(n * 0.9)),
        territoryCount: model.filter((m) => (m.current[theme] ?? 0) > 0).length,
        share: share(n, facetTotal) ?? 0,
        facetResponses: facetTotal,
        evidence: [evidenceFor(theme, 0, bestTerritory(theme), c.range), evidenceFor(theme, 1, bestTerritory(theme), c.range)],
      })
      if (!c.empty && grandTotal > 0) {
        if (facet === "NONE") {
          for (const t of topics.slice(0, 8)) cards.push(cardFor(null, t.topic, t.responses, grandTotal))
        } else {
          for (const [value, w] of FACET_VALUES[facet].values.slice(0, 5)) {
            const facetTotal = Math.round(grandTotal * w)
            const parts = allocate(facetTotal, totals.map((t, i) => t.current * (0.8 + 0.4 * fixtureHash(`${value}:${t.theme}:${i}`))))
            const ranked = totals.map((t, i) => ({ theme: t.theme, n: parts[i] })).filter((t) => t.theme !== OTHER && t.n > 0).sort((a, b) => b.n - a.n || a.theme.localeCompare(b.theme)).slice(0, 3)
            for (const r of ranked) cards.push(cardFor(value, r.theme, r.n, facetTotal))
          }
        }
      }
      return {
        from: c.range.from,
        to: c.range.to,
        dataThrough: c.dataThrough,
        scopeLabel: c.user.scopeLabel,
        definitionVersion: MOCK_INSIGHTS_VERSION,
        facet,
        facetLabel: facet === "NONE" ? null : FACET_VALUES[facet].label,
        territories: model.map((m) => ({ territoryId: m.territory.id, name: m.territory.name, regionId: m.territory.regionId, regionName: REGIONS.find((r) => r.id === m.territory.regionId)?.name ?? m.territory.regionId, freeTextResponses: m.currentTotal })),
        topics,
        cells,
        themeCards: cards,
        freeTextResponses: grandTotal,
        note: "Themes group free-text answers by keywords. They are derived, not source facts; each card cites the responses behind it.",
      } satisfies TopicHeatmap
    },

    async emergingTopics(ctx, args) {
      const c = await open(ctx, "emergingTopics", args?.range)
      const model = modelOf(c, args?.filters)
      const totals = scopeThemes(model)
      const curTotal = sum(model.map((m) => m.currentTotal))
      const priTotal = sum(model.map((m) => m.priorTotal))
      // Weekly counts across both windows; the earlier window is flat, the latest ramps for any topic that grew.
      const weekStart = (d: IsoDate) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7))
      const weeks: IsoDate[] = []
      for (let w = weekStart(c.prior.from); w <= c.range.to; w = addDays(w, 7)) weeks.push(w)
      const topics: EmergingTopic[] = totals
        .filter((t) => t.current + t.prior > 0)
        .map((t) => {
          const status = emergingStatus(t.current, t.prior, curTotal, priTotal)
          const inCurrent = (w: IsoDate) => addDays(w, 6) >= c.range.from
          const ramp = status === "EMERGING"
          const cw = weeks.filter(inCurrent)
          const pw = weeks.filter((w) => !inCurrent(w))
          const cParts = allocate(t.current, cw.map((_, i) => (ramp ? 1 + i * 0.5 : 1) * (0.8 + 0.4 * fixtureHash(`${t.theme}:c${i}`))))
          const pParts = allocate(t.prior, pw.map((_, i) => 0.8 + 0.4 * fixtureHash(`${t.theme}:p${i}`)))
          const series: WeekCount[] = [...pw.map((w, i) => ({ weekStart: w, responses: pParts[i] })), ...cw.map((w, i) => ({ weekStart: w, responses: cParts[i] }))]
          const terr = [...model].sort((a, b) => (b.current[t.theme] ?? 0) - (a.current[t.theme] ?? 0))[0]?.territory.id ?? ""
          const cs = share(t.current, curTotal)
          const ps = share(t.prior, priTotal)
          return {
            territoryId: null,
            topic: t.theme,
            currentResponses: t.current,
            priorResponses: t.prior,
            currentTotal: curTotal,
            priorTotal: priTotal,
            currentShare: cs,
            priorShare: ps,
            sharePointChange: cs !== null && ps !== null ? Math.round((cs - ps) * 10) / 10 : null,
            status,
            weeks: series,
            evidence: status === "EMERGING" || status === "DECLINING" ? [evidenceFor(t.theme, 0, terr, c.range), evidenceFor(t.theme, 2, terr, c.range)] : [],
          }
        })
        .sort((a, b) => Number(b.status === "EMERGING") - Number(a.status === "EMERGING") || Number(b.status === "DECLINING") - Number(a.status === "DECLINING") || b.currentResponses - a.currentResponses || a.topic.localeCompare(b.topic))
      return {
        scopeLabel: c.user.scopeLabel,
        definitionVersion: MOCK_INSIGHTS_VERSION,
        dataThrough: c.dataThrough,
        current: { from: c.range.from, to: c.range.to, freeTextResponses: curTotal },
        prior: { from: c.prior.from, to: c.prior.to, freeTextResponses: priTotal },
        thresholds: { ...EMERGING_THRESHOLDS, rule: emergingRuleText() },
        sampleSufficient: curTotal >= EMERGING_THRESHOLDS.minWindowResponses && priTotal >= EMERGING_THRESHOLDS.minWindowResponses,
        topics,
        statement: STATEMENT,
      } satisfies EmergingTopics
    },

    async questionAnalytics(ctx, args) {
      const c = await open(ctx, "questionAnalytics", args?.range)
      const scale = c.empty ? 0 : (args?.filters?.territoryId ? 1 : c.territories.length) / 6
      const defs = QUESTIONS.filter((q) => !args?.filters?.molecule || q.molecule === args.filters.molecule)
      const options: QuestionOption[] = defs
        .map((q) => {
          const responses = Math.round(q.base * scale * (0.9 + 0.2 * fixtureHash(q.id)))
          return { questionId: q.id, questionText: q.text, questionType: q.type, parentQuestionId: q.parent, molecule: q.molecule, responses, distinctHcps: Math.max(0, Math.round(responses * 0.93)) }
        })
        .filter((o) => o.responses > 0)
        .sort((a, b) => b.responses - a.responses || a.questionId.localeCompare(b.questionId))
      const head = { scopeLabel: c.user.scopeLabel, definitionVersion: MOCK_INSIGHTS_VERSION, from: c.range.from, to: c.range.to, dataThrough: c.dataThrough, options }
      if (options.length === 0) return { ...head, selected: null } satisfies QuestionAnalytics
      const chosen = args?.questionId || options[0].questionId
      const option = options.find((o) => o.questionId === chosen)
      const def = QUESTIONS.find((q) => q.id === chosen)
      if (!option || !def) return { ...head, selected: null } satisfies QuestionAnalytics

      const n = option.responses
      let bars: ResponseBar[]
      let note = ""
      if (def.type === "open_text") {
        const themes = scopeThemes(modelOf(c, args?.filters)).filter((t) => t.current > 0)
        const parts = allocate(n, themes.map((t) => t.current))
        bars = themes.map((t, i) => ({ label: t.theme, responses: parts[i], distinctHcps: Math.max(0, Math.round(parts[i] * 0.93)), percentage: share(parts[i], n) ?? 0 })).filter((b) => b.responses > 0).sort((a, b) => b.responses - a.responses).slice(0, 8)
        note = "Free text is grouped into derived themes by keyword; each response counts in one theme."
      } else if (def.multi) {
        bars = def.labels.map((label, i) => {
          const r = Math.round(n * def.weights[i])
          return { label, responses: r, distinctHcps: Math.round(r * 0.95), percentage: share(r, n) ?? 0 }
        })
        note = "Select-all answers: a response counts once for each option chosen, so bars can add up to more than the denominator."
      } else {
        const parts = allocate(n, def.weights)
        bars = def.labels.map((label, i) => ({ label, responses: parts[i], distinctHcps: Math.round(parts[i] * 0.95), percentage: share(parts[i], n) ?? 0 }))
        if (def.type !== "likert_5" && def.type !== "numeric") bars.sort((a, b) => b.responses - a.responses)
        note = def.type === "ranking" ? "Rankings are shown by the option ranked first." : def.type === "numeric" ? "Numeric answers are grouped into at most five equal ranges." : ""
      }
      const tparts = allocate(n, c.territories.filter((t) => !args?.filters?.territoryId || t.id === args.filters.territoryId).map((t) => 0.6 + fixtureHash(`${def.id}:${t.id}`)))
      const territories = c.territories.filter((t) => !args?.filters?.territoryId || t.id === args.filters.territoryId).map((t, i) => ({ territoryId: t.id, responses: tparts[i], distinctHcps: Math.round(tparts[i] * 0.93) })).sort((a, b) => b.responses - a.responses || a.territoryId.localeCompare(b.territoryId))

      let parent: QuestionDetail["parent"] = null
      if (def.parent) {
        const known = QUESTIONS.find((q) => q.id === def.parent)
        if (known) {
          const asked = allocate(n, [0.72, 0.28])
          parent = {
            questionId: known.id,
            questionText: known.text,
            questionType: known.type,
            inCatalog: true,
            answerBreakdown: [{ answer: "No", responses: asked[0] }, { answer: "Unsure", responses: asked[1] }],
            note: "Parent answers come only from the same interactions as this follow-up.",
          }
        } else {
          parent = { questionId: def.parent, questionText: null, questionType: null, inCatalog: false, answerBreakdown: [], note: "This question names a parent that is not in the catalog, so its answers cannot be read in parent context." }
        }
      }
      const followUps = QUESTIONS.filter((q) => q.parent === def.id).map((q) => ({ questionId: q.id, questionText: q.text, responses: options.find((o) => o.questionId === q.id)?.responses ?? 0 }))
      const summary = def.numeric ? { ...def.numeric, answered: n } : null
      return {
        ...head,
        selected: { ...option, denominator: n, bars, barNote: note, territories, numericSummary: summary, parent, followUps, catalog: def.catalog },
      } satisfies QuestionAnalytics
    },

    async directorDrilldown(ctx, args) {
      const c = await open(ctx, "directorDrilldown", args?.range)
      const level = args?.level ?? "ROOT"
      const id = args?.id ?? ""
      const root = { level: "ROOT", id: "", label: c.user.scopeLabel }
      const metric = (t: FixtureTerritory) => (c.empty ? { calls: 0, hcps: 0, responses: 0 } : metricsFor(t, c.range))
      let children: DrillChild[] = []
      let total = 0
      let breadcrumb = [root]
      if (level === "ROOT") {
        const regions = [...new Set(c.territories.map((t) => t.regionId))]
        children = regions.map((rid) => {
          const ts = c.territories.filter((t) => t.regionId === rid)
          const ms = ts.map(metric)
          const hcps = Math.min(sum(ms.map((m) => m.hcps)), sum(ts.map((t) => t.hcpPool)))
          return { id: rid, label: REGIONS.find((r) => r.id === rid)?.name ?? rid, level: "REGION" as const, childLabel: "territories", childCount: ts.length, distinctCalls: sum(ms.map((m) => m.calls)), distinctEngagedHcps: hcps, responses: sum(ms.map((m) => m.responses)), lastInteractionDate: null }
        })
        total = children.length
      } else if (level === "REGION") {
        const ts = c.territories.filter((t) => t.regionId === id)
        // One answer for a region outside scope and one that does not exist.
        if (ts.length === 0) throw forbidden(ctx)
        breadcrumb = [root, { level: "REGION", id, label: REGIONS.find((r) => r.id === id)?.name ?? id }]
        children = ts.map((t) => {
          const m = metric(t)
          return { id: t.id, label: `${t.id} · ${t.name}`, level: "TERRITORY" as const, childLabel: "HCPs", childCount: m.hcps, distinctCalls: m.calls, distinctEngagedHcps: m.hcps, responses: m.responses, lastInteractionDate: null }
        })
        total = children.length
      } else {
        const t = c.territories.find((x) => x.id === id)
        if (!t) throw forbidden(ctx)
        breadcrumb = [root, { level: "REGION", id: t.regionId, label: REGIONS.find((r) => r.id === t.regionId)?.name ?? t.regionId }, { level: "TERRITORY", id: t.id, label: t.name }]
        const m = metric(t)
        total = m.hcps
        const base = (TERRITORY_INDEX.get(t.id) ?? 0) * HCPS_PER_TERRITORY
        const shown = c.empty ? 0 : Math.min(25, m.hcps, HCPS_PER_TERRITORY)
        children = Array.from({ length: shown }, (_, k) => {
          const hcpId = `HCP-${pad(base + k + 1, 4)}`
          const calls = 1 + Math.floor(fixtureHash(`${hcpId}:calls`) * 3)
          return { id: hcpId, label: `Synthetic HCP ${hcpId}`, level: "HCP" as const, childLabel: "interactions", childCount: calls, distinctCalls: calls, distinctEngagedHcps: 1, responses: 6 + Math.floor(fixtureHash(`${hcpId}:r`) * 14), lastInteractionDate: addDays(c.range.to, -Math.floor(fixtureHash(`${hcpId}:d`) * 30)) }
        })
      }
      return {
        level,
        id,
        scopeLabel: c.user.scopeLabel,
        from: c.range.from,
        to: c.range.to,
        dataThrough: c.dataThrough,
        breadcrumb,
        children,
        totalChildren: total,
        truncated: total > children.length,
        note: "Only regions, territories and HCPs inside your approved scope are listed. Interaction and response detail opens from an HCP.",
      } satisfies DirectorDrilldown
    },

    async directorExceptions(ctx, range) {
      const c = await open(ctx, "directorExceptions", range)
      const rows: DirectorException[] = []
      const row = (category: ExceptionCategoryCode, severity: DirectorException["severity"], exceptionId: string, title: string, detail: string, extra: Partial<DirectorException> = {}) =>
        rows.push({ exceptionId, category, categoryLabel: CATEGORY_LABELS[category], severity, title, detail, territoryId: null, affectedCount: 0, sourceTable: "", sampleRecordIds: [], rule: CATEGORY_RULES[category], ...extra })
      const stale = options.now().getTime() - 400 * 86_400_000
      row("STALE_LOAD", "high", "load:hcp-insights", "HCP Raw Insights: stale", `The latest completed load was on ${new Date(stale).toISOString().slice(0, 10)}, more than 30 days ago, so this source may be missing recent records.`, { sourceTable: "data_sources", sampleRecordIds: ["hcp-insights"] })
      row("STALE_LOAD", "high", "load:question-tag", "Question tag: failed", "The latest load attempt failed. Records from this source may be incomplete or out of date. No successful load is recorded.", { sourceTable: "data_sources", sampleRecordIds: ["question-tag"] })
      row("STALE_LOAD", "medium", "load:roster", "Medical roster: never loaded", "No load is recorded for this source, so its freshness cannot be confirmed.", { sourceTable: "data_sources", sampleRecordIds: ["roster"] })
      c.territories.forEach((t, i) => {
        const orphan = 4 + Math.floor(fixtureHash(`${t.id}:orphan`) * 6)
        row("MISSING_JOIN", "high", `orphan:${t.id}:Q-NOT-IN-CATALOG`, "Parent question Q-NOT-IN-CATALOG is not in the catalog", "These follow-up responses cannot be read in their parent question's context, because the parent question has no catalog entry.", { territoryId: t.id, affectedCount: orphan, sourceTable: "hcp_raw_insights", sampleRecordIds: [1, 2, 3].map((k) => `RESP-${pad(40000 + i * 97 + k * 13, 6)}`) })
        row("MISSING_JOIN", "medium", `roster-join:${t.id}`, "1 call-feed team member id(s) match no roster member", "Calls carry a team member id that is not on the medical roster, so completeness per person cannot be attributed. Nobody is marked as not reporting because of this.", { territoryId: t.id, affectedCount: 1, sourceTable: "call_activity", sampleRecordIds: [`REP-${t.id}`] })
        row("STATUS_DIFFERENCE", "medium", `status:${t.id}`, `${230 + Math.floor(fixtureHash(`${t.id}:s`) * 40)} responses carry a question status that differs from the catalog`, "Responses record status “Retired” for questions the catalog lists as “Active”. Both values are kept; an administrator reconciles them.", { territoryId: t.id, affectedCount: 230 + Math.floor(fixtureHash(`${t.id}:s`) * 40), sourceTable: "hcp_raw_insights", sampleRecordIds: ["Q-0004", "Q-0021", "Q-0066"] })
      })
      const first = c.territories[0]
      if (first) {
        row("UNRESOLVED_IDENTITY", "high", `roster-email:${first.id}:5001`, "2 roster rows share one login email", "The login cannot be matched to a single roster member until an administrator resolves which row is correct. Nothing is joined by guess.", { territoryId: first.id, affectedCount: 2, sourceTable: "medical_roster", sampleRecordIds: ["5001", "5002"] })
        row("DUPLICATE_KEY", "high", "dup:RESP-000001", "Response key RESP-000001 appears 2 times", "Two or more response rows share this key, so response counts use distinct keys and the rows need reconciling at source.", { affectedCount: 2, sourceTable: "hcp_raw_insights", sampleRecordIds: ["RESP-000001"] })
      }
      const order = { high: 0, medium: 1, low: 2 }
      rows.sort((a, b) => order[a.severity] - order[b.severity] || a.category.localeCompare(b.category) || (a.territoryId ?? "").localeCompare(b.territoryId ?? "") || a.exceptionId.localeCompare(b.exceptionId))
      const categories: ExceptionCategory[] = (Object.keys(CATEGORY_LABELS) as ExceptionCategoryCode[]).map((category) => ({ category, label: CATEGORY_LABELS[category], rule: CATEGORY_RULES[category], count: rows.filter((r) => r.category === category).length }))
      return {
        scopeLabel: c.user.scopeLabel,
        from: c.range.from,
        to: c.range.to,
        dataThrough: c.dataThrough,
        definitionVersion: MOCK_INSIGHTS_VERSION,
        categories,
        exceptions: rows,
        note: "Detected by fixed rules over the records in your scope. A finding says a join or load is missing, never that a person did something wrong.",
      } satisfies DirectorExceptions
    },

    async territorySummaryEvidence(ctx, range) {
      const c = await open(ctx, "territorySummaryEvidence", range)
      const model = modelOf(c)
      const territories = model.map((m) => {
        const mm = c.empty ? { calls: 0, hcps: 0, responses: 0 } : metricsFor(m.territory, c.range)
        const themes: SummaryTheme[] = THEMES.map((th) => {
          const cur = m.current[th.name] ?? 0
          const pri = m.prior[th.name] ?? 0
          return {
            topic: th.name,
            currentResponses: cur,
            priorResponses: pri,
            currentTotal: m.currentTotal,
            priorTotal: m.priorTotal,
            currentShare: share(cur, m.currentTotal),
            priorShare: share(pri, m.priorTotal),
            sharePointChange: share(cur, m.currentTotal) !== null && share(pri, m.priorTotal) !== null ? Math.round(((share(cur, m.currentTotal) ?? 0) - (share(pri, m.priorTotal) ?? 0)) * 10) / 10 : null,
            status: emergingStatus(cur, pri, m.currentTotal, m.priorTotal),
            evidence: cur > 0 ? [evidenceFor(th.name, 0, m.territory.id, c.range)] : [],
          }
        })
        const top = themes.filter((t) => t.topic !== OTHER && t.currentResponses > 0).sort((a, b) => b.currentResponses - a.currentResponses || a.topic.localeCompare(b.topic)).slice(0, 3)
        const flagged = themes.filter((t) => t.status === "EMERGING" || t.status === "DECLINING").map((t) => ({ topic: t.topic, status: t.status, currentResponses: t.currentResponses, priorResponses: t.priorResponses }))
        return { territoryId: m.territory.id, name: m.territory.name, regionId: m.territory.regionId, regionName: REGIONS.find((r) => r.id === m.territory.regionId)?.name ?? m.territory.regionId, distinctCalls: mm.calls, distinctEngagedHcps: mm.hcps, responses: mm.responses, freeTextResponses: m.currentTotal, priorFreeTextResponses: m.priorTotal, topThemes: top, flagged }
      })
      territories.sort((a, b) => b.flagged.length - a.flagged.length || b.responses - a.responses || a.territoryId.localeCompare(b.territoryId))
      return {
        scopeLabel: c.user.scopeLabel,
        definitionVersion: MOCK_INSIGHTS_VERSION,
        from: c.range.from,
        to: c.range.to,
        priorFrom: c.prior.from,
        priorTo: c.prior.to,
        dataThrough: c.dataThrough,
        territories,
        note: "These are the source figures and cited responses a summary is written from. The summary text itself is generated by AI.",
      } satisfies TerritorySummaries
    },
  }
}

/** What the mock agent says for an AI territory summary: only figures from the same evidence the panel shows. */
export function mockTerritorySummary(territoryId: string, range: DateRange) {
  const territory = TERRITORIES.find((t) => t.id === territoryId) ?? TERRITORIES[0]
  const [m] = themeModel([territory], range)
  const ranked = THEMES.filter((t) => t.name !== OTHER).map((t) => ({ name: t.name, cur: m.current[t.name] ?? 0, pri: m.prior[t.name] ?? 0 })).sort((a, b) => b.cur - a.cur)
  const top = ranked.slice(0, 2)
  const flagged = ranked.filter((t) => emergingStatus(t.cur, t.pri, m.currentTotal, m.priorTotal) === "EMERGING")
  const facts = [
    { label: "Free-text responses, latest period", value: m.currentTotal, unit: "responses" },
    { label: "Free-text responses, earlier period", value: m.priorTotal, unit: "responses" },
    ...top.map((t) => ({ label: `Responses on ${t.name}`, value: t.cur, unit: "responses" })),
    ...flagged.slice(0, 1).flatMap((t) => [
      ...(top.some((x) => x.name === t.name) ? [] : [{ label: `Responses on ${t.name}`, value: t.cur, unit: "responses" }]),
      { label: `Responses on ${t.name}, earlier period`, value: t.pri, unit: "responses" },
    ]),
  ]
  const citations = [...top, ...flagged.slice(0, 1)].map((t) => ({ record: evidenceId(t.name, 0, territory.id), label: `${t.name} · ${territory.id}` }))
  let text = `In ${territory.id} recorded perspectives most often mention ${top[0].name.toLowerCase()} (${top[0].cur} responses) and ${top[1].name.toLowerCase()} (${top[1].cur} responses), out of ${m.currentTotal} free-text responses in the latest period.`
  if (flagged[0]) text += ` ${flagged[0].name} is flagged as emerging under the stated rule: ${flagged[0].cur} responses now against ${flagged[0].pri} in the earlier period. This describes what was recorded, not why.`
  else text += " No topic meets the emerging-topic rule in this territory. This describes what was recorded, not why."
  return { territory, facts, citations, text }
}
