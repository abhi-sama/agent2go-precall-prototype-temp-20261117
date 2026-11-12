"use client"

import { Badge } from "@astryxdesign/core/Badge"
import { Card } from "@astryxdesign/core/Card"
import { Collapsible } from "@astryxdesign/core/Collapsible"
import { Divider } from "@astryxdesign/core/Divider"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { List, ListItem } from "@astryxdesign/core/List"
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList"
import { Skeleton } from "@astryxdesign/core/Skeleton"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import { MessageSquareText, PhoneCall, Tag } from "lucide-react"
import * as React from "react"
import { ErrorState } from "@/components/state/states"
import { useDataAdapter } from "@/lib/data/data-provider"
import { useQuery } from "@/lib/data/use-query"
import type { HcpResponse } from "@/lib/data/types"

function Chips({ values }: { values: string[] }) {
  return values.length ? (
    <HStack gap={1.5} wrap="wrap">
      {values.map((value) => (
        <Badge key={value} variant="neutral" label={value} />
      ))}
    </HStack>
  ) : (
    <Text type="supporting">Not recorded</Text>
  )
}

function ResponseCard({ response, children, level }: { response: HcpResponse; children?: React.ReactNode; level: number }) {
  const [expanded, setExpanded] = React.useState(false)
  const hasChildren = React.Children.count(children) > 0
  // The trigger is a shrink-to-fit button whose label wrapper cannot shrink below its one-line text, so a long question pushed
  // the card wider than its column; the two rules make the trigger full width and let the label wrapper truncate.
  return (
    <Card data-testid={`response-${response.responseId}`} data-depth={level} padding={0} className="[&_.astryx-collapsible-trigger]:w-full [&_.astryx-collapsible-trigger>:first-child]:min-w-0">
      <Collapsible
        isOpen={expanded}
        onOpenChange={setExpanded}
        trigger={
          <HStack data-testid={`response-toggle-${response.responseId}`} gap={3} align="center" width="100%" className="min-w-0">
            <Icon icon={MessageSquareText} color="info" />
            <Text weight="medium" maxLines={1} className="min-w-0">
              {response.question || "Question not recorded"}
            </Text>
          </HStack>
        }
      >
        {expanded && (
          <VStack gap={4} padding={level > 1 ? 3 : 4}>
            {level > 1 ? (
              // Deep follow-ups: MetadataList keeps a minimum column width that cannot fit once ten levels of padding have
              // narrowed the card, so these plain label/value pairs shrink and wrap instead.
              <VStack gap={2}>
                <VStack gap={0.5}>
                  <Text type="label" color="secondary">Recorded answer</Text>
                  <Text className="whitespace-pre-wrap">{response.answer || "No answer recorded"}</Text>
                </VStack>
                <VStack gap={0.5}>
                  <Text type="label" color="secondary">Interaction date</Text>
                  <Text hasTabularNumbers>{response.interactionDate}</Text>
                </VStack>
                <VStack gap={0.5}>
                  <Text type="label" color="secondary">Source record</Text>
                  <Text data-testid={`response-source-${response.responseId}`} weight="medium">{response.sourceRecordId}</Text>
                </VStack>
              </VStack>
            ) : (
            <MetadataList columns="multi" label={{ position: "top" }}>
              <MetadataListItem label="Recorded answer">
                <Text className="whitespace-pre-wrap">{response.answer || "No answer recorded"}</Text>
              </MetadataListItem>
              <MetadataListItem label="Interaction date">
                <Text hasTabularNumbers>{response.interactionDate}</Text>
              </MetadataListItem>
              <MetadataListItem label="Source record">
                <Text data-testid={`response-source-${response.responseId}`} weight="medium">
                  {response.sourceRecordId}
                </Text>
              </MetadataListItem>
            </MetadataList>
            )}
            {hasChildren ? (
              <VStack gap={3}>
                <Divider />
                <Text type="label" color="secondary">
                  Follow-up answers
                </Text>
                {children}
              </VStack>
            ) : null}
          </VStack>
        )}
      </Collapsible>
    </Card>
  )
}

function ResponseTree({ response, byParent, level = 0 }: { response: HcpResponse; byParent: Map<string, HcpResponse[]>; level?: number }) {
  const children = byParent.get(response.responseId) ?? []
  const card = (
    <ResponseCard response={response} level={level}>
      {children.map((child) => (
        <ResponseTree key={child.responseId} response={child} byParent={byParent} level={level + 1} />
      ))}
    </ResponseCard>
  )
  // Follow-ups indent under their parent for the first three levels; deeper ones stay flush so narrow screens keep room.
  if (level > 0 && level <= 3) {
    return (
      <HStack gap={3} align="stretch">
        <Divider orientation="vertical" />
        <VStack className="min-w-0 flex-1">{card}</VStack>
      </HStack>
    )
  }
  return card
}

