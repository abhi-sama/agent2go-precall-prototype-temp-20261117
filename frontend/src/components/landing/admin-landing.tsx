"use client"

import { AlertDialog } from "@astryxdesign/core/AlertDialog"
import { Badge } from "@astryxdesign/core/Badge"
import { Banner } from "@astryxdesign/core/Banner"
import { Button } from "@astryxdesign/core/Button"
import { Card } from "@astryxdesign/core/Card"
import { CheckboxList, CheckboxListItem } from "@astryxdesign/core/CheckboxList"
import { DateTimeInput, type ISODateTimeString } from "@astryxdesign/core/DateTimeInput"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { Selector } from "@astryxdesign/core/Selector"
import { Table, proportional } from "@astryxdesign/core/Table"
import { Text } from "@astryxdesign/core/Text"
import { TextInput } from "@astryxdesign/core/TextInput"
import { VStack } from "@astryxdesign/core/VStack"
import { CircleAlert, Clock3, KeyRound, UserCheck } from "lucide-react"
import { useState, type FormEvent } from "react"
import { AdminPageHeader } from "@/components/admin/page-header"
import { SectionCard } from "@/components/admin/section-card"
import { AdminDataQuality } from "@/components/landing/admin-data-quality"
import { DashboardGrid, DashboardGridItem } from "@/components/layout/dashboard-grid"
import { BlockSkeleton, ErrorState } from "@/components/state/states"
import { useDataAdapter } from "@/lib/data/data-provider"
import { DataError, type AccessAuditFilter, type AdminAccessOverview, type IdentityMatch, type PermissionGrant, type RolePermissionMatrix, type ScopeAssignmentInput } from "@/lib/data/types"
import { useQuery } from "@/lib/data/use-query"
import { newCorrelationId } from "@/lib/log/logger"
import { useSession } from "@/lib/session/session-provider"

const isoFromControl = (value: string | null | undefined) => (value ? new Date(value).toISOString() : "")
const optional = (value: string) => value.trim() || undefined
const fullWhen = (iso: string) => new Date(iso).toLocaleString()
const ASSIGNMENT_TYPES = [
  { value: "primary", label: "Primary" },
  { value: "temporary", label: "Temporary coverage" },
  { value: "executive", label: "Executive" },
  { value: "administrative", label: "Administrative" },
]

function RoleGrantEditor({ role, catalog, onSaved }: { role: RolePermissionMatrix; catalog: PermissionGrant[]; onSaved: () => void }) {
  const adapter = useDataAdapter()
  const [selected, setSelected] = useState<string[]>(() => role.permissions.map((permission) => permission.permissionCode))
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  async function save() {
    if (!adapter.setRolePermissions) return
    setSaving(true); setNotice(null)
    try { await adapter.setRolePermissions({ correlationId: newCorrelationId() }, { roleId: role.roleId, permissionCodes: selected }); setNotice("Saved and audited."); onSaved() }
    catch { setNotice("The grants could not be saved. Nothing changed.") }
    finally { setSaving(false) }
  }
  return (
    <Card padding={4} className="min-w-0">
      <VStack gap={3}>
        <VStack gap={0.5}>
          <Heading level={3}>{role.roleName}</Heading>
          <Text type="supporting" className="break-all">{role.roleId}</Text>
        </VStack>
        <CheckboxList label={`${role.roleName} explicit permissions`} isLabelHidden value={selected} onChange={setSelected}>
          {catalog.map((permission) => (
            <CheckboxListItem
              key={permission.permissionCode}
              value={permission.permissionCode}
              label={
                <VStack gap={0.5}>
                  <Text weight="medium">{permission.permissionCode}</Text>
                  <Text size="sm" color="primary">{permission.description}</Text>
                </VStack>
              }
            />
          ))}
        </CheckboxList>
        <HStack gap={3} align="center" wrap="wrap">
          <Button size="sm" variant="secondary" label={saving ? "Saving" : "Save grants"} isLoading={saving} isDisabled={selected.length === 0} onClick={save} />
          {notice && <Text type="supporting" role="status">{notice}</Text>}
        </HStack>
      </VStack>
    </Card>
  )
}

interface AssignmentDraft { userId: string; territoryId: string; assignmentType: string; effectiveFrom: string; effectiveTo: string }
const EMPTY_ASSIGNMENT: AssignmentDraft = { userId: "", territoryId: "", assignmentType: "temporary", effectiveFrom: "", effectiveTo: "" }

