"use client"

import { Badge } from "@astryxdesign/core/Badge"
import { Banner } from "@astryxdesign/core/Banner"
import { Card } from "@astryxdesign/core/Card"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { List, ListItem } from "@astryxdesign/core/List"
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList"
import { Text } from "@astryxdesign/core/Text"
import { TreeList, type TreeListItemData } from "@astryxdesign/core/TreeList"
import { VStack } from "@astryxdesign/core/VStack"
import { GitBranch, Network } from "lucide-react"
import { useMemo, useState } from "react"
import { SectionCard } from "@/components/admin/section-card"
import { DashboardGrid, DashboardGridItem } from "@/components/layout/dashboard-grid"
import { BlockSkeleton, ErrorState } from "@/components/state/states"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { FindingCode, HierarchyFinding, HierarchyNode, HierarchyValidation } from "@/lib/data/governance"
import { useQuery } from "@/lib/data/use-query"

const FINDING_LABEL: Record<FindingCode, string> = {
  CYCLE: "Cycle",
  ORPHAN_TERRITORY: "Orphan",
  MISSING_LINK: "Missing link",
  OVERLAP: "Overlap",
  UNCOVERED_TERRITORY: "Uncovered",
}

function FindingBadge({ severity, code }: { severity: "ERROR" | "WARNING"; code: FindingCode }) {
  return <Badge variant={severity === "ERROR" ? "error" : "warning"} label={FINDING_LABEL[code]} />
}

function severityOf(node: HierarchyNode, findings: HierarchyFinding[]): "ERROR" | "WARNING" | null {
  const mine = findings.filter((f) => f.territoryIds.includes(node.territoryId))
  if (mine.some((f) => f.severity === "ERROR")) return "ERROR"
  return mine.length ? "WARNING" : null
}

/** Who holds a territory: assigned there, or inherited from a region above. */
function Holders({ node }: { node: HierarchyNode }) {
  const row = (label: string, items: HierarchyNode["directHolders"]) => (
    <MetadataListItem label={label}>
      {items.length === 0 ? (
        <Text color="secondary">Nobody</Text>
      ) : (
        <List density="compact">
          {items.map((h) => (
            <ListItem
              key={`${h.userId}-${h.assignmentType}-${h.viaTerritoryId}`}
              label={
                <Text className="break-words">
                  <Text weight="medium">{h.displayName || h.userId}</Text>{" "}
                  <Text color="secondary">
                    {h.assignmentType}
                    {h.viaTerritoryId !== node.territoryId ? ` via ${h.viaTerritoryId}` : ""}
                  </Text>
                </Text>
              }
            />
          ))}
        </List>
      )}
    </MetadataListItem>
  )
  return (
    <MetadataList label={{ position: "top" }}>
      {row("Assigned here", node.directHolders)}
      {row("Inherited from above", node.inheritedHolders)}
    </MetadataList>
  )
}

/** One tree item per path, so a territory with two parents shows under each and a loop ends in a marker. */
function buildItems(
  id: string,
  nodes: Map<string, HierarchyNode>,
  findings: HierarchyFinding[],
  path: string[],
  selected: string | null,
  select: (territoryId: string) => void,
): TreeListItemData | null {
  const node = nodes.get(id)
  if (!node) return null
  // A node already on this path is a cycle: show it once more as a marker and stop descending.
  const looping = path.includes(id)
  const children = looping ? [] : node.childIds.map((child) => buildItems(child, nodes, findings, [...path, id], selected, select)).filter((c): c is TreeListItemData => c !== null)
  return {
    id: [...path, id].join(">"),
    label: <Text className="break-all">{node.territoryId}</Text>,
    description: node.kind === "REGION" ? "Region" : "Territory",
    isSelected: selected === node.territoryId,
    isExpanded: true,
    onClick: () => select(node.territoryId),
    endContent: (
      <HStack gap={1} wrap="wrap" justify="end">
        {looping && <Badge variant="error" label="Loops back" />}
        {node.findingCodes.map((code) => (
          <FindingBadge key={code} code={code} severity={findings.find((f) => f.code === code && f.territoryIds.includes(node.territoryId))?.severity ?? "WARNING"} />
        ))}
        {severityOf(node, findings) === "ERROR" && <Text type="supporting">Fix needed</Text>}
      </HStack>
    ),
    children: children.length ? children : undefined,
  }
}

