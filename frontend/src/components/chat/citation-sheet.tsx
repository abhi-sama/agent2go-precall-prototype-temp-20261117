"use client"

import { Banner } from "@astryxdesign/core/Banner"
import { Button } from "@astryxdesign/core/Button"
import { Drawer, DrawerHeader } from "@astryxdesign/core/Drawer"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { Layout, LayoutContent } from "@astryxdesign/core/Layout"
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList"
import { Skeleton } from "@astryxdesign/core/Skeleton"
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from "@astryxdesign/core/Table"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import { Download, Rows3 } from "lucide-react"
import * as React from "react"
import { useKeepMounted } from "@/components/chat/use-keep-mounted"
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
  const captionId = React.useId()
  const record = useQuery("chatCitation", `${citation.dataset}:${citation.recordId}`, (ctx) =>
    adapter.chatCitation(ctx, citation.dataset, citation.recordId),
  )
  const exported = useQuery("chatCitationExport", `${citation.dataset}:${citation.recordId}:${exportRequest}`, (ctx) =>
    adapter.chatCitation(ctx, citation.dataset, citation.recordId, true), exportRequest > 0)

  React.useEffect(() => {
    if (exported.status !== "success") return
    downloadText(`${exported.data.recordId}.csv`, buildFactCsv(exported.data.fields), "text/csv;charset=utf-8")
  }, [exported])
  if (record.status === "loading") return <Skeleton data-testid="citation-loading" height="10rem" width="100%" radius={4} />
  if (record.status === "error") {
    return record.error.code === "NOT_FOUND" ? (
      <Banner data-testid="citation-unavailable" role="status" status="info" title="This record is not available in your scope." collapsible={false} />
    ) : (
      <ErrorState error={record.error} onRetry={record.refetch} />
    )
  }
  const r = record.data
  const rows = [...r.fields].sort((a, b) => sortDirection === "asc" ? a.label.localeCompare(b.label) : b.label.localeCompare(a.label))
  const exporting = exportRequest > 0 && exported.status === "loading"
  return (
    <SourceFact title={r.title}>
      <MetadataList data-testid="citation-fields">
        <MetadataListItem label="Record">
          <Text type="code">{r.recordId}</Text>
        </MetadataListItem>
        {r.fields.map((f) => (
          <MetadataListItem key={f.label} label={f.label}>
            {f.value}
          </MetadataListItem>
        ))}
      </MetadataList>
      <HStack gap={2} wrap="wrap" paddingBlockStart={5}>
        <Button
          variant="secondary"
          data-testid="show-rows"
          label={showRows ? "Hide rows" : "Show rows"}
          icon={<Icon icon={Rows3} />}
          onClick={() => setShowRows((value) => !value)}
        />
        <Button
          variant="secondary"
          data-testid="export-rows"
          label={exporting ? "Checking access…" : "Export row"}
          icon={<Icon icon={Download} />}
          isDisabled={exporting}
          onClick={() => setExportRequest((request) => request + 1)}
        />
      </HStack>
      {showRows && (
        <VStack gap={1} paddingBlockStart={3}>
          <Text type="supporting" id={captionId}>Exact source row, re-checked against your current access.</Text>
          <Table data-testid="chat-rows" aria-labelledby={captionId} density="compact">
            <TableHeader>
              <TableRow isHeaderRow>
                <TableHeaderCell scope="col" aria-sort={sortDirection === "asc" ? "ascending" : "descending"}>
                  <Button
                    variant="ghost"
                    size="sm"
                    label="Field"
                    endContent={<Icon icon={sortDirection === "asc" ? "arrowUp" : "arrowDown"} />}
                    onClick={() => setSortDirection((value) => value === "asc" ? "desc" : "asc")}
                  />
                </TableHeaderCell>
                <TableHeaderCell scope="col">Value</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((field) => (
                <TableRow key={field.label} data-testid="chat-row">
                  <TableCell scope="row" role="rowheader"><Text weight="medium">{field.label}</Text></TableCell>
                  <TableCell>{field.value}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </VStack>
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
      <VStack gap={2}>
        <Text as="p" data-testid="aggregate-citation">{citation.label}</Text>
        {citation.detail && <Text as="p" type="supporting" data-testid="aggregate-citation-detail">{citation.detail}</Text>}
        <Banner
          status="info"
          title="This source describes a group of recorded responses, not a single record."
          description="Individual responses are not shown to aggregate-only access, and groups smaller than the disclosure threshold are withheld."
          collapsible={false}
        />
      </VStack>
    </SourceFact>
  )
}

/** Opens a cited record in an Astryx `Drawer`. The BE returns it only if the viewer's access covers it. */
export function CitationSheet({ citation, onClose }: { citation: CitationItem | null; onClose: () => void }) {
  const open = citation !== null
  const mounted = useKeepMounted(open)
  // The last citation stays rendered while the drawer slides out.
  const [last, setLast] = React.useState(citation)
  if (citation && citation !== last) setLast(citation)
  const shown = citation ?? last
  const title = shown && isAggregateCitation(shown) ? "Aggregate source" : "Source record"
  // A page can mount several sheets (chat dock plus a workspace panel): once the slide-out has finished, unmount the dialog so a
  // closed, hidden <dialog> never shadows the one the reader is looking at.
  if (!mounted) return null
  return (
    <Drawer
      isOpen={open}
      onOpenChange={(next) => !next && onClose()}
      label={title}
      width="28rem"
      data-testid={open ? "citation-sheet" : undefined}
    >
      {mounted && shown && (
        <Layout
          header={<DrawerHeader title={title} subtitle={shown.label} onOpenChange={(next) => !next && onClose()} hasDivider />}
          content={
            <LayoutContent>
              {isAggregateCitation(shown) ? <AggregateBody key={shown.recordId} citation={shown} /> : <CitationBody key={`${shown.dataset}:${shown.recordId}`} citation={shown} />}
            </LayoutContent>
          }
        />
      )}
    </Drawer>
  )
}
