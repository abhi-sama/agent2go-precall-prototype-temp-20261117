"use client"

import { DistributionBars } from "@/components/charts/distribution-bars"
import { BookmarkPlus, Check, ClipboardList, SlidersHorizontal } from "lucide-react"
import * as React from "react"
import { useSharedFilters } from "@/components/filters/filter-context"
import { FilterBar, type SelectFilter } from "@/components/filters/filter-bar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useDataAdapter } from "@/lib/data/data-provider"
import { useQuery } from "@/lib/data/use-query"
import type { FilterOption, InsightDiscovery, InsightFilters, ResponseDistribution } from "@/lib/data/types"
import { formatRange, presetRange } from "@/lib/dates"
import { useSession } from "@/lib/session/session-provider"

const defaultRange = presetRange("30d")
// Catalog effective dates are source calendar dates, not instants in the viewer's timezone.
const readableDate = (value: string | null) => value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value)) : "No end date"
const newCorrelationId = () => typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `view-${Date.now()}`

function asOptions(options: FilterOption[], all: string): FilterOption[] {
  return [{ value: "", label: all }, ...options]
}

/** The shared date + seven-dimensional filter control, and one-tap saved view controls. */
export function AnalyticsFilterBar({ discovery, loading, unavailable = false }: { discovery?: InsightDiscovery; loading: boolean; unavailable?: boolean }) {
  const adapter = useDataAdapter()
  const { userId } = useSession()
  const { filters, setFilters, resetFilters } = useSharedFilters()
  const [name, setName] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const views = useQuery("savedViews", userId, (ctx) => adapter.savedViews(ctx), Boolean(userId))
  const range = { from: filters.from ?? defaultRange.from, to: filters.to ?? defaultRange.to }
  const update = (key: keyof InsightFilters, value: string) => setFilters((current) => ({ ...current, [key]: value || undefined }))
  // While options load, the six selects are drawn disabled so the page below does not jump when they arrive.
  // An aggregate-only role has no catalog options to offer (they come from record-level reads): say so instead of loading forever.
  const placeholder = (id: string, label: string): SelectFilter => ({ id, label, value: "", options: [{ value: "", label: unavailable ? "Not available for your role" : "Loading…" }], onChange: () => {} })
  const selects: SelectFilter[] = !discovery ? [["territory", "Territory"], ["molecule", "Molecule"], ["landscape", "Landscape"], ["study", "Study"], ["survey", "Survey"], ["question", "Question"]].map(([id, label]) => placeholder(id, label)) : [
    { id: "territory", label: "Territory", value: filters.territoryId ?? "", options: asOptions(discovery.options.territories, "All authorized territories"), onChange: (value) => update("territoryId", value) },
    { id: "molecule", label: "Molecule", value: filters.molecule ?? "", options: asOptions(discovery.options.molecules, "All molecules"), onChange: (value) => update("molecule", value) },
    { id: "landscape", label: "Landscape", value: filters.landscape ?? "", options: asOptions(discovery.options.landscapes, "All landscapes"), onChange: (value) => update("landscape", value) },
    { id: "study", label: "Study", value: filters.study ?? "", options: asOptions(discovery.options.studies, "All studies"), onChange: (value) => update("study", value) },
    { id: "survey", label: "Survey", value: filters.survey ?? "", options: asOptions(discovery.options.surveys, "All surveys"), onChange: (value) => update("survey", value) },
    { id: "question", label: "Question", value: filters.questionId ?? "", options: asOptions(discovery.options.questions, "All questions"), onChange: (value) => update("questionId", value) },
  ]
  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed) { setSaveError("Give this view a name before saving."); return }
    setSaving(true); setSaveError(null)
    try {
      await adapter.saveView({ correlationId: newCorrelationId() }, { name: trimmed, reportKind: "insight-discovery", filters })
      setName("")
      await views.refetch()
    } catch { setSaveError("This view could not be saved. Try again.") } finally { setSaving(false) }
  }
  return (
    <div className="flex flex-col gap-3">
      <FilterBar
        range={range}
        onRangeChange={(next) => setFilters((current) => ({ ...current, ...next }))}
        defaultRange={defaultRange}
        onReset={resetFilters}
        selects={selects}
        disabled={loading}
        selectsDisabled={unavailable}
      />
      <section aria-label="Saved views" className="flex flex-col gap-3 rounded-xl bg-secondary/55 p-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className="flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal className="size-4 text-accent-text" aria-hidden /> Saved views</span>
          {views.status === "success" && views.data.length === 0 && <span className="text-sm text-muted-foreground">Save a filter set to reopen it in one tap.</span>}
          {views.status === "success" && views.data.map((view) => (
            <Button key={view.savedViewId} variant="outline" size="sm" className="min-h-9" onClick={() => setFilters({ ...defaultRange, ...view.filters })}>
              {view.name}<span className="sr-only">, reopen saved view</span>
            </Button>
          ))}
        </div>
        <div className="flex flex-col gap-1 sm:w-[23rem]">
          <div className="flex gap-2">
            <Input aria-label="Saved view name" value={name} maxLength={80} placeholder="Name this filter set" onChange={(event) => setName(event.target.value)} />
            <Button type="button" className="shrink-0" onClick={() => void save()} disabled={saving}>
              {saving ? <Check aria-hidden /> : <BookmarkPlus aria-hidden />} Save
            </Button>
          </div>
          {saveError && <p role="alert" className="text-xs text-destructive">{saveError}</p>}
        </div>
      </section>
      <p className="text-xs text-muted-foreground" data-testid="active-filter-range">Showing {formatRange(range)}. Every chart and discovery result uses these filters.</p>
    </div>
  )
}

