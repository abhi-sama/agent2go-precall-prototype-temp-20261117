"use client"

import { Badge } from "@astryxdesign/core/Badge"
import { Banner } from "@astryxdesign/core/Banner"
import { Button } from "@astryxdesign/core/Button"
import { Card } from "@astryxdesign/core/Card"
import { DateInput } from "@astryxdesign/core/DateInput"
import { FormLayout } from "@astryxdesign/core/FormLayout"
import { Grid } from "@astryxdesign/core/Grid"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { List, ListItem } from "@astryxdesign/core/List"
import { NumberInput } from "@astryxdesign/core/NumberInput"
import { Text } from "@astryxdesign/core/Text"
import { TextArea } from "@astryxdesign/core/TextArea"
import { TextInput } from "@astryxdesign/core/TextInput"
import { VStack } from "@astryxdesign/core/VStack"
import { BellRing, CheckCircle2, ClipboardCheck, ListTodo, Plus, Sparkles } from "lucide-react"
import * as React from "react"
import { useDataAdapter } from "@/lib/data/data-provider"
import { newCorrelationId } from "@/lib/log/logger"
import { useQuery } from "@/lib/data/use-query"

type DateValue = React.ComponentProps<typeof DateInput>["value"]
type Notice = { text: string; status: "success" | "error" }

