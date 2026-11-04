/**
 * The emerging-topic rule, mirrored from the database (`app.emerging_thresholds` / `app.emerging_status` in
 * backend/db/migrations/009_director_insights.sql). The real screen never evaluates it: the BE returns the status.
 * This copy exists so the mock adapter returns statuses the same way the database would, and so a test can pin the
 * truth table. Keep the two in step.
 */
import type { EmergingStatus, EmergingThresholds } from "./director-insights"

export const EMERGING_THRESHOLDS: Omit<EmergingThresholds, "rule"> = {
  minWindowResponses: 30,
  minTopicResponses: 10,
  minRelativeIncrease: 0.5,
  minSharePoints: 2.0,
}

/** `%g`-style number text: 2 -> "2", 1.5 -> "1.5". */
const g = (n: number) => String(Number(n.toPrecision(6)))

export function emergingRuleText(t: Omit<EmergingThresholds, "rule"> = EMERGING_THRESHOLDS): string {
  return (
    `A topic is flagged EMERGING when both periods hold at least ${t.minWindowResponses} free-text responses, the topic has at least ` +
    `${t.minTopicResponses} responses in the latest period, its share of responses rose by at least ${g(t.minSharePoints)} percentage points, ` +
    `and that share is at least ${g(1 + t.minRelativeIncrease)} times the earlier share (or it had none before). DECLINING is the mirror image.`
  )
}

export function emergingStatus(
  currentN: number,
  priorN: number,
  currentTotal: number,
  priorTotal: number,
  t: Omit<EmergingThresholds, "rule"> = EMERGING_THRESHOLDS,
): EmergingStatus {
  if (currentTotal < t.minWindowResponses || priorTotal < t.minWindowResponses) return "INSUFFICIENT_SAMPLE"
  const cur = currentN / currentTotal
  const pri = priorN / priorTotal
  if (currentN >= t.minTopicResponses && 100 * (cur - pri) >= t.minSharePoints && (priorN === 0 || cur >= pri * (1 + t.minRelativeIncrease))) return "EMERGING"
  if (priorN >= t.minTopicResponses && 100 * (pri - cur) >= t.minSharePoints && cur <= pri * (1 - t.minRelativeIncrease)) return "DECLINING"
  return "STABLE"
}

/** Splits `total` across `weights` so the parts are whole numbers that add up exactly (largest remainder). */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (total <= 0 || sum <= 0) return weights.map(() => 0)
  const exact = weights.map((w) => (total * w) / sum)
  const parts = exact.map(Math.floor)
  let left = total - parts.reduce((a, b) => a + b, 0)
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1])
  for (const [, i] of order) {
    if (left <= 0) break
    parts[i] += 1
    left -= 1
  }
  return parts
}
