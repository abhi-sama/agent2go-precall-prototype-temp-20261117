/**
 * Mock of the Executive themes, topic-by-region matrix and leadership summaries (ticket 13). It mirrors the BE
 * rules: aggregate-only counts with small groups withheld (`disclosure.ts`: a count of 1 to 4 is withheld, and when
 * exactly one part of a shown total is withheld the next-smallest part goes too), the approved emerging-topic rule
 * (`insight-rules.ts`) judged on share of free text, and citations that describe the cited set of responses rather than
 * naming a record unless the viewer holds record-level permission. Synthetic and deterministic.
 */
import { addDays, daysInRange } from "@/lib/dates"
import { MIN_CELL, shown, suppressFlags } from "./disclosure"
import {
  EXECUTIVE_THEME_FACETS,
  FACET_LABEL,
  type DisclosureRuleInfo,
  type ExecutiveCitation,
  type ExecutiveMatrixCell,
  type ExecutiveMatrixRegion,
  type ExecutiveMatrixRow,
  type ExecutiveThemeCard,
  type ExecutiveThemeFacet,
  type ExecutiveThemeGroup,
  type ExecutiveThemes,
  type ExecutiveThemesAdapter,
  type ExecutiveThresholds,
  type ExecutiveTopicMatrix,
  type ExecutiveTrend,
  type LeadershipFigure,
  type LeadershipStatement,
  type LeadershipSummary,
  type LeadershipSummaryExport,
  type LeadershipSummaryItem,
} from "./executive-themes"
import { fixtureHash, REGIONS, type FixtureTerritory, type FixtureUser } from "./fixtures"
import { EMERGING_THRESHOLDS, allocate, emergingRuleText, emergingStatus } from "./insight-rules"
import { evidenceId, THEMES } from "./mock-director-insights"
import type { MockScenario } from "./mock-adapter"
import { DataError, type DateRange, type RequestContext } from "./types"

export const THEMES_DEFINITION_VERSION = "executive-themes-v1"
const MAX_WINDOW_DAYS = 731
const OTHER = "Other perspectives"
const CARDS_PER_GROUP = 4
const DERIVED_NOTE =
  "Themes group free-text answers by keywords. They are derived, not source facts, and describe what recorded responses mention, never why."

/** Free-text responses per territory per day, by region. The West is deliberately thin, so it shows a small sample. */
const REGION_VOLUME: Record<string, number> = { NE: 2.6, SE: 2.0, MW: 1.2, WE: 0.045 }

/** A region can lean away from a topic: ctDNA is not rising in the Midwest, so it is rising in only some regions. */
function regionModifier(regionId: string, topic: string, period: "prior" | "current"): number {
  if (topic.startsWith("ctDNA") && regionId === "MW") return period === "current" ? 0.25 : 1
  if (topic.startsWith("Pulmonary") && regionId === "SE") return period === "current" ? 1.4 : 0.8
  if (topic === "Unmet need" && regionId === "MW") return 0.35
  if (topic === "Access and reimbursement" && regionId === "NE") return period === "current" ? 0.7 : 1.15
  return 1
}

const FACET_VALUES: Record<Exclude<ExecutiveThemeFacet, "PORTFOLIO">, { value: string; share: number }[]> = {
  MOLECULE: [
    { value: "trastuzumab deruxtecan", share: 0.34 },
    { value: "osimertinib", share: 0.27 },
    { value: "pembrolizumab", share: 0.24 },
    { value: "sacituzumab govitecan", share: 0.15 },
  ],
  DISEASE_AREA: [
    { value: "breast cancer", share: 0.36 },
    { value: "non-small cell lung cancer", share: 0.28 },
    { value: "gastric cancer", share: 0.2 },
    { value: "urothelial cancer", share: 0.16 },
  ],
  STUDY: [
    { value: "DESTINY-Breast06", share: 0.33 },
    { value: "FLAURA2", share: 0.28 },
    { value: "KEYNOTE-671", share: 0.23 },
    { value: "TROPiCS-02", share: 0.16 },
  ],
}

export function facetValues(facet: ExecutiveThemeFacet): { value: string; share: number }[] {
  return facet === "PORTFOLIO" ? [{ value: "Portfolio", share: 1 }] : FACET_VALUES[facet]
}

