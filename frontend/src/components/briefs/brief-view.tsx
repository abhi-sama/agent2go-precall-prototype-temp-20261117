"use client"

import { CalendarClock, Check, ClipboardList, Database, FileText, Pencil, Plus, Printer, RefreshCw, Save, Trash2, Undo2 } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { CitationSheet } from "@/components/chat/citation-sheet"
import { AiSummary, CitationChip, SourceFact, Suggestion } from "@/components/provenance/provenance"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { CitationItem } from "@/lib/chat/events"
import { useDataAdapter } from "@/lib/data/data-provider"
import { toDataError, type BriefEvidence, type BriefExport, type BriefItem, type BriefStatement, type PreCallBrief } from "@/lib/data/types"
import { newCorrelationId } from "@/lib/log/logger"
import { cn } from "@/lib/utils"
import { formatBriefDay, formatBriefTime } from "./format"
import { BriefPrintDocument } from "./brief-print-document"

const MAX_ITEMS = 12
const MAX_TEXT = 600

interface Draft {
  key: string
  itemId: string | null
  text: string
  detail: string
  origin: BriefItem["origin"]
  edited: boolean
  evidenceIds: string[]
}

const toDraft = (item: BriefItem): Draft => ({
  key: item.itemId,
  itemId: item.itemId,
  text: item.text,
  detail: item.detail ?? "",
  origin: item.origin,
  edited: item.edited,
  evidenceIds: item.evidenceIds,
})

const sameDrafts = (a: Draft[], b: Draft[]) =>
  a.length === b.length && a.every((d, i) => d.itemId === b[i].itemId && d.text === b[i].text && d.detail === b[i].detail)

function Citations({
  ids,
  evidence,
  onOpen,
}: {
  ids: string[]
  evidence: Map<string, BriefEvidence>
  onOpen: (citation: CitationItem) => void
}) {
  if (ids.length === 0) return null
  return (
    <span className="mt-1.5 flex flex-wrap gap-1.5" data-testid="citations">
      {ids.map((id) => {
        const record = evidence.get(id)
        if (!record) return null
        return (
          <CitationChip
            key={id}
            data-testid={`cite-${record.recordId}`}
            onOpen={() => onOpen({ dataset: record.dataset, recordId: record.recordId, label: record.label })}
          >
            <FileText className="size-3" aria-hidden />
            {record.label}
          </CitationChip>
        )
      })}
    </span>
  )
}

