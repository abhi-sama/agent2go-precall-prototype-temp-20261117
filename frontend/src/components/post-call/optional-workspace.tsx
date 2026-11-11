"use client"

import * as React from "react"
import { BellRing, CheckCircle2, ClipboardCheck, ListTodo, Plus, Sparkles } from "lucide-react"
import { FormLayout } from "@astryxdesign/core/FormLayout"
import { TextArea } from "@astryxdesign/core/TextArea"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useDataAdapter } from "@/lib/data/data-provider"
import { newCorrelationId } from "@/lib/log/logger"
import { useQuery } from "@/lib/data/use-query"

/** Optional workflow surface: entered text is never sent to a model by this feature. */
export function OptionalWorkspace() {
  const adapter = useDataAdapter()
  const drafts = useQuery("postCallDrafts", "mine", (ctx) => adapter.postCallDrafts(ctx))
  const tasks = useQuery("myFollowUpTasks", "mine", (ctx) => adapter.myFollowUpTasks(ctx))
  const rules = useQuery("topicAlertRules", "mine", (ctx) => adapter.topicAlertRules(ctx))
  const alerts = useQuery("topicAlerts", "mine", (ctx) => adapter.topicAlerts(ctx))
  const [notes, setNotes] = React.useState("")
  const [task, setTask] = React.useState("")
  const [dueDate, setDueDate] = React.useState("")
  const [topic, setTopic] = React.useState("")
  const [threshold, setThreshold] = React.useState("3")
  const [periodDays, setPeriodDays] = React.useState("30")
  const [notice, setNotice] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<"draft" | "task" | "alert" | null>(null)

  async function createDraft() {
    setBusy("draft"); setNotice(null)
    try { await adapter.createPostCallDraft({ correlationId: newCorrelationId() }, { notes }); setNotes(""); drafts.refetch(); setNotice("Draft created from your exact note lines. Review before using it.") }
    catch { setNotice("The draft could not be created. Keep your notes and try again.") }
    finally { setBusy(null) }
  }
  async function confirmDraft(draftId: string) {
    setBusy("draft"); setNotice(null)
    try { await adapter.confirmPostCallDraft({ correlationId: newCorrelationId() }, draftId); drafts.refetch(); setNotice("Draft confirmed. It remains editable and is not submitted to a CRM.") }
    catch { setNotice("The draft could not be confirmed. Try again.") }
    finally { setBusy(null) }
  }
  async function confirmTask() {
    setBusy("task"); setNotice(null)
    try { await adapter.confirmFollowUpTasks({ correlationId: newCorrelationId() }, [{ description: task, ...(dueDate ? { dueDate } : {}) }]); setTask(""); setDueDate(""); tasks.refetch(); setNotice("Follow-up task confirmed and added to your list.") }
    catch { setNotice("The task was not confirmed. Check its description and try again.") }
    finally { setBusy(null) }
  }
  async function createRule() {
    setBusy("alert"); setNotice(null)
    try { await adapter.createTopicAlertRule({ correlationId: newCorrelationId() }, { topic, threshold: Number(threshold), periodDays: Number(periodDays) }); setTopic(""); rules.refetch(); alerts.refetch(); setNotice("Topic alert rule saved. Counts are evaluated deterministically from permitted records.") }
    catch { setNotice("The alert rule could not be saved. Use a topic, positive threshold, and period.") }
    finally { setBusy(null) }
  }

  return <section className="mt-8 space-y-6" aria-labelledby="optional-workflows-title">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 id="optional-workflows-title" className="text-2xl font-semibold tracking-tight">Optional post-call workflow</h2><p className="mt-1 max-w-3xl text-sm text-muted-foreground">These local-ready features need approved external inputs and operational ownership in production. They never submit to a CRM.</p></div>
      <Badge variant="outline" className="min-h-8 border-warning/50 text-warning">Optional · production inputs required</Badge>
    </div>
    {notice && <p role="status" className="rounded-xl bg-muted px-4 py-3 text-sm" data-testid="post-call-notice">{notice}</p>}
    <div className="grid gap-5 xl:grid-cols-3">
      <Card data-testid="post-call-drafts"><CardHeader><CardTitle className="flex items-center gap-2"><ClipboardCheck className="size-5 text-primary" />Post-call draft</CardTitle><CardDescription>Structured by preserving each entered note line exactly. No observations are invented.</CardDescription></CardHeader><CardContent className="space-y-3"><FormLayout><TextArea id="post-call-notes" data-testid="post-call-notes" label="Entered notes" value={notes} onChange={setNotes} rows={5} placeholder="One observation per line" /><Button onClick={() => void createDraft()} disabled={!notes.trim() || busy !== null} className="w-full"><Sparkles />{busy === "draft" ? "Creating draft…" : "Create review draft"}</Button></FormLayout>{drafts.status === "success" && drafts.data.slice(0, 1).map((draft) => <div key={draft.draftId} className="rounded-lg bg-ai-soft p-3 text-sm"><p className="font-medium">{draft.status === "DRAFT" ? "Review required" : "Confirmed"} · {draft.status}</p><ul className="mt-2 list-disc space-y-1 pl-5">{draft.structuredLines.map((line, index) => <li key={`${draft.draftId}-${index}`}>{line}</li>)}</ul>{draft.status === "DRAFT" && <Button variant="outline" className="mt-3 w-full" onClick={() => void confirmDraft(draft.draftId)} disabled={busy !== null}><CheckCircle2 />Confirm draft</Button>}</div>)}</CardContent></Card>
      <Card data-testid="confirmed-tasks"><CardHeader><CardTitle className="flex items-center gap-2"><ListTodo className="size-5 text-primary" />Confirmed follow-ups</CardTitle><CardDescription>Suggestions are not tasks. A task exists only after you confirm it here.</CardDescription></CardHeader><CardContent className="space-y-3"><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="task-description">Task</Label><Input id="task-description" data-testid="task-description" value={task} onChange={(event) => setTask(event.target.value)} placeholder="e.g. Send evidence follow-up" /></div><div className="space-y-1.5"><Label htmlFor="task-due">Due date</Label><Input id="task-due" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></div></div><Button onClick={() => void confirmTask()} disabled={!task.trim() || busy !== null} className="w-full"><CheckCircle2 />{busy === "task" ? "Confirming…" : "Confirm task"}</Button>{tasks.status === "success" && <ul className="space-y-2">{tasks.data.length ? tasks.data.map((item) => <li key={item.taskId} className="rounded-lg border p-3 text-sm"><p className="font-medium">{item.description}</p><p className="mt-1 text-muted-foreground">Owner: you · {item.dueDate ? `Due ${item.dueDate}` : "No due date"} · {item.status.replace("_", " ")}</p></li>) : <li className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">No confirmed follow-ups yet.</li>}</ul>}</CardContent></Card>
      <Card data-testid="topic-alerts"><CardHeader><CardTitle className="flex items-center gap-2"><BellRing className="size-5 text-primary" />Topic alerts</CardTitle><CardDescription>Rules count matching in-scope recorded responses over a fixed period. Evidence is response IDs, not generated claims.</CardDescription></CardHeader><CardContent className="space-y-3"><div className="grid gap-3 sm:grid-cols-3"><div className="space-y-1.5 sm:col-span-3"><Label htmlFor="alert-topic">Topic phrase</Label><Input id="alert-topic" data-testid="alert-topic" value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="e.g. evidence" /></div><div className="space-y-1.5"><Label htmlFor="alert-threshold">Threshold</Label><Input id="alert-threshold" type="number" min="1" value={threshold} onChange={(event) => setThreshold(event.target.value)} /></div><div className="space-y-1.5"><Label htmlFor="alert-period">Days</Label><Input id="alert-period" type="number" min="1" max="366" value={periodDays} onChange={(event) => setPeriodDays(event.target.value)} /></div></div><Button onClick={() => void createRule()} disabled={!topic.trim() || busy !== null} className="w-full"><Plus />{busy === "alert" ? "Saving rule…" : "Save alert rule"}</Button>{alerts.status === "success" && <ul className="space-y-2">{alerts.data.length ? alerts.data.map((alert) => <li key={alert.ruleId} className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"><p className="font-medium">{alert.topic}: {alert.count} responses / {alert.periodDays} days</p><p className="mt-1 text-muted-foreground">Threshold {alert.threshold} · Evidence: {alert.evidenceResponseIds.join(", ")}</p></li>) : <li className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">No alert threshold has been met.</li>}</ul>}{rules.status === "success" && rules.data.length > 0 && <p className="text-xs text-muted-foreground">{rules.data.length} active deterministic rule{rules.data.length === 1 ? "" : "s"}.</p>}</CardContent></Card>
    </div>
  </section>
}