export interface ThemesInput {
  territories: FixtureTerritory[]
  range: DateRange
  dataThrough: string
  scopeLabel: string
  /** Explicit record-level permission: nothing is withheld and citations name responses. */
  records: boolean
  empty: boolean
}

interface RegionGrid {
  regionId: string
  regionName: string
  territories: number
  curTotal: number
  priTotal: number
  topics: { topic: string; cur: number; pri: number }[]
}

/** The unsuppressed counts for one facet value: per region, per theme, both windows. A pure function of its inputs. */
export function buildGrid(input: ThemesInput, facetValue: string, share: number): RegionGrid[] {
  const days = daysInRange(input.range)
  const regionIds = REGIONS.map((r) => r.id).filter((id) => input.territories.some((t) => t.regionId === id))
  return regionIds.map((regionId) => {
    const n = input.territories.filter((t) => t.regionId === regionId).length
    const base = n * days * (REGION_VOLUME[regionId] ?? 1) * share
    const curTotal = input.empty ? 0 : Math.round(base)
    const priTotal = input.empty ? 0 : Math.round(base * (0.9 + 0.12 * fixtureHash(`${regionId}:${facetValue}:prior`)))
    const weights = (period: "prior" | "current") =>
      THEMES.map((t) => t[period] * regionModifier(regionId, t.name, period) * (0.85 + 0.3 * fixtureHash(`${regionId}:${facetValue}:${t.name}`)))
    const cur = allocate(curTotal, weights("current"))
    const pri = allocate(priTotal, weights("prior"))
    return {
      regionId,
      regionName: REGIONS.find((r) => r.id === regionId)?.name ?? regionId,
      territories: n,
      curTotal,
      priTotal,
      topics: THEMES.map((t, i) => ({ topic: t.name, cur: cur[i], pri: pri[i] })),
    }
  })
}

const round1 = (n: number) => Math.round(n * 10) / 10
const hcpsOf = (n: number) => (n > 0 ? Math.max(1, Math.round(n * 0.7)) : 0)

const TREND: Record<string, ExecutiveTrend> = { EMERGING: "RISING", DECLINING: "FALLING", STABLE: "STEADY", INSUFFICIENT_SAMPLE: "INSUFFICIENT_SAMPLE" }

export function trendOf(cur: number, pri: number, curTotal: number, priTotal: number, withheld: boolean): ExecutiveTrend {
  if (withheld) return "WITHHELD"
  return TREND[emergingStatus(cur, pri, curTotal, priTotal)]
}

function disclosure(applied: boolean, suppressedCells: number): DisclosureRuleInfo {
  return {
    minCell: MIN_CELL,
    text: `Counts below ${MIN_CELL} are withheld so no small group can be identified. When one value in a total is withheld, the next smallest is withheld as well, so it cannot be worked out by subtraction.`,
    suppressedCells,
    applied,
  }
}

export function thresholds(): ExecutiveThresholds {
  return {
    ...EMERGING_THRESHOLDS,
    minCell: MIN_CELL,
    rule: emergingRuleText(),
    approved: true,
    definitionId: "executive-emerging-topic-rule",
    version: 1,
    approvedAt: "2026-11-01T00:00:00Z",
  }
}

const priorWindow = (range: DateRange): DateRange => {
  const days = daysInRange(range)
  return { from: addDays(range.from, -days), to: addDays(range.from, -1) }
}

const dateText = (r: DateRange) => `${r.from} to ${r.to}`

function limitations(input: ThemesInput, small: string[], suppressed: number, prior: DateRange): string[] {
  const out = [
    `Counts are recorded free-text responses between ${dateText(input.range)}, compared with the same-length period ${dateText(prior)}. They describe the HCPs who were asked and answered, not every HCP in the regions.`,
    "Themes group free-text answers by keyword, so one response counts in one theme and a nuance can be missed.",
  ]
  if (small.length) {
    out.push(
      `${small.join(" and ")} held fewer than ${EMERGING_THRESHOLDS.minWindowResponses} free-text responses in a period, so no trend is judged there.`,
    )
  }
  if (suppressed > 0 && !input.records) {
    out.push(`${suppressed} counts are withheld because they are below ${MIN_CELL}; complementary values are withheld so they cannot be recovered by subtraction.`)
  }
  return out
}

