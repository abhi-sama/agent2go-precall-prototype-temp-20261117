"use client"

import { Banner } from "@astryxdesign/core/Banner"
import { Button } from "@astryxdesign/core/Button"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { Skeleton } from "@astryxdesign/core/Skeleton"
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from "@astryxdesign/core/Table"
import { Text } from "@astryxdesign/core/Text"
import { ToggleButton } from "@astryxdesign/core/ToggleButton"
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden"
import { VStack } from "@astryxdesign/core/VStack"
import { Download, Lock, Rows3 } from "lucide-react"
import * as React from "react"
import { Expand } from "@/components/motion/expand"
import { SourceFact } from "@/components/provenance/provenance"
import { useAppToast } from "@/components/state/use-app-toast"
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
    <VStack as="section" aria-label="Rows behind this answer" data-testid="answer-rows" gap={2} className="min-w-0">
      <HStack>
        <Button
          variant="secondary"
          data-testid="answer-rows-toggle"
          aria-expanded={open}
          aria-controls={panelId}
          label={open ? "Hide rows" : "Show rows"}
          icon={<Icon icon={Rows3} />}
          endContent={<Icon icon="chevronDown" className={cn("transition-transform duration-(--duration-base) ease-(--ease-out) motion-reduce:transition-none", open && "rotate-180")} />}
          onClick={() => setOpen((v) => !v)}
        />
      </HStack>
      <VStack id={panelId}>
        <Expand open={open}>
          <RowsPanel runId={runId} rowSets={rowSets} current={current} onSelect={setSelected} />
        </Expand>
      </VStack>
    </VStack>
  )
}

