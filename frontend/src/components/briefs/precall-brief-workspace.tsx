"use client"

import { ChevronRight, ClipboardList, Lock, Search, Sparkles, UserRound } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import * as React from "react"
import { toast } from "sonner"
import { FormLayout } from "@astryxdesign/core/FormLayout"
import { TextArea } from "@astryxdesign/core/TextArea"
import { TextInput } from "@astryxdesign/core/TextInput"
import { ErrorState } from "@/components/state/states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useDataAdapter } from "@/lib/data/data-provider"
import { useQuery } from "@/lib/data/use-query"
import { toDataError, type DataError, type HcpSearchResult, type PreCallBrief } from "@/lib/data/types"
import { log, newCorrelationId } from "@/lib/log/logger"
import { cn } from "@/lib/utils"
import { BriefView } from "./brief-view"
import { formatBriefTime } from "./format"

const STEPS = [
  "Checking you may prepare for this HCP…",
  "Reading authorized calls and recorded responses…",
  "Writing the brief and checking every statement has a source…",
  "Saving the brief…",
]

function GeneratingPanel() {
  const [step, setStep] = React.useState(0)
  React.useEffect(() => {
    const id = window.setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 2600)
    return () => window.clearInterval(id)
  }, [])
  return (
    <div data-testid="brief-generating" aria-busy="true" className="rounded-2xl border bg-card p-6 animate-in fade-in duration-200 motion-reduce:animate-none">
      <p role="status" className="flex items-center gap-2 font-semibold">
        <Sparkles className="size-4 text-ai motion-safe:animate-pulse" aria-hidden /> Generating the brief
      </p>
      <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">{STEPS[step]}</p>
      <div className="mt-5 space-y-3" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl bg-muted/60 motion-reduce:animate-none" />
        ))}
      </div>
    </div>
  )
}

