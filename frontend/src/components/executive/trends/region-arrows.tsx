"use client"

import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from "@astryxdesign/core/Table"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import { Badge } from "@astryxdesign/core/Badge"
import { TrendIndicator } from "@/components/executive/themes/parts"
import { CountValue } from "@/components/executive/count"
import { EXECUTIVE_TREND_METRICS, TREND_METRIC_LABEL, type ExecutiveMetricTrend, type ExecutiveRegionTrend } from "@/lib/data/executive-trends"

const change = (m: ExecutiveMetricTrend) => (m.changePercent === null ? null : `${m.changePercent > 0 ? "+" : ""}${m.changePercent.toFixed(1)}%`)

function MetricCell({ region, metric, minCell }: { region: ExecutiveRegionTrend; metric: ExecutiveMetricTrend; minCell: number }) {
  const pct = change(metric)
  return (
    <TableCell data-testid="arrow-cell" data-region={region.regionId} data-metric={metric.metric} data-trend={metric.trend}>
      <VStack gap={1} align="start">
        <Text type="body" weight="semibold" hasTabularNumbers><CountValue count={metric.latest} minCell={minCell} /></Text>
        <Text type="supporting" hasTabularNumbers>Before: <CountValue count={metric.prior} minCell={minCell} />{pct ? <> · <span data-testid="change">{pct}</span></> : null}</Text>
        <TrendIndicator trend={metric.trend} compact />
      </VStack>
    </TableCell>
  )
}

/**
 * Region by metric: the latest period, the period before, and the arrow the approved threshold rule gives. A region
 * without enough responses shows "Few responses" instead of an arrow, and a withheld count shows "Withheld": neither
 * reads as zero activity.
 */
export function RegionArrows({ regions, minCell }: { regions: ExecutiveRegionTrend[]; minCell: number }) {
  return (
    <Table data-testid="region-arrows" aria-label="Latest period against the period before, by region and metric">
      <TableHeader>
        <TableRow isHeaderRow>
          <TableHeaderCell scope="col">Region</TableHeaderCell>
          {EXECUTIVE_TREND_METRICS.map((metric) => <TableHeaderCell key={metric} scope="col">{TREND_METRIC_LABEL[metric]}</TableHeaderCell>)}
        </TableRow>
      </TableHeader>
      <TableBody>
        {regions.map((region) => (
          <TableRow key={region.regionId} data-testid="arrow-row" data-region={region.regionId}>
            <TableHeaderCell scope="row">
              <VStack gap={1} align="start">
                <span>{region.regionName}</span>
                <Text type="supporting">{region.territoriesInScope} territories</Text>
                {!region.sampleSufficient && <Badge data-testid="small-sample" variant="warning" label="Too few responses to judge" />}
              </VStack>
            </TableHeaderCell>
            {region.metrics.map((metric) => <MetricCell key={metric.metric} region={region} metric={metric} minCell={minCell} />)}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
