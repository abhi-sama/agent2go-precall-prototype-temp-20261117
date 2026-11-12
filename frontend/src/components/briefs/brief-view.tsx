"use client"

import { Badge } from "@astryxdesign/core/Badge"
import { Banner } from "@astryxdesign/core/Banner"
import { Button } from "@astryxdesign/core/Button"
import { Card } from "@astryxdesign/core/Card"
import { Grid } from "@astryxdesign/core/Grid"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { IconButton } from "@astryxdesign/core/IconButton"
import { List, ListItem } from "@astryxdesign/core/List"
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList"
import { Text } from "@astryxdesign/core/Text"
import { TextArea } from "@astryxdesign/core/TextArea"
import { VStack } from "@astryxdesign/core/VStack"
import { CalendarClock, ClipboardList, Database, FileText, Pencil, Plus, Printer, RefreshCw, Save, Trash2, Undo2 } from "lucide-react"
import * as React from "react"
import { CitationSheet } from "@/components/chat/citation-sheet"
import { AiSummary, CitationChip, SourceFact, Suggestion } from "@/components/provenance/provenance"
import { useAppToast } from "@/components/state/use-app-toast"
import type { CitationItem } from "@/lib/chat/events"
import { useDataAdapter } from "@/lib/data/data-provider"
import { toDataError, type BriefEvidence, type BriefExport, type BriefItem, type BriefStatement, type PreCallBrief } from "@/lib/data/types"
import { newCorrelationId } from "@/lib/log/logger"
import { formatBriefDay, formatBriefTime } from "./format"
import { BriefPrintDocument } from "./brief-print-document"

const MAX_ITEMS = 12
const MAX_TEXT = 600
const MAX_DETAIL = 800

interface Draft {
  key: string
  itemId: string | null
  text: string
  detail: string
  origin: BriefItem["origin"]
  edited: boolean
  evidenceIds: string[]
}

const toDraft = (item: BriefItem): Draft => ({
  key: item.itemId,
  itemId: item.itemId,
  text: item.text,
  detail: item.detail ?? "",
  origin: item.origin,
  edited: item.edited,
  evidenceIds: item.evidenceIds,
})

const sameDrafts = (a: Draft[], b: Draft[]) =>
  a.length === b.length && a.every((d, i) => d.itemId === b[i].itemId && d.text === b[i].text && d.detail === b[i].detail)

function Citations({
  ids,
  evidence,
  onOpen,
}: {
  ids: string[]
  evidence: Map<string, BriefEvidence>
  onOpen: (citation: CitationItem) => void
}) {
  if (ids.length === 0) return null
  return (
    <HStack gap={1.5} wrap="wrap" paddingBlockStart={1.5} data-testid="citations">
      {ids.map((id) => {
        const record = evidence.get(id)
        if (!record) return null
        return (
          <CitationChip
            key={id}
            data-testid={`cite-${record.recordId}`}
            onOpen={() => onOpen({ dataset: record.dataset, recordId: record.recordId, label: record.label })}
          >
            <Icon icon={FileText} size="xsm" />
            {record.label}
          </CitationChip>
        )
      })}
    </HStack>
  )
}

function Statements({
  title,
  items,
  evidence,
  onOpen,
  emptyNote,
  testId,
}: {
  title: string
  items: BriefStatement[]
  evidence: Map<string, BriefEvidence>
  onOpen: (c: CitationItem) => void
  emptyNote: string
  testId: string
}) {
  return (
    <VStack gap={2} data-testid={testId}>
      <Heading level={4}>{title}</Heading>
      {items.length === 0 ? (
        <Text type="supporting" as="p">{emptyNote}</Text>
      ) : (
        <List edge="flush">
          {items.map((s) => (
            <ListItem
              key={s.statementId}
              data-testid="statement"
              data-evidence-count={s.evidenceIds.length}
              align="start"
              label={<Text as="p">{s.text}</Text>}
              description={<Citations ids={s.evidenceIds} evidence={evidence} onOpen={onOpen} />}
            />
          ))}
        </List>
      )}
    </VStack>
  )
}

