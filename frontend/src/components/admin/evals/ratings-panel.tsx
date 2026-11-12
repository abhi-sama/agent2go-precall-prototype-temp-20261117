"use client"

import { Badge } from "@astryxdesign/core/Badge"
import { Card } from "@astryxdesign/core/Card"
import { EmptyState } from "@astryxdesign/core/EmptyState"
import { Grid } from "@astryxdesign/core/Grid"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import { ThumbsDown, ThumbsUp } from "lucide-react"
import type { EvalRatings } from "@/lib/data/evals"
import { pct, when } from "./format"

/** Thumbs and notes from live answers. Each sits beside the automated scores of the very same answer. */
export function RatingsPanel({ ratings, personaLabel }: { ratings: EvalRatings; personaLabel: string }) {
  const s = ratings.summary
  return (
    <VStack gap={4} data-testid="ratings-panel">
      <Text type="supporting" as="p" display="block">
        What {personaLabel} users thought of real answers, with the automated faithfulness and citation scores of those same answers beside each thumb. A thumbs-down on a high-scoring answer is the kind of thing automation misses.
      </Text>
      <Grid columns={{ minWidth: 160, max: 4 }} gap={3}>
        {[
          ["Helpful", String(s.up)],
          ["Not helpful", String(s.down)],
          ["Automated faithfulness", pct(s.faithfulness)],
          ["Automated citations", pct(s.citationCorrectness)],
        ].map(([label, value]) => (
          <Card key={label} padding={4} className="min-w-0">
            <VStack gap={1}>
              <Text type="supporting">{label}</Text>
              <Heading level={3} type="display-3" className="tabular-nums">{value}</Heading>
            </VStack>
          </Card>
        ))}
      </Grid>
      {ratings.items.length === 0 ? (
        <VStack data-testid="ratings-empty">
          <EmptyState isCompact title={`No ${personaLabel} rating yet`} description={`No ${personaLabel} has rated an answer yet. Thumbs appear under every answer in chat.`} />
        </VStack>
      ) : (
        <VStack as="ul" gap={2}>
          {ratings.items.map((item) => {
            const up = item.rating === "UP"
            const Glyph = up ? ThumbsUp : ThumbsDown
            return (
              <li key={item.ratingId} data-testid="rating-item" data-rating={item.rating}>
                <Card padding={4}>
                  <HStack gap={3} wrap="wrap" align="start">
                    <Badge variant={up ? "success" : "error"} icon={<Icon icon={Glyph} size="xsm" />} label={up ? "Helpful" : "Not helpful"} />
                    <VStack className="min-w-0 flex-1 basis-60">
                      {item.note ? <Text as="p" display="block" className="break-words" data-testid="rating-note">{item.note}</Text> : <Text color="secondary" as="p" display="block">No note.</Text>}
                      <Text type="supporting" as="p" display="block">Rated {when(item.ratedAt)} · answer {item.chatRunId.slice(0, 12)}</Text>
                    </VStack>
                    <Text as="p" display="block" type="supporting" hasTabularNumbers data-testid="rating-scores">
                      Automated: faithful <Text weight="bold">{pct(item.faithfulness)}</Text> · citations <Text weight="bold">{item.citationCorrectness === null ? "none cited" : pct(item.citationCorrectness)}</Text>
                      {item.numbersUnverified > 0 && <Text> · {item.numbersUnverified} unmatched figure{item.numbersUnverified === 1 ? "" : "s"}</Text>}
                    </Text>
                  </HStack>
                </Card>
              </li>
            )
          })}
        </VStack>
      )}
    </VStack>
  )
}