function AssignmentForm({ onSaved }: { onSaved: () => void }) {
  const adapter = useDataAdapter()
  const [draft, setDraft] = useState<AssignmentDraft>(EMPTY_ASSIGNMENT)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const set = (field: keyof AssignmentDraft) => (value: string | null | undefined) => setDraft((cur) => ({ ...cur, [field]: value ?? "" }))
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!adapter.createScopeAssignment) return
    const effectiveFrom = isoFromControl(draft.effectiveFrom); const effectiveTo = isoFromControl(draft.effectiveTo)
    if (!effectiveFrom) return
    const input: ScopeAssignmentInput = { userId: draft.userId.trim(), territoryId: draft.territoryId.trim(), assignmentType: draft.assignmentType, effectiveFrom, ...(effectiveTo ? { effectiveTo } : {}) }
    setSaving(true); setNotice(null)
    try { await adapter.createScopeAssignment({ correlationId: newCorrelationId() }, input); setNotice("Assignment saved; its effective date controls access."); setDraft(EMPTY_ASSIGNMENT); onSaved() }
    catch { setNotice("The assignment was not saved. Check the user, territory, and dates.") }
    finally { setSaving(false) }
  }
  return (
    <form onSubmit={submit} data-testid="scope-assignment-form" aria-label="Add a territory assignment">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <TextInput label="User ID" isRequired placeholder="msl-t01-01" value={draft.userId} onChange={set("userId")} htmlName="userId" width="100%" />
        <TextInput label="Territory ID" isRequired placeholder="T01-02" value={draft.territoryId} onChange={set("territoryId")} htmlName="territoryId" width="100%" />
        <Selector label="Assignment type" options={ASSIGNMENT_TYPES} value={draft.assignmentType} onChange={set("assignmentType")} htmlName="assignmentType" width="100%" />
        <DateTimeInput label="Effective from" isRequired value={(draft.effectiveFrom || undefined) as ISODateTimeString | undefined} onChange={(value) => set("effectiveFrom")(value)} />
        <DateTimeInput label="Effective to" isOptional value={(draft.effectiveTo || undefined) as ISODateTimeString | undefined} onChange={(value) => set("effectiveTo")(value)} />
      </div>
      <HStack gap={3} align="center" wrap="wrap" paddingBlockStart={4}>
        <Button type="submit" variant="primary" label={saving ? "Saving" : "Add assignment"} isLoading={saving} />
        {notice && <Text type="supporting" role="status">{notice}</Text>}
      </HStack>
    </form>
  )
}

interface AuditDraft { actor: string; action: string; resource: string; outcome: string; from: string; to: string }
const EMPTY_AUDIT: AuditDraft = { actor: "", action: "", resource: "", outcome: "", from: "", to: "" }

function AuditSearch({ refreshKey }: { refreshKey: number }) {
  const adapter = useDataAdapter()
  const [draft, setDraft] = useState<AuditDraft>(EMPTY_AUDIT)
  const [filter, setFilter] = useState<AccessAuditFilter>({})
  const set = (field: keyof AuditDraft) => (value: string | null | undefined) => setDraft((cur) => ({ ...cur, [field]: value ?? "" }))
  const audit = useQuery("accessAudit", `${refreshKey}:${JSON.stringify(filter)}`, (ctx) => adapter.accessAudit ? adapter.accessAudit(ctx, filter) : Promise.reject(new DataError("UNAVAILABLE", "Audit search unavailable", ctx.correlationId)))
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const timestamp = (value: string) => (value ? isoFromControl(value) : undefined)
    setFilter({ actorUserId: optional(draft.actor), action: optional(draft.action), resourceType: optional(draft.resource), outcome: optional(draft.outcome), from: timestamp(draft.from), to: timestamp(draft.to) })
  }
  return (
    <SectionCard title="Access audit" description="Search actor, action, resource, time, and outcome. Results are limited to 250." end={<Badge variant="neutral" label="Immutable event log" />}>
      <form onSubmit={submit} data-testid="access-audit-filters" aria-label="Search the access audit">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <TextInput label="Actor ID" placeholder="Actor ID" value={draft.actor} onChange={set("actor")} hasClear width="100%" />
          <TextInput label="Action" placeholder="Action" value={draft.action} onChange={set("action")} hasClear width="100%" />
          <TextInput label="Resource type" placeholder="Resource type" value={draft.resource} onChange={set("resource")} hasClear width="100%" />
          <TextInput label="Outcome" placeholder="Outcome" value={draft.outcome} onChange={set("outcome")} hasClear width="100%" />
          <DateTimeInput label="From time" isOptional hasClear value={(draft.from || undefined) as ISODateTimeString | undefined} onChange={(value) => set("from")(value)} />
          <DateTimeInput label="To time" isOptional hasClear value={(draft.to || undefined) as ISODateTimeString | undefined} onChange={(value) => set("to")(value)} />
        </div>
        <div className="pt-4"><Button type="submit" variant="secondary" icon={<Icon icon="search" />} label="Search audit" /></div>
      </form>
      {audit.status === "loading" ? <BlockSkeleton className="h-28" /> : audit.status === "error" ? <ErrorState error={audit.error} onRetry={audit.refetch} /> : (
        <div data-testid="access-audit-results">
          <Card padding={0}>
            <Table<AuditRow>
              data={audit.data.map((event) => ({ ...event }))}
              idKey="eventId"
              hasHover
              emptyState={<Text color="secondary">No events match.</Text>}
              columns={[
                { key: "occurredAt", header: "Time", width: proportional(1.5, { minWidth: 170 }), renderCell: (event) => <Text hasTabularNumbers color="secondary">{fullWhen(event.occurredAt)}</Text> },
                { key: "actorUserId", header: "Actor", width: proportional(1, { minWidth: 120 }), renderCell: (event) => <Text>{event.actorUserId ?? "System"}</Text> },
                { key: "action", header: "Action", width: proportional(1.5, { minWidth: 210 }) },
                { key: "resource", header: "Resource", width: proportional(1.5, { minWidth: 160 }), renderCell: (event) => <Text className="break-all">{event.resourceType}{event.resourceId ? ` · ${event.resourceId}` : ""}</Text> },
                { key: "outcome", header: "Outcome", width: proportional(1, { minWidth: 110 }), renderCell: (event) => <Badge variant={event.outcome === "applied" ? "success" : "neutral"} label={event.outcome} /> },
              ]}
            />
          </Card>
        </div>
      )}
    </SectionCard>
  )
}

