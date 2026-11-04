"use client"

import { Search, Sparkles } from "lucide-react"
import * as React from "react"
import { CitationChip, Suggestion } from "@/components/provenance/provenance"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
  const search = useQuery("semanticInsightSearch", `${userId}:${submitted}`, (ctx) => adapter.semanticInsightSearch(ctx, submitted), ready && submitted.length >= 2)
  return <section className="flex flex-col gap-5" aria-labelledby="qualitative-insights-heading">
    <div><h2 id="qualitative-insights-heading" className="text-xl font-semibold tracking-tight">Qualitative insights</h2><p className="mt-1 text-sm text-muted-foreground">Derived themes and possible topics remain separate from source records and confirmed actions.</p></div>
    <div className="grid gap-4 xl:grid-cols-2">
      {discovery.themes.map((theme) => <Card key={theme.name} data-testid="theme-card" className="ring-1 ring-ai/25">
        <CardHeader><div className="flex items-start justify-between gap-3"><CardTitle className="flex items-center gap-2"><Sparkles className="size-4 text-ai" aria-hidden />{theme.name}</CardTitle><Badge variant="outline">Derived</Badge></div><CardDescription>{theme.responseCount} recorded responses</CardDescription></CardHeader>
        <CardContent><blockquote className="border-l-2 border-ai/50 pl-3 text-sm italic text-muted-foreground">“{theme.excerpt}”</blockquote><p className="mt-3 text-xs text-muted-foreground">Supporting excerpt · <CitationChip>{theme.recordId}</CitationChip>{theme.questionText ? ` · ${theme.questionText}` : ""}</p></CardContent>
      </Card>)}</div>
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="flex flex-col gap-3"><h3 className="text-lg font-semibold">Possible follow-up topics</h3>{discovery.followUpTopics.map((topic) => <Suggestion key={topic.topic} title="Possible topic" meta={<><span>{topic.evidenceCount} supporting responses</span><CitationChip>{topic.recordId}</CitationChip></>}><p className="font-medium">{topic.topic}</p><p className="mt-1 text-muted-foreground">“{topic.excerpt}”</p><p className="mt-2 text-xs font-medium">For review — not a confirmed commitment or task.</p></Suggestion>)}{discovery.followUpTopics.length === 0 && <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">No evidence-backed follow-up topics match these filters.</p>}</div>
      <Card data-testid="semantic-search"><CardHeader><CardTitle>Search recorded perspectives</CardTitle><CardDescription>Searches only responses your current scope permits.</CardDescription></CardHeader><CardContent className="flex flex-col gap-3"><form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); setSubmitted(query.trim()) }}><Input aria-label="Search insight responses" value={query} minLength={2} placeholder="e.g. evidence access" onChange={(event) => setQuery(event.target.value)} /><Button type="submit" aria-label="Search insights" disabled={query.trim().length < 2}><Search aria-hidden /></Button></form>{search.status === "loading" && <p className="text-sm text-muted-foreground">Searching recorded responses…</p>}{search.status === "success" && (search.data.length ? <ul className="flex flex-col gap-2">{search.data.map((result) => <li key={result.responseId} className="rounded-lg border p-3 text-sm"><p>{result.responseText}</p><p className="mt-1 text-xs text-muted-foreground">{result.questionText} · {result.interactionDate} · <CitationChip>{result.responseId}</CitationChip></p></li>)}</ul> : <p className="text-sm text-muted-foreground">No in-scope responses matched this search.</p>)}</CardContent></Card>
    </div>
  </section>
}