function citation(
  input: ThemesInput,
  facet: ExecutiveThemeFacet,
  facetValue: string,
  topic: string,
  count: { cur: number; hcps: number; regions: number },
  hidden: boolean,
): ExecutiveCitation[] {
  const id = `agg:${facet}:${facetValue}:${topic}`
  const scope = facet === "PORTFOLIO" ? "the portfolio" : facetValue
  const size = hidden ? "A small number of responses (withheld)" : `${count.cur.toLocaleString("en-US")} responses from ${count.hcps.toLocaleString("en-US")} HCPs in ${count.regions} region${count.regions === 1 ? "" : "s"}`
  if (input.records) {
    // Record-level permission: name responses, with excerpts.
    const theme = THEMES.find((t) => t.name === topic)
    const territory = input.territories[0]
    return [0, 1].map((variant) => ({
      citationId: `rec:${facet}:${facetValue}:${topic}:${variant}`,
      kind: "RECORD" as const,
      dataset: "hcp_raw_insights",
      label: `Recorded response on ${topic}`,
      responses: null,
      recordId: evidenceId(topic, variant, territory.id),
      excerpt: theme?.excerpts[variant] ?? null,
      interactionDate: addDays(input.range.to, -(variant * 5 + 2)),
    }))
  }
  return [
    {
      citationId: id,
      kind: "AGGREGATE",
      dataset: "hcp_raw_insights",
      label: `Free-text responses on ${topic} for ${scope}, ${dateText(input.range)}: ${size}.`,
      responses: shown(count.cur, hidden),
      recordId: null,
      excerpt: null,
      interactionDate: null,
    },
  ]
}

function smallRegions(grid: RegionGrid[]): string[] {
  return grid
    .filter((r) => r.curTotal < EMERGING_THRESHOLDS.minWindowResponses || r.priTotal < EMERGING_THRESHOLDS.minWindowResponses)
    .map((r) => r.regionName)
}

// --------------------------------------------------------------------------- theme cards

