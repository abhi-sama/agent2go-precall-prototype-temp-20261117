"use client"

import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ChevronDown, ChevronsUpDown, Download, Lock, Rows3 } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { Expand } from "@/components/motion/expand"
import { SourceFact } from "@/components/provenance/provenance"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { RowSetItem } from "@/lib/chat/events"
import { useDataAdapter } from "@/lib/data/data-provider"
import { toDataError, type ChatRowColumn, type ChatRowSortDir, type ChatRowsPage, type DataError } from "@/lib/data/types"
import { useQuery } from "@/lib/data/use-query"
import { newCorrelationId } from "@/lib/log/logger"
import { downloadText } from "@/lib/provenance"
import { cn } from "@/lib/utils"

const PAGE_SIZE = 25
const fmt = (n: number) => n.toLocaleString("en-US")

interface Sort {
  by: string
  dir: ChatRowSortDir
}

/**
 * The rows behind a count, share or chart, collapsed by default (spec #63, stories 12 to 14; docs/adr/0015).
 *
 * The control appears only when the agent described row sets, which it does only for viewers with record-level
 * access. Nothing is fetched while it is closed. The table is read from the BE by run and row-set id under the viewer's
 * RLS, sorted and paged on the server, and its total is compared with the figure the answer stated. Export re-checks
 * access and the export permission on the server and is recorded in the access audit.
 */
export function AnswerRows({ runId, rowSets }: { runId: string; rowSets: RowSetItem[] }) {
  const [open, setOpen] = React.useState(false)
  const [selected, setSelected] = React.useState(rowSets[0]?.rowSetId ?? "")
  const panelId = React.useId()
  if (rowSets.length === 0) return null
  const current = rowSets.find((r) => r.rowSetId === selected) ?? rowSets[0]
  return (
    <section aria-label="Rows behind this answer" data-testid="answer-rows" className="flex min-w-0 flex-col gap-2">
      <div>
        <Button
          type="button"
          variant="outline"
          data-testid="answer-rows-toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className="press"
        >
          <Rows3 aria-hidden />
          {open ? "Hide rows" : "Show rows"}
          <ChevronDown aria-hidden className={cn("transition-transform duration-(--duration-base) ease-(--ease-out) motion-reduce:transition-none", open && "rotate-180")} />
        </Button>
      </div>
      <div id={panelId}>
        <Expand open={open}>
          <RowsPanel runId={runId} rowSets={rowSets} current={current} onSelect={setSelected} />
        </Expand>
      </div>
    </section>
  )
}