function RowsPanel({ runId, rowSets, current, onSelect }: { runId: string; rowSets: RowSetItem[]; current: RowSetItem; onSelect: (id: string) => void }) {
  const adapter = useDataAdapter()
  const toast = useAppToast()
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
  const matches = page !== null && page.total === page.answerCount
  return (
    <SourceFact
      title="Rows behind this answer"
      data-testid="answer-rows-panel"
      meta={<span>Read from the source records now, limited to your access.</span>}
    >
      {rowSets.length > 1 && (
        <HStack role="group" aria-label="Which figure's rows" gap={2} wrap="wrap" paddingBlockEnd={3}>
          {rowSets.map((r) => (
            <ToggleButton
              key={r.rowSetId}
              size="sm"
              isPressed={r.rowSetId === current.rowSetId}
              data-testid="row-set-option"
              data-row-set={r.rowSetId}
              data-count={r.count}
              label={`${r.label} · ${fmt(r.count)}`}
              onPressedChange={() => choose(r.rowSetId)}
            />
          ))}
        </HStack>
      )}

      {query.status === "error" && !page ? (
        <RowsError error={query.error} onRetry={query.refetch} />
      ) : page === null ? (
        <VStack data-testid="answer-rows-loading" gap={2} aria-busy="true">
          <Skeleton height="1.5rem" width="66%" />
          <Skeleton height="10rem" width="100%" />
        </VStack>
      ) : (
        <VStack gap={3} className={cn(query.status === "loading" && "opacity-60")} aria-busy={query.status === "loading"}>
          <Text as="p" type="supporting" data-testid="answer-rows-summary">
            {page.definition} <Text textWrap="nowrap" type="inherit">{page.scope} · {page.period}</Text>
          </Text>
          <HStack
            as="p"
            data-testid="answer-rows-match"
            data-match={page.total === page.answerCount}
            gap={2}
            align="start"
            className={cn(!matches && "text-warning")}
          >
            <Icon icon={matches ? "success" : "warning"} size="sm" color={matches ? "success" : "inherit"} />
            {matches ? (
              <Text>
                <Text weight="semibold" hasTabularNumbers>{fmt(page.total)}</Text> {current.unit}, matching the figure in the answer.
              </Text>
            ) : (
              <Text color="inherit">
                The data changed since this answer: it said <Text weight="semibold" hasTabularNumbers color="inherit">{fmt(page.answerCount)}</Text>, there are{" "}
                <Text weight="semibold" hasTabularNumbers color="inherit">{fmt(page.total)}</Text> {current.unit} now.
              </Text>
            )}
          </HStack>

          {page.rows.length === 0 ? (
            <Banner data-testid="answer-rows-empty" role="status" status="info" title="No rows are in your access for this figure now." collapsible={false} />
          ) : (
            <RowsTable page={page} onSort={sortBy} />
          )}

          <HStack gap={2} wrap="wrap" align="center" hAlign="between">
            <Pager page={page} onPage={setOffset} />
            <VStack gap={1} align="end">
              {canExport ? (
                <Button
                  variant="secondary"
                  data-testid="answer-rows-export"
                  isDisabled={exporting}
                  icon={<Icon icon={Download} />}
                  label={exporting ? "Checking access…" : "Export CSV"}
                  onClick={doExport}
                />
              ) : (
                <HStack as="p" data-testid="answer-rows-export-denied" gap={2} align="center">
                  <Icon icon={Lock} size="sm" color="secondary" />
                  <Text type="supporting">Export is not permitted for your role.</Text>
                </HStack>
              )}
            </VStack>
          </HStack>
          {exported && (
            <Text as="p" type="supporting" data-testid="answer-rows-exported" role="status">
              {exported}
            </Text>
          )}
        </VStack>
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
    <Banner
      data-testid="answer-rows-error"
      role="alert"
      status="error"
      title={text}
      collapsible={false}
      endContent={error.code !== "FORBIDDEN" && error.code !== "NOT_FOUND" ? <Button size="sm" variant="secondary" label="Try again" onClick={onRetry} /> : undefined}
    />
  )
}

function SortIcon({ active, dir }: { active: boolean; dir: ChatRowSortDir }) {
  if (!active) return <Icon icon="arrowsUpDown" size="xsm" color="tertiary" />
  return <Icon icon={dir === "ASC" ? "arrowUp" : "arrowDown"} size="xsm" />
}

function RowsTable({ page, onSort }: { page: ChatRowsPage; onSort: (column: ChatRowColumn) => void }) {
  const captionId = React.useId()
  return (
    // The Astryx Table scrolls sideways inside its own focusable, named group on narrow screens, so the page itself never does.
    // Rows scroll beneath the sticky header and composer like any long list: a deliberate overlap, not a layout defect.
    <VStack data-testid="answer-rows-scroll" data-layout-ok="overlap" isScrollable className="max-w-full">
      <VisuallyHidden>
        <Text id={captionId}>
          {page.label}: rows {fmt(page.offset + 1)} to {fmt(page.offset + page.rows.length)} of {fmt(page.total)}, sorted by {page.columns.find((c) => c.key === page.sortBy)?.label}
        </Text>
      </VisuallyHidden>
      <Table
        data-testid="answer-rows-table"
        data-sort-by={page.sortBy}
        data-sort-dir={page.sortDir}
        aria-label={`${page.label}, ${fmt(page.total)} rows`}
        aria-describedby={captionId}
        density="compact"
        verticalAlign="top"
        // Keeps the columns readable: below this the table scrolls sideways inside its own wrapper instead of squeezing cells.
        // (A style, not a class: Astryx sets the table's own minWidth inline.)
        style={{ minWidth: "34rem" }}
      >
        <TableHeader>
          <TableRow isHeaderRow>
            {page.columns.map((c) => {
              const active = page.sortBy === c.key
              return (
                <TableHeaderCell key={c.key} scope="col" aria-sort={active ? (page.sortDir === "ASC" ? "ascending" : "descending") : "none"}>
                  <HStack hAlign={c.type === "NUMBER" ? "end" : "start"}>
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid="answer-rows-sort"
                      data-column={c.key}
                      label={c.label}
                      endContent={<SortIcon active={active} dir={page.sortDir} />}
                      onClick={() => onSort(c)}
                    />
                  </HStack>
                </TableHeaderCell>
              )
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {page.rows.map((r) => (
            <TableRow key={r.id} data-testid="answer-row" data-row-id={r.id}>
              {r.cells.map((cell, i) => {
                const c = page.columns[i]
                return i === 0 ? (
                  <TableCell key={c.key} scope="row" role="rowheader" className="sticky left-0 min-w-36 bg-card whitespace-nowrap">
                    <Text type="code" weight="medium">{cell}</Text>
                  </TableCell>
                ) : (
                  <TableCell
                    key={c.key}
                    data-column={c.key}
                    className={cn(c.type === "NUMBER" && "min-w-16 text-right tabular-nums", c.type === "DATE" && "min-w-36 whitespace-nowrap tabular-nums", c.type === "TEXT" && "min-w-24 max-w-md")}
                  >
                    {cell ?? <Text color="secondary" aria-label="not recorded">—</Text>}
                  </TableCell>
                )
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </VStack>
  )
}

function Pager({ page, onPage }: { page: ChatRowsPage; onPage: (offset: number) => void }) {
  const from = page.total === 0 ? 0 : page.offset + 1
  const to = page.offset + page.rows.length
  return (
    <HStack as="nav" aria-label="Row pages" gap={2} align="center">
      <Button size="sm" variant="secondary" data-testid="answer-rows-prev" label="Previous" isDisabled={page.offset === 0} onClick={() => onPage(Math.max(0, page.offset - page.limit))} />
      <Text type="supporting" textWrap="nowrap" hasTabularNumbers data-testid="answer-rows-range" aria-live="polite">
        {fmt(from)}–{fmt(to)} of {fmt(page.total)}
      </Text>
      <Button size="sm" variant="secondary" data-testid="answer-rows-next" label="Next" isDisabled={to >= page.total} onClick={() => onPage(page.offset + page.limit)} />
    </HStack>
  )
}