export function buildThemes(input: ThemesInput, facet: ExecutiveThemeFacet): ExecutiveThemes {
  const prior = priorWindow(input.range)
  const groups: ExecutiveThemeGroup[] = []
  const small = new Set<string>()
  let suppressedCells = 0

  for (const { value, share } of facetValues(facet)) {
    const grid = buildGrid(input, value, share)
    smallRegions(grid).forEach((r) => small.add(r))
    const topics = THEMES.map((t, i) => {
      const cur = grid.reduce((a, r) => a + r.topics[i].cur, 0)
      const pri = grid.reduce((a, r) => a + r.topics[i].pri, 0)
      return { topic: t.name, cur, pri, regions: grid.filter((r) => r.topics[i].cur > 0).length }
    })
    const curTotal = grid.reduce((a, r) => a + r.curTotal, 0)
    const priTotal = grid.reduce((a, r) => a + r.priTotal, 0)
    const cur = suppressFlags(topics.map((t) => t.cur), curTotal, true)
    const pri = suppressFlags(topics.map((t) => t.pri), priTotal, true)
    const hide = !input.records
    const curHidden = topics.map((_, i) => hide && cur.flags[i])
    const priHidden = topics.map((_, i) => hide && pri.flags[i])
    const curTotalHidden = hide && cur.totalHidden
    const priTotalHidden = hide && pri.totalHidden

    const cards: ExecutiveThemeCard[] = topics
      .map((t, i) => {
        const hidden = curHidden[i]
        const hcps = hcpsOf(t.cur)
        const hcpsHidden = hide && hcps > 0 && hcps < MIN_CELL
        const trendWithheld = hidden || priHidden[i] || curTotalHidden || priTotalHidden
        return {
          order: i,
          card: {
            cardId: `${facet}:${value}:${t.topic}`,
            facetValue: value,
            topic: t.topic,
            responses: shown(t.cur, hidden),
            priorResponses: shown(t.pri, priHidden[i]),
            distinctHcps: shown(hcps, hcpsHidden || hidden),
            share: hidden || curTotalHidden || !curTotal ? null : round1((100 * t.cur) / curTotal),
            regionCount: t.regions,
            trend: trendOf(t.cur, t.pri, curTotal, priTotal, trendWithheld),
            citations: citation(input, facet, value, t.topic, { cur: t.cur, hcps, regions: t.regions }, hidden || hcpsHidden),
          } satisfies ExecutiveThemeCard,
        }
      })
      .filter(({ card }) => card.topic !== OTHER && card.responses.value !== 0)
      // Rank on what is shown: a withheld count is unranked and listed last, so order never reveals it.
      .sort((a, b) => {
        const av = a.card.responses.value
        const bv = b.card.responses.value
        if (av === null && bv === null) return a.order - b.order
        if (av === null) return 1
        if (bv === null) return -1
        return bv - av || a.order - b.order
      })
      .slice(0, CARDS_PER_GROUP)
      .map(({ card }) => card)

    suppressedCells += curHidden.filter(Boolean).length + priHidden.filter(Boolean).length + Number(curTotalHidden) + Number(priTotalHidden)
    groups.push({
      facetValue: value,
      freeTextResponses: shown(curTotal, curTotalHidden),
      priorFreeTextResponses: shown(priTotal, priTotalHidden),
      regionCount: grid.filter((r) => r.curTotal > 0).length,
      cards,
    })
  }

  return {
    from: input.range.from,
    to: input.range.to,
    priorFrom: prior.from,
    priorTo: prior.to,
    dataThrough: input.dataThrough,
    scopeLabel: input.scopeLabel,
    accessLevel: input.records ? "RECORD_DRILLDOWN" : "AGGREGATE_ONLY",
    facet,
    facetLabel: FACET_LABEL[facet],
    definitionVersion: THEMES_DEFINITION_VERSION,
    disclosure: disclosure(!input.records, suppressedCells),
    groups,
    groupsLeftOut: 0,
    sampleLimitations: limitations(input, [...small], suppressedCells, prior),
    note: DERIVED_NOTE,
  }
}

// --------------------------------------------------------------------------- topic-by-region matrix

export function buildMatrix(input: ThemesInput, facet: ExecutiveThemeFacet, facetValue: string | null): ExecutiveTopicMatrix {
  const prior = priorWindow(input.range)
  const values = facetValues(facet)
  const chosen = facet === "PORTFOLIO" ? values[0] : values.find((v) => v.value === facetValue) ?? values[0]
  const grid = buildGrid(input, chosen.value, chosen.share)
  const hide = !input.records
  let suppressedCells = 0

  // Complementary suppression runs down each region's column, separately for each window.
  const columns = grid.map((region) => {
    const cur = suppressFlags(region.topics.map((t) => t.cur), region.curTotal, true)
    const pri = suppressFlags(region.topics.map((t) => t.pri), region.priTotal, true)
    return { region, cur, pri }
  })

  const regions: ExecutiveMatrixRegion[] = columns.map(({ region, cur, pri }) => {
    const curTotalHidden = hide && cur.totalHidden
    const priTotalHidden = hide && pri.totalHidden
    suppressedCells += Number(curTotalHidden) + Number(priTotalHidden)
    return {
      regionId: region.regionId,
      regionName: region.regionName,
      territoriesInScope: region.territories,
      freeTextResponses: shown(region.curTotal, curTotalHidden),
      priorFreeTextResponses: shown(region.priTotal, priTotalHidden),
      sampleSufficient: region.curTotal >= EMERGING_THRESHOLDS.minWindowResponses && region.priTotal >= EMERGING_THRESHOLDS.minWindowResponses,
    }
  })

  const rows: ExecutiveMatrixRow[] = THEMES.map((theme, ti) => {
    const cells: ExecutiveMatrixCell[] = columns.map(({ region, cur, pri }) => {
      const t = region.topics[ti]
      const curHidden = hide && cur.flags[ti]
      const priHidden = hide && pri.flags[ti]
      const curTotalHidden = hide && cur.totalHidden
      const priTotalHidden = hide && pri.totalHidden
      suppressedCells += Number(curHidden) + Number(priHidden)
      const share = curHidden || curTotalHidden || !region.curTotal ? null : round1((100 * t.cur) / region.curTotal)
      const priorShare = priHidden || priTotalHidden || !region.priTotal ? null : round1((100 * t.pri) / region.priTotal)
      const trend = trendOf(t.cur, t.pri, region.curTotal, region.priTotal, curHidden || priHidden || curTotalHidden || priTotalHidden)
      return {
        regionId: region.regionId,
        responses: shown(t.cur, curHidden),
        priorResponses: shown(t.pri, priHidden),
        share,
        priorShare,
        sharePointChange: share !== null && priorShare !== null ? round1(share - priorShare) : null,
        trend,
        alert: trend === "RISING",
      }
    })
    const rising = cells.filter((c) => c.trend === "RISING").length
    return {
      topic: theme.name,
      isOther: theme.name === OTHER,
      cells,
      regionsRising: rising,
      regionsFalling: cells.filter((c) => c.trend === "FALLING").length,
      crossRegion: rising >= 2,
    }
  })

  return {
    from: input.range.from,
    to: input.range.to,
    priorFrom: prior.from,
    priorTo: prior.to,
    dataThrough: input.dataThrough,
    scopeLabel: input.scopeLabel,
    accessLevel: input.records ? "RECORD_DRILLDOWN" : "AGGREGATE_ONLY",
    facet,
    facetValue: facet === "PORTFOLIO" ? null : chosen.value,
    definitionVersion: THEMES_DEFINITION_VERSION,
    disclosure: disclosure(!input.records, suppressedCells),
    thresholds: thresholds(),
    regions,
    rows,
    sampleLimitations: limitations(input, smallRegions(grid), suppressedCells, prior),
    note: DERIVED_NOTE,
  }
}

