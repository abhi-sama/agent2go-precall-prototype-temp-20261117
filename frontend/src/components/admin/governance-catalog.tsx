"use client"

import { Badge } from "@astryxdesign/core/Badge"
import { Banner } from "@astryxdesign/core/Banner"
import { Button } from "@astryxdesign/core/Button"
import { Card } from "@astryxdesign/core/Card"
import { Grid } from "@astryxdesign/core/Grid"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { List, ListItem } from "@astryxdesign/core/List"
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl"
import { Table, proportional } from "@astryxdesign/core/Table"
import { Text } from "@astryxdesign/core/Text"
import { TextInput } from "@astryxdesign/core/TextInput"
import { VStack } from "@astryxdesign/core/VStack"
import { Bot, ClipboardList, GitCompareArrows, Plus, ShieldCheck } from "lucide-react"
import * as React from "react"
import { SectionCard } from "@/components/admin/section-card"
import { AiSummary } from "@/components/provenance/provenance"
import { BlockSkeleton, ErrorState } from "@/components/state/states"
import { useDataAdapter } from "@/lib/data/data-provider"
import { newCorrelationId } from "@/lib/log/logger"
import { useQuery } from "@/lib/data/use-query"

const ctx = () => ({ correlationId: newCorrelationId() })
const loaded = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "unknown")

function Loading() { return <BlockSkeleton className="h-64 w-full" /> }

type SourceValue = { value: string; sourceTable: string; sourceRecordId: string; observedAt: string | null }

/** One side of a conflict: every value, with the source row and load time that back it. */
function Provenance({ title, values }: { title: string; values: SourceValue[] }) {
  return (
    <Card padding={3} className="min-w-0">
      <List
        density="compact"
        hasDividers
        header={<Text type="label">{title}</Text>}
      >
        {values.map((value, index) => (
          <ListItem
            key={`${value.sourceRecordId}-${index}`}
            label={<Text weight="medium" className="break-words">{value.value}</Text>}
            description={
              <VStack gap={0.5}>
                <Text type="code" className="break-all">{value.sourceTable} · {value.sourceRecordId}</Text>
                <Text type="supporting">Loaded {loaded(value.observedAt)}</Text>
              </VStack>
            }
          />
        ))}
      </List>
    </Card>
  )
}

export function MetadataReconciliation() {
  const adapter = useDataAdapter()
  const result = useQuery("adminMetadataReconciliation", "metadata", (request) => adapter.adminMetadataReconciliation(request))
  if (result.status === "loading") return <Loading />
  if (result.status === "error") return <ErrorState error={result.error} onRetry={result.refetch} />
  return (
    <VStack gap={4} data-testid="metadata-reconciliation">
      <Banner
        status="warning"
        icon={<Icon icon={GitCompareArrows} size="md" />}
        title="Source values stay side by side."
        description="No status is selected or overwritten here; every value retains the source row and load time needed for a deliberate reconciliation."
        collapsible={false}
      />
      {result.data.map((row) => (
        <Card key={row.questionId} padding={4}>
          <VStack gap={3}>
            <HStack gap={2} align="center" wrap="wrap">
              <Heading level={3}><Text type="code" className="break-all">{row.questionId}</Text></Heading>
              <Badge variant="error" label="status conflict" />
            </HStack>
            <Text type="supporting" as="p">Catalog and response metadata disagree.</Text>
            <Grid columns={{ minWidth: 280 }} gap={3}>
              <Provenance title="Catalog" values={row.catalogValues} />
              <Provenance title="Recorded response" values={row.responseValues} />
            </Grid>
          </VStack>
        </Card>
      ))}
    </VStack>
  )
}

interface DefinitionRow extends Record<string, unknown> {
  key: string
  definitionId: string
  version: number
  name: string
  kind: string
  status: string
  ownerUserId: string
  approvedBy?: string | null
  definition: string
}

