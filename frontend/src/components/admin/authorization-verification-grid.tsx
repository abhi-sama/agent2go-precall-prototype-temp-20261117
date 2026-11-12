"use client"

import { Badge } from "@astryxdesign/core/Badge"
import { Card } from "@astryxdesign/core/Card"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { Selector } from "@astryxdesign/core/Selector"
import { Table, proportional } from "@astryxdesign/core/Table"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import { ShieldCheck } from "lucide-react"
import { useMemo, useState } from "react"
import { SectionCard } from "@/components/admin/section-card"
import { BlockSkeleton, ErrorState } from "@/components/state/states"
import { useDataAdapter } from "@/lib/data/data-provider"
import { DataError } from "@/lib/data/types"
import { useQuery } from "@/lib/data/use-query"

const SCENARIOS = [
  ["in_scope", "Active scope"],
  ["out_of_scope", "Out of scope"],
  ["after_transfer", "After transfer"],
  ["coverage_expired", "Coverage ended"],
] as const

type Scenario = (typeof SCENARIOS)[number][0]
const OPTIONS = SCENARIOS.map(([value, label]) => ({ value, label }))
const isScenario = (value: string): value is Scenario => SCENARIOS.some(([id]) => id === value)

interface ResultRow extends Record<string, unknown> {
  testId: string
  persona: string
  accessPath: string
  status: string
  expectation: string
}

/** CI's AppSync-as-persona coverage, presented without test identities or source data. */
export function AuthorizationVerificationGrid() {
  const adapter = useDataAdapter()
  const [scenario, setScenario] = useState<Scenario>("in_scope")
  const grid = useQuery("authorizationVerificationGrid", "current", (ctx) =>
    adapter.authorizationVerificationGrid
      ? adapter.authorizationVerificationGrid(ctx)
      : Promise.reject(new DataError("UNAVAILABLE", "Authorization verification is unavailable.", ctx.correlationId)),
  )
  const rows = useMemo<ResultRow[]>(
    () => (grid.status === "success" ? grid.data.results.filter((result) => result.scopeScenario === scenario).map((result) => ({ ...result })) : []),
    [grid, scenario],
  )

  if (grid.status === "loading") return <BlockSkeleton className="h-96" />
  if (grid.status === "error") return <ErrorState error={grid.error} onRetry={grid.refetch} />

  const label = SCENARIOS.find(([id]) => id === scenario)?.[1] ?? scenario
  return (
    <VStack data-testid="authorization-verification-grid">
      <SectionCard
        title="Authorization verification grid"
        icon={ShieldCheck}
        description="Local CI signs in seeded personas and exercises the AppSync path. This inventory contains no test identities, territory identifiers, or source records."
        end={
          <>
            <Badge variant="success" icon={<Icon icon="success" size="xsm" />} label={`${grid.data.passed} / ${grid.data.total} passed`} />
            <Badge variant="neutral" label="Local stack only" />
          </>
        }
      >
        <HStack gap={4} justify="between" align="end" wrap="wrap">
          <VStack gap={1} className="min-w-0 flex-1 basis-64">
            <Text type="label">Scope condition</Text>
            <Text type="supporting" as="p">{rows[0]?.expectation}</Text>
          </VStack>
          <Selector label="Authorization grid scope condition" options={OPTIONS} value={scenario} width={240} onChange={(next) => { if (isScenario(next)) setScenario(next) }} />
        </HStack>
        <Card padding={0}>
          <Table<ResultRow>
            data={rows}
            idKey="testId"
            hasHover
            columns={[
              { key: "persona", header: "Persona", width: proportional(1, { minWidth: 140 }) },
              { key: "accessPath", header: "Access path", width: proportional(2, { minWidth: 220 }) },
              { key: "scope", header: "Scope condition", width: proportional(1, { minWidth: 140 }), renderCell: () => <Text color="secondary">{label}</Text> },
              { key: "status", header: "Result", width: proportional(1, { minWidth: 100 }), renderCell: (row) => <Badge variant={row.status === "PASS" ? "success" : "error"} label={row.status} /> },
            ]}
          />
        </Card>
        <Text type="supporting" as="p">Suite: {grid.data.suiteId}. The CI test is the evidence; this panel publishes its coverage contract for review.</Text>
      </SectionCard>
    </VStack>
  )
}
