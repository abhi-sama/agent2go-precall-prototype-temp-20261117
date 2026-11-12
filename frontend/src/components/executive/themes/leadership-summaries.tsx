"use client"

import { Download, FileClock, Lock, Printer, RefreshCw, Sparkles } from "lucide-react"
import * as React from "react"
import { Badge } from "@astryxdesign/core/Badge"
import { Banner } from "@astryxdesign/core/Banner"
import { Button } from "@astryxdesign/core/Button"
import { Card } from "@astryxdesign/core/Card"
import { Collapsible } from "@astryxdesign/core/Collapsible"
import { Drawer, DrawerHeader } from "@astryxdesign/core/Drawer"
import { Heading } from "@astryxdesign/core/Heading"
import { Icon } from "@astryxdesign/core/Icon"
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList"
import { Skeleton } from "@astryxdesign/core/Skeleton"
import { Text } from "@astryxdesign/core/Text"
import { DataThroughBadge } from "@/components/landing/data-through-badge"
import { AiSummary, SourceFact } from "@/components/provenance/provenance"
import { EmptyState, ErrorState } from "@/components/state/states"
import { useAppToast } from "@/components/state/use-app-toast"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { ExecutiveCitation, LeadershipSummary, LeadershipSummaryExport } from "@/lib/data/executive-themes"
import { toDataError, type DataError, type DateRange } from "@/lib/data/types"
import { useQuery } from "@/lib/data/use-query"
import { formatInstant } from "@/lib/dates"
import { log, newCorrelationId } from "@/lib/log/logger"
import { useSession } from "@/lib/session/session-provider"
import { CountValue } from "../count"
import { LeadershipDocumentBody, LeadershipPrintDocument } from "./leadership-document"
import { CitationList, SampleLimitations } from "./parts"

const SECTIONS: { key: string; title: string }[] = [
  { key: "overview", title: "Overview" },
  { key: "themes", title: "Leading themes" },
  { key: "crossRegion", title: "Topics across regions" },
]

/** Shown when a saved summary can no longer be opened or exported because the Executive's access changed. */
function AccessChanged({ action }: { action: "open" | "export" }) {
  return (
    <Banner
      data-testid="access-changed"
      role="alert"
      status="error"
      title={`Your access has changed, so this summary cannot be ${action === "open" ? "opened" : "exported"}.`}
      description={`A territory it covers is no longer in your explicit scope, or a permission it relied on was withdrawn. Nothing was ${action === "open" ? "shown" : "exported"}. Generate a new summary for your current scope, or ask an administrator to review your access.`}
    />
  )
}

/** Statement text with its numbered source markers. Aggregate sources have nothing to open, so a marker jumps to its entry in the list. */
function Statement({ text, ids, numbers, summaryId }: { text: string; ids: string[]; numbers: Map<string, number>; summaryId: string }) {
  return (
    <li data-testid="summary-statement" className="text-pretty">
      {text}
      {ids.map((id) => {
        const n = numbers.get(id)
        if (!n) return null
        return (
          <a key={id} href={`#${summaryId}-src-${n}`} data-testid="summary-cite" aria-label={`Source ${n}`} className="ml-1 inline-flex min-h-6 items-center justify-center rounded-md px-1 align-baseline font-mono text-xs font-semibold text-fact underline decoration-fact/40 underline-offset-2 hover:bg-fact/10 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none pointer-coarse:min-h-11 pointer-coarse:min-w-11">[{n}]</a>
        )
      })}
    </li>
  )
}

function SourceList({ citations, summaryId }: { citations: ExecutiveCitation[]; summaryId: string }) {
  return (
    <ol data-testid="summary-sources" aria-label="Sources" className="flex flex-col gap-2">
      {citations.map((c, i) => (
        <li key={c.citationId} id={`${summaryId}-src-${i + 1}`} className="flex scroll-mt-24 items-start gap-2 text-xs text-muted-foreground target:rounded-md target:bg-fact/10">
          <span className="font-mono font-semibold text-fact">[{i + 1}]</span>
          <CitationList citations={[c]} label={`Source ${i + 1}`} />
        </li>
      ))}
    </ol>
  )
}