export function DefinitionCatalog() {
  const adapter = useDataAdapter(); const [version, setVersion] = React.useState(0)
  const result = useQuery("adminDefinitions", String(version), (request) => adapter.adminDefinitions(request))
  const [name, setName] = React.useState("")
  const add = async () => { if (!name.trim()) return; await adapter.createDefinition(ctx(), { definitionId: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"), kind: "METRIC", name: name.trim(), definition: "Definition awaiting administrator review." }); setName(""); setVersion((n) => n + 1) }
  const approve = async (definitionId: string, definitionVersion: number) => { await adapter.approveDefinition(ctx(), { definitionId, version: definitionVersion }); setVersion((n) => n + 1) }
  if (result.status === "loading") return <Loading />
  if (result.status === "error") return <ErrorState error={result.error} onRetry={result.refetch} />
  return (
    <VStack data-testid="definition-catalog">
      <SectionCard title="Definition catalog" description="Versions are immutable drafts until a different administrator approves them.">
        <form onSubmit={(event) => { event.preventDefault(); void add() }}>
          <HStack gap={3} wrap="wrap" align="end">
          <TextInput label="New metric definition" placeholder="New metric definition" value={name} onChange={(value) => setName(value ?? "")} width={320} />
          <Button type="submit" variant="secondary" icon={<Icon icon={Plus} />} label="Add draft" />
          </HStack>
        </form>
        <Card padding={0}>
          <Table<DefinitionRow>
            data={result.data.map((item) => ({ ...item, key: `${item.definitionId}:${item.version}` }))}
            idKey="key"
            hasHover
            columns={[
              { key: "name", header: "Definition", width: proportional(3, { minWidth: 220 }), renderCell: (item) => <VStack gap={0.5}><Text weight="medium">{item.name}</Text><Text type="supporting">{item.definition}</Text></VStack> },
              { key: "meta", header: "Kind and status", width: proportional(2, { minWidth: 170 }), renderCell: (item) => <Badge variant={item.status === "APPROVED" ? "success" : "warning"} label={`${item.kind.toLowerCase()} · v${item.version} · ${item.status.toLowerCase()}`} /> },
              { key: "owner", header: "Owner", width: proportional(2, { minWidth: 170 }), renderCell: (item) => <Text color="secondary">Owner {item.ownerUserId}{item.approvedBy ? ` · approved by ${item.approvedBy}` : " · awaiting approval"}</Text> },
              { key: "action", header: "Action", width: proportional(1, { minWidth: 150 }), renderCell: (item) => item.status === "DRAFT" ? <Button size="sm" variant="secondary" icon={<Icon icon="check" />} label="Approve version" onClick={() => void approve(item.definitionId, item.version)} /> : null },
            ]}
          />
        </Card>
      </SectionCard>
    </VStack>
  )
}

export function LifecycleQueue() {
  const adapter = useDataAdapter(); const [version, setVersion] = React.useState(0); const [resourceId, setResourceId] = React.useState("")
  const result = useQuery("governanceRequestQueue", String(version), (request) => adapter.governanceRequestQueue(request))
  const create = async () => { if (!resourceId.trim()) return; await adapter.createGovernanceRequest(ctx(), { requestType: "CORRECTION", resourceType: "question_tag", resourceId: resourceId.trim(), reason: "Administrator-requested source correction review." }); setResourceId(""); setVersion((n) => n + 1) }
  const review = async (requestId: string) => { await adapter.decideGovernanceRequest(ctx(), { requestId, status: "IN_REVIEW", note: "Review started by administrator." }); setVersion((n) => n + 1) }
  if (result.status === "loading") return <Loading />
  if (result.status === "error") return <ErrorState error={result.error} onRetry={result.refetch} />
  return (
    <VStack data-testid="lifecycle-queue">
      <SectionCard title="Retention, correction & deletion" icon={ClipboardList} description="Requests are reviewed by people; this queue does not mutate source records.">
        <form onSubmit={(event) => { event.preventDefault(); void create() }}>
          <HStack gap={3} wrap="wrap" align="end">
          <TextInput label="Source record ID" placeholder="Source record ID" value={resourceId} onChange={(value) => setResourceId(value ?? "")} width={320} />
          <Button type="submit" variant="secondary" icon={<Icon icon={Plus} />} label="Queue correction" />
          </HStack>
        </form>
        <List hasDividers edge="flush">
          {result.data.map((item) => (
            <ListItem
              key={item.requestId}
              align="start"
              label={
                <HStack gap={2} align="center" wrap="wrap">
                  <Text weight="medium">{item.requestType.toLowerCase()}</Text>
                  <Text type="code" className="break-all">{item.resourceId}</Text>
                  <Badge variant={item.status === "OPEN" ? "error" : "neutral"} label={item.status.replace("_", " ").toLowerCase()} />
                </HStack>
              }
              description={
                <VStack gap={1}>
                  <Text>{item.reason}</Text>
                  {item.auditHistory.map((event) => (
                    <Text key={`${event.occurredAt}-${event.action}`} type="supporting">
                      <Text type="supporting" weight="semibold">{event.action.toLowerCase()}</Text> · {event.actorUserId} · {new Date(event.occurredAt).toLocaleString()}
                    </Text>
                  ))}
                </VStack>
              }
              endContent={item.status === "OPEN" ? <Button size="sm" variant="secondary" label="Start review" onClick={() => void review(item.requestId)} /> : undefined}
            />
          ))}
        </List>
      </SectionCard>
    </VStack>
  )
}

const ISSUES = ["missing-question-parents", "duplicate-response-keys", "unmatched-identities"]

export function IssueAssistant() {
  const adapter = useDataAdapter(); const [issueId, setIssueId] = React.useState(ISSUES[0])
  const result = useQuery("adminIssueAssistant", issueId, (request) => adapter.adminIssueAssistant(request, issueId))
  if (result.status === "loading") return <Loading />
  if (result.status === "error") return <ErrorState error={result.error} onRetry={result.refetch} />
  return (
    <VStack data-testid="issue-assistant">
      <SectionCard title="Issue assistant" icon={Bot} description="AI suggestions are clearly separated from source facts and cannot change records or access.">
        <SegmentedControl label="Issue to explain" value={issueId} onChange={setIssueId}>
          {ISSUES.map((id) => <SegmentedControlItem key={id} value={id} label={id.replaceAll("-", " ")} />)}
        </SegmentedControl>
        <AiSummary title="Assistant explanation">
          <VStack gap={3}>
            <Text as="p">{result.data.explanation}</Text>
            <List listStyle="decimal" density="compact">
              {result.data.suggestedSteps.map((step) => <ListItem key={step} label={step} />)}
            </List>
          </VStack>
        </AiSummary>
        <Banner
          status="success"
          icon={<Icon icon={ShieldCheck} size="md" />}
          title="Read-only boundary."
          description={`Capabilities: ${result.data.capabilities.join(", ")}. Autonomous fixes and access grants: none.`}
          collapsible={false}
        />
      </SectionCard>
    </VStack>
  )
}