function Origin({ draft }: { draft: Draft }) {
  if (draft.origin === "USER") return <Badge label="Added by you" />
  return draft.edited ? <Badge variant="info" label="Generated · edited" /> : <Badge label="Generated" />
}

function EditableList({
  label,
  testId,
  drafts,
  setDrafts,
  evidence,
  onOpen,
  withDetail,
}: {
  label: string
  testId: string
  drafts: Draft[]
  setDrafts: (next: Draft[]) => void
  evidence: Map<string, BriefEvidence>
  onOpen: (c: CitationItem) => void
  withDetail: boolean
}) {
  const [editing, setEditing] = React.useState<string | null>(null)
  const update = (key: string, patch: Partial<Draft>) => setDrafts(drafts.map((d) => (d.key === key ? { ...d, ...patch } : d)))
  const add = () => {
    const key = `new-${crypto.randomUUID()}`
    setDrafts([...drafts, { key, itemId: null, text: "", detail: "", origin: "USER", edited: false, evidenceIds: [] }])
    setEditing(key)
  }
  return (
    <VStack gap={3} data-testid={testId}>
      {drafts.length === 0 && <Text type="supporting" as="p">Nothing here yet. Add your own item.</Text>}
      {drafts.length > 0 && (
        <List listStyle="decimal" hasDividers edge="flush">
          {drafts.map((d, index) => {
            const open = editing === d.key
            return (
              <ListItem
                key={d.key}
                data-testid={`${testId}-item`}
                align="start"
                label={
                  open ? (
                    <VStack gap={2}>
                      <TextArea data-layout-ok="overlap"
                        hasAutoFocus
                        label={`${label} text`}
                        isLabelHidden
                        value={d.text}
                        maxLength={MAX_TEXT}
                        onChange={(value) => update(d.key, { text: value.slice(0, MAX_TEXT) })}
                        rows={2}
                      />
                      {withDetail && (
                        <TextArea data-layout-ok="overlap"
                          label={`${label} detail`}
                          isLabelHidden
                          value={d.detail}
                          maxLength={MAX_DETAIL}
                          onChange={(value) => update(d.key, { detail: value.slice(0, MAX_DETAIL) })}
                          rows={2}
                          placeholder="Detail (optional)"
                        />
                      )}
                    </VStack>
                  ) : (
                    <Text as="p" weight="medium">{d.text || <Text color="secondary">Empty item</Text>}</Text>
                  )
                }
                description={
                  <VStack gap={1.5}>
                    {!open && d.detail && <Text type="supporting" as="p">{d.detail}</Text>}
                    <HStack gap={2} wrap="wrap" align="center">
                      <Origin draft={d} />
                      <Citations ids={d.evidenceIds} evidence={evidence} onOpen={onOpen} />
                    </HStack>
                  </VStack>
                }
                endContent={
                  <HStack gap={1}>
                    <IconButton
                      variant="ghost"
                      label={open ? `Done editing ${label.toLowerCase()} ${index + 1}` : `Edit ${label.toLowerCase()} ${index + 1}`}
                      aria-pressed={open}
                      icon={open ? <Icon icon="check" /> : <Icon icon={Pencil} />}
                      onClick={() => setEditing(open ? null : d.key)}
                    />
                    <IconButton
                      variant="ghost"
                      label={`Remove ${label.toLowerCase()} ${index + 1}`}
                      icon={<Icon icon={Trash2} />}
                      onClick={() => setDrafts(drafts.filter((x) => x.key !== d.key))}
                    />
                  </HStack>
                }
              />
            )
          })}
        </List>
      )}
      <HStack>
        <Button variant="secondary" label={`Add ${label.toLowerCase()}`} icon={<Icon icon={Plus} />} isDisabled={drafts.length >= MAX_ITEMS} onClick={add} />
      </HStack>
    </VStack>
  )
}

/**
 * A saved pre-call brief. Source facts, AI-written statements (each with its source records) and
 * editable suggestions (discussion prompts and agenda) are kept visually and verbally apart.
 */
