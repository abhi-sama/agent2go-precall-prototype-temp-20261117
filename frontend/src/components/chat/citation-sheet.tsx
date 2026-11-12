"use client"

import * as React from "react"
import { Download, Rows3 } from "lucide-react"
import { Button } from "@astryxdesign/core/Button"
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog"
import { HStack } from "@astryxdesign/core/HStack"
import { Layout, LayoutContent } from "@astryxdesign/core/Layout"
import { Section } from "@astryxdesign/core/Section"
import { Skeleton } from "@astryxdesign/core/Skeleton"
import { SourceFact } from "@/components/provenance/provenance"
import { ErrorState } from "@/components/state/states"
import { isAggregateCitation, type CitationItem } from "@/lib/chat/events"
import { buildFactCsv, downloadText } from "@/lib/provenance"
import { useDataAdapter } from "@/lib/data/data-provider"
import { useQuery } from "@/lib/data/use-query"

function CitationBody({ citation }: { citation: CitationItem }) {
  const adapter = useDataAdapter()
  const [showRows, setShowRows] = React.useState(false)
  const [sortDirection, setSortDirection] = React.useState<"asc" | "desc">("asc")
  const [exportRequest, setExportRequest] = React.useState(0)
  const record = useQuery("chatCitation", `${citation.dataset}:${citation.recordId}`, (ctx) =>
    adapter.chatCitation(ctx, citation.dataset, citation.recordId),
  )
  const exported = useQuery("chatCitationExport", `${citation.dataset}:${citation.recordId}:${exportRequest}`, (ctx) =>
    adapter.chatCitation(ctx, citation.dataset, citation.recordId, true), exportRequest > 0)

  React.useEffect(() => {
    if (exported.status !== "success") return
    downloadText(`${exported.data.recordId}.csv`, buildFactCsv(exported.data.fields), "text/csv;charset=utf-8")
  }, [exported])
  if (record.status === "loading") return <Skeleton data-testid="citation-loading" height={160} radius={3} />
  if (record.status === "error") {
    return record.error.code === "NOT_FOUND" ? (
      <p data-testid="citation-unavailable" role="status" className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
        This record is not available in your scope.
      </p>
    ) : (
      <ErrorState error={record.error} onRetry={record.refetch} />
    )
  }
  const r = record.data
  const rows = [...r.fields].sort((a, b) => sortDirection === "asc" ? a.label.localeCompare(b.label) : b.label.localeCompare(a.label))
  return (
    <SourceFact title={r.title}>
      <dl data-testid="citation-fields" className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt className="text-muted-foreground">Record</dt>
        <dd className="font-mono text-xs">{r.recordId}</dd>
        {r.fields.map((f) => (
          <React.Fragment key={f.label}>
            <dt className="text-muted-foreground">{f.label}</dt>
            <dd>{f.value}</dd>
          </React.Fragment>
        ))}
      </dl>
      <HStack gap={2} wrap="wrap">
        <Button label={showRows ? "Hide rows" : "Show rows"} variant="secondary" data-testid="show-rows" icon={<Rows3 aria-hidden />} onClick={() => setShowRows((value) => !value)} />
        <Button label={exportRequest > 0 && exported.status === "loading" ? "Checking access…" : "Export row"} variant="secondary" data-testid="export-rows" icon={<Download aria-hidden />} isDisabled={exportRequest > 0 && exported.status === "loading"} onClick={() => setExportRequest((request) => request + 1)} />
      </HStack>
      {showRows && (
        <Section variant="transparent" padding={0} dividers={["top", "bottom"]}>
          <table data-testid="chat-rows" className="w-full min-w-[28rem] text-left text-sm">
            <caption className="caption-top px-3 py-2 text-left text-xs text-muted-foreground">Exact source row, re-checked against your current access.</caption>
            <thead className="bg-muted/50 text-xs tracking-wide text-muted-foreground uppercase"><tr><th className="px-3 py-2 font-semibold" scope="col"><button type="button" onClick={() => setSortDirection((value) => value === "asc" ? "desc" : "asc")} className="min-h-11 text-left underline underline-offset-2">Field {sortDirection === "asc" ? "↑" : "↓"}</button></th><th className="px-3 py-2 font-semibold" scope="col">Value</th></tr></thead>
            <tbody className="divide-y">{rows.map((field) => <tr key={field.label} data-testid="chat-row"><th scope="row" className="px-3 py-2 text-left font-medium">{field.label}</th><td className="px-3 py-2">{field.value}</td></tr>)}</tbody>
          </table>
        </Section>
      )}
    </SourceFact>
  )
}

/**
 * An aggregate citation describes the set of responses a figure rests on. There is no single record to fetch, so this
 * never calls the record query (an aggregate-only viewer would be refused anyway); it says what the set is.
 */
function AggregateBody({ citation }: { citation: CitationItem }) {
  return (
    <SourceFact title="Aggregate source">
      <p data-testid="aggregate-citation" className="text-sm">{citation.label}</p>
      {citation.detail && <p data-testid="aggregate-citation-detail" className="mt-2 text-sm text-muted-foreground">{citation.detail}</p>}
      <p className="mt-4 rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
        This source describes a group of recorded responses, not a single record. Individual responses are not shown to aggregate-only access, and groups smaller than the disclosure threshold are withheld.
      </p>
    </SourceFact>
  )
}

/** Opens a cited record. The BE returns it only if the viewer's access covers it. */
export function CitationSheet({ citation, onClose }: { citation: CitationItem | null; onClose: () => void }) {
  return (
    <Dialog isOpen={citation !== null} onOpenChange={(open) => !open && onClose()} width={640} maxHeight="80dvh" data-testid="citation-sheet">
      <Layout
        height="fill"
        header={<DialogHeader title={citation && isAggregateCitation(citation) ? "Aggregate source" : "Source record"} subtitle={citation?.label} onOpenChange={() => onClose()} />}
        content={<LayoutContent isScrollable>{citation && (isAggregateCitation(citation) ? <AggregateBody key={citation.recordId} citation={citation} /> : <CitationBody key={`${citation.dataset}:${citation.recordId}`} citation={citation} />)}</LayoutContent>}
      />
    </Dialog>
  )
}
