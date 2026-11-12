"use client"

import { Button } from "@astryxdesign/core/Button"
import { Card } from "@astryxdesign/core/Card"
import { EmptyState as AstryxEmptyState } from "@astryxdesign/core/EmptyState"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { List, ListItem } from "@astryxdesign/core/List"
import { Skeleton } from "@astryxdesign/core/Skeleton"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import { Flag as FlagIcon, Plus } from "lucide-react"
import { ErrorState } from "@/components/state/states"
import type { DataError, Flag } from "@/lib/data/types"
import { formatDay } from "@/lib/dates"
import { FLAG_KIND_LABEL, FLAG_TARGET_LABEL } from "./format"
import { FlagStatusBadge } from "./flag-status-badge"

type FlagsState = { status: "loading" } | { status: "error"; error: DataError } | { status: "success"; data: Flag[] }

/** The user's own flags with their review status. Flags are private to the person who raised them. */
export function FlagsPanel({ flags, onRetry, onNew }: { flags: FlagsState; onRetry: () => void; onNew: () => void }) {
  return (
    <Card data-testid="flags-panel" padding={5} elevation="low">
      <section aria-labelledby="flags-heading">
        <VStack gap={4}>
          <HStack gap={3} wrap="wrap" justify="between" align="center">
            <VStack gap={0.5}>
              <Heading id="flags-heading" level={2}>
                My flags
              </Heading>
              <Text type="supporting" as="p">
                Issues you reported, with where each one stands in review.
              </Text>
            </VStack>
            <Button label="Flag an issue" variant="secondary" icon={<Icon icon={Plus} />} onClick={onNew} data-testid="flag-open" />
          </HStack>

          {flags.status === "loading" && <Skeleton aria-busy="true" height="4rem" radius={3} />}
          {flags.status === "error" && <ErrorState error={flags.error} onRetry={onRetry} />}
          {flags.status === "success" &&
            (flags.data.length === 0 ? (
              <AstryxEmptyState
                data-testid="flags-empty"
                isCompact
                headingLevel={3}
                icon={<Icon icon={FlagIcon} />}
                title="You have not flagged anything"
                description="Spot something wrong in a chart's records? Flag it from there."
              />
            ) : (
              <List hasDividers edge="outset">
                {flags.data.map((f) => (
                  <ListItem
                    key={f.flagId}
                    data-testid="flag-item"
                    label={FLAG_KIND_LABEL[f.kind]}
                    description={
                      <VStack gap={1} align="start">
                        <Text type="supporting">
                          {FLAG_TARGET_LABEL[f.targetType]} <Text type="code">{f.targetId}</Text>
                        </Text>
                        {f.note && (
                          <Text as="p" size="sm">
                            {f.note}
                          </Text>
                        )}
                        <Text type="supporting" size="xsm">
                          Raised {formatDay(f.createdAt.slice(0, 10), true)}
                          {f.updatedAt !== f.createdAt && ` · updated ${formatDay(f.updatedAt.slice(0, 10), true)}`}
                        </Text>
                      </VStack>
                    }
                    endContent={<FlagStatusBadge status={f.status} />}
                  />
                ))}
              </List>
            ))}
        </VStack>
      </section>
    </Card>
  )
}