type AuditRow = Record<string, unknown> & { eventId: string; occurredAt: string; actorUserId?: string | null; action: string; resourceType: string; resourceId?: string | null; outcome: string }

type IdentityRow = Record<string, unknown> & IdentityMatch
type AssignmentRow = Record<string, unknown> & AdminAccessOverview["scopeAssignments"][number]

/** Administrator workflow for governed login mappings, grants, effective scopes, and audit evidence. */
export function AdminLanding() {
  const { user } = useSession(); const adapter = useDataAdapter(); const [refreshKey, setRefreshKey] = useState(0); const [mappingNotice, setMappingNotice] = useState<string | null>(null)
  const overview = useQuery("adminAccessOverview", String(refreshKey), (ctx) => adapter.adminAccessOverview ? adapter.adminAccessOverview(ctx) : Promise.reject(new DataError("UNAVAILABLE", "Admin access unavailable", ctx.correlationId)))
  const refresh = () => setRefreshKey((value) => value + 1)
  async function approve(match: IdentityMatch, rosterSourceRowId: string) { if (!adapter.approveIdentityMapping) return; setMappingNotice(null); try { await adapter.approveIdentityMapping({ correlationId: newCorrelationId() }, { userId: match.userId, rosterSourceRowId }); setMappingNotice("Mapping approved explicitly and added to the audit."); refresh() } catch { setMappingNotice("The mapping was not approved. Review the roster candidate and try again.") } }
  return (
    <div className="flex flex-col gap-6 pb-8">
      <AdminPageHeader
        title="Administration"
        description="Reconcile identities deliberately, set explicit permissions, schedule territory access without changing it early."
        scopeLabel={user.scopeLabel}
      />
      {overview.status === "loading" ? <BlockSkeleton className="h-96" /> : overview.status === "error" ? <ErrorState error={overview.error} onRetry={overview.refetch} /> : (
        <AdminWorkspace overview={overview.data} onRefresh={refresh} onApprove={approve} mappingNotice={mappingNotice} refreshKey={refreshKey} />
      )}
      <AdminDataQuality />
    </div>
  )
}

function IdentityActions({ match, onApprove }: { match: IdentityMatch; onApprove: (match: IdentityMatch, rosterSourceRowId: string) => Promise<void> }) {
  const [pending, setPending] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (match.flag === "matched") return <HStack gap={1} align="center"><Icon icon={UserCheck} size="sm" /><Text type="supporting">Approved</Text></HStack>
  return (
    <HStack gap={2} wrap="wrap">
      {match.candidateRosterSourceRowIds.map((id) => <Button key={id} size="sm" variant="secondary" label={`Approve row ${id}`} onClick={() => setPending(id)} />)}
      {pending !== null && (
        <AlertDialog
          isOpen
          onOpenChange={(open) => { if (!open) setPending(null) }}
          title="Link this login to the roster row?"
          description={`${match.displayName || match.userId} will be mapped to roster row ${pending}. The mapping is audited and decides which territories this login can see.`}
          actionLabel="Approve mapping"
          actionVariant="primary"
          isActionLoading={busy}
          onAction={async () => { setBusy(true); try { await onApprove(match, pending) } finally { setBusy(false); setPending(null) } }}
        />
      )}
    </HStack>
  )
}

