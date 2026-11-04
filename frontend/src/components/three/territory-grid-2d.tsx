import { Lock } from "lucide-react"
import type { TerritoryActivity } from "@/lib/data/types"
import { cn } from "@/lib/utils"

/**
 * 2D fallback for the territory visual: same layout, same data, no WebGL. Also the right view when a
 * person simply prefers it. Tiles are real buttons, so it is fully keyboard and screen-reader usable.
 */
export function TerritoryGrid2D({
  items,
  selectedId,
  onSelect,
}: {
  items: TerritoryActivity[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const cols = Math.max(...items.map((t) => t.col)) + 1
  const maxValue = Math.max(1, ...items.filter((t) => t.inScope).flatMap((t) => [t.distinctCalls, t.distinctEngagedHcps, t.responseCount]))
  const sorted = [...items].sort((a, b) => a.row - b.row || a.col - b.col)
  const bar = (v: number) => `${Math.max(4, (v / maxValue) * 100)}%`

  return (
    <div
      data-testid="territory-2d"
      className="grid gap-2 p-1"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {sorted.map((t) => {
        const selected = t.territoryId === selectedId
        return (
          <button
            key={t.territoryId}
            type="button"
            disabled={!t.inScope}
            aria-pressed={t.inScope ? selected : undefined}
            aria-label={t.inScope ? `${t.name}, ${t.regionName}` : `${t.name}: outside your scope`}
            onClick={() => onSelect(t.territoryId)}
            className={cn(
              "flex min-h-20 flex-col justify-between rounded-xl border p-2 text-left transition-colors",
              t.inScope ? "bg-card hover:bg-accent" : "cursor-not-allowed border-dashed bg-muted/50 text-muted-foreground",
              t.isOwn && "border-primary/60",
              selected && "ring-2 ring-primary",
            )}
          >
            <span className="flex items-start justify-between gap-1">
              <span className="truncate text-[0.7rem] leading-tight font-semibold">{t.name}</span>
              {!t.inScope && <Lock className="size-3 shrink-0" aria-hidden />}
            </span>
            {t.inScope && (
              <span className="mt-1 flex flex-col gap-0.5" aria-hidden>
                <span className="h-1.5 rounded-full bg-chart-1" style={{ width: bar(t.distinctCalls) }} />
                <span className="h-1.5 rounded-full bg-chart-2" style={{ width: bar(t.distinctEngagedHcps) }} />
                <span className="h-1.5 rounded-full bg-chart-3" style={{ width: bar(t.responseCount) }} />
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
