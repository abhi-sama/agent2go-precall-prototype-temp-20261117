"use client"

import { Badge } from "@astryxdesign/core/Badge"
import { Card } from "@astryxdesign/core/Card"
import { EmptyState } from "@astryxdesign/core/EmptyState"
import { Heading } from "@astryxdesign/core/Heading"
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
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Helpful", String(s.up)],
          ["Not helpful", String(s.down)],
          ["Automated faithfulness", pct(s.faithfulness)],
          ["Automated citations", pct(s.citationCorrectness)],
        ].map(([label, value]) => (
          <Card key={label} padding={4} className="min-w-0">
            <dt><Text type="supporting">{label}</Text></dt>
            <dd className="mt-1"><Heading level={3} type="display-3" className="tabular-nums">{value}</Heading></dd>
          </Card>
        ))}
      </dl>
      {ratings.items.length === 0 ? (
        <div data-testid="ratings-empty">
          <EmptyState isCompact title={`No ${personaLabel} rating yet`} description={`No ${personaLabel} has rated an answer yet. Thumbs appear under every answer in chat.`} />
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {ratings.items.map((item) => {
            const up = item.rating === "UP"
            const Icon = up ? ThumbsUp : ThumbsDown
            return (
              <li key={item.ratingId} data-testid="rating-item" data-rating={item.rating}>
                <Card padding={4}>
                  <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                    <Badge variant={up ? "success" : "error"} icon={<Icon aria-hidden className="size-3.5" />} label={up ? "Helpful" : "Not helpful"} />
                    <div className="min-w-0 flex-1 basis-60">
                      {item.note ? <p data-testid="rating-note" className="break-words"><Text>{item.note}</Text></p> : <Text color="secondary" as="p" display="block">No note.</Text>}
                      <Text type="supporting" as="p" display="block">Rated {when(item.ratedAt)} · answer {item.chatRunId.slice(0, 12)}</Text>
                    </div>
                    <p data-testid="rating-scores" className="text-sm tabular-nums">
                      <Text type="supporting">Automated: </Text>
                      faithful <strong>{pct(item.faithfulness)}</strong> · citations <strong>{item.citationCorrectness === null ? "none cited" : pct(item.citationCorrectness)}</strong>
                      {item.numbersUnverified > 0 && <span> · {item.numbersUnverified} unmatched figure{item.numbersUnverified === 1 ? "" : "s"}</span>}
                    </p>
                  </div>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </VStack>
  )
}
