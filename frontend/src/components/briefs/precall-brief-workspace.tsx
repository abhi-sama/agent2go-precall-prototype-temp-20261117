"use client"

import { Badge } from "@astryxdesign/core/Badge"
import { Button } from "@astryxdesign/core/Button"
import { Card } from "@astryxdesign/core/Card"
import { EmptyState } from "@astryxdesign/core/EmptyState"
import { FormLayout } from "@astryxdesign/core/FormLayout"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { IconButton } from "@astryxdesign/core/IconButton"
import { List, ListItem } from "@astryxdesign/core/List"
import { Skeleton } from "@astryxdesign/core/Skeleton"
import { StackItem } from "@astryxdesign/core/Stack"
import { Text } from "@astryxdesign/core/Text"
import { TextArea } from "@astryxdesign/core/TextArea"
import { TextInput } from "@astryxdesign/core/TextInput"
import { VStack } from "@astryxdesign/core/VStack"
import { ClipboardList, Lock, Sparkles, UserRound } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import * as React from "react"
import { ErrorState } from "@/components/state/states"
import { useAppToast } from "@/components/state/use-app-toast"
import { useDataAdapter } from "@/lib/data/data-provider"
import { useQuery } from "@/lib/data/use-query"
import { toDataError, type DataError, type HcpSearchResult, type PreCallBrief } from "@/lib/data/types"
import { log, newCorrelationId } from "@/lib/log/logger"
import { cn } from "@/lib/utils"
import { BriefView } from "./brief-view"
import { formatBriefTime } from "./format"

const STEPS = [
  "Checking you may prepare for this HCP…",
  "Reading authorized calls and recorded responses…",
  "Writing the brief and checking every statement has a source…",
  "Saving the brief…",
]

function GeneratingPanel() {
  const [step, setStep] = React.useState(0)
  React.useEffect(() => {
    const id = window.setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 2600)
    return () => window.clearInterval(id)
  }, [])
  return (
    <Card data-testid="brief-generating" aria-busy="true" padding={6} className="animate-in fade-in duration-200 motion-reduce:animate-none">
      <VStack gap={1}>
        <HStack gap={2} align="center" role="status">
          <Icon icon={Sparkles} color="accent" className="motion-safe:animate-pulse" />
          <Text weight="semibold">Generating the brief</Text>
        </HStack>
        <Text type="supporting" as="p" aria-live="polite">{STEPS[step]}</Text>
        <VStack gap={3} paddingBlockStart={4} aria-hidden>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={64} radius={3} index={i} />
          ))}
        </VStack>
      </VStack>
    </Card>
  )
}