/** Pick an authorized HCP, write the call objective, generate, and reopen saved briefs. */
export function PreCallBriefWorkspace() {
  const adapter = useDataAdapter()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const briefId = params.get("brief")
  const presetHcp = params.get("hcp")

  const [draft, setDraft] = React.useState("")
  const [query, setQuery] = React.useState("")
  const [picked, setPicked] = React.useState<{ hcpId: string; name: string } | null>(null)
  const [objective, setObjective] = React.useState("")
  const [generating, setGenerating] = React.useState(false)
  const [created, setCreated] = React.useState<PreCallBrief | null>(null)
  const [formError, setFormError] = React.useState<DataError | null>(null)

  // Arriving from the HCP card (?hcp=): resolve the id to a name through the authorized profile endpoint.
  const preset = useQuery("hcpProfile", presetHcp ?? "", (ctx) => adapter.hcpProfile(ctx, presetHcp!), presetHcp !== null && picked === null)
  const activeHcp = picked ?? (preset.status === "success" && presetHcp ? { hcpId: presetHcp, name: preset.data.name.value ?? "HCP name not recorded" } : null)

  const results = useQuery("searchHcps", query, (ctx) => adapter.searchHcps(ctx, query), query.length > 0)
  const list = useQuery("myBriefs", `list`, (ctx) => adapter.myBriefs(ctx), true)
  const opened = useQuery("preCallBrief", briefId ?? "", (ctx) => adapter.preCallBrief(ctx, briefId!), briefId !== null && created?.briefId !== briefId)

  const [overrides, setOverrides] = React.useState<Record<string, PreCallBrief>>({})
  const shown: PreCallBrief | null = briefId
    ? (overrides[briefId] ?? (created?.briefId === briefId ? created : opened.status === "success" ? opened.data : null))
    : null

  const open = (id: string | null) => {
    const next = new URLSearchParams(params.toString())
    if (id) next.set("brief", id)
    else next.delete("brief")
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false })
  }

  const objectiveOk = objective.trim().length >= 3 && objective.trim().length <= 500

  const generate = async (hcpId: string, text: string, regenerates?: string) => {
    setGenerating(true)
    setFormError(null)
    const ctx = { correlationId: newCorrelationId() }
    try {
      const brief = await adapter.generateBrief(ctx, { hcpId, objective: text.trim(), regeneratesBriefId: regenerates ?? null })
      setCreated(brief)
      setOverrides((o) => ({ ...o, [brief.briefId]: brief }))
      open(brief.briefId)
      list.refetch()
      toast.success(regenerates ? "Brief regenerated" : "Brief generated and saved", {
        description: "Every statement links to a call or response. Review, then edit the prompts and agenda.",
      })
    } catch (err) {
      const error = toDataError(err, ctx.correlationId)
      log.child(ctx.correlationId).error("brief generation failed", { operation: "generateBrief", error_code: error.code })
      if (regenerates) toast.error("The brief could not be regenerated", { description: "Your earlier brief is unchanged." })
      else setFormError(error)
    } finally {
      setGenerating(false)
    }
  }

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault()
    if (draft.trim()) setQuery(draft.trim())
  }

  const canGenerate = activeHcp !== null && objectiveOk && !generating

  return (
    <div className="@container space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Pre-call brief</h1>
        <p className="mt-1 max-w-2xl text-muted-foreground">
          Choose an HCP you are authorized to see, say what you want from the next call, and get a brief where every statement links to the call or response it came from.
        </p>
      </div>

      <div className="grid gap-4 @4xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] @4xl:items-start">
        <div className="space-y-4">
          <section aria-labelledby="new-brief-h" className="rounded-2xl border bg-card p-5 shadow-card">
            <h2 id="new-brief-h" className="flex items-center gap-2 text-lg font-semibold">
              <span className="grid size-9 place-items-center rounded-lg bg-accent text-accent-foreground"><ClipboardList className="size-4" aria-hidden /></span>
              New brief
            </h2>

            <form className="mt-4 flex gap-2" onSubmit={submitSearch} role="search">
              <TextInput
                data-testid="brief-hcp-search"
                label="Search HCPs"
                isLabelHidden
                type="search"
                value={draft}
                onChange={setDraft}
                placeholder="Find an HCP by name, institution or territory"
                enterKeyHint="search"
              />
              <Button type="submit" size="lg" variant="outline" aria-label="Search" className="shrink-0"><Search aria-hidden /></Button>
            </form>

            {query && (
              <div className="mt-3" aria-live="polite">
                {results.status === "loading" ? (
                  <p className="py-3 text-sm text-muted-foreground">Searching authorized HCPs…</p>
                ) : results.status === "error" ? (
                  <ErrorState error={results.error} onRetry={results.refetch} />
                ) : results.data.length === 0 ? (
                  <p data-testid="brief-hcp-empty" className="rounded-xl bg-muted/60 px-4 py-4 text-sm text-muted-foreground">No authorized HCPs match that search.</p>
                ) : (
                  <ul data-testid="brief-hcp-results" className="divide-y overflow-hidden rounded-xl border">
                    {results.data.slice(0, 6).map((r: HcpSearchResult) => (
                      <li key={r.hcpId}>
                        <button
                          type="button"
                          data-testid={`brief-pick-${r.hcpId}`}
                          onClick={() => setPicked({ hcpId: r.hcpId, name: r.name.value ?? "HCP name not recorded" })}
                          className={cn("flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:bg-accent", activeHcp?.hcpId === r.hcpId && "bg-accent")}
                        >
                          <UserRound className="size-4 shrink-0 text-fact" aria-hidden />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{r.name.value ?? "Name not recorded"}</span>
                            <span className="block truncate text-xs text-muted-foreground">{r.institution.value ?? "Institution not recorded"}</span>
                          </span>
                          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="mt-4 rounded-xl bg-fact-soft p-3" data-testid="brief-selected">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">HCP</p>
              {presetHcp && !picked && preset.status === "error" ? (
                <p className="mt-0.5 text-sm font-medium">That HCP is not available to you.</p>
              ) : activeHcp ? (
                <p data-testid="brief-selected-name" className="mt-0.5 font-semibold">{activeHcp.name}</p>
              ) : (
                <p className="mt-0.5 text-sm text-muted-foreground">{presetHcp && preset.status === "loading" ? "Loading…" : "Search and pick an HCP."}</p>
              )}
            </div>

            <div className="mt-4"><FormLayout>
            <TextArea
              data-testid="brief-new-objective"
              label="Call objective"
              value={objective}
              maxLength={500}
              rows={3}
              onChange={setObjective}
              placeholder="What do you want from the next call?"
            />
            </FormLayout></div>
            <p className="mt-1 text-xs text-muted-foreground tabular-nums">{objective.trim().length}/500</p>

            <Button data-testid="brief-generate" size="lg" className="mt-4 w-full" disabled={!canGenerate} onClick={() => activeHcp && generate(activeHcp.hcpId, objective)}>
              <Sparkles aria-hidden /> {generating ? "Generating…" : "Generate brief"}
            </Button>
            {formError && (
              <div className="mt-3">
                <ErrorState error={formError} onRetry={formError.code === "FORBIDDEN" ? undefined : () => activeHcp && generate(activeHcp.hcpId, objective)} />
              </div>
            )}
          </section>

          <section aria-labelledby="my-briefs-h" className="rounded-2xl border bg-card p-5 shadow-card">
            <h2 id="my-briefs-h" className="text-lg font-semibold">My briefs</h2>
            {list.status === "loading" ? (
              <div aria-busy="true" className="mt-3 h-20 animate-pulse rounded-xl bg-muted/55" />
            ) : list.status === "error" ? (
              <div className="mt-3"><ErrorState error={list.error} onRetry={list.refetch} /></div>
            ) : list.data.length === 0 ? (
              <p data-testid="my-briefs-empty" className="mt-2 text-sm text-muted-foreground">No saved briefs yet. Generate one and it is kept here.</p>
            ) : (
              <ul data-testid="my-briefs" className="mt-3 divide-y overflow-hidden rounded-xl border">
                {list.data.map((b) => (
                  <li key={b.briefId}>
                    <button
                      type="button"
                      data-testid={`my-brief-${b.briefId}`}
                      data-accessible={b.accessible}
                      onClick={() => {
                        // Opening from the list always re-checks access: drop anything cached from this session.
                        setOverrides({})
                        setCreated(null)
                        open(b.briefId)
                      }}
                      aria-current={briefId === b.briefId}
                      className={cn("flex min-h-16 w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:bg-accent", briefId === b.briefId && "bg-accent")}
                    >
                      <span className="min-w-0 flex-1">
                        {b.accessible ? (
                          <>
                            <span className="block truncate font-medium">{b.hcpName?.value ?? "HCP name not recorded"}</span>
                            <span className="block truncate text-xs text-muted-foreground">{b.objective}</span>
                          </>
                        ) : (
                          <>
                            <span className="flex items-center gap-1.5 font-medium"><Lock className="size-3.5" aria-hidden /> No longer available</span>
                            <span className="block text-xs text-muted-foreground">You no longer have access to this HCP.</span>
                          </>
                        )}
                        <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">{formatBriefTime(b.generatedAt)}</span>
                        {b.stale && <Badge data-testid="my-brief-stale" variant="outline" className="mt-1.5 h-auto whitespace-normal border-warning/50 bg-warning/10 py-1">Newer data available - regenerate</Badge>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className={cn("min-w-0", (briefId !== null || generating) && "order-first @4xl:order-none")} aria-live="polite">
          {generating && !shown ? (
            <GeneratingPanel />
          ) : briefId === null ? (
            <div data-testid="brief-placeholder" className="grid min-h-64 place-items-center rounded-2xl border border-dashed bg-muted/30 p-8 text-center">
              <div>
                <Sparkles className="mx-auto size-8 text-ai" aria-hidden />
                <p className="mt-3 text-lg font-semibold">Your brief appears here</p>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">Pick an HCP, add your objective and tap Generate brief. You can also reopen a saved brief.</p>
              </div>
            </div>
          ) : shown ? (
            <>
              {generating && <div className="mb-4"><GeneratingPanel /></div>}
              <BriefView
                key={`${shown.briefId}:${shown.updatedAt}`}
                brief={shown}
                regenerating={generating}
                onRegenerate={() => generate(shown.hcpId, shown.objective, shown.briefId)}
                onUpdated={(updated) => setOverrides((o) => ({ ...o, [updated.briefId]: updated }))}
              />
            </>
          ) : opened.status === "loading" ? (
            <div data-testid="brief-loading" aria-busy="true" className="h-96 animate-pulse rounded-2xl bg-muted/55" />
          ) : opened.status === "error" ? (
            opened.error.code === "FORBIDDEN" ? (
              <div data-testid="brief-denied" role="alert" className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-ink/30 bg-fact-soft px-6 py-12 text-center">
                <span className="grid size-12 place-items-center rounded-2xl bg-ink/10 text-fact"><Lock className="size-6" aria-hidden /></span>
                <h2 className="text-lg font-semibold">You no longer have access to this HCP</h2>
                <p className="max-w-prose text-sm text-muted-foreground">Your territory changed, so this brief cannot be opened. It is kept in case your access returns; nothing from it is shown.</p>
              </div>
            ) : (
              <ErrorState error={opened.error} onRetry={opened.refetch} />
            )
          ) : null}
        </div>
      </div>
    </div>
  )
}
