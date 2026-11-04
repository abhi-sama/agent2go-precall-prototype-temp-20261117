import Image from "next/image"
import { cn } from "@/lib/utils"

/** The shared product mark used in the application chrome and generated browser/install icons. */
export function BrandMark({ className, priority = false }: { className?: string; priority?: boolean }) {
  return (
    <Image
      src="/icon.svg"
      alt=""
      aria-hidden
      className={cn("size-9 shrink-0", className)}
      width={36}
      height={36}
      priority={priority}
    />
  )
}