function SummaryView({ summary, onExport, onRegenerate, exporting, busy }: { summary: LeadershipSummary; onExport: () => void; onRegenerate: () => void; exporting: boolean; busy: boolean }) {
  const numbers = new Map(summary.citations.map((c, i) => [c.citationId, i + 1]))
  const min = summary.disclosure.minCell
  const known = new Set(SECTIONS.map((s) => s.key))
  return (
    <article data-testid="leadership-summary" data-summary-id={summary.summaryId} data-stale={summary.stale} className="min-w-0 animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none">
    <Card padding={5} elevation="low" className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Heading level={3} data-testid="summary-title">{summary.title}</Heading>
          <div className="flex flex-wrap gap-2">
            <Button data-testid="export-summary" onClick={onExport} isDisabled={exporting} variant="primary" icon={<Icon icon={Download} />} label={exporting ? "Checking access…" : "Export"} />
            <Button data-testid="regenerate-summary" onClick={onRegenerate} isDisabled={busy} variant="secondary" icon={<Icon icon={RefreshCw} />} label="Regenerate" />
          </div>
        </div>
        <MetadataList data-testid="summary-meta" orientation="horizontal">
          <MetadataListItem label="Scope"><Text data-testid="summary-scope" weight="medium">{summary.scopeLabel}</Text></MetadataListItem>
          <MetadataListItem label="Dates"><Text data-testid="summary-range" weight="medium" hasTabularNumbers>{summary.from} to {summary.to}</Text></MetadataListItem>
          <MetadataListItem label="Generated"><Text weight="medium">{formatInstant(summary.generatedAt)}</Text></MetadataListItem>
          <MetadataListItem label="Definitions"><Text weight="medium">{summary.definitionVersion}</Text></MetadataListItem>
        </MetadataList>
        <div className="flex flex-wrap items-center gap-2">
          <DataThroughBadge dataThrough={summary.dataThrough} className="min-h-8 text-xs" />
          {summary.modelMode === "stub" && <Badge data-testid="stub-badge" variant="warning" label="Local stub model · no API key" />}
          {summary.stale && <Badge data-testid="summary-stale" variant="warning" icon={<Icon icon={FileClock} size="sm" />} label="Newer data available · regenerate" />}
        </div>
      </header>

      <SourceFact title="Counted from your data" meta={<span>Counted by database queries, not by the AI.</span>}>
        <dl data-testid="summary-figures" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {summary.keyFigures.map((f) => (
            <div key={f.label}><dt className="text-xs text-muted-foreground">{f.label}</dt><dd className="text-2xl font-semibold"><CountValue count={f.value} minCell={min} /></dd></div>
          ))}
        </dl>
      </SourceFact>

      <AiSummary title="Summary" meta={<span>Written by AI from the figures above. Each statement cites its source.</span>}>
        {/* Inline [n] source markers sit inside a sentence (the WCAG 2.5.8 inline-target exception). */}
        <div data-layout-ok="touch" className="flex flex-col gap-3">
          {[...SECTIONS, { key: "__other", title: "Other findings" }].map(({ key, title }) => {
            const items = summary.statements.filter((s) => (key === "__other" ? !known.has(s.section) : s.section === key))
            if (items.length === 0) return null
            return (
              <section key={key} aria-label={title}>
                <Heading level={4} className="uppercase tracking-wide">{title}</Heading>
                <ul className="mt-1 flex flex-col gap-1.5">{items.map((s) => <Statement key={s.statementId} text={s.text} ids={s.citationIds} numbers={numbers} summaryId={summary.summaryId} />)}</ul>
              </section>
            )
          })}
        </div>
      </AiSummary>

      <section aria-label="Sources" className="flex flex-col gap-2">
        <Heading level={4}>Sources</Heading>
        <SourceList citations={summary.citations} summaryId={summary.summaryId} />
      </section>

      <SampleLimitations items={summary.sampleLimitations} />

      <Collapsible data-testid="summary-definitions" defaultIsOpen={false} trigger={<Text weight="semibold">Metric definitions ({summary.definitionVersion})</Text>}>
        <dl className="mt-2 grid gap-x-8 gap-y-3 text-sm md:grid-cols-2">
          {summary.definitions.map((d) => <div key={d.key}><dt className="font-semibold">{d.label}</dt><dd className="text-muted-foreground">{d.text}</dd></div>)}
        </dl>
      </Collapsible>
      {summary.disclosure.applied && <Text as="p" type="supporting">{summary.disclosure.text}</Text>}
    </Card>
    </article>
  )
}