// --------------------------------------------------------------------------- leadership summaries

const DEFINITIONS = [
  { key: "freeText", label: "Free-text responses", text: "Non-blank answers to open-text questions, counted once by response key, excluding responses flagged as excluded." },
  { key: "theme", label: "Theme", text: "A keyword grouping of free-text answers. Derived, never a source fact, and one response counts in one theme." },
  { key: "trend", label: "Trend arrow", text: emergingRuleText() },
  { key: "withheld", label: "Withheld", text: `Counts below ${MIN_CELL} are withheld to protect small groups, with complementary values withheld too.` },
]

interface StoredSummary extends LeadershipSummary {
  ownerUserId: string
  dataVersion: number
}

const STORE = new Map<string, StoredSummary[]>()
export function resetMockExecutiveSummaries() {
  STORE.clear()
}

const SEEDED_LOCKED = "ls-20261001090000-00000001"

function newId(at: Date): string {
  const stamp = at.toISOString().replace(/[-:T]/g, "").slice(0, 14)
  return `ls-${stamp}-${Math.floor(fixtureHash(`${stamp}:${STORE.size}`) * 0xffffffff).toString(16).padStart(8, "0")}`
}

export function buildSummary(input: ThemesInput, user: FixtureUser, summaryId: string, at: Date, regenerates: string | null, version: number): StoredSummary {
  const themes = buildThemes(input, "PORTFOLIO")
  const matrix = buildMatrix(input, "PORTFOLIO", null)
  const group = themes.groups[0]
  const cards = group.cards.filter((c) => c.responses.value !== null).slice(0, 2)
  const cross = matrix.rows.filter((r) => r.crossRegion && !r.isOther)
  const matrixCitation: ExecutiveCitation = {
    citationId: "agg:matrix:PORTFOLIO",
    kind: "AGGREGATE",
    dataset: "hcp_raw_insights",
    label: `Topic-by-region matrix for the portfolio, ${dateText(input.range)}: ${matrix.regions.length} regions, ${matrix.rows.length} themes, judged against the period ${dateText({ from: matrix.priorFrom, to: matrix.priorTo })}.`,
    responses: group.freeTextResponses,
    recordId: null,
    excerpt: null,
    interactionDate: null,
  }
  const totalCite: ExecutiveCitation = {
    citationId: "agg:total:PORTFOLIO",
    kind: "AGGREGATE",
    dataset: "hcp_raw_insights",
    label: `All free-text responses in ${user.scopeLabel.replace(" · aggregate only", "")}, ${dateText(input.range)}.`,
    responses: group.freeTextResponses,
    recordId: null,
    excerpt: null,
    interactionDate: null,
  }
  const citations = [totalCite, ...cards.flatMap((c) => c.citations), matrixCitation]
  const total = group.freeTextResponses.value
  const statements: LeadershipStatement[] = [
    {
      statementId: "s-o1",
      section: "overview",
      text:
        total === null
          ? `Only a small number of free-text responses were recorded between ${input.range.from} and ${input.range.to}, so the count is withheld.`
          : `${total.toLocaleString("en-US")} free-text responses were recorded between ${input.range.from} and ${input.range.to} across ${group.regionCount} regions.`,
      citationIds: [totalCite.citationId],
    },
    ...cards.map((c, i) => ({
      statementId: `s-t${i + 1}`,
      section: "themes",
      text: `${c.topic} was the ${i === 0 ? "most" : "next most"} recorded theme, with ${c.responses.value?.toLocaleString("en-US")} responses${c.share !== null ? ` (${c.share}% of free text)` : ""}.`,
      citationIds: c.citations.map((x) => x.citationId),
    })),
    {
      statementId: "s-x1",
      section: "crossRegion",
      text: cross.length
        ? `${cross.map((r) => r.topic).join(" and ")} ${cross.length === 1 ? "is" : "are"} mentioned more often than in the earlier period in ${Math.max(...cross.map((r) => r.regionsRising))} regions at the approved threshold. This describes a change in recorded responses, not a cause.`
        : "No topic meets the approved threshold in two or more regions.",
      citationIds: [matrixCitation.citationId],
    },
  ]
  const keyFigures: LeadershipFigure[] = [
    { label: "Free-text responses", value: group.freeTextResponses, citationIds: [totalCite.citationId] },
    { label: "Regions in scope", value: shown(group.regionCount, false), citationIds: [] },
    { label: "Topics rising in 2+ regions", value: shown(cross.length, false), citationIds: [matrixCitation.citationId] },
  ]
  return {
    summaryId,
    title: `Leadership summary, ${input.range.from} to ${input.range.to}`,
    from: input.range.from,
    to: input.range.to,
    dataThrough: input.dataThrough,
    generatedAt: at.toISOString(),
    scopeLabel: input.scopeLabel,
    scopeTerritoryIds: input.territories.map((t) => t.id),
    accessLevel: input.records ? "RECORD_DRILLDOWN" : "AGGREGATE_ONLY",
    definitionVersion: THEMES_DEFINITION_VERSION,
    modelMode: "stub",
    numberCheck: "unchecked",
    droppedStatements: 0,
    stale: false,
    staleReasons: [],
    currentDataThrough: input.dataThrough,
    keyFigures,
    statements,
    sampleLimitations: themes.sampleLimitations,
    definitions: DEFINITIONS,
    citations,
    disclosure: themes.disclosure,
    regeneratesSummaryId: regenerates,
    ownerUserId: user.userId,
    dataVersion: version,
  }
}

