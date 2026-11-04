# Chart system (ticket #45, phase 1 step 4)

One set of shared components in `frontend/src/components/charts/`, one palette, one set of conventions. Dashboards import from `@/components/charts`; they do not pick colours or write bar markup by hand.

## Components

| Component | File | Used by |
|---|---|---|
| `KpiTile` (headline figure; `KpiCard` wraps it for landing pages) | `kpi-tile.tsx` | MSL, Director, Executive landing |
| `Legend`, `SequentialLegend` | `legend.tsx` | Heatmap key; any chart with two or more series |
| `DistributionBars` (ranked answers, optional ordinal ramp) | `distribution-bars.tsx` | Response distributions |
| `Heatmap` (row by period, hatched zero cells) | `heatmap.tsx` | Director team activity |
| `Timeline` (events with icon, word and colour for status) | `timeline.tsx` | Admin data-quality load timeline |
| `TrendAreaChart` (Recharts) and `EChart` (ECharts wrapper) | `trend-area-chart.tsx`, `echart.tsx` | Trends, geo, anything Recharts lacks |
| `assignSeries`, `seriesColor`, `sequentialFill`, `useChartMotion` | `palette.ts`, `use-chart-motion.ts` | Every chart |

Monthly bar and stacked charts (`activity/activity-charts.tsx`, `director/mix-section.tsx`) stay on the shadcn `ChartContainer` and take colours and motion from the shared helpers.

## Palette

Defined in `globals.css`. Categorical slots in fixed order, never cycled: orange (the accent, slot 1), blue, aqua, violet, magenta, yellow. `--chart-other` is a neutral for the folded remainder. A seventh series folds into Other; it never gets a generated hue.

Validated with the dataviz validator (OKLab Delta E x100, surface white in light and warm charcoal `#1e1a17` in dark):

| Mode | Slots | Result |
|---|---|---|
| Light, adjacent pairs | `#f54900 #2a78d6 #1baf7a #6250d6 #e87ba4 #eda100` | Lightness, chroma, CVD (worst 16.3) and normal-vision (worst 19.6) pass |
| Light, all pairs (first three) | orange, blue, aqua | Pass; worst CVD 10.5 |
| Dark, adjacent pairs | `#e85d1a #3987e5 #199e70 #9085e9 #d55181 #c98500` | All checks pass; worst CVD 13.2, normal-vision 19.3 |
| Dark, all pairs (first three) | orange, blue, aqua | Pass; worst CVD 11.4 |

The palette that shipped before failed the validator: light slot 2 was below the lightness band and chroma floor, slot 6 was gray, and dark slots 1 to 5 sat above the dark lightness band with blue and teal only 11.0 apart for normal vision.
Light slots 3, 5 and 6 sit under 3:1 on white, so a series in those slots always has visible labels or a table view (the relief rule).

Status colours (`--success`, `--warning`, `--destructive`) are reserved for state and always come with an icon and a word.
Sequential magnitude is one hue, the accent, mixed over the card (`sequentialFill`, 12% to 62%, capped so label text keeps 4.5:1 on the darkest cell in light and dark), so it works in both modes.

## Conventions

- **Form.** Magnitude: bars. Change over time: area or bars by month. Part of whole across few values: one stacked bar. Row by period: heatmap. A single headline: `KpiTile`, not a chart. Never dual axes.
- **Colour follows the entity.** The measure "Distinct calls" is slot 1 in the KPI, the trend, the mix and the heatmap. Filtering never repaints the survivors.
- **Nominal bars** (answers, channels in a ranked list) take one hue. **Ordinal answers** (Likert, 0 to 10) use `DistributionBars ordinal`.
- **Legend.** Two or more series always have a legend; a single series is named by its title. Text stays in ink; the swatch carries the colour.
- **Marks.** 8px bars with a rounded data end anchored at zero, 2px lines, a gap between stacked fills, a recessive grid (`--chart-grid`).
- **Labels.** Exact count and percent beside each distribution row; every heatmap cell prints its value; a zero cell is hatched and labelled so "nothing recorded" never reads as "quiet".
- **Partial periods** are drawn lighter or marked with an asterisk, never as a drop.
- **Tooltips** are a second path, never the only one: touch screens get the printed values.
- **Motion.** 450ms `ease-out` draw-in, off under reduced motion. Data that updates because a filter changed redraws once, not repeatedly.
- **Accessibility.** Charts have a text equivalent (`aria-label`, `role="meter"` on distribution bars, a `caption` on heatmaps); status never rests on colour alone.
- **Size.** Charts resize with their container (`ResizeObserver` in `EChart`, `ChartContainer` for Recharts); verify at every size in the viewport matrix.