function AdminWorkspace({ overview, onRefresh, onApprove, mappingNotice, refreshKey }: { overview: AdminAccessOverview; onRefresh: () => void; onApprove: (match: IdentityMatch, rosterSourceRowId: string) => Promise<void>; mappingNotice: string | null; refreshKey: number }) {
  const flagged = overview.identityMatches.filter((match) => match.flag !== "matched")
  return (
    <>
      <SectionCard
        flush
        title="Login-to-roster reconciliation"
        icon={UserCheck}
        description="Exact-email candidates are signals only. Nothing is linked until you approve a row."
        end={<Badge variant={flagged.length ? "error" : "success"} label={`${flagged.length} ${flagged.length === 1 ? "needs" : "need"} review`} />}
      >
        <div data-testid="identity-reconciliation">
          <Table<IdentityRow>
            data={overview.identityMatches.map((match) => ({ ...match }))}
            idKey="userId"
            hasHover
            columns={[
              { key: "login", header: "Login", width: proportional(1.5, { minWidth: 180 }), renderCell: (match) => <VStack gap={0.5}><Text weight="medium">{match.displayName || match.userId}</Text><Text type="supporting" className="break-all">{match.userId}</Text></VStack> },
              { key: "flag", header: "Status", width: proportional(1, { minWidth: 120 }), renderCell: (match) => <Badge variant={match.flag === "matched" ? "success" : "error"} label={match.flag} /> },
              { key: "roster", header: "Roster link", width: proportional(1.5, { minWidth: 180 }), renderCell: (match) => <Text>{match.rosterSourceRowId ? match.rosterName ?? `Roster row ${match.rosterSourceRowId}` : `${match.exactEmailCandidateCount} exact candidate${match.exactEmailCandidateCount === 1 ? "" : "s"}`}</Text> },
              { key: "action", header: "Explicit action", width: proportional(2, { minWidth: 220 }), renderCell: (match) => <IdentityActions match={match} onApprove={onApprove} /> },
            ]}
          />
        </div>
        {mappingNotice && <div className="px-4 pb-4"><Text type="supporting" as="p" role="status">{mappingNotice}</Text></div>}
      </SectionCard>
      <SectionCard title="Role permission matrix" icon={KeyRound} description="Every grant is explicit. Saving a matrix change is audited.">
        <DashboardGrid>
          {overview.roleMatrix.map((role) => (
            <DashboardGridItem key={role.roleId} area="half">
              <RoleGrantEditor role={role} catalog={overview.availablePermissions} onSaved={onRefresh} />
            </DashboardGridItem>
          ))}
        </DashboardGrid>
      </SectionCard>
      <SectionCard title="Effective-dated territory assignments" icon={Clock3} description="A scheduled assignment remains inactive until its effective time; unknown territories stay visibly unresolved.">
        <div data-testid="scope-assignments">
          <Card padding={0}>
            <Table<AssignmentRow>
              data={overview.scopeAssignments.map((assignment) => ({ ...assignment }))}
              idKey="assignmentId"
              hasHover
              emptyState={<Text color="secondary">No assignments.</Text>}
              columns={[
                { key: "user", header: "User", width: proportional(1.2, { minWidth: 150 }), renderCell: (a) => <Text>{a.displayName || a.userId}</Text> },
                { key: "territory", header: "Territory", width: proportional(1.2, { minWidth: 150 }), renderCell: (a) => <HStack gap={2} wrap="wrap" align="center"><Text className="break-all">{a.territoryId}</Text>{a.unresolvedTerritory && <Badge variant="error" label="Unresolved" />}</HStack> },
                { key: "assignmentType", header: "Type", width: proportional(1, { minWidth: 110 }) },
                { key: "window", header: "Effective window", width: proportional(2.5, { minWidth: 260 }), renderCell: (a) => <Text hasTabularNumbers color="secondary">{fullWhen(a.effectiveFrom)} {a.effectiveTo ? `– ${fullWhen(a.effectiveTo)}` : "– ongoing"}</Text> },
              ]}
            />
          </Card>
        </div>
        <AssignmentForm onSaved={onRefresh} />
      </SectionCard>
      <AuditSearch refreshKey={refreshKey} />
      <Banner status="info" icon={<Icon icon={CircleAlert} size="md" />} title="Access changes are deterministic, effective-dated, and audited; they never depend on an AI decision." collapsible={false} />
    </>
  )
}
