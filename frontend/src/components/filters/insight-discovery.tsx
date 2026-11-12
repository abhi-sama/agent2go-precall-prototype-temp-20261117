"use client"

import { Badge } from "@astryxdesign/core/Badge"
import { Button } from "@astryxdesign/core/Button"
import { Card } from "@astryxdesign/core/Card"
import { EmptyState } from "@astryxdesign/core/EmptyState"
import { Grid } from "@astryxdesign/core/Grid"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { Text } from "@astryxdesign/core/Text"
import { TextInput } from "@astryxdesign/core/TextInput"
import { VStack } from "@astryxdesign/core/VStack"
import { BookmarkPlus, ClipboardList, SlidersHorizontal } from "lucide-react"
import * as React from "react"
import { DistributionBars } from "@/components/charts/distribution-bars"
import { useSharedFilters } from "@/components/filters/filter-context"
import { FilterBar, type SelectFilter } from "@/components/filters/filter-bar"
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
    <VStack gap={2}>
      <FilterBar
        range={range}
        onRangeChange={(next) => setFilters((current) => ({ ...current, ...next }))}
        defaultRange={defaultRange}
        onReset={resetFilters}
        selects={selects}
        disabled={loading}
        selectsDisabled={unavailable}
      />
      <Card padding={3}>
        <section aria-label="Saved views">
          <HStack gap={2} wrap="wrap" align="center" justify="between">
            <HStack gap={2} wrap="wrap" align="center">
              <HStack gap={2} align="center">
                <Icon icon={SlidersHorizontal} size="sm" color="accent" />
                <Text weight="semibold">Saved views</Text>
              </HStack>
              {views.status === "success" && views.data.length === 0 && <Text type="supporting">Save a filter set to reopen it in one tap.</Text>}
              {views.status === "success" &&
                views.data.map((view) => (
                  <Button
                    key={view.savedViewId}
                    label={view.name}
                    aria-label={`${view.name}, reopen saved view`}
                    variant="secondary"
                    size="sm"
                    onClick={() => setFilters({ ...defaultRange, ...view.filters })}
                  />
                ))}
            </HStack>
            <VStack gap={1}>
              <HStack gap={2} align="end">
                <TextInput
                  label="Saved view name"
                  isLabelHidden
                  value={name}
                  placeholder="Name this filter set"
                  width="16rem"
                  onChange={(next) => setName(next.slice(0, 80))}
                />
                <Button label="Save" variant="primary" icon={<Icon icon={BookmarkPlus} />} isLoading={saving} onClick={() => void save()} />
              </HStack>
              {saveError && (
                <Text role="alert" type="supporting" size="xsm">
                  {saveError}
                </Text>
              )}
            </VStack>
          </HStack>
        </section>
      </Card>
      <Text type="supporting" size="xsm" data-testid="active-filter-range">
        Showing {formatRange(range)}. Every chart and discovery result uses these filters.
      </Text>
    </VStack>
  )
}

function grouped(rows: ResponseDistribution[]) {
  return rows.reduce<Record<string, ResponseDistribution[]>>((result, row) => { (result[row.questionId] ??= []).push(row); return result }, {})
}

export function ResponseDistributions({ discovery }: { discovery: InsightDiscovery }) {
  const groups = grouped(discovery.distributions)
  return (
    <section aria-labelledby="response-distributions-heading">
      <VStack gap={4}>
        <HStack gap={2} wrap="wrap" align="end" justify="between">
          <VStack gap={1}>
            <Heading id="response-distributions-heading" level={2}>
              Response distributions
            </Heading>
            <Text type="supporting" as="p">
              Each response set has its own question and denominator; answers are never combined across prompts.
            </Text>
          </VStack>
          <Badge variant="neutral" icon={<Icon icon={ClipboardList} />} label="Question-level" />
        </HStack>
        {Object.keys(groups).length === 0 ? (
          <EmptyState isCompact headingLevel={3} title="No recorded responses match this filter set" />
        ) : (
          <Grid columns={{ minWidth: 344, max: 2 }} gap={4}>
            {Object.entries(groups).map(([id, rows]) => (
              <DistributionCard key={id} rows={rows} />
            ))}
          </Grid>
        )}
      </VStack>
    </section>
  )
}

function DistributionCard({ rows }: { rows: ResponseDistribution[] }) {
  const first = rows[0]
  return (
    <Card data-testid={`distribution-${first.questionId}`} padding={4}>
      <VStack gap={3}>
        <VStack gap={1}>
          <Heading level={3}>{first.questionText}</Heading>
          <Text type="supporting" as="p">
            {first.parentQuestionId ? `Follow-up to ${first.parentQuestionId}` : "Primary catalog question"}
          </Text>
        </VStack>
        <DistributionBars rows={rows.map((row) => ({ label: row.response, count: row.count, percent: row.percentage }))} denominator={first.denominator} />
        <Text type="supporting" size="xsm" as="p">
          Denominator: {first.denominator} distinct recorded responses to this question.
        </Text>
      </VStack>
    </Card>
  )
}

export function QuestionDiscovery({ discovery }: { discovery: InsightDiscovery }) {
  return (
    <section aria-labelledby="question-catalog-heading">
      <VStack gap={4}>
        <VStack gap={1}>
          <Heading id="question-catalog-heading" level={2}>
            Question catalog
          </Heading>
          <Text type="supporting" as="p">
            Filter by topic, molecule, tumor type, study, survey, or question to find the right approved prompt.
          </Text>
        </VStack>
        {discovery.questions.length === 0 ? (
          <EmptyState isCompact headingLevel={3} title="No catalog questions match this filter set" />
        ) : (
          <Grid columns={{ minWidth: 320, max: 3 }} gap={4}>
            {discovery.questions.map((question) => (
              <Card key={question.questionId} data-testid={`question-${question.questionId}`} padding={4}>
                <VStack gap={3}>
                  <HStack gap={3} align="start" justify="between">
                    <Heading level={3}>{question.questionText}</Heading>
                    <Badge variant={question.status.toLowerCase() === "active" ? "blue" : "neutral"} label={question.status} />
                  </HStack>
                  <Text type="supporting" as="p">
                    {question.applicability}
                  </Text>
                  <HStack gap={1.5} wrap="wrap">
                    {[question.topic, question.molecule, question.tumorType, question.study, question.survey].filter(Boolean).map((tag) => (
                      <Badge key={tag} variant="neutral" label={tag} />
                    ))}
                  </HStack>
                  <Text type="supporting" size="xsm" as="p">
                    Effective {readableDate(question.effectiveFrom)} · {question.effectiveTo ? `ends ${readableDate(question.effectiveTo)}` : "currently open"}
                  </Text>
                </VStack>
              </Card>
            ))}
          </Grid>
        )}
      </VStack>
    </section>
  )
}
