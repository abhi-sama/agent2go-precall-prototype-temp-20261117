"use client"

import { AlertDialog } from "@astryxdesign/core/AlertDialog"
import { Badge } from "@astryxdesign/core/Badge"
import { Banner } from "@astryxdesign/core/Banner"
import { Button } from "@astryxdesign/core/Button"
import { DateTimeInput, type ISODateTimeString } from "@astryxdesign/core/DateTimeInput"
import { HStack } from "@astryxdesign/core/HStack"
import { List, ListItem } from "@astryxdesign/core/List"
import { Selector } from "@astryxdesign/core/Selector"
import { Table, proportional } from "@astryxdesign/core/Table"
import { Text } from "@astryxdesign/core/Text"
import { TextInput } from "@astryxdesign/core/TextInput"
import { VStack } from "@astryxdesign/core/VStack"
import { ArrowRightLeft, CalendarClock, Check, History, X } from "lucide-react"
import { useState, type FormEvent } from "react"
import { SectionCard } from "@/components/admin/section-card"
import { BlockSkeleton, ErrorState } from "@/components/state/states"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { AccessTimelineEntry, AssignmentStatus, ScopeChangeInput, ScopeChangeKind, ScopeChangeRequest } from "@/lib/data/governance"
import { useQuery } from "@/lib/data/use-query"
import { newCorrelationId } from "@/lib/log/logger"
import { useSession } from "@/lib/session/session-provider"

const STATUS_VARIANT: Record<AssignmentStatus, "success" | "info" | "neutral"> = { ACTIVE: "success", SCHEDULED: "info", EXPIRED: "neutral" }
const KIND_LABEL: Record<ScopeChangeKind, string> = { TRANSFER: "Transfer", TEMPORARY_COVERAGE: "Temporary coverage" }
const KIND_OPTIONS = (Object.keys(KIND_LABEL) as ScopeChangeKind[]).map((value) => ({ value, label: KIND_LABEL[value] }))
const isKind = (value: string): value is ScopeChangeKind => value in KIND_LABEL
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
const toIso = (local: string) => (local ? new Date(local).toISOString() : "")