interface Deps {
  user: () => FixtureUser
  scenario: () => MockScenario
  gate: (ctx: RequestContext, operation: string) => Promise<MockScenario>
  input: (ctx: RequestContext, scenario: MockScenario, range?: Partial<DateRange>) => ThemesInput
  now: () => Date
}

export function createMockExecutiveThemes(deps: Deps): ExecutiveThemesAdapter {
  const forbidden = (ctx: RequestContext) => new DataError("FORBIDDEN", "You do not have access to this data.", ctx.correlationId)
  const mine = () => STORE.get(deps.user().userId) ?? []
  const present = (ctx: RequestContext, s: MockScenario, stored: StoredSummary): LeadershipSummary => {
    if (s === "scope-changed") {
      throw new DataError("FORBIDDEN", "Your access to this summary has changed.", ctx.correlationId)
    }
    const { ownerUserId: _o, dataVersion: _v, ...summary } = stored
    void _o
    void _v
    const stale = s === "stale"
    return { ...summary, stale, staleReasons: stale ? ["NEWER_DATA_LOADED"] : [], currentDataThrough: stale ? "2026-11-04T05:30:00Z" : summary.dataThrough }
  }

  return {
    async executiveThemes(ctx, range, facet = "PORTFOLIO") {
      const s = await deps.gate(ctx, "executiveThemes")
      if (!EXECUTIVE_THEME_FACETS.includes(facet)) throw new DataError("BAD_REQUEST", "That request was not accepted.", ctx.correlationId)
      return buildThemes(deps.input(ctx, s, range), facet)
    },

    async executiveTopicMatrix(ctx, range, facet = "PORTFOLIO", facetValue = null) {
      const s = await deps.gate(ctx, "executiveTopicMatrix")
      if (!EXECUTIVE_THEME_FACETS.includes(facet)) throw new DataError("BAD_REQUEST", "That request was not accepted.", ctx.correlationId)
      return buildMatrix(deps.input(ctx, s, range), facet, facetValue)
    },

    async generateLeadershipSummary(ctx, range, regeneratesSummaryId) {
      const s = await deps.gate(ctx, "generateLeadershipSummary")
      const input = deps.input(ctx, s, range)
      if (daysInRange(input.range) > MAX_WINDOW_DAYS) throw new DataError("BAD_REQUEST", "That request was not accepted.", ctx.correlationId)
      await new Promise((resolve) => setTimeout(resolve, 600))
      const at = deps.now()
      const stored = buildSummary(input, deps.user(), newId(at), at, regeneratesSummaryId ?? null, 1)
      STORE.set(deps.user().userId, [stored, ...mine()])
      const { ownerUserId: _o, dataVersion: _v, ...summary } = stored
      void _o
      void _v
      return summary
    },

    async leadershipSummary(ctx, summaryId) {
      const s = await deps.gate(ctx, "leadershipSummary")
      if (s === "scope-changed" && summaryId === SEEDED_LOCKED) throw new DataError("FORBIDDEN", "Your access to this summary has changed.", ctx.correlationId)
      const stored = mine().find((x) => x.summaryId === summaryId)
      if (!stored) throw new DataError("NOT_FOUND", "That summary is not available.", ctx.correlationId)
      return present(ctx, s, stored)
    },

    async myLeadershipSummaries(ctx) {
      const s = await deps.gate(ctx, "myLeadershipSummaries")
      if (deps.user().persona !== "executive" || s === "forbidden") throw forbidden(ctx)
      const items: LeadershipSummaryItem[] = mine().map((x) => ({
        summaryId: x.summaryId,
        title: s === "scope-changed" ? null : x.title,
        from: s === "scope-changed" ? null : x.from,
        to: s === "scope-changed" ? null : x.to,
        generatedAt: x.generatedAt,
        dataThrough: x.dataThrough,
        accessible: s !== "scope-changed",
        stale: s === "stale",
      }))
      if (s === "scope-changed") {
        items.push({ summaryId: SEEDED_LOCKED, title: null, from: null, to: null, generatedAt: "2026-10-01T09:00:00Z", dataThrough: "2026-09-30T05:30:00Z", accessible: false, stale: false })
      }
      return items
    },

    async exportLeadershipSummary(ctx, summaryId) {
      const s = await deps.gate(ctx, "exportLeadershipSummary")
      if (s === "scope-changed") throw new DataError("FORBIDDEN", "Your access to this summary has changed.", ctx.correlationId)
      const stored = mine().find((x) => x.summaryId === summaryId)
      if (!stored) throw new DataError("NOT_FOUND", "That summary is not available.", ctx.correlationId)
      const exported: LeadershipSummaryExport = {
        summaryId: stored.summaryId,
        title: stored.title,
        scopeLabel: stored.scopeLabel,
        from: stored.from,
        to: stored.to,
        dataThrough: stored.dataThrough,
        generatedAt: stored.generatedAt,
        exportedAt: deps.now().toISOString(),
        accessLevel: stored.accessLevel,
        definitionVersion: stored.definitionVersion,
        keyFigures: stored.keyFigures,
        statements: stored.statements,
        sampleLimitations: stored.sampleLimitations,
        definitions: stored.definitions,
        citations: stored.citations,
        disclosureText: stored.disclosure.text,
      }
      return exported
    },
  }
}
