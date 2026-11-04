"use client"

import { useState } from "react"
import { BookOpen, FileLock2 } from "lucide-react"
import { BlockSkeleton, ErrorState } from "@/components/state/states"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { ResponseAccessLevel } from "@/lib/data/governance"
import { useQuery } from "@/lib/data/use-query"
import { newCorrelationId } from "@/lib/log/logger"

const LEVELS: { value: ResponseAccessLevel; label: string }[] = [
  { value: "NONE", label: "None" },
  { value: "AGGREGATE_ONLY", label: "Aggregate only" },
  { value: "RECORDS", label: "Records" },
]

/** Two matrices, deliberately separate: catalog visibility never implies response access. */
export function VisibilityMatrices() {
  const adapter = useDataAdapter()
  const [version, setVersion] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const matrices = useQuery("adminVisibility", String(version), (ctx) => adapter.adminVisibility(ctx))

  async function change(key: string, action: () => Promise<unknown>, done: string) {
    setBusy(key); setNotice(null)
    try { await action(); setNotice(done); setVersion((v) => v + 1) }
    catch { setNotice("The change was not saved. Nothing changed.") }
    finally { setBusy(null) }
  }

  if (matrices.status === "loading") return <BlockSkeleton className="h-72" />
  if (matrices.status === "error") return <ErrorState error={matrices.error} onRetry={matrices.refetch} />
  const { catalogMatrix, responseMatrix } = matrices.data
  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-xl bg-card p-4 text-sm ring-1 ring-foreground/10" data-testid="visibility-principle">
        <strong>Seeing a catalog question never grants seeing its responses.</strong> These two matrices are saved separately, so changing one never changes the other. Every change is audited.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="min-w-0 rounded-xl bg-card p-4 ring-1 ring-foreground/10" aria-labelledby="catalog-heading" data-testid="catalog-matrix">
          <h2 id="catalog-heading" className="flex items-center gap-2 text-lg font-semibold tracking-tight"><BookOpen className="size-5 text-accent-text" aria-hidden />Catalog visibility</h2>
          <p className="mt-1 text-sm text-muted-foreground">Who can see which questions exist.</p>
          <ul className="mt-3">
            {catalogMatrix.map((row) => (
              <li key={row.roleId} className="border-b border-border/70 last:border-b-0">
                <label className="flex min-h-14 cursor-pointer items-center justify-between gap-3 py-2">
                  <span className="min-w-0"><span className="block break-words font-medium">{row.roleName}</span><span className="text-xs text-muted-foreground">{row.catalogVisible ? "Can see the catalog" : "Cannot see the catalog"}</span></span>
                  <Switch
                    checked={row.catalogVisible}
                    disabled={busy !== null}
                    aria-label={`${row.roleName} can see the question catalog`}
                    onCheckedChange={(checked) => change(`c-${row.roleId}`, () => adapter.setCatalogVisibility({ correlationId: newCorrelationId() }, { roleId: row.roleId, visible: checked }), "Catalog visibility saved and audited.")}
                  />
                </label>
              </li>
            ))}
          </ul>
        </section>
        <section className="min-w-0 rounded-xl bg-card p-4 ring-1 ring-foreground/10" aria-labelledby="response-heading" data-testid="response-matrix">
          <h2 id="response-heading" className="flex items-center gap-2 text-lg font-semibold tracking-tight"><FileLock2 className="size-5 text-accent-text" aria-hidden />HCP-response access</h2>
          <p className="mt-1 text-sm text-muted-foreground">How much of the recorded responses a role can see, still limited to their territories.</p>
          <ul className="mt-3">
            {responseMatrix.map((row) => (
              <li key={row.roleId} className="flex flex-col gap-2 border-b border-border/70 py-3 last:border-b-0">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="break-words font-medium">{row.roleName}</span><Badge variant={row.level === "NONE" ? "outline" : "secondary"}>{LEVELS.find((l) => l.value === row.level)?.label}</Badge></div>
                <div role="radiogroup" aria-label={`${row.roleName} response access`} className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
                  {LEVELS.map((level) => (
                    <button
                      key={level.value}
                      type="button"
                      role="radio"
                      aria-checked={row.level === level.value}
                      disabled={busy !== null}
                      onClick={() => row.level !== level.value && change(`r-${row.roleId}`, () => adapter.setResponseAccess({ correlationId: newCorrelationId() }, { roleId: row.roleId, level: level.value }), "Response access saved and audited.")}
                      className="min-h-11 rounded-md px-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground aria-checked:bg-background aria-checked:text-foreground aria-checked:shadow-sm disabled:opacity-60 sm:text-sm"
                    >
                      {level.label}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {notice && <p className="text-sm text-muted-foreground" role="status">{notice}</p>}
    </div>
  )
}
