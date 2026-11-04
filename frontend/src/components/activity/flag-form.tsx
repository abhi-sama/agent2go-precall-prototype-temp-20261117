"use client"

import { Flag as FlagIcon, Send } from "lucide-react"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useDataAdapter } from "@/lib/data/data-provider"
import { toDataError, FLAG_KINDS, type DataError, type Flag, type FlagKind, type FlagTargetType } from "@/lib/data/types"
import { newCorrelationId } from "@/lib/log/logger"
import { cn } from "@/lib/utils"
import { FLAG_KIND_LABEL, FLAG_TARGET_LABEL, TARGETS_FOR_KIND } from "./format"
import { FlagStatusBadge } from "./flag-status-badge"

export const MAX_NOTE = 500

/** What is being flagged, when the user arrived from a specific record. */
export interface FlagPreset {
  kind?: FlagKind
  targetType: FlagTargetType
  targetId: string
  /** Human label such as an HCP name; shown to the user, never logged. */
  label?: string
}

/**
 * Raise a flag on an incorrect summary, identifier or territory assignment.
 * The server checks that the record is one the user may see, so a mistyped or out-of-scope id is
 * refused with the same message either way.
 */
export function FlagForm({
  preset,
  onFlagged,
  onDone,
}: {
  preset?: FlagPreset
  onFlagged: (flag: Flag) => void
  onDone: () => void
}) {
  const adapter = useDataAdapter()
  const [kind, setKind] = React.useState<FlagKind>(preset?.kind ?? "IDENTIFIER")
  const allowedTargets = TARGETS_FOR_KIND[kind]
  const [targetType, setTargetType] = React.useState<FlagTargetType>(preset?.targetType ?? allowedTargets[0])
  const [targetId, setTargetId] = React.useState(preset?.targetId ?? "")
  const [note, setNote] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<DataError | null>(null)
  const [sent, setSent] = React.useState<Flag | null>(null)

  const locked = preset !== undefined
  const effectiveType = allowedTargets.includes(targetType) ? targetType : allowedTargets[0]
  const valid = targetId.trim().length > 0 && note.length <= MAX_NOTE

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      const flag = await adapter.flagIssue(
        { correlationId: newCorrelationId() },
        { kind, targetType: effectiveType, targetId: targetId.trim(), note: note.trim() || null },
      )
      setSent(flag)
      onFlagged(flag)
    } catch (err) {
      setError(toDataError(err))
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div data-testid="flag-sent" role="status" className="flex flex-col gap-4 rounded-2xl border bg-fact-soft p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-base font-semibold">Flag received</h3>
          <FlagStatusBadge status={sent.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          A reviewer will look at it. Its status is shown under <strong>My flags</strong> and updates as it is reviewed.
        </p>
        <div>
          <Button onClick={onDone}>Done</Button>
        </div>
      </div>
    )
  }

  return (
    <form data-testid="flag-form" onSubmit={submit} className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2" disabled={busy}>
        <legend className="mb-1 text-sm font-semibold">What is wrong?</legend>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="What is wrong">
          {FLAG_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              data-testid={`flag-kind-${k}`}
              disabled={locked && !TARGETS_FOR_KIND[k].includes(preset.targetType)}
              onClick={() => {
                setKind(k)
                if (!locked) setTargetType(TARGETS_FOR_KIND[k][0])
              }}
              className={cn(
                "min-h-11 rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors disabled:opacity-50",
                kind === k ? "border-primary bg-primary/10 text-foreground ring-2 ring-primary/30" : "bg-background hover:bg-muted",
              )}
            >
              {FLAG_KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </fieldset>

      {locked ? (
        <div className="rounded-xl border bg-muted/40 p-3 text-sm" data-testid="flag-target">
          <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Flagging</span>
          <p className="mt-1 font-medium">
            {FLAG_TARGET_LABEL[effectiveType]} <span className="font-mono">{targetId}</span>
            {preset?.label && <span className="text-muted-foreground"> · {preset.label}</span>}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="flag-target-type">Type</Label>
            <select
              id="flag-target-type"
              data-testid="flag-target-type"
              value={effectiveType}
              onChange={(e) => setTargetType(e.target.value as FlagTargetType)}
              className="h-11 rounded-lg border bg-background px-3 text-sm"
            >
              {allowedTargets.map((t) => (
                <option key={t} value={t}>
                  {FLAG_TARGET_LABEL[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="flag-target-id">{effectiveType === "SUMMARY" ? "Summary reference" : `${FLAG_TARGET_LABEL[effectiveType]} id`}</Label>
            <Input
              id="flag-target-id"
              data-testid="flag-target-id"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              placeholder={effectiveType === "TERRITORY" ? "For example T01-01" : "Copy the id shown next to the record"}
              autoComplete="off"
              spellCheck={false}
              maxLength={128}
              className="h-11"
            />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="flag-note">What should the reviewer know? (optional)</Label>
        <textarea
          id="flag-note"
          data-testid="flag-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          maxLength={MAX_NOTE + 50}
          placeholder="Say what looks wrong and what it should be."
          className="min-h-28 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <p className={cn("text-xs", note.length > MAX_NOTE ? "font-semibold text-destructive" : "text-muted-foreground")}>
          {note.length} / {MAX_NOTE}. Do not include patient details.
        </p>
      </div>

      {error && (
        <p data-testid="flag-error" role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm">
          {error.code === "BAD_REQUEST"
            ? "That could not be flagged. Check the id: it must be a record in your own scope."
            : "The flag could not be sent. Try again."}
          {error.correlationId && <span className="mt-1 block font-mono text-xs opacity-70">Reference {error.correlationId.slice(0, 8)}</span>}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="lg" disabled={!valid || busy} data-testid="flag-submit">
          {busy ? <FlagIcon className="animate-pulse" aria-hidden /> : <Send aria-hidden />}
          {busy ? "Sending…" : "Send flag"}
        </Button>
        <Button type="button" variant="outline" size="lg" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
