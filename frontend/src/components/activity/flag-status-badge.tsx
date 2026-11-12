import { Badge } from "@astryxdesign/core/Badge"
import { Icon } from "@astryxdesign/core/Icon"
import { Tooltip } from "@astryxdesign/core/Tooltip"
import type { FlagStatus } from "@/lib/data/types"
import { FLAG_STATUS_META } from "./format"

export function FlagStatusBadge({ status, className }: { status: FlagStatus; className?: string }) {
  const meta = FLAG_STATUS_META[status]
  return (
    <Tooltip content={meta.hint}>
      <Badge data-testid="flag-status" data-status={status} className={className} variant={meta.variant} icon={<Icon icon={meta.icon} />} label={meta.label} />
    </Tooltip>
  )
}