function Findings({ findings }: { findings: HierarchyFinding[] }) {
  if (findings.length === 0) {
    return <Banner status="success" title="No problems found" description="Every territory is linked, acyclic and covered." data-testid="hierarchy-clean" />
  }
  return (
    <VStack gap={2} data-testid="hierarchy-findings">
      {findings.map((f) => (
        <Banner
          key={`${f.code}-${f.territoryIds.join("|")}`}
          status={f.severity === "ERROR" ? "error" : "warning"}
          title={`${FINDING_LABEL[f.code]}: ${f.severity === "ERROR" ? "fix needed" : "review"}`}
          description={<Text className="break-words">{f.message}</Text>}
        />
      ))}
    </VStack>
  )
}

function Tree({ graph }: { graph: HierarchyValidation }) {
  const [selected, setSelected] = useState<string | null>(null)
  const nodes = useMemo(() => new Map(graph.nodes.map((n) => [n.territoryId, n])), [graph])
  const roots = useMemo(() => graph.nodes.filter((n) => n.parentIds.length === 0 && n.childIds.length > 0).map((n) => n.territoryId), [graph])
  const reached = useMemo(() => {
    const seen = new Set<string>()
    const walk = (id: string) => { if (seen.has(id)) return; seen.add(id); nodes.get(id)?.childIds.forEach(walk) }
    roots.forEach(walk)
    return seen
  }, [nodes, roots])
  const stray = graph.nodes.filter((n) => !reached.has(n.territoryId)).map((n) => n.territoryId)
  const items = (ids: string[]) => ids.map((id) => buildItems(id, nodes, graph.findings, [], selected, setSelected)).filter((i): i is TreeListItemData => i !== null)
  const detail = selected ? nodes.get(selected) : undefined
  return (
    <DashboardGrid>
      <DashboardGridItem area="focus">
        <VStack gap={4}>
          <VStack data-testid="hierarchy-tree">
            <TreeList items={items(roots)} density="spacious" header={<Text type="label">Territory hierarchy</Text>} />
          </VStack>
          {stray.length > 0 && (
            <VStack gap={2}>
              <Heading level={3}>Not reachable from any root</Heading>
              <Text type="supporting" as="p">Orphans and cycles: no region leads down to these, so nobody inherits access to them.</Text>
              <VStack data-testid="hierarchy-unreached">
                <TreeList items={items(stray)} density="spacious" header={<Text type="label">Unreached territories</Text>} />
              </VStack>
            </VStack>
          )}
        </VStack>
      </DashboardGridItem>
      <DashboardGridItem area="detail">
        <Card aria-live="polite" data-testid="hierarchy-detail" height="100%">
          {detail ? (
            <VStack gap={3}>
              <Heading level={3}><Text className="break-all">{detail.territoryId}</Text></Heading>
              <Holders node={detail} />
            </VStack>
          ) : (
            <Text color="secondary" as="p">Select a territory to see who holds it, directly or by inheritance.</Text>
          )}
        </Card>
      </DashboardGridItem>
    </DashboardGrid>
  )
}

/** The territory graph, validated: problems first, then the tree with who holds each node. */
export function HierarchyView() {
  const adapter = useDataAdapter()
  const graph = useQuery("adminHierarchy", "hierarchy", (ctx) => adapter.adminHierarchy(ctx))
  if (graph.status === "loading") return <BlockSkeleton className="h-80" />
  if (graph.status === "error") return <ErrorState error={graph.error} onRetry={graph.refetch} />
  const data = graph.data
  return (
    <VStack gap={6}>
      <SectionCard
        title="Validation"
        icon={Network}
        description="Cycles, orphans, missing links, overlaps and inheritance, checked against what access really follows."
        end={
          <HStack gap={2} data-testid="hierarchy-counts">
            <Badge variant={data.errorCount ? "error" : "success"} label={`${data.errorCount} to fix`} />
            <Badge variant="warning" label={`${data.warningCount} to review`} />
          </HStack>
        }
      >
        <Findings findings={data.findings} />
      </SectionCard>
      <SectionCard title="Hierarchy" icon={GitBranch} description="A territory with two parents appears under each. Select a row to see who holds it, directly or by inheritance.">
        <Tree graph={data} />
      </SectionCard>
    </VStack>
  )
}
