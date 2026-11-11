import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "@/lib/utils"

/**
 * Legacy native input, restyled on Astryx tokens (field radius, emphasized border, surface fill, focus ring).
 * Kept because call sites rely on native semantics Astryx TextInput does not cover: uncontrolled `name` fields read
 * through FormData, `date` / `datetime-local` / `number` types, and `onChange(event)`. New text fields use
 * `TextInput` from `@astryxdesign/core/TextInput`; dates use `DateInput`; numbers use `NumberInput`.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-(--control-h) w-full min-w-0 rounded-(--radius-element) border border-input bg-(--color-background-surface) px-2.5 py-1 text-base text-foreground transition-colors outline-none placeholder:text-muted-foreground focus-visible:outline-(length:--focus-outline-width) focus-visible:outline-offset-(length:--focus-outline-offset) focus-visible:outline-(--focus-outline-color) focus-visible:outline-solid disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