/** Pick an authorized HCP, write the call objective, generate, and reopen saved briefs. */
export function PreCallBriefWorkspace() {
  const adapter = useDataAdapter()
  const toast = useAppToast()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const briefId = params.get("brief")
  const presetHcp = params.get("hcp")

  const [draft, setDraft] = React.useState("")
  const [query, setQuery] = React.useState("")
  const [picked, setPicked] = React.useState<{ hcpId: string; name: string } | null>(null)
  const [objective, setObjective] = React.useState("")
  const [generating, setGenerating] = React.useState(false)
  const [created, setCreated] = React.useState<PreCallBrief | null>(null)
  const [formError, setFormError] = React.useState<DataError | null>(null)

  // Arriving from the HCP card (?hcp=): resolve the id to a name through the authorized profile endpoint.
  const preset = useQuery("hcpProfile", presetHcp ?? "", (ctx) => adapter.hcpProfile(ctx, presetHcp!), presetHcp !== null && picked === null)
  const activeHcp = picked ?? (preset.status === "success" && presetHcp ? { hcpId: presetHcp, name: preset.data.name.value ?? "HCP name not recorded" } : null)

  const results = useQuery("searchHcps", query, (ctx) => adapter.searchHcps(ctx, query), query.length > 0)
  const list = useQuery("myBriefs", `list`, (ctx) => adapter.myBriefs(ctx), true)
  const opened = useQuery("preCallBrief", briefId ?? "", (ctx) => adapter.preCallBrief(ctx, briefId!), briefId !== null && created?.briefId !== briefId)

  const [overrides, setOverrides] = React.useState<Record<string, PreCallBrief>>({})
  const shown: PreCallBrief | null = briefId
    ? (overrides[briefId] ?? (created?.briefId === briefId ? created : opened.status === "success" ? opened.data : null))
    : null

  const open = (id: string | null) => {
    const next = new URLSearchParams(params.toString())
    if (id) next.set("brief", id)
    else next.delete("brief")
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false })
  }

  const objectiveOk = objective.trim().length >= 3 && objective.trim().length <= 500

  const generate = async (hcpId: string, text: string, regenerates?: string) => {
    setGenerating(true)
    setFormError(null)
    const ctx = { correlationId: newCorrelationId() }
    try {
      const brief = await adapter.generateBrief(ctx, { hcpId, objective: text.trim(), regeneratesBriefId: regenerates ?? null })
      setCreated(brief)
      setOverrides((o) => ({ ...o, [brief.briefId]: brief }))
      open(brief.briefId)
      list.refetch()
      toast.success(regenerates ? "Brief regenerated" : "Brief generated and saved", {
        description: "Every statement links to a call or response. Review, then edit the prompts and agenda.",
      })
    } catch (err) {
      const error = toDataError(err, ctx.correlationId)
      log.child(ctx.correlationId).error("brief generation failed", { operation: "generateBrief", error_code: error.code })
      if (regenerates) toast.error("The brief could not be regenerated", { description: "Your earlier brief is unchanged." })
      else setFormError(error)
    } finally {
      setGenerating(false)
    }
  }

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault()
    if (draft.trim()) setQuery(draft.trim())
  }

  const canGenerate = activeHcp !== null && objectiveOk && !generating

  return (
    <VStack gap={4} className="@container">
      <VStack gap={1}>
        <Heading level={1}>Pre-call brief</Heading>
        <Text as="p" color="secondary" className="max-w-2xl">
          Choose an HCP you are authorized to see, say what you want from the next call, and get a brief where every statement links to the call or response it came from.
        </Text>
      </VStack>

      {/* Asymmetric two-column workspace that reorders on narrow screens: Astryx Grid has only equal tracks, so the container-query grid stays. */}
      <div className="grid gap-4 @4xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] @4xl:items-start">
        <VStack gap={4}>
          <section aria-labelledby="new-brief-h">
            <Card padding={5}>
              <VStack gap={4}>
                <HStack gap={2} align="center">
                  <Icon icon={ClipboardList} color="accent" />
                  <Heading level={2} id="new-brief-h">New brief</Heading>
                </HStack>

                <HStack as="form" gap={2} align="end" onSubmit={submitSearch} role="search">
                  <StackItem size="fill">
                    <TextInput
                      data-testid="brief-hcp-search"
                      label="Search HCPs"
                      isLabelHidden
                      type="search"
                      value={draft}
                      onChange={setDraft}
                      placeholder="Find an HCP by name, institution or territory"
                      enterKeyHint="search"
                      width="100%"
                    />
                  </StackItem>
                  <IconButton type="submit" size="lg" variant="secondary" label="Search" icon={<Icon icon="search" />} />
                </HStack>

                {query && (
                  <VStack aria-live="polite">
                    {results.status === "loading" ? (
                      <Text type="supporting" as="p">Searching authorized HCPs…</Text>
                    ) : results.status === "error" ? (
                      <ErrorState error={results.error} onRetry={results.refetch} />
                    ) : results.data.length === 0 ? (
                      <EmptyState data-testid="brief-hcp-empty" title="No authorized HCPs match that search." isCompact headingLevel={3} icon={<Icon icon="search" />} />
                    ) : (
                      <List data-testid="brief-hcp-results" hasDividers edge="outset">
                        {results.data.slice(0, 6).map((r: HcpSearchResult) => (
                          <ListItem
                            key={r.hcpId}
                            data-testid={`brief-pick-${r.hcpId}`}
                            isSelected={activeHcp?.hcpId === r.hcpId}
                            onClick={() => setPicked({ hcpId: r.hcpId, name: r.name.value ?? "HCP name not recorded" })}
                            startContent={<Icon icon={UserRound} color="info" />}
                            endContent={<Icon icon="chevronRight" color="secondary" />}
                            label={r.name.value ?? "Name not recorded"}
                            description={r.institution.value ?? "Institution not recorded"}
                          />
                        ))}
                      </List>
                    )}
                  </VStack>
                )}

                <Card variant="muted" padding={3} data-testid="brief-selected">
                  <VStack gap={0.5}>
                    <Text type="label" color="secondary">HCP</Text>
                    {presetHcp && !picked && preset.status === "error" ? (
                      <Text as="p" weight="medium">That HCP is not available to you.</Text>
                    ) : activeHcp ? (
                      <Text as="p" weight="semibold" data-testid="brief-selected-name">{activeHcp.name}</Text>
                    ) : (
                      <Text as="p" type="supporting">{presetHcp && preset.status === "loading" ? "Loading…" : "Search and pick an HCP."}</Text>
                    )}
                  </VStack>
                </Card>

                <VStack gap={1}>
                  <FormLayout>
                    <TextArea data-layout-ok="overlap"
                      data-testid="brief-new-objective"
                      label="Call objective"
                      value={objective}
                      maxLength={500}
                      rows={3}
                      onChange={setObjective}
                      placeholder="What do you want from the next call?"
                    />
                  </FormLayout>
                  <Text type="supporting" hasTabularNumbers>{objective.trim().length}/500</Text>
                </VStack>

                <Button
                  data-testid="brief-generate"
                  size="lg"
                  variant="primary"
                  width="100%"
                  label={generating ? "Generating…" : "Generate brief"}
                  icon={<Icon icon={Sparkles} />}
                  isDisabled={!canGenerate}
                  onClick={() => activeHcp && generate(activeHcp.hcpId, objective)}
                />
                {formError && (
                  <ErrorState error={formError} onRetry={formError.code === "FORBIDDEN" ? undefined : () => activeHcp && generate(activeHcp.hcpId, objective)} />
                )}
              </VStack>
            </Card>
          </section>

          <section aria-labelledby="my-briefs-h">
            <Card padding={5}>
              <VStack gap={3}>
                <Heading level={2} id="my-briefs-h">My briefs</Heading>
                {list.status === "loading" ? (
                  <Skeleton aria-busy="true" height={80} radius={3} />
                ) : list.status === "error" ? (
                  <ErrorState error={list.error} onRetry={list.refetch} />
                ) : list.data.length === 0 ? (
                  <Text type="supporting" as="p" data-testid="my-briefs-empty">No saved briefs yet. Generate one and it is kept here.</Text>
                ) : (
                  <List data-testid="my-briefs" hasDividers edge="outset">
                    {list.data.map((b) => (
                      <ListItem
                        key={b.briefId}
                        data-testid={`my-brief-${b.briefId}`}
                        data-accessible={b.accessible}
                        isSelected={briefId === b.briefId}
                        align="start"
                        onClick={() => {
                          // Opening from the list always re-checks access: drop anything cached from this session.
                          setOverrides({})
                          setCreated(null)
                          open(b.briefId)
                        }}
                        label={
                          b.accessible ? (
                            <Text weight="medium">{b.hcpName?.value ?? "HCP name not recorded"}</Text>
                          ) : (
                            <HStack gap={1.5} align="center">
                              <Icon icon={Lock} size="sm" />
                              <Text weight="medium">No longer available</Text>
                            </HStack>
                          )
                        }
                        description={
                          <VStack gap={1} align="start">
                            <Text type="supporting" as="p">{b.accessible ? b.objective : "You no longer have access to this HCP."}</Text>
                            <Text type="supporting" as="p" hasTabularNumbers>{formatBriefTime(b.generatedAt)}</Text>
                            {b.stale && <Badge data-testid="my-brief-stale" variant="warning" label="Newer data available - regenerate" />}
                          </VStack>
                        }
                      />
                    ))}
                  </List>
                )}
              </VStack>
            </Card>
          </section>
        </VStack>

        <div className={cn("min-w-0", (briefId !== null || generating) && "order-first @4xl:order-none")} aria-live="polite">
          {generating && !shown ? (
            <GeneratingPanel />
          ) : briefId === null ? (
            <Card data-testid="brief-placeholder" variant="muted" padding={8}>
              <EmptyState
                icon={<Icon icon={Sparkles} size="lg" color="accent" />}
                title="Your brief appears here"
                description="Pick an HCP, add your objective and tap Generate brief. You can also reopen a saved brief."
                headingLevel={2}
              />
            </Card>
          ) : shown ? (
            <VStack gap={4}>
              {generating && <GeneratingPanel />}
              <BriefView
                key={`${shown.briefId}:${shown.updatedAt}`}
                brief={shown}
                regenerating={generating}
                onRegenerate={() => generate(shown.hcpId, shown.objective, shown.briefId)}
                onUpdated={(updated) => setOverrides((o) => ({ ...o, [updated.briefId]: updated }))}
              />
            </VStack>
          ) : opened.status === "loading" ? (
            <Skeleton data-testid="brief-loading" aria-busy="true" height={384} radius={4} />
          ) : opened.status === "error" ? (
            opened.error.code === "FORBIDDEN" ? (
              <Card data-testid="brief-denied" role="alert" padding={6}>
                <EmptyState
                  icon={<Icon icon={Lock} size="lg" color="info" />}
                  title="You no longer have access to this HCP"
                  description="Your territory changed, so this brief cannot be opened. It is kept in case your access returns; nothing from it is shown."
                  headingLevel={2}
                />
              </Card>
            ) : (
              <ErrorState error={opened.error} onRetry={opened.refetch} />
            )
          ) : null}
        </div>
      </div>
    </VStack>
  )
}
