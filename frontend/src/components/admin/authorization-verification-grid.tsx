"use client"

import { useMemo, useState } from "react"
import { CheckCircle2, ShieldCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { BlockSkeleton, ErrorState } from "@/components/state/states"
import { useDataAdapter } from "@/lib/data/data-provider"
import { DataError } from "@/lib/data/types"
import { useQuery } from "@/lib/data/use-query"

const SCENARIOS = [
  ["in_scope", "Active scope"],
  ["out_of_scope", "Out of scope"],
  ["after_transfer", "After transfer"],
  ["coverage_expired", "Coverage ended"],
] as const

/** CI's AppSync-as-persona coverage, presented without test identities or source data. */
export function AuthorizationVerificationGrid() {
  const adapter = useDataAdapter()
  const [scenario, setScenario] = useState<(typeof SCENARIOS)[number][0]>("in_scope")
  const grid = useQuery("authorizationVerificationGrid", "current", (ctx) =>
    adapter.authorizationVerificationGrid
      ? adapter.authorizationVerificationGrid(ctx)
      : Promise.reject(new DataError("UNAVAILABLE", "Authorization verification is unavailable.", ctx.correlationId)),
  )
  const rows = useMemo(
    () => grid.status === "success" ? grid.data.results.filter((result) => result.scopeScenario === scenario) : [],
    [grid, scenario],
  )

  if (grid.status === "loading") return <BlockSkeleton className="h-96" />
  if (grid.status === "error") return <ErrorState error={grid.error} onRetry={grid.refetch} />

  const label = SCENARIOS.find(([id]) => id === scenario)?.[1] ?? scenario
  return (
    <section className="rounded-xl bg-card ring-1 ring-foreground/10" data-testid="authorization-verification-grid" aria-labelledby="authorization-grid-heading">
      <div className="flex flex-col gap-4 border-b px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><ShieldCheck className="size-5 text-accent-text" aria-hidden /><h2 id="authorization-grid-heading" className="text-lg font-semibold tracking-tight">Authorization verification grid</h2></div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Local CI signs in seeded personas and exercises the AppSync path. This inventory contains no test identities, territory identifiers, or source records.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2"><Badge variant="secondary"><CheckCircle2 className="size-3" aria-hidden />{grid.data.passed} / {grid.data.total} passed</Badge><Badge variant="outline">Local stack only</Badge></div>
      </div>
      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-sm font-medium">Scope condition</p><p className="mt-1 text-sm text-muted-foreground">{rows[0]?.expectation}</p></div>
        <label className="grid min-w-52 gap-1 text-sm font-medium">Show condition
          <select name="scopeScenario" value={scenario} onChange={(event) => setScenario(event.target.value as typeof scenario)} className="min-h-(--control-h) rounded-lg border border-input bg-background px-3 text-base font-normal outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label="Authorization grid scope condition">
            {SCENARIOS.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
          </select>
        </label>
      </div>
      <div className="overflow-x-auto border-t">
        <table className="w-full min-w-[50rem] text-left text-sm" aria-label={`Authorization verification results for ${label}`}>
          <thead className="border-b bg-muted/35 text-xs text-muted-foreground"><tr><th className="px-4 py-3 font-medium">Persona</th><th className="px-4 py-3 font-medium">Access path</th><th className="px-4 py-3 font-medium">Scope condition</th><th className="px-4 py-3 font-medium">Result</th></tr></thead>
          <tbody>{rows.map((result) => <tr key={result.testId} className="border-b border-border/70 last:border-b-0"><td className="px-4 py-3 font-medium">{result.persona}</td><td className="px-4 py-3">{result.accessPath}</td><td className="px-4 py-3 text-muted-foreground">{label}</td><td className="px-4 py-3"><Badge variant={result.status === "PASS" ? "secondary" : "destructive"}>{result.status}</Badge></td></tr>)}</tbody>
        </table>
      </div>
      <p className="border-t px-4 py-3 text-xs text-muted-foreground">Suite: {grid.data.suiteId}. The CI test is the evidence; this panel publishes its coverage contract for review.</p>
    </section>
  )
}
