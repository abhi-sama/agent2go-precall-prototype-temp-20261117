"use client"

import { Banner } from "@astryxdesign/core/Banner"
import { Button } from "@astryxdesign/core/Button"
import { Card } from "@astryxdesign/core/Card"
import { FormLayout } from "@astryxdesign/core/FormLayout"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { RadioList, RadioListItem } from "@astryxdesign/core/RadioList"
import { Selector } from "@astryxdesign/core/Selector"
import { Text } from "@astryxdesign/core/Text"
import { TextArea } from "@astryxdesign/core/TextArea"
import { TextInput } from "@astryxdesign/core/TextInput"
import { VStack } from "@astryxdesign/core/VStack"
import { Send } from "lucide-react"
import * as React from "react"
import { useDataAdapter } from "@/lib/data/data-provider"
import { toDataError, FLAG_KINDS, type DataError, type Flag, type FlagKind, type FlagTargetType } from "@/lib/data/types"
import { newCorrelationId } from "@/lib/log/logger"
import { FLAG_KIND_LABEL, FLAG_TARGET_LABEL, TARGETS_FOR_KIND } from "./format"
import { FlagStatusBadge } from "./flag-status-badge"

export const MAX_NOTE = 500
const MAX_TARGET_ID = 128

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
      <Card data-testid="flag-sent" role="status" variant="muted" padding={5}>
        <VStack gap={4} align="start">
          <HStack gap={3} wrap="wrap" align="center">
            <Heading level={3}>Flag received</Heading>
            <FlagStatusBadge status={sent.status} />
          </HStack>
          <Text type="supporting" as="p">
            A reviewer will look at it. Its status is shown under <Text weight="semibold">My flags</Text> and updates as it is reviewed.
          </Text>
          <Button label="Done" variant="primary" onClick={onDone} />
        </VStack>
      </Card>
    )
  }

  return (
    <form data-testid="flag-form" onSubmit={submit}>
      <VStack gap={5}>
        <RadioList label="What is wrong?" value={kind} isDisabled={busy} onChange={(next) => {
          const k = next as FlagKind
          setKind(k)
          if (!locked) setTargetType(TARGETS_FOR_KIND[k][0])
        }}>
          {FLAG_KINDS.map((k) => (
            <RadioListItem key={k} value={k} label={FLAG_KIND_LABEL[k]} data-testid={`flag-kind-${k}`} isDisabled={locked && !TARGETS_FOR_KIND[k].includes(preset.targetType)} />
          ))}
        </RadioList>

        {locked ? (
          <Card data-testid="flag-target" variant="muted" padding={3}>
            <VStack gap={1}>
              <Text type="label" color="secondary">
                Flagging
              </Text>
              <Text as="p" weight="medium">
                {FLAG_TARGET_LABEL[effectiveType]} <Text type="code">{targetId}</Text>
                {preset?.label && <Text color="secondary"> · {preset.label}</Text>}
              </Text>
            </VStack>
          </Card>
        ) : (
          <FormLayout direction="horizontal">
            <Selector
              label="Type"
              id="flag-target-type"
              data-testid="flag-target-type"
              value={effectiveType}
              onChange={(next) => setTargetType(next as FlagTargetType)}
              options={allowedTargets.map((t) => ({ value: t, label: FLAG_TARGET_LABEL[t] }))}
              isDisabled={busy}
            />
            <TextInput
              label={effectiveType === "SUMMARY" ? "Summary reference" : `${FLAG_TARGET_LABEL[effectiveType]} id`}
              id="flag-target-id"
              data-testid="flag-target-id"
              value={targetId}
              onChange={(next) => setTargetId(next.slice(0, MAX_TARGET_ID))}
              placeholder={effectiveType === "TERRITORY" ? "For example T01-01" : "Copy the id shown next to the record"}
              autoComplete="off"
              hasSpellCheck={false}
              isDisabled={busy}
            />
          </FormLayout>
        )}

        <TextArea data-layout-ok="overlap"
          label="What should the reviewer know? (optional)"
          id="flag-note"
          data-testid="flag-note"
          value={note}
          onChange={(next) => setNote(next.slice(0, MAX_NOTE + 50))}
          rows={4}
          maxLength={MAX_NOTE}
          description="Do not include patient details."
          placeholder="Say what looks wrong and what it should be."
          status={note.length > MAX_NOTE ? { type: "error", message: `Shorten the note to ${MAX_NOTE} characters or fewer.` } : undefined}
          isDisabled={busy}
        />

        {error && (
          <Banner
            data-testid="flag-error"
            role="alert"
            status="error"
            title={
              error.code === "BAD_REQUEST"
                ? "That could not be flagged. Check the id: it must be a record in your own scope."
                : "The flag could not be sent. Try again."
            }
            description={error.correlationId ? `Reference ${error.correlationId.slice(0, 8)}` : undefined}
          />
        )}

        <HStack gap={2} wrap="wrap">
          <Button type="submit" size="lg" variant="primary" label={busy ? "Sending…" : "Send flag"} icon={<Icon icon={Send} />} isLoading={busy} isDisabled={!valid} data-testid="flag-submit" />
          <Button type="button" size="lg" variant="secondary" label="Cancel" onClick={onDone} />
        </HStack>
      </VStack>
    </form>
  )
}
