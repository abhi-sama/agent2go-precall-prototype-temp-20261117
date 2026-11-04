"use client"

import { useState, type FormEvent } from "react"
import { ArrowRightLeft, CalendarClock, Check, History, X } from "lucide-react"
import { BlockSkeleton, ErrorState } from "@/components/state/states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { AccessTimelineEntry, AssignmentStatus, ScopeChangeInput, ScopeChangeKind, ScopeChangeRequest } from "@/lib/data/governance"
import { useQuery } from "@/lib/data/use-query"
import { newCorrelationId } from "@/lib/log/logger"
import { useSession } from "@/lib/session/session-provider"

const STATUS_VARIANT: Record<AssignmentStatus, "default" | "secondary" | "outline"> = { ACTIVE: "default", SCHEDULED: "secondary", EXPIRED: "outline" }
const KIND_LABEL: Record<ScopeChangeKind, string> = { TRANSFER: "Transfer", TEMPORARY_COVERAGE: "Temporary coverage" }
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
const toIso = (local: string) => (local ? new Date(local).toISOString() : "")
const FIELD = "grid gap-1 text-xs font-medium text-muted-foreground"
const CONTROL = "h-11"

function remaining(entry: AccessTimelineEntry) {
  if (entry.status !== "ACTIVE" || entry.secondsRemaining === null) return null
  const s = entry.secondsRemaining
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min left`
  if (s < 172_800) return `${Math.round(s / 3600)} h left`
  return `${Math.round(s / 86_400)} days left`
}

function RequestForm({ onSaved }: { onSaved: () => void }) {
  const adapter = useDataAdapter()
  const [kind, setKind] = useState<ScopeChangeKind>("TEMPORARY_COVERAGE")
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const text = (name: string) => String(data.get(name) ?? "").trim()
    const effectiveFrom = toIso(text("effectiveFrom"))
    const effectiveTo = toIso(text("effectiveTo"))
    if (!effectiveFrom) return
    const input: ScopeChangeInput = {
      kind, userId: text("userId"), toTerritoryId: text("toTerritoryId"), effectiveFrom, reason: text("reason"),
      ...(kind === "TRANSFER" ? { fromTerritoryId: text("fromTerritoryId") } : { effectiveTo }),
    }
    setSaving(true); setNotice(null)
    try {
      await adapter.requestScopeChange({ correlationId: newCorrelationId() }, input)
      setNotice("Requested. Nothing changes until a different administrator approves it.")
      form.reset(); onSaved()
    } catch { setNotice("The request was not saved. Check the user, territories, dates and reason.") }
    finally { setSaving(false) }
  }
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="scope-change-form" aria-label="Request a transfer or temporary coverage">
      <label className={FIELD}>Type
        <select value={kind} onChange={(e) => setKind(e.target.value as ScopeChangeKind)} className={`${CONTROL} rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50`} aria-label="Type">
          <option value="TEMPORARY_COVERAGE">Temporary coverage</option>
          <option value="TRANSFER">Transfer</option>
        </select>
      </label>
      <label className={FIELD}>User ID<Input name="userId" required placeholder="msl-t01-01" className={CONTROL} /></label>
      {kind === "TRANSFER" && <label className={FIELD}>Moves from<Input name="fromTerritoryId" required placeholder="T01-01" className={CONTROL} /></label>}
      <label className={FIELD}>{kind === "TRANSFER" ? "Moves to" : "Covers"}<Input name="toTerritoryId" required placeholder="T02-01" className={CONTROL} /></label>
      <label className={FIELD}>Starts<Input name="effectiveFrom" type="datetime-local" required className={CONTROL} /></label>
      {kind === "TEMPORARY_COVERAGE" && <label className={FIELD}>Expires (required)<Input name="effectiveTo" type="datetime-local" required className={CONTROL} /></label>}
      <label className={`${FIELD} sm:col-span-2`}>Reason<Input name="reason" required maxLength={500} placeholder="Why this change is needed" className={CONTROL} /></label>
      <div className="flex items-end"><Button type="submit" className="w-full" disabled={saving}>{saving ? "Requesting" : "Request for approval"}</Button></div>
      {notice && <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-3" role="status">{notice}</p>}
    </form>
  )
}

function RequestCard({ request, ownUserId, onDecided }: { request: ScopeChangeRequest; ownUserId: string; onDecided: () => void }) {
  const adapter = useDataAdapter()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const own = request.requestedBy === ownUserId
  async function decide(decision: "APPROVE" | "REJECT") {
    setBusy(true); setNotice(null)
    try { await adapter.decideScopeChange({ correlationId: newCorrelationId() }, { requestId: request.requestId, decision }); onDecided() }
    catch { setNotice("The decision was not saved.") }
    finally { setBusy(false) }
  }
  return (
    <li className="rounded-xl bg-card p-3 ring-1 ring-foreground/10" data-testid="scope-change-request" data-status={request.status}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={request.status === "PENDING" ? "secondary" : request.status === "APPROVED" ? "default" : "outline"}>{request.status.toLowerCase()}</Badge>
        <span className="text-sm font-medium">{KIND_LABEL[request.kind]}</span>
        <span className="break-all text-sm text-muted-foreground">{request.displayName || request.userId}</span>
      </div>
      <p className="mt-1 break-words text-sm">
        {request.kind === "TRANSFER" ? `${request.fromTerritoryId} → ${request.toTerritoryId}` : `Covers ${request.toTerritoryId}`}
        <span className="text-muted-foreground"> · {when(request.effectiveFrom)}{request.effectiveTo ? ` to ${when(request.effectiveTo)}` : " onward"}</span>
      </p>
      <p className="mt-1 break-words text-sm text-muted-foreground">“{request.reason}”</p>
      <p className="mt-2 text-xs text-muted-foreground" data-testid="approval-trail">
        Requested by {request.requestedBy}, {when(request.requestedAt)}
        {request.decidedBy ? ` · ${request.status === "APPROVED" ? "Approved" : "Rejected"} by ${request.decidedBy}, ${when(request.decidedAt!)}` : ""}
        {request.decisionNote ? ` · “${request.decisionNote}”` : ""}
      </p>
      {request.status === "PENDING" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy || own} onClick={() => decide("APPROVE")}><Check aria-hidden />Approve</Button>
          <Button size="sm" variant="outline" disabled={busy || own} onClick={() => decide("REJECT")}><X aria-hidden />Reject</Button>
          {own && <span className="text-xs text-muted-foreground">Another administrator must decide your request.</span>}
          {notice && <span className="text-xs text-muted-foreground" role="status">{notice}</span>}
        </div>
      )}
    </li>
  )
}

/** Effective-dated assignments, transfers and temporary coverage, with the approval trail. */
export function AccessTimelineView() {
  const adapter = useDataAdapter()
  const { user } = useSession()
  const [userFilter, setUserFilter] = useState("")
  const [version, setVersion] = useState(0)
  const timeline = useQuery("adminAccessTimeline", `${userFilter}#${version}`, (ctx) => adapter.adminAccessTimeline(ctx, userFilter || undefined))
  const refresh = () => setVersion((v) => v + 1)
  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10" aria-labelledby="change-heading">
        <h2 id="change-heading" className="flex items-center gap-2 text-lg font-semibold tracking-tight"><ArrowRightLeft className="size-5 text-accent-text" aria-hidden />Request a transfer or temporary coverage</h2>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">A second administrator approves it. Temporary coverage always has an end date and stops on its own at that moment.</p>
        <RequestForm onSaved={refresh} />
      </section>
      <section aria-labelledby="timeline-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="timeline-heading" className="flex items-center gap-2 text-lg font-semibold tracking-tight"><CalendarClock className="size-5 text-accent-text" aria-hidden />Access timeline</h2>
            <p className="mt-1 text-sm text-muted-foreground">Status comes from the clock: scheduled, active or expired.</p>
          </div>
          <label className={`${FIELD} w-full sm:w-64`}>Show one user<Input value={userFilter} onChange={(e) => setUserFilter(e.target.value.trim())} placeholder="All users" className={CONTROL} aria-label="Filter by user ID" /></label>
        </div>
        {timeline.status === "loading" ? <BlockSkeleton className="h-64" /> : timeline.status === "error" ? <ErrorState error={timeline.error} onRetry={timeline.refetch} /> : (
          <>
            {timeline.data.overlaps.length > 0 && (
              <ul className="grid gap-2" data-testid="access-overlaps">
                {timeline.data.overlaps.map((o) => <li key={`${o.kind}-${o.assignmentIds.join("-")}`} className="rounded-xl bg-card p-3 text-sm ring-1 ring-foreground/10"><Badge variant="outline">Overlap</Badge> <span className="break-words">{o.message}</span></li>)}
              </ul>
            )}
            <ul className="grid gap-2" data-testid="access-timeline">
              {timeline.data.entries.length === 0 && <li className="text-sm text-muted-foreground">No assignments.</li>}
              {timeline.data.entries.map((e) => (
                <li key={e.assignmentId} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-card p-3 ring-1 ring-foreground/10" data-status={e.status}>
                  <Badge variant={STATUS_VARIANT[e.status]}>{e.status.toLowerCase()}</Badge>
                  <span className="break-all font-medium">{e.displayName || e.userId}</span>
                  <span className="break-all text-sm">{e.territoryId}</span>
                  {e.unresolvedTerritory && <Badge variant="destructive">Unresolved</Badge>}
                  <span className="text-sm text-muted-foreground">{e.assignmentType}</span>
                  <span className="text-sm tabular-nums text-muted-foreground">{when(e.effectiveFrom)} – {e.effectiveTo ? when(e.effectiveTo) : "ongoing"}</span>
                  {remaining(e) && <span className="text-xs font-medium text-accent-text">{remaining(e)}</span>}
                  {e.requestId && <span className="text-xs text-muted-foreground">via request {e.requestId}</span>}
                </li>
              ))}
            </ul>
            <h3 className="mt-2 flex items-center gap-2 text-base font-semibold"><History className="size-4 text-accent-text" aria-hidden />Approval trail</h3>
            <ul className="grid gap-2" data-testid="approval-requests">
              {timeline.data.requests.length === 0 && <li className="text-sm text-muted-foreground">No requests yet.</li>}
              {timeline.data.requests.map((r) => <RequestCard key={r.requestId} request={r} ownUserId={user.userId} onDecided={refresh} />)}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}
