"use client"

import { Building2, ChevronRight, ClipboardList, Search, UserRound } from "lucide-react"
import * as React from "react"
import { Button } from "@astryxdesign/core/Button"
import { Card } from "@astryxdesign/core/Card"
import { EmptyState } from "@astryxdesign/core/EmptyState"
import { List, ListItem } from "@astryxdesign/core/List"
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList"
import { Skeleton } from "@astryxdesign/core/Skeleton"
import { TextInput } from "@astryxdesign/core/TextInput"
import { ErrorState } from "@/components/state/states"
import { Badge } from "@/components/ui/badge"
import { useDataAdapter } from "@/lib/data/data-provider"
import { useQuery } from "@/lib/data/use-query"
import type { HcpField } from "@/lib/data/types"
import { HcpTimeline } from "./hcp-timeline"

const PROFILE_FIELDS: readonly { key: "specialty" | "discipline" | "type" | "institution" | "credentials" | "territory"; label: string }[] = [
  { key: "specialty", label: "Specialty" }, { key: "discipline", label: "Discipline" }, { key: "type", label: "Type" },
  { key: "institution", label: "Institution" }, { key: "credentials", label: "Credentials" }, { key: "territory", label: "Territory" },
]

function Fact({ field }: { field: HcpField }) {
  if (field.state === "MISSING") return <span className="inline-flex max-w-full flex-wrap items-center gap-2"><Badge variant="outline">Missing</Badge><span>Not available</span></span>
  return <>{field.value === "" ? "Empty value" : field.value}</>
}

/** Search and profile facts always come from the canonical-ID AppSync endpoints. */
export function HcpSearch() {
  const adapter = useDataAdapter()
  const [draft, setDraft] = React.useState("")
  const [query, setQuery] = React.useState("")
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const results = useQuery("searchHcps", query, (ctx) => adapter.searchHcps(ctx, query), query.length > 0)
  const profile = useQuery("hcpProfile", selectedId ?? "", (ctx) => adapter.hcpProfile(ctx, selectedId!), selectedId !== null)

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = draft.trim()
    if (!next) return
    setSelectedId(null)
    setQuery(next)
  }

  return (
    <Card padding={5} elevation="low">
      <section aria-labelledby="hcp-search-heading" className="space-y-6">
        <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,.8fr)]">
          <div className="min-w-0">
            <div className="flex items-start gap-3">
              <Search className="mt-1 size-5 text-[var(--color-accent)]" aria-hidden />
              <div><h2 id="hcp-search-heading" className="text-xl font-semibold tracking-tight">Find an HCP</h2><p className="mt-1 max-w-xl text-sm text-muted-foreground">Search authorized records by name, institution, or territory.</p></div>
            </div>
            <form className="mt-5 flex min-w-0 flex-wrap items-end gap-2" onSubmit={submit} role="search">
              <div className="min-w-0 flex-1"><TextInput data-testid="hcp-search-input" label="Search HCPs" isLabelHidden type="search" value={draft} onChange={setDraft} placeholder="Name, institution, or territory" startIcon={Search} hasClear enterKeyHint="search" width="100%" /></div>
              <Button data-testid="hcp-search-submit" label="Search" type="submit" variant="primary" size="lg" />
            </form>
            {query && <div className="mt-5" aria-live="polite">
              {results.status === "loading" ? <Skeleton height={176} radius={3} /> : null}
              {results.status === "error" ? <ErrorState error={results.error} onRetry={results.refetch} /> : null}
              {results.status === "success" && results.data.length === 0 ? <EmptyState title="No authorized HCPs match" description="Try a name, institution, or territory from your assigned scope." headingLevel={3} isCompact icon={<Search />} /> : null}
              {results.status === "success" && results.data.length > 0 ? <List data-testid="hcp-results" hasDividers edge="outset" header={<h3 className="sr-only">Matching HCPs</h3>}>
                {results.data.map((result) => <ListItem key={result.hcpId} data-testid={`hcp-result-${result.hcpId}`} onClick={() => setSelectedId(result.hcpId)} startContent={<UserRound className="size-5 text-[var(--color-accent)]" aria-hidden />} endContent={<ChevronRight className="size-5 text-muted-foreground" aria-hidden />} label={<span className="font-semibold"><Fact field={result.name} /></span>} description={<span className="block"><span className="flex items-center gap-1"><Building2 className="size-3.5" aria-hidden /><Fact field={result.institution} /></span><span className="block text-xs"><Fact field={result.territory} /></span></span>} />)}
              </List> : null}
            </div>}
          </div>
          <div className="min-w-0 border-t pt-6 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
            {!selectedId ? <EmptyState data-testid="hcp-profile-placeholder" title="Profile details" description="Select an authorized HCP to review the available source facts." headingLevel={3} isCompact icon={<UserRound />} /> : null}
            {selectedId && profile.status === "loading" ? <Skeleton aria-busy="true" height={260} radius={3} /> : null}
            {selectedId && profile.status === "error" ? <ErrorState error={profile.error} onRetry={profile.refetch} /> : null}
            {selectedId && profile.status === "success" ? <div data-testid="hcp-profile" className="space-y-5"><div><p className="text-sm font-medium text-muted-foreground">HCP profile</p><h3 className="mt-1 text-xl font-semibold tracking-tight"><Fact field={profile.data.name} /></h3></div><MetadataList columns="multi" label={{ position: "top" }}>{PROFILE_FIELDS.map(({ key, label }) => <MetadataListItem key={key} label={label}><Fact field={profile.data[key]} /></MetadataListItem>)}</MetadataList><Button data-testid="hcp-prepare-brief" href={`/msl/briefs?hcp=${encodeURIComponent(selectedId)}`} label="Prepare a pre-call brief" icon={<ClipboardList />} variant="primary" width="100%" /></div> : null}
          </div>
        </div>
        {selectedId && profile.status === "success" ? <HcpTimeline hcpId={selectedId} /> : null}
      </section>
    </Card>
  )
}