/**
 * Leadership summaries: generate (on the approved agent path), reopen, regenerate and export. Opening and exporting both
 * re-check the Executive's access in the BE; when access has changed the screen says so instead of showing anything.
 */
export function LeadershipSummaries({ range }: { range: DateRange }) {
  const adapter = useDataAdapter()
  const toast = useAppToast()
  const { userId, ready } = useSession()
  const list = useQuery("myLeadershipSummaries", userId, (ctx) => adapter.myLeadershipSummaries(ctx), ready)
  const [active, setActive] = React.useState<LeadershipSummary | null>(null)
  const [generating, setGenerating] = React.useState(false)
  const [opening, setOpening] = React.useState<string | null>(null)
  const [exporting, setExporting] = React.useState(false)
  const [problem, setProblem] = React.useState<{ action: "open" | "export" | "generate"; error: DataError } | null>(null)
  const [exported, setExported] = React.useState<LeadershipSummaryExport | null>(null)

  const fail = (action: "open" | "export" | "generate", err: unknown, correlationId: string) => {
    const error = toDataError(err, correlationId)
    log.child(correlationId).error(`leadership summary ${action} failed`, { operation: `leadershipSummary.${action}`, error_code: error.code })
    setProblem({ action, error })
    if (error.code === "FORBIDDEN" && action !== "generate") toast.error(action === "export" ? "Export refused" : "Summary not opened", { description: "Your access has changed. Nothing was shown or exported." })
    else if (action === "generate") toast.error("The summary could not be generated", { description: "Nothing was saved. Try again." })
  }

  const generate = async (regenerates?: string) => {
    setGenerating(true)
    setProblem(null)
    const ctx = { correlationId: newCorrelationId() }
    try {
      const summary = await adapter.generateLeadershipSummary(ctx, range, regenerates ?? null)
      setActive(summary)
      list.refetch()
      toast.success(regenerates ? "Summary regenerated" : "Summary generated and saved", { description: "Every statement cites its source. It is saved under Saved summaries." })
    } catch (err) {
      fail("generate", err, ctx.correlationId)
    } finally {
      setGenerating(false)
    }
  }

  const open = async (summaryId: string) => {
    setOpening(summaryId)
    setProblem(null)
    const ctx = { correlationId: newCorrelationId() }
    try {
      setActive(await adapter.leadershipSummary(ctx, summaryId))
    } catch (err) {
      setActive(null)
      fail("open", err, ctx.correlationId)
    } finally {
      setOpening(null)
    }
  }

  const exportActive = async () => {
    if (!active) return
    setExporting(true)
    setProblem(null)
    const ctx = { correlationId: newCorrelationId() }
    try {
      const doc = await adapter.exportLeadershipSummary(ctx, active.summaryId)
      setExported(doc)
      toast.success("Export ready", { description: "Access was re-checked just now. Print it or save it as a PDF." })
    } catch (err) {
      fail("export", err, ctx.correlationId)
    } finally {
      setExporting(false)
    }
  }

  const items = list.status === "success" ? list.data : []
  return (
    <div data-testid="leadership-summaries" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button data-testid="generate-leadership-summary" onClick={() => void generate()} isDisabled={generating} variant="primary" icon={<Icon icon={Sparkles} />} label={generating ? "Generating…" : "Generate leadership summary"} />
        <Text type="supporting">For {range.from} to {range.to}. Saved automatically, with its scope and data-through date.</Text>
      </div>

      {problem?.action === "generate" && <ErrorState error={problem.error} onRetry={() => void generate()} />}
      {problem && problem.action !== "generate" && problem.error.code === "FORBIDDEN" && <AccessChanged action={problem.action} />}
      {problem && problem.action !== "generate" && problem.error.code !== "FORBIDDEN" && <ErrorState error={problem.error} onRetry={problem.action === "export" ? () => void exportActive() : undefined} />}

      {generating && !active && <div data-testid="summary-generating" aria-busy="true"><Skeleton height={160} radius={4} /></div>}

      {active && <SummaryView summary={active} onExport={() => void exportActive()} onRegenerate={() => void generate(active.summaryId)} exporting={exporting} busy={generating} />}

      <section aria-label="Saved summaries" data-testid="saved-summaries" className="flex flex-col gap-2">
        <Heading level={3}>Saved summaries</Heading>
        {list.status === "loading" ? (
          <div aria-busy="true"><Skeleton height={64} radius={3} /></div>
        ) : list.status === "error" ? (
          <ErrorState error={list.error} onRetry={list.refetch} />
        ) : items.length === 0 ? (
          <EmptyState title="No saved summaries yet" actions={<span />}>Generate one for the date range above. It is saved with its scope, so you can reopen and export it.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li key={item.summaryId} data-testid="saved-summary" data-accessible={item.accessible}>
                <Card variant={item.accessible ? "default" : "muted"} padding={3} className="flex flex-wrap items-center justify-between gap-3">
                  {item.accessible ? (
                    <>
                      <div className="min-w-0">
                        <Text as="p" weight="medium" className="break-words">{item.title}</Text>
                        <Text as="p" type="supporting">Generated {formatInstant(item.generatedAt)}{item.stale ? " · newer data available" : ""}</Text>
                      </div>
                      <Button data-testid="open-summary" isDisabled={opening === item.summaryId} onClick={() => void open(item.summaryId)} variant="secondary" label={opening === item.summaryId ? "Opening…" : "Open"} />
                    </>
                  ) : (
                    <>
                      <Text type="supporting" className="flex min-w-0 items-center gap-2"><Icon icon={Lock} size="sm" /><span data-testid="summary-locked">Generated {formatInstant(item.generatedAt)} · no longer available to you</span></Text>
                      <Button data-testid="open-summary" onClick={() => void open(item.summaryId)} variant="secondary" label="Try to open" />
                    </>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Drawer isOpen={exported !== null} onOpenChange={(o) => !o && setExported(null)} label="Leadership summary export" width="42rem" data-testid="export-sheet">
        <DrawerHeader
          title="Leadership summary export"
          subtitle="Created after your access was re-checked. Only this document prints."
          onOpenChange={(o) => !o && setExported(null)}
        />
          <div className="flex flex-col gap-4 px-4 pb-6">
            <Button data-testid="print-summary" className="w-fit" onClick={() => window.print()} variant="primary" icon={<Icon icon={Printer} />} label="Print or save as PDF" />
            {exported && (
              <div data-testid="leadership-export-preview" className="export-preview flex flex-col gap-3 rounded-xl border bg-background p-4 text-sm [&_dd]:font-medium [&_dl]:grid [&_dl]:gap-x-6 [&_dl]:gap-y-2 [&_dl]:sm:grid-cols-2 [&_dt]:text-xs [&_dt]:text-muted-foreground [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-semibold [&_li]:mb-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5">
                <LeadershipDocumentBody doc={exported} />
              </div>
            )}
          </div>
      </Drawer>
      {exported && <LeadershipPrintDocument doc={exported} />}
    </div>
  )
}
