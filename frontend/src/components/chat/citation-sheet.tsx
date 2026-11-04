"use client"

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { SourceFact } from "@/components/provenance/provenance"
import { ErrorState } from "@/components/state/states"
import { Skeleton } from "@/components/ui/skeleton"
import type { CitationItem } from "@/lib/chat/events"
import { useDataAdapter } from "@/lib/data/data-provider"
import { useQuery } from "@/lib/data/use-query"

function CitationBody({ citation }: { citation: CitationItem }) {
  const adapter = useDataAdapter()
  const record = useQuery("chatCitation", `${citation.dataset}:${citation.recordId}`, (ctx) =>
    adapter.chatCitation(ctx, citation.dataset, citation.recordId),
  )
  if (record.status === "loading") return <Skeleton data-testid="citation-loading" className="h-40 w-full rounded-2xl" />
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
  return (
    <SourceFact title={r.title}>
      <dl data-testid="citation-fields" className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt className="text-muted-foreground">Record</dt>
        <dd className="font-mono text-xs">{r.recordId}</dd>
        {r.fields.map((f) => (
          <div key={f.label} className="contents">
            <dt className="text-muted-foreground">{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
    </SourceFact>
  )
}

/** Opens a cited record. The BE returns it only if the viewer's access covers it. */
export function CitationSheet({ citation, onClose }: { citation: CitationItem | null; onClose: () => void }) {
  return (
    <Sheet open={citation !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md" data-testid="citation-sheet">
        <SheetHeader>
          <SheetTitle>Source record</SheetTitle>
          <SheetDescription>{citation?.label}</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">{citation && <CitationBody key={`${citation.dataset}:${citation.recordId}`} citation={citation} />}</div>
      </SheetContent>
    </Sheet>
  )
}
