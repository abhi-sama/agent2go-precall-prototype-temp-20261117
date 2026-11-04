"use client"

import { KpiTile, type KpiTileProps } from "@/components/charts/kpi-tile"

/** Landing-page KPI. The tone names the chart slot the measure wears everywhere else. */
const TONE_SLOT = { orange: 1, ink: 2, teal: 3 } as const

export type KpiCardProps = Omit<KpiTileProps, "series"> & { tone: keyof typeof TONE_SLOT }

export function KpiCard({ tone, ...props }: KpiCardProps) {
  return <KpiTile series={TONE_SLOT[tone]} {...props} />
}