/**
 * Source-only HCP history. `data-layout-ok="overlap"` on the section: the closed collapsible bodies still report layout boxes
 * under their triggers (nothing is painted there), which the responsive overlap check would otherwise flag.
 * Parent links are already constrained by the API to one insight interaction.
 */
export function HcpTimeline({ hcpId }: { hcpId: string }) {
  const adapter = useDataAdapter()
  const timeline = useQuery("hcpTimeline", hcpId, (ctx) => adapter.hcpTimeline(ctx, hcpId), true)
  if (timeline.status === "loading") return <Skeleton data-testid="hcp-timeline-loading" aria-busy="true" height="18rem" radius={3} />
  if (timeline.status === "error") return <ErrorState error={timeline.error} onRetry={timeline.refetch} />

  const byParent = new Map<string, HcpResponse[]>()
  for (const response of timeline.data.responses) {
    if (response.parentResponseId) byParent.set(response.parentResponseId, [...(byParent.get(response.parentResponseId) ?? []), response])
  }
  const roots = timeline.data.responses.filter((response) => !response.parentResponseId)

  return (
    <section data-testid="hcp-timeline" data-layout-ok="overlap" aria-labelledby="hcp-history-heading" className="@container">
      <VStack gap={6}>
        <Divider />
        <HStack gap={3} align="start">
          <Icon icon="calendar" size="lg" color="info" />
          <VStack gap={1}>
            <Heading id="hcp-history-heading" level={2}>
              Interaction history
            </Heading>
            <Text type="supporting" as="p">
              Source-recorded calls and perspectives for this HCP. Answers are never inferred or combined.
            </Text>
          </VStack>
        </HStack>

        <div className="grid min-w-0 gap-7 @3xl:grid-cols-[minmax(0,.9fr)_minmax(22rem,1.1fr)]">
          <VStack gap={3} className="min-w-0">
            <Heading level={3}>Previous calls</Heading>
            <List data-testid="hcp-call-timeline" hasDividers edge="outset">
              {timeline.data.interactions.map((interaction) => (
                <ListItem
                  key={interaction.callId}
                  data-testid={`call-${interaction.callId}`}
                  startContent={<Icon icon={PhoneCall} color="accent" />}
                  label={
                    <HStack gap={3} wrap="wrap" align="center" justify="between">
                      <Text weight="semibold" hasTabularNumbers>
                        {interaction.interactionDate}
                      </Text>
                      <Text type="supporting" size="xsm" wordBreak="break-all">
                        Source: {interaction.sourceRecordId}
                      </Text>
                    </HStack>
                  }
                  description={
                    <VStack gap={3} align="start">
                      <VStack gap={1}>
                        <Text type="label" color="secondary">
                          Channel · type · status
                        </Text>
                        <Chips values={[...interaction.channels, ...interaction.types, ...interaction.statuses]} />
                      </VStack>
                      <VStack gap={1}>
                        <Text type="label" color="secondary">
                          Products
                        </Text>
                        <Chips values={interaction.products} />
                      </VStack>
                      <VStack gap={1}>
                        <HStack gap={1} align="center">
                          <Icon icon={Tag} size="xsm" color="secondary" />
                          <Text type="label" color="secondary">
                            Topics
                          </Text>
                        </HStack>
                        <Chips values={interaction.topics} />
                      </VStack>
                    </VStack>
                  }
                />
              ))}
              {!timeline.data.interactions.length ? <ListItem label="No prior calls are recorded in the authorized source data." /> : null}
            </List>
          </VStack>
          <VStack gap={3} className="min-w-0">
            <Heading level={3}>Recorded perspectives</Heading>
            <VStack gap={3} data-testid="hcp-response-cards">
              {roots.map((response) => (
                <ResponseTree key={response.responseId} response={response} byParent={byParent} />
              ))}
              {!roots.length ? <Text type="supporting">No recorded responses are available for this HCP.</Text> : null}
            </VStack>
          </VStack>
        </div>

        {timeline.data.perspectives.length ? (
          <Card data-testid="hcp-perspective-history" variant="blue" padding={5}>
            <VStack gap={4}>
              <VStack gap={1}>
                <Heading level={3}>Recorded over time</Heading>
                <Text type="supporting" as="p">
                  Only answers to the same catalog question are shown together.
                </Text>
              </VStack>
              {timeline.data.perspectives.map((perspective) => (
                <VStack key={perspective.questionId} gap={2}>
                  <Text weight="medium">{perspective.question || "Question not recorded"}</Text>
                  <MetadataList label={{ position: "start", width: "7rem" }}>
                    {perspective.answers.map((answer) => (
                      <MetadataListItem key={answer.responseId} label={answer.interactionDate}>
                        <Text>{answer.answer || "No answer recorded"}</Text>
                      </MetadataListItem>
                    ))}
                  </MetadataList>
                </VStack>
              ))}
            </VStack>
          </Card>
        ) : null}
      </VStack>
    </section>
  )
}