function RowsPanel({ runId, rowSets, current, onSelect }: { runId: string; rowSets: RowSetItem[]; current: RowSetItem; onSelect: (id: string) => void }) {
  const adapter = useDataAdapter()
  const [sort, setSort] = React.useState<Sort | null>(null)
  const [offset, setOffset] = React.useState(0)
  const [exporting, setExporting] = React.useState(false)
  const [exported, setExported] = React.useState<string | null>(null)
  const [exportDenied, setExportDenied] = React.useState(false)

  const key = `${runId}:${current.rowSetId}:${sort?.by ?? "-"}:${sort?.dir ?? "-"}:${offset}`
  const query = useQuery("chatAnswerRows", key, (ctx) =>
    adapter.chatAnswerRows(ctx, { runId, rowSetId: current.rowSetId, sortBy: sort?.by, sortDir: sort?.dir, offset, limit: PAGE_SIZE }),
  )
  // Keep the page that was showing while the next sort or page loads, so the table does not collapse and jump.
  const [kept, setKept] = React.useState<ChatRowsPage | null>(null)
  if (query.status === "success" && kept !== query.data) setKept(query.data)
  const page = query.status === "success" ? query.data : kept?.rowSetId === current.rowSetId ? kept : null

  const choose = (id: string) => {
    onSelect(id)
    setSort(null)
    setOffset(0)
    setExported(null)
    setExportDenied(false)
    setKept(null)
  }
  const sortBy = (column: ChatRowColumn) => {
    const active = page?.sortBy === column.key
    const dir: ChatRowSortDir = active ? (page?.sortDir === "ASC" ? "DESC" : "ASC") : column.type === "TEXT" ? "ASC" : "DESC"
    setSort({ by: column.key, dir })
    setOffset(0)
  }
  const doExport = async () => {
    if (exporting) return
    setExporting(true)
    setExported(null)
    try {
      const file = await adapter.exportChatRows({ correlationId: newCorrelationId() }, { runId, rowSetId: current.rowSetId, sortBy: page?.sortBy, sortDir: page?.sortDir })
      downloadText(file.fileName, file.content, file.mimeType)
      const note = `${fmt(file.rowCount)} ${file.rowCount === 1 ? "row" : "rows"} exported${file.truncated ? ` (the first ${fmt(file.rowCount)} of ${fmt(file.total)})` : ""}. The export was recorded in the access audit.`
      setExported(note)
      toast.success("Rows exported", { description: "The export was recorded in the access audit." })
    } catch (err) {
      const error = toDataError(err)
      if (error.code === "FORBIDDEN") setExportDenied(true)
      toast.error(error.code === "FORBIDDEN" ? "Export is not permitted for your role" : "Rows could not be exported", {
        description: error.code === "FORBIDDEN" ? "Nothing was exported." : "Try again after checking your connection.",
      })
    } finally {
      setExporting(false)
    }
  }

  const canExport = (page?.canExport ?? true) && !exportDenied
  return (
    <SourceFact
      title="Rows behind this answer"
      data-testid="answer-rows-panel"
      meta={<span>Read from the source records now, limited to your access.</span>}
    >
      {rowSets.length > 1 && (
        <div role="group" aria-label="Which figure's rows" className="mb-3 flex flex-wrap gap-2">
          {rowSets.map((r) => {
            const on = r.rowSetId === current.rowSetId
            return (
              <button
                key={r.rowSetId}
                type="button"
                aria-pressed={on}
                data-testid="row-set-option"
                data-row-set={r.rowSetId}
                data-count={r.count}
                onClick={() => choose(r.rowSetId)}
                className={cn(
                  "min-h-8 rounded-full border px-3 py-1 text-xs font-medium focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none pointer-coarse:min-h-11",
                  on ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground hover:bg-muted",
                )}
              >
                {r.label} · <span className="tabular-nums">{fmt(r.count)}</span>
              </button>
            )
          })}
        </div>
      )}

      {query.status === "error" && !page ? (
        <RowsError error={query.error} onRetry={query.refetch} />
      ) : page === null ? (
        <div data-testid="answer-rows-loading" className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <div className={cn("flex flex-col gap-3", query.status === "loading" && "opacity-60")} aria-busy={query.status === "loading"}>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p data-testid="answer-rows-summary" className="text-muted-foreground">
              {page.definition} <span className="whitespace-nowrap">{page.scope} · {page.period}</span>
            </p>
          </div>
          <p
            data-testid="answer-rows-match"
            data-match={page.total === page.answerCount}
            className={cn("flex items-start gap-2 text-sm", page.total !== page.answerCount && "text-warning")}
          >
            {page.total === page.answerCount ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />}
            {page.total === page.answerCount ? (
              <span>
                <strong className="tabular-nums">{fmt(page.total)}</strong> {current.unit}, matching the figure in the answer.
              </span>
            ) : (
              <span>
                The data changed since this answer: it said <strong className="tabular-nums">{fmt(page.answerCount)}</strong>, there are{" "}
                <strong className="tabular-nums">{fmt(page.total)}</strong> {current.unit} now.
              </span>
            )}
          </p>

          {page.rows.length === 0 ? (
            <p data-testid="answer-rows-empty" role="status" className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
              No rows are in your access for this figure now.
            </p>
          ) : (
            <RowsTable page={page} onSort={sortBy} />
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Pager page={page} onPage={setOffset} />
            <div className="flex flex-col items-end gap-1">
              {canExport ? (
                <Button type="button" variant="outline" data-testid="answer-rows-export" disabled={exporting} onClick={doExport}>
                  <Download aria-hidden />
                  {exporting ? "Checking access…" : "Export CSV"}
                </Button>
              ) : (
                <p data-testid="answer-rows-export-denied" className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Lock className="size-3.5" aria-hidden />
                  Export is not permitted for your role.
                </p>
              )}
            </div>
          </div>
          {exported && (
            <p data-testid="answer-rows-exported" role="status" className="text-xs text-muted-foreground">
              {exported}
            </p>
          )}
        </div>
      )}
    </SourceFact>
  )
}

function RowsError({ error, onRetry }: { error: DataError; onRetry: () => void }) {
  const text =
    error.code === "FORBIDDEN"
      ? "Rows are not available for your role."
      : error.code === "NOT_FOUND"
        ? "These rows are no longer available to you."
        : "The rows could not be loaded."
  return (
    <div data-testid="answer-rows-error" role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm">
      <span>{text}</span>
      {error.code !== "FORBIDDEN" && error.code !== "NOT_FOUND" && (
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

function SortIcon({ active, dir }: { active: boolean; dir: ChatRowSortDir }) {
  if (!active) return <ChevronsUpDown className="size-3.5 opacity-60" aria-hidden />
  return dir === "ASC" ? <ArrowUp className="size-3.5" aria-hidden /> : <ArrowDown className="size-3.5" aria-hidden />
}

function RowsTable({ page, onSort }: { page: ChatRowsPage; onSort: (column: ChatRowColumn) => void }) {
  return (
    // A region that scrolls sideways on narrow screens so the page itself never does; focusable so a keyboard can scroll it.
    <div
      role="region"
      aria-label={`${page.label}, ${fmt(page.total)} rows`}
      tabIndex={0}
      data-testid="answer-rows-scroll"
      // Rows scroll beneath the sticky header and composer like any long list: a deliberate overlap, not a layout defect.
      data-layout-ok="overlap"
      className="max-w-full overflow-x-auto rounded-xl border focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <table data-testid="answer-rows-table" data-sort-by={page.sortBy} data-sort-dir={page.sortDir} className="w-full min-w-[34rem] border-collapse text-left text-sm">
        <caption className="sr-only">
          {page.label}: rows {fmt(page.offset + 1)} to {fmt(page.offset + page.rows.length)} of {fmt(page.total)}, sorted by {page.columns.find((c) => c.key === page.sortBy)?.label}
        </caption>
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            {page.columns.map((c) => {
              const active = page.sortBy === c.key
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (page.sortDir === "ASC" ? "ascending" : "descending") : "none"}
                  className={cn("p-0 font-semibold whitespace-nowrap", c.type === "NUMBER" && "text-right")}
                >
                  <button
                    type="button"
                    data-testid="answer-rows-sort"
                    data-column={c.key}
                    onClick={() => onSort(c)}
                    className={cn(
                      "inline-flex min-h-9 w-full items-center gap-1 px-3 py-1 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none pointer-coarse:min-h-11",
                      c.type === "NUMBER" ? "justify-end" : "justify-start",
                    )}
                  >
                    {c.label}
                    <SortIcon active={active} dir={page.sortDir} />
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody className="divide-y">
          {page.rows.map((r) => (
            <tr key={r.id} data-testid="answer-row" data-row-id={r.id}>
              {r.cells.map((cell, i) => {
                const c = page.columns[i]
                return i === 0 ? (
                  <th key={c.key} scope="row" className="sticky left-0 bg-card px-3 py-2 text-left font-mono text-xs font-medium whitespace-nowrap">
                    {cell}
                  </th>
                ) : (
                  <td
                    key={c.key}
                    data-column={c.key}
                    className={cn("px-3 py-2 align-top", c.type === "NUMBER" && "text-right tabular-nums", c.type === "DATE" && "whitespace-nowrap tabular-nums", c.type === "TEXT" && "min-w-24 max-w-[28rem]")}
                  >
                    {cell ?? <span className="text-muted-foreground" aria-label="not recorded">—</span>}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Pager({ page, onPage }: { page: ChatRowsPage; onPage: (offset: number) => void }) {
  const from = page.total === 0 ? 0 : page.offset + 1
  const to = page.offset + page.rows.length
  return (
    <nav aria-label="Row pages" className="flex items-center gap-2">
      <Button type="button" size="sm" variant="outline" data-testid="answer-rows-prev" disabled={page.offset === 0} onClick={() => onPage(Math.max(0, page.offset - page.limit))}>
        Previous
      </Button>
      <span data-testid="answer-rows-range" className="text-xs whitespace-nowrap text-muted-foreground tabular-nums" aria-live="polite">
        {fmt(from)}–{fmt(to)} of {fmt(page.total)}
      </span>
      <Button type="button" size="sm" variant="outline" data-testid="answer-rows-next" disabled={to >= page.total} onClick={() => onPage(page.offset + page.limit)}>
        Next
      </Button>
    </nav>
  )
}