function grouped(rows: ResponseDistribution[]) {
  return rows.reduce<Record<string, ResponseDistribution[]>>((result, row) => { (result[row.questionId] ??= []).push(row); return result }, {})
}

export function ResponseDistributions({ discovery }: { discovery: InsightDiscovery }) {
  const groups = grouped(discovery.distributions)
  return (
    <section aria-labelledby="response-distributions-heading" className="a2g-distribution-scope flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><h2 id="response-distributions-heading" className="text-xl font-semibold tracking-tight">Response distributions</h2><p className="mt-1 text-sm text-muted-foreground">Each response set has its own question and denominator; answers are never combined across prompts.</p></div>
        <Badge variant="outline"><ClipboardList aria-hidden /> Question-level</Badge>
      </div>
      {Object.keys(groups).length === 0 ? <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">No recorded responses match this filter set.</p> : (
        <div className="a2g-distribution-grid grid gap-4">
          {Object.entries(groups).map(([id, rows]) => <DistributionCard key={id} rows={rows} />)}
        </div>
      )}
    </section>
  )
}

function DistributionCard({ rows }: { rows: ResponseDistribution[] }) {
  const first = rows[0]
  return <Card data-testid={`distribution-${first.questionId}`} className="ring-1 ring-foreground/10">
    <CardHeader>
      <CardTitle className="text-[0.98rem]">{first.questionText}</CardTitle>
      <CardDescription>{first.parentQuestionId ? `Follow-up to ${first.parentQuestionId}` : "Primary catalog question"}</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-3">
      <DistributionBars rows={rows.map((row) => ({ label: row.response, count: row.count, percent: row.percentage }))} denominator={first.denominator} />
      <p className="border-t pt-3 text-xs text-muted-foreground">Denominator: {first.denominator} distinct recorded responses to this question.</p>
    </CardContent>
  </Card>
}

export function QuestionDiscovery({ discovery }: { discovery: InsightDiscovery }) {
  return <section aria-labelledby="question-catalog-heading" className="flex flex-col gap-4">
    <div><h2 id="question-catalog-heading" className="text-xl font-semibold tracking-tight">Question catalog</h2><p className="mt-1 text-sm text-muted-foreground">Filter by topic, molecule, tumor type, study, survey, or question to find the right approved prompt.</p></div>
    {discovery.questions.length === 0 ? <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">No catalog questions match this filter set.</p> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {discovery.questions.map((question) => <Card key={question.questionId} data-testid={`question-${question.questionId}`} className="ring-1 ring-foreground/10">
        <CardHeader><div className="flex items-start justify-between gap-3"><CardTitle>{question.questionText}</CardTitle><Badge variant={question.status.toLowerCase() === "active" ? "default" : "outline"}>{question.status}</Badge></div><CardDescription>{question.applicability}</CardDescription></CardHeader>
        <CardContent className="flex flex-wrap gap-1.5">{[question.topic, question.molecule, question.tumorType, question.study, question.survey].filter(Boolean).map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}</CardContent>
        <CardContent className="pt-3 text-xs text-muted-foreground">Effective {readableDate(question.effectiveFrom)} · {question.effectiveTo ? `ends ${readableDate(question.effectiveTo)}` : "currently open"}</CardContent>
      </Card>)}
    </div>}
  </section>
}
