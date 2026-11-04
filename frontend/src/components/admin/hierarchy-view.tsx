"use client"

import { useMemo, useState } from "react"
import { AlertTriangle, ChevronRight, CircleAlert, GitBranch, Network } from "lucide-react"
import { Expand } from "@/components/motion/expand"
import { BlockSkeleton, ErrorState } from "@/components/state/states"
import { Badge } from "@/components/ui/badge"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { FindingCode, HierarchyFinding, HierarchyNode, HierarchyValidation } from "@/lib/data/governance"
import { useQuery } from "@/lib/data/use-query"
import { cn } from "@/lib/utils"

const FINDING_LABEL: Record<FindingCode, string> = {
  CYCLE: "Cycle",
  ORPHAN_TERRITORY: "Orphan",
  MISSING_LINK: "Missing link",
  OVERLAP: "Overlap",
  UNCOVERED_TERRITORY: "Uncovered",
}

function FindingBadge({ severity, code }: { severity: "ERROR" | "WARNING"; code: FindingCode }) {
  return <Badge variant={severity === "ERROR" ? "destructive" : "outline"}>{FINDING_LABEL[code]}</Badge>
}

function severityOf(node: HierarchyNode, findings: HierarchyFinding[]): "ERROR" | "WARNING" | null {
  const mine = findings.filter((f) => f.territoryIds.includes(node.territoryId))
  if (mine.some((f) => f.severity === "ERROR")) return "ERROR"
  return mine.length ? "WARNING" : null
}

