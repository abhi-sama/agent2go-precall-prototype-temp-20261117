"use client"

import { useTheme } from "next-themes"
import { Toaster as SonnerToaster, type ToasterProps } from "sonner"

/**
 * The one toaster, mounted in the root layout. Call `toast()` from "sonner" anywhere.
 * Colours come from the design tokens so toasts follow light and dark; `offset` keeps them
 * clear of the iPad home indicator. Toasts confirm or report; never put names, emails or HCP text in one.
 */
function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme()
  return (
    <SonnerToaster
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      position="bottom-center"
      offset={{ bottom: "max(1rem, env(safe-area-inset-bottom))" }}
      closeButton
      // Confirmations are read in a glance: 4s, at most three stacked. Sonner's own enter, exit and swipe are
      // transitions (they retarget when toasts arrive quickly) and slide from the bottom edge they leave through.
      duration={4000}
      visibleToasts={3}
      mobileOffset={{ bottom: "max(1rem, env(safe-area-inset-bottom))" }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius-lg)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