/** Optional workflow surface: entered text is never sent to a model by this feature. */
export function OptionalWorkspace() {
  const adapter = useDataAdapter()
  const drafts = useQuery("postCallDrafts", "mine", (ctx) => adapter.postCallDrafts(ctx))
  const tasks = useQuery("myFollowUpTasks", "mine", (ctx) => adapter.myFollowUpTasks(ctx))
  const rules = useQuery("topicAlertRules", "mine", (ctx) => adapter.topicAlertRules(ctx))
  const alerts = useQuery("topicAlerts", "mine", (ctx) => adapter.topicAlerts(ctx))
  const [notes, setNotes] = React.useState("")
  const [task, setTask] = React.useState("")
  const [dueDate, setDueDate] = React.useState<DateValue>(undefined)
  const [topic, setTopic] = React.useState("")
  const [threshold, setThreshold] = React.useState<number | null>(3)
  const [periodDays, setPeriodDays] = React.useState<number | null>(30)
  const [notice, setNotice] = React.useState<Notice | null>(null)
  const [busy, setBusy] = React.useState<"draft" | "task" | "alert" | null>(null)

  async function createDraft() {
    setBusy("draft"); setNotice(null)
    try { await adapter.createPostCallDraft({ correlationId: newCorrelationId() }, { notes }); setNotes(""); drafts.refetch(); setNotice({ text: "Draft created from your exact note lines. Review before using it.", status: "success" }) }
    catch { setNotice({ text: "The draft could not be created. Keep your notes and try again.", status: "error" }) }
    finally { setBusy(null) }
  }
  async function confirmDraft(draftId: string) {
    setBusy("draft"); setNotice(null)
    try { await adapter.confirmPostCallDraft({ correlationId: newCorrelationId() }, draftId); drafts.refetch(); setNotice({ text: "Draft confirmed. It remains editable and is not submitted to a CRM.", status: "success" }) }
    catch { setNotice({ text: "The draft could not be confirmed. Try again.", status: "error" }) }
    finally { setBusy(null) }
  }
  async function confirmTask() {
    setBusy("task"); setNotice(null)
    try { await adapter.confirmFollowUpTasks({ correlationId: newCorrelationId() }, [{ description: task, ...(dueDate ? { dueDate } : {}) }]); setTask(""); setDueDate(undefined); tasks.refetch(); setNotice({ text: "Follow-up task confirmed and added to your list.", status: "success" }) }
    catch { setNotice({ text: "The task was not confirmed. Check its description and try again.", status: "error" }) }
    finally { setBusy(null) }
  }
  async function createRule() {
    setBusy("alert"); setNotice(null)
    try { await adapter.createTopicAlertRule({ correlationId: newCorrelationId() }, { topic, threshold: Number(threshold), periodDays: Number(periodDays) }); setTopic(""); rules.refetch(); alerts.refetch(); setNotice({ text: "Topic alert rule saved. Counts are evaluated deterministically from permitted records.", status: "success" }) }
    catch { setNotice({ text: "The alert rule could not be saved. Use a topic, positive threshold, and period.", status: "error" }) }
    finally { setBusy(null) }
  }

  return (
    <VStack as="section" gap={4} className="@container" aria-labelledby="optional-workflows-title">
      <HStack gap={3} wrap="wrap" justify="between" align="end">
        <VStack gap={1}>
          <Heading level={2} id="optional-workflows-title">Optional post-call workflow</Heading>
          <Text as="p" type="supporting" className="max-w-3xl">These local-ready features need approved external inputs and operational ownership in production. They never submit to a CRM.</Text>
        </VStack>
        <Badge variant="warning" label="Optional · production inputs required" />
      </HStack>
      {notice && <Banner status={notice.status} role="status" data-testid="post-call-notice" title={notice.text} />}
      <div className="grid items-start gap-4 @2xl:grid-cols-2 @4xl:grid-cols-3">
        <Card data-testid="post-call-drafts" padding={5}>
          <VStack gap={3}>
            <VStack gap={1}>
              <HStack gap={2} align="center"><Icon icon={ClipboardCheck} color="accent" /><Heading level={3}>Post-call draft</Heading></HStack>
              <Text as="p" type="supporting">Structured by preserving each entered note line exactly. No observations are invented.</Text>
            </VStack>
            <FormLayout>
              <TextArea id="post-call-notes" data-testid="post-call-notes" label="Entered notes" value={notes} onChange={setNotes} rows={5} placeholder="One observation per line" />
              <Button variant="primary" width="100%" label={busy === "draft" ? "Creating draft…" : "Create review draft"} icon={<Icon icon={Sparkles} />} onClick={() => void createDraft()} isDisabled={!notes.trim() || busy !== null} />
            </FormLayout>
            {drafts.status === "success" && drafts.data.slice(0, 1).map((draft) => (
              <Card key={draft.draftId} variant="muted" padding={3}>
                <VStack gap={2}>
                  <Text as="p" weight="medium">{draft.status === "DRAFT" ? "Review required" : "Confirmed"} · {draft.status}</Text>
                  <List listStyle="disc" edge="flush">
                    {draft.structuredLines.map((line, index) => <ListItem key={`${draft.draftId}-${index}`} label={<Text as="p">{line}</Text>} />)}
                  </List>
                  {draft.status === "DRAFT" && <Button variant="secondary" width="100%" label="Confirm draft" icon={<Icon icon={CheckCircle2} />} onClick={() => void confirmDraft(draft.draftId)} isDisabled={busy !== null} />}
                </VStack>
              </Card>
            ))}
          </VStack>
        </Card>

        <Card data-testid="confirmed-tasks" padding={5}>
          <VStack gap={3}>
            <VStack gap={1}>
              <HStack gap={2} align="center"><Icon icon={ListTodo} color="accent" /><Heading level={3}>Confirmed follow-ups</Heading></HStack>
              <Text as="p" type="supporting">Suggestions are not tasks. A task exists only after you confirm it here.</Text>
            </VStack>
            <Grid columns={{ minWidth: 160, max: 2 }} gap={3}>
              <TextInput data-testid="task-description" label="Task" value={task} onChange={setTask} placeholder="e.g. Send evidence follow-up" />
              <DateInput label="Due date" value={dueDate} onChange={setDueDate} />
            </Grid>
            <Button variant="primary" width="100%" label={busy === "task" ? "Confirming…" : "Confirm task"} icon={<Icon icon={CheckCircle2} />} onClick={() => void confirmTask()} isDisabled={!task.trim() || busy !== null} />
            {tasks.status === "success" && (tasks.data.length ? (
              <List hasDividers edge="flush">
                {tasks.data.map((item) => (
                  <ListItem
                    key={item.taskId}
                    label={<Text as="p" weight="medium">{item.description}</Text>}
                    description={`Owner: you · ${item.dueDate ? `Due ${item.dueDate}` : "No due date"} · ${item.status.replace("_", " ")}`}
                  />
                ))}
              </List>
            ) : <Text as="p" type="supporting">No confirmed follow-ups yet.</Text>)}
          </VStack>
        </Card>

        <Card data-testid="topic-alerts" padding={5} className="@2xl:col-span-2 @4xl:col-span-1">
          <VStack gap={3}>
            <VStack gap={1}>
              <HStack gap={2} align="center"><Icon icon={BellRing} color="accent" /><Heading level={3}>Topic alerts</Heading></HStack>
              <Text as="p" type="supporting">Rules count matching in-scope recorded responses over a fixed period. Evidence is response IDs, not generated claims.</Text>
            </VStack>
            <TextInput data-testid="alert-topic" label="Topic phrase" value={topic} onChange={setTopic} placeholder="e.g. evidence" />
            <Grid columns={{ minWidth: 140, max: 2 }} gap={3}>
              <NumberInput label="Threshold" value={threshold} onChange={setThreshold} min={1} />
              <NumberInput label="Days" value={periodDays} onChange={setPeriodDays} min={1} max={366} />
            </Grid>
            <Button variant="primary" width="100%" label={busy === "alert" ? "Saving rule…" : "Save alert rule"} icon={<Icon icon={Plus} />} onClick={() => void createRule()} isDisabled={!topic.trim() || busy !== null} />
            {alerts.status === "success" && (alerts.data.length ? (
              <VStack gap={2}>
                {alerts.data.map((alert) => (
                  <Banner
                    key={alert.ruleId}
                    status="warning"
                    title={`${alert.topic}: ${alert.count} responses / ${alert.periodDays} days`}
                    description={`Threshold ${alert.threshold} · Evidence: ${alert.evidenceResponseIds.join(", ")}`}
                  />
                ))}
              </VStack>
            ) : <Text as="p" type="supporting">No alert threshold has been met.</Text>)}
            {rules.status === "success" && rules.data.length > 0 && <Text as="p" type="supporting" size="xsm">{rules.data.length} active deterministic rule{rules.data.length === 1 ? "" : "s"}.</Text>}
          </VStack>
        </Card>
      </div>
    </VStack>
  )
}