function Statements({
  title,
  items,
  evidence,
  onOpen,
  emptyNote,
  testId,
}: {
  title: string
  items: BriefStatement[]
  evidence: Map<string, BriefEvidence>
  onOpen: (c: CitationItem) => void
  emptyNote: string
  testId: string
}) {
  return (
    <div data-testid={testId}>
      <h4 className="text-sm font-semibold">{title}</h4>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">{emptyNote}</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {items.map((s) => (
            <li key={s.statementId} data-testid="statement" data-evidence-count={s.evidenceIds.length}>
              <p className="leading-relaxed">{s.text}</p>
              <Citations ids={s.evidenceIds} evidence={evidence} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Origin({ draft }: { draft: Draft }) {
  if (draft.origin === "USER") return <Badge variant="outline">Added by you</Badge>
  return draft.edited ? <Badge variant="secondary">Generated · edited</Badge> : <Badge variant="outline">Generated</Badge>
}

function EditableList({
  label,
  testId,
  drafts,
  setDrafts,
  evidence,
  onOpen,
  withDetail,
}: {
  label: string
  testId: string
  drafts: Draft[]
  setDrafts: (next: Draft[]) => void
  evidence: Map<string, BriefEvidence>
  onOpen: (c: CitationItem) => void
  withDetail: boolean
}) {
  const [editing, setEditing] = React.useState<string | null>(null)
  const update = (key: string, patch: Partial<Draft>) => setDrafts(drafts.map((d) => (d.key === key ? { ...d, ...patch } : d)))
  const add = () => {
    const key = `new-${crypto.randomUUID()}`
    setDrafts([...drafts, { key, itemId: null, text: "", detail: "", origin: "USER", edited: false, evidenceIds: [] }])
    setEditing(key)
  }
  return (
    <div data-testid={testId}>
      {drafts.length === 0 && <p className="text-sm text-muted-foreground">Nothing here yet. Add your own item.</p>}
      <ol className="space-y-3">
        {drafts.map((d, index) => {
          const open = editing === d.key
          return (
            <li key={d.key} data-testid={`${testId}-item`} className="rounded-xl bg-background/70 p-3">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-suggest/14 text-xs font-semibold text-suggest tabular-nums">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  {open ? (
                    <div className="space-y-2">
                      <textarea
                        autoFocus
                        aria-label={`${label} text`}
                        value={d.text}
                        maxLength={MAX_TEXT}
                        onChange={(e) => update(d.key, { text: e.target.value })}
                        rows={2}
                        className="min-h-14 w-full resize-y rounded-lg border bg-background px-3 py-2 text-base focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
                      />
                      {withDetail && (
                        <textarea
                          aria-label={`${label} detail`}
                          value={d.detail}
                          maxLength={800}
                          onChange={(e) => update(d.key, { detail: e.target.value })}
                          rows={2}
                          placeholder="Detail (optional)"
                          className="min-h-14 w-full resize-y rounded-lg border bg-background px-3 py-2 text-base focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
                        />
                      )}
                    </div>
                  ) : (
                    <>
                      <p className="leading-relaxed font-medium">{d.text || <span className="text-muted-foreground">Empty item</span>}</p>
                      {d.detail && <p className="mt-0.5 text-sm text-muted-foreground">{d.detail}</p>}
                    </>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <Origin draft={d} />
                    <Citations ids={d.evidenceIds} evidence={evidence} onOpen={onOpen} />
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={open ? `Done editing ${label.toLowerCase()} ${index + 1}` : `Edit ${label.toLowerCase()} ${index + 1}`}
                    aria-pressed={open}
                    onClick={() => setEditing(open ? null : d.key)}
                  >
                    {open ? <Check aria-hidden /> : <Pencil aria-hidden />}
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
                    onClick={() => setDrafts(drafts.filter((x) => x.key !== d.key))}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </div>
            </li>
          )
        })}
      </ol>
      <Button type="button" variant="outline" className="mt-3" disabled={drafts.length >= MAX_ITEMS} onClick={add}>
        <Plus aria-hidden /> Add {label.toLowerCase()}
      </Button>
    </div>
  )
}

/**
 * A saved pre-call brief. Source facts, AI-written statements (each with its source records) and
 * editable suggestions (discussion prompts and agenda) are kept visually and verbally apart.
 */
export function BriefView({
  brief,
  onRegenerate,
  regenerating,
  onUpdated,
}: {
  brief: PreCallBrief
  onRegenerate: () => void
  regenerating: boolean
  onUpdated: (brief: PreCallBrief) => void
}) {
  const adapter = useDataAdapter()
  const [objective, setObjective] = React.useState(brief.objective)
  const [prompts, setPrompts] = React.useState<Draft[]>(() => brief.prompts.map(toDraft))
  const [agenda, setAgenda] = React.useState<Draft[]>(() => brief.agenda.map(toDraft))
  const [saving, setSaving] = React.useState(false)
  const [exporting, setExporting] = React.useState(false)
  const [printDocument, setPrintDocument] = React.useState<BriefExport | null>(null)
  const [citation, setCitation] = React.useState<CitationItem | null>(null)
  const evidence = React.useMemo(() => new Map(brief.evidence.map((e) => [e.evidenceId, e])), [brief.evidence])

  const savedPrompts = React.useMemo(() => brief.prompts.map(toDraft), [brief.prompts])
  const savedAgenda = React.useMemo(() => brief.agenda.map(toDraft), [brief.agenda])
  const objectiveValid = objective.trim().length >= 3 && objective.trim().length <= 500
  const dirty = objective !== brief.objective || !sameDrafts(prompts, savedPrompts) || !sameDrafts(agenda, savedAgenda)
  const cleaned = (drafts: Draft[]) => drafts.filter((d) => d.text.trim().length > 0)

  const discard = () => {
    setObjective(brief.objective)
    setPrompts(savedPrompts)
    setAgenda(savedAgenda)
  }

  React.useEffect(() => {
    if (!printDocument) return
    const timer = window.setTimeout(() => {
      window.print()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [printDocument])

  const save = async () => {
    if (!dirty || saving || !objectiveValid) return
    setSaving(true)
    try {
      const toInput = (d: Draft) => ({ itemId: d.itemId, text: d.text.trim(), detail: d.detail.trim() || null })
      const updated = await adapter.saveBriefEdits(
        { correlationId: newCorrelationId() },
        { briefId: brief.briefId, objective: objective.trim(), prompts: cleaned(prompts).map(toInput), agenda: cleaned(agenda).map(toInput) },
      )
      onUpdated(updated)
      toast.success("Changes saved", { description: "Your edits are saved with the brief. Generated items stay marked as generated." })
    } catch (err) {
      const error = toDataError(err)
      toast.error(error.code === "FORBIDDEN" ? "You no longer have access to this HCP" : "Changes were not saved", {
        description: error.code === "FORBIDDEN" ? "The brief cannot be edited." : "Your edits are still on screen. Try again.",
      })
    } finally {
      setSaving(false)
    }
  }

  const exportForPrint = async () => {
    if (dirty || exporting) return
    setExporting(true)
    try {
      const snapshot = await adapter.exportBrief({ correlationId: newCorrelationId() }, brief.briefId)
      setPrintDocument(snapshot)
      toast.success("Print dialog opened", { description: "The export was recorded in the access audit." })
    } catch (err) {
      const error = toDataError(err)
      toast.error(error.code === "FORBIDDEN" ? "You no longer have access to this HCP" : "Brief could not be exported", {
        description: error.code === "FORBIDDEN" ? "Nothing was exported." : "Try again after checking your connection.",
      })
    } finally {
      setExporting(false)
    }
  }

  const stub = brief.modelMode === "stub"

  return (
    <article data-testid="brief" data-brief-id={brief.briefId} className="@container space-y-4 animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none">
      <header className="rounded-2xl border bg-card p-5 shadow-card sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Pre-call brief</p>
            <h2 data-testid="brief-hcp-name" className="mt-1 text-2xl font-semibold tracking-tight break-words">
              {brief.hcpName.value ?? "HCP name not recorded"}
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" data-testid="brief-model-mode">
              {stub ? "Written without a model (local stub)" : "Written by AI from your records"}
            </Badge>
            <Button data-testid="brief-export" variant="outline" onClick={exportForPrint} disabled={exporting || dirty} aria-describedby={dirty ? "brief-export-save-first" : undefined}>
              <Printer aria-hidden /> {exporting ? "Preparing export…" : "Print / Save PDF"}
            </Button>
          </div>
        </div>

        <label className="mt-4 block text-sm font-medium" htmlFor="brief-objective">
          Call objective
        </label>
        <textarea
          id="brief-objective"
          data-testid="brief-objective"
          value={objective}
          maxLength={500}
          rows={2}
          onChange={(e) => setObjective(e.target.value)}
          aria-invalid={!objectiveValid}
          className="mt-1 min-h-14 w-full resize-y rounded-lg border bg-background px-3 py-2 text-base focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
        />
        {dirty && <p id="brief-export-save-first" className="mt-1 text-sm text-muted-foreground">Save or discard your edits before exporting the saved brief.</p>}

        <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm @xl:grid-cols-2 @4xl:grid-cols-4">
          <div>
            <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Scope</dt>
            <dd data-testid="brief-scope" className="mt-0.5 font-medium">{brief.scopeLabel}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Data through</dt>
            <dd data-testid="brief-data-through" className="mt-0.5 font-medium tabular-nums">{formatBriefDay(brief.dataThrough)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Generated</dt>
            <dd data-testid="brief-generated-at" className="mt-0.5 font-medium tabular-nums">{formatBriefTime(brief.generatedAt)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Last interaction</dt>
            <dd className="mt-0.5 font-medium tabular-nums">{formatBriefDay(brief.lastInteractionDate)}</dd>
          </div>
        </dl>
      </header>

      {brief.stale && (
        <div
          role="status"
          data-testid="brief-stale"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4 animate-in fade-in duration-200 motion-reduce:animate-none"
        >
          <div className="flex items-start gap-3">
            <CalendarClock className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
            <div>
              <p className="font-semibold">Newer data available - regenerate</p>
              <p className="text-sm text-muted-foreground">
                {brief.staleReasons.includes("HCP_DATA_CHANGED")
                  ? "Records for this HCP changed after this brief was written."
                  : "A newer data load arrived after this brief was written."}
                {brief.currentDataThrough ? ` Data is now through ${formatBriefDay(brief.currentDataThrough)}.` : ""}
              </p>
            </div>
          </div>
          <Button data-testid="brief-regenerate" onClick={onRegenerate} disabled={regenerating}>
            <RefreshCw className={cn(regenerating && "animate-spin motion-reduce:animate-none")} aria-hidden />
            {regenerating ? "Regenerating…" : "Regenerate brief"}
          </Button>
        </div>
      )}

      {brief.droppedStatements > 0 && (
        <p data-testid="brief-dropped" className="text-sm text-muted-foreground">
          {brief.droppedStatements} generated statement{brief.droppedStatements === 1 ? " was" : "s were"} left out because{" "}
          {brief.droppedStatements === 1 ? "it" : "they"} could not be tied to a source record.
        </p>
      )}

      <div className="grid gap-4 @2xl:grid-cols-2">
        <div className="space-y-5">
          <SourceFact
            title="Counted from your records"
            meta={<span>Counted by database queries, not by the AI. Open any record to see its source.</span>}
          >
            <dl data-testid="brief-facts" className="grid grid-cols-2 gap-3">
              {brief.facts.map((f) => (
                <div key={f.label}>
                  <dt className="text-xs text-muted-foreground">{f.label}</dt>
                  <dd className="font-semibold tabular-nums">{f.value}</dd>
                </div>
              ))}
            </dl>
          </SourceFact>

          <AiSummary
            title="What the records show"
            meta={
              <span>
                {stub ? "Written by code from the records, not by a model." : "Generated by AI."} Every statement links to the call or response it comes from.
              </span>
            }
          >
            <div className="space-y-5">
              <Statements testId="brief-engagement" title="Previous engagement" items={brief.engagement} evidence={evidence} onOpen={setCitation} emptyNote="No previous calls are recorded for this HCP." />
              <Statements testId="brief-perspectives" title="Recorded perspectives" items={brief.perspectives} evidence={evidence} onOpen={setCitation} emptyNote="No recorded responses are available." />
              <Statements testId="brief-followups" title="Possible follow-ups" items={brief.followUps} evidence={evidence} onOpen={setCitation} emptyNote="No follow-up topics are recorded." />
            </div>
          </AiSummary>
        </div>

        <div className="space-y-5">
          <Suggestion
            title="Discussion prompts"
            meta={<span data-testid="prompts-label">Generated suggestions you can edit, remove or add to. Not confirmed commitments.</span>}
          >
            <EditableList label="Prompt" testId="brief-prompts" drafts={prompts} setDrafts={setPrompts} evidence={evidence} onOpen={setCitation} withDetail={false} />
          </Suggestion>

          <Suggestion
            title="Suggested agenda"
            meta={<span data-testid="agenda-label">Generated from your objective and the records. Fully editable.</span>}
          >
            <EditableList label="Agenda item" testId="brief-agenda" drafts={agenda} setDrafts={setAgenda} evidence={evidence} onOpen={setCitation} withDetail />
          </Suggestion>
        </div>
      </div>

      <div className="grid gap-4 @2xl:grid-cols-2">
        <section data-testid="brief-missing" aria-labelledby="brief-missing-h" className="rounded-2xl border bg-card p-5">
          <h3 id="brief-missing-h" className="flex items-center gap-2 font-semibold">
            <ClipboardList className="size-4 text-muted-foreground" aria-hidden /> Missing information
          </h3>
          {brief.missing.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Nothing is missing that the brief depends on.</p>
          ) : (
            <ul className="mt-2 space-y-1.5 text-sm">
              {brief.missing.map((m) => (
                <li key={m.code} className="flex gap-2"><span aria-hidden>•</span>{m.message}</li>
              ))}
            </ul>
          )}
        </section>

        <section data-testid="brief-evidence" aria-labelledby="brief-evidence-h" className="rounded-2xl border bg-card p-5">
          <h3 id="brief-evidence-h" className="flex items-center gap-2 font-semibold">
            <Database className="size-4 text-muted-foreground" aria-hidden /> Supporting records
            <span className="text-sm font-normal text-muted-foreground tabular-nums">({brief.evidence.length})</span>
          </h3>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {brief.evidence.map((e) => (
              <li key={e.evidenceId}>
                <button
                  type="button"
                  onClick={() => setCitation({ dataset: e.dataset, recordId: e.recordId, label: e.label })}
                  className="inline-flex min-h-8 items-center gap-1 rounded-md border bg-background px-2 text-xs transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11 pointer-coarse:px-3"
                >
                  <FileText className="size-3" aria-hidden />
                  {e.label}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {dirty && (
        <div
          data-testid="brief-save-bar"
          className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-3 shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none"
        >
          <p className="text-sm font-medium" role="status">You have unsaved changes{objectiveValid ? "" : " · the objective needs at least 3 characters"}</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={discard} disabled={saving}><Undo2 aria-hidden /> Discard</Button>
            <Button data-testid="brief-save" onClick={save} disabled={saving || !objectiveValid}><Save aria-hidden /> {saving ? "Saving…" : "Save changes"}</Button>
          </div>
        </div>
      )}

      <CitationSheet citation={citation} onClose={() => setCitation(null)} />
      {printDocument && <BriefPrintDocument brief={printDocument} />}
    </article>
  )
}