function remaining(entry: AccessTimelineEntry) {
  if (entry.status !== "ACTIVE" || entry.secondsRemaining === null) return null
  const s = entry.secondsRemaining
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min left`
  if (s < 172_800) return `${Math.round(s / 3600)} h left`
  return `${Math.round(s / 86_400)} days left`
}

interface Draft {
  userId: string
  fromTerritoryId: string
  toTerritoryId: string
  effectiveFrom: string
  effectiveTo: string
  reason: string
}
const EMPTY_DRAFT: Draft = { userId: "", fromTerritoryId: "", toTerritoryId: "", effectiveFrom: "", effectiveTo: "", reason: "" }

function RequestForm({ onSaved }: { onSaved: () => void }) {
  const adapter = useDataAdapter()
  const [kind, setKind] = useState<ScopeChangeKind>("TEMPORARY_COVERAGE")
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const set = (field: keyof Draft) => (value: string | null | undefined) => setDraft((cur) => ({ ...cur, [field]: value ?? "" }))
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const effectiveFrom = toIso(draft.effectiveFrom)
    const effectiveTo = toIso(draft.effectiveTo)
    if (!effectiveFrom) return
    const input: ScopeChangeInput = {
      kind, userId: draft.userId.trim(), toTerritoryId: draft.toTerritoryId.trim(), effectiveFrom, reason: draft.reason.trim(),
      ...(kind === "TRANSFER" ? { fromTerritoryId: draft.fromTerritoryId.trim() } : { effectiveTo }),
    }
    setSaving(true); setNotice(null)
    try {
      await adapter.requestScopeChange({ correlationId: newCorrelationId() }, input)
      setNotice("Requested. Nothing changes until a different administrator approves it.")
      setDraft(EMPTY_DRAFT); onSaved()
    } catch { setNotice("The request was not saved. Check the user, territories, dates and reason.") }
    finally { setSaving(false) }
  }
  return (
    <form onSubmit={submit} data-testid="scope-change-form" aria-label="Request a transfer or temporary coverage">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Selector label="Type" options={KIND_OPTIONS} value={kind} onChange={(next) => { if (isKind(next)) setKind(next) }} width="100%" />
        <TextInput label="User ID" isRequired placeholder="msl-t01-01" value={draft.userId} onChange={set("userId")} htmlName="userId" width="100%" />
        {kind === "TRANSFER" && <TextInput label="Moves from" isRequired placeholder="T01-01" value={draft.fromTerritoryId} onChange={set("fromTerritoryId")} htmlName="fromTerritoryId" width="100%" />}
        <TextInput label={kind === "TRANSFER" ? "Moves to" : "Covers"} isRequired placeholder="T02-01" value={draft.toTerritoryId} onChange={set("toTerritoryId")} htmlName="toTerritoryId" width="100%" />
        <DateTimeInput label="Starts" isRequired value={(draft.effectiveFrom || undefined) as ISODateTimeString | undefined} onChange={(value) => set("effectiveFrom")(value)} />
        {kind === "TEMPORARY_COVERAGE" && <DateTimeInput label="Expires" description="Required: coverage stops on its own at this moment." isRequired value={(draft.effectiveTo || undefined) as ISODateTimeString | undefined} onChange={(value) => set("effectiveTo")(value)} />}
        <div className="sm:col-span-2 lg:col-span-2">
          <TextInput label="Reason" isRequired placeholder="Why this change is needed" value={draft.reason} onChange={set("reason")} htmlName="reason" width="100%" />
        </div>
      </div>
      <HStack gap={3} align="center" wrap="wrap" paddingBlockStart={4}>
        <Button type="submit" variant="primary" label={saving ? "Requesting" : "Request for approval"} isLoading={saving} />
        {notice && <Text type="supporting" role="status">{notice}</Text>}
      </HStack>
    </form>
  )
}

function RequestRow({ request, ownUserId, onDecided }: { request: ScopeChangeRequest; ownUserId: string; onDecided: () => void }) {
  const adapter = useDataAdapter()
  const [busy, setBusy] = useState(false)
  const [confirmReject, setConfirmReject] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const own = request.requestedBy === ownUserId
  async function decide(decision: "APPROVE" | "REJECT") {
    setBusy(true); setNotice(null)
    try { await adapter.decideScopeChange({ correlationId: newCorrelationId() }, { requestId: request.requestId, decision }); setConfirmReject(false); onDecided() }
    catch { setNotice("The decision was not saved."); setConfirmReject(false) }
    finally { setBusy(false) }
  }
  const status = request.status
  return (
    <ListItem
      data-testid="scope-change-request"
      data-status={status}
      align="start"
      label={
        <HStack gap={2} align="center" wrap="wrap">
          <Badge variant={status === "PENDING" ? "warning" : status === "APPROVED" ? "success" : "neutral"} label={status.toLowerCase()} />
          <Text weight="medium">{KIND_LABEL[request.kind]}</Text>
          <Text color="secondary" className="break-all">{request.displayName || request.userId}</Text>
        </HStack>
      }
      description={
        <VStack gap={1}>
          <Text className="break-words">
            {request.kind === "TRANSFER" ? `${request.fromTerritoryId} → ${request.toTerritoryId}` : `Covers ${request.toTerritoryId}`}
            <Text color="secondary"> · {when(request.effectiveFrom)}{request.effectiveTo ? ` to ${when(request.effectiveTo)}` : " onward"}</Text>
          </Text>
          <Text color="secondary" className="break-words">“{request.reason}”</Text>
          <Text type="supporting" data-testid="approval-trail">
            Requested by {request.requestedBy}, {when(request.requestedAt)}
            {request.decidedBy ? ` · ${status === "APPROVED" ? "Approved" : "Rejected"} by ${request.decidedBy}, ${when(request.decidedAt!)}` : ""}
            {request.decisionNote ? ` · “${request.decisionNote}”` : ""}
          </Text>
          {status === "PENDING" && own && <Text type="supporting">Another administrator must decide your request.</Text>}
          {notice && <Text type="supporting" role="status">{notice}</Text>}
        </VStack>
      }
      endContent={
        status === "PENDING" ? (
          <HStack gap={2} wrap="wrap" justify="end">
            <Button size="sm" variant="primary" icon={<Check aria-hidden />} label="Approve" isDisabled={busy || own} onClick={() => decide("APPROVE")} />
            <Button size="sm" variant="secondary" icon={<X aria-hidden />} label="Reject" isDisabled={busy || own} onClick={() => setConfirmReject(true)} />
            {confirmReject && (
              <AlertDialog
                isOpen
                onOpenChange={setConfirmReject}
                title="Reject this request?"
                description={`${KIND_LABEL[request.kind]} for ${request.displayName || request.userId} will not take effect. The requester has to submit a new request to try again.`}
                actionLabel="Reject request"
                isActionLoading={busy}
                onAction={() => decide("REJECT")}
              />
            )}
          </HStack>
        ) : undefined
      }
    />
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
    <VStack gap={6}>
      <SectionCard icon={ArrowRightLeft} title="Request a transfer or temporary coverage" description="A second administrator approves it. Temporary coverage always has an end date and stops on its own at that moment.">
        <RequestForm onSaved={refresh} />
      </SectionCard>
      <SectionCard
        icon={CalendarClock}
        title="Access timeline"
        description="Status comes from the clock: scheduled, active or expired."
        end={<TextInput label="Show one user" placeholder="All users" value={userFilter} onChange={(value) => setUserFilter((value ?? "").trim())} hasClear width={240} />}
      >
        {timeline.status === "loading" ? <BlockSkeleton className="h-64" /> : timeline.status === "error" ? <ErrorState error={timeline.error} onRetry={timeline.refetch} /> : (
          <>
            {timeline.data.overlaps.length > 0 && (
              <VStack gap={2} data-testid="access-overlaps">
                {timeline.data.overlaps.map((o) => <Banner key={`${o.kind}-${o.assignmentIds.join("-")}`} status="warning" title="Overlap" description={<span className="break-words">{o.message}</span>} collapsible={false} />)}
              </VStack>
            )}
            <div data-testid="access-timeline">
              <Table<TimelineRow>
                data={timeline.data.entries.map((e) => ({ ...e, id: e.assignmentId }))}
                idKey="id"
                hasHover
                emptyState={<Text color="secondary">No assignments.</Text>}
                columns={[
                  { key: "status", header: "Status", width: proportional(1, { minWidth: 110 }), renderCell: (e) => <Badge variant={STATUS_VARIANT[e.status]} label={e.status.toLowerCase()} /> },
                  { key: "user", header: "User", width: proportional(1.2, { minWidth: 140 }), renderCell: (e) => <Text weight="medium" className="break-all">{e.displayName || e.userId}</Text> },
                  { key: "territory", header: "Territory", width: proportional(1, { minWidth: 120 }), renderCell: (e) => <HStack gap={2} wrap="wrap" align="center"><Text className="break-all">{e.territoryId}</Text>{e.unresolvedTerritory && <Badge variant="error" label="Unresolved" />}</HStack> },
                  { key: "assignmentType", header: "Type", width: proportional(1, { minWidth: 110 }) },
                  { key: "window", header: "Effective window", width: proportional(2, { minWidth: 240 }), renderCell: (e) => <Text hasTabularNumbers color="secondary">{when(e.effectiveFrom)} – {e.effectiveTo ? when(e.effectiveTo) : "ongoing"}</Text> },
                  { key: "left", header: "Remaining", width: proportional(1, { minWidth: 120 }), renderCell: (e) => <VStack gap={0.5}>{remaining(e) && <Text type="label" color="accent">{remaining(e)}</Text>}{e.requestId && <Text type="supporting">via request {e.requestId}</Text>}</VStack> },
                ]}
              />
            </div>
          </>
        )}
      </SectionCard>
      {timeline.status === "success" && (
        <SectionCard icon={History} title="Approval trail" description="Every request, who asked, and who decided.">
          <div data-testid="approval-requests">
            {timeline.data.requests.length === 0 ? <Text color="secondary" as="p">No requests yet.</Text> : (
              <List hasDividers edge="flush">
                {timeline.data.requests.map((r) => <RequestRow key={r.requestId} request={r} ownUserId={user.userId} onDecided={refresh} />)}
              </List>
            )}
          </div>
        </SectionCard>
      )}
    </VStack>
  )
}

interface TimelineRow extends Record<string, unknown>, AccessTimelineEntry {
  id: string
}
