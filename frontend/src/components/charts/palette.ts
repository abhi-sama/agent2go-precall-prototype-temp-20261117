/**
 * The one chart palette. Colours live in globals.css as `--chart-1..6` (categorical, fixed order,
 * never cycled), `--chart-other` (the folded remainder) and `--chart-grid`. Light and dark were
 * validated separately with the dataviz validator; see docs/design/charts.md.
 */
export type SeriesSlot = 1 | 2 | 3 | 4 | 5 | 6

export const MAX_SERIES = 6
export const OTHER_COLOR = "var(--chart-other)"

export const seriesColor = (slot: SeriesSlot): string => `var(--chart-${slot})`

/**
 * Assign slots to series in the order given, never cycling: a series beyond the sixth folds into
 * "Other" (the caller sums those values) instead of repeating or inventing a hue. Color follows
 * the entity, so pass entities in a stable order (not sorted by today's value) when a filter can
 * change the series count.
 */
export function assignSeries<K extends string>(keys: readonly K[]): { colors: Record<K, string>; folded: K[] } {
  const colors = {} as Record<K, string>
  const folded: K[] = []
  keys.forEach((key, i) => {
    if (i < MAX_SERIES) colors[key] = seriesColor((i + 1) as SeriesSlot)
    else {
      colors[key] = OTHER_COLOR
      folded.push(key)
    }
  })
  return { colors, folded }
}

/** Sequential magnitude: one hue (the accent), light to dark, mixed over the surface so it works in both modes. */
export const SEQ_MIN = 12
export const SEQ_MAX = 50
export function sequentialFill(value: number, max: number, slot: SeriesSlot = 1): string {
  const t = max <= 0 ? 0 : Math.min(1, Math.max(0, value / max))
  return `color-mix(in oklab, ${seriesColor(slot)} ${Math.round(SEQ_MIN + t * (SEQ_MAX - SEQ_MIN))}%, var(--card))`
}

/** Recharts and ECharts animate over this duration with an ease-out curve; reduced motion turns it off. */
export const CHART_ANIMATION_MS = 450
