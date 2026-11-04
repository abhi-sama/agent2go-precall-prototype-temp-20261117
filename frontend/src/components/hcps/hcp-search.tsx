"use client"

import { Building2, ChevronRight, ClipboardList, Search, UserRound } from "lucide-react"
import Link from "next/link"
import * as React from "react"
import { ErrorState } from "@/components/state/states"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useDataAdapter } from "@/lib/data/data-provider"
import { useQuery } from "@/lib/data/use-query"
import type { HcpField } from "@/lib/data/types"
import { cn } from "@/lib/utils"
import { HcpTimeline } from "./hcp-timeline"

const PROFILE_FIELDS: readonly { key: "specialty" | "discipline" | "type" | "institution" | "credentials" | "territory"; label: string }[] = [
  { key: "specialty", label: "Specialty" },
  { key: "discipline", label: "Discipline" },
  { key: "type", label: "Type" },
  { key: "institution", label: "Institution" },
  { key: "credentials", label: "Credentials" },
  { key: "territory", label: "Territory" },
]

function Fact({ field }: { field: HcpField }) {
  if (field.state === "MISSING") {
    return <span className="inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground"><Badge variant="outline">Missing</Badge>Not available</span>
  }
  // An empty source value is deliberately not styled as a missing one.
  return <span>{field.value === "" ? "Empty value" : field.value}</span>
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
    <section aria-labelledby="hcp-search-heading" className="overflow-hidden rounded-2xl border bg-card shadow-card">
      <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,0.78fr)] lg:gap-8">
        <div>
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground"><Search className="size-5" aria-hidden /></span>
            <div>
              <h2 id="hcp-search-heading" className="text-xl font-semibold tracking-tight">Find an HCP</h2>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">Search authorized records by name, institution, or territory.</p>
            </div>
          </div>

          <form className="mt-5 flex gap-2" onSubmit={submit}>
            <Input
              data-testid="hcp-search-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Name, institution, or territory"
              aria-label="Search HCPs"
              className="h-12 text-base"
            />
            <Button data-testid="hcp-search-submit" type="submit" size="lg" className="shrink-0">Search</Button>
          </form>

          {query && (
            <div className="mt-5" aria-live="polite">
              {results.status === "loading" ? (
                <p className="py-6 text-sm text-muted-foreground">Searching authorized HCPs…</p>
              ) : results.status === "error" ? (
                <ErrorState error={results.error} onRetry={results.refetch} />
              ) : results.data.length === 0 ? (
                <p data-testid="hcp-search-empty" className="rounded-xl bg-muted/60 px-4 py-5 text-sm text-muted-foreground">No authorized HCPs match that search.</p>
              ) : (
                <ul data-testid="hcp-results" className="divide-y overflow-hidden rounded-xl border">
                  {results.data.map((result) => (
                    <li key={result.hcpId}>
                      <button
                        type="button"
                        data-testid={`hcp-result-${result.hcpId}`}
                        onClick={() => setSelectedId(result.hcpId)}
                        className={cn(
                          "flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:bg-accent",
                          selectedId === result.hcpId && "bg-accent",
                        )}
                      >
                        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-fact-soft text-fact"><UserRound className="size-5" aria-hidden /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold"><Fact field={result.name} /></span>
                          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground"><Building2 className="size-3.5 shrink-0" aria-hidden /><span className="truncate"><Fact field={result.institution} /></span></span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground"><Fact field={result.territory} /></span>
                        </span>
                        <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="border-t pt-5 lg:border-t-0 lg:border-l lg:pl-8 lg:pt-0">
          {!selectedId ? (
            <div data-testid="hcp-profile-placeholder" className="flex min-h-48 flex-col justify-center rounded-xl bg-muted/45 p-5">
              <p className="font-semibold">Profile details</p>
              <p className="mt-1 text-sm text-muted-foreground">Select an authorized HCP to review the available source facts.</p>
            </div>
          ) : profile.status === "loading" ? (
            <div aria-busy="true" className="min-h-48 animate-pulse rounded-xl bg-muted/55" />
          ) : profile.status === "error" ? (
            <ErrorState error={profile.error} onRetry={profile.refetch} />
          ) : (
            <div data-testid="hcp-profile" className="rounded-xl bg-fact-soft p-5">
              <p className="text-sm font-medium text-fact">HCP profile</p>
              <h3 className="mt-1 text-xl font-semibold tracking-tight"><Fact field={profile.data.name} /></h3>
              <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
                {PROFILE_FIELDS.map(({ key, label }) => (
                  <div key={key} className="min-w-0">
                    <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
                    <dd className="mt-1 break-words font-medium"><Fact field={profile.data[key]} /></dd>
                  </div>
                ))}
              </dl>
              <Link
                data-testid="hcp-prepare-brief"
                href={`/msl/briefs?hcp=${encodeURIComponent(selectedId)}`}
                className={cn(buttonVariants({ size: "lg" }), "mt-5 w-full")}
              >
                <ClipboardList aria-hidden /> Prepare a pre-call brief
              </Link>
            </div>
          )}
        </div>
      </div>
      {selectedId && profile.status === "success" ? <div className="px-5 pb-5 sm:px-6 sm:pb-6"><HcpTimeline hcpId={selectedId} /></div> : null}
    </section>
  )
}
