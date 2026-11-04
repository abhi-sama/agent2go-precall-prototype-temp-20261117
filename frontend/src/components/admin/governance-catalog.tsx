"use client"

import * as React from "react"
import { Bot, CheckCircle2, ClipboardList, GitCompareArrows, Plus, ShieldCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { BlockSkeleton, ErrorState } from "@/components/state/states"
import { useDataAdapter } from "@/lib/data/data-provider"
import { newCorrelationId } from "@/lib/log/logger"
import { useQuery } from "@/lib/data/use-query"

const ctx = () => ({ correlationId: newCorrelationId() })

function Loading() { return <BlockSkeleton className="h-64 w-full" /> }

export function MetadataReconciliation() {
  const adapter = useDataAdapter()
  const result = useQuery("adminMetadataReconciliation", "metadata", (request) => adapter.adminMetadataReconciliation(request))
  if (result.status === "loading") return <Loading />
  if (result.status === "error") return <ErrorState error={result.error} onRetry={result.refetch} />
  return <section className="space-y-4" data-testid="metadata-reconciliation">
    <div className="flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm">
      <GitCompareArrows className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-300" />
      <p><strong>Source values stay side by side.</strong> No status is selected or overwritten here; every value retains the source row and load time needed for a deliberate reconciliation.</p>
    </div>
    <div className="grid gap-3">
      {result.data.map((row) => <Card key={row.questionId} size="sm" className="overflow-visible"><CardHeader><CardTitle className="flex flex-wrap items-center gap-2"><code>{row.questionId}</code><Badge variant="destructive">status conflict</Badge></CardTitle><CardDescription>Catalog and response metadata disagree.</CardDescription></CardHeader><CardContent className="grid gap-3 md:grid-cols-2">
        <Provenance title="Catalog" values={row.catalogValues} /> <Provenance title="Recorded response" values={row.responseValues} />
      </CardContent></Card>)}
    </div>
  </section>
}

function Provenance({ title, values }: { title: string; values: { value: string; sourceTable: string; sourceRecordId: string; observedAt: string | null }[] }) {
  return <div className="min-w-0 rounded-lg bg-muted/55 p-3"><p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</p><div className="max-h-52 space-y-2 overflow-y-auto pr-1">{values.map((value, index) => <div key={`${value.sourceRecordId}-${index}`} className="rounded-md bg-background p-2 ring-1 ring-border"><p className="font-medium">{value.value}</p><p className="mt-1 break-all font-mono text-xs text-muted-foreground">{value.sourceTable} · {value.sourceRecordId}</p><p className="text-xs text-muted-foreground">Loaded {value.observedAt ? new Date(value.observedAt).toLocaleString() : "unknown"}</p></div>)}</div></div>
}

export function DefinitionCatalog() {
  const adapter = useDataAdapter(); const [version, setVersion] = React.useState(0)
  const result = useQuery("adminDefinitions", String(version), (request) => adapter.adminDefinitions(request))
  const [name, setName] = React.useState("")
  const add = async () => { if (!name.trim()) return; await adapter.createDefinition(ctx(), { definitionId: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"), kind: "METRIC", name: name.trim(), definition: "Definition awaiting administrator review." }); setName(""); setVersion((n) => n + 1) }
  const approve = async (definitionId: string, definitionVersion: number) => { await adapter.approveDefinition(ctx(), { definitionId, version: definitionVersion }); setVersion((n) => n + 1) }
  if (result.status === "loading") return <Loading />
  if (result.status === "error") return <ErrorState error={result.error} onRetry={result.refetch} />
  return <section className="space-y-4" data-testid="definition-catalog"><Card><CardHeader><CardTitle>Definition catalog</CardTitle><CardDescription>Versions are immutable drafts until a different administrator approves them.</CardDescription></CardHeader><CardContent className="flex flex-col gap-2 sm:flex-row"><Input className="h-11" aria-label="New metric definition name" value={name} onChange={(event) => setName(event.target.value)} placeholder="New metric definition" /><Button onClick={() => void add()} variant="outline"><Plus /> Add draft</Button></CardContent></Card><div className="grid gap-3">{result.data.map((item) => <Card key={`${item.definitionId}:${item.version}`} size="sm"><CardHeader><CardTitle className="flex flex-wrap items-center gap-2">{item.name} <Badge variant={item.status === "APPROVED" ? "default" : "secondary"}>{item.kind.toLowerCase()} · v{item.version} · {item.status.toLowerCase()}</Badge></CardTitle><CardDescription>Owner {item.ownerUserId}{item.approvedBy ? ` · approved by ${item.approvedBy}` : " · awaiting approval"}</CardDescription></CardHeader><CardContent className="flex flex-col gap-3"><p>{item.definition}</p>{item.status === "DRAFT" && <div><Button variant="outline" onClick={() => void approve(item.definitionId, item.version)}><CheckCircle2 /> Approve version</Button></div>}</CardContent></Card>)}</div></section>
}

export function LifecycleQueue() {
  const adapter = useDataAdapter(); const [version, setVersion] = React.useState(0); const [resourceId, setResourceId] = React.useState("")
  const result = useQuery("governanceRequestQueue", String(version), (request) => adapter.governanceRequestQueue(request))
  const create = async () => { if (!resourceId.trim()) return; await adapter.createGovernanceRequest(ctx(), { requestType: "CORRECTION", resourceType: "question_tag", resourceId: resourceId.trim(), reason: "Administrator-requested source correction review." }); setResourceId(""); setVersion((n) => n + 1) }
  const review = async (requestId: string) => { await adapter.decideGovernanceRequest(ctx(), { requestId, status: "IN_REVIEW", note: "Review started by administrator." }); setVersion((n) => n + 1) }
  if (result.status === "loading") return <Loading />
  if (result.status === "error") return <ErrorState error={result.error} onRetry={result.refetch} />
  return <section className="space-y-4" data-testid="lifecycle-queue"><Card><CardHeader><CardTitle>Retention, correction & deletion</CardTitle><CardDescription>Requests are reviewed by people; this queue does not mutate source records.</CardDescription></CardHeader><CardContent className="flex flex-col gap-2 sm:flex-row"><Input className="h-11" aria-label="Source record id" value={resourceId} onChange={(event) => setResourceId(event.target.value)} placeholder="Source record ID" /><Button onClick={() => void create()} variant="outline"><Plus /> Queue correction</Button></CardContent></Card>{result.data.map((item) => <Card key={item.requestId} size="sm"><CardHeader><CardTitle className="flex flex-wrap items-center gap-2"><ClipboardList className="size-4" />{item.requestType.toLowerCase()} · <code>{item.resourceId}</code><Badge variant={item.status === "OPEN" ? "destructive" : "secondary"}>{item.status.replace("_", " ").toLowerCase()}</Badge></CardTitle><CardDescription>{item.reason}</CardDescription></CardHeader><CardContent className="space-y-3"><div className="border-l-2 border-muted pl-3 text-sm">{item.auditHistory.map((event) => <p key={`${event.occurredAt}-${event.action}`}><strong>{event.action.toLowerCase()}</strong> · {event.actorUserId} · {new Date(event.occurredAt).toLocaleString()}</p>)}</div>{item.status === "OPEN" && <Button variant="outline" onClick={() => void review(item.requestId)}>Start review</Button>}</CardContent></Card>)}</section>
}

export function IssueAssistant() {
  const adapter = useDataAdapter(); const [issueId, setIssueId] = React.useState("missing-question-parents")
  const result = useQuery("adminIssueAssistant", issueId, (request) => adapter.adminIssueAssistant(request, issueId))
  if (result.status === "loading") return <Loading />
  if (result.status === "error") return <ErrorState error={result.error} onRetry={result.refetch} />
  return <section className="space-y-4" data-testid="issue-assistant"><Card className="border-primary/20"><CardHeader><CardTitle className="flex items-center gap-2"><Bot className="size-5 text-primary" />Issue assistant</CardTitle><CardDescription>AI suggestions are clearly separated from source facts and cannot change records or access.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="flex flex-wrap gap-2">{["missing-question-parents", "duplicate-response-keys", "unmatched-identities"].map((id) => <Button key={id} variant={issueId === id ? "default" : "outline"} size="sm" onClick={() => setIssueId(id)}>{id.replaceAll("-", " ")}</Button>)}</div><div className="rounded-lg bg-muted/60 p-4"><p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Assistant explanation</p><p className="mt-2">{result.data.explanation}</p></div><ol className="list-decimal space-y-2 pl-5">{result.data.suggestedSteps.map((step) => <li key={step}>{step}</li>)}</ol><div className="flex items-start gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3 text-sm"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-700 dark:text-emerald-300" /><span><strong>Read-only boundary.</strong> Capabilities: {result.data.capabilities.join(", ")}. Autonomous fixes and access grants: none.</span></div></CardContent></Card></section>
}