function Holders({ node }: { node: HierarchyNode }) {
  const row = (label: string, items: HierarchyNode["directHolders"]) => (
    <div className="min-w-0">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">Nobody</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1 text-sm">
          {items.map((h) => (
            <li key={`${h.userId}-${h.assignmentType}-${h.viaTerritoryId}`} className="break-words">
              <span className="font-medium">{h.displayName || h.userId}</span>{" "}
              <span className="text-muted-foreground">
                {h.assignmentType}
                {h.viaTerritoryId !== node.territoryId ? ` via ${h.viaTerritoryId}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
  return (
    <div className="grid gap-4 pb-3 pl-2 pt-1 sm:grid-cols-2">
      {row("Assigned here", node.directHolders)}
      {row("Inherited from above", node.inheritedHolders)}
    </div>
  )
}

function TreeRow({
  id, nodes, findings, path, depth, open, toggle,
}: {
  id: string
  nodes: Map<string, HierarchyNode>
  findings: HierarchyFinding[]
  path: string[]
  depth: number
  open: Set<string>
  toggle: (key: string) => void
}) {
  const node = nodes.get(id)
  if (!node) return null
  const key = [...path, id].join(">")
  const expanded = open.has(key)
  const severity = severityOf(node, findings)
  // A node already on this path is a cycle: show it once more as a marker and stop descending.
  const looping = path.includes(id)
  const children = looping ? [] : node.childIds
  return (
    <li>
      <div className={cn("flex min-h-11 items-center gap-2 rounded-lg pr-2", severity === "ERROR" && "bg-destructive/5")} style={{ paddingLeft: `${Math.min(depth, 6) * 14}px` }}>
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Hide" : "Show"} details for ${node.territoryId}`}
          onClick={() => toggle(key)}
          className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
        >
          <ChevronRight className={cn("size-4 transition-transform duration-(--duration-base) ease-(--ease-out)", expanded && "rotate-90")} aria-hidden />
        </button>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="break-all font-medium">{node.territoryId}</span>
          <span className="text-xs text-muted-foreground">{node.kind === "REGION" ? "Region" : "Territory"}</span>
          {looping && <Badge variant="destructive">Loops back</Badge>}
          {node.findingCodes.map((code) => (
            <FindingBadge key={code} code={code} severity={findings.find((f) => f.code === code && f.territoryIds.includes(node.territoryId))?.severity ?? "WARNING"} />
          ))}
        </div>
      </div>
      <Expand open={expanded}>
        <div style={{ paddingLeft: `${Math.min(depth, 6) * 14 + 44}px` }}><Holders node={node} /></div>
      </Expand>
      {children.length > 0 && (
        <ul>
          {children.map((child) => (
            <TreeRow key={child} id={child} nodes={nodes} findings={findings} path={[...path, id]} depth={depth + 1} open={open} toggle={toggle} />
          ))}
        </ul>
      )}
    </li>
  )
}

function Findings({ findings }: { findings: HierarchyFinding[] }) {
  if (findings.length === 0) {
    return <p className="rounded-xl bg-card p-4 text-sm text-muted-foreground ring-1 ring-foreground/10" data-testid="hierarchy-clean">No problems found. Every territory is linked, acyclic and covered.</p>
  }
  return (
    <ul className="grid gap-2" data-testid="hierarchy-findings">
      {findings.map((f) => (
        <li key={`${f.code}-${f.territoryIds.join("|")}`} className={cn("flex items-start gap-3 rounded-xl bg-card p-3 ring-1", f.severity === "ERROR" ? "ring-destructive/40" : "ring-foreground/10")}>
          {f.severity === "ERROR" ? <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><FindingBadge code={f.code} severity={f.severity} /><span className="text-xs text-muted-foreground">{f.severity === "ERROR" ? "Fix needed" : "Review"}</span></div>
            <p className="mt-1 break-words text-sm">{f.message}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

function Tree({ graph }: { graph: HierarchyValidation }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const nodes = useMemo(() => new Map(graph.nodes.map((n) => [n.territoryId, n])), [graph])
  const roots = graph.nodes.filter((n) => n.parentIds.length === 0 && n.childIds.length > 0).map((n) => n.territoryId)
  const reached = useMemo(() => {
    const seen = new Set<string>()
    const walk = (id: string) => { if (seen.has(id)) return; seen.add(id); nodes.get(id)?.childIds.forEach(walk) }
    roots.forEach(walk)
    return seen
  }, [nodes, roots])
  const stray = graph.nodes.filter((n) => !reached.has(n.territoryId)).map((n) => n.territoryId)
  const toggle = (key: string) => setOpen((cur) => { const next = new Set(cur); if (next.has(key)) next.delete(key); else next.add(key); return next })
  return (
    <div className="flex flex-col gap-4">
      <ul data-testid="hierarchy-tree" aria-label="Territory hierarchy">
        {roots.map((id) => <TreeRow key={id} id={id} nodes={nodes} findings={graph.findings} path={[]} depth={0} open={open} toggle={toggle} />)}
      </ul>
      {stray.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">Not reachable from any root</h3>
          <p className="mt-1 text-xs text-muted-foreground">Orphans and cycles: no region leads down to these, so nobody inherits access to them.</p>
          <ul className="mt-2" data-testid="hierarchy-unreached">
            {stray.map((id) => <TreeRow key={id} id={id} nodes={nodes} findings={graph.findings} path={[]} depth={0} open={open} toggle={toggle} />)}
          </ul>
        </div>
      )}
    </div>
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
    <div className="flex flex-col gap-6">
      <section aria-labelledby="validation-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="validation-heading" className="flex items-center gap-2 text-lg font-semibold tracking-tight"><Network className="size-5 text-accent-text" aria-hidden />Validation</h2>
            <p className="mt-1 text-sm text-muted-foreground">Cycles, orphans, missing links, overlaps and inheritance, checked against what access really follows.</p>
          </div>
          <div className="flex gap-2" data-testid="hierarchy-counts">
            <Badge variant={data.errorCount ? "destructive" : "secondary"}>{data.errorCount} to fix</Badge>
            <Badge variant="outline">{data.warningCount} to review</Badge>
          </div>
        </div>
        <Findings findings={data.findings} />
      </section>
      <section aria-labelledby="tree-heading" className="rounded-xl bg-card p-3 ring-1 ring-foreground/10 sm:p-4">
        <h2 id="tree-heading" className="flex items-center gap-2 text-lg font-semibold tracking-tight"><GitBranch className="size-5 text-accent-text" aria-hidden />Hierarchy</h2>
        <p className="mb-2 mt-1 text-sm text-muted-foreground">A territory with two parents appears under each. Open a row to see who holds it, directly or by inheritance.</p>
        <Tree graph={data} />
      </section>
    </div>
  )
}
