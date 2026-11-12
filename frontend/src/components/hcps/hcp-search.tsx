"use client"

import { Badge } from "@astryxdesign/core/Badge"
import { Button } from "@astryxdesign/core/Button"
import { Card } from "@astryxdesign/core/Card"
import { EmptyState } from "@astryxdesign/core/EmptyState"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { List, ListItem } from "@astryxdesign/core/List"
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList"
import { Skeleton } from "@astryxdesign/core/Skeleton"
import { Text } from "@astryxdesign/core/Text"
import { TextInput } from "@astryxdesign/core/TextInput"
import { VStack } from "@astryxdesign/core/VStack"
import { Building2, ClipboardList, UserRound } from "lucide-react"
import * as React from "react"
import { ErrorState } from "@/components/state/states"
import { useDataAdapter } from "@/lib/data/data-provider"
import { useQuery } from "@/lib/data/use-query"
import type { HcpField } from "@/lib/data/types"
import { HcpTimeline } from "./hcp-timeline"

const PROFILE_FIELDS: readonly { key: "specialty" | "discipline" | "type" | "institution" | "credentials" | "territory"; label: string }[] = [
  { key: "specialty", label: "Specialty" }, { key: "discipline", label: "Discipline" }, { key: "type", label: "Type" },
  { key: "institution", label: "Institution" }, { key: "credentials", label: "Credentials" }, { key: "territory", label: "Territory" },
]

function Fact({ field }: { field: HcpField }) {
  if (field.state === "MISSING") return <HStack gap={2} wrap="wrap" align="center"><Badge variant="neutral" label="Missing" /><Text>Not available</Text></HStack>
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
    <Card padding={5} elevation="low" className="a2g-hcp-search">
      <section aria-labelledby="hcp-search-heading">
        <VStack gap={6}>
          <div className="a2g-hcp-search-details grid min-w-0 gap-6">
            <VStack gap={5} className="min-w-0">
              <HStack gap={3} align="start">
                <Icon icon="search" size="lg" color="accent" />
                <VStack gap={1}>
                  <Heading id="hcp-search-heading" level={2}>Find an HCP</Heading>
                  <Text type="supporting" as="p">Search authorized records by name, institution, or territory.</Text>
                </VStack>
              </HStack>
              <form onSubmit={submit} role="search">
                <HStack gap={2} wrap="wrap" align="end">
                <TextInput data-testid="hcp-search-input" label="Search HCPs" isLabelHidden type="search" value={draft} onChange={setDraft} placeholder="Name, institution, or territory" startIcon="search" hasClear enterKeyHint="search" width="100%" />
                <Button data-testid="hcp-search-submit" label="Search" type="submit" variant="primary" size="lg" />
                </HStack>
              </form>
              {query && <VStack aria-live="polite">
                {results.status === "loading" ? <Skeleton height="11rem" radius={3} /> : null}
                {results.status === "error" ? <ErrorState error={results.error} onRetry={results.refetch} /> : null}
                {results.status === "success" && results.data.length === 0 ? <EmptyState title="No authorized HCPs match" description="Try a name, institution, or territory from your assigned scope." headingLevel={3} isCompact icon={<Icon icon="search" />} /> : null}
                {results.status === "success" && results.data.length > 0 ? <List data-testid="hcp-results" hasDividers edge="outset" header={<Heading level={3} className="sr-only">Matching HCPs</Heading>}>
                  {results.data.map((result) => <ListItem key={result.hcpId} data-testid={`hcp-result-${result.hcpId}`} onClick={() => setSelectedId(result.hcpId)} startContent={<Icon icon={UserRound} color="accent" />} endContent={<Icon icon="chevronRight" color="secondary" />} label={<Text weight="semibold"><Fact field={result.name} /></Text>} description={<VStack gap={0.5} align="start"><HStack gap={1} align="center"><Icon icon={Building2} size="xsm" /><Fact field={result.institution} /></HStack><Text type="supporting" size="xsm"><Fact field={result.territory} /></Text></VStack>} />)}
                </List> : null}
              </VStack>}
            </VStack>
            <VStack className="a2g-hcp-search-profile min-w-0 border-t pt-6">
              {!selectedId ? <EmptyState data-testid="hcp-profile-placeholder" title="Profile details" description="Select an authorized HCP to review the available source facts." headingLevel={3} isCompact icon={<Icon icon={UserRound} />} /> : null}
              {selectedId && profile.status === "loading" ? <Skeleton aria-busy="true" height="16rem" radius={3} /> : null}
              {selectedId && profile.status === "error" ? <ErrorState error={profile.error} onRetry={profile.refetch} /> : null}
              {selectedId && profile.status === "success" ? <VStack data-testid="hcp-profile" gap={5}><VStack gap={1}><Text type="supporting" weight="medium">HCP profile</Text><Heading level={3}><Fact field={profile.data.name} /></Heading></VStack><MetadataList columns="multi" label={{ position: "top" }}>{PROFILE_FIELDS.map(({ key, label }) => <MetadataListItem key={key} label={label}><Fact field={profile.data[key]} /></MetadataListItem>)}</MetadataList><Button data-testid="hcp-prepare-brief" href={`/msl/briefs?hcp=${encodeURIComponent(selectedId)}`} label="Prepare a pre-call brief" icon={<Icon icon={ClipboardList} />} variant="primary" width="100%" /></VStack> : null}
            </VStack>
          </div>
          {selectedId && profile.status === "success" ? <HcpTimeline hcpId={selectedId} /> : null}
        </VStack>
      </section>
    </Card>
  )
}
