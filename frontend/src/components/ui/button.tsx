"use client"

import { Button as AstryxButton } from "@astryxdesign/core/Button"
import { IconButton as AstryxIconButton } from "@astryxdesign/core/IconButton"
import { cva, type VariantProps } from "class-variance-authority"
import NextLink from "next/link"
import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Compatibility adapter: the shadcn-era `<Button>` API rendered by the Astryx Button / IconButton, so every existing
 * call site follows the active Astryx theme. New code imports `Button` / `IconButton` from `@astryxdesign/core`
 * directly (see docs/astryx-migration.md).
 *
 * Mapping: variant default -> primary, outline / secondary -> secondary, ghost / link -> ghost, destructive ->
 * destructive; size xs / sm -> sm, default -> md, lg -> lg; size icon* -> IconButton. `disabled` becomes Astryx's
 * `isDisabled` (aria-disabled: the button stays focusable and announces why, and clicks and submits are cancelled).
 */
type LegacyVariant = "default" | "outline" | "secondary" | "ghost" | "destructive" | "link"
type LegacySize = "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg"
type AstryxVariant = "primary" | "secondary" | "ghost" | "destructive"

const VARIANT: Record<LegacyVariant, AstryxVariant> = {
  default: "primary",
  outline: "secondary",
  secondary: "secondary",
  ghost: "ghost",
  destructive: "destructive",
  link: "ghost",
}
const SIZE: Record<LegacySize, "sm" | "md" | "lg"> = {
  default: "md",
  xs: "sm",
  sm: "sm",
  lg: "lg",
  icon: "md",
  "icon-xs": "sm",
  "icon-sm": "sm",
  "icon-lg": "lg",
}

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "color" | "value"> {
  variant?: LegacyVariant | null
  size?: LegacySize | null
  /** Accessible name. Defaults to `aria-label`, else the button's visible text. */
  label?: string
  value?: string | number
  ref?: React.Ref<HTMLButtonElement>
}

/** The text a screen reader would read for these children: strings, numbers and nested text, minus aria-hidden parts. */
export function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join("")
  if (React.isValidElement<{ children?: React.ReactNode; "aria-hidden"?: unknown }>(node)) {
    const hidden = node.props["aria-hidden"]
    if (hidden === true || hidden === "true") return ""
    return textOf(node.props.children)
  }
  return ""
}

/** Children keep their icons at the system icon size with a steady gap (Astryx sizes only its own `icon` slot). */
const CONTENT = "inline-flex min-w-0 items-center gap-2 [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"

function Button({ variant, size, label, children, disabled, className, type = "button", ref, ...rest }: ButtonProps) {
  const legacySize = size ?? "default"
  const accessibleName = (label ?? rest["aria-label"] ?? textOf(children).replace(/\s+/g, " ").trim()) || "Button"
  const astryxVariant = VARIANT[variant ?? "default"]
  if (legacySize.startsWith("icon")) {
    return (
      <AstryxIconButton
        {...rest}
        ref={ref}
        type={type}
        label={accessibleName}
        variant={astryxVariant}
        size={SIZE[legacySize]}
        isDisabled={disabled}
        className={className}
        icon={<span className={CONTENT}>{children}</span>}
      />
    )
  }
  return (
    <AstryxButton
      {...rest}
      ref={ref}
      type={type}
      label={accessibleName}
      variant={astryxVariant}
      size={SIZE[legacySize]}
      isDisabled={disabled}
      className={cn(variant === "link" && "underline-offset-4 hover:underline", className)}
    >
      <span className={CONTENT}>{children}</span>
    </AstryxButton>
  )
}

export interface ButtonLinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "color"> {
  href: string
  variant?: LegacyVariant
  size?: Exclude<LegacySize, `icon${string}`>
  label?: string
}

/** A navigation link that looks like a button: an Astryx Button rendered as a Next.js link. */
function ButtonLink({ href, variant = "outline", size = "default", label, children, className, ...rest }: ButtonLinkProps) {
  const accessibleName = (label ?? rest["aria-label"] ?? textOf(children).replace(/\s+/g, " ").trim()) || href
  return (
    <AstryxButton
      {...(rest as Record<string, unknown>)}
      href={href}
      as={NextLink}
      label={accessibleName}
      variant={VARIANT[variant]}
      size={SIZE[size]}
      className={className}
    >
      <span className={CONTENT}>{children}</span>
    </AstryxButton>
  )
}

/**
 * @deprecated Legacy class recipe for links styled as buttons. Use `ButtonLink` (or Astryx `Button` with `href`)
 * instead. Kept, restyled on the Astryx-backed tokens, so pages owned by later migration waves keep compiling.
 */
const buttonVariants = cva(
  "inline-flex min-h-(--control-h) shrink-0 items-center justify-center gap-2 rounded-(--radius-element) border border-transparent px-4 text-sm font-semibold whitespace-nowrap transition-[color,background-color,border-color] duration-(--a2g-duration-fast) ease-(--ease-out) outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/85",
        outline: "bg-secondary text-foreground hover:bg-accent",
        secondary: "bg-secondary text-foreground hover:bg-accent",
        ghost: "hover:bg-accent",
        destructive: "bg-destructive/10 text-destructive hover:bg-destructive/20",
        link: "text-accent-text underline-offset-4 hover:underline",
      },
      size: {
        default: "",
        xs: "min-h-8 px-2 text-xs pointer-coarse:min-h-11",
        sm: "min-h-9 px-3 text-[0.8rem] pointer-coarse:min-h-11",
        lg: "min-h-12 px-5 text-base",
        icon: "size-11 px-0",
        "icon-xs": "size-8 px-0 pointer-coarse:size-11",
        "icon-sm": "size-10 px-0 pointer-coarse:size-11",
        "icon-lg": "size-12 px-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
)
export type ButtonVariantProps = VariantProps<typeof buttonVariants>

export { Button, ButtonLink, buttonVariants }
