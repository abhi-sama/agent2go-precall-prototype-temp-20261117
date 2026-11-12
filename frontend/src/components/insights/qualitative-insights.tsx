"use client"

import { Search } from "lucide-react"
import * as React from "react"
import { CitationSheet } from "@/components/chat/citation-sheet"
import { AiSummary, CitationChip, Suggestion } from "@/components/provenance/provenance"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { CitationItem } from "@/lib/chat/events"
import { Input } from "@/components/ui/input"
import { useDataAdapter } from "@/lib/data/data-provider"
import { useQuery } from "@/lib/data/use-query"
import type { InsightDiscovery } from "@/lib/data/types"
import { useSession } from "@/lib/session/session-provider"

export function QualitativeInsights({ discovery }: { discovery: InsightDiscovery }) {
  const adapter = useDataAdapter()
  const { userId, ready } = useSession()
  const [query, setQuery] = React.useState("")
  const [submitted, setSubmitted] = React.useState("")
  const [citation, setCitation] = React.useState<CitationItem | null>(null)
  const cite = (recordId: string) => () => setCitation({ recordId, dataset: "hcp_raw_insights", label: "Recorded HCP response" })
  const search = useQuery("semanticInsightSearch", `${userId}:${submitted}`, (ctx) => adapter.semanticInsightSearch(ctx, submitted), ready && submitted.length >= 2)
  return <section className="@container flex flex-col gap-4" aria-labelledby="qualitative-insights-heading">
    <div><h2 id="qualitative-insights-heading" className="text-xl font-semibold tracking-tight">Qualitative insights</h2><p className="mt-1 text-sm text-muted-foreground">Derived themes and possible topics remain separate from source records and confirmed actions.</p></div>
    <div className="grid gap-4 @2xl:grid-cols-2">
      {discovery.themes.map((theme) => (
        <AiSummary
          key={theme.name}
          data-testid="theme-card"
          title={theme.name}
          citations={[{ key: theme.recordId, label: theme.recordId, detail: theme.questionText ?? "Supporting excerpt", onOpen: cite(theme.recordId) }]}
          meta={<><Badge variant="outline">Derived</Badge><span>{theme.responseCount} recorded responses</span></>}
        >
          <blockquote className="border-l-2 border-ai/50 pl-3 italic text-muted-foreground">“{theme.excerpt}”</blockquote>
        </AiSummary>
      ))}</div>
    <div className="grid gap-4 @2xl:grid-cols-2">
      <div className="flex flex-col gap-3"><h3 className="text-lg font-semibold">Possible follow-up topics</h3>{discovery.followUpTopics.map((topic) => <Suggestion key={topic.topic} title="Possible topic" meta={<><span>{topic.evidenceCount} supporting responses</span><CitationChip aria-label={`Open source record ${topic.recordId}`} onOpen={cite(topic.recordId)}>{topic.recordId}</CitationChip></>}><p className="font-medium">{topic.topic}</p><p className="mt-1 text-muted-foreground">“{topic.excerpt}”</p><p className="mt-2 text-xs font-medium">For review — not a confirmed commitment or task.</p></Suggestion>)}{discovery.followUpTopics.length === 0 && <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">No evidence-backed follow-up topics match these filters.</p>}</div>
      <Card data-testid="semantic-search"><CardHeader><CardTitle>Search recorded perspectives</CardTitle><CardDescription>Searches only responses your current scope permits.</CardDescription></CardHeader><CardContent className="flex flex-col gap-3"><form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); setSubmitted(query.trim()) }}><Input aria-label="Search insight responses" value={query} minLength={2} placeholder="e.g. evidence access" onChange={(event) => setQuery(event.target.value)} /><Button type="submit" aria-label="Search insights" disabled={query.trim().length < 2}><Search aria-hidden /></Button></form>{search.status === "loading" && <p className="text-sm text-muted-foreground">Searching recorded responses…</p>}{search.status === "success" && (search.data.length ? <ul className="flex flex-col gap-2">{search.data.map((result) => <li key={result.responseId} className="rounded-lg border p-3 text-sm"><p>{result.responseText}</p><p className="mt-1 text-xs text-muted-foreground">{result.questionText} · {result.interactionDate} · <CitationChip aria-label={`Open source record ${result.responseId}`} onOpen={cite(result.responseId)}>{result.responseId}</CitationChip></p></li>)}</ul> : <p className="text-sm text-muted-foreground">No in-scope responses matched this search.</p>)}</CardContent></Card>
    </div>
  <CitationSheet citation={citation} onClose={() => setCitation(null)} />
  </section>
}
