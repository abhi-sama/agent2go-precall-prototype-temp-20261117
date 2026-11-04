"use client"

import { ClipboardCheck, DatabaseZap, KeyRound } from "lucide-react"
import { ScopeLabel } from "@/components/shell/scope-label"
import { Badge } from "@/components/ui/badge"
import { useSession } from "@/lib/session/session-provider"

const MODULES = [
  { icon: DatabaseZap, title: "Data loads", body: "Load status, stale and failed loads, and data quality findings." },
  { icon: KeyRound, title: "Access and scope", body: "Who can see which territories, and when assignments change." },
  { icon: ClipboardCheck, title: "AI evaluations", body: "Golden-question runs, leak probes, history and diffs." },
] as const

/** Placeholder landing: the Data/Security Administrator sees no clinical content, only operations. */
export function AdminLanding() {
  const { user } = useSession()
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Administration</h1>
        <p className="max-w-2xl text-muted-foreground">
          Data and security operations. This role never sees clinical call content or HCP-level detail.
        </p>
        <div>
          <ScopeLabel label={user.scopeLabel} />
        </div>
      </header>
      <div className="grid gap-4 sm:grid-cols-3">
        {MODULES.map(({ icon: Icon, title, body }) => (
          <article key={title} className="rounded-2xl border bg-card p-5 shadow-card">
            <div className="flex items-center justify-between">
              <span className="grid size-10 place-items-center rounded-xl bg-primary/12 text-accent-text"><Icon className="size-5" aria-hidden /></span>
              <Badge variant="outline">Coming soon</Badge>
            </div>
            <h3 className="mt-4 text-base font-semibold">{title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{body}</p>
          </article>
        ))}
      </div>
    </div>
  )
}