export function BriefView({
  brief,
  onRegenerate,
  regenerating,
  onUpdated,
}: {
  brief: PreCallBrief
  onRegenerate: () => void
  regenerating: boolean
  onUpdated: (brief: PreCallBrief) => void
}) {
  const adapter = useDataAdapter()
  const toast = useAppToast()
  const [objective, setObjective] = React.useState(brief.objective)
  const [prompts, setPrompts] = React.useState<Draft[]>(() => brief.prompts.map(toDraft))
  const [agenda, setAgenda] = React.useState<Draft[]>(() => brief.agenda.map(toDraft))
  const [saving, setSaving] = React.useState(false)
  const [exporting, setExporting] = React.useState(false)
  const [printDocument, setPrintDocument] = React.useState<BriefExport | null>(null)
  const [citation, setCitation] = React.useState<CitationItem | null>(null)
  const evidence = React.useMemo(() => new Map(brief.evidence.map((e) => [e.evidenceId, e])), [brief.evidence])

  const savedPrompts = React.useMemo(() => brief.prompts.map(toDraft), [brief.prompts])
  const savedAgenda = React.useMemo(() => brief.agenda.map(toDraft), [brief.agenda])
  const objectiveValid = objective.trim().length >= 3 && objective.trim().length <= 500
  const dirty = objective !== brief.objective || !sameDrafts(prompts, savedPrompts) || !sameDrafts(agenda, savedAgenda)
  const cleaned = (drafts: Draft[]) => drafts.filter((d) => d.text.trim().length > 0)

  const discard = () => {
    setObjective(brief.objective)
    setPrompts(savedPrompts)
    setAgenda(savedAgenda)
  }

  React.useEffect(() => {
    if (!printDocument) return
    const timer = window.setTimeout(() => {
      window.print()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [printDocument])

  const save = async () => {
    if (!dirty || saving || !objectiveValid) return
    setSaving(true)
    try {
      const toInput = (d: Draft) => ({ itemId: d.itemId, text: d.text.trim(), detail: d.detail.trim() || null })
      const updated = await adapter.saveBriefEdits(
        { correlationId: newCorrelationId() },
        { briefId: brief.briefId, objective: objective.trim(), prompts: cleaned(prompts).map(toInput), agenda: cleaned(agenda).map(toInput) },
      )
      onUpdated(updated)
      toast.success("Changes saved", { description: "Your edits are saved with the brief. Generated items stay marked as generated." })
    } catch (err) {
      const error = toDataError(err)
      toast.error(error.code === "FORBIDDEN" ? "You no longer have access to this HCP" : "Changes were not saved", {
        description: error.code === "FORBIDDEN" ? "The brief cannot be edited." : "Your edits are still on screen. Try again.",
      })
    } finally {
      setSaving(false)
    }
  }

  const exportForPrint = async () => {
    if (dirty || exporting) return
    setExporting(true)
    try {
      const snapshot = await adapter.exportBrief({ correlationId: newCorrelationId() }, brief.briefId)
      setPrintDocument(snapshot)
      toast.success("Print dialog opened", { description: "The export was recorded in the access audit." })
    } catch (err) {
      const error = toDataError(err)
      toast.error(error.code === "FORBIDDEN" ? "You no longer have access to this HCP" : "Brief could not be exported", {
        description: error.code === "FORBIDDEN" ? "Nothing was exported." : "Try again after checking your connection.",
      })
    } finally {
      setExporting(false)
    }
  }

  const stub = brief.modelMode === "stub"

  return (
    <VStack as="article" gap={4} data-testid="brief" data-brief-id={brief.briefId} className="@container animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none">
      <Card padding={5}>
        <VStack as="header" gap={4}>
          <HStack gap={3} wrap="wrap" justify="between" align="start">
            <VStack gap={1}>
              <Text type="label" color="secondary">Pre-call brief</Text>
              <Heading level={2} data-testid="brief-hcp-name">
                {brief.hcpName.value ?? "HCP name not recorded"}
              </Heading>
            </VStack>
            <HStack gap={2} wrap="wrap">
              <Badge data-testid="brief-model-mode" label={stub ? "Written without a model (local stub)" : "Written by AI from your records"} />
              <Button
                data-testid="brief-export"
                variant="secondary"
                label={exporting ? "Preparing export…" : "Print / Save PDF"}
                icon={<Icon icon={Printer} />}
                onClick={exportForPrint}
                isDisabled={exporting || dirty}
                aria-describedby={dirty ? "brief-export-save-first" : undefined}
              />
            </HStack>
          </HStack>

          <TextArea data-layout-ok="overlap"
            id="brief-objective"
            data-testid="brief-objective"
            label="Call objective"
            value={objective}
            maxLength={500}
            rows={2}
            onChange={(value) => setObjective(value.slice(0, 500))}
            status={objectiveValid ? undefined : { type: "error" }}
          />
          {dirty && <Text type="supporting" as="p" id="brief-export-save-first">Save or discard your edits before exporting the saved brief.</Text>}

          <MetadataList columns="multi" label={{ position: "top" }}>
            <MetadataListItem label="Scope"><Text weight="medium" data-testid="brief-scope">{brief.scopeLabel}</Text></MetadataListItem>
            <MetadataListItem label="Data through"><Text weight="medium" hasTabularNumbers data-testid="brief-data-through">{formatBriefDay(brief.dataThrough)}</Text></MetadataListItem>
            <MetadataListItem label="Generated"><Text weight="medium" hasTabularNumbers data-testid="brief-generated-at">{formatBriefTime(brief.generatedAt)}</Text></MetadataListItem>
            <MetadataListItem label="Last interaction"><Text weight="medium" hasTabularNumbers>{formatBriefDay(brief.lastInteractionDate)}</Text></MetadataListItem>
          </MetadataList>
        </VStack>
      </Card>

      {brief.stale && (
        <Banner
          status="warning"
          role="status"
          data-testid="brief-stale"
          icon={<Icon icon={CalendarClock} />}
          title="Newer data available - regenerate"
          description={`${
            brief.staleReasons.includes("HCP_DATA_CHANGED")
              ? "Records for this HCP changed after this brief was written."
              : "A newer data load arrived after this brief was written."
          }${brief.currentDataThrough ? ` Data is now through ${formatBriefDay(brief.currentDataThrough)}.` : ""}`}
          endContent={
            <Button
              data-testid="brief-regenerate"
              variant="primary"
              label={regenerating ? "Regenerating…" : "Regenerate brief"}
              icon={<Icon icon={RefreshCw} />}
              isLoading={regenerating}
              onClick={onRegenerate}
            />
          }
        />
      )}

      {brief.droppedStatements > 0 && (
        <Text type="supporting" as="p" data-testid="brief-dropped">
          {brief.droppedStatements} generated statement{brief.droppedStatements === 1 ? " was" : "s were"} left out because{" "}
          {brief.droppedStatements === 1 ? "it" : "they"} could not be tied to a source record.
        </Text>
      )}

      <Grid columns={{ minWidth: 320, max: 2 }} gap={4}>
        <VStack gap={5}>
          <SourceFact
            title="Counted from your records"
            meta={<Text type="inherit">Counted by database queries, not by the AI. Open any record to see its source.</Text>}
          >
            <MetadataList columns={2} label={{ position: "top" }} data-testid="brief-facts">
              {brief.facts.map((f) => (
                <MetadataListItem key={f.label} label={f.label}>
                  <Text weight="semibold" hasTabularNumbers>{f.value}</Text>
                </MetadataListItem>
              ))}
            </MetadataList>
          </SourceFact>

          <AiSummary
            title="What the records show"
            meta={
              <Text type="inherit">
                {stub ? "Written by code from the records, not by a model." : "Generated by AI."} Every statement links to the call or response it comes from.
              </Text>
            }
          >
            <VStack gap={5}>
              <Statements testId="brief-engagement" title="Previous engagement" items={brief.engagement} evidence={evidence} onOpen={setCitation} emptyNote="No previous calls are recorded for this HCP." />
              <Statements testId="brief-perspectives" title="Recorded perspectives" items={brief.perspectives} evidence={evidence} onOpen={setCitation} emptyNote="No recorded responses are available." />
              <Statements testId="brief-followups" title="Possible follow-ups" items={brief.followUps} evidence={evidence} onOpen={setCitation} emptyNote="No follow-up topics are recorded." />
            </VStack>
          </AiSummary>
        </VStack>

        <VStack gap={5}>
          <Suggestion
            title="Discussion prompts"
            meta={<Text type="inherit" data-testid="prompts-label">Generated suggestions you can edit, remove or add to. Not confirmed commitments.</Text>}
          >
            <EditableList label="Prompt" testId="brief-prompts" drafts={prompts} setDrafts={setPrompts} evidence={evidence} onOpen={setCitation} withDetail={false} />
          </Suggestion>

          <Suggestion
            title="Suggested agenda"
            meta={<Text type="inherit" data-testid="agenda-label">Generated from your objective and the records. Fully editable.</Text>}
          >
            <EditableList label="Agenda item" testId="brief-agenda" drafts={agenda} setDrafts={setAgenda} evidence={evidence} onOpen={setCitation} withDetail />
          </Suggestion>
        </VStack>
      </Grid>

      <Grid columns={{ minWidth: 320, max: 2 }} gap={4}>
        <section data-testid="brief-missing" aria-labelledby="brief-missing-h">
          <Card padding={5}>
            <VStack gap={2}>
              <HStack gap={2} align="center">
                <Icon icon={ClipboardList} color="secondary" />
                <Heading level={3} id="brief-missing-h">Missing information</Heading>
              </HStack>
              {brief.missing.length === 0 ? (
                <Text type="supporting" as="p">Nothing is missing that the brief depends on.</Text>
              ) : (
                <List edge="flush" listStyle="disc">
                  {brief.missing.map((m) => (
                    <ListItem key={m.code} label={<Text as="p">{m.message}</Text>} />
                  ))}
                </List>
              )}
            </VStack>
          </Card>
        </section>

        <section data-testid="brief-evidence" aria-labelledby="brief-evidence-h">
          <Card padding={5}>
            <VStack gap={2}>
              <HStack gap={2} align="center">
                <Icon icon={Database} color="secondary" />
                <Heading level={3} id="brief-evidence-h">Supporting records</Heading>
                <Badge label={String(brief.evidence.length)} />
              </HStack>
              <HStack gap={1.5} wrap="wrap">
                {brief.evidence.map((e) => (
                  <Button
                    key={e.evidenceId}
                    size="sm"
                    variant="secondary"
                    label={e.label}
                    icon={<Icon icon={FileText} size="xsm" />}
                    onClick={() => setCitation({ dataset: e.dataset, recordId: e.recordId, label: e.label })}
                  />
                ))}
              </HStack>
            </VStack>
          </Card>
        </section>
      </Grid>

      {dirty && (
        <Card data-testid="brief-save-bar" padding={3} elevation="med" className="sticky bottom-3 z-10 animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none">
          <HStack gap={3} wrap="wrap" justify="between" align="center">
            <Text weight="medium" as="p" role="status">You have unsaved changes{objectiveValid ? "" : " · the objective needs at least 3 characters"}</Text>
            <HStack gap={2}>
              <Button variant="secondary" label="Discard" icon={<Icon icon={Undo2} />} onClick={discard} isDisabled={saving} />
              <Button data-testid="brief-save" variant="primary" label={saving ? "Saving…" : "Save changes"} icon={<Icon icon={Save} />} onClick={save} isLoading={saving} isDisabled={!objectiveValid} />
            </HStack>
          </HStack>
        </Card>
      )}

      <CitationSheet citation={citation} onClose={() => setCitation(null)} />
      {printDocument && <BriefPrintDocument brief={printDocument} />}
    </VStack>
  )
}
